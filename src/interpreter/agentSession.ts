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

import {
  sessionIdentityCharsMax,
  sessionStoreStreamCharsMax,
} from "../contract/http.ts";
import { asBoundedText, isBoundedText } from "./boundedText.ts";
import type { Principal } from "./principal.ts";
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

/**
 * The longest opaque session identity a stored row carries, surfaced where
 * every branding reads it. It is the contract's because the change resource's
 * bound is derived from it, and the contract may not look here.
 */
export { sessionIdentityCharsMax };

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

/** What neither a directory name nor a stored key holds, refused by both of the two below. */
const sessionStoreStreamRefused = /[\p{Cc}\s]/u;

/**
 * Whether one stream name is one a stored row holds. A route reading a stream
 * out of a path must refuse before it brands, because a caller's bad segment is
 * a status to answer with rather than a raise to catch.
 */
export function isSessionStoreStream(value: string): boolean {
  return (
    isBoundedText(value, sessionStoreStreamCharsMax) &&
    !sessionStoreStreamRefused.test(value)
  );
}

/**
 * Brands a store stream, which becomes a directory name and a stored key. It
 * refuses control and whitespace characters as well as the bound, because the
 * row that holds it refuses both and a refusal at the far edge is a constraint
 * violation where a refusal at the door is a value nobody minted; the
 * whitespace class is Unicode's and so refuses a little more than the row's
 * `[[:space:]]` does, which is the direction that costs nothing.
 */
export function asSessionStoreStream(value: string): SessionStoreStream {
  const bounded = asBoundedText(
    value,
    "store stream",
    sessionStoreStreamCharsMax,
  );
  if (sessionStoreStreamRefused.test(bounded)) {
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
 * worker image. A member that maps to nothing is an unverified control, so the
 * first three are mapped in `images/worker/sessionStore.mjs` today and the
 * three below them map to the chuggy tool server's own names once that server
 * reaches the image; until it does, they admit nothing a session is given.
 */
export const allSessionCapabilities = [
  "RepositoryRead",
  "RepositoryWrite",
  "RunCommands",
  /** The chuggy server's reads: what a session may see of the project through the API. */
  "ProjectRead",
  /** The chuggy server's authorship: drafts, and releasing one. */
  "DraftAuthor",
  /**
   * Originating a draft from nothing, which a member may do and the lead may
   * not. It is its own member rather than part of `DraftAuthor` because
   * `DraftAuthor` is where the derived-work rule sits — a dependent is filed
   * against a parent that already exists, and there is no bare create —
   * and widening it would hand the lead the one thing that rule withholds.
   */
  "DraftOriginate",
  /** The decision tools, which write nothing and compose the turn's answer. */
  "LeadDecision",
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

/**
 * Why one turn a pod held ended without an answer, which is the whole of what a
 * pod may name. Each is something the pod is the only witness to: its runtime
 * failed, was rate limited, ran out of turns or budget, or its store refused a
 * batch.
 */
export const allAgentReportedTurnFailures = [
  "AgentFailed",
  "AgentRateLimited",
  "AgentTurnsExhausted",
  "AgentBudgetExhausted",
  "StoreRefused",
] as const;

/**
 * Why one turn ended without an answer by the platform's own act. Rules 6 and 7
 * above write the first two and the selector's withdrawal writes the third, each
 * from a definer function; a pod naming one would be provenance nobody wrote,
 * and a pod claiming its own session closed would leave a row saying so while
 * the session is open.
 */
export const allPlatformTurnFailures = [
  "AttemptLost",
  "SessionClosed",
  "TurnWithdrawn",
] as const;

/**
 * Why one turn ended without an answer, a closed vocabulary so a label is never
 * a payload. The durable check on it is generated from this list at the
 * migration that last wrote `session_turn_failure_is_known`, so a member added
 * here is one an installation that already ran that migration refuses until a
 * further migration replaces the constraint.
 */
export const allSessionTurnFailures = [
  ...allAgentReportedTurnFailures,
  ...allPlatformTurnFailures,
] as const;
export type SessionTurnFailure = (typeof allSessionTurnFailures)[number];

/** What the runtime spent on one turn, measured by the pod from the runtime's own messages. */
export interface SessionTurnMeasured {
  readonly model: string;
  readonly tokens: number;
  /** Integer micros, because a float in a durable column is a comparison nobody can reproduce. */
  readonly costMicros: number;
  readonly durationMs: number;
  readonly tools: readonly string[];
}

/** What opening a session answers: it is open now, it already was, or it is not this one. */
export type AgentSessionOpened = "Opened" | "AlreadyOpen" | "Conflict";

/** What one session is opened as, which is everything the row carries that is not derived. */
export interface AgentSessionOpening {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly kind: SessionKind;
  readonly principal: Principal;
  readonly parent?: SessionId;
  readonly capabilities: readonly SessionCapability[];
  readonly credentialSlot: string;
  /** What the session was told it is, recorded once and read by the pod as its system prompt. */
  readonly systemPrompt?: string;
}

/** One turn offered to a session's mailbox. */
export interface SessionTurnOffering {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly turn: SessionTurn["turn"];
  readonly inputKind: SessionTurnInputKind;
  readonly input: string;
}

/** What enqueuing answered, carrying the ordinal only where the turn has one. */
export type SessionTurnEnqueued =
  | {
      readonly enqueued: "Enqueued" | "AlreadyEnqueued";
      readonly ordinal: number;
    }
  | { readonly enqueued: "Closed" | "Backlogged" };

/** What setting a lead's objectives answered: they moved, they were already these, or there is no lead. */
export type LeadSystemPromptSet = "Set" | "Unchanged" | "NoLead";

/**
 * The one durable door that moves a lead's objectives onto what the project now
 * asks of it. It names a project and never a session, because a door that could
 * name any session could rewrite a member's thread prompt; and it is separate
 * from `AgentSessionStore` because that store's doors are the boundary owner's
 * and this one is the selector's.
 */
export interface LeadSystemPromptPort {
  setSystemPrompt(
    partition: Partition,
    prompt: string,
  ): Promise<LeadSystemPromptSet>;
}

/** Who the pool connected as, and whether that identity may open a session at all. */
export interface AgentSessionWriter {
  readonly role: string;
  readonly canExecute: boolean;
}

/**
 * The durable session authority a provisioning command drives. Its three doors
 * are granted to the boundary owner alone, because a session is an authority to
 * act as a principal and minting one is provisioning rather than work.
 */
export interface AgentSessionStore {
  /** The privilege the three doors need, asked of the server rather than of a role name. */
  writer(): Promise<AgentSessionWriter>;

  open(opening: AgentSessionOpening): Promise<AgentSessionOpened>;

  /** Closes one open session, abandoning every turn it had not finished. */
  close(partition: Partition, session: SessionId): Promise<boolean>;

  enqueue(offering: SessionTurnOffering): Promise<SessionTurnEnqueued>;

  session(
    partition: Partition,
    session: SessionId,
  ): Promise<AgentSession | undefined>;

  /** The session's mailbox in ordinal order, at most `turnsMax` of it. */
  turns(
    partition: Partition,
    session: SessionId,
    turnsMax: number,
  ): Promise<readonly SessionTurn[]>;
}

/** Whose authority one session bearer carries, and which session carried it. */
export interface SessionBearerIdentity {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly kind: SessionKind;
  readonly principal: Principal;
}

/**
 * What the durable side answers about one session bearer: a row for a live
 * attempt of an open session, and nothing for a closed session, an ended
 * attempt, a stale epoch or a secret never minted — all the token's own fault,
 * indistinguishable from outside, so raising is left to a durable side that
 * could not be asked at all.
 * It stands here rather than beside the HTTP composition that consumes it,
 * because its only implementation is a postgres adapter and one adapter may not
 * see another.
 */
export interface SessionBearerAuthority {
  authenticate(
    secret: SessionBearerSecret,
  ): Promise<SessionBearerIdentity | undefined>;
}

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
