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
  asSessionTurnId,
  type AgentSession,
  type SessionCapability,
  type SessionId,
  type SessionState,
  type SessionTurn,
  type SessionTurnFailure,
  type SessionTurnInputKind,
  type SessionTurnState,
} from "../../interpreter/agentSession.ts";
import { asPrincipal } from "../../interpreter/nativeWeb.ts";
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
