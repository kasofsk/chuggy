/**
 * The coded values the wire sends a person, as the sentences they read:
 * descriptors, whose words are `sentences.ftl`'s.
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
 * and may run longer than either;
 * `ui/chuggy-ui/test/codeSentencesShort.test.ts` holds each part to the limit.
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
import type { Copy } from "./copy.ts";
import { failureWords } from "./failureWords.ts";

/** Which wall the ticket hit, in the person's own terms. */
export function escalationKindSentence(kind: EscalationKind): Copy {
  switch (kind) {
    case "WorkFailureEscalated":
      return { id: "sentences-escalation-work-failure" };
    case "EvaluationFailureEscalated":
      return { id: "sentences-escalation-evaluation-failure" };
    case "WorkExecutionUnavailableEscalated":
      return { id: "sentences-escalation-work-unavailable" };
    case "EvaluationBlockedEscalated":
      return { id: "sentences-escalation-evaluation-blocked" };
    case "FinalizationUnavailableEscalated":
      return { id: "sentences-escalation-landing-unavailable" };
  }
}

/** What an open native action is asking, short enough for a badge to carry. */
export function nativeActionKindSentence(kind: NativeActionKind): Copy {
  switch (kind) {
    case "TicketEscalation":
      return { id: "sentences-native-escalation" };
    case "FinalizationApproval":
      return { id: "sentences-native-approval" };
  }
}

/** What the actor did with the submission, before any refusal code refines it. */
export function operationStateSentence(state: OperationState): Copy {
  switch (state) {
    case "Pending":
      return { id: "sentences-state-pending" };
    case "Succeeded":
      return { id: "sentences-state-succeeded" };
    case "Refused":
      return { id: "sentences-state-refused" };
    case "Answered":
      return { id: "sentences-state-answered" };
    case "Cancelled":
      return { id: "sentences-state-cancelled" };
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
function operationRefusalTickets(tickets: readonly number[]): Copy {
  const named = tickets.map(operationRefusalTicket);
  const last = named.pop();
  if (last === undefined) return { id: "sentences-tickets-none" };
  return named.length === 0
    ? { id: "sentences-tickets-one", args: { last } }
    : { id: "sentences-tickets-many", args: { named: named.join(", "), last } };
}

/** Which task a report was for, as its identity names it. */
function operationRefusalTask(task: TaskIdentity): Copy {
  switch (task.type) {
    case "WorkTask":
      return { id: "sentences-task-work", args: { cycle: task.value.cycle } };
    case "EvaluationTask":
      return {
        id: "sentences-task-evaluation",
        args: { cycle: task.value.workCycle, stage: task.value.stage },
      };
  }
}

/** A refusal the machine names the tickets, task or attempt of. */
type OperationRefusalNamed = Extract<
  OperationRefusal,
  { readonly value: unknown }
>;

/** A refusal over a ticket and the dependencies it names. */
type OperationRefusalOfDependencies = Extract<
  OperationRefusalNamed,
  {
    readonly type:
      | "DependenciesNotFound"
      | "DependenciesRevoked"
      | "DependencyCycle"
      | "DependenciesIncomplete";
  }
>;

/** A refusal of a report for a task or a cycle that is not current. */
type OperationRefusalOfReport = Extract<
  OperationRefusalNamed,
  {
    readonly type:
      "TaskNotCurrent" | "EvaluationNotCurrent" | "FinalizationNotCurrent";
  }
>;

/** Why the machine declined the command, naming what it declined over. */
function operationRefusalTicketSentence(refused: OperationRefusalNamed): Copy {
  switch (refused.type) {
    case "TicketAlreadyExists":
      return {
        id: "sentences-refusal-ticket-exists",
        args: { ticket: operationRefusalTicket(refused.value) },
      };
    case "DependenciesNotFound":
    case "DependenciesRevoked":
    case "DependencyCycle":
    case "DependenciesIncomplete":
      return operationRefusalDependenciesSentence(refused);
    case "SelfDependency":
      return {
        id: "sentences-refusal-self-dependency",
        args: { ticket: operationRefusalTicket(refused.value) },
      };
    case "TicketNotFound":
      return {
        id: "sentences-refusal-ticket-not-found",
        args: { ticket: operationRefusalTicket(refused.value) },
      };
    case "TicketNotPending":
      return {
        id: "sentences-refusal-ticket-not-pending",
        args: { ticket: operationRefusalTicket(refused.value) },
      };
    case "TicketIdentityMismatch":
      return {
        id: "sentences-refusal-ticket-mismatch",
        args: { ticket: operationRefusalTicket(refused.value) },
      };
    case "TicketRevisionStale":
      return {
        id: "sentences-refusal-revision-stale",
        args: {
          ticket: operationRefusalTicket(refused.value.ticket),
          expected: refused.value.expected,
          current: refused.value.current,
        },
      };
    case "TicketNotRevocable":
      return {
        id: "sentences-refusal-not-revocable",
        args: { ticket: operationRefusalTicket(refused.value) },
      };
    case "TicketNotResumable":
      return {
        id: "sentences-refusal-not-resumable",
        args: { ticket: operationRefusalTicket(refused.value) },
      };
    case "TaskNotCurrent":
    case "EvaluationNotCurrent":
    case "FinalizationNotCurrent":
      return operationRefusalReportSentence(refused);
  }
}

/** Why the machine declined a ticket over the dependencies it named. */
function operationRefusalDependenciesSentence(
  refused: OperationRefusalOfDependencies,
): Copy {
  const args = operationRefusalDependencies(refused.value);
  switch (refused.type) {
    case "DependenciesNotFound":
      return { id: "sentences-refusal-dependencies-not-found", args };
    case "DependenciesRevoked":
      return { id: "sentences-refusal-dependencies-revoked", args };
    case "DependencyCycle":
      return { id: "sentences-refusal-dependency-cycle", args };
    case "DependenciesIncomplete":
      return { id: "sentences-refusal-dependencies-incomplete", args };
  }
}

/** Why the machine declined a report that is not current. */
function operationRefusalReportSentence(
  refused: OperationRefusalOfReport,
): Copy {
  switch (refused.type) {
    case "TaskNotCurrent":
      return {
        id: "sentences-refusal-task-not-current",
        args: {
          task: operationRefusalTask(refused.value.task),
          ticket: operationRefusalTicket(refused.value.ticket),
        },
      };
    case "EvaluationNotCurrent":
      return {
        id: "sentences-refusal-evaluation-not-current",
        args: {
          cycle: refused.value.workCycle,
          ticket: operationRefusalTicket(refused.value.ticket),
        },
      };
    case "FinalizationNotCurrent":
      return {
        id: "sentences-refusal-landing-not-current",
        args: {
          cycle: refused.value.workCycle,
          ticket: operationRefusalTicket(refused.value.ticket),
        },
      };
  }
}

/** A ticket and the dependencies it was refused over. */
function operationRefusalDependencies(value: {
  readonly ticket: number;
  readonly dependencies: readonly number[];
}): { readonly ticket: string; readonly dependencies: Copy } {
  return {
    ticket: operationRefusalTicket(value.ticket),
    dependencies: operationRefusalTickets(value.dependencies),
  };
}

/** Why the actor declined the submitted mutation, and what to do about it. */
export function operationRefusalSentence(refused: OperationRefusal): Copy {
  if ("value" in refused) return operationRefusalTicketSentence(refused);
  switch (refused.type) {
    case "AuthoringChanged":
      return { id: "sentences-refusal-authoring-changed" };
    case "ConfigurationInvalid":
      return { id: "sentences-refusal-configuration-invalid" };
    case "TicketChanged":
      return { id: "sentences-refusal-ticket-changed" };
    case "SelectionChanged":
      return { id: "sentences-refusal-selection-changed" };
    case "ExecutionSourceUnreadable":
      return { id: "sentences-refusal-source-unreadable" };
    case "ExecutionSourceDenied":
      return { id: "sentences-refusal-source-denied" };
    case "BriefNamesNoRepository":
      return { id: "sentences-refusal-brief-no-repository" };
    case "BriefChecksUncommanded":
      return { id: "sentences-refusal-brief-checks-uncommanded" };
    case "ConfigurationFromAnotherRepository":
      return { id: "sentences-refusal-configuration-elsewhere" };
    case "SelectionUnknown":
      return { id: "sentences-refusal-selection-unknown" };
    case "SelectionUnsupported":
      return { id: "sentences-refusal-selection-unsupported" };
    case "ProgramExceedsPlan":
      return { id: "sentences-refusal-program-exceeds-plan" };
    case "ProgramSkipsBriefChecks":
      return { id: "sentences-refusal-program-skips-checks" };
    case "OverridesUnsupported":
      return { id: "sentences-refusal-overrides-unsupported" };
    case "OverridesUnknown":
      return { id: "sentences-refusal-overrides-unknown" };
    case "TicketCapacityReached":
      return { id: "sentences-refusal-capacity-reached" };
    case "FinalizationRequestClosed":
      return { id: "sentences-refusal-landing-request-closed" };
    case "OverridesMoveDefinition":
      return { id: "sentences-refusal-overrides-move-definition" };
  }
}

/**
 * Why a ticket that follows its configuration's newest revision stays on the
 * one it holds, as one line: a held one in the words its release would be
 * refused with. A ticket that is current or would move has nothing to say.
 */
export function ticketFollowingSentence(
  following: TicketFollowing | undefined,
): Copy | undefined {
  switch (following?.verdict) {
    case undefined:
    case "Current":
    case "Moves":
      return undefined;
    case "Held":
      return {
        id: "sentences-following-held",
        args: { refusal: operationRefusalSentence({ type: following.code }) },
      };
    case "Trimmed":
      return { id: "sentences-following-trimmed" };
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

export function mutationRefusalSentence(code: MutationRefusalCode): Copy {
  switch (code) {
    case "IdempotencyConflict":
      return { id: "sentences-mutation-key-used" };
    case "InvalidMutation":
      return { id: "sentences-mutation-invalid" };
    case "MutationNotAdmitted":
      return { id: "sentences-mutation-not-admitted" };
    case "OperationNotPending":
      return { id: "sentences-mutation-decided" };
    case "ProgramSkipsPlannedEvaluations":
      return { id: "sentences-mutation-skips-evaluations" };
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
): Copy {
  switch (code) {
    case "DraftChanged":
      return { id: "sentences-draft-changed" };
    case "DraftNotEditable":
      return { id: "sentences-draft-not-editable" };
  }
}

/** Why a revision did not get through: the door's own conflict where it named
 * one, and a failure read as any submission's otherwise. */
export function draftRevisionFailureSentence(failure: ApiFailure): Copy {
  const code =
    failure.outcome === "Conflict"
      ? draftRevisionRefusalCodes.find((known) => known === failure.code)
      : undefined;
  return code === undefined
    ? operationFailureSentence(failure)
    : draftRevisionRefusalSentence(code);
}

/** Why a draft's deletion did not get through: it was written since it was
 * read, or it is a draft no longer, and a failure read as any submission's
 * otherwise. */
export function draftDeletionFailureSentence(failure: ApiFailure): Copy {
  const code =
    failure.outcome === "Conflict"
      ? draftRevisionRefusalCodes.find((known) => known === failure.code)
      : undefined;
  switch (code) {
    case undefined:
      return operationFailureSentence(failure);
    case "DraftChanged":
      return { id: "sentences-draft-deletion-changed" };
    case "DraftNotEditable":
      return { id: "sentences-draft-deletion-not-editable" };
  }
}

/** The coded deferrals the same two routes answer with, each meaning try again. */
export const mutationDeferralCodes = [
  "DispatchBacklog",
  "MailboxBackpressure",
  "MailboxUnavailable",
] as const;
export type MutationDeferralCode = (typeof mutationDeferralCodes)[number];

export function mutationDeferralSentence(code: string): Copy {
  switch (mutationDeferralCodeOf(code)) {
    case "DispatchBacklog":
      return { id: "sentences-deferral-dispatch-backlog" };
    case "MailboxBackpressure":
      return { id: "sentences-deferral-mailbox-full" };
    case "MailboxUnavailable":
      return { id: "sentences-deferral-mailbox-unavailable" };
    case undefined:
      return { id: "sentences-deferral-unknown", args: { code } };
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
export function operationFailureSentence(failure: ApiFailure): Copy {
  switch (failure.outcome) {
    case "Unauthenticated":
      return { id: "sentences-failure-signed-out" };
    case "Absent":
      return { id: "sentences-failure-absent" };
    case "Retryable":
      return {
        id: "sentences-failure-retryable",
        args: { deferral: mutationDeferralSentence(failure.code) },
      };
    case "Unreachable":
    case "Unreadable":
      return {
        id: "sentences-failure-words",
        args: { word: failureWords(failure).word },
      };
    case "Conflict":
    case "Rejected":
    case "Fault": {
      const declined = mutationRefusalCodeOf(failure.code);
      if (declined !== undefined) return mutationRefusalSentence(declined);
      return { id: "sentences-failure-refused", args: { code: failure.code } };
    }
  }
}
