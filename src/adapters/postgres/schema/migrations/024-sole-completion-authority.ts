import { executionSchedulerAuthorityKind } from "../../../../interpreter/executionScheduler.ts";
import { finalizerAuthorityKind } from "../../../../interpreter/finalizer.ts";
import { type Migration } from "../shared.ts";
import { acceptanceBody } from "./005-durable-prioritized-decision-mailbox.ts";

/**
 * A settled logical task is its boundary's to submit, stated in the two places
 * that can each be defeated alone.
 *
 * ACCEPTANCE ANSWERS IT FIRST. The completion tags leave the priority arm they
 * shared, so both fall to the `ELSE` that already answers `InvalidCommand` —
 * the same refusal a caller gets for any envelope the mailbox does not take,
 * and the reason this is one changed line rather than a second acceptance
 * function. `submit_task_completion` and `accept_dispatch_operation` route
 * through no arm of it and are unaffected.
 *
 * THE CONSTRAINTS ARE WHAT ACCEPTANCE CANNOT BE. `in_authority_kind` is a
 * parameter its caller chooses and acceptance compares to nothing, so a rule
 * that lived only in the function would bind only the callers that pass through
 * it. The tag-to-authority check binds every writer instead, and the membership
 * check is its other half: an authority kind is a granted string, so without it
 * an administrator could hand a principal the very kind the first checks for.
 *
 * THEY ARE `NOT VALID` DELIBERATELY. A database carrying a completion accepted
 * before this migration is carrying the row the defect produced, and a scan
 * that refused to migrate it would leave an installation with the hole open and
 * no way forward. `NOT VALID` enforces every write from here without auditing
 * the history, which is the shape a rule closing its own violations wants.
 */
export const migration024: Migration = {
  version: 24,
  name: "sole completion authority",
  statements: [
    `CREATE OR REPLACE ${acceptanceBody}`,
    `ALTER TABLE operation ADD CONSTRAINT operation_completion_authority_is_its_boundary CHECK (
       CASE command_tag
         WHEN 'TaskDone' THEN authority_kind = '${executionSchedulerAuthorityKind}'
         WHEN 'ExecutionBlocked' THEN authority_kind = '${executionSchedulerAuthorityKind}'
         WHEN 'FinalizationResult' THEN authority_kind = '${finalizerAuthorityKind}'
         ELSE true
       END) NOT VALID`,
    `ALTER TABLE project_membership ADD CONSTRAINT project_membership_grants_no_boundary_authority CHECK (
       authority_kind NOT IN ('${executionSchedulerAuthorityKind}','${finalizerAuthorityKind}')) NOT VALID`,
  ],
};
