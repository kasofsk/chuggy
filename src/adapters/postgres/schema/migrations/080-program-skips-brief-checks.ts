/**
 * A release refused because its program leaves out the task its brief's check
 * lines join is settled under the fault's own code.
 *
 * `decision_input_outcome_is_known` IS REPLACED, admitting
 * `ProgramSkipsBriefChecks` beside every code 074 admitted, so no stored row is
 * refused by the new constraint.
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

/** The boundary's own refusals: 074's, and the one this adds. */
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
  "ProgramSkipsBriefChecks",
  "OverridesUnsupported",
  "OverridesUnknown",
  "TicketCapacityReached",
  "FinalizationRequestClosed",
  "OverridesMoveDefinition",
];

function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration080: Migration = {
  version: 80,
  name: "a release whose program leaves out its brief's checks is refused under the fault's own code",
  statements: [
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_outcome_is_known,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusals])}))))`,
  ],
};
