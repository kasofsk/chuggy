/**
 * The lead's refusal ledger as PostgreSQL answers it, every port
 * `src/interpreter/agenticRefusal.ts`'s and none declared here. Each door is a
 * `SECURITY DEFINER` function 059 declares, but the ticket-set read, which is
 * 073's.
 *
 * THE SELECTOR'S POOL AND THE API'S OPEN DIFFERENT DOORS.
 * `postgresAgenticRefusalLedger` and `postgresAgenticRefusalStanding` run on the
 * selector service's pool and reach `record_agentic_refusals` and
 * `standing_agentic_refusals_among`; `postgresAgenticRefusalReads` runs on the
 * API's and reaches `read_standing_agentic_refusals` and
 * `read_agentic_refusals`. Neither role is granted the other's, so handing both
 * to one pool here would make that separation a comment rather than a grant.
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
  type AgenticRefusalSelectorRead,
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

/**
 * The ledger door the selector runtime holds, over the pool carrying the
 * service's own role: the one write, and the standing read its observations are
 * built against.
 */
export function postgresAgenticRefusalLedger(
  pool: pg.Pool,
): AgenticRefusalWrite {
  return {
    ...postgresAgenticRefusalStanding(pool),
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
 * The one read the selector's own role holds: which of a named set of tickets
 * stand refused. The ledger is not part of it — a whole ticket's history is what
 * a person reads, and the role that decides needs the standing and nothing else.
 */
export function postgresAgenticRefusalStanding(
  pool: pg.Pool,
): AgenticRefusalSelectorRead {
  return {
    standingAmong: async (partition, tickets) => {
      const found = await pool.query<StandingRefusalRow>(
        sql`SELECT ticket::text AS ticket,ticket_version::text AS ticket_version,
                   reason,selector_decision,recorded_at
              FROM standing_agentic_refusals_among(
                     ${partition.tenant},${partition.project},
                     ${[...tickets]}::bigint[])`,
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
