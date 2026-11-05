/**
 * A serialized landing whose target moved past the commit it evaluated is sent
 * back to re-check, and held once it has been sent back as often as its bound
 * allows.
 *
 * `finalization_attempt_failure_kind_is_known` IS REPLACED, admitting
 * `RecheckRequired` beside the three kinds that stood.
 * `finalization_request_hold_kind_is_known` IS REPLACED, admitting
 * `RecheckReworksExhausted` beside every kind 106 admitted, and
 * `input_bundle_reference_kind_is_known` IS REPLACED, admitting `Recheck`
 * beside every kind 062 admitted, so no stored row is refused by any of them.
 *
 * `finalization_attempt` GAINS `recheck_commit`, the accepted commit the
 * re-check reports again, kept exactly on a `RecheckRequired` failure. Every
 * row there is keeps none, which every row there is may. The finalizer's
 * insert is granted on the whole table, so its grant does not change.
 */

import type { Migration } from "../shared.ts";

const gitObject = "'^([0-9a-f]{40}|[0-9a-f]{64})$'::text";

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

/** The holds 106 admitted, and the one this adds. */
const unavailableKinds = [
  "RepositoryUnbound",
  "TargetUnreadable",
  "ProposalBaseUnreadable",
  "ProposalBaseIsHead",
  "ProposalDenied",
  "ReconciliationUnreadable",
  "ProposalEvidenceUnstorable",
  "ProposalAbsent",
  "ProposalUnaddressed",
  "ProposalUnavailable",
  "PreparationRestartsExhausted",
  "ProposalCreationsExhausted",
  "ProposalMergesExhausted",
  "PromotionDeclined",
  "PromotionWorkflowsRefused",
  "ProposalQueueChecksFailed",
  "ProposalQueueTimedOut",
  "ProposalDequeued",
  "RecheckReworksExhausted",
];

/** Every kind 062 admitted, and the one this adds. */
const inputBundleReferenceKinds = [
  "ResultManifest",
  "ConfigurationRevision",
  "Repository",
  "FinalizationAttempt",
  "ConflictManifest",
  "TargetCommit",
  "ProjectArtifact",
  "ChangeBase",
  "DependencyResult",
  "DependencyAncestor",
  "DependencyNotAncestor",
  "Recheck",
];

export const migration116: Migration = {
  version: 116,
  name: "a target that moved past what a serialized landing evaluated sends it back to re-check",
  statements: [
    `ALTER TABLE public.finalization_attempt
       DROP CONSTRAINT finalization_attempt_failure_kind_is_known,
       ADD CONSTRAINT finalization_attempt_failure_kind_is_known
         CHECK (((failure_kind IS NULL) OR (failure_kind = ANY (${textArray(["MergeConflict", "PreparationFailed", "QueueChecksFailed", "RecheckRequired"])}))))`,
    `ALTER TABLE public.finalization_attempt
       ADD COLUMN recheck_commit text`,
    `ALTER TABLE public.finalization_attempt
       ADD CONSTRAINT finalization_attempt_recheck_commit_is_whole
         CHECK (((recheck_commit IS NULL) = (failure_kind IS DISTINCT FROM 'RecheckRequired'::text))
                AND ((recheck_commit IS NULL) OR (recheck_commit ~ ${gitObject})))`,
    `ALTER TABLE public.finalization_request
       DROP CONSTRAINT finalization_request_hold_kind_is_known,
       ADD CONSTRAINT finalization_request_hold_kind_is_known CHECK (((hold_kind IS NULL) OR (hold_kind = ANY (${textArray(unavailableKinds)}))))`,
    `ALTER TABLE public.input_bundle_reference
       DROP CONSTRAINT input_bundle_reference_kind_is_known,
       ADD CONSTRAINT input_bundle_reference_kind_is_known CHECK ((reference_kind = ANY (${textArray(inputBundleReferenceKinds)})))`,
  ],
};
