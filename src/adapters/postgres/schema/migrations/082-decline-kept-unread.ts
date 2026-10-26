/**
 * A declined push keeps its decline on the reading that first follows it,
 * whatever the ref proved short of the candidate, and a reading that found the
 * ref absent after a decline concludes as not promoted.
 *
 * `finalization_reconciliation_decline_is_known` IS REPLACED, admitting a
 * decline beside `Unreadable` as well as `NotPromoted`, so a re-reading can
 * carry it to the verdict that concludes.
 *
 * `finalization_reconciliation_reading_is_whole` IS REPLACED, admitting a
 * `NotPromoted` reading that observed no commit where it keeps a decline, the
 * ref the declined push would have created being absent. Both constraints only
 * widen, so no stored row is refused by either.
 */

import type { Migration } from "../shared.ts";

export const migration082: Migration = {
  version: 82,
  name: "a declined push is kept on an unread reading and concludes over an absent ref",
  statements: [
    `ALTER TABLE public.finalization_reconciliation
       DROP CONSTRAINT finalization_reconciliation_decline_is_known,
       DROP CONSTRAINT finalization_reconciliation_reading_is_whole,
       ADD CONSTRAINT finalization_reconciliation_decline_is_known CHECK (((declined IS NULL) OR ((verdict <> 'Promoted'::text) AND (declined = ANY (ARRAY['RemoteDeclined'::text, 'WorkflowsRefused'::text]))))),
       ADD CONSTRAINT finalization_reconciliation_reading_is_whole CHECK ((((verdict = 'Unreadable'::text) = (observed_commit IS NULL)) OR ((verdict = 'NotPromoted'::text) AND (declined IS NOT NULL))))`,
  ],
};
