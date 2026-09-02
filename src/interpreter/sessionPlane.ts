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
import type { Partition } from "./projectStore.ts";
import type { SessionAttemptEvidence } from "./sessionScheduler.ts";
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

/** Ending the attempt a bearer names, which is how a pod gives up its own. */
export interface SessionAttemptLossPort {
  lose(
    secret: SessionBearerSecret,
    generation: number,
    evidence: SessionAttemptEvidence,
  ): Promise<boolean>;
}

/**
 * Ending the attempt a bearer names as a hold rather than a loss, which is what
 * a pod whose provider refused its account has to report. The turns it claimed
 * go back to the mailbox uncharged, because nothing about the work failed and
 * nothing about the turn was tried.
 *
 * It names no evidence and no loss arm. A pod choosing either would be the thing
 * being controlled choosing what it is charged; there is exactly one condition a
 * pod may declare a hold for, and the definer function writes its own label.
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

/** What answering one turn found; answering twice with one result moves nothing. */
export type SessionTurnAnswered =
  "Answered" | "AlreadyAnswered" | "Conflict" | "Fenced";

/** What failing one turn found, the same three refusals an answer has. */
export type SessionTurnFailed =
  "Failed" | "AlreadyFailed" | "Conflict" | "Fenced";

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

/** One stream a session's store holds, and how many batches stand under it. */
export interface SessionStoreStreamRow {
  readonly stream: SessionStoreStream;
  readonly batches: number;
}

/**
 * What a session's own store rows say. Streams are answered whole and narrowed
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
  }): Promise<readonly SessionStoreBatchRow[]>;
  streams(input: {
    readonly secret: SessionBearerSecret;
    readonly generation: number;
  }): Promise<readonly SessionStoreStreamRow[]>;
}
