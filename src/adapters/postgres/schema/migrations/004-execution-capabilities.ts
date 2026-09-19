import type { Migration } from "../shared.ts";

/**
 * What a queued task needs, denormalised onto its row so a claim can evaluate
 * it. The requirement lives inside the opaque obligation, which is not decoded
 * until one step after the claim — so with two claimants of different
 * capabilities they race for every row under SKIP LOCKED, and the one that
 * cannot run the work wins it about half the time, spends an attempt and
 * reports it unavailable while the one that could never sees it.
 *
 * The column inherits the obligation's immutability: it is written by the same
 * insert, from the same value, and nothing updates it. Rows written before this
 * migration carry the empty set, which is what they were claimed under.
 */
export const migration004: Migration = {
  version: 4,
  name: "execution-capabilities",
  statements: [
    `ALTER TABLE ticket_execution
       ADD COLUMN required_capabilities text[] NOT NULL DEFAULT '{}'`,
  ],
};
