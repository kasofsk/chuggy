/**
 * The lead's refusal ledger as PostgreSQL answers it: one write door for the
 * selector's own role and two reads for the API's, each a `SECURITY DEFINER`
 * function 059 declares. Every port here is
 * `src/interpreter/agenticRefusal.ts`'s and this module declares none of its own.
 *
 * THE WRITE AND THE READS STAND ON DIFFERENT POOLS. `record_agentic_refusals`
 * is granted to the selector service and the two reads to the API, so a caller
 * that holds one credential cannot reach the other's door. Handing both to one
 * pool here would make that separation a comment rather than a grant.
 *
 * STANDING IS NOT SELECTED, IT IS ANSWERED. Which tickets currently stand
 * refused is the latest row per ticket, and the server is where that is
 * decided: a predicate written here would run as a role holding no privilege
 * on the relation, and a fold written here would page the whole ledger to
 * learn one fact per ticket.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asTicketId } from "../../domain/ids.ts";
import {
  allAgenticRefusalEvents,
  type AgenticRefusalEntry,
  type AgenticRefusalRead,
  type AgenticRefusalRecord,
  type AgenticRefusalWrite,
} from "../../interpreter/agenticRefusal.ts";
import { projectRowCounter } from "./rows.ts";
import { sessionRowMember, sessionRowText } from "./sessionRows.ts";

/** One standing refusal, as either read of it hands the row back. */
interface StandingRefusalRow {
  readonly ticket: string | null;
  readonly ticket_version: string | null;
  readonly reason: string | null;
  readonly selector_decision: string | null;
  readonly recorded_at: Date | null;
}

/** One ledger entry, which is a standing row plus what the entry was and where it sits. */
interface RefusalLedgerRow extends Omit<StandingRefusalRow, "ticket"> {
  readonly ordinal: string | null;
  readonly event: string | null;
}

function refusalInstant(value: Date | null): string {
  if (value === null)
    throw new Error("agentic refusal row: the recorded instant is null");
  return value.toISOString();
}

function standingRefusalOf(row: StandingRefusalRow): AgenticRefusalRecord {
  return {
    ticket: asTicketId(
      projectRowCounter(
        sessionRowText(row.ticket, "ticket"),
        "agentic refusal ticket",
      ),
    ),
    ticketVersion: projectRowCounter(
      sessionRowText(row.ticket_version, "ticket version"),
      "agentic refusal ticket version",
    ),
    reason: sessionRowText(row.reason, "reason"),
    decision: sessionRowText(row.selector_decision, "decision"),
    recordedAt: refusalInstant(row.recorded_at),
  };
}

/** The write door, over the pool that holds the selector service's own role. */
export function postgresAgenticRefusalWrites(
  pool: pg.Pool,
): AgenticRefusalWrite {
  return {
    record: async (input) => {
      const recorded = await pool.query<{ recorded: string | null }>(
        sql`SELECT record_agentic_refusals(
          ${input.partition.tenant},${input.partition.project},${input.decision},
          ${JSON.stringify(
            input.refusals.map((refusal) => ({
              ticket: refusal.ticket,
              ticketVersion: refusal.ticketVersion,
              reason: refusal.reason,
            })),
          )}::jsonb,
          ${JSON.stringify(
            input.lifts.map((lift) => ({ ticket: lift.ticket })),
          )}::jsonb)::text AS recorded`,
      );
      const answer = recorded.rows[0]?.recorded;
      if (answer !== "Recorded" && answer !== "AlreadyRecorded")
        throw new Error(
          `postgres agentic refusals: recording answered ${String(answer)}`,
        );
      return answer;
    },
  };
}

/**
 * The one read the selector's own role holds: which tickets stand refused, so
 * a decision can be shown what it has already declined. The ledger is not part
 * of it — a whole ticket's history is what a person reads, and the role that
 * decides needs the standing and nothing else.
 */
export function postgresAgenticRefusalStanding(
  pool: pg.Pool,
): Pick<AgenticRefusalRead, "standing"> {
  return {
    standing: async (partition, limit) => {
      const found = await pool.query<StandingRefusalRow>(
        sql`SELECT ticket::text AS ticket,ticket_version::text AS ticket_version,
                   reason,selector_decision,recorded_at
              FROM standing_agentic_refusals(
                     ${partition.tenant},${partition.project},${limit})`,
      );
      return found.rows.map(standingRefusalOf);
    },
  };
}

/**
 * Both reads the API has onto the ledger. The selector's own standing read is
 * a different grant on a different body, so a widening of one is not a
 * widening of the other.
 */
export function postgresAgenticRefusalReads(pool: pg.Pool): AgenticRefusalRead {
  return {
    standing: async (partition, limit) => {
      const found = await pool.query<StandingRefusalRow>(
        sql`SELECT ticket::text AS ticket,ticket_version::text AS ticket_version,
                   reason,selector_decision,recorded_at
              FROM read_standing_agentic_refusals(
                     ${partition.tenant},${partition.project},${limit})`,
      );
      return found.rows.map(standingRefusalOf);
    },

    ledger: async (partition, ticket, limit) => {
      const found = await pool.query<RefusalLedgerRow>(
        sql`SELECT ordinal::text AS ordinal,event,
                   ticket_version::text AS ticket_version,reason,
                   selector_decision,recorded_at
              FROM read_agentic_refusals(
                     ${partition.tenant},${partition.project},${ticket},${limit})`,
      );
      return found.rows.map((row): AgenticRefusalEntry => ({
        ordinal: projectRowCounter(
          sessionRowText(row.ordinal, "ordinal"),
          "agentic refusal ordinal",
        ),
        partition,
        ticket,
        event: sessionRowMember(
          allAgenticRefusalEvents,
          row.event,
          "agentic refusal event",
        ),
        ticketVersion: projectRowCounter(
          sessionRowText(row.ticket_version, "ticket version"),
          "agentic refusal ticket version",
        ),
        reason: sessionRowText(row.reason, "reason"),
        decision: sessionRowText(row.selector_decision, "decision"),
        recordedAt: refusalInstant(row.recorded_at),
      }));
    },
  };
}
