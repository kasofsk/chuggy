import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import { z } from "zod";
import { TicketId } from "../../domain/chuggernaut/task.js";
import { validate_command } from "../../domain/chuggernaut/ticket.js";
import {
  canonical_json,
  decode,
  encode,
  TICKET_COMMAND,
  TICKET_DECISION,
} from "../../interpreter/codec.ts";
import {
  ticketMachineOrigin,
  type TicketMachineInput,
} from "../../interpreter/ticketMachine.ts";
import type {
  TicketMachineInbox,
  TicketMachineQueue,
} from "../../interpreter/ticketMachineInbox.ts";
import {
  asTenantId,
  asProjectId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";
import {
  postgresOwnershipLock,
  postgresOwnershipHonours,
} from "./ownership.ts";

const refusal = z.enum([
  "InputConflict",
  "LegacyModelUnsupported",
  "ProjectNotFound",
  "ProjectNotActive",
  "Backpressure",
]);
const accepted = z.enum(["Accepted", "AlreadyAccepted", ...refusal.options]);
const authorization = z.strictObject({
  principal: z.string().min(1).max(256),
  authorizedOperation: z.string().min(1).max(256),
  authorityKind: z.string().min(1).max(256),
  authoritySubject: z.string().min(1).max(256),
  policyRevision: z.string().min(1).max(256),
});
const metadata = z.strictObject({
  stageNames: z.array(
    z.tuple([z.number().int().positive().safe(), z.string().min(1)]),
  ),
  evaluatorNames: z.array(
    z.tuple([z.number().int().positive().safe(), z.string().min(1)]),
  ),
  reworkLimit: z.number().int().nonnegative().safe().nullable(),
  source: z.number().int().positive().safe().optional(),
});

interface SubmissionRow {
  identity: string;
  origin: string;
  command: string;
  attribution: string;
  metadata: string | null;
}

function inboxInput(row: SubmissionRow): TicketMachineInput {
  const command = decode(row.command, TICKET_COMMAND);
  const origin = ticketMachineOrigin(command);
  if (row.origin !== origin)
    throw new Error("stored input origin disagrees with command");
  return {
    identity: row.identity,
    origin,
    command,
    authorization: authorization.parse(JSON.parse(row.attribution)),
    ...(row.metadata === null
      ? {}
      : { metadata: metadata.parse(JSON.parse(row.metadata)) }),
  };
}

async function inboxSubmit(
  pool: pg.Pool,
  partition: Partition,
  input: TicketMachineInput,
) {
  if (input.identity.length < 1 || input.identity.length > 256)
    throw new RangeError("invalid input identity");
  validate_command(input.command);
  if (ticketMachineOrigin(input.command) !== input.origin)
    throw new TypeError("invalid input origin");
  const attribution = canonical_json(authorization.parse(input.authorization));
  const release =
    input.metadata === undefined
      ? null
      : canonical_json(metadata.parse(input.metadata));
  const command = encode(input.command);
  let result;
  switch (input.origin) {
    case "Author":
      result = await pool.query<{ accepted: string | null }>(
        sql`SELECT accept_ticket_author_input(${partition.tenant},${partition.project},${input.identity},${command},${attribution},${release})::text AS accepted`,
      );
      break;
    case "Execution":
      result = await pool.query<{ accepted: string | null }>(
        sql`SELECT accept_ticket_execution_input(${partition.tenant},${partition.project},${input.identity},${command},${attribution},${release})::text AS accepted`,
      );
      break;
    case "Finalizer":
      result = await pool.query<{ accepted: string | null }>(
        sql`SELECT accept_ticket_finalizer_input(${partition.tenant},${partition.project},${input.identity},${command},${attribution},${release})::text AS accepted`,
      );
      break;
  }
  return { accepted: accepted.parse(result.rows[0]?.accepted) };
}

export function postgresTicketMachineInbox(pool: pg.Pool): TicketMachineInbox {
  return {
    submit: (partition, input) => inboxSubmit(pool, partition, input),
    outcome: async (partition, identity) => {
      const found = await pool.query<{
        sequence: string;
        decision: string;
      }>(sql`
        SELECT sequence::text,decision FROM ticket_machine_input WHERE tenant=${partition.tenant} AND project=${partition.project} AND identity=${identity}`);
      const row = found.rows[0];
      if (row === undefined) return undefined;
      return {
        sequence: z
          .number()
          .int()
          .positive()
          .safe()
          .parse(Number(row.sequence)),
        decision: decode(row.decision, TICKET_DECISION),
      };
    },
    reserveTicket: async (partition, identity) => {
      const found = await pool.query<{
        reserved: string | null;
        ticket: string | null;
      }>(sql`
        SELECT reserved,ticket FROM reserve_ticket_machine_identity(${partition.tenant},${partition.project},${identity})`);
      const row = found.rows[0];
      if (row?.reserved !== "Reserved")
        return { reserved: refusal.parse(row?.reserved) };
      return {
        reserved: "Reserved",
        ticket: TicketId(
          z.number().int().positive().safe().parse(Number(row.ticket)),
        ),
      };
    },
    releaseMetadata: async (partition, ticket) => {
      const found = await pool.query<{ metadata: string }>(
        sql`SELECT metadata FROM ticket_machine_release WHERE tenant=${partition.tenant} AND project=${partition.project} AND ticket=${ticket}`,
      );
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : metadata.parse(JSON.parse(row.metadata));
    },
    releaseReworkLimits: async (partition) => {
      const found = await pool.query<{ ticket: string; metadata: string }>(
        sql`SELECT ticket::text,metadata FROM ticket_machine_release WHERE tenant=${partition.tenant} AND project=${partition.project}`,
      );
      return new Map(
        found.rows.map((row) => [
          TicketId(
            z.number().int().positive().safe().parse(Number(row.ticket)),
          ),
          metadata.parse(JSON.parse(row.metadata)).reworkLimit,
        ]),
      );
    },
  };
}

export function postgresTicketMachineQueue(pool: pg.Pool): TicketMachineQueue {
  return {
    ready: async (limit, after) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
        throw new RangeError("invalid project discovery limit");
      const tenant = after?.tenant ?? "";
      const project = after?.project ?? "";
      const found = await pool.query<{ tenant: string; project: string }>(sql`
        SELECT p.tenant,p.project FROM project p WHERE p.ticket_model='Chuggernaut' AND p.lifecycle='Active'
          AND (p.tenant,p.project)>(${tenant},${project})
          AND (EXISTS(SELECT 1 FROM ticket_machine_submission s WHERE s.tenant=p.tenant AND s.project=p.project AND NOT EXISTS(
            SELECT 1 FROM ticket_machine_input i WHERE i.tenant=s.tenant AND i.project=s.project AND i.identity=s.identity))
            OR EXISTS(SELECT 1 FROM ticket_machine_obligation o WHERE o.tenant=p.tenant AND o.project=p.project AND NOT o.delivered))
        ORDER BY p.tenant,p.project LIMIT ${limit}`);
      return found.rows.map((row) => ({
        tenant: asTenantId(row.tenant),
        project: asProjectId(row.project),
      }));
    },
    next: (lease) =>
      postgresTransaction(pool, async (client) => {
        const project = await postgresOwnershipLock(client, lease.partition);
        if (
          project === undefined ||
          !(await postgresOwnershipHonours(client, project, lease))
        )
          return undefined;
        const found = await client.query<SubmissionRow>(sql`
        SELECT s.identity,s.origin,s.command,s.attribution,s.metadata FROM ticket_machine_submission s
        WHERE s.tenant=${lease.partition.tenant} AND s.project=${lease.partition.project} AND NOT EXISTS(
          SELECT 1 FROM ticket_machine_input i WHERE i.tenant=s.tenant AND i.project=s.project AND i.identity=s.identity)
        ORDER BY s.ordinal LIMIT 1`);
        const row = found.rows[0];
        return row === undefined ? undefined : inboxInput(row);
      }),
  };
}
