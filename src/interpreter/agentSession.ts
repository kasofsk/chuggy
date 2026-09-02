/**
 * The vocabulary one agent session is held in: its opaque identities, the
 * rosters a stored row is checked against, and the two durable shapes the
 * platform keeps. The transcript is not among them — a session's bytes live in
 * the store and this module holds only what points at them.
 *
 * EVERY IDENTITY IS OPAQUE, AND OPAQUE MEANS BOUNDED, exactly as
 * `./schedulerIdentity.ts` has it: minted outside this tree's arithmetic, equal
 * or not, and refused when a stored row could not hold it. Two of them carry a
 * shape as well as a bound: the bearer secret, because the API tells the two
 * bearer kinds apart by the language each is written in rather than by offering
 * a token to one authority and then the other; and the store stream, because it
 * becomes a directory name as well as a stored key, so the characters neither
 * of those holds are refused where the value is minted.
 *
 * MAILBOX SEMANTICS, stated here because the SQL that enforces them is a
 * different layer and a reader of either needs both:
 *
 *   1. Ordinals are per session, allocated from the session's own counter,
 *      contiguous from one, and never reused.
 *   2. At most one turn of a session is `Claimed` at a time.
 *   3. A pod claims the lowest-ordinal `Queued` turn of its own session, under
 *      its attempt's generation; the claim moves the turn to `Claimed` and
 *      stamps the attempt onto it.
 *   4. A turn is answered or failed by the attempt that claimed it and by no
 *      other, fenced on the attempt's secret digest, its generation and the
 *      turn.
 *   5. Answering is idempotent: the same turn answered twice with the same
 *      result is already answered, and with a different result is a conflict
 *      that moves nothing.
 *   6. A `Claimed` turn whose attempt ends returns to `Queued` and spends one of
 *      `sessionTurnAttemptsMax`; the turn that exhausts them fails with
 *      `AttemptLost`.
 *   7. Closing a session abandons every `Queued` and `Claimed` turn it holds,
 *      with `SessionClosed`.
 */

import { sessionStoreStreamCharsMax } from "../contract/http.ts";
import { asBoundedText } from "./boundedText.ts";
import type { Principal } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type { CapacityAccountId, ClusterId } from "./schedulerIdentity.ts";

declare const sessionIdBrand: unique symbol;
declare const sessionTurnIdBrand: unique symbol;
declare const sessionAttemptIdBrand: unique symbol;
declare const sessionBearerIdBrand: unique symbol;
declare const sessionBearerSecretBrand: unique symbol;
declare const sessionStoreStreamBrand: unique symbol;

/** One agent session's identity: globally unique, opaque, minted outside and never reused. */
export type SessionId = string & { readonly [sessionIdBrand]: true };

/** One turn's identity, distinct for every turn ever enqueued under a session. */
export type SessionTurnId = string & { readonly [sessionTurnIdBrand]: true };

/** One physical session attempt's identity, distinct for every attempt ever made. */
export type SessionAttemptId = string & {
  readonly [sessionAttemptIdBrand]: true;
};

/** The public identity of one session-scoped bearer, which a row may name. */
export type SessionBearerId = string & {
  readonly [sessionBearerIdBrand]: true;
};

/** The bearer's secret, returned once at minting and stored only as a digest. */
export type SessionBearerSecret = string & {
  readonly [sessionBearerSecretBrand]: true;
};

/** One stream of the store, which is an agent runtime session id and an optional subpath folded. */
export type SessionStoreStream = string & {
  readonly [sessionStoreStreamBrand]: true;
};

/** The longest opaque session identity a stored row carries. */
export const sessionIdentityCharsMax = 256;

/** Refuses text a bounded column cannot hold, and text no digest can separate. */
function asSessionText(value: string, what: string): string {
  return asBoundedText(value, what, sessionIdentityCharsMax);
}

/** Brands an opaque agent session identity. */
export function asSessionId(value: string): SessionId {
  return asSessionText(value, "session id") as SessionId;
}

/** Brands an opaque session turn identity. */
export function asSessionTurnId(value: string): SessionTurnId {
  return asSessionText(value, "session turn id") as SessionTurnId;
}

/** Brands an opaque session attempt identity. */
export function asSessionAttemptId(value: string): SessionAttemptId {
  return asSessionText(value, "session attempt id") as SessionAttemptId;
}

/** Brands an opaque session bearer identity. */
export function asSessionBearerId(value: string): SessionBearerId {
  return asSessionText(value, "session bearer id") as SessionBearerId;
}

/**
 * Brands a store stream, which becomes a directory name and a stored key. It
 * refuses control and whitespace characters as well as the bound, because the
 * row that holds it refuses both and a refusal at the far edge is a constraint
 * violation where a refusal at the door is a value nobody minted.
 */
export function asSessionStoreStream(value: string): SessionStoreStream {
  const bounded = asBoundedText(
    value,
    "store stream",
    sessionStoreStreamCharsMax,
  );
  if (/[\p{Cc}\s]/u.test(bounded)) {
    throw new RangeError(
      "store stream: a control or whitespace character is not a value a directory name and a stored key agree on",
    );
  }
  return bounded as SessionStoreStream;
}

/** What marks a token as a session bearer rather than an OIDC one, so the API never probes. */
export const sessionBearerPrefix = "chgs_";

/** The whole language of session bearer secrets, which no compact JWS inhabits. */
export const sessionBearerPattern = /^chgs_[A-Za-z0-9_-]{32,240}$/u;

/** Brands a session bearer secret, refusing text outside the language the API routes on. */
export function asSessionBearerSecret(value: string): SessionBearerSecret {
  const bounded = asSessionText(value, "session bearer secret");
  if (!sessionBearerPattern.test(bounded)) {
    throw new RangeError(
      "session bearer secret: a secret outside the bearer language is a token the API would route to the wrong authority",
    );
  }
  return bounded as SessionBearerSecret;
}

/** What a session is for, which is what decides whose turns it takes and what it may write. */
export const allSessionKinds = ["Lead", "Thread", "Inquiry"] as const;
export type SessionKind = (typeof allSessionKinds)[number];

/** Whether a session still takes turns, which is the whole of its lifecycle. */
export const allSessionStates = ["Open", "Closed"] as const;
export type SessionState = (typeof allSessionStates)[number];

/**
 * What a session may do, mapped to the agent runtime's own tool names by the
 * worker image. Every member is enforced, because a member that mapped to
 * nothing would be an unverified control.
 */
export const allSessionCapabilities = [
  "RepositoryRead",
  "RepositoryWrite",
  "RunCommands",
] as const;
export type SessionCapability = (typeof allSessionCapabilities)[number];

/** The most capabilities one session's roster carries, which is a bound and not a policy. */
export const sessionCapabilitiesMax = 16;

/** Who or what put a turn in the mailbox, which the session reads as context and never as trust. */
export const allSessionTurnInputKinds = [
  "Observation",
  "UserMessage",
  "Wake",
  "Inquiry",
] as const;
export type SessionTurnInputKind = (typeof allSessionTurnInputKinds)[number];

/**
 * Where one turn stands. `Claimed` is running: a pod holds the turn under its
 * attempt's generation, and there is no separate state for having started,
 * because nothing observes the difference and a second state would be one more
 * thing a reaper must reason about.
 */
export const allSessionTurnStates = [
  "Queued",
  "Claimed",
  "Answered",
  "Failed",
  "Abandoned",
] as const;
export type SessionTurnState = (typeof allSessionTurnStates)[number];

/** Why one turn ended without an answer, a closed vocabulary so a label is never a payload. */
export const allSessionTurnFailures = [
  "AgentFailed",
  "AgentRateLimited",
  "AgentTurnsExhausted",
  "AgentBudgetExhausted",
  "StoreRefused",
  "AttemptLost",
  "SessionClosed",
] as const;
export type SessionTurnFailure = (typeof allSessionTurnFailures)[number];

/** One agent session as the platform holds it; the transcript is not here. */
export interface AgentSession {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly kind: SessionKind;
  /** Whose authorization the session acts under: a human's for a thread, the lead's own for a lead. */
  readonly principal: Principal;
  /** The lead an inquiry forked from, absent for every other kind. */
  readonly parent?: SessionId;
  /** The agent runtime's own session id, absent until the first turn reports one. */
  readonly agentReference?: string;
  readonly capabilities: readonly SessionCapability[];
  /** The named credential mount the session speaks through. */
  readonly credentialSlot: string;
  readonly account: CapacityAccountId;
  readonly cluster: ClusterId;
  readonly state: SessionState;
}

/** One turn in a session's mailbox: what was asked, what came back, and which batches it wrote. */
export interface SessionTurn {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly turn: SessionTurnId;
  readonly ordinal: number;
  readonly inputKind: SessionTurnInputKind;
  readonly input: string;
  readonly state: SessionTurnState;
  readonly attempt?: SessionAttemptId;
  readonly attemptsSpent: number;
  readonly result?: string;
  readonly failure?: SessionTurnFailure;
  readonly batchFirst?: number;
  readonly batchLast?: number;
}
