/** PostgreSQL projection and public-operation reads for the native web API. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { phaseTags, type Phase } from "../../domain/generated/modelTypes.ts";
import { nonTerminalPhaseTags } from "../../domain/phase.ts";
import { asTicketId } from "../../domain/ids.ts";
import {
  asPublicInstant,
  type NativeReadStore,
  type OperationRefusalCode,
  type OperationResource,
  type ProjectRead,
  type ProjectReadQuery,
  type ProjectResource,
  type TicketPhaseFilter,
  type TicketResource,
} from "../../interpreter/nativeWeb.ts";
import {
  allOperationStates,
  asOperationId,
  type OperationState,
} from "../../interpreter/operationInbox.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { projectRowCounter } from "./rows.ts";

interface PublicOperationRow {
  readonly operation: string;
  readonly accepted_at: string;
  readonly state: string;
  readonly decided_seq: string | null;
  readonly outcome_code: string | null;
  readonly refused_head: string | null;
  readonly refused_lifecycle_generation: string | null;
}

interface TicketProjectionRow {
  readonly ticket: string;
  readonly phase: string;
  readonly seq: string;
}

function operationState(value: string): OperationState {
  if (value === "Journaled") return "Succeeded";
  const state = allOperationStates.find((candidate) => candidate === value);
  if (state === undefined)
    throw new Error(`native read: ${value} is not a public operation state`);
  return state;
}

function refusalCode(value: string): OperationRefusalCode {
  if (
    value === "NotEnabled" ||
    value === "AuthoringChanged" ||
    value === "ConfigurationInvalid" ||
    value === "TicketChanged" ||
    value === "SelectionChanged" ||
    value === "CommandUnreadable"
  )
    return value;
  throw new Error(`native read: ${value} is not a public refusal code`);
}

function requiredCounter(value: string | null, what: string): number {
  if (value === null) throw new Error(`native read: ${what} is absent`);
  return projectRowCounter(value, what);
}

function publicOperationInstant(
  value: string,
): ReturnType<typeof asPublicInstant> {
  const parsed =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)([+-]\d{2})(?::?(\d{2}))?$/u.exec(
      value,
    );
  if (parsed === null)
    throw new TypeError(
      "native read: accepted instant is not PostgreSQL timestamptz text",
    );
  return asPublicInstant(
    `${parsed[1]}T${parsed[2]}${parsed[3]}:${parsed[4] ?? "00"}`,
  );
}

/** Maps the private storage row onto the deliberately smaller public resource. */
export function publicOperation(row: PublicOperationRow): OperationResource {
  const base = {
    operation: asOperationId(row.operation),
    acceptedAt: publicOperationInstant(row.accepted_at),
  };
  const state = operationState(row.state);
  switch (state) {
    case "Pending":
      return { ...base, state };
    case "Succeeded":
      return {
        ...base,
        state,
        decidedSequence: requiredCounter(row.decided_seq, "decided sequence"),
      };
    case "Refused":
      if (row.outcome_code === null)
        throw new Error("native read: refused operation has no code");
      return {
        ...base,
        state,
        code: refusalCode(row.outcome_code),
        refusedHead: requiredCounter(row.refused_head, "refused head"),
        refusedLifecycleGeneration: requiredCounter(
          row.refused_lifecycle_generation,
          "refused lifecycle generation",
        ),
      };
    case "Answered":
    case "Cancelled":
      return { ...base, state };
  }
}

function projectionPhase(value: string): Phase {
  const phase = phaseTags.find((candidate) => candidate === value);
  if (phase === undefined)
    throw new Error(`native read: ${value} is not a ticket phase`);
  return phase;
}

function projectResource(
  partition: Partition,
  head: string,
  rows: readonly TicketProjectionRow[],
  limit: number,
  order: ProjectReadQuery["order"],
): ProjectResource {
  const page = rows.slice(0, limit);
  const next = rows.length > limit ? page.at(-1) : undefined;
  const resource: ProjectResource = {
    partition,
    sequence: projectRowCounter(head, "project projection watermark"),
    tickets: page.map((row) => ({
      ticket: asTicketId(projectRowCounter(row.ticket, "ticket identity")),
      phase: projectionPhase(row.phase),
      sequence: projectRowCounter(row.seq, "ticket projection sequence"),
    })),
  };
  return next === undefined
    ? resource
    : {
        ...resource,
        ...(order === "RecentActivity"
          ? {
              nextRecentActivityAfter: {
                sequence: projectRowCounter(next.seq, "ticket activity cursor"),
                ticket: asTicketId(
                  projectRowCounter(next.ticket, "ticket page cursor"),
                ),
              },
            }
          : {
              nextAfter: asTicketId(
                projectRowCounter(next.ticket, "ticket page cursor"),
              ),
            }),
      };
}

function selectedPhases(
  filter: TicketPhaseFilter | undefined,
): readonly Phase[] {
  if (filter === undefined) return phaseTags;
  return filter.selection === "NonTerminal"
    ? nonTerminalPhaseTags
    : filter.phases;
}

function ticketResource(row: TicketProjectionRow): TicketResource {
  return {
    ticket: asTicketId(projectRowCounter(row.ticket, "ticket identity")),
    phase: projectionPhase(row.phase),
    sequence: projectRowCounter(row.seq, "ticket projection sequence"),
  };
}

async function readProject(
  pool: pg.Pool,
  partition: Partition,
  query: ProjectReadQuery,
): Promise<ProjectRead> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const project = await client.query<{ head: string }>(
      sql`SELECT head FROM project WHERE tenant=${partition.tenant} AND project=${partition.project}`,
    );
    const standing = project.rows[0];
    if (standing === undefined) {
      await client.query("COMMIT");
      return { result: "NotFound" };
    }
    const head = projectRowCounter(
      standing.head,
      "project projection watermark",
    );
    if (query.minimumSequence !== undefined && head < query.minimumSequence) {
      await client.query("COMMIT");
      return { result: "Behind", observedSequence: head };
    }
    const tickets = await readProjectTickets(client, partition, query);
    await client.query("COMMIT");
    return {
      result: "Found",
      project: projectResource(
        partition,
        standing.head,
        tickets,
        query.limit,
        query.order,
      ),
    };
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw cause;
  } finally {
    client.release();
  }
}

async function readProjectTickets(
  client: pg.PoolClient,
  partition: Partition,
  query: ProjectReadQuery,
): Promise<readonly TicketProjectionRow[]> {
  if (query.order === "RecentActivity") {
    const found = await client.query<TicketProjectionRow>(
      sql`SELECT ticket,phase,seq FROM ticket_projection
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND (${query.recentActivityAfter?.sequence ?? null}::bigint IS NULL
            OR (seq,ticket) < (${query.recentActivityAfter?.sequence ?? null},${query.recentActivityAfter?.ticket ?? null}))
          AND phase = ANY(${[...selectedPhases(query.phaseFilter)]}::text[])
        ORDER BY seq DESC,ticket DESC LIMIT ${query.limit + 1}`,
    );
    return found.rows;
  }
  const found = await client.query<TicketProjectionRow>(
    sql`SELECT ticket,phase,seq FROM ticket_projection
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND ticket>${query.after ?? 0}
          AND phase = ANY(${[...selectedPhases(query.phaseFilter)]}::text[])
        ORDER BY ticket LIMIT ${query.limit + 1}`,
  );
  return found.rows;
}

/** Reads only API-safe columns through a pool carrying the API credential. */
export function postgresNativeReads(pool: pg.Pool): NativeReadStore {
  return {
    operation: async (partition, operation) => {
      const found = await pool.query<PublicOperationRow>(
        sql`SELECT o.operation,o.accepted_at::text AS accepted_at,
                d.state,d.decided_seq,d.outcome_code,
                d.refused_head,d.refused_lifecycle_generation
           FROM operation o JOIN decision_input d
             ON d.tenant=o.tenant AND d.project=o.project
            AND d.input_kind='Operation' AND d.input_id=o.operation
          WHERE o.tenant=${partition.tenant} AND o.project=${partition.project}
            AND o.operation=${operation}`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : publicOperation(row);
    },
    project: (partition, query) => readProject(pool, partition, query),
    ticket: async (partition, ticket) => {
      const found = await pool.query<TicketProjectionRow>(
        sql`SELECT ticket,phase,seq FROM ticket_projection
          WHERE tenant=${partition.tenant} AND project=${partition.project}
            AND ticket=${ticket}`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : ticketResource(row);
    },
  };
}
