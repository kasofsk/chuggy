/**
 * The store one numbered batch of bytes is written to and read from, neutral
 * about what wrote it.
 *
 * A HOLDER IS OPAQUE AND ORDERED. Whatever a batch belongs to — a session and
 * its stream, an attempt and its run — is named here as a kind and the parts
 * that identify it, and this port interprets none of them. A store keys a
 * batch by the holder it was written under, so two holders never collide and
 * nothing here needs to know which kinds exist.
 *
 * READS AND WRITES ARE SEPARATE PORTS because they have separate holders: what
 * writes a batch reads none of another's, and what reads a stored batch writes
 * nothing.
 */

import type { Partition } from "./projectStore.ts";

/** What a batch was written under, which this port carries and never reads. */
export interface BlobHolder {
  readonly kind: string;
  readonly parts: readonly string[];
}

/** One numbered batch of one holder's bytes, which both ports address. */
export interface BlobObject {
  readonly partition: Partition;
  readonly holder: BlobHolder;
  readonly batch: number;
}

/**
 * What storing one batch's bytes found. `Refused` is a definitive inability to
 * hold more; `Unavailable` is temporary and leaves the batch unwritten.
 */
export type BlobStored =
  | { readonly stored: "Stored" }
  | { readonly stored: "Refused"; readonly reason: "QuotaExceeded" }
  | { readonly stored: "Conflict" }
  | { readonly stored: "Unavailable"; readonly retryAfterSeconds: number };

/**
 * What reading one batch found. `Corrupt` is bytes the store holds that no
 * reader can speak for, which is not the same as a batch it never held.
 */
export type BlobRead =
  | { readonly read: "Content"; readonly content: string }
  | { readonly read: "NotFound" }
  | { readonly read: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly read: "Corrupt" };

export interface BlobWritePort {
  storeBlob(
    input: BlobObject & { readonly content: Uint8Array },
  ): Promise<BlobStored>;
}

export interface BlobReadPort {
  readBlob(object: BlobObject): Promise<BlobRead>;
}

/** Every holder kind this tree stores under, which a store never adds to itself. */
export const blobHolderKinds = { session: "session", attempt: "attempt" };
