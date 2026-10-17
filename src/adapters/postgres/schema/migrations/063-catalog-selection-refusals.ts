/**
 * A release refused because what its draft asks of a configuration is not
 * what the configuration holds is settled under the fault's own code.
 *
 * `decision_input_outcome_is_known` IS REPLACED, admitting `SelectionUnknown`,
 * `SelectionUnsupported` and `ProgramExceedsPlan` beside the pairing faults
 * 053 admitted: each is mended by revising the draft, where
 * `ConfigurationInvalid` is a fault of the configuration document. Every code
 * 053 admitted is admitted still, so no stored row is refused by the new
 * constraint.
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

/** The boundary's own refusals: 053's, and the three this adds. */
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
  "TicketCapacityReached",
  "FinalizationRequestClosed",
  "OverridesMoveDefinition",
];

function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration063: Migration = {
  version: 63,
  name: "a release asking a configuration for what it does not hold is refused under the fault's own code",
  statements: [
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_outcome_is_known,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusals])}))))`,
  ],
};
