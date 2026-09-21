/**
 * The coded values the wire sends a person, as the short labels a ledger page
 * draws them in.
 *
 * Each switch is total over the roster it speaks for, so a member the wire
 * gains stops compiling here rather than reaching a reader as an unexplained
 * word. Where a code belongs to no roster the fallback names itself as one, so
 * a reader is told the console has nothing for it.
 *
 * WHY THIS IS NOT `codeSentences.ts`. That module answers the same rosters in
 * the console's older voice, and the pages still drawing that voice read it
 * unchanged; this one is the ledger page's, where a label is a noun and a
 * status is one or two words. The two are a migration in progress and not a
 * pair to keep: when the last page leaves the sentences, the sentences go, and
 * the one path that still reaches a reader through them is kasofsk/chuggy#460.
 */

import {
  operationRefusalCodes,
  type BlockedReason,
  type BriefFinalizationMode,
  type EscalationReason,
  type FinalizationUnavailableKind,
  type OperationRefusalCode,
  type OperationState,
  type ResumePoint,
  type TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type { ApiFailure } from "./apiRequest.ts";
import {
  mutationDeferralCodes,
  mutationRefusalCodes,
  type MutationDeferralCode,
  type MutationRefusalCode,
} from "./codeSentences.ts";
import type { OperationStep } from "./operationFollow.ts";
import type { ClosedSet } from "./ticketLedger.ts";
import { stageLabel } from "./ticketLedger.ts";
import type { TicketActionName } from "./ticketActions.ts";

/** Which wall the ticket hit, as the noun the reader scans for. */
export function escalationReasonLabel(reason: EscalationReason): string {
  switch (reason) {
    case "WorkFailureEscalated":
      return "Work failed";
    case "EvaluationFailureEscalated":
      return "Rework budget exhausted";
    case "WorkExecutionUnavailableEscalated":
      return "Execution unavailable";
    case "FinalizationUnavailableEscalated":
      return "Finalization unavailable";
  }
}

/**
 * Which wall the fabric hit, off the ticket's `executionBlockedBy`: the
 * evidence beside the escalation, present only while `reason` is
 * `WorkExecutionUnavailableEscalated`, and the noun the reader scans for where
 * `escalationReasonLabel`'s arm for that reason names only that a wall
 * happened and not which one.
 */
export function blockedReasonLabel(reason: BlockedReason): string {
  switch (reason) {
    case "ExecutionPolicyDenied":
      return "Execution denied by policy";
    case "TicketConfigIncompatible":
      return "Configuration incompatible";
    case "ExecutionProfileUnavailable":
      return "No matching execution profile";
    case "RuntimeVersionUnsupported":
      return "Runtime version unsupported";
    case "RequiredCapabilityUnavailable":
      return "Required capability unavailable";
  }
}

/**
 * Which hold the finalizer is stuck on, off the ticket's
 * `finalizationBlockedBy`: the evidence beside the escalation, present only
 * while `reason` is `FinalizationUnavailableEscalated`, one short label per
 * member of `finalizationUnavailableKinds`.
 */
export function finalizationUnavailableKindLabel(
  kind: FinalizationUnavailableKind,
): string {
  switch (kind) {
    case "RepositoryUnbound":
      return "Repository unbound";
    case "TargetUnreadable":
      return "Target unreadable";
    case "ProposalBaseUnreadable":
      return "Proposal base unreadable";
    case "ProposalBaseIsHead":
      return "Proposal base at head";
    case "ProposalDenied":
      return "Proposal denied";
    case "ReconciliationUnreadable":
      return "Reconciliation unreadable";
    case "ProposalEvidenceUnstorable":
      return "Proposal evidence unstorable";
    case "ProposalAbsent":
      return "Proposal absent";
    case "ProposalUnaddressed":
      return "Proposal unaddressed";
    case "ProposalUnavailable":
      return "Proposal unavailable";
    case "PreparationRestartsExhausted":
      return "Preparation restarts exhausted";
    case "ProposalCreationsExhausted":
      return "Proposal creations exhausted";
    case "ProposalMergesExhausted":
      return "Proposal merges exhausted";
  }
}

/**
 * The one line beside the escalation: the wall the fabric or the finalizer
 * hit where the read carries one, the reason's own generic word otherwise.
 * `blockedBy` is present only while `reason` is
 * `WorkExecutionUnavailableEscalated`, `finalizationBlockedBy` only while it
 * is `FinalizationUnavailableEscalated`, so a page short of both — the
 * continuation path with no wall row to read it off — still has the reason's
 * own word to draw.
 */
export function escalationDetail(
  reason: EscalationReason,
  blockedBy: BlockedReason | undefined,
  finalizationBlockedBy: FinalizationUnavailableKind | undefined,
): string {
  if (blockedBy !== undefined) return blockedReasonLabel(blockedBy);
  if (finalizationBlockedBy !== undefined)
    return finalizationUnavailableKindLabel(finalizationBlockedBy);
  return escalationReasonLabel(reason);
}

/** What the page knows about the wall, which is what the second line can name. */
export interface WallFacts {
  readonly lastSet: ClosedSet | undefined;
  readonly stageCount: number;
}

function walledStageLabel(facts: WallFacts): string | undefined {
  const set = facts.lastSet;
  if (set === undefined || set.taskKind !== "Evaluation") return undefined;
  if (set.stage === undefined) return undefined;
  return stageLabel(set.stage, facts.stageCount);
}

/** The stage the wall interrupted, said as the thing that happened to it. */
function walledStageFailed(facts: WallFacts): string | undefined {
  const stage = walledStageLabel(facts);
  return stage === undefined ? undefined : `${stage} failed`;
}

/** What the interrupted set was, for the walls the fabric rather than the ticket hit. */
function interruptedLabel(facts: WallFacts): string | undefined {
  const set = facts.lastSet;
  if (set === undefined) return undefined;
  switch (set.taskKind) {
    case "Work":
      return "Work cancelled";
    case "Evaluation":
      return "Evaluation cancelled";
  }
}

/**
 * The one optional line under the wall, from the facts the page already holds.
 * It is absent where those facts are not on the page rather than guessed at.
 */
export function escalationDetailLine(
  reason: EscalationReason,
  facts: WallFacts,
): string | undefined {
  switch (reason) {
    case "WorkFailureEscalated":
      return "Failed work is not reworked";
    case "EvaluationFailureEscalated":
      return walledStageFailed(facts);
    case "WorkExecutionUnavailableEscalated":
      return interruptedLabel(facts);
    case "FinalizationUnavailableEscalated":
      return undefined;
  }
}

/**
 * Where the ticket is, in the machine's own word for the phase — except the
 * three the phase constructors themselves used to be spelled and no longer
 * are. `Working`/`Evaluating`/`Finalizing` are the product's own words for
 * `Work`/`Evaluation`/`Finalization`.
 */
export function phaseLabel(phase: TicketPhase): string {
  switch (phase) {
    case "Work":
      return "Working";
    case "Evaluation":
      return "Evaluating";
    case "Finalization":
      return "Finalizing";
    case "Pending":
    case "Done":
    case "Escalated":
    case "Revoked":
      return phase;
  }
}

/**
 * The one line a Pending ticket names when a dependency it waits on was
 * revoked: nothing will ever complete that dependency, so the wait is over and
 * the only exit is revoking this ticket too. Absent for every ticket the read
 * lists none for.
 */
export function revokedDependencyLine(
  revokedDependencies: readonly number[],
): string | undefined {
  if (revokedDependencies.length === 0) return undefined;
  const noun = revokedDependencies.length === 1 ? "dependency" : "dependencies";
  return `Blocked by revoked ${noun} ${revokedDependencies.join(", ")}`;
}

/** How a finished ticket lands, in the word the choice is made by. */
export function landingLabel(mode: BriefFinalizationMode): string {
  switch (mode) {
    case "Push":
      return "Push";
    case "PullRequest":
      return "Pull request";
    case "PullRequestMerge":
      return "Pull request, then merge";
    case "None":
      return "None";
  }
}

/** What choosing that landing does to the branch the work lands on, `None`
 * touching no remote at all. */
export function landingEffect(mode: BriefFinalizationMode): string {
  switch (mode) {
    case "Push":
      return "Commits straight onto the target branch";
    case "PullRequest":
      return "Opens a pull request into the target branch";
    case "PullRequestMerge":
      return "Opens a pull request into the target branch and merges it";
    case "None":
      return "Lands nothing";
  }
}

/** A mode that reaches a reference at all, which `None` never does. */
type LandingWithTarget = Exclude<BriefFinalizationMode, "None">;

/** How a landing reaches the reference it names, the preposition each mode reads before it. */
function landingTargetName(mode: LandingWithTarget): string {
  switch (mode) {
    case "Push":
      return "lands on";
    case "PullRequest":
    case "PullRequestMerge":
      return "into";
  }
}

/** Where a landing that names no reference goes, which a push says by naming its branch. */
function landingDefaultTarget(mode: LandingWithTarget): string | undefined {
  switch (mode) {
    case "Push":
      return undefined;
    case "PullRequest":
    case "PullRequestMerge":
      return "the default branch";
  }
}

/**
 * A brief's landing read back: the mode, and the reference it reaches. `None`
 * names no reference at all, having nothing to advance onto.
 */
export function briefLandingLine(finalization: {
  readonly mode: BriefFinalizationMode;
  readonly target?: string | undefined;
}): string {
  const mode = finalization.mode;
  if (mode === "None") return landingLabel(mode);
  const target = finalization.target ?? landingDefaultTarget(mode);
  return target === undefined
    ? landingLabel(mode)
    : `${landingLabel(mode)} · ${landingTargetName(mode)} ${target}`;
}

/** Whether finalization waits for a person before it runs. */
export function approvalLabel(required: boolean): string {
  return required ? "Required" : "Not required";
}

/**
 * What a mutation does and at most one consequence that matters. `offered` is
 * false only where the machine admits no such answer at all, and
 * `refusedBecause` is the other shape, an answer that exists beside a screen
 * that cannot offer it yet.
 */
export interface ActionEffect {
  readonly effect: string;
  readonly more?: string;
  readonly offered: boolean;
  readonly refusedBecause?: string;
}

/**
 * What a resume would do, as much of it as the page has read: `retryableIn`
 * (`model/domain.qnt`) wants a parked phase and a stamped point, which is the
 * one arm here that offers a button. `NoPoint` is a park with no answer left,
 * and `NotRead` draws a disabled button instead, because a screen that has not
 * finished reading does not yet know which of the two it is.
 */
export type ResumeOffer =
  | { readonly kind: "Offered"; readonly point: ResumePoint }
  | { readonly kind: "NoPoint" }
  | { readonly kind: "NotRead" };

/** What the console says about a resume it cannot yet offer. */
export const resumeNotReadReason = "Not read yet";

/** The answers a wall leaves when the resume is not one of them. */
export type WallExits = readonly TicketActionName[];

function resumeEffect(point: ResumePoint): string {
  switch (point) {
    case "ResumeWork":
      return "Re-runs the work · new artifact";
    case "ResumeRework":
      return "Reworks · new artifact";
    case "ResumeEvaluation":
      return "Re-runs evaluation from stage 1";
    case "ResumeFinalization":
      return "Re-runs finalization";
  }
}

/** An answer the machine admits, which is every one but a resume with no point. */
function offered(effect: string): ActionEffect {
  return { effect, offered: true };
}

/**
 * What is left at a wall the resume is not an answer to, named from the answers
 * the page is drawing beside it rather than assumed: `revocableIn` decides
 * which phases offer Revoke, so the exit named here is always one the ticket's
 * own read admits.
 */
export function wallExitLine(exits: WallExits): string | undefined {
  const left = exits.filter((action) => action !== "Resume");
  if (left.length === 1) return `only ${String(left[0])} exits this wall`;
  if (left.length === 2)
    return `only ${String(left[0])} or ${String(left[1])} exit this wall`;
  return undefined;
}

/** The wall's own exit, said the way §1.2 joins it to what cannot be done. */
function resumeRefused(effect: string, exits: WallExits): ActionEffect {
  const more = wallExitLine(exits);
  return {
    effect,
    ...(more === undefined ? {} : { more }),
    offered: false,
  };
}

/** What a resume would do, as far as the page has read enough to say. */
export function resumeActionEffect(
  offer: ResumeOffer,
  exits: WallExits,
): ActionEffect {
  switch (offer.kind) {
    case "NoPoint":
      return resumeRefused("Nothing to resume", exits);
    case "NotRead":
      return {
        effect: "Rejoins where the ticket parked",
        offered: true,
        refusedBecause: resumeNotReadReason,
      };
    case "Offered":
      return offered(resumeEffect(offer.point));
  }
}

/**
 * What answering the action does to the ticket. A resume is named by the point
 * the machine stamped, which is why it takes the offer rather than the word
 * alone.
 */
export function ticketActionEffect(
  action: TicketActionName,
  resume: ResumeOffer,
  exits: WallExits = [],
): ActionEffect {
  switch (action) {
    case "Dispatch":
      return offered("Dispatches the observed version");
    case "Resume":
      return resumeActionEffect(resume, exits);
    case "Revoke":
      return offered("Parks every dependent ticket");
    case "Approve":
      return offered("Lets finalization proceed");
    case "Decline":
      return offered("Holds finalization back");
  }
}

/** What the actor did with the submission, before any refusal code refines it. */
export function operationStateLabel(state: OperationState): string {
  switch (state) {
    case "Pending":
      return "Pending";
    case "Succeeded":
      return "Accepted";
    case "Refused":
      return "Refused";
    case "Answered":
      return "Answered";
    case "Cancelled":
      return "Cancelled";
  }
}

/** Why the actor declined the mutation, as the fragment that goes after it. */
export function operationRefusalLabel(code: OperationRefusalCode): string {
  switch (code) {
    case "NotEnabled":
      return "Not allowed in this phase";
    case "AuthoringChanged":
      return "Authoring changed";
    case "ConfigurationInvalid":
      return "Configuration not runnable";
    case "TicketChanged":
      return "Ticket changed";
    case "SelectionChanged":
      return "Dispatch selection changed";
    case "CommandUnreadable":
      return "Command unreadable";
    case "ExecutionSourceUnreadable":
      return "Source ref not on remote";
    case "ExecutionSourceDenied":
      return "Remote refused credentials";
    case "BriefNamesNoRepository":
      return "Brief names no repository";
  }
}

/** Why the boundary would not carry the request to the actor at all. */
export function mutationRefusalLabel(code: MutationRefusalCode): string {
  switch (code) {
    case "IdempotencyConflict":
      return "Key already used";
    case "InvalidMutation":
      return "Invalid mutation";
    case "MutationNotAdmitted":
      return "Not admitted right now";
    case "OperationNotPending":
      return "Already decided";
  }
}

function mutationDeferralCodeOf(
  code: string,
): MutationDeferralCode | undefined {
  return mutationDeferralCodes.find((known) => known === code);
}

/** Why the boundary asked for the same request again, each meaning try later. */
export function mutationDeferralLabel(code: string): string {
  switch (mutationDeferralCodeOf(code)) {
    case "DispatchBacklog":
      return "Dispatch backlog";
    case "MailboxBackpressure":
      return "Actor mailbox full";
    case "MailboxUnavailable":
      return "Actor unreachable";
    case undefined:
      return `Deferred (${code})`;
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

/** What went wrong, named thing first and cause second, as fragments. */
export function operationFailureLabel(failure: ApiFailure): string {
  switch (failure.outcome) {
    case "Unauthenticated":
      return "Not signed in";
    case "Absent":
      return "Operation not found";
    case "Retryable":
      return `Kept deferring · ${mutationDeferralLabel(failure.code)}`;
    case "Unreachable":
      return `API unreachable · ${failure.reason}`;
    case "Unreadable":
      return `Unreadable response · ${failure.reason}`;
    case "Conflict":
    case "Rejected":
    case "Fault": {
      const refusal = operationRefusalCodeOf(failure.code);
      if (refusal !== undefined) return operationRefusalLabel(refusal);
      const declined = mutationRefusalCodeOf(failure.code);
      if (declined !== undefined) return mutationRefusalLabel(declined);
      return `Refused (${failure.code})`;
    }
  }
}

/** How far a submission has got, and whether that is a state to stop on. */
export interface StepLabel {
  readonly text: string;
  readonly settled: boolean;
  readonly wrong: boolean;
}

/**
 * Every step a follow passes through, as the one line the page draws for it.
 * The settled line names the action, because by then the button it came from
 * may no longer be on screen.
 */
export function operationStepLabel(
  step: OperationStep,
  action: TicketActionName,
): StepLabel {
  switch (step.step) {
    case "Submitting":
      return { text: "Submitting…", settled: false, wrong: false };
    case "Backlogged":
      return {
        text: `${mutationDeferralLabel(step.code)} · retry in ${String(step.retryAfterSeconds)}s`,
        settled: false,
        wrong: false,
      };
    case "Following":
      return { text: "Waiting for actor…", settled: false, wrong: false };
    case "Confirming":
      return {
        text: `Syncing to seq ${String(step.minimumSequence)}…`,
        settled: false,
        wrong: false,
      };
    case "Settled": {
      const state = operationStateLabel(step.state);
      const refusal =
        step.refusalCode === undefined
          ? ""
          : ` · ${operationRefusalLabel(step.refusalCode)}`;
      return {
        text: `${action} ${state.toLowerCase()}${refusal}`,
        settled: true,
        wrong: step.state !== "Succeeded",
      };
    }
    case "Abandoned":
      return { text: step.reason, settled: true, wrong: true };
  }
}
