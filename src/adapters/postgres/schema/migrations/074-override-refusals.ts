/**
 * A release refused because its draft's overrides do not fit its
 * configuration is settled under the fault's own code.
 *
 * `decision_input_outcome_is_known` IS REPLACED, admitting
 * `OverridesUnsupported` and `OverridesUnknown` beside every code 063
 * admitted, so no stored row is refused by the new constraint.
 */

import type { Migration } from "../shared.ts";

/** The machine's refusals, which 015 admitted. */
const domainRefusals = [
  "TicketAlreadyExists",
  "SelfDependency",
  "TicketNotFound",
  "TicketNotPending",
  "TicketIdentityMismatch",
  "TicketDependenciesChanged",
  "TicketNotRevocable",
  "TicketNotResumable",
  "DependenciesNotFound",
  "DependenciesIncomplete",
  "TicketRevisionStale",
  "TaskNotCurrent",
  "FinalizationNotCurrent",
];

/** The boundary's own refusals: 063's, and the two this adds. */
const boundaryRefusals = [
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
  "ExecutionSourceUnreadable",
  "ExecutionSourceDenied",
  "BriefNamesNoRepository",
  "BriefChecksUncommanded",
  "ConfigurationFromAnotherRepository",
  "SelectionUnknown",
  "SelectionUnsupported",
  "ProgramExceedsPlan",
  "OverridesUnsupported",
  "OverridesUnknown",
  "TicketCapacityReached",
  "FinalizationRequestClosed",
  "OverridesMoveDefinition",
];

function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration074: Migration = {
  version: 74,
  name: "a release whose overrides do not fit its configuration is refused under the fault's own code",
  statements: [
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_outcome_is_known,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusals])}))))`,
  ],
};
