/** PostgreSQL projection and public-operation reads for the native web API. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  escalationReasons,
  operationRefusalCodes,
  resumePoints,
  type EscalationReason,
  type ResumePoint,
} from "../../contract/rosters.ts";
import { phaseTags, type Phase } from "../../domain/generated/modelTypes.ts";
import { nonTerminalPhaseTags } from "../../domain/phase.ts";
import { asTicketId } from "../../domain/ids.ts";
import {
  asPublicInstant,
  type NativeActionPage,
  type NativeReadStore,
  type OperationRefusalCode,
  type OperationResource,
  type ProjectRead,
  type ProjectReadQuery,
  type ProjectResource,
  type TicketAccounts,
  type TicketNativeAction,
  type TicketPhaseFilter,
  type TicketResource,
} from "../../interpreter/nativeWeb.ts";
import {
  allNativeActionKinds,
  nativeActionResolutions,
  type NativeActionKind,
  type NativeActionResolution,
} from "../../interpreter/ticketCommand.ts";
import {
  allOperationStates,
  asOperationId,
  type OperationState,
} from "../../interpreter/operationInbox.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { projectRowCounter } from "./rows.ts";
import { postgresTicketRunTotals } from "./runEvidence.ts";
import { draftBriefOf, type DraftBriefRow } from "./ticketBrief.ts";

interface PublicOperationRow {
  readonly operation: string;
  readonly accepted_at: string;
  readonly state: string;
  readonly decided_seq: string | null;
  readonly outcome_code: string | null;
  readonly refused_head: string | null;
  readonly refused_lifecycle_generation: string | null;
}

/**
 * One projection row, joined to the deployment gas every ticket is released
 * with and to the two journal entries that date it. The account columns are null
 * together on a row no decision has moved since the projection began carrying
 * them, the joined gas is null only where no domain configuration is installed,
 * and the two entries are outer joins so a page keeps a row neither is found for.
 */
interface TicketProjectionRow {
  readonly ticket: string;
  readonly phase: string;
  readonly seq: string;
  readonly reason: string;
  readonly released_at: string | null;
  readonly changed_at: string | null;
  readonly resume_at: string | null;
  readonly gas_left: string | null;
  readonly rework_left: string | null;
  readonly finalization_left: string | null;
  readonly gas_max: string | null;
}

/** One open action, or a ticket that has none: every column is then null. */
interface OpenNativeActionRow {
  readonly action: string | null;
  readonly kind: string | null;
  readonly authorizing_seq: string | null;
  readonly resolutions: (string | null)[] | null;
}

/** The same action inside a project's page, where the join names every column. */
interface ProjectNativeActionRow {
  readonly ticket: string;
  readonly action: string;
  readonly kind: string;
  readonly authorizing_seq: string;
  readonly resolutions: string[] | null;
}

function operationState(value: string): OperationState {
  if (value === "Journaled") return "Succeeded";
  const state = allOperationStates.find((candidate) => candidate === value);
  if (state === undefined)
    throw new Error(`native read: ${value} is not a public operation state`);
  return state;
}

function refusalCode(value: string): OperationRefusalCode {
  const code = operationRefusalCodes.find((candidate) => candidate === value);
  if (code === undefined)
    throw new Error(`native read: ${value} is not a public refusal code`);
  return code;
}

function requiredCounter(value: string | null, what: string): number {
  if (value === null) throw new Error(`native read: ${what} is absent`);
  return projectRowCounter(value, what);
}

function nativeReadInstant(value: string): ReturnType<typeof asPublicInstant> {
  const parsed =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)([+-]\d{2})(?::?(\d{2}))?$/u.exec(
      value,
    );
  if (parsed === null)
    throw new TypeError(
      "native read: an instant is not PostgreSQL timestamptz text",
    );
  return asPublicInstant(
    `${parsed[1]}T${parsed[2]}${parsed[3]}:${parsed[4] ?? "00"}`,
  );
}

/** Maps the private storage row onto the deliberately smaller public resource. */
export function publicOperation(row: PublicOperationRow): OperationResource {
  const base = {
    operation: asOperationId(row.operation),
    acceptedAt: nativeReadInstant(row.accepted_at),
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
    tickets: page.map(ticketResource),
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

/** The stored `NoReason` is the machine's absent value, which the wire omits. */
function projectionReason(value: string): EscalationReason | undefined {
  if (value === "NoReason") return undefined;
  const reason = escalationReasons.find((candidate) => candidate === value);
  if (reason === undefined)
    throw new Error(`native read: ${value} is not an escalation reason`);
  return reason;
}

/**
 * When the ticket last moved. The row and the entry its sequence names are
 * written in one transaction, so an absent one is a journal this read cannot
 * believe rather than a ticket that has no such time.
 */
function ticketResourceChangedAt(
  value: string | null,
): ReturnType<typeof asPublicInstant> {
  if (value === null)
    throw new Error("native read: the journal dates no change for a ticket");
  return nativeReadInstant(value);
}

/** The stored `NoResume` is the machine's absent value, which the wire omits. */
function projectionResume(value: string | null): ResumePoint | undefined {
  if (value === null || value === "NoResume") return undefined;
  const point = resumePoints.find((candidate) => candidate === value);
  if (point === undefined)
    throw new Error(`native read: ${value} is not a resume point`);
  return point;
}

/**
 * What a ticket has left to spend, or nothing when the row predates the
 * projection carrying it. A null finalization account is the `DeadlineOnly`
 * pricing that budgets none, which a non-null `gas_left` tells apart from a row
 * holding no accounts at all.
 */
function projectionAccounts(
  row: TicketProjectionRow,
): TicketAccounts | undefined {
  if (row.gas_left === null || row.rework_left === null) return undefined;
  if (row.gas_max === null)
    throw new Error(
      "native read: a ticket holds accounts but the deployment declares no gas",
    );
  return {
    gasLeft: projectRowCounter(row.gas_left, "ticket gas left"),
    gasMax: projectRowCounter(row.gas_max, "deployment gas"),
    reworkLeft: projectRowCounter(row.rework_left, "ticket rework left"),
    ...(row.finalization_left === null
      ? {}
      : {
          finalizationLeft: projectRowCounter(
            row.finalization_left,
            "ticket finalization left",
          ),
        }),
  };
}

function ticketResource(row: TicketProjectionRow): TicketResource {
  const reason = projectionReason(row.reason);
  const resumeAt = projectionResume(row.resume_at);
  const accounts = projectionAccounts(row);
  return {
    ticket: asTicketId(projectRowCounter(row.ticket, "ticket identity")),
    phase: projectionPhase(row.phase),
    sequence: projectRowCounter(row.seq, "ticket projection sequence"),
    changedAt: ticketResourceChangedAt(row.changed_at),
    ...(row.released_at === null
      ? {}
      : { releasedAt: nativeReadInstant(row.released_at) }),
    ...(reason === undefined ? {} : { reason }),
    ...(resumeAt === undefined ? {} : { resumeAt }),
    ...(accounts === undefined ? {} : { accounts }),
  };
}

function nativeActionKind(value: string): NativeActionKind {
  const kind = allNativeActionKinds.find((candidate) => candidate === value);
  if (kind === undefined)
    throw new Error(`native read: ${value} is not a native action kind`);
  return kind;
}

/**
 * The answers one open action offered, in the order its kind declares them. A
 * stored answer that kind never asks for means this layer and the database
 * disagree about the pairing, so it raises rather than being quietly dropped.
 */
function nativeActionAdmits(
  kind: NativeActionKind,
  stored: readonly (string | null)[],
): readonly NativeActionResolution[] {
  const admits = nativeActionResolutions[kind].filter((resolution) =>
    stored.includes(resolution),
  );
  if (admits.length !== stored.length)
    throw new Error(
      `native read: a ${kind} offers an answer it cannot ask for`,
    );
  return admits;
}

function openNativeAction(row: OpenNativeActionRow): TicketNativeAction {
  if (
    row.action === null ||
    row.kind === null ||
    row.authorizing_seq === null ||
    row.resolutions === null
  )
    throw new Error("native read: an open action is missing its fence");
  const kind = nativeActionKind(row.kind);
  return {
    action: row.action,
    kind,
    authorizingSequence: projectRowCounter(
      row.authorizing_seq,
      "native action authorizing sequence",
    ),
    admits: nativeActionAdmits(kind, row.resolutions),
  };
}

/** One page of a project's open actions, and where the next one resumes. */
function nativeActionPage(
  rows: readonly ProjectNativeActionRow[],
  limit: number,
): NativeActionPage {
  const listed = rows.slice(0, limit).map((row) => ({
    ticket: asTicketId(projectRowCounter(row.ticket, "native action ticket")),
    ...openNativeAction(row),
  }));
  const next = rows.length > limit ? listed.at(-1) : undefined;
  return {
    actions: listed,
    ...(next === undefined
      ? {}
      : {
          nextAfter: {
            authorizingSequence: next.authorizingSequence,
            action: next.action,
          },
        }),
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
      sql`SELECT t.ticket,t.phase,t.seq,t.reason,t.resume_at,t.gas_left,
                 t.rework_left,t.finalization_left,
                 d.domain_configuration::jsonb->>'gas' AS gas_max,
                 r.committed_at::text AS released_at,
                 c.committed_at::text AS changed_at
          FROM ticket_projection t
          LEFT JOIN deployment_authoring_policy d ON d.singleton=true
          LEFT JOIN journal_entry c
            ON c.tenant=t.tenant AND c.project=t.project AND c.seq=t.seq
          LEFT JOIN LATERAL (
            SELECT j.committed_at FROM journal_entry j
             WHERE j.tenant=t.tenant AND j.project=t.project
               AND (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->>'type' END)='ReleaseTicket'
               AND (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->'value'->'ticket' END)=to_jsonb(t.ticket)
             ORDER BY j.seq LIMIT 1) r ON true
        WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
          AND (${query.recentActivityAfter?.sequence ?? null}::bigint IS NULL
            OR (t.seq,t.ticket) < (${query.recentActivityAfter?.sequence ?? null},${query.recentActivityAfter?.ticket ?? null}))
          AND t.phase = ANY(${[...selectedPhases(query.phaseFilter)]}::text[])
        ORDER BY t.seq DESC,t.ticket DESC LIMIT ${query.limit + 1}`,
    );
    return found.rows;
  }
  const found = await client.query<TicketProjectionRow>(
    sql`SELECT t.ticket,t.phase,t.seq,t.reason,t.resume_at,t.gas_left,
               t.rework_left,t.finalization_left,
               d.domain_configuration::jsonb->>'gas' AS gas_max,
               r.committed_at::text AS released_at,
               c.committed_at::text AS changed_at
          FROM ticket_projection t
          LEFT JOIN deployment_authoring_policy d ON d.singleton=true
          LEFT JOIN journal_entry c
            ON c.tenant=t.tenant AND c.project=t.project AND c.seq=t.seq
          LEFT JOIN LATERAL (
            SELECT j.committed_at FROM journal_entry j
             WHERE j.tenant=t.tenant AND j.project=t.project
               AND (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->>'type' END)='ReleaseTicket'
               AND (CASE WHEN j.entry IS JSON OBJECT
                         THEN j.entry::jsonb->'event'->'value'->'ticket' END)=to_jsonb(t.ticket)
             ORDER BY j.seq LIMIT 1) r ON true
        WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
          AND t.ticket>${query.after ?? 0}
          AND t.phase = ANY(${[...selectedPhases(query.phaseFilter)]}::text[])
        ORDER BY t.ticket LIMIT ${query.limit + 1}`,
  );
  return found.rows;
}

/** The three resource reads, each answering one route from the projection. */
function nativeReadsResources(
  pool: pg.Pool,
): Pick<NativeReadStore, "operation" | "project" | "ticket"> {
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
      const found = await pool.query<TicketProjectionRow & DraftBriefRow>(
        sql`SELECT t.ticket,t.phase,t.seq,t.reason,t.resume_at,t.gas_left,
                   t.rework_left,t.finalization_left,
                   d.domain_configuration::jsonb->>'gas' AS gas_max,
                   b.intent,b.branch,
                   b.finalization_mode,b.finalization_target,
                   r.committed_at::text AS released_at,
                   c.committed_at::text AS changed_at,
                   (SELECT array_agg(k.url ORDER BY k.ordinal) FROM draft_brief_link k
                     WHERE k.tenant=t.tenant AND k.project=t.project AND k.ticket=t.ticket) AS links
              FROM ticket_projection t
              LEFT JOIN deployment_authoring_policy d ON d.singleton=true
              LEFT JOIN journal_entry c
                ON c.tenant=t.tenant AND c.project=t.project AND c.seq=t.seq
              LEFT JOIN LATERAL (
                SELECT j.committed_at FROM journal_entry j
                 WHERE j.tenant=t.tenant AND j.project=t.project
                   AND (CASE WHEN j.entry IS JSON OBJECT
                             THEN j.entry::jsonb->'event'->>'type' END)='ReleaseTicket'
                   AND (CASE WHEN j.entry IS JSON OBJECT
                             THEN j.entry::jsonb->'event'->'value'->'ticket' END)=to_jsonb(t.ticket)
                 ORDER BY j.seq LIMIT 1) r ON true
              LEFT JOIN draft_brief b
                ON b.tenant=t.tenant AND b.project=t.project AND b.ticket=t.ticket
             WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
               AND t.ticket=${ticket}`,
      );
      const row = found.rows[0];
      if (row === undefined) return undefined;
      const brief = draftBriefOf(row);
      const runTotals = await postgresTicketRunTotals(pool, partition, ticket);
      return {
        ...ticketResource(row),
        ...(brief === undefined ? {} : { brief }),
        ...(runTotals === undefined ? {} : { runTotals }),
      };
    },
  };
}

/** The two desk reads, which are the open native actions a ticket and a project carry. */
function nativeReadsActions(
  pool: pg.Pool,
): Pick<NativeReadStore, "ticketNativeActions" | "nativeActions"> {
  return {
    ticketNativeActions: async (partition, ticket) => {
      const found = await pool.query<OpenNativeActionRow>(
        sql`SELECT a.action,a.kind,a.authorizing_seq::text AS authorizing_seq,
                array_agg(r.resolution) FILTER (WHERE r.resolution IS NOT NULL)
                  AS resolutions
           FROM ticket_projection t
           LEFT JOIN native_action a
             ON a.tenant=t.tenant AND a.project=t.project
            AND a.ticket=t.ticket AND a.state='Open'
           LEFT JOIN native_action_resolution r
             ON r.tenant=a.tenant AND r.project=a.project AND r.action=a.action
          WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
            AND t.ticket=${ticket}
          GROUP BY a.action,a.kind,a.authorizing_seq
          ORDER BY a.action`,
      );
      if (found.rows.length === 0) return undefined;
      return found.rows
        .filter((row) => row.action !== null)
        .map(openNativeAction);
    },
    nativeActions: async (partition, query) => {
      const found = await pool.query<ProjectNativeActionRow>(
        sql`SELECT a.ticket::text AS ticket,a.action,a.kind,
                a.authorizing_seq::text AS authorizing_seq,
                array_agg(r.resolution) AS resolutions
           FROM native_action a
           JOIN native_action_resolution r
             ON r.tenant=a.tenant AND r.project=a.project AND r.action=a.action
          WHERE a.tenant=${partition.tenant} AND a.project=${partition.project}
            AND a.state='Open'
            AND (${query.after?.authorizingSequence ?? null}::bigint IS NULL
              OR (a.authorizing_seq,a.action) <
                 (${query.after?.authorizingSequence ?? null},${query.after?.action ?? null}))
          GROUP BY a.ticket,a.action,a.kind,a.authorizing_seq
          ORDER BY a.authorizing_seq DESC,a.action DESC
          LIMIT ${query.limit + 1}`,
      );
      return nativeActionPage(found.rows, query.limit);
    },
  };
}

/** Reads only API-safe columns through a pool carrying the API credential. */
export function postgresNativeReads(pool: pg.Pool): NativeReadStore {
  return { ...nativeReadsResources(pool), ...nativeReadsActions(pool) };
}
