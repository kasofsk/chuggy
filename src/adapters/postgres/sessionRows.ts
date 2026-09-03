/**
 * The session row and the turn row as PostgreSQL returns them, and their
 * translation
 * into the values `src/interpreter/agentSession.ts` declares.
 *
 * WHY A TRANSLATION AT ALL, and why here. The driver hands back `bigint`
 * columns as strings and every roster column as unbranded text, so a row is a
 * foreign shape and the port's types are this tree's. Two adapters read a
 * session row — the provisioning doors and the scheduler's placement read — so
 * parsing it lives beside neither of them, exactly as `./schedulerRows.ts`
 * stands beside the execution scheduler.
 */

import {
  allSessionCapabilities,
  allSessionKinds,
  allSessionStates,
  allSessionTurnFailures,
  allSessionTurnInputKinds,
  allSessionTurnStates,
  asSessionAttemptId,
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
  type AgentSession,
  type SessionCapability,
  type SessionId,
  type SessionState,
  type SessionTurn,
  type SessionTurnFailure,
  type SessionTurnId,
  type SessionTurnInputKind,
  type SessionTurnMeasured,
  type SessionTurnState,
} from "../../interpreter/agentSession.ts";
import { asPrincipal } from "../../interpreter/principal.ts";
import type { SessionStoreStreamRow } from "../../interpreter/sessionPlane.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  asCapacityAccountId,
  asClusterId,
} from "../../interpreter/schedulerIdentity.ts";
import { projectRowCounter } from "./rows.ts";

/** One `agent_session` row as the driver hands it back. */
export interface AgentSessionRow {
  readonly tenant: string | null;
  readonly project: string | null;
  readonly session: string | null;
  readonly kind: string | null;
  readonly principal: string | null;
  readonly parent_session: string | null;
  readonly agent_reference: string | null;
  readonly capabilities: string[] | null;
  readonly credential_slot: string | null;
  readonly account: string | null;
  readonly cluster: string | null;
  readonly state: string | null;
}

/** One `session_turn` row, with every counter read back as text. */
export interface SessionTurnRow {
  readonly turn: string | null;
  readonly ordinal: string | null;
  readonly input_kind: string | null;
  readonly input: string | null;
  readonly state: string | null;
  readonly attempt: string | null;
  readonly attempts_spent: string | null;
  readonly result: string | null;
  readonly failure: string | null;
  readonly batch_first: string | null;
  readonly batch_last: string | null;
}

/**
 * A column the server declares NOT NULL, refusing the null the query checker
 * cannot rule out. A set-returning function's columns are nullable to it,
 * because a function that returns nothing returns nulls.
 */
export function sessionRowText(value: string | null, what: string): string {
  if (value === null) throw new Error(`agent session row: ${what} is null`);
  return value;
}

/** Narrows a column to the roster a CHECK admits, refusing what no migration wrote. */
export function sessionRowMember<Member extends string>(
  roster: readonly Member[],
  value: string | null,
  what: string,
): Member {
  const found = roster.find((member) => member === value);
  if (found === undefined)
    throw new Error(
      `agent session row: ${value} is not a ${what} this code knows`,
    );
  return found;
}

/** Reads the row's capability roster, refusing a member the CHECK should have stopped. */
export function sessionRowCapabilities(
  values: readonly string[] | null,
): readonly SessionCapability[] {
  if (values === null)
    throw new Error("agent session row: the capability roster is null");
  return values.map((value) =>
    sessionRowMember(allSessionCapabilities, value, "session capability"),
  );
}

export function agentSessionRowOf(row: AgentSessionRow): AgentSession {
  return {
    partition: {
      tenant: asTenantId(sessionRowText(row.tenant, "tenant")),
      project: asProjectId(sessionRowText(row.project, "project")),
    },
    session: asSessionId(sessionRowText(row.session, "session")),
    kind: sessionRowMember(allSessionKinds, row.kind, "session kind"),
    principal: asPrincipal(sessionRowText(row.principal, "principal")),
    ...(row.parent_session === null
      ? {}
      : { parent: asSessionId(row.parent_session) }),
    ...(row.agent_reference === null
      ? {}
      : { agentReference: row.agent_reference }),
    capabilities: sessionRowCapabilities(row.capabilities),
    credentialSlot: sessionRowText(row.credential_slot, "credential slot"),
    account: asCapacityAccountId(sessionRowText(row.account, "account")),
    cluster: asClusterId(sessionRowText(row.cluster, "cluster")),
    state: sessionRowMember<SessionState>(
      allSessionStates,
      row.state,
      "session state",
    ),
  };
}

export function sessionTurnRowOf(partition: Partition, session: SessionId) {
  return (row: SessionTurnRow): SessionTurn => ({
    partition,
    session,
    turn: asSessionTurnId(sessionRowText(row.turn, "turn")),
    ordinal: projectRowCounter(
      sessionRowText(row.ordinal, "turn ordinal"),
      "session turn ordinal",
    ),
    inputKind: sessionRowMember<SessionTurnInputKind>(
      allSessionTurnInputKinds,
      row.input_kind,
      "session turn input kind",
    ),
    input: sessionRowText(row.input, "turn input"),
    state: sessionRowMember<SessionTurnState>(
      allSessionTurnStates,
      row.state,
      "session turn state",
    ),
    ...(row.attempt === null
      ? {}
      : { attempt: asSessionAttemptId(row.attempt) }),
    attemptsSpent: projectRowCounter(
      sessionRowText(row.attempts_spent, "attempts spent"),
      "session turn attempts spent",
    ),
    ...(row.result === null ? {} : { result: row.result }),
    ...(row.failure === null
      ? {}
      : {
          failure: sessionRowMember<SessionTurnFailure>(
            allSessionTurnFailures,
            row.failure,
            "session turn failure",
          ),
        }),
    ...(row.batch_first === null
      ? {}
      : { batchFirst: projectRowCounter(row.batch_first, "first batch") }),
    ...(row.batch_last === null
      ? {}
      : { batchLast: projectRowCounter(row.batch_last, "last batch") }),
  });
}

/**
 * One turn of a session's mailbox as a standing read answers it, every column
 * nullable because a session that has taken no turn is answered by nulls.
 */
export interface SessionTurnStandingRow extends SessionTurnMeasureRow {
  readonly turn: string | null;
  readonly turn_ordinal: string | null;
  readonly input_kind: string | null;
  readonly turn_state: string | null;
  readonly failure: string | null;
  readonly batch_first: string | null;
  readonly batch_last: string | null;
}

/** What every reader of a standing row reads the same way, whatever kind of session it is. */
export interface SessionTurnStanding {
  readonly turn: SessionTurnId;
  readonly ordinal: number;
  readonly inputKind: SessionTurnInputKind;
  readonly state: SessionTurnState;
  readonly failure?: SessionTurnFailure;
  readonly measured?: SessionTurnMeasured;
  readonly batchFirst?: number;
  readonly batchLast?: number;
}

/**
 * The turn a standing row carries, or nothing where the session has taken none.
 * It stands here because a lead's mailbox and a thread's are read by two
 * modules and differ in what they add to a turn, never in the turn.
 */
export function sessionTurnStandingOf(
  row: SessionTurnStandingRow,
): SessionTurnStanding | undefined {
  if (row.turn === null) return undefined;
  const measured = sessionTurnMeasuredOf(row);
  return {
    turn: asSessionTurnId(row.turn),
    ordinal: projectRowCounter(
      sessionRowText(row.turn_ordinal, "turn ordinal"),
      "session turn ordinal",
    ),
    inputKind: sessionRowMember(
      allSessionTurnInputKinds,
      row.input_kind,
      "session turn input kind",
    ),
    state: sessionRowMember(
      allSessionTurnStates,
      row.turn_state,
      "session turn state",
    ),
    ...(row.failure === null
      ? {}
      : {
          failure: sessionRowMember(
            allSessionTurnFailures,
            row.failure,
            "session turn failure",
          ),
        }),
    ...(measured === undefined ? {} : { measured }),
    ...(row.batch_first === null
      ? {}
      : { batchFirst: projectRowCounter(row.batch_first, "first batch") }),
    ...(row.batch_last === null
      ? {}
      : { batchLast: projectRowCounter(row.batch_last, "last batch") }),
  };
}

/** One row of a store's stream listing, counted by the server. */
export interface SessionStoreStreamCountRow {
  readonly stream: string | null;
  readonly batches: string | null;
}

/** The streams a listing answered, read the one way both callers read them. */
export function sessionStoreStreamRowsOf(
  rows: readonly SessionStoreStreamCountRow[],
): readonly SessionStoreStreamRow[] {
  return rows.map((row) => ({
    stream: asSessionStoreStream(sessionRowText(row.stream, "stream")),
    batches: projectRowCounter(
      sessionRowText(row.batches, "stream batches"),
      "stream batches",
    ),
  }));
}

/** One turn's measurement, nullable per column because a function may answer nothing. */
export interface SessionTurnMeasureRow {
  readonly model: string | null;
  readonly tokens: string | null;
  readonly cost_micros: string | null;
  readonly duration_ms: string | null;
  readonly tools: string[] | null;
}

/**
 * What the pod measured of one turn, or nothing where it measured none. The
 * five columns are whole or absent together, so the model column decides.
 */
export function sessionTurnMeasuredOf(
  row: SessionTurnMeasureRow,
): SessionTurnMeasured | undefined {
  if (row.model === null) return undefined;
  return {
    model: row.model,
    tokens: projectRowCounter(
      sessionRowText(row.tokens, "tokens"),
      "session turn tokens",
    ),
    costMicros: projectRowCounter(
      sessionRowText(row.cost_micros, "cost"),
      "session turn cost",
    ),
    durationMs: projectRowCounter(
      sessionRowText(row.duration_ms, "duration"),
      "session turn duration",
    ),
    tools: row.tools ?? [],
  };
}
