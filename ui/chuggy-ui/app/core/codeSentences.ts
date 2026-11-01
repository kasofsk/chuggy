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
 *
 * A LINE'S LENGTH IS HELD PER PART. A line joined from two, as a creation's
 * refusal is to where its draft stands in `‹reason› · ‹held›`, keeps both facts
 * and may run longer than either; `test/codeSentencesShort.test.ts` holds each
 * part to the limit.
 */

import {
  programSkipsPlannedEvaluationsCode,
  type EscalationKind,
  type NativeActionKind,
  type OperationBoundaryRefusalCode,
  type OperationState,
} from "../../../../src/contract/rosters.ts";
import type {
  OperationResponse,
  TaskIdentity,
  TicketFollowing,
} from "../../../../src/contract/responses.ts";
import type { ApiFailure } from "./apiRequest.ts";
import { failureWords } from "./failureWords.ts";

/** Which wall the ticket hit, in the person's own terms. */
export function escalationKindSentence(kind: EscalationKind): string {
  switch (kind) {
    case "WorkFailureEscalated":
      return "Work failed or did not finish";
    case "EvaluationFailureEscalated":
      return "Out of rework";
    case "WorkExecutionUnavailableEscalated":
      return "Work could not be run";
    case "EvaluationBlockedEscalated":
      return "Evaluation could not run or finish";
    case "FinalizationUnavailableEscalated":
      return "Finalizing could not run";
  }
}

/** What an open native action is asking, short enough for a badge to carry. */
export function nativeActionKindSentence(kind: NativeActionKind): string {
  switch (kind) {
    case "TicketEscalation":
      return "escalated";
    case "FinalizationApproval":
      return "awaiting your approval";
  }
}

/** What the actor did with the submission, before any refusal code refines it. */
export function operationStateSentence(state: OperationState): string {
  switch (state) {
    case "Pending":
      return "Not decided yet";
    case "Succeeded":
      return "Accepted";
    case "Refused":
      return "Refused";
    case "Answered":
      return "Closed without a decision";
    case "Cancelled":
      return "Cancelled before a decision";
  }
}

/**
 * Why an operation was refused. The machine's refusal is the one the wire
 * carries beside the code, which names the tickets, task or attempt it was
 * refused over; the boundary's is its code alone.
 */
export type OperationRefusal =
  | Extract<OperationResponse, { readonly refusal: unknown }>["refusal"]
  | {
      readonly [Code in OperationBoundaryRefusalCode]: { readonly type: Code };
    }[OperationBoundaryRefusalCode];

/** A ticket as the console writes its number everywhere else. */
function operationRefusalTicket(ticket: number): string {
  return `#${String(ticket)}`;
}

/** Several tickets as one phrase, in the order the wire gave them. */
function operationRefusalTickets(tickets: readonly number[]): string {
  const named = tickets.map(operationRefusalTicket);
  const last = named.pop();
  if (last === undefined) return "no ticket";
  return named.length === 0 ? last : `${named.join(", ")} and ${last}`;
}

/** Which task a report was for, as its identity names it. */
function operationRefusalTask(task: TaskIdentity): string {
  switch (task.type) {
    case "WorkTask":
      return `cycle ${String(task.value.cycle)} work`;
    case "EvaluationTask":
      return `cycle ${String(task.value.workCycle)} stage ${String(task.value.stage)}`;
  }
}

/** Why the machine declined the command, naming what it declined over. */
function operationRefusalTicketSentence(
  refused: Extract<OperationRefusal, { readonly value: unknown }>,
): string {
  switch (refused.type) {
    case "TicketAlreadyExists":
      return `${operationRefusalTicket(refused.value)} already exists · Nothing to release`;
    case "DependenciesNotFound":
      return `${operationRefusalTicket(refused.value.ticket)} depends on missing ${operationRefusalTickets(refused.value.dependencies)}`;
    case "DependenciesRevoked":
      return `${operationRefusalTicket(refused.value.ticket)} depends on revoked ${operationRefusalTickets(refused.value.dependencies)} · Pick open ones`;
    case "DependencyCycle":
      return `${operationRefusalTicket(refused.value.ticket)} cannot depend on ${operationRefusalTickets(refused.value.dependencies)} · Would form a cycle`;
    case "SelfDependency":
      return `${operationRefusalTicket(refused.value)} depends on itself · Remove that dependency`;
    case "TicketNotFound":
      return `No ticket ${operationRefusalTicket(refused.value)}`;
    case "TicketNotPending":
      return `${operationRefusalTicket(refused.value)} is no longer pending`;
    case "TicketIdentityMismatch":
      return `Not the same ticket as ${operationRefusalTicket(refused.value)}`;
    case "TicketRevisionStale":
      return `${operationRefusalTicket(refused.value.ticket)} moved from revision ${String(refused.value.expected)} to revision ${String(refused.value.current)}`;
    case "DependenciesIncomplete":
      return `${operationRefusalTicket(refused.value.ticket)} waits on ${operationRefusalTickets(refused.value.dependencies)} · Not done yet`;
    case "TicketNotRevocable":
      return `${operationRefusalTicket(refused.value)} can no longer be revoked`;
    case "TicketNotResumable":
      return `${operationRefusalTicket(refused.value)} has nothing to resume`;
    case "TaskNotCurrent":
      return `Report for ${operationRefusalTask(refused.value.task)} of ${operationRefusalTicket(refused.value.ticket)} · Not current`;
    case "FinalizationNotCurrent":
      return `Finalizing result for cycle ${String(refused.value.workCycle)} of ${operationRefusalTicket(refused.value.ticket)} · Not current`;
  }
}

/** Why the actor declined the submitted mutation, and what to do about it. */
export function operationRefusalSentence(refused: OperationRefusal): string {
  if ("value" in refused) return operationRefusalTicketSentence(refused);
  switch (refused.type) {
    case "AuthoringChanged":
      return "Draft changed since submit";
    case "ConfigurationInvalid":
      return "Configuration or overrides cannot run";
    case "TicketChanged":
      return "Ticket changed since submit";
    case "SelectionChanged":
      return "Dispatch selection out of date";
    case "ExecutionSourceUnreadable":
      return "Start branch or commit not on the remote";
    case "ExecutionSourceDenied":
      return "Remote refused this project's credential";
    case "BriefNamesNoRepository":
      return "Brief names no repository · Name a bound one";
    case "BriefChecksUncommanded":
      return "No check stage · Drop the brief's checks";
    case "ConfigurationFromAnotherRepository":
      return "Configuration not from the brief's repository";
    case "SelectionUnknown":
      return "Workload, plan or finalizer not in the catalog";
    case "SelectionUnsupported":
      return "Selection needs a version 2 configuration";
    case "ProgramExceedsPlan":
      return "Program goes past the plan's stages";
    case "ProgramSkipsBriefChecks":
      return "Program skips the brief's checks · Restore them";
    case "OverridesUnsupported":
      return "Overrides do not fit this configuration";
    case "OverridesUnknown":
      return "Overrides name an unknown workload or prompt";
    case "TicketCapacityReached":
      return "Project full · Finish or revoke a ticket";
    case "FinalizationRequestClosed":
      return "Finalizing request closed · Ticket still waiting";
    case "OverridesMoveDefinition":
      return "Only start settings can change while parked";
  }
}

/**
 * Why a ticket that follows its configuration's newest revision stays on the
 * one it holds, as one line: a held one in the words its release would be
 * refused with. A ticket that is current or would move has nothing to say.
 */
export function ticketFollowingSentence(
  following: TicketFollowing | undefined,
): string | undefined {
  switch (following?.verdict) {
    case undefined:
    case "Current":
    case "Moves":
      return undefined;
    case "Held":
      return `Stays on this revision · ${operationRefusalSentence({ type: following.code })}`;
    case "Trimmed":
      return "Stays on this revision · Program skips part of its plan";
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
  programSkipsPlannedEvaluationsCode,
] as const;
export type MutationRefusalCode = (typeof mutationRefusalCodes)[number];

export function mutationRefusalSentence(code: MutationRefusalCode): string {
  switch (code) {
    case "IdempotencyConflict":
      return "Clashes with an earlier submit";
    case "InvalidMutation":
      return "Request not valid";
    case "MutationNotAdmitted":
      return "Project not taking this right now";
    case "OperationNotPending":
      return "Already decided · Nothing to cancel";
    case "ProgramSkipsPlannedEvaluations":
      return "Partial plan needs an administrator · Use the whole plan";
  }
}

/**
 * The conflicts the draft door answers a revision with. `DraftChanged` is the
 * version fence and `DraftNotEditable` a draft whose ticket has left Pending.
 */
export const draftRevisionRefusalCodes = [
  "DraftChanged",
  "DraftNotEditable",
] as const;
export type DraftRevisionRefusalCode =
  (typeof draftRevisionRefusalCodes)[number];

export function draftRevisionRefusalSentence(
  code: DraftRevisionRefusalCode,
): string {
  switch (code) {
    case "DraftChanged":
      return "Draft changed · Submit again";
    case "DraftNotEditable":
      return "Draft closed · Ticket no longer pending";
  }
}

/** Why a revision did not get through: the door's own conflict where it named
 * one, and a failure read as any submission's otherwise. */
export function draftRevisionFailureSentence(failure: ApiFailure): string {
  const code =
    failure.outcome === "Conflict"
      ? draftRevisionRefusalCodes.find((known) => known === failure.code)
      : undefined;
  return code === undefined
    ? operationFailureSentence(failure)
    : draftRevisionRefusalSentence(code);
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
      return "Dispatch queue full";
    case "MailboxBackpressure":
      return "Project queue full";
    case "MailboxUnavailable":
      return "Project unreachable";
    case undefined:
      return `Unknown reason (${code})`;
  }
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
 * Why a submission did not get through. A coded reason is read from the
 * boundary's roster, since the actor's refusals arrive on a settled operation
 * and never as a failure; a code outside it is named as unrecognised rather
 * than offered to the reader as the explanation.
 */
export function operationFailureSentence(failure: ApiFailure): string {
  switch (failure.outcome) {
    case "Unauthenticated":
      return "Signed out · Sign in again";
    case "Absent":
      return "Not found, or not visible to you";
    case "Retryable":
      return `Try later · ${mutationDeferralSentence(failure.code)}`;
    case "Unreachable":
    case "Unreadable":
      return failureWords(failure).word;
    case "Conflict":
    case "Rejected":
    case "Fault": {
      const declined = mutationRefusalCodeOf(failure.code);
      if (declined !== undefined) return mutationRefusalSentence(declined);
      return `Refused · Unknown reason (${failure.code})`;
    }
  }
}
