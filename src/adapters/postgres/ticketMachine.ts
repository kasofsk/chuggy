import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import * as ticket from "../../domain/chuggernaut/ticket.js";
import {
  decode,
  encode,
  canonical_json,
  OBLIGATION,
  TICKET_DECISION,
} from "../../interpreter/codec.ts";
import type { Lease, Partition } from "../../interpreter/projectStore.ts";
import type {
  TicketMachineInput,
  TicketMachineProcessed,
  TicketMachineStore,
} from "../../interpreter/ticketMachine.ts";
import { postgresTransaction } from "./pool.ts";
import {
  postgresOwnershipHonours,
  postgresOwnershipLock,
} from "./ownership.ts";
import {
  ticketMachineEmpty,
  ticketMachineReplay,
  type TicketMachineState,
} from "../../interpreter/ticketMachineReplay.ts";

interface MachineEvent {
  readonly decision: string;
  readonly sequence: string;
}
interface MachineInput {
  readonly command: string;
  readonly origin: string;
  readonly decision: string;
  readonly sequence: string;
  readonly attribution: string;
  readonly metadata: string | null;
}

function machineSequence(value: string): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0)
    throw new Error("invalid ticket sequence");
  return sequence;
}

async function machineProject(
  client: pg.PoolClient,
  partition: Partition,
): Promise<
  | Exclude<
      TicketMachineProcessed,
      { processed: "Committed" | "AlreadyCommitted" }
    >
  | undefined
> {
  const found = await client.query<{ ticket_model: string; lifecycle: string }>(
    sql`SELECT ticket_model,lifecycle FROM project WHERE tenant=${partition.tenant} AND project=${partition.project} FOR UPDATE`,
  );
  const row = found.rows[0];
  if (row === undefined) return { processed: "ProjectNotFound" };
  if (row.ticket_model !== "Chuggernaut")
    return { processed: "LegacyModelUnsupported" };
  if (row.lifecycle !== "Active") return { processed: "ProjectNotActive" };
  return undefined;
}

/**
 * The whole journal, replayed from empty into the graph it decides against.
 *
 * THE PAGE IS ORDERED BY THE TABLE'S COLUMN AND NOT BY THE OUTPUT'S.
 * `sequence::text` names an output column `sequence`, and SQL resolves an
 * unqualified `ORDER BY` against output names before table columns — so the
 * bare name sorts the text, and a page arrives 1, 10, 2, 3. Replay requires
 * each entry to be the last plus one, which makes such a journal contiguous
 * up to its ninth input and unreadable from its tenth, for good. The
 * qualified name can only be the column, and the suite drives eleven inputs
 * because ten is the first one that disagrees.
 */
async function machineLoad(
  client: pg.PoolClient,
  partition: Partition,
): Promise<TicketMachineState> {
  const found = await client.query<{ sequence: string }>(
    sql`SELECT COALESCE(MAX(sequence),0)::text AS sequence FROM ticket_machine_input WHERE tenant=${partition.tenant} AND project=${partition.project}`,
  );
  const head = machineSequence(found.rows[0]?.sequence ?? "0");
  let state = ticketMachineEmpty();
  const pageSize = 256;
  const pages = Math.ceil(head / pageSize);
  for (let page = 0; page < pages; page += 1) {
    const events = await client.query<MachineEvent>(
      sql`SELECT sequence::text,decision FROM ticket_machine_input WHERE tenant=${partition.tenant} AND project=${partition.project} AND sequence>${state.sequence} AND sequence<=${head} ORDER BY ticket_machine_input.sequence LIMIT ${pageSize}`,
    );
    if (events.rows.length === 0)
      throw new Error("ticket history is incomplete");
    state = ticketMachineReplay(
      state,
      events.rows.map((row) => ({
        sequence: machineSequence(row.sequence),
        decision: decode(row.decision, TICKET_DECISION),
      })),
    );
  }
  if (state.sequence !== head) throw new Error("ticket history is incomplete");
  return state;
}

async function machinePrior(
  client: pg.PoolClient,
  partition: Partition,
  input: TicketMachineInput,
): Promise<TicketMachineProcessed | undefined> {
  const found = await client.query<MachineInput>(
    sql`SELECT command,origin,decision,sequence::text,attribution,metadata FROM ticket_machine_input WHERE tenant=${partition.tenant} AND project=${partition.project} AND identity=${input.identity}`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  if (
    row.command !== encode(input.command) ||
    row.origin !== input.origin ||
    row.attribution !== canonical_json(input.authorization) ||
    row.metadata !==
      (input.metadata === undefined ? null : canonical_json(input.metadata))
  )
    return { processed: "InputConflict" };
  return {
    processed: "AlreadyCommitted",
    outcome: {
      sequence: machineSequence(row.sequence),
      decision: decode(row.decision, TICKET_DECISION),
    },
  };
}

async function machineRecord(
  client: pg.PoolClient,
  partition: Partition,
  input: TicketMachineInput,
  sequence: number,
  decision: ticket.TicketDecision,
): Promise<void> {
  if (input.authorization === undefined)
    throw new TypeError("input requires authorization attribution");
  const authorization = canonical_json(input.authorization);
  const metadata =
    input.metadata === undefined ? null : canonical_json(input.metadata);
  await client.query(sql`INSERT INTO ticket_machine_input(tenant,project,identity,origin,command,attribution,metadata,decision,sequence)
    VALUES(${partition.tenant},${partition.project},${input.identity},${String(input.origin)},${encode(input.command)},${authorization},${metadata},${encode(decision)},${sequence})`);
  if (decision.kind === "TicketRefused") return;
  if (
    metadata !== null &&
    (input.command.kind === "CreateTicket" ||
      input.command.kind === "UpdateTicket")
  ) {
    const identity = input.command.definition.id;
    await client.query(sql`INSERT INTO ticket_machine_release(tenant,project,ticket,metadata)
      VALUES(${partition.tenant},${partition.project},${identity},${metadata})
      ON CONFLICT(tenant,project,ticket) DO UPDATE SET metadata=jsonb_set(EXCLUDED.metadata::jsonb, '{reworkLimit}', ticket_machine_release.metadata::jsonb->'reworkLimit')::text`);
  }
  await client.query(sql`INSERT INTO ticket_machine_event(tenant,project,sequence,input_identity,event)
    VALUES(${partition.tenant},${partition.project},${sequence},${input.identity},${encode(decision.event)})`);
  for (const [position, obligation] of decision.obligations.entries()) {
    const identity = `${String(sequence)}:${String(position)}`;
    await client.query(sql`INSERT INTO ticket_machine_obligation(tenant,project,identity,sequence,position,obligation)
      VALUES(${partition.tenant},${partition.project},${identity},${sequence},${position},${encode(obligation)})`);
  }
}

async function machineCurrent(
  client: pg.PoolClient,
  partition: Partition,
  input: TicketMachineInput,
): Promise<TicketMachineProcessed | undefined> {
  const found = await client.query<{
    identity: string;
    command: string;
    origin: string;
    attribution: string;
    metadata: string | null;
  }>(sql`
    SELECT s.identity,s.command,s.origin,s.attribution,s.metadata FROM ticket_machine_submission s
    WHERE s.tenant=${partition.tenant} AND s.project=${partition.project} AND NOT EXISTS(
      SELECT 1 FROM ticket_machine_input i WHERE i.tenant=s.tenant AND i.project=s.project AND i.identity=s.identity)
    ORDER BY s.ordinal LIMIT 1`);
  const row = found.rows[0];
  if (row === undefined) return { processed: "InputNotAccepted" };
  if (row.identity !== input.identity) return { processed: "NotNext" };
  if (
    row.command !== encode(input.command) ||
    row.origin !== input.origin ||
    row.attribution !== canonical_json(input.authorization) ||
    row.metadata !==
      (input.metadata === undefined ? null : canonical_json(input.metadata))
  )
    return { processed: "InputConflict" };
  return undefined;
}

async function machineProcess(
  client: pg.PoolClient,
  lease: Lease,
  input: TicketMachineInput,
  decide: (graph: ticket.TicketGraph) => ticket.TicketDecision,
): Promise<TicketMachineProcessed> {
  const partition = lease.partition;
  const unavailable = await machineProject(client, partition);
  if (unavailable !== undefined) return unavailable;
  const project = await postgresOwnershipLock(client, partition);
  if (
    project === undefined ||
    !(await postgresOwnershipHonours(client, project, lease))
  )
    return { processed: "Fenced" };
  const prior = await machinePrior(client, partition, input);
  if (prior !== undefined) return prior;
  const current = await machineCurrent(client, partition, input);
  if (current !== undefined) return current;
  const state = await machineLoad(client, partition);
  const decision = decide(state.graph);
  const sequence = state.sequence + 1;
  if (!Number.isSafeInteger(sequence))
    throw new Error("ticket sequence exhausted");
  if (decision.kind === "TicketDecided") {
    ticket.evolve_checked(state.graph, decision.event);
  }
  await machineRecord(client, partition, input, sequence, decision);
  return { processed: "Committed", outcome: { sequence, decision } };
}

/** The project row serializes all ticket decisions, including duplicate-input checks. */
export function postgresTicketMachine(pool: pg.Pool): TicketMachineStore {
  return {
    process: (lease, input, decide) =>
      postgresTransaction(pool, (client) =>
        machineProcess(client, lease, input, decide),
      ),
    read: (partition) =>
      postgresTransaction(pool, async (client) => {
        const project = await client.query<{ ticket_model: string }>(sql`
          SELECT ticket_model FROM project WHERE tenant=${partition.tenant} AND project=${partition.project}`);
        if (project.rows[0] === undefined) return undefined;
        if (project.rows[0].ticket_model !== "Chuggernaut")
          return "LegacyModelUnsupported";
        return (await machineLoad(client, partition)).graph;
      }),
    pending: async (partition, limit) => {
      const found = await pool.query<{
        identity: string;
        sequence: string;
        position: number;
        obligation: string;
      }>(sql`
        SELECT identity,sequence::text,position,obligation FROM ticket_machine_obligation
        WHERE tenant=${partition.tenant} AND project=${partition.project} AND NOT delivered
        ORDER BY sequence,position LIMIT ${limit}`);
      return found.rows.map((row) => ({
        identity: row.identity,
        sequence: machineSequence(row.sequence),
        position: row.position,
        obligation: decode(row.obligation, OBLIGATION),
      }));
    },
    delivered: async (partition, identity) => {
      await pool.query(
        sql`UPDATE ticket_machine_obligation SET delivered=true WHERE tenant=${partition.tenant} AND project=${partition.project} AND identity=${identity}`,
      );
    },
  };
}
