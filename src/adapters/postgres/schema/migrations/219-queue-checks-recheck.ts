/**
 * A merge queue's failed checks are re-checked on the base before the change
 * goes back to an agent, so a `QueueChecksFailed` failure may name the head it
 * sends back to be re-checked.
 *
 * `finalization_attempt_recheck_commit_is_whole` IS REPLACED, still requiring
 * the accepted commit on a `RecheckRequired` and a `Restack` failure and
 * refusing it on every other kind but `QueueChecksFailed`, where it is
 * optional. Every stored row keeps to the narrower rule 175 left, so none is
 * refused by the wider one.
 */

import type { Migration } from "../shared.ts";
import { textArray } from "./085-dependencies-change.ts";

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'";

export const migration219: Migration = {
  version: 219,
  name: "a merge queue's failed checks may name the head they send back to be re-checked",
  statements: [
    `ALTER TABLE public.finalization_attempt
       DROP CONSTRAINT finalization_attempt_recheck_commit_is_whole,
       ADD CONSTRAINT finalization_attempt_recheck_commit_is_whole
         CHECK (((failure_kind IS NULL) OR (failure_kind <> ALL (${textArray(["RecheckRequired", "Restack"])})) OR (recheck_commit IS NOT NULL))
                AND ((recheck_commit IS NULL) OR (failure_kind = ANY (${textArray(["QueueChecksFailed", "RecheckRequired", "Restack"])})))
                AND ((recheck_commit IS NULL) OR (recheck_commit ~ ${gitObject}::text)))`,
  ],
};
