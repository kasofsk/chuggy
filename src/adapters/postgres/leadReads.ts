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
import {
  selectorInteractionRecord,
  type SelectorInteractionRow,
} from "./selector.ts";
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

/**
 * One `read_selector_interactions` row. Every column of a set-returning
 * function is nullable to the query checker, because a function that answers
 * nothing answers nulls, so the row is narrowed here rather than declared as
 * what the relation holds.
 */
interface SelectorInteractionsRow {
  readonly selector_decision: string | null;
  readonly ordinal: string | null;
  readonly instructions_version: string | null;
  readonly instructions: string | null;
  readonly observed_view: string | null;
  readonly observed_token: string | null;
  readonly context: string | null;
  readonly tool_activity: string | null;
  readonly result: string | null;
  readonly implementation_revision: string | null;
  readonly model_revision: string | null;
  readonly policy_revision: string | null;
  readonly accounting: string | null;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
  readonly observed_view_chunks: string[] | null;
  readonly context_chunks: string[] | null;
  readonly tool_activity_chunks: string[] | null;
}

function interactionInstant(value: Date | null, what: string): Date {
  if (value === null) throw new Error(`lead read: ${what} is null`);
  return value;
}

/** The interaction row the record builder is written against, narrowed once. */
function selectorInteractionRowOf(
  row: SelectorInteractionsRow,
): SelectorInteractionRow {
  return {
    selector_decision: sessionRowText(row.selector_decision, "decision"),
    ordinal: sessionRowText(row.ordinal, "interaction ordinal"),
    instructions_version: sessionRowText(
      row.instructions_version,
      "instructions version",
    ),
    instructions: sessionRowText(row.instructions, "instructions"),
    observed_view: sessionRowText(row.observed_view, "observed view"),
    observed_token: row.observed_token,
    context: sessionRowText(row.context, "context"),
    tool_activity: sessionRowText(row.tool_activity, "tool activity"),
    result: sessionRowText(row.result, "result"),
    implementation_revision: sessionRowText(
      row.implementation_revision,
      "implementation revision",
    ),
    model_revision: sessionRowText(row.model_revision, "model revision"),
    policy_revision: sessionRowText(row.policy_revision, "policy revision"),
    accounting: sessionRowText(row.accounting, "accounting"),
    started_at: interactionInstant(row.started_at, "a decision's start"),
    completed_at: interactionInstant(row.completed_at, "a decision's end"),
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

async function leadDecisionHistory(
  pool: pg.Pool,
  partition: Partition,
  after: number | undefined,
  limit: number,
  newestFirst: boolean,
): Promise<readonly SelectorInteractionRecord[]> {
  const found = await pool.query<SelectorInteractionsRow>(
    sql`SELECT selector_decision,ordinal::text,instructions_version,instructions,
               observed_view,observed_token,context,tool_activity,result,
               implementation_revision,model_revision,policy_revision,
               accounting,started_at,completed_at,
               observed_view_chunks,context_chunks,tool_activity_chunks
          FROM read_selector_interactions(
                 ${partition.tenant},${partition.project},
                 ${after ?? null},${limit},${newestFirst})`,
  );
  return found.rows.map((row) =>
    selectorInteractionRecord(partition, selectorInteractionRowOf(row), {
      observedView: row.observed_view_chunks ?? [],
      context: row.context_chunks ?? [],
      toolActivity: row.tool_activity_chunks ?? [],
    }),
  );
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
      leadDecisionHistory(
        pool,
        partition,
        query.after,
        query.limit,
        query.order === "newest",
      ),
    tail: (partition, limit) =>
      leadDecisionHistory(pool, partition, undefined, limit, true),
    planningIntent: (partition) => leadPlanningIntent(pool, partition),
  };
}
