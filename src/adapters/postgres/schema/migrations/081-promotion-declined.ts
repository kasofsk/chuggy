/**
 * A reading that found the candidate absent after the repository declined the
 * push keeps the decline beside its verdict, and a finalization held there is
 * one a resume can clear.
 *
 * `finalization_reconciliation` GAINS `declined`, absent on every row that
 * exists and on every reading but `NotPromoted`, and the finalizer is granted
 * its update as it is the verdict's, the reading that settles an unreadable
 * one replacing it whole.
 *
 * `finalization_request_hold_kind_is_known` IS REPLACED, admitting
 * `PromotionDeclined` and `PromotionWorkflowsRefused` after every kind 007
 * admitted, so no stored row is refused by the new constraint.
 */

import { finalizerRole, type Migration } from "../shared.ts";

/** The holds 007 admitted, and the two this adds, in the order the wire names them. */
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
];

/** The declines a reading may keep. */
const promotionDeclines = ["RemoteDeclined", "WorkflowsRefused"];

/** The array a CHECK names its members in, written as the server reads it back. */
function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration081: Migration = {
  version: 81,
  name: "a push the repository declined is held under its own kind",
  statements: [
    `ALTER TABLE public.finalization_reconciliation
       ADD COLUMN declined text,
       ADD CONSTRAINT finalization_reconciliation_decline_is_known CHECK (((declined IS NULL) OR ((verdict = 'NotPromoted'::text) AND (declined = ANY (${textArray(promotionDeclines)})))))`,
    `GRANT UPDATE(declined) ON TABLE public.finalization_reconciliation TO ${finalizerRole}`,
    `ALTER TABLE public.finalization_request
       DROP CONSTRAINT finalization_request_hold_kind_is_known,
       ADD CONSTRAINT finalization_request_hold_kind_is_known CHECK (((hold_kind IS NULL) OR (hold_kind = ANY (${textArray(unavailableKinds)}))))`,
  ],
};
