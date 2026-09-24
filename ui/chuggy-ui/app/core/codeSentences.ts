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

import type {
  EscalationKind,
  NativeActionKind,
  OperationBoundaryRefusalCode,
  OperationState,
} from "../../../../src/contract/rosters.ts";
import type {
  OperationResponse,
  TaskIdentity,
} from "../../../../src/contract/responses.ts";
import type { ApiFailure } from "./apiRequest.ts";

/** Which wall the ticket hit, in the person's own terms. */
export function escalationKindSentence(kind: EscalationKind): string {
  switch (kind) {
    case "WorkFailureEscalated":
      return "the work did not pass its evaluation";
    case "EvaluationFailureEscalated":
      return "this ticket has failed evaluation more times than rework allows";
    case "WorkExecutionUnavailableEscalated":
      return "the platform could not run this ticket's contract";
    case "EvaluationBlockedEscalated":
      return "the platform could not run this ticket's evaluation";
    case "FinalizationUnavailableEscalated":
      return "the platform could not finalize this ticket";
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
      return `the work of cycle ${String(task.value.cycle)}`;
    case "EvaluationTask":
      return `evaluator ${String(task.value.evaluator)} of stage ${String(task.value.stage)}, generation ${String(task.value.generation)}, in work cycle ${String(task.value.workCycle)}`;
  }
}

/** Why the machine declined the command, naming what it declined over. */
function operationRefusalTicketSentence(
  refused: Extract<OperationRefusal, { readonly value: unknown }>,
): string {
  switch (refused.type) {
    case "TicketAlreadyExists":
      return `${operationRefusalTicket(refused.value)} already exists, so there is nothing left to release`;
    case "DependenciesNotFound":
      return `${operationRefusalTicket(refused.value.ticket)} depends on ${operationRefusalTickets(refused.value.dependencies)}, which the project has no ticket for`;
    case "SelfDependency":
      return `${operationRefusalTicket(refused.value)} names itself as a dependency; revise it to depend only on other tickets`;
    case "TicketNotFound":
      return `the project has no ticket ${operationRefusalTicket(refused.value)}`;
    case "TicketNotPending":
      return `${operationRefusalTicket(refused.value)} is no longer pending, and only a pending ticket accepts this`;
    case "TicketIdentityMismatch":
      return `what was submitted describes a different ticket from ${operationRefusalTicket(refused.value)}`;
    case "TicketRevisionStale":
      return `this was written against revision ${String(refused.value.expected)} of ${operationRefusalTicket(refused.value.ticket)}, which is at revision ${String(refused.value.current)} now`;
    case "TicketDependenciesChanged":
      return `what ${operationRefusalTicket(refused.value)} depends on cannot change once it is released`;
    case "DependenciesIncomplete":
      return `${operationRefusalTicket(refused.value.ticket)} waits on ${operationRefusalTickets(refused.value.dependencies)}, which ${refused.value.dependencies.length === 1 ? "is" : "are"} not done yet`;
    case "TicketNotRevocable":
      return `${operationRefusalTicket(refused.value)} is past the point where it can be revoked`;
    case "TicketNotResumable":
      return `${operationRefusalTicket(refused.value)} is not stopped at anything a resume can pick up`;
    case "TaskNotCurrent":
      return `the report was for ${operationRefusalTask(refused.value.task)} of ${operationRefusalTicket(refused.value.ticket)}, which is not the task the ticket is waiting on`;
    case "FinalizationNotCurrent":
      return `the finalization result was for work cycle ${String(refused.value.workCycle)}, generation ${String(refused.value.generation)} of ${operationRefusalTicket(refused.value.ticket)}, which is not the finalization the ticket is waiting on`;
  }
}

/** Why the actor declined the submitted mutation, and what to do about it. */
export function operationRefusalSentence(refused: OperationRefusal): string {
  if ("value" in refused) return operationRefusalTicketSentence(refused);
  switch (refused.type) {
    case "AuthoringChanged":
      return "the ticket's authoring changed after this was submitted";
    case "ConfigurationInvalid":
      return "the configuration this named is not one the project will run, or it hands the work off where this brief opens a pull request";
    case "TicketChanged":
      return "the ticket changed after this was submitted";
    case "SelectionChanged":
      return "the dispatch selection this answered is no longer the current one";
    case "ExecutionSourceUnreadable":
      return "the repository reference this ticket's work would start from is not on the remote";
    case "ExecutionSourceDenied":
      return "the remote declined the credential this project holds for the repository";
    case "BriefNamesNoRepository":
      return "the brief names no repository; revise it to name one the project binds";
    case "TicketCapacityReached":
      return "the project has no room for this ticket: it holds as many as its configuration allows, or the number is past the ones it offers";
    case "FinalizationRequestClosed":
      return "the finalization request this result answered had closed before the result was decided, though the ticket still waits on that finalization";
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

/**
 * The conflicts the draft door answers a revision with. `DraftChanged` is the
 * version fence and `DraftNotEditable` a draft whose ticket has left Pending;
 * `DependenciesLocked` is a revision of a released draft that moves what its
 * ticket depends on, which the update it would release is refused for anyway.
 */
export const draftRevisionRefusalCodes = [
  "DraftChanged",
  "DraftNotEditable",
  "DependenciesLocked",
] as const;
export type DraftRevisionRefusalCode =
  (typeof draftRevisionRefusalCodes)[number];

export function draftRevisionRefusalSentence(
  code: DraftRevisionRefusalCode,
): string {
  switch (code) {
    case "DraftChanged":
      return "the draft changed while this form was open — it has been read again, so submitting now revises the current one";
    case "DraftNotEditable":
      return "the draft is closed to revision: only a pending ticket's draft can be revised";
    case "DependenciesLocked":
      return "what this ticket depends on cannot change once it is released";
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
      return "the project has more waiting to be dispatched than it will take at once";
    case "MailboxBackpressure":
      return "the actor's mailbox is full";
    case "MailboxUnavailable":
      return "the actor's mailbox is not reachable";
    case undefined:
      return `the API asked for this to be sent again, and named a reason this console does not know (${code})`;
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
      const declined = mutationRefusalCodeOf(failure.code);
      if (declined !== undefined) return mutationRefusalSentence(declined);
      return `the API refused this, and named a reason this console does not know (${failure.code})`;
    }
  }
}
