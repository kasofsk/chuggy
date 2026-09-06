/**
 * What the API may read of a project's lead and of the decisions behind it:
 * the session with the tail of its mailbox, the store rows a transcript is
 * drawn from, and the decision log with the planning intent it left.
 *
 * THE API HOLDS NO GRANT ON ANY OF THESE RELATIONS. Every read below is a
 * `SECURITY DEFINER` function 059 declares, bounded and partitioned by its own
 * arguments, so the API cannot reach another project's session by writing its
 * own predicate. That is what makes a second pool holding the selector
 * service's role unnecessary, and a second credential in a deployment is a
 * second thing to leak.
 *
 * THE SHAPES ARE THE INTERPRETER'S. `LeadReadStore` and `SelectorHistoryStore`
 * are declared beside the reads that need them, and this module answers them; a
 * shape declared here would be an adapter telling the layer above it what it may
 * ask for.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import * as z from "zod";

import {
  allSessionStates,
  asSessionId,
} from "../../interpreter/agentSession.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type {
  JsonValue,
  SelectorInteractionRecord,
  SelectorPlanningIntent,
  SelectorProjectState,
  SelectorStateStore,
} from "../../interpreter/selector.ts";
import type {
  LeadReadStore,
  LeadStanding,
} from "../../interpreter/leadRead.ts";
import type { SelectorHistoryStore } from "../../interpreter/selectorHistory.ts";
import { projectRowCounter } from "./rows.ts";
import {
  sessionStoreBatchRows,
  sessionStoreStreamRows,
} from "./sessionStoreReads.ts";
import { interactionInstant, readSelectorInteractions } from "./selector.ts";
import {
  sessionRowMember,
  sessionRowText,
  sessionTurnStandingOf,
  type SessionTurnStandingRow,
} from "./sessionRows.ts";

/**
 * Every read the API has onto a lead and the decisions behind it: the ports the
 * interpreter declares, plus the seeding tail and the planning intent no route
 * answers yet.
 */
export interface PostgresLeadReads
  extends
    LeadReadStore,
    SelectorHistoryStore,
    Pick<SelectorStateStore, "planningIntent"> {
  /** The newest decisions first, which is what seeds a lead that has no transcript. */
  tail(
    partition: Partition,
    limit: number,
  ): Promise<readonly SelectorInteractionRecord[]>;
}

/** One `read_lead_standing` row: the session facts, and one turn of the tail or none. */
interface LeadStandingRow extends SessionTurnStandingRow {
  readonly session: string | null;
  readonly session_state: string | null;
  readonly agent_reference: string | null;
  readonly attention: string | null;
  readonly notification_cursor: string | null;
  readonly handoff_note: string | null;
}

const jsonValueSchema: z.ZodType<JsonValue> = z.json();

/** The attention roster as `selector_project_state` admits it. */
const leadAttentions: readonly SelectorProjectState["attention"][] = [
  "Monitoring",
  "Attention",
  "Stopped",
];

/** The note as the interpreter reads it, narrowed like every other column here. */
function leadHandoffNote(value: string | null): JsonValue {
  return jsonValueSchema.parse(
    JSON.parse(sessionRowText(value, "handoff note")),
  );
}

/**
 * The lead the rows describe. Every row repeats the session's facts because
 * the tail is joined to them, so the first row answers them and the turn of
 * each row extends the tail.
 */
function leadReadOf(
  rows: readonly LeadStandingRow[],
): LeadStanding | undefined {
  const head = rows[0];
  if (head === undefined) return undefined;
  return {
    session: asSessionId(sessionRowText(head.session, "session")),
    state: sessionRowMember(
      allSessionStates,
      head.session_state,
      "session state",
    ),
    attention: sessionRowMember(
      leadAttentions,
      head.attention,
      "selector attention",
    ),
    ...(head.agent_reference === null
      ? {}
      : { agentReference: head.agent_reference }),
    notificationCursor: projectRowCounter(
      sessionRowText(head.notification_cursor, "notification cursor"),
      "selector notification cursor",
    ),
    handoffNote: leadHandoffNote(head.handoff_note),
    turns: rows.flatMap((row) => {
      const turn = sessionTurnStandingOf(row);
      return turn === undefined ? [] : [turn];
    }),
  };
}

async function leadStanding(
  pool: pg.Pool,
  partition: Partition,
  turnsMax: number,
): Promise<LeadStanding | undefined> {
  const found = await pool.query<LeadStandingRow>(
    sql`SELECT session,session_state,agent_reference,attention,
               notification_cursor::text AS notification_cursor,handoff_note,
               turn,turn_ordinal::text AS turn_ordinal,input_kind,turn_state,
               failure,model,tokens::text AS tokens,
               cost_micros::text AS cost_micros,
               duration_ms::text AS duration_ms,tools,
               batch_first::text AS batch_first,batch_last::text AS batch_last
          FROM read_lead_standing(
                 ${partition.tenant},${partition.project},${turnsMax})`,
  );
  return leadReadOf(found.rows);
}

async function leadPlanningIntent(
  pool: pg.Pool,
  partition: Partition,
): Promise<SelectorPlanningIntent | undefined> {
  const found = await pool.query<{
    selector_decision: string | null;
    intent: string | null;
    updated_at: Date | null;
  }>(
    sql`SELECT selector_decision,intent,updated_at
          FROM read_selector_planning_intent(
                 ${partition.tenant},${partition.project})`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  return {
    selectorDecision: sessionRowText(row.selector_decision, "decision"),
    intent: jsonValueSchema.parse(
      JSON.parse(sessionRowText(row.intent, "planning intent")) as unknown,
    ),
    updatedAt: interactionInstant(
      row.updated_at,
      "a planning intent's instant",
    ).toISOString(),
  };
}

/** Every read the API has onto a lead, over the API's own pool. */
export function postgresLeadReads(pool: pg.Pool): PostgresLeadReads {
  return {
    standing: (partition, turnsMax) => leadStanding(pool, partition, turnsMax),
    batches: (query) => sessionStoreBatchRows(pool, query),
    streams: (partition, session, limit) =>
      sessionStoreStreamRows(pool, partition, session, limit),
    history: (partition, query) =>
      readSelectorInteractions(
        pool,
        partition,
        query.after,
        query.limit,
        query.order === "newest",
      ),
    tail: (partition, limit) =>
      readSelectorInteractions(pool, partition, undefined, limit, true),
    planningIntent: (partition) => leadPlanningIntent(pool, partition),
  };
}
