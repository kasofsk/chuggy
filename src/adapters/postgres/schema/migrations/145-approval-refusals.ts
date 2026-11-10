/**
 * A release is refused under its own code where its selection names an
 * approval workload as the work, where an override changes a workload's runner
 * to or from `Approval`, and where its program draws an approval evaluator.
 *
 * `decision_input_outcome_is_known` IS REPLACED, admitting the three beside
 * every code 114 admitted, so no stored row is refused by the new constraint.
 */

import type { Migration } from "../shared.ts";
import {
  boundaryRefusals as boundaryRefusalsAt085,
  domainRefusals as domainRefusalsAt085,
  textArray,
} from "./085-dependencies-change.ts";

/** Every refusal the machine decides, as 114 admitted them. */
const domainRefusals = [...domainRefusalsAt085, "EvaluationNotCurrent"];

/** The boundary's own refusals: 085's, and the three this adds. */
const boundaryRefusals = [
  ...boundaryRefusalsAt085,
  "ApprovalAsWork",
  "OverridesChangeApprovalRunner",
  "ApprovalNotRunnable",
];

export const migration145: Migration = {
  version: 145,
  name: "a release drawing an approval it may not is refused under the fault's own code",
  statements: [
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_outcome_is_known,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusals])}))))`,
  ],
};
