/**
 * The two ports one session's store is reached through, and the vocabulary the
 * durable side answers a write with. The store holds a session's transcript as
 * numbered batches of bytes, keyed by the session rather than by the attempt
 * that wrote them — an attempt-keyed store is lost the moment its pod is
 * reaped, which is the one thing a resumable session exists to prevent.
 *
 * READS AND WRITES ARE SEPARATE PORTS because they have separate holders: a pod
 * writes its own session's batches through the worker plane and never reads
 * another's, and a reader of a stored transcript writes nothing. An object
 * names no path, because a batch's path is derived wholly from its session, its
 * stream and its number, and a stored path would be a second spelling of a fact
 * one function already computes.
 */

import type { SessionId, SessionStoreStream } from "./agentSession.ts";
import type { Partition } from "./projectStore.ts";

/** One batch of one stream of one session's store, which is what both ports address. */
export interface SessionStoreObject {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly stream: SessionStoreStream;
  readonly batch: number;
}

/**
 * What storing one batch's bytes found. `Refused` is a definitive inability to
 * hold more; `Unavailable` is temporary and leaves the batch unwritten.
 */
export type SessionStoreStored =
  | { readonly stored: "Stored" }
  | { readonly stored: "Refused"; readonly reason: "QuotaExceeded" }
  | { readonly stored: "Conflict" }
  | { readonly stored: "Unavailable"; readonly retryAfterSeconds: number };

/** Where a session's batches are written, behind a store-neutral port. */
export interface SessionStoreWritePort {
  store(
    input: SessionStoreObject & { readonly content: Uint8Array },
  ): Promise<SessionStoreStored>;
}

/**
 * What reading one batch found. `Corrupt` is bytes the store holds that no
 * reader can speak for, which is not the same as a batch it never held.
 */
export type SessionStoreRead =
  | { readonly read: "Content"; readonly content: string }
  | { readonly read: "NotFound" }
  | { readonly read: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly read: "Corrupt" };

/** Where a session's batches are read from, behind a store-neutral port. */
export interface SessionStoreReadPort {
  readBatch(object: SessionStoreObject): Promise<SessionStoreRead>;
}

/** What the durable side says a session's store holds, without the bytes it points at. */
export type SessionStoreRecorded =
  | "Stored"
  | "AlreadyStored"
  | "OutOfOrder"
  | "Conflict"
  | "QuotaExceeded"
  | "Fenced";
