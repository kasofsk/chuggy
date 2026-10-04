/**
 * The ports the worker plane answers a session pod through: who the bearer is,
 * how its attempt stays alive, what its mailbox holds, and what its store has
 * recorded. It declares the shapes and names no adapter, exactly as
 * `./workerPlane.ts` does for a work attempt.
 *
 * A SESSION BEARER IS NOT AN ATTEMPT BEARER. Both reach the same process on the
 * same port, and neither authority is ever offered the other's token: the two
 * languages are disjoint by construction, so a route decides which authority to
 * ask by reading the token's shape rather than by trying one and then the other.
 *
 * THE PLANE READS NO PAYLOAD. A turn's input and result are opaque text it
 * carries, and a store batch is bytes it counts newlines in. Deduplication on
 * the wire is the batch number and its digest and nothing narrower, because
 * anything narrower is a reading of the transcript — and a fork re-appends its
 * parent's entries under their own identities, so a reading of it would discard
 * most of every inquiry.
 */

import type {
  SessionAttemptId,
  SessionBearerIdentity,
  SessionBearerSecret,
  SessionCapability,
  SessionId,
  SessionKind,
  SessionStoreStream,
  SessionTurnFailure,
  SessionTurnId,
  SessionTurnInputKind,
  SessionTurnMeasured,
} from "./agentSession.ts";
import type { SessionContainerEnd } from "../contract/rosters.ts";
import type { SessionLiveEvent } from "../contract/sessionLive.ts";
import type { Partition } from "./projectStore.ts";
import {
  sessionPodEvidence,
  type SessionAttemptEvidence,
} from "./sessionScheduler.ts";
import type { SessionStoreRecorded } from "./sessionStore.ts";

/** Everything a session bearer recovers, which is the whole of what a pod may be told. */
export interface SessionPlaneIdentity {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly attempt: SessionAttemptId;
  readonly generation: number;
  readonly kind: SessionKind;
  readonly capabilities: readonly SessionCapability[];
  readonly credentialSlot: string;
  /** The agent runtime's own session id, absent until a first turn has bound one. */
  readonly agentReference?: string;
  /** What the session was told it is, absent for a session opened without objectives. */
  readonly systemPrompt?: string;
  /**
   * The transcript this attempt forks from, which is the parent's runtime
   * reference and is present only for an inquiry. It is the parent's and never
   * the session's own, so an attempt that follows a lost one forks again from
   * the lead rather than resuming a fork whose store holds nothing.
   */
  readonly forkFrom?: string;
  /** Whether the attempt may still act, which every route requires before anything else. */
  readonly live: boolean;
}

export interface SessionPlaneAuthority {
  authenticate(
    secret: SessionBearerSecret,
  ): Promise<SessionPlaneIdentity | undefined>;
}

/**
 * Who one live bearer resolves to, which is the principal an operation it
 * carries is recorded under. It is the same fence `authenticate` makes and a
 * different answer: a route fences on the attempt, and an audit names the
 * principal.
 */
export interface SessionAttemptBindingPort {
  binding(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
  }): Promise<SessionBearerIdentity | undefined>;
}

/**
 * Ending the attempt a live bearer names, and reading how the last turn to end
 * under it failed, if one did: the two halves of recording its container's end.
 */
export interface SessionAttemptLossPort {
  lose(
    secret: SessionBearerSecret,
    generation: number,
    evidence: SessionAttemptEvidence,
  ): Promise<boolean>;
  turnFailure(
    secret: SessionBearerSecret,
    generation: number,
  ): Promise<SessionTurnFailure | undefined>;
}

/**
 * Ends the attempt a bearer names on its container's end, recorded as the
 * scheduler records the same pod seen to end. The runner reports only the
 * phase, so what the attempt is charged is never the caller's to choose.
 */
export async function sessionContainerEnded(
  losses: SessionAttemptLossPort,
  secret: SessionBearerSecret,
  generation: number,
  phase: SessionContainerEnd,
): Promise<boolean> {
  const failure = await losses.turnFailure(secret, generation);
  return losses.lose(secret, generation, sessionPodEvidence(phase, failure));
}

/**
 * Ending the attempt a bearer names as a hold rather than a loss, which returns
 * the turns it claimed to the mailbox uncharged.
 *
 * It carries no evidence and no loss arm: a pod choosing either would be the
 * thing being controlled choosing what it is charged.
 */
export interface SessionAttemptHoldPort {
  hold(secret: SessionBearerSecret, generation: number): Promise<boolean>;
}

export interface SessionHeartbeatPort {
  heartbeat(
    secret: SessionBearerSecret,
    generation: number,
    leaseSecs: number,
  ): Promise<boolean>;
}

/**
 * What binding the runtime's own session id found. It is written once and only
 * from absent, because a second value would mean two transcripts under one row.
 */
export type SessionReferenceBound =
  "Bound" | "AlreadyBound" | "Conflict" | "Fenced";

export interface SessionReferencePort {
  bind(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
    readonly reference: string;
  }): Promise<SessionReferenceBound>;
}

/** One turn as the mailbox hands it over, its input opaque to everything here. */
export interface SessionTurnClaimed {
  readonly turn: SessionTurnId;
  readonly ordinal: number;
  readonly inputKind: SessionTurnInputKind;
  readonly input: string;
}

export interface SessionTurnClaimPort {
  claim(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
  }): Promise<SessionTurnClaimed | undefined>;
}

/**
 * What answering one turn found; answering twice with one result moves
 * nothing. `Stopped` is a turn its member stopped: the answer is taken and
 * recorded nowhere, and the turn keeps the ending the stop gave it.
 */
export type SessionTurnAnswered =
  "Answered" | "AlreadyAnswered" | "Stopped" | "Conflict" | "Fenced";

/** What failing one turn found, the same arms an answer has. */
export type SessionTurnFailed =
  "Failed" | "AlreadyFailed" | "Stopped" | "Conflict" | "Fenced";

/**
 * Where a turn of its session stands for the live attempt asking after it: its
 * member stopped it, or it is still claimed, which a session's live attempt
 * alone holds. Nothing is answered where it is neither, which is a turn that
 * waits or ended some other way, one of another session, and a bearer that is
 * no live attempt's.
 */
export type SessionTurnWatched = "Stopped" | "Held";

/** The read a runner's watch on the turn it is answering is answered from. */
export interface SessionTurnWatchPort {
  watched(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
    readonly turn: SessionTurnId;
  }): Promise<SessionTurnWatched | undefined>;
}

export interface SessionTurnSettlePort {
  answer(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
    readonly turn: SessionTurnId;
    readonly result: string;
    /** The batches of the session's own stream this turn produced, both or neither. */
    readonly batchFirst?: number;
    readonly batchLast?: number;
    /** What the runtime spent, absent where the pod could not read it. */
    readonly measured?: SessionTurnMeasured;
  }): Promise<SessionTurnAnswered>;
  fail(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
    readonly turn: SessionTurnId;
    readonly failure: SessionTurnFailure;
  }): Promise<SessionTurnFailed>;
}

export interface SessionStoreRecordPort {
  record(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
    readonly stream: SessionStoreStream;
    readonly batch: number;
    readonly digest: string;
    readonly bytes: number;
    readonly events: number;
  }): Promise<SessionStoreRecorded>;
}

/** One recorded batch without the bytes it points at, which the store is asked for after. */
export interface SessionStoreBatchRow {
  readonly batch: number;
  readonly digest: string;
  readonly bytes: number;
}

/**
 * One recorded batch as the PLANE reads it, naming the session that WROTE it:
 * a fork's rows are its parent's and a resume's are its own, and the bearer's
 * identity is the reading session in both, so nothing but the row can say which
 * session an object stands under. The read that answered the row is also the
 * fence — a session it did not return is one no object is addressed under.
 */
export interface SessionStoreBatchWritten extends SessionStoreBatchRow {
  readonly session: SessionId;
}

/** One stream a session's store holds, and how many batches stand under it. */
export interface SessionStoreStreamRow {
  readonly stream: SessionStoreStream;
  readonly batches: number;
}

/**
 * What a bearer's store rows say, which is its own session's and its parent's
 * where it is a fork. Streams are answered whole and narrowed
 * by the route, because the durable side keys them by session alone and a
 * prefix is the reader's question rather than the row's.
 */
export interface SessionStoreQueryPort {
  batches(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
    readonly stream: SessionStoreStream;
    readonly after: number;
    readonly limit: number;
  }): Promise<readonly SessionStoreBatchWritten[]>;
  streams(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
  }): Promise<readonly SessionStoreStreamRow[]>;
}

/** One session of one project, as a key no other session of any project shares. */
export function sessionLiveKey(
  partition: Partition,
  session: SessionId,
): string {
  const { tenant, project } = partition;
  return `${String(tenant.length)}:${tenant}${String(project.length)}:${project}${session}`;
}

/** What publishing one post's live events found: handed over, or not now, which is no lane to hand them to or a session past what it may publish. */
export type SessionLivePublished = "Published" | "Unavailable";

/**
 * Publishing what a session's runner reports of a turn in flight to whoever
 * is reading that session now, where nothing keeps an event nobody heard. Of
 * a post naming a turn its session does not hold claimed, only the end of the
 * turn's stream is handed over: a turn that ended has no stream for a late
 * event to reopen, and an end reopens none.
 */
export interface SessionLivePublishPort {
  publish(input: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly turn: SessionTurnId;
    readonly events: readonly SessionLiveEvent[];
  }): Promise<SessionLivePublished>;
}
