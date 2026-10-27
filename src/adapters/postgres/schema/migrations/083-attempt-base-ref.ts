/**
 * An attempt keeps the ref its target commit was read from where the remote did
 * not hold the target itself, and a reading that found such a target still
 * absent concludes as not promoted.
 *
 * `finalization_attempt` GAINS `target_base_ref`, absent on every row that
 * exists, which reads as a target the remote held. The finalizer's insert is
 * granted on the whole table, so no grant changes.
 *
 * `finalization_reconciliation_reading_is_whole` IS REPLACED, admitting a
 * `NotPromoted` reading that observed no commit whether or not it keeps a
 * decline. It only widens, so no stored row is refused by it.
 */

import type { Migration } from "../shared.ts";

export const migration083: Migration = {
  version: 83,
  name: "an attempt keeps the base its unheld target was read from",
  statements: [
    `ALTER TABLE public.finalization_attempt
       ADD COLUMN target_base_ref text,
       ADD CONSTRAINT finalization_attempt_target_base_ref_is_bounded CHECK (((COALESCE(length(target_base_ref), 1) >= 1) AND (COALESCE(length(target_base_ref), 1) <= 256)))`,
    `ALTER TABLE public.finalization_reconciliation
       DROP CONSTRAINT finalization_reconciliation_reading_is_whole,
       ADD CONSTRAINT finalization_reconciliation_reading_is_whole CHECK ((((verdict = 'Unreadable'::text) = (observed_commit IS NULL)) OR (verdict = 'NotPromoted'::text)))`,
  ],
};
