/**
 * One refusal of every code a settled operation can carry, over the tickets a
 * suite names, shared by the suites that read them as lines.
 *
 * The record is keyed by code and checked against the whole roster, so a code
 * the wire gains is a compile error here before it is a line nobody has read.
 */

import type { OperationRefusalCode } from "../../../src/contract/rosters.ts";
import type { OperationRefusal } from "../app/core/codeSentences.ts";

export type OperationRefusalSamples = {
  readonly [Code in OperationRefusalCode]: Extract<
    OperationRefusal,
    { readonly type: Code }
  >;
};

/** A refusal over `ticket`, any dependencies being `dependencies`. */
export function operationRefusalSamples(
  ticket: number,
  dependencies: number[],
): OperationRefusalSamples {
  const over = { ticket, dependencies };
  return {
    TicketAlreadyExists: { type: "TicketAlreadyExists", value: ticket },
    DependenciesNotFound: { type: "DependenciesNotFound", value: over },
    DependenciesRevoked: { type: "DependenciesRevoked", value: over },
    DependencyCycle: { type: "DependencyCycle", value: over },
    SelfDependency: { type: "SelfDependency", value: ticket },
    TicketNotFound: { type: "TicketNotFound", value: ticket },
    TicketNotPending: { type: "TicketNotPending", value: ticket },
    TicketIdentityMismatch: { type: "TicketIdentityMismatch", value: ticket },
    TicketRevisionStale: {
      type: "TicketRevisionStale",
      value: { ticket, expected: 2, current: 5 },
    },
    DependenciesIncomplete: { type: "DependenciesIncomplete", value: over },
    TicketNotRevocable: { type: "TicketNotRevocable", value: ticket },
    TicketNotResumable: { type: "TicketNotResumable", value: ticket },
    TaskNotCurrent: {
      type: "TaskNotCurrent",
      value: {
        ticket,
        task: { type: "WorkTask", value: { ticket, cycle: 3 } },
      },
    },
    FinalizationNotCurrent: {
      type: "FinalizationNotCurrent",
      value: { ticket, workCycle: 3, generation: 2 },
    },
    AuthoringChanged: { type: "AuthoringChanged" },
    ConfigurationInvalid: { type: "ConfigurationInvalid" },
    TicketChanged: { type: "TicketChanged" },
    SelectionChanged: { type: "SelectionChanged" },
    ExecutionSourceUnreadable: { type: "ExecutionSourceUnreadable" },
    ExecutionSourceDenied: { type: "ExecutionSourceDenied" },
    BriefNamesNoRepository: { type: "BriefNamesNoRepository" },
    BriefChecksUncommanded: { type: "BriefChecksUncommanded" },
    ConfigurationFromAnotherRepository: {
      type: "ConfigurationFromAnotherRepository",
    },
    SelectionUnknown: { type: "SelectionUnknown" },
    SelectionUnsupported: { type: "SelectionUnsupported" },
    ProgramExceedsPlan: { type: "ProgramExceedsPlan" },
    ProgramSkipsBriefChecks: { type: "ProgramSkipsBriefChecks" },
    OverridesUnsupported: { type: "OverridesUnsupported" },
    OverridesUnknown: { type: "OverridesUnknown" },
    TicketCapacityReached: { type: "TicketCapacityReached" },
    FinalizationRequestClosed: { type: "FinalizationRequestClosed" },
    OverridesMoveDefinition: { type: "OverridesMoveDefinition" },
  };
}
