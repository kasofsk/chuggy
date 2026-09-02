/**
 * The four doors the selector's own role has onto one project's lead mailbox.
 * Every port here is `src/interpreter/leadMailbox.ts`'s; this module says how
 * PostgreSQL answers them and declares nothing of its own.
 *
 * EVERY DOOR NAMES A PROJECT AND NEVER A SESSION. The bodies 059 grants this
 * role resolve the project's `Lead` session themselves, so a compromised
 * selector cannot put a turn in a member's thread or read one — which the
 * generic `enqueue_session_turn` would let it do, and which is why that one is
 * not granted here.
 *
 * A TURN'S IDENTITY IS THE DECISION'S, so `offer` is idempotent without this
 * file doing anything: a retry of one decision finds the turn it already
 * enqueued and is answered `AlreadyEnqueued`.
 *
 * READING AND WITHDRAWING NAME THE TURN AND NOT THE PROJECT. A turn identity
 * is never reused, and a process that restarted holds the decision reference
 * with no partition beside it — which is exactly the case reconciliation is
 * for. The partition the port passes is therefore not consulted, and the
 * doors stay bounded because each joins to a `Lead` session.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allSessionStates,
  allSessionTurnFailures,
  allSessionTurnStates,
  asSessionId,
} from "../../interpreter/agentSession.ts";
import type {
  LeadMailbox,
  LeadSessionStanding,
  LeadTurnStanding,
  LeadTurnWithdrawn,
} from "../../interpreter/leadMailbox.ts";
import { projectRowCounter } from "./rows.ts";
import {
  sessionRowMember,
  sessionRowText,
  sessionTurnMeasuredOf,
  type SessionTurnMeasureRow,
} from "./sessionRows.ts";

/** One `lead_session` row, whose columns are nullable to the checker because the body may answer nothing. */
interface LeadSessionRow {
  readonly session: string | null;
  readonly state: string | null;
  readonly agent_reference: string | null;
}

/** One `read_lead_turn` row: where the turn stands and everything it has produced. */
interface LeadTurnRow extends SessionTurnMeasureRow {
  readonly state: string | null;
  readonly result: string | null;
  readonly failure: string | null;
}

/** The arms the mailbox holds an ordinal for, and the arms it does not. */
const offeredWithOrdinal = ["Enqueued", "AlreadyEnqueued"] as const;
const offeredWithoutOrdinal = ["NoLead", "Closed", "Backlogged"] as const;

const withdrawnArms: readonly LeadTurnWithdrawn[] = [
  "Withdrawn",
  "AlreadyEnded",
  "NoTurn",
];

/** Narrows one door's verdict to the arms it declares, refusing anything else. */
function leadVerdict<Arm extends string>(
  arms: readonly Arm[],
  value: string | null | undefined,
  what: string,
): Arm {
  const found = arms.find((arm) => arm === value);
  if (found === undefined)
    throw new Error(`postgres lead mailbox: ${what} answered ${String(value)}`);
  return found;
}

function leadSessionOf(row: LeadSessionRow): LeadSessionStanding {
  return {
    session: asSessionId(sessionRowText(row.session, "session")),
    state: sessionRowMember(allSessionStates, row.state, "session state"),
    ...(row.agent_reference === null
      ? {}
      : { agentReference: row.agent_reference }),
  };
}

/** What a turn has produced, with the measurement present only where the pod took one. */
function leadTurnOf(row: LeadTurnRow): LeadTurnStanding {
  const measured = sessionTurnMeasuredOf(row);
  return {
    state: sessionRowMember(allSessionTurnStates, row.state, "turn state"),
    ...(row.result === null ? {} : { result: row.result }),
    ...(row.failure === null
      ? {}
      : {
          failure: sessionRowMember(
            allSessionTurnFailures,
            row.failure,
            "turn failure",
          ),
        }),
    ...(measured === undefined ? {} : { measured }),
  };
}

/** The lead's mailbox over the pool that holds the selector service's own role. */
export function postgresLeadMailbox(pool: pg.Pool): LeadMailbox {
  return {
    lead: async (partition) => {
      const found = await pool.query<LeadSessionRow>(
        sql`SELECT session,state,agent_reference
              FROM lead_session(${partition.tenant},${partition.project})`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : leadSessionOf(row);
    },

    offer: async (input) => {
      const offered = await pool.query<{
        enqueued: string | null;
        ordinal: string | null;
      }>(
        sql`SELECT enqueued,ordinal::text AS ordinal
              FROM enqueue_lead_turn(
                ${input.partition.tenant},${input.partition.project},
                ${input.turn},${input.input})`,
      );
      const row = offered.rows[0];
      if (row?.ordinal !== null && row?.ordinal !== undefined)
        return {
          offered: leadVerdict(
            offeredWithOrdinal,
            row.enqueued,
            "offering a turn",
          ),
          ordinal: projectRowCounter(row.ordinal, "lead turn ordinal"),
        };
      return {
        offered: leadVerdict(
          offeredWithoutOrdinal,
          row?.enqueued,
          "offering a turn",
        ),
      };
    },

    turn: async (_partition, turn) => {
      const found = await pool.query<LeadTurnRow>(
        sql`SELECT state,result,failure,model,tokens::text AS tokens,
                   cost_micros::text AS cost_micros,
                   duration_ms::text AS duration_ms,tools
              FROM read_lead_turn(${turn})`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : leadTurnOf(row);
    },

    withdraw: async (_partition, turn) => {
      const withdrawn = await pool.query<{ withdrawn: string | null }>(
        sql`SELECT withdraw_lead_turn(${turn})::text AS withdrawn`,
      );
      return leadVerdict(
        withdrawnArms,
        withdrawn.rows[0]?.withdrawn,
        "withdrawing a turn",
      );
    },
  };
}
