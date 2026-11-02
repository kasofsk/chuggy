/**
 * A pull request its base's merge queue removed twice for failed checks is
 * sent back to work against the base the queue merged it onto.
 *
 * `finalization_attempt_failure_kind_is_known` IS REPLACED, admitting
 * `QueueChecksFailed` beside the two kinds that stood, so no stored row is
 * refused by it.
 *
 * `finalization_attempt` GAINS THE BASE A PROPOSAL'S FAILURE WAS READ AGAINST
 * AND THE COMMIT ITS QUEUE BUILT: `proposal_base_ref` and
 * `proposal_base_commit`, kept together and only on a conflict or a queue's
 * failed checks, which one always keeps; and `queue_group_commit`, kept only on
 * the second. Every row there is keeps none, which every row there is may. The
 * finalizer's insert is granted on the whole table, so its grant does not
 * change.
 *
 * THE SCHEDULER READS THE FAILURE A REWORK'S ATTEMPT RECORDS, and nothing
 * else of the attempt: the columns that find one row and the four that say
 * why it failed and against what, which the rework's brief is written from.
 */

import { schedulerRole, type Migration } from "../shared.ts";

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'::text";

export const migration107: Migration = {
  version: 107,
  name: "a merge queue's failed checks send a pull request back to work",
  statements: [
    `ALTER TABLE public.finalization_attempt
       DROP CONSTRAINT finalization_attempt_failure_kind_is_known,
       ADD CONSTRAINT finalization_attempt_failure_kind_is_known
         CHECK (((failure_kind IS NULL) OR (failure_kind = ANY (ARRAY['MergeConflict'::text, 'PreparationFailed'::text, 'QueueChecksFailed'::text]))))`,
    `ALTER TABLE public.finalization_attempt
       ADD COLUMN proposal_base_ref text,
       ADD COLUMN proposal_base_commit text,
       ADD COLUMN queue_group_commit text`,
    `ALTER TABLE public.finalization_attempt
       ADD CONSTRAINT finalization_attempt_proposal_base_is_whole
         CHECK (((proposal_base_ref IS NULL) = (proposal_base_commit IS NULL))
                AND ((proposal_base_ref IS NULL)
                     OR ((length(proposal_base_ref) >= 1)
                         AND (length(proposal_base_ref) <= 256)
                         AND (proposal_base_commit ~ ${gitObject})
                         AND (failure_kind = ANY (ARRAY['MergeConflict'::text, 'QueueChecksFailed'::text]))))
                AND ((queue_group_commit IS NULL)
                     OR ((queue_group_commit ~ ${gitObject})
                         AND (failure_kind = 'QueueChecksFailed'::text)))
                AND ((failure_kind IS DISTINCT FROM 'QueueChecksFailed'::text)
                     OR (proposal_base_ref IS NOT NULL)))`,
    `GRANT SELECT (tenant, project, attempt, failure_kind, proposal_base_ref,
                   proposal_base_commit, queue_group_commit)
       ON TABLE public.finalization_attempt TO ${schedulerRole}`,
  ],
};
