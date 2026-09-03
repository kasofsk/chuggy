/**
 * An inquiry against a lead over the API's own pool: the listing, one inquiry,
 * and the door that forks one.
 *
 * THIS FILE DECIDES NOTHING. `open_lead_inquiry` takes no roster, no account
 * and no credential slot, so neither what a fork may do nor where it runs is
 * this adapter's to choose; the two identities arrive from the caller because
 * they are the idempotency, and the question arrives already composed because a
 * turn's input is a document the interpreter writes and this file does not read.
 *
 * IT IS ITS OWN MODULE AND NOT PART OF THE LEAD'S READS. `leadReads.ts` answers
 * the lead's own page — its standing, its mailbox tail and the decisions behind
 * it — and every one of those is keyed on the lead session. An inquiry is keyed
 * on its own session and joined to the lead as a parent, so folding the three
 * definers in there would put two subjects behind one factory and one pool's
 * worth of shape.
 *
 * THE BOUND IS THE CALLER'S ARGUMENT. The page limit arrives from
 * `src/contract/http.ts` through the interpreter that checked it and the
 * definer caps what it is asked for; restating a ceiling here would be a second
 * bound to keep in step with the first.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allSessionStates,
  allSessionTurnFailures,
  allSessionTurnStates,
  asSessionId,
  asSessionTurnId,
  type SessionId,
  type SessionTurnId,
} from "../../interpreter/agentSession.ts";
import type {
  LeadInquiryOpened,
  LeadInquiryRecord,
  LeadInquiryStore,
} from "../../interpreter/leadInquiry.ts";
import { asPrincipal, type Principal } from "../../interpreter/principal.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { asPublicInstant } from "../../interpreter/publicResource.ts";
import { projectRowCounter } from "./rows.ts";
import {
  sessionRowMember,
  sessionRowText,
  sessionTurnMeasuredOf,
  type SessionTurnMeasureRow,
} from "./sessionRows.ts";

/**
 * One row of either inquiry read. Both definers answer one shape, because a
 * listing entry and one inquiry carry the same facts and a second shape would
 * be a second place a column is added to.
 */
interface LeadInquiryRow extends SessionTurnMeasureRow {
  readonly session: string | null;
  readonly principal: string | null;
  readonly asker: string | null;
  readonly state: string | null;
  readonly turn: string | null;
  readonly turn_state: string | null;
  readonly ordinal: string | null;
  readonly input: string | null;
  readonly result: string | null;
  readonly failure: string | null;
  readonly asked_at: string | null;
}

function leadInquiryRecordOf(row: LeadInquiryRow): LeadInquiryRecord {
  const measured = sessionTurnMeasuredOf(row);
  return {
    session: asSessionId(sessionRowText(row.session, "inquiry session")),
    principal: asPrincipal(sessionRowText(row.principal, "principal")),
    ...(row.asker === null ? {} : { asker: row.asker }),
    state: sessionRowMember(allSessionStates, row.state, "session state"),
    turn: asSessionTurnId(sessionRowText(row.turn, "inquiry turn")),
    turnState: sessionRowMember(
      allSessionTurnStates,
      row.turn_state,
      "session turn state",
    ),
    ordinal: projectRowCounter(
      sessionRowText(row.ordinal, "inquiry ordinal"),
      "session turn ordinal",
    ),
    input: sessionRowText(row.input, "inquiry document"),
    ...(row.result === null ? {} : { answer: row.result }),
    ...(row.failure === null
      ? {}
      : {
          failure: sessionRowMember(
            allSessionTurnFailures,
            row.failure,
            "session turn failure",
          ),
        }),
    askedAt: asPublicInstant(sessionRowText(row.asked_at, "asked at")),
    ...(measured === undefined ? {} : { measured }),
  };
}

async function leadInquiryListing(
  pool: pg.Pool,
  partition: Partition,
  limit: number,
): Promise<readonly LeadInquiryRecord[]> {
  const found = await pool.query<LeadInquiryRow>(
    sql`SELECT session,principal,asker,state,turn,turn_state,
               ordinal::text AS ordinal,input,result,failure,
               asked_at::text AS asked_at,model,tokens::text AS tokens,
               cost_micros::text AS cost_micros,
               duration_ms::text AS duration_ms,tools
          FROM read_lead_inquiries(
                 ${partition.tenant},${partition.project},${limit})`,
  );
  return found.rows.map(leadInquiryRecordOf);
}

async function leadInquiryOne(
  pool: pg.Pool,
  partition: Partition,
  session: SessionId,
): Promise<LeadInquiryRecord | undefined> {
  const found = await pool.query<LeadInquiryRow>(
    sql`SELECT session,principal,asker,state,turn,turn_state,
               ordinal::text AS ordinal,input,result,failure,
               asked_at::text AS asked_at,model,tokens::text AS tokens,
               cost_micros::text AS cost_micros,
               duration_ms::text AS duration_ms,tools
          FROM read_lead_inquiry(
                 ${partition.tenant},${partition.project},${session})`,
  );
  const row = found.rows[0];
  return row === undefined ? undefined : leadInquiryRecordOf(row);
}

/** The verdict `open_lead_inquiry` answered, and the fork and ordinal each arm carries. */
function leadInquiryOpening(row: {
  readonly opened: string | null;
  readonly ordinal: string | null;
  readonly session: string | null;
}): LeadInquiryOpened {
  const { opened } = row;
  if (
    opened === "NoLead" ||
    opened === "LeadNotStarted" ||
    opened === "LeadClosed" ||
    opened === "InFlight"
  )
    return { opened };
  if ((opened === "Opened" || opened === "AlreadyOpen") && row.ordinal !== null)
    return {
      opened,
      session: asSessionId(sessionRowText(row.session, "inquiry session")),
      ordinal: projectRowCounter(row.ordinal, "inquiry turn ordinal"),
    };
  throw new Error(`postgres lead inquiry: the door answered ${String(opened)}`);
}

async function leadInquiryOpen(
  pool: pg.Pool,
  input: {
    readonly partition: Partition;
    readonly principal: Principal;
    readonly session: SessionId;
    readonly turn: SessionTurnId;
    readonly question: string;
  },
): Promise<LeadInquiryOpened> {
  const answered = await pool.query<{
    opened: string | null;
    ordinal: string | null;
    session: string | null;
  }>(
    sql`SELECT opened,ordinal::text AS ordinal,session
          FROM open_lead_inquiry(
            ${input.partition.tenant},${input.partition.project},
            ${input.principal},${input.session},
            ${input.turn},${input.question})`,
  );
  const row = answered.rows[0];
  if (row === undefined)
    throw new Error("postgres lead inquiry: the door returned no verdict");
  return leadInquiryOpening(row);
}

/** Every read and the one door the API has onto a lead's inquiries. */
export function postgresLeadInquiries(pool: pg.Pool): LeadInquiryStore {
  return {
    inquiries: (partition, limit) => leadInquiryListing(pool, partition, limit),
    inquiry: (partition, session) => leadInquiryOne(pool, partition, session),
    open: (input) => leadInquiryOpen(pool, input),
  };
}
