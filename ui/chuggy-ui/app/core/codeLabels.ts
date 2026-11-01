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
  blockedReasons,
  gitEvidences,
  type changeProposalCreations,
  type changeProposalMergeabilities,
  type changeProposalMergeReasons,
  type changeProposalMergeWaits,
  type changeProposalMerges,
  type changeProposalStatuses,
  type finalizationFailureKinds,
  type BlockedReason,
  type BriefFinalizationMode,
  type EscalationKind,
  type FinalizationUnavailableKind,
  type GitEvidenceLabel,
  type NativeActionKind,
  type OperationRefusalCode,
  type OperationState,
  type ResumePoint,
  type RunStepEvidence,
  type TicketLandingState,
  type TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type {
  LeadAbsenceResponse,
  RunnerLoss,
  RunStepFailure,
  TicketEscalation,
} from "../../../../src/contract/responses.ts";
import type { ApiFailure } from "./apiRequest.ts";
import { failureWords } from "./failureWords.ts";
import type { FailureWords } from "./failureWords.ts";
import {
  mutationDeferralCodes,
  mutationRefusalCodes,
  type MutationDeferralCode,
  type MutationRefusalCode,
} from "./codeSentences.ts";
import { creatorLabel } from "./labels.ts";
import type {
  OperationAbandonCause,
  OperationStep,
} from "./operationFollow.ts";
import type { ClosedSet } from "./ticketLedger.ts";
import { stageLabel } from "./ticketLedger.ts";
import type { TicketActionName } from "./ticketActions.ts";

/** Which wall the ticket hit, as the noun the reader scans for. */
export function escalationKindLabel(kind: EscalationKind): string {
  switch (kind) {
    case "WorkFailureEscalated":
      return "Work failed";
    case "EvaluationFailureEscalated":
      return "Rework budget exhausted";
    case "WorkExecutionUnavailableEscalated":
      return "Execution unavailable";
    case "EvaluationBlockedEscalated":
      return "Evaluation blocked";
    case "FinalizationUnavailableEscalated":
      return "Finalization unavailable";
  }
}

/**
 * Which wall the fabric hit, off the escalation's evidence when it is a
 * `BlockedReason`: the noun the reader scans for where `escalationKindLabel`'s
 * arm for `WorkExecutionUnavailableEscalated` or `EvaluationBlockedEscalated`
 * names only that a wall happened and not which one.
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
      return "Nowhere to run this work";
    case "RequiredMemoryUnavailable":
      return "Too large for every runner";
  }
}

/**
 * Which git act failed, off the escalation's evidence when it is a
 * `GitEvidenceLabel`: a rework whose source could not be read before any
 * execution row existed to carry a `BlockedReason`.
 */
export function gitEvidenceLabel(evidence: GitEvidenceLabel): string {
  switch (evidence) {
    case "RemoteUnreachable":
      return "Remote unreachable";
    case "RemoteDenied":
      return "Remote denied";
    case "RefUnreadable":
      return "Ref unreadable";
    case "ObjectMissing":
      return "Object missing";
    case "IntegrationFailed":
      return "Integration failed";
    case "PromotionTimedOut":
      return "Promotion timed out";
    case "RemoteDeclined":
      return "Remote declined";
    case "WorkflowsRefused":
      return "Workflows refused";
  }
}

/**
 * Which hold the finalizer is stuck on, off the escalation's evidence when it
 * is a `FinalizationUnavailableKind`: present only while the kind is
 * `FinalizationUnavailableEscalated`, one short label per member of
 * `finalizationUnavailableKinds`.
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
    case "PromotionDeclined":
      return "Push declined";
    case "PromotionWorkflowsRefused":
      return "Workflow files refused";
  }
}

/** Why a project holds no lead, as the line under its empty lead page says it. */
export function leadAbsenceLabel(
  reason: LeadAbsenceResponse["reason"],
): string {
  switch (reason) {
    case "NotNeeded":
      return "Opens when a ticket is released";
    case "Paused":
      return "Selector paused";
    case "SelectorNotGranted":
      return "Selector not granted this project";
    case "AwaitingSelector":
      return "Opens at the selector's next pass";
    case "SelectorUnnamed":
      return "No selector named for this site";
    case "HostedRunsNotGranted":
      return "Hosted runs not granted";
    case "RunnerOffline":
      return "No live runner";
  }
}

/** Where one landing stands, as the one word its pill says. */
export function ticketLandingStateLabel(state: TicketLandingState): string {
  switch (state) {
    case "Running":
      return "Running";
    case "Held":
      return "Held";
    case "AwaitingApproval":
    case "AwaitingMerge":
      return "Waiting";
    case "Failed":
      return "Failed";
    case "Unavailable":
      return "Escalated";
    case "Landed":
      return "Landed";
    case "Proposed":
      return "Proposed";
    case "Invalidated":
      return "Invalidated";
  }
}

/** Why one finalization attempt failed. */
export function finalizationFailureKindLabel(
  kind: (typeof finalizationFailureKinds)[number],
): string {
  switch (kind) {
    case "MergeConflict":
      return "Merge conflict";
    case "PreparationFailed":
      return "Preparation failed";
  }
}

/** What opening a landing's pull request came to. */
export function changeProposalCreationLabel(
  creation: (typeof changeProposalCreations)[number],
): string {
  switch (creation) {
    case "Created":
      return "Opened";
    case "AlreadyExists":
      return "Already open";
    case "Contradictory":
      return "Contradictory";
    case "Unstorable":
      return "Unstorable";
    case "Adopted":
      return "Adopted";
  }
}

/** What merging a landing's pull request came to. */
export function changeProposalMergeLabel(
  merge: (typeof changeProposalMerges)[number],
): string {
  switch (merge) {
    case "Merged":
      return "Merged";
    case "HeadMoved":
      return "Head moved";
    case "NotMergeable":
      return "Not mergeable";
  }
}

/** Why a landing's pull request was not merged. */
export function changeProposalMergeReasonLabel(
  reason: (typeof changeProposalMergeReasons)[number],
): string {
  switch (reason) {
    case "Conflict":
      return "Conflict";
  }
}

/** What the forge last said of a pull request itself. */
export function changeProposalStatusLabel(
  status: (typeof changeProposalStatuses)[number],
): string {
  switch (status) {
    case "Open":
      return "Open";
    case "Closed":
      return "Closed";
    case "Merged":
      return "Merged";
    case "Superseded":
      return "Superseded";
  }
}

/** What a landing's merge waits on at the forge. */
export function changeProposalMergeWaitLabel(
  wait: (typeof changeProposalMergeWaits)[number],
): string {
  switch (wait) {
    case "Blocked":
      return "Blocked";
    case "HeadMoved":
      return "Head moved";
  }
}

/** What the forge last said of whether a pull request can merge. */
export function changeProposalMergeabilityLabel(
  mergeability: (typeof changeProposalMergeabilities)[number],
): string {
  switch (mergeability) {
    case "Mergeable":
      return "Mergeable";
    case "Conflicting":
      return "Conflicting";
    case "Blocked":
      return "Blocked";
    case "Behind":
      return "Behind its base";
    case "Unknown":
      return "Unknown";
  }
}

function isBlockedReason(value: string): value is BlockedReason {
  return (blockedReasons as readonly string[]).includes(value);
}

function isGitEvidence(value: string): value is GitEvidenceLabel {
  return (gitEvidences as readonly string[]).includes(value);
}

/**
 * The evidence's own label, off whichever of the three disjoint rosters it
 * was drawn from: the wire names no roster beside the value itself, so this is
 * where a reader finds out which one it is.
 */
export function escalationEvidenceLabel(
  evidence: NonNullable<TicketEscalation["evidence"]>,
): string {
  if (isBlockedReason(evidence)) return blockedReasonLabel(evidence);
  if (isGitEvidence(evidence)) return gitEvidenceLabel(evidence);
  return finalizationUnavailableKindLabel(evidence);
}

/** The runner a job was lost on: its pool's name, or the member whose own runner it is. */
export function runnerLossDetail(lost: RunnerLoss): string {
  return lost.runner.kind === "Pool"
    ? `Lost on ${lost.runner.pool}`
    : `Lost on ${creatorLabel(lost.runner.owner).text}'s runner`;
}

function countNoun(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** How often the job was lost where it stands, and how many of those the scheduler resumed by itself. */
export function runnerLossLine(lost: RunnerLoss): string {
  const resumed = lost.resumed === 0 ? "none" : String(lost.resumed);
  return `${countNoun(lost.losses, "loss", "losses")} · ${resumed} resumed automatically`;
}

/** The step a run stopped at. */
export function runStepLabel(step: RunStepEvidence): string {
  switch (step) {
    case "RunCloneFailed":
      return "Clone failed";
    case "RunSetupFailed":
      return "Setup failed";
    case "RunCommitFailed":
      return "Commit failed";
    case "RunPushFailed":
      return "Push failed";
    case "RunTimedOut":
      return "Timed out";
    case "RunDiskLow":
      return "Disk low";
  }
}

/** Where a failed setup's fix goes, for a reader the card offers the ticket's setup lines to change, and what a runner whose disk ran low needs. */
export function runStepLine(
  failed: RunStepFailure,
  setupOverridable: boolean,
): string | undefined {
  switch (failed.evidence) {
    case "RunSetupFailed":
      return setupOverridable
        ? "Fix it under Overrides · Setup, then Resume"
        : undefined;
    case "RunDiskLow":
      return "Free space on its runner, then Resume";
    case "RunCloneFailed":
    case "RunCommitFailed":
    case "RunPushFailed":
    case "RunTimedOut":
      return undefined;
  }
}

/**
 * The one line beside the escalation: the runner a job was lost on where it
 * was, the step a run stopped at where it stopped at one, the wall's own label
 * where the escalation carries evidence, the kind's own generic word otherwise
 * — a work failure and a rework wall explain themselves, so neither ever
 * carries one.
 */
export function escalationDetail(escalation: TicketEscalation): string {
  if (escalation.lost !== undefined) return runnerLossDetail(escalation.lost);
  if (escalation.failed !== undefined)
    return runStepLabel(escalation.failed.evidence);
  return escalation.evidence === undefined
    ? escalationKindLabel(escalation.kind)
    : escalationEvidenceLabel(escalation.evidence);
}

/** Where the way past an escalation is, for one whose line can name a page. */
export type EscalationStep = "Runners" | "Repositories";

/** The page an escalation's one line leads to: where the project's work runs,
 * for a wall that is nothing being there to run it or nothing large enough, or
 * a pool that lost it, and where a repository's Workflow files are set, for a
 * push refused for them. */
export function escalationStep(
  escalation: TicketEscalation,
): EscalationStep | undefined {
  if (
    escalation.evidence === "RequiredCapabilityUnavailable" ||
    escalation.evidence === "RequiredMemoryUnavailable" ||
    escalation.lost?.runner.kind === "Pool"
  )
    return "Runners";
  return escalation.evidence === "PromotionWorkflowsRefused"
    ? "Repositories"
    : undefined;
}

/** What has to change before a resume gets a push past, for an escalation
 * whose evidence is a declined push or a push whose branch would not read. */
export function escalationEvidenceLine(
  evidence: TicketEscalation["evidence"],
): string | undefined {
  if (evidence === "PromotionWorkflowsRefused")
    return "Turn on Workflow files and the App's Workflows, then Resume";
  if (evidence === "PromotionDeclined")
    return "Check the branch's rules and hooks, then Resume";
  if (evidence === "ReconciliationUnreadable")
    return "Restore the branch or the App's access, then Resume";
  return undefined;
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

/**
 * The one optional line under the wall, from the facts the page already holds.
 * The work-cancelled and evaluation-blocked lines need no fact from the page —
 * a resume drains no sibling and cancels nothing, so the second names what a
 * resume does rather than a loss — and the stage line still needs the last
 * set to say which.
 */
export function escalationDetailLine(
  kind: EscalationKind,
  facts: WallFacts,
): string | undefined {
  switch (kind) {
    case "WorkFailureEscalated":
      return "Failed work is not reworked";
    case "EvaluationFailureEscalated":
      return walledStageFailed(facts);
    case "WorkExecutionUnavailableEscalated":
      return "Work cancelled";
    case "EvaluationBlockedEscalated":
      return "Resume asks it again";
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

/** What an open native action is asking, as the line a card answering it
 * leads with. */
export function nativeActionKindLabel(kind: NativeActionKind): string {
  switch (kind) {
    case "TicketEscalation":
      return "Escalated";
    case "FinalizationApproval":
      return "Awaiting approval";
  }
}

/**
 * The one line a Pending ticket names when a dependency it waits on was
 * revoked: nothing will ever complete that dependency, so the wait ends only
 * when an edit drops it or this ticket is revoked too. Absent for every ticket
 * the read lists none for.
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
 * What a resume would do: `retryableIn` (`model/domain.qnt`) wants a parked
 * phase, which is `hasOpenHumanTask` and free on the sum's every variant, so
 * a ticket read carries the point the moment it carries an escalation at all.
 * `NoPoint` is a ticket that is not parked: the read carries no escalation,
 * so a resume has nowhere to go.
 */
export type ResumeOffer =
  | { readonly kind: "Offered"; readonly point: ResumePoint }
  | { readonly kind: "NoPoint" };

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

/** What a resume would do. */
export function resumeActionEffect(
  offer: ResumeOffer,
  exits: WallExits,
): ActionEffect {
  switch (offer.kind) {
    case "NoPoint":
      return resumeRefused("Nothing to resume", exits);
    case "Offered":
      return offered(resumeEffect(offer.point));
  }
}

/** What the edit screen does, which is revise the draft and release it again. */
export const ticketEditEffect = "Revises the draft · releases a new revision";

/** What duplicating does, which is open a new ticket and write nothing. */
export const ticketDuplicateEffect =
  "Opens a new ticket holding this one's authoring";

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
    case "TicketAlreadyExists":
      return "Ticket already exists";
    case "DependenciesNotFound":
      return "Dependencies not found";
    case "DependenciesRevoked":
      return "Dependencies revoked";
    case "DependencyCycle":
      return "Dependency cycle";
    case "SelfDependency":
      return "Depends on itself";
    case "TicketNotFound":
      return "Ticket not found";
    case "TicketNotPending":
      return "No longer pending";
    case "TicketIdentityMismatch":
      return "Different ticket";
    case "TicketRevisionStale":
      return "Revision out of date";
    case "DependenciesIncomplete":
      return "Dependencies not done";
    case "TicketNotRevocable":
      return "Not revocable";
    case "TicketNotResumable":
      return "Nothing to resume";
    case "TaskNotCurrent":
      return "Task not current";
    case "FinalizationNotCurrent":
      return "Finalization not current";
    case "AuthoringChanged":
      return "Authoring changed";
    case "ConfigurationInvalid":
      return "Configuration not runnable";
    case "TicketChanged":
      return "Ticket changed";
    case "SelectionChanged":
      return "Dispatch selection changed";
    case "ExecutionSourceUnreadable":
      return "Source ref not on remote";
    case "ExecutionSourceDenied":
      return "Remote refused credentials";
    case "BriefNamesNoRepository":
      return "Brief names no repository";
    case "BriefChecksUncommanded":
      return "No check stage for brief checks";
    case "ConfigurationFromAnotherRepository":
      return "Configuration from another repository";
    case "SelectionUnknown":
      return "Selection names no catalog entry";
    case "SelectionUnsupported":
      return "Configuration cannot take this selection";
    case "ProgramExceedsPlan":
      return "Program exceeds the evaluation plan";
    case "ProgramSkipsBriefChecks":
      return "Program skips the brief's checks";
    case "OverridesUnsupported":
      return "Configuration cannot take these overrides";
    case "OverridesUnknown":
      return "Overrides name no catalog workload";
    case "TicketCapacityReached":
      return "Ticket capacity reached";
    case "FinalizationRequestClosed":
      return "Finalization request closed";
    case "OverridesMoveDefinition":
      return "Overrides would change the definition";
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
    case "ProgramSkipsPlannedEvaluations":
      return "Program skips planned evaluations";
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
      const declined = mutationRefusalCodeOf(failure.code);
      if (declined !== undefined) return mutationRefusalLabel(declined);
      return `Refused (${failure.code})`;
    }
  }
}

/**
 * The word an abandoned follow is drawn as, and the detail a reader reporting
 * it reads on hover. The switch is total over the cause, so a cause gained
 * does not compile until it has a word.
 */
export function operationAbandonWords(
  cause: OperationAbandonCause,
): FailureWords {
  switch (cause.type) {
    case "Deferred":
      return { word: "Busy" };
    case "Pending":
      return { word: "Still pending" };
    case "Unaccepted":
      return { word: "Not accepted" };
    case "Behind":
      return { word: "Still updating" };
    case "OutOfOrder":
    case "Overstepped":
      return { word: "Status unknown" };
    case "Failed":
      return failureWords(cause.failure);
    case "Thrown":
      return { word: "Failed", detail: cause.reason };
  }
}

/** How far a submission has got, and whether that is a state to stop on. */
export interface StepLabel {
  readonly text: string;
  readonly detail?: string;
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
        step.refusal === undefined
          ? ""
          : ` · ${operationRefusalLabel(step.refusal.type)}`;
      return {
        text: `${action} ${state.toLowerCase()}${refusal}`,
        settled: true,
        wrong: step.state !== "Succeeded",
      };
    }
    case "Abandoned": {
      const { word, detail } = operationAbandonWords(step.cause);
      return {
        text: word,
        ...(detail === undefined ? {} : { detail }),
        settled: true,
        wrong: true,
      };
    }
  }
}
