/**
 * The coded values the wire sends a person, as the short labels a ledger page
 * draws them in: descriptors, whose words are `codes.ftl`'s.
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
  type BriefFinalizationKind,
  type BriefGitMergeMode,
  type BriefGitMergePolicy,
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
import type { BriefFinalizationOf } from "../../../../src/contract/brief.ts";
import type {
  LeadAbsenceResponse,
  RunnerLoss,
  RunStepFailure,
  TicketEscalation,
} from "../../../../src/contract/responses.ts";
import type { ApiFailure } from "./apiRequest.ts";
import type { Copy, CopyOrData } from "./copy.ts";
import { failureWords } from "./failureWords.ts";
import {
  mutationDeferralCodes,
  mutationRefusalCodes,
  type MutationDeferralCode,
  type MutationRefusalCode,
} from "./codeSentences.ts";
import { instantFigure } from "./figures.ts";
import { creatorLabel } from "./labels.ts";
import type {
  OperationAbandonCause,
  OperationStep,
} from "./operationFollow.ts";
import type { ClosedSet, StageNames } from "./ticketLedger.ts";
import { stageLabel } from "./ticketLedger.ts";
import type { TicketActionName } from "./ticketActions.ts";

/** Which wall the ticket hit, as the noun the reader scans for. */
export function escalationKindLabel(kind: EscalationKind): Copy {
  switch (kind) {
    case "WorkFailureEscalated":
      return { id: "codes-escalation-work-failure" };
    case "EvaluationFailureEscalated":
      return { id: "codes-escalation-evaluation-failure" };
    case "WorkExecutionUnavailableEscalated":
      return { id: "codes-escalation-work-unavailable" };
    case "EvaluationBlockedEscalated":
      return { id: "codes-escalation-evaluation-blocked" };
    case "FinalizationUnavailableEscalated":
      return { id: "codes-escalation-landing-unavailable" };
  }
}

/**
 * Which wall the fabric hit, off the escalation's evidence when it is a
 * `BlockedReason`: the noun the reader scans for where `escalationKindLabel`'s
 * arm for `WorkExecutionUnavailableEscalated` or `EvaluationBlockedEscalated`
 * names only that a wall happened and not which one.
 */
export function blockedReasonLabel(reason: BlockedReason): Copy {
  switch (reason) {
    case "ExecutionPolicyDenied":
      return { id: "codes-blocked-policy-denied" };
    case "TicketConfigIncompatible":
      return { id: "codes-blocked-configuration-incompatible" };
    case "ExecutionProfileUnavailable":
      return { id: "codes-blocked-profile-unavailable" };
    case "RuntimeVersionUnsupported":
      return { id: "codes-blocked-runtime-unsupported" };
    case "RequiredCapabilityUnavailable":
      return { id: "codes-blocked-capability-unavailable" };
    case "RequiredMemoryUnavailable":
      return { id: "codes-blocked-memory-unavailable" };
    case "EvaluatedTreeNotExpected":
      return { id: "codes-blocked-tree-unexpected" };
  }
}

/**
 * Which git act failed, off the escalation's evidence when it is a
 * `GitEvidenceLabel`: a rework whose source could not be read before any
 * execution row existed to carry a `BlockedReason`.
 */
export function gitEvidenceLabel(evidence: GitEvidenceLabel): Copy {
  switch (evidence) {
    case "RemoteUnreachable":
      return { id: "codes-git-remote-unreachable" };
    case "RemoteDenied":
      return { id: "codes-git-remote-denied" };
    case "RefUnreadable":
      return { id: "codes-git-ref-unreadable" };
    case "ObjectMissing":
      return { id: "codes-git-object-missing" };
    case "IntegrationFailed":
      return { id: "codes-git-integration-failed" };
    case "PromotionTimedOut":
      return { id: "codes-git-promotion-timed-out" };
    case "RemoteDeclined":
      return { id: "codes-git-remote-declined" };
    case "WorkflowsRefused":
      return { id: "codes-git-workflows-refused" };
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
): Copy {
  switch (kind) {
    case "RepositoryUnbound":
      return { id: "codes-hold-repository-unbound" };
    case "TargetUnreadable":
      return { id: "codes-hold-target-unreadable" };
    case "ProposalBaseUnreadable":
      return { id: "codes-hold-base-unreadable" };
    case "ProposalBaseIsHead":
      return { id: "codes-hold-base-is-head" };
    case "ProposalDenied":
      return { id: "codes-hold-denied" };
    case "ReconciliationUnreadable":
      return { id: "codes-hold-reconciliation-unreadable" };
    case "ProposalEvidenceUnstorable":
      return { id: "codes-hold-evidence-unstorable" };
    case "ProposalAbsent":
      return { id: "codes-hold-absent" };
    case "ProposalUnaddressed":
      return { id: "codes-hold-unaddressed" };
    case "ProposalUnavailable":
      return { id: "codes-hold-unavailable" };
    case "PreparationRestartsExhausted":
      return { id: "codes-hold-preparation-restarts-exhausted" };
    case "ProposalCreationsExhausted":
      return { id: "codes-hold-creations-exhausted" };
    case "ProposalMergesExhausted":
      return { id: "codes-hold-merges-exhausted" };
    case "PromotionDeclined":
      return { id: "codes-hold-push-declined" };
    case "PromotionWorkflowsRefused":
      return { id: "codes-hold-workflows-refused" };
    case "ProposalQueueChecksFailed":
      return { id: "codes-hold-queue-checks-failed" };
    case "ProposalQueueTimedOut":
      return { id: "codes-hold-queue-timed-out" };
    case "ProposalDequeued":
      return { id: "codes-hold-dequeued" };
    case "RecheckReworksExhausted":
      return { id: "codes-hold-rechecks-exhausted" };
  }
}

/** Why a project holds no lead, as the line under its empty lead page says it. */
export function leadAbsenceLabel(reason: LeadAbsenceResponse["reason"]): Copy {
  switch (reason) {
    case "NotNeeded":
      return { id: "codes-lead-absence-not-needed" };
    case "Paused":
      return { id: "codes-lead-absence-paused" };
    case "SelectorNotGranted":
      return { id: "codes-lead-absence-not-granted" };
    case "AwaitingSelector":
      return { id: "codes-lead-absence-awaiting" };
    case "SelectorUnnamed":
      return { id: "codes-lead-absence-unnamed" };
    case "HostedRunsNotGranted":
      return { id: "codes-lead-absence-hosted-runs" };
    case "RunnerOffline":
      return { id: "codes-lead-absence-runner-offline" };
    case "UsagePaused":
      return { id: "codes-lead-absence-usage-paused" };
  }
}

/** Where one landing stands, as the one word its pill says. */
export function ticketLandingStateLabel(state: TicketLandingState): Copy {
  switch (state) {
    case "Running":
      return { id: "codes-landing-running" };
    case "Held":
      return { id: "codes-landing-held" };
    case "AwaitingApproval":
    case "AwaitingMerge":
      return { id: "codes-landing-waiting" };
    case "Failed":
      return { id: "codes-landing-failed" };
    case "Unavailable":
      return { id: "codes-landing-escalated" };
    case "Landed":
      return { id: "codes-landing-landed" };
    case "Proposed":
      return { id: "codes-landing-proposed" };
    case "Invalidated":
      return { id: "codes-landing-invalidated" };
  }
}

/** Why one finalization attempt failed. */
export function finalizationFailureKindLabel(
  kind: (typeof finalizationFailureKinds)[number],
): Copy {
  switch (kind) {
    case "MergeConflict":
      return { id: "codes-landing-failure-conflict" };
    case "PreparationFailed":
      return { id: "codes-landing-failure-preparation" };
    case "QueueChecksFailed":
      return { id: "codes-landing-failure-queue-checks" };
    case "RecheckRequired":
      return { id: "codes-landing-failure-recheck" };
  }
}

/** What opening a landing's pull request came to. */
export function changeProposalCreationLabel(
  creation: (typeof changeProposalCreations)[number],
): Copy {
  switch (creation) {
    case "Created":
      return { id: "codes-creation-created" };
    case "AlreadyExists":
      return { id: "codes-creation-exists" };
    case "Contradictory":
      return { id: "codes-creation-contradictory" };
    case "Unstorable":
      return { id: "codes-creation-unstorable" };
    case "Adopted":
      return { id: "codes-creation-adopted" };
  }
}

/** What merging a landing's pull request came to. */
export function changeProposalMergeLabel(
  merge: (typeof changeProposalMerges)[number],
): Copy {
  switch (merge) {
    case "Merged":
      return { id: "codes-merge-merged" };
    case "HeadMoved":
      return { id: "codes-merge-head-moved" };
    case "NotMergeable":
      return { id: "codes-merge-not-mergeable" };
  }
}

/** Why a landing's pull request was not merged. */
export function changeProposalMergeReasonLabel(
  reason: (typeof changeProposalMergeReasons)[number],
): Copy {
  switch (reason) {
    case "Conflict":
      return { id: "codes-merge-reason-conflict" };
  }
}

/** What the forge last said of a pull request itself. */
export function changeProposalStatusLabel(
  status: (typeof changeProposalStatuses)[number],
): Copy {
  switch (status) {
    case "Open":
      return { id: "codes-status-open" };
    case "Closed":
      return { id: "codes-status-closed" };
    case "Merged":
      return { id: "codes-status-merged" };
    case "Superseded":
      return { id: "codes-status-superseded" };
  }
}

/** What a landing's merge waits on at the forge. */
export function changeProposalMergeWaitLabel(
  wait: (typeof changeProposalMergeWaits)[number],
): Copy {
  switch (wait) {
    case "Blocked":
      return { id: "codes-merge-wait-blocked" };
    case "HeadMoved":
      return { id: "codes-merge-wait-head-moved" };
    case "Queued":
      return { id: "codes-merge-wait-queued" };
  }
}

/** What the forge last said of whether a pull request can merge. */
export function changeProposalMergeabilityLabel(
  mergeability: (typeof changeProposalMergeabilities)[number],
): Copy {
  switch (mergeability) {
    case "Mergeable":
      return { id: "codes-mergeability-mergeable" };
    case "Conflicting":
      return { id: "codes-mergeability-conflicting" };
    case "Blocked":
      return { id: "codes-mergeability-blocked" };
    case "Behind":
      return { id: "codes-mergeability-behind" };
    case "Unknown":
      return { id: "codes-mergeability-unknown" };
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
): Copy {
  if (isBlockedReason(evidence)) return blockedReasonLabel(evidence);
  if (isGitEvidence(evidence)) return gitEvidenceLabel(evidence);
  return finalizationUnavailableKindLabel(evidence);
}

/** The runner a job was lost on: its pool's name, or the member whose own runner it is. */
export function runnerLossDetail(lost: RunnerLoss): Copy {
  return lost.runner.kind === "Pool"
    ? { id: "codes-runner-lost-pool", args: { pool: lost.runner.pool } }
    : {
        id: "codes-runner-lost-owner",
        args: { owner: creatorLabel(lost.runner.owner).text },
      };
}

/** How often the job was lost where it stands, and how many of those the scheduler resumed by itself. */
export function runnerLossLine(lost: RunnerLoss): Copy {
  return {
    id: "codes-runner-losses",
    args: { losses: lost.losses, resumed: lost.resumed },
  };
}

/** That the scheduler resumes the escalation by itself, and when the latest
 * pause holding it ends where one still does, in the reader's own zone. */
export function usageResumeLine(
  usageResume: NonNullable<TicketEscalation["usageResume"]>,
  nowMs: number,
): Copy {
  const until =
    usageResume.until === undefined
      ? undefined
      : instantFigure(usageResume.until, nowMs);
  return until?.kind === "Instant"
    ? { id: "codes-usage-resumes-at", args: { until: until.text } }
    : { id: "codes-usage-resumes" };
}

/** The step a run stopped at. */
export function runStepLabel(step: RunStepEvidence): Copy {
  switch (step) {
    case "RunCloneFailed":
      return { id: "codes-step-clone-failed" };
    case "RunSetupFailed":
      return { id: "codes-step-setup-failed" };
    case "RunCommitFailed":
      return { id: "codes-step-commit-failed" };
    case "RunPushFailed":
      return { id: "codes-step-push-failed" };
    case "RunTimedOut":
      return { id: "codes-step-timed-out" };
    case "RunDiskLow":
      return { id: "codes-step-disk-low" };
  }
}

/** Where a failed setup's fix goes, for a reader the card offers the ticket's setup lines to change, and what a runner whose disk ran low needs. */
export function runStepLine(
  failed: RunStepFailure,
  setupOverridable: boolean,
): Copy | undefined {
  switch (failed.evidence) {
    case "RunSetupFailed":
      return setupOverridable ? { id: "codes-step-setup-line" } : undefined;
    case "RunDiskLow":
      return { id: "codes-step-disk-line" };
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
export function escalationDetail(escalation: TicketEscalation): Copy {
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
): Copy | undefined {
  if (evidence === "PromotionWorkflowsRefused")
    return { id: "codes-evidence-workflows-line" };
  if (evidence === "PromotionDeclined")
    return { id: "codes-evidence-declined-line" };
  if (evidence === "ReconciliationUnreadable")
    return { id: "codes-evidence-unreadable-line" };
  return undefined;
}

/** What the page knows about the wall, which is what the second line can name. */
export interface WallFacts {
  readonly lastSet: ClosedSet | undefined;
  readonly names: StageNames;
}

function walledStageLabel(facts: WallFacts): string | undefined {
  const set = facts.lastSet;
  if (set === undefined || set.taskKind !== "Evaluation") return undefined;
  if (set.stage === undefined) return undefined;
  return stageLabel(set.stage, facts.names);
}

/** The stage the wall interrupted, said as the thing that happened to it. */
function walledStageFailed(facts: WallFacts): Copy | undefined {
  const stage = walledStageLabel(facts);
  return stage === undefined
    ? undefined
    : { id: "codes-stage-failed", args: { stage } };
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
): Copy | undefined {
  switch (kind) {
    case "WorkFailureEscalated":
      return { id: "codes-detail-work-failure" };
    case "EvaluationFailureEscalated":
      return walledStageFailed(facts);
    case "WorkExecutionUnavailableEscalated":
      return { id: "codes-detail-work-unavailable" };
    case "EvaluationBlockedEscalated":
      return { id: "codes-detail-evaluation-blocked" };
    case "FinalizationUnavailableEscalated":
      return undefined;
  }
}

/** Where the ticket is, as the phase's own message in `standing.ftl` says it. */
export function phaseLabel(phase: TicketPhase): Copy {
  switch (phase) {
    case "Pending":
      return { id: "standing-pending" };
    case "Work":
      return { id: "standing-work" };
    case "Evaluation":
      return { id: "standing-evaluation" };
    case "Finalization":
      return { id: "standing-finalization" };
    case "Done":
      return { id: "standing-done" };
    case "Escalated":
      return { id: "standing-escalated" };
    case "Revoked":
      return { id: "standing-revoked" };
  }
}

/** What an open native action is asking, as the line a card answering it
 * leads with. */
export function nativeActionKindLabel(kind: NativeActionKind): Copy {
  switch (kind) {
    case "TicketEscalation":
      return { id: "codes-native-escalation" };
    case "FinalizationApproval":
      return { id: "codes-native-approval" };
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
): Copy | undefined {
  if (revokedDependencies.length === 0) return undefined;
  return {
    id: "codes-revoked-dependencies",
    args: {
      count: revokedDependencies.length,
      tickets: revokedDependencies.join(", "),
    },
  };
}

/** How a finished ticket is finalized, by its kind, in the word the choice is made by. */
export function finalizationKindLabel(kind: BriefFinalizationKind): Copy {
  switch (kind) {
    case "GitMerge":
      return { id: "codes-landing-kind-git-merge" };
    case "PullRequest":
      return { id: "codes-landing-kind-pull-request" };
    case "None":
      return { id: "codes-landing-kind-none" };
  }
}

/** What choosing that kind does to the branch the work lands on, `None`
 * touching no remote at all. */
export function finalizationKindEffect(kind: BriefFinalizationKind): Copy {
  switch (kind) {
    case "GitMerge":
      return { id: "codes-landing-kind-git-merge-effect" };
    case "PullRequest":
      return { id: "codes-landing-kind-pull-request-effect" };
    case "None":
      return { id: "codes-landing-kind-none-effect" };
  }
}

/** How a git merge advances its target branch, in the word the choice is made by. */
export function gitMergeModeLabel(mode: BriefGitMergeMode): Copy {
  switch (mode) {
    case "Push":
      return { id: "codes-merge-mode-push" };
    case "PullRequestMerge":
      return { id: "codes-merge-mode-pull-request" };
  }
}

/** What choosing that mode does to the target branch. */
export function gitMergeModeEffect(mode: BriefGitMergeMode): Copy {
  switch (mode) {
    case "Push":
      return { id: "codes-merge-mode-push-effect" };
    case "PullRequestMerge":
      return { id: "codes-merge-mode-pull-request-effect" };
  }
}

/** How a git merge is ordered against the others on its reference, in the word the choice is made by. */
export function gitMergePolicyLabel(policy: BriefGitMergePolicy): Copy {
  switch (policy) {
    case "Direct":
      return { id: "codes-merge-policy-direct" };
    case "Serialized":
      return { id: "codes-merge-policy-serialized" };
  }
}

/** What choosing that policy does to the merge. */
export function gitMergePolicyEffect(policy: BriefGitMergePolicy): Copy {
  switch (policy) {
    case "Direct":
      return { id: "codes-merge-policy-direct-effect" };
    case "Serialized":
      return { id: "codes-merge-policy-serialized-effect" };
  }
}

/** A finalization by its kind, over any spelling of its target. */
type FinalizationOfTarget = BriefFinalizationOf<string | undefined>;

/** How a finalization reaches its target: a git merge by its mode, and a pull request by its kind. */
export function finalizationMethodLabel(
  finalization: FinalizationOfTarget,
): Copy {
  return finalization.kind === "GitMerge"
    ? gitMergeModeLabel(finalization.mode)
    : finalizationKindLabel(finalization.kind);
}

/**
 * A finalization read back: how it reaches its reference, and that reference.
 * A push naming none lands on the branch the work happened on, which is a mode
 * and no reference; a proposal naming none opens into the repository's
 * default; and `None` names no reference at all, having nothing to advance
 * onto.
 */
export function finalizationLine(finalization: FinalizationOfTarget): Copy {
  const method = finalizationMethodLabel(finalization);
  if (finalization.kind === "None") return method;
  const pushed =
    finalization.kind === "GitMerge" && finalization.mode === "Push";
  if (pushed)
    return finalization.target === undefined
      ? method
      : {
          id: "codes-landing-onto",
          args: { method, target: finalization.target },
        };
  return {
    id: "codes-landing-into",
    args: {
      method,
      target: finalization.target ?? { id: "codes-landing-default-branch" },
    },
  };
}

/** Whether finalization waits for a person before it runs. */
export function approvalLabel(required: boolean): Copy {
  return required
    ? { id: "codes-approval-required" }
    : { id: "codes-approval-not-required" };
}

/**
 * What a mutation does and at most one consequence that matters. `offered` is
 * false only where the machine admits no such answer at all, and
 * `refusedBecause` is the other shape, an answer that exists beside a screen
 * that cannot offer it yet.
 */
export interface ActionEffect {
  readonly effect: Copy;
  readonly more?: Copy;
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

function resumeEffect(point: ResumePoint): Copy {
  switch (point) {
    case "ResumeWork":
      return { id: "codes-resume-work" };
    case "ResumeRework":
      return { id: "codes-resume-rework" };
    case "ResumeEvaluation":
      return { id: "codes-resume-evaluation" };
    case "ResumeFinalization":
      return { id: "codes-resume-landing" };
  }
}

/** An answer the machine admits, which is every one but a resume with no point. */
function offered(effect: Copy): ActionEffect {
  return { effect, offered: true };
}

/**
 * What is left at a wall the resume is not an answer to, named from the answers
 * the page is drawing beside it rather than assumed: `revocableIn` decides
 * which phases offer Revoke, so the exit named here is always one the ticket's
 * own read admits.
 */
export function wallExitLine(exits: WallExits): Copy | undefined {
  const [action, other, ...more] = exits.filter((exit) => exit !== "Resume");
  if (action === undefined || more.length > 0) return undefined;
  return other === undefined
    ? { id: "codes-wall-exit-one", args: { action: ticketActionLabel(action) } }
    : {
        id: "codes-wall-exit-two",
        args: {
          action: ticketActionLabel(action),
          other: ticketActionLabel(other),
        },
      };
}

/** The wall's own exit, said the way §1.2 joins it to what cannot be done. */
function resumeRefused(effect: Copy, exits: WallExits): ActionEffect {
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
      return resumeRefused({ id: "codes-resume-nothing" }, exits);
    case "Offered":
      return offered(resumeEffect(offer.point));
  }
}

/** What the edit screen does, which is revise the draft and release it again. */
export const ticketEditEffect: Copy = { id: "codes-edit-effect" };

/** An answer a ticket offers, in the word its button says. */
export function ticketActionLabel(action: TicketActionName): Copy {
  switch (action) {
    case "Dispatch":
      return { id: "codes-action-dispatch" };
    case "Resume":
      return { id: "codes-action-resume" };
    case "Revoke":
      return { id: "codes-action-revoke" };
    case "Approve":
      return { id: "codes-action-approve" };
    case "Decline":
      return { id: "codes-action-decline" };
    case "Release":
      return { id: "codes-action-release" };
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
      return offered({ id: "codes-action-dispatch-effect" });
    case "Resume":
      return resumeActionEffect(resume, exits);
    case "Revoke":
      return offered({ id: "codes-action-revoke-effect" });
    case "Approve":
      return offered({ id: "codes-action-approve-effect" });
    case "Decline":
      return offered({ id: "codes-action-decline-effect" });
    case "Release":
      return offered({ id: "codes-action-release-effect" });
  }
}

/** What the actor did with the submission, before any refusal code refines it. */
export function operationStateLabel(state: OperationState): Copy {
  switch (state) {
    case "Pending":
      return { id: "codes-state-pending" };
    case "Succeeded":
      return { id: "codes-state-succeeded" };
    case "Refused":
      return { id: "codes-state-refused" };
    case "Answered":
      return { id: "codes-state-answered" };
    case "Cancelled":
      return { id: "codes-state-cancelled" };
  }
}

/** Why the actor declined the mutation, as the fragment that goes after it. */
export function operationRefusalLabel(code: OperationRefusalCode): Copy {
  switch (code) {
    case "TicketAlreadyExists":
      return { id: "codes-refusal-ticket-exists" };
    case "DependenciesNotFound":
      return { id: "codes-refusal-dependencies-not-found" };
    case "DependenciesRevoked":
      return { id: "codes-refusal-dependencies-revoked" };
    case "DependencyCycle":
      return { id: "codes-refusal-dependency-cycle" };
    case "SelfDependency":
      return { id: "codes-refusal-self-dependency" };
    case "TicketNotFound":
      return { id: "codes-refusal-ticket-not-found" };
    case "TicketNotPending":
      return { id: "codes-refusal-ticket-not-pending" };
    case "TicketIdentityMismatch":
      return { id: "codes-refusal-ticket-mismatch" };
    case "TicketRevisionStale":
      return { id: "codes-refusal-revision-stale" };
    case "DependenciesIncomplete":
      return { id: "codes-refusal-dependencies-incomplete" };
    case "TicketNotRevocable":
      return { id: "codes-refusal-not-revocable" };
    case "TicketNotResumable":
      return { id: "codes-refusal-not-resumable" };
    case "TaskNotCurrent":
      return { id: "codes-refusal-run-not-current" };
    case "EvaluationNotCurrent":
      return { id: "codes-refusal-evaluation-not-current" };
    case "FinalizationNotCurrent":
      return { id: "codes-refusal-landing-not-current" };
    case "AuthoringChanged":
      return { id: "codes-refusal-authoring-changed" };
    case "ConfigurationInvalid":
      return { id: "codes-refusal-configuration-invalid" };
    case "TicketChanged":
      return { id: "codes-refusal-ticket-changed" };
    case "SelectionChanged":
      return { id: "codes-refusal-selection-changed" };
    case "ExecutionSourceUnreadable":
      return { id: "codes-refusal-source-unreadable" };
    case "ExecutionSourceDenied":
      return { id: "codes-refusal-source-denied" };
    case "BriefNamesNoRepository":
      return { id: "codes-refusal-brief-no-repository" };
    case "BriefChecksUncommanded":
      return { id: "codes-refusal-brief-checks-uncommanded" };
    case "ConfigurationFromAnotherRepository":
      return { id: "codes-refusal-configuration-elsewhere" };
    case "SelectionUnknown":
      return { id: "codes-refusal-selection-unknown" };
    case "SelectionUnsupported":
      return { id: "codes-refusal-selection-unsupported" };
    case "ProgramExceedsPlan":
      return { id: "codes-refusal-program-exceeds-plan" };
    case "ProgramSkipsBriefChecks":
      return { id: "codes-refusal-program-skips-checks" };
    case "OverridesUnsupported":
      return { id: "codes-refusal-overrides-unsupported" };
    case "OverridesUnknown":
      return { id: "codes-refusal-overrides-unknown" };
    case "TicketCapacityReached":
      return { id: "codes-refusal-capacity-reached" };
    case "FinalizationRequestClosed":
      return { id: "codes-refusal-landing-request-closed" };
    case "OverridesMoveDefinition":
      return { id: "codes-refusal-overrides-move-definition" };
  }
}

/** Why the boundary would not carry the request to the actor at all. */
export function mutationRefusalLabel(code: MutationRefusalCode): Copy {
  switch (code) {
    case "IdempotencyConflict":
      return { id: "codes-mutation-key-used" };
    case "InvalidMutation":
      return { id: "codes-mutation-invalid" };
    case "MutationNotAdmitted":
      return { id: "codes-mutation-not-admitted" };
    case "OperationNotPending":
      return { id: "codes-mutation-decided" };
    case "ProgramSkipsPlannedEvaluations":
      return { id: "codes-mutation-skips-evaluations" };
  }
}

function mutationDeferralCodeOf(
  code: string,
): MutationDeferralCode | undefined {
  return mutationDeferralCodes.find((known) => known === code);
}

/** Why the boundary asked for the same request again, each meaning try later. */
export function mutationDeferralLabel(code: string): Copy {
  switch (mutationDeferralCodeOf(code)) {
    case "DispatchBacklog":
      return { id: "codes-deferral-dispatch-backlog" };
    case "MailboxBackpressure":
      return { id: "codes-deferral-mailbox-full" };
    case "MailboxUnavailable":
      return { id: "codes-deferral-mailbox-unavailable" };
    case undefined:
      return { id: "codes-deferral-unknown", args: { code } };
  }
}

function mutationRefusalCodeOf(code: string): MutationRefusalCode | undefined {
  return mutationRefusalCodes.find((known) => known === code);
}

/** What went wrong, named thing first and cause second, as fragments. */
export function operationFailureLabel(failure: ApiFailure): Copy {
  switch (failure.outcome) {
    case "Unauthenticated":
      return { id: "codes-failure-signed-out" };
    case "Absent":
      return { id: "codes-failure-absent" };
    case "Retryable":
      return {
        id: "codes-failure-deferring",
        args: { deferral: mutationDeferralLabel(failure.code) },
      };
    case "Unreachable":
      return {
        id: "codes-failure-unreachable",
        args: { reason: failure.reason },
      };
    case "Unreadable":
      return {
        id: "codes-failure-unreadable",
        args: { reason: failure.reason },
      };
    case "Conflict":
    case "Rejected":
    case "Fault": {
      const declined = mutationRefusalCodeOf(failure.code);
      if (declined !== undefined) return mutationRefusalLabel(declined);
      return { id: "codes-failure-refused", args: { code: failure.code } };
    }
  }
}

/** The word an abandoned follow is drawn as, and what hovering it says. */
export interface AbandonWords {
  readonly word: Copy;
  readonly detail?: CopyOrData;
}

/**
 * The word an abandoned follow is drawn as, and the detail a reader reporting
 * it reads on hover. The switch is total over the cause, so a cause gained
 * does not compile until it has a word.
 */
export function operationAbandonWords(
  cause: OperationAbandonCause,
): AbandonWords {
  switch (cause.type) {
    case "Deferred":
      return { word: { id: "codes-abandon-deferred" } };
    case "Pending":
      return { word: { id: "codes-abandon-pending" } };
    case "Unaccepted":
      return { word: { id: "codes-abandon-unaccepted" } };
    case "Behind":
      return { word: { id: "codes-abandon-behind" } };
    case "OutOfOrder":
    case "Overstepped":
      return { word: { id: "codes-abandon-unknown" } };
    case "Failed": {
      const { word, detail } = failureWords(cause.failure);
      return {
        word: { id: "codes-abandon-failed", args: { word } },
        ...(detail === undefined ? {} : { detail }),
      };
    }
    case "Thrown":
      return { word: { id: "codes-abandon-thrown" }, detail: cause.reason };
  }
}

/** What a submission came to, said after the answer it was. */
function operationSettledLabel(state: OperationState, action: Copy): Copy {
  switch (state) {
    case "Pending":
      return { id: "codes-step-settled-pending", args: { action } };
    case "Succeeded":
      return { id: "codes-step-settled-succeeded", args: { action } };
    case "Refused":
      return { id: "codes-step-settled-refused", args: { action } };
    case "Answered":
      return { id: "codes-step-settled-answered", args: { action } };
    case "Cancelled":
      return { id: "codes-step-settled-cancelled", args: { action } };
  }
}

/** How far a submission has got, and whether that is a state to stop on. */
export interface StepLabel {
  readonly text: Copy;
  readonly detail?: CopyOrData;
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
      return {
        text: { id: "codes-step-submitting" },
        settled: false,
        wrong: false,
      };
    case "Backlogged":
      return {
        text: {
          id: "codes-step-backlogged",
          args: {
            deferral: mutationDeferralLabel(step.code),
            seconds: step.retryAfterSeconds,
          },
        },
        settled: false,
        wrong: false,
      };
    case "Following":
      return {
        text: { id: "codes-step-following" },
        settled: false,
        wrong: false,
      };
    case "Confirming":
      return {
        text: { id: "codes-step-confirming" },
        settled: false,
        wrong: false,
      };
    case "Settled": {
      const settled = operationSettledLabel(
        step.state,
        ticketActionLabel(action),
      );
      return {
        text:
          step.refusal === undefined
            ? settled
            : {
                id: "codes-step-settled-refusal",
                args: {
                  settled,
                  refusal: operationRefusalLabel(step.refusal.type),
                },
              },
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
