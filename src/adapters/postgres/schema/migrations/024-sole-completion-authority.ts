import { executionSchedulerAuthorityKind } from "../../../../interpreter/executionScheduler.ts";
import { finalizerAuthorityKind } from "../../../../interpreter/finalizer.ts";
import { type Migration } from "../shared.ts";

/**
 * The completion tags belong to the boundaries that build them, as a rule the
 * database holds rather than one an ingress remembers. `accept_operation` never
 * writes a row these admit, because `parseTicketCommand` refuses the envelope
 * before one is offered; the constraint is what makes that refusal a property of
 * every writer, including a later one and including direct SQL. The membership
 * constraint is the other half: an authority kind is a granted string, so
 * without it an administrator could hand a principal the very kind the first
 * constraint checks for.
 */
export const migration024: Migration = {
  version: 24,
  name: "sole completion authority",
  statements: [
    `ALTER TABLE operation ADD CONSTRAINT operation_completion_is_its_boundary_s CHECK (
       CASE command_tag
         WHEN 'TaskDone' THEN authority_kind = '${executionSchedulerAuthorityKind}'
         WHEN 'ExecutionBlocked' THEN authority_kind = '${executionSchedulerAuthorityKind}'
         WHEN 'FinalizationResult' THEN authority_kind = '${finalizerAuthorityKind}'
         ELSE true
       END)`,
    `ALTER TABLE project_membership ADD CONSTRAINT project_membership_authority_is_no_boundary_s CHECK (
       authority_kind NOT IN ('${executionSchedulerAuthorityKind}','${finalizerAuthorityKind}'))`,
  ],
};
