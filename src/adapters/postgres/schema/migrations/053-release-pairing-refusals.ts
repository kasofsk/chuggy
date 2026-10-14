/**
 * A release refused because its brief and configuration do not pair is
 * settled under the fault's own code.
 *
 * `decision_input_outcome_is_known` IS REPLACED, admitting
 * `BriefChecksUncommanded` and `ConfigurationFromAnotherRepository` beside
 * `BriefNamesNoRepository`, which 015 admitted for the same reason: each is
 * mended by revising the brief, where `ConfigurationInvalid` is a fault of the
 * configuration document. Every code 043 admitted is admitted still, so no
 * stored row is refused by the new constraint.
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

/** The boundary's own refusals: 043's, and the two this adds. */
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
  "TicketCapacityReached",
  "FinalizationRequestClosed",
  "OverridesMoveDefinition",
];

function textArray(values: readonly string[]): string {
  return `ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]`;
}

export const migration053: Migration = {
  version: 53,
  name: "a release whose brief and configuration do not pair is refused under the fault's own code",
  statements: [
    `ALTER TABLE public.decision_input
       DROP CONSTRAINT decision_input_outcome_is_known,
       ADD CONSTRAINT decision_input_outcome_is_known CHECK ((outcome_code IS NULL OR (outcome_code = ANY (${textArray([...domainRefusals, ...boundaryRefusals])}))))`,
  ],
};
