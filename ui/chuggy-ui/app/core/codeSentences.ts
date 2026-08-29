/**
 * The coded values the wire sends a person, as the sentences they read.
 *
 * A code is the API's word to another program; a screen that prints it makes
 * the reader look it up, and there is nowhere to look. Each switch is total
 * over the roster it speaks for, so a member gained stops compiling here rather
 * than reaching a reader as an unexplained word, and
 * `test/ui/mutationSentences.test.ts` drives the boundary's own response
 * builders to hold the two rosters below to what those routes can answer with.
 *
 * EVERY FALLBACK NAMES ITSELF AS ONE. A code belonging to no roster is said to
 * be unknown rather than explained away, so a reader is told the console has
 * nothing for it — and so the suite above can tell a rostered answer from a
 * fallback, which is the only thing that makes its forward direction bite.
 */

import {
  operationRefusalCodes,
  type EscalationReason,
  type NativeActionKind,
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

/** What an open native action is asking, short enough for a badge to carry. */
export function nativeActionKindSentence(kind: NativeActionKind): string {
  switch (kind) {
    case "TicketEscalation":
      return "escalated";
    case "HandoffBlock":
      return "handoff blocked";
    case "FinalizationApproval":
      return "awaiting your approval";
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
      return "the configuration this named is not one the project will run, or it hands the work off where this brief opens a pull request";
    case "TicketChanged":
      return "the ticket changed after this was submitted";
    case "SelectionChanged":
      return "the dispatch selection this answered is no longer the current one";
    case "CommandUnreadable":
      return "the API could not read the command this console submitted";
    case "ExecutionSourceUnreadable":
      return "the repository reference this ticket's work would start from is not on the remote";
    case "ExecutionSourceDenied":
      return "the remote declined the credential this project holds for the repository";
  }
}

/**
 * The coded refusals the boundary itself answers a submission or a cancellation
 * with, which is a roster disjoint from the actor's own: a refusal there is a
 * decision the actor made, and one here is the boundary declining to carry the
 * request to it at all. `ProjectionBehind` is not among them because the follow
 * reads it as a step rather than as a failure.
 */
export const mutationRefusalCodes = [
  "IdempotencyConflict",
  "InvalidMutation",
  "MutationNotAdmitted",
  "OperationNotPending",
] as const;
export type MutationRefusalCode = (typeof mutationRefusalCodes)[number];

export function mutationRefusalSentence(code: MutationRefusalCode): string {
  switch (code) {
    case "IdempotencyConflict":
      return "a different command was already submitted under this one's key";
    case "InvalidMutation":
      return "the API would not accept the mutation this console built";
    case "MutationNotAdmitted":
      return "the project is not admitting this kind of mutation at the moment";
    case "OperationNotPending":
      return "that operation had already been decided, so there was nothing left to call off";
  }
}

/** The coded deferrals the same two routes answer with, each meaning try again. */
export const mutationDeferralCodes = [
  "DispatchBacklog",
  "MailboxBackpressure",
  "MailboxUnavailable",
] as const;
export type MutationDeferralCode = (typeof mutationDeferralCodes)[number];

export function mutationDeferralSentence(code: string): string {
  switch (mutationDeferralCodeOf(code)) {
    case "DispatchBacklog":
      return "the project has more waiting to be dispatched than it will take at once";
    case "MailboxBackpressure":
      return "the actor's mailbox is full";
    case "MailboxUnavailable":
      return "the actor's mailbox is not reachable";
    case undefined:
      return `the API asked for this to be sent again, and named a reason this console does not know (${code})`;
  }
}

function operationRefusalCodeOf(
  code: string,
): OperationRefusalCode | undefined {
  return operationRefusalCodes.find((known) => known === code);
}

function mutationRefusalCodeOf(code: string): MutationRefusalCode | undefined {
  return mutationRefusalCodes.find((known) => known === code);
}

function mutationDeferralCodeOf(
  code: string,
): MutationDeferralCode | undefined {
  return mutationDeferralCodes.find((known) => known === code);
}

/**
 * Why a submission did not get through. A coded reason is read from whichever
 * roster owns it; one belonging to neither is named as unrecognised rather than
 * offered to the reader as the explanation.
 */
export function operationFailureSentence(failure: ApiFailure): string {
  switch (failure.outcome) {
    case "Unauthenticated":
      return "this session is not signed in";
    case "Absent":
      return "the API has no such operation, or will not show it to you";
    case "Retryable":
      return `it kept being sent again and kept being deferred: ${mutationDeferralSentence(failure.code)}`;
    case "Unreachable":
      return `the API could not be reached: ${failure.reason}`;
    case "Unreadable":
      return `the API answered something this console cannot read: ${failure.reason}`;
    case "Conflict":
    case "Rejected":
    case "Fault": {
      const refusal = operationRefusalCodeOf(failure.code);
      if (refusal !== undefined) return operationRefusalSentence(refusal);
      const declined = mutationRefusalCodeOf(failure.code);
      if (declined !== undefined) return mutationRefusalSentence(declined);
      return `the API refused this, and named a reason this console does not know (${failure.code})`;
    }
  }
}
