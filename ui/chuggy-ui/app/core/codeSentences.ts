/**
 * The coded values the wire sends a person, as the sentences they read.
 *
 * A code is the API's word to another program; a screen that prints it makes
 * the reader look it up, and there is nowhere to look. Each switch is total
 * over the contract's own roster, so a member the wire gains stops compiling
 * here rather than reaching a reader as an unexplained word.
 */

import {
  operationRefusalCodes,
  type EscalationReason,
  type OperationRefusalCode,
  type OperationState,
} from "../../../../src/contract/rosters.ts";
import type { ApiFailure } from "./apiRequest.ts";

/** Which wall the ticket hit, in the person's own terms. */
export function escalationReasonSentence(reason: EscalationReason): string {
  switch (reason) {
    case "WorkFailed":
      return "the work did not pass its evaluation";
    case "ReworkBudgetExhausted":
      return "the rework this ticket was authored to pay for ran out";
    case "FinalizationBudgetExhausted":
      return "the finalization this ticket was authored to pay for ran out";
    case "GasExhausted":
      return "the ticket has no gas left to re-enter a phase with";
    case "DependencyRevoked":
      return "a ticket this one depends on was revoked, so it can never run";
    case "ExecutionPolicyDenied":
      return "the platform's policy refused to run this ticket's contract";
    case "TicketConfigIncompatible":
      return "this ticket's configuration cannot run on the platform it asked for";
    case "ExecutionProfileUnavailable":
      return "no execution profile the platform offers matches this ticket";
    case "RuntimeVersionUnsupported":
      return "the runtime version this ticket requires is not supported";
    case "RequiredCapabilityUnavailable":
      return "a capability this ticket requires is not available to run it";
  }
}

/** What the actor did with the submission, before any refusal code refines it. */
export function operationStateSentence(state: OperationState): string {
  switch (state) {
    case "Pending":
      return "the actor has not decided this yet";
    case "Succeeded":
      return "the actor accepted it";
    case "Refused":
      return "the actor refused it";
    case "Answered":
      return "the operation was answered without a decision being journaled";
    case "Cancelled":
      return "the operation was cancelled before it was decided";
  }
}

/** Why the actor declined the submitted mutation, and what to do about it. */
export function operationRefusalSentence(code: OperationRefusalCode): string {
  switch (code) {
    case "NotEnabled":
      return "the machine does not accept that here — the ticket has moved since this screen read it";
    case "AuthoringChanged":
      return "the ticket's authoring changed after this was submitted";
    case "ConfigurationInvalid":
      return "the configuration this named is not one the project will run";
    case "TicketChanged":
      return "the ticket changed after this was submitted";
    case "SelectionChanged":
      return "the dispatch selection this answered is no longer the current one";
    case "CommandUnreadable":
      return "the API could not read the command this console submitted";
  }
}

function operationRefusalCodeOf(
  code: string,
): OperationRefusalCode | undefined {
  return operationRefusalCodes.find((known) => known === code);
}

/**
 * Why a submission did not get through. A refusal the actor named is read from
 * its own roster; anything else is what the transport or the status said.
 */
export function operationFailureSentence(failure: ApiFailure): string {
  switch (failure.outcome) {
    case "Unauthenticated":
      return "this session is not signed in";
    case "Absent":
      return "the API has no such operation, or will not show it to you";
    case "Retryable":
      return `the API kept asking to be tried again (${failure.code})`;
    case "Unreachable":
      return `the API could not be reached: ${failure.reason}`;
    case "Unreadable":
      return `the API answered something this console cannot read: ${failure.reason}`;
    case "Conflict":
    case "Rejected":
    case "Fault": {
      const refusal = operationRefusalCodeOf(failure.code);
      return refusal === undefined
        ? `the API answered ${failure.code}`
        : operationRefusalSentence(refusal);
    }
  }
}
