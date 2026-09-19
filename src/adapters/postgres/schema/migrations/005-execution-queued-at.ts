import type { Migration } from "../shared.ts";

/**
 * When a task entered the queue, which is what bounds the wait for a claimant
 * that can run it. Under claiming, work no claimant's capabilities cover sits
 * `Queued` forever and reads exactly like work that is merely waiting its turn;
 * this column is what lets a pass tell them apart and turn the second into
 * ticket evidence.
 *
 * It is separate from `available_at` because a retry moves that one, and the
 * window must measure the original wait rather than the last deferral. A row
 * that has ever been claimed carries a nonzero attempt and is outside the
 * window by construction: somebody could run it.
 */
export const migration005: Migration = {
  version: 5,
  name: "execution-queued-at",
  statements: [
    `ALTER TABLE ticket_execution
       ADD COLUMN queued_at timestamptz NOT NULL DEFAULT now()`,
  ],
};
