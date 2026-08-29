/**
 * The finalizer's own vocabulary: the durable finalization one claimed request
 * drives, the ports the finalizer service reaches Git, its credentials and its
 * own durable rows through, and the pure pass that says what a claimed request
 * may do next.
 *
 * NOTHING HERE DECIDES A TICKET. The finalizer submits `FinalizationResult`
 * through one narrow authenticated boundary and cannot append a journal entry,
 * settle an operation or move a ticket projection. `model/domain.qnt` has a
 * finalizer report a conclusive domain outcome and nothing else, so queueing,
 * approval, permits and the irreversible act itself are operational protocol
 * rather than `Core` state.
 *
 * NO REF, COMMIT OR OTHER GIT IDENTIFIER REACHES `Core`. The target branch, the
 * base it was observed at and the candidate commit are the service's, recorded
 * on the immutable attempt beside them; `ManagedFinalizer` is nullary precisely
 * so that a repository cannot become part of the frozen ticket contract.
 *
 * EVERY REFUSAL IS A VALUE, as elsewhere in this layer. A non-zero git exit is
 * an outcome `GitPromotionPort` returns and a caller must handle; the one thing
 * that raises is git being unable to run at all, which is the answer no caller
 * can decide its way around.
 *
 * A PROMOTION MAY BE AMBIGUOUS, AND THAT IS THE WHOLE REASON RECONCILIATION
 * EXISTS. A conditional ref update that neither confirms nor denies leaves the
 * repository the only authority on whether the ref advanced, so the permit is
 * granted before the act and abandoned only once `proveCandidateAncestry`
 * answers against the immutable candidate identity. That is what makes
 * idempotence the repository's rather than the row's.
 *
 * A PROMOTED CANDIDATE IS NOT ALWAYS A FINISHED TICKET. Where the brief lands
 * by opening a change proposal, the conditional ref update is the same act it
 * always was and the proposal is what follows it, so a promotion authorizes
 * `Propose` rather than a conclusion and `./finalizationProposal.ts` says which
 * act that comes to. A handoff is exempt whatever its brief reads: its
 * promotion is into a repository the ticket never worked in.
 *
 * A HOLD IS A STATE AND NOT AN ABSENCE. An unreadable ref, a timeout and
 * contradictory evidence are one durable answer recorded on the reconciliation,
 * because an absent row is indistinguishable from a crash. An operator supplies
 * evidence — re-read the ref, confirm the ancestry — and never an outcome, so a
 * hold ends when reconciliation concludes and no earlier.
 *
 * THE FAILURE KINDS ARE `MergeConflict` AND `PreparationFailed`. An integration
 * answered by a conflict is the first and a preparation that produced no
 * candidate is the second; both reduce to the one priced `FinalizationFailed`
 * the model already has, and no hold is either of them: a hold spends nothing
 * and refunds nothing, so a finalizer's own re-preparations stay invisible to
 * `Core`.
 *
 * A CLOSING PROJECT ABORTS BEFORE THE PERMIT AND RECONCILES AFTER IT. A
 * lifecycle that will never authorize the act again makes another preparation
 * pointless, so a finalization holding no permit records the failure it aborted
 * to and concludes it; one holding a permit reads the ref first, because the
 * repository is the only authority on whether it already advanced and evidence
 * cannot be erased before it has been read.
 *
 * THE GLOBAL LOCK ORDER IS REQUEST, THEN REPOSITORY, THEN PROJECT, THEN PERMIT,
 * THEN ATTEMPT, THEN CHANGE PROPOSAL, and within each class in key order. Every transaction taking
 * more than one of them takes them in that order, because a declared order
 * makes a deadlock unreachable where a retry only makes it rare.
 *
 * THE PURE PASS AWAITS NOTHING. `finalizationNext` is a function of an observed
 * view and returns the one move that view authorizes; the reads it needs — the
 * durable rows and the target the remote currently names — are gathered before
 * it runs, so a decision never acquires a mock.
 */

import type { BriefFinalizationMode } from "../contract/rosters.ts";
import type { FinalizationOutcome } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import { asBoundedText } from "./boundedText.ts";
import type { ApprovalResolution } from "./ticketCommand.ts";
import type { Lifecycle, Partition, RecoveryEpoch } from "./projectStore.ts";

declare const finalizationAttemptIdBrand: unique symbol;
declare const commitPermitIdBrand: unique symbol;
declare const inputBundleIdBrand: unique symbol;
declare const repositoryIdBrand: unique symbol;
declare const finalizerOwnerIdBrand: unique symbol;
declare const gitRefNameBrand: unique symbol;
declare const gitObjectIdBrand: unique symbol;
declare const repositoryCredentialBrand: unique symbol;

/** One preparation's identity: globally unique, opaque, and never reused. */
export type FinalizationAttemptId = string & {
  readonly [finalizationAttemptIdBrand]: true;
};

/** One commit permit's identity, distinct for every permit ever granted. */
export type CommitPermitId = string & {
  readonly [commitPermitIdBrand]: true;
};

/** An immutable set of references a deciding transaction pinned, under its own canonical digest. */
export type InputBundleId = string & { readonly [inputBundleIdBrand]: true };

/** The remote's stable identity, which one project binds and no other project may. */
export type RepositoryId = string & { readonly [repositoryIdBrand]: true };

/** A finalizer process instance, which is what a request claim lease is granted to. */
export type FinalizerOwnerId = string & {
  readonly [finalizerOwnerIdBrand]: true;
};

/** A fully qualified reference name, opaque here and never interpreted. */
export type GitRefName = string & { readonly [gitRefNameBrand]: true };

/** A commit's content-addressed identity, which is what makes an ancestry proof a proof. */
export type GitObjectId = string & { readonly [gitObjectIdBrand]: true };

/**
 * What authorizes one remote read or write, resolved through a port and never
 * stored. No relation this slice adds has a column for one, and nothing here
 * folds one into a digest.
 */
export type RepositoryCredential = string & {
  readonly [repositoryCredentialBrand]: true;
};

/** The longest opaque finalizer identity a stored row carries. */
export const finalizerIdentityCharsMax = 256;

/** The longest repository credential accepted from a bounded credential source. */
export const repositoryCredentialCharsMax = 4_096;

/** The longest reference name a stored row carries. */
export const gitRefNameCharsMax = 256;

/** The hexadecimal widths git's two object-id hashes produce, so a suite and a database CHECK iterate rather than restate. */
export const allGitObjectIdChars: readonly number[] = [40, 64];

/** The most conflicting paths one integration summary carries before it is truncated. */
export const conflictPathsMax = 256;

/** The anchored pattern an object identity matches, written once so this layer and the DDL agree. */
export function gitObjectIdPattern(): string {
  return `^(${allGitObjectIdChars.map((chars) => `[0-9a-f]{${String(chars)}}`).join("|")})$`;
}

/** Brands an opaque finalization attempt identity. */
export function asFinalizationAttemptId(value: string): FinalizationAttemptId {
  return asBoundedText(
    value,
    "finalization attempt",
    finalizerIdentityCharsMax,
  ) as FinalizationAttemptId;
}

/** Brands an opaque commit permit identity. */
export function asCommitPermitId(value: string): CommitPermitId {
  return asBoundedText(
    value,
    "commit permit",
    finalizerIdentityCharsMax,
  ) as CommitPermitId;
}

/** Brands an opaque input bundle identity. */
export function asInputBundleId(value: string): InputBundleId {
  return asBoundedText(
    value,
    "input bundle",
    finalizerIdentityCharsMax,
  ) as InputBundleId;
}

/** Brands an opaque repository identity. */
export function asRepositoryId(value: string): RepositoryId {
  return asBoundedText(
    value,
    "repository",
    finalizerIdentityCharsMax,
  ) as RepositoryId;
}

/** Brands an opaque finalizer instance identity. */
export function asFinalizerOwnerId(value: string): FinalizerOwnerId {
  return asBoundedText(
    value,
    "finalizer owner",
    finalizerIdentityCharsMax,
  ) as FinalizerOwnerId;
}

/** Brands a reference name. */
export function asGitRefName(value: string): GitRefName {
  return asBoundedText(value, "ref name", gitRefNameCharsMax) as GitRefName;
}

/** Brands a commit identity, refusing anything git's own object-id widths do not admit. */
export function asGitObjectId(value: string): GitObjectId {
  if (!new RegExp(gitObjectIdPattern(), "u").test(value)) {
    throw new RangeError(
      `object id: ${String(value.length)} characters is not a width git addresses an object at`,
    );
  }
  return value as GitObjectId;
}

/** Brands a repository credential, which is refused the same two shapes any other bounded text is. */
export function asRepositoryCredential(value: string): RepositoryCredential {
  return asBoundedText(
    value,
    "repository credential",
    repositoryCredentialCharsMax,
  ) as RepositoryCredential;
}

/** The states I3 gave a focused finalization request, in the order its CHECK declares them. */
export type FinalizationRequestState =
  "Open" | "Registered" | "Fulfilled" | "Invalidated";

/** Every request state, so a suite and a database CHECK iterate rather than restate. */
export const allFinalizationRequestStates: readonly FinalizationRequestState[] =
  ["Open", "Registered", "Fulfilled", "Invalidated"];

/** The durable effect whose external work one finalization request performs. */
export type FinalizationRequestKind =
  "RunFinalizer" | "PromoteForHandoff" | "PublishHandoff";

/** Every finalization request kind, so storage and the live protocol share one roster. */
export const allFinalizationRequestKinds: readonly FinalizationRequestKind[] = [
  "RunFinalizer",
  "PromoteForHandoff",
  "PublishHandoff",
];

/**
 * How a candidate is integrated against its observed target.
 * `merge-tree --write-tree` is a deterministic function of two commits, where a
 * rebase replays commits and is not.
 */
export type IntegrationStrategy = "Merge";

/** Every strategy, so a suite and a database CHECK iterate rather than restate. */
export const allIntegrationStrategies: readonly IntegrationStrategy[] = [
  "Merge",
];

/** What one preparation produced, which the attempt records once and never revises. */
export type FinalizationAttemptOutcome = "Prepared" | "Failed";

/** Every attempt outcome, so a suite and a database CHECK iterate rather than restate. */
export const allFinalizationAttemptOutcomes: readonly FinalizationAttemptOutcome[] =
  ["Prepared", "Failed"];

/**
 * An integration answered by a conflict and a preparation that produced no
 * candidate, both of which reduce to the one priced `FinalizationFailed`.
 */
export type FinalizationFailureKind = "MergeConflict" | "PreparationFailed";

/** Every failure kind, so a suite and a database CHECK iterate rather than restate. */
export const allFinalizationFailureKinds: readonly FinalizationFailureKind[] = [
  "MergeConflict",
  "PreparationFailed",
];

/** Whether a permit is still the authority for the one irreversible act, or has been spent. */
export type CommitPermitState = "Granted" | "Concluded";

/** Every permit state, so a suite and a database CHECK iterate rather than restate. */
export const allCommitPermitStates: readonly CommitPermitState[] = [
  "Granted",
  "Concluded",
];

/** What reading the target ref proved about the candidate, an unreadable ref among the answers. */
export type ReconciliationVerdict = "Promoted" | "NotPromoted" | "Unreadable";

/** Every verdict, so a suite and a database CHECK iterate rather than restate. */
export const allReconciliationVerdicts: readonly ReconciliationVerdict[] = [
  "Promoted",
  "NotPromoted",
  "Unreadable",
];

/** The kinds of reference an input bundle holds, which is the closed set that keeps logs and secrets out of one. */
export type InputBundleReferenceKind =
  | "ResultManifest"
  | "ConfigurationRevision"
  | "Repository"
  | "FinalizationAttempt"
  | "ConflictManifest"
  | "TargetCommit";

/** Every reference kind, so a suite and a database CHECK iterate rather than restate. */
export const allInputBundleReferenceKinds: readonly InputBundleReferenceKind[] =
  [
    "ResultManifest",
    "ConfigurationRevision",
    "Repository",
    "FinalizationAttempt",
    "ConflictManifest",
    "TargetCommit",
  ];

/** The most references one bundle holds, so a bundle cannot grow into a payload. */
export const inputBundleReferencesMax = 1_024;

/**
 * One reference an input bundle pins, which is never a log and never a secret.
 * The digest is present exactly where the referenced object is content
 * addressed, so a holder can tell the object it was pinned at from any later one.
 */
export interface InputBundleReference {
  readonly kind: InputBundleReferenceKind;
  readonly reference: string;
  readonly digest?: string;
}

/** The immutable references one transaction pinned, under the canonical digest of them. */
export interface InputBundle {
  readonly bundle: InputBundleId;
  readonly digest: string;
  readonly references: readonly InputBundleReference[];
}

/** The closed vocabulary a git act reports instead of free text, so a label is never a payload. */
export type GitEvidence =
  | "RemoteUnreachable"
  | "RemoteDenied"
  | "RefUnreadable"
  | "ObjectMissing"
  | "IntegrationFailed"
  | "PromotionTimedOut";

/** Every evidence label, so a suite and a database CHECK iterate rather than restate. */
export const allGitEvidence: readonly GitEvidence[] = [
  "RemoteUnreachable",
  "RemoteDenied",
  "RefUnreadable",
  "ObjectMissing",
  "IntegrationFailed",
  "PromotionTimedOut",
];

/** The authority kind every finalizer-submitted result is scoped and audited under. */
export const finalizerAuthorityKind = "Finalizer";

/** The key version a submitted result's idempotency scope is stamped with. */
export const finalizerKeyVersion = "finalizer-v1";

/** The remote one project's finalizations promote into, and the epoch it was bound under. */
export interface RepositoryBinding {
  readonly partition: Partition;
  readonly repository: RepositoryId;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly targetRef?: GitRefName;
  readonly credentialReference?: string;
}

/**
 * The binding a more specific reference name narrows. It is the one spelling of
 * that step, so an observation and a promotion cannot disagree about which ref
 * a ticket's work belongs to.
 */
export function repositoryBindingNarrowed(
  binding: RepositoryBinding,
  ref: GitRefName | undefined,
): RepositoryBinding {
  return ref === undefined ? binding : { ...binding, targetRef: ref };
}

/**
 * What a branch the brief names resolves to: the branch itself, or the
 * binding's own target under that branch's name where the remote does not hold
 * it yet. A branch nobody has created is not an unreadable ref — it is where
 * work starts or lands, from what the binding already names.
 */
export async function repositoryTargetObserved(
  git: Pick<GitPromotionPort, "observeTarget">,
  binding: RepositoryBinding,
  branch: GitRefName | undefined,
): Promise<TargetObserved> {
  const observed = await git.observeTarget(
    repositoryBindingNarrowed(binding, branch),
  );
  if (branch === undefined || observed.observed === "Target") return observed;
  if (observed.evidence !== "RefUnreadable") return observed;
  const base = await git.observeTarget(binding);
  return base.observed === "Target"
    ? {
        observed: "Target",
        target: {
          ref: branch,
          commit: base.target.commit,
          baseRef: base.target.ref,
        },
      }
    : base;
}

export interface PromoteForHandoffRequest {
  readonly kind: "PromoteForHandoff";
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly repository: RepositoryBinding;
}

export interface PublishHandoffRequest {
  readonly kind: "PublishHandoff";
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly repository: RepositoryBinding;
  readonly acceptedWorkRepository: RepositoryId;
  readonly acceptedWorkCommit: GitObjectId;
  readonly destinationPath: string;
  readonly output: string;
  readonly requestDigest: string;
}

export type HandoffFinalizationRequest =
  PromoteForHandoffRequest | PublishHandoffRequest;

/**
 * The immutable target one preparation observed, re-read from the remote and
 * never remembered. `baseRef` names the ref the commit was read from where the
 * target's own ref is a branch the remote does not hold yet, so a fetch has a
 * ref to ask for while the promotion still lands on the branch.
 */
export interface ObservedTarget {
  readonly ref: GitRefName;
  readonly commit: GitObjectId;
  readonly baseRef?: GitRefName;
}

/** One claim of a focused finalization request, held for a bounded stretch of database time. */
export interface FinalizationClaim {
  readonly partition: Partition;
  readonly request: string;
  readonly ticket: TicketId;
  readonly authorizingSeq: number;
  readonly requestGeneration: number;
  readonly claimGeneration: number;
  readonly state: FinalizationRequestState;
  readonly kind: FinalizationRequestKind;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly owner: FinalizerOwnerId;
}

/**
 * One preparation, written once and never updated, which is what makes it
 * evidence rather than a working note. Re-preparation creates another identity.
 */
export interface FinalizationAttempt {
  readonly attempt: FinalizationAttemptId;
  readonly request: string;
  readonly ticket: TicketId;
  readonly repository: RepositoryId;
  readonly target: ObservedTarget;
  readonly strategy: IntegrationStrategy;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly approvalRequired: boolean;
  readonly outcome: FinalizationAttemptOutcome;
  readonly candidate?: GitObjectId;
  readonly failureKind?: FinalizationFailureKind;
  readonly attemptDigest: string;
}

/** The one permit that authorizes the one irreversible act, at most one live per project. */
export interface CommitPermit {
  readonly permit: CommitPermitId;
  readonly attempt: FinalizationAttemptId;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly lifecycleGeneration: number;
  readonly state: CommitPermitState;
}

/** What the target ref proved about the candidate, recorded per permit and never absent for a hold. */
export interface FinalizationReconciliation {
  readonly permit: CommitPermitId;
  readonly candidate: GitObjectId;
  readonly target: GitRefName;
  readonly verdict: ReconciliationVerdict;
  readonly observed?: GitObjectId;
}

/**
 * Where the approval a pinned revision may require currently stands. The
 * finalizer reads the ticket-service-owned native action and maps it here, so a
 * withdrawn action is pending again rather than a fourth state.
 */
export type ApprovalStanding = "Pending" | "Granted" | "Declined";

/** Every approval standing, so a suite iterates rather than restates. */
export const allApprovalStandings: readonly ApprovalStanding[] = [
  "Pending",
  "Granted",
  "Declined",
];

/** What the ticket-service-owned action a finalizer opened currently says. */
export interface ApprovalAction {
  readonly state: "Open" | "Resolved" | "Withdrawn";
  readonly resolution?: ApprovalResolution;
}

/**
 * Where the approval for one prepared candidate stands. An action nobody has
 * answered and one the revision fence withdrew are both pending, because the
 * question either is still open or will be asked again against a new candidate.
 */
export function approvalStandingOf(
  action: ApprovalAction | undefined,
): ApprovalStanding {
  if (action === undefined || action.state !== "Resolved") return "Pending";
  if (action.resolution === undefined) {
    throw new Error("approval: a resolved action records no answer");
  }
  return action.resolution === "Approve" ? "Granted" : "Declined";
}

/**
 * The lifecycles under which the one irreversible act will never be authorized
 * again, so a finalization holding no permit aborts rather than waits.
 */
export const allClosingLifecycles: readonly Lifecycle[] = [
  "Deleting",
  "Retention",
];

/** Everything the pure pass reads, gathered before it runs so nothing is awaited inside it. */
export interface FinalizationView {
  readonly claim: FinalizationClaim;
  readonly lifecycle: Lifecycle;
  readonly repository?: RepositoryBinding;
  /** The branch the ticket's brief lands its work on, which the remote may not hold yet and the first promotion creates. */
  readonly targetBranch?: GitRefName;
  /** How the ticket's brief lands its work, absent for a ticket carrying no brief at all. */
  readonly finalizationMode?: BriefFinalizationMode;
  readonly handoffRequest?: HandoffFinalizationRequest;
  readonly observedTarget?: ObservedTarget;
  /** What the branch the work happened on holds, which is the tree a candidate is built over. */
  readonly observedWorkBranch?: ObservedTarget;
  readonly attempt?: FinalizationAttempt;
  readonly approval: ApprovalStanding;
  readonly permit?: CommitPermit;
  readonly reconciliation?: FinalizationReconciliation;
  readonly attemptsMade: number;
}

/** Why a finalization is durably stopped under attention rather than concluded or failed. */
export type FinalizationHoldKind =
  | "RepositoryUnbound"
  | "TargetUnreadable"
  | "PreparationRestartsExhausted"
  | "ApprovalDeclined"
  | "ReconciliationUnreadable"
  | "ContradictoryEvidence"
  | "ProposalRefused"
  | "ProposalUnavailable"
  | "ProposalDenied"
  | "ProposalBaseUnreadable"
  | "ProposalEvidenceUnstorable"
  | "ProposalCreationsExhausted";

/** Every hold kind, so a suite iterates over them rather than restating them. */
export const allFinalizationHoldKinds: readonly FinalizationHoldKind[] = [
  "RepositoryUnbound",
  "TargetUnreadable",
  "PreparationRestartsExhausted",
  "ApprovalDeclined",
  "ReconciliationUnreadable",
  "ContradictoryEvidence",
  "ProposalRefused",
  "ProposalUnavailable",
  "ProposalDenied",
  "ProposalBaseUnreadable",
  "ProposalEvidenceUnstorable",
  "ProposalCreationsExhausted",
];

/** The one conclusive thing `Core` is told, which carries a kind only where the model prices a failure. */
export type FinalizationConclusion =
  | { readonly outcome: Extract<FinalizationOutcome, "FinalizationSucceeded"> }
  | { readonly outcome: Extract<FinalizationOutcome, "PromotionAccepted"> }
  | {
      readonly outcome: Extract<
        FinalizationOutcome,
        "HandoffPublicationUnproven"
      >;
    }
  | {
      readonly outcome: Extract<FinalizationOutcome, "FinalizationFailed">;
      readonly kind: FinalizationFailureKind;
    };

/**
 * The one move an observed view authorizes. Every arm is a decision the caller
 * performs; nothing here performs anything.
 */
export type FinalizationDecision =
  | {
      readonly decide: "Prepare";
      readonly target: ObservedTarget;
      readonly restartsSpent: number;
    }
  | {
      readonly decide: "AwaitApproval";
      readonly attempt: FinalizationAttemptId;
    }
  | { readonly decide: "Abort"; readonly target: ObservedTarget }
  | { readonly decide: "Promote"; readonly attempt: FinalizationAttemptId }
  | { readonly decide: "Reconcile"; readonly permit: CommitPermitId }
  | { readonly decide: "Propose" }
  | { readonly decide: "Conclude"; readonly conclusion: FinalizationConclusion }
  | { readonly decide: "Hold"; readonly hold: FinalizationHoldKind }
  | { readonly decide: "Settled" };

/** Refuses a view whose durable rows contradict each other, which no later branch then has to re-ask. */
function finalizationNextAssertView(view: FinalizationView): void {
  const { attempt, permit, reconciliation, attemptsMade } = view;
  if (!Number.isSafeInteger(attemptsMade) || attemptsMade < 0) {
    throw new RangeError("finalization view: attemptsMade is not a count");
  }
  if (attempt !== undefined && attemptsMade < 1) {
    throw new RangeError(
      "finalization view: an attempt is present and no attempt was counted",
    );
  }
  if (attempt !== undefined && attempt.request !== view.claim.request) {
    throw new RangeError(
      "finalization view: the attempt answers another request",
    );
  }
  if (
    attempt !== undefined &&
    (attempt.outcome === "Prepared") !== (attempt.candidate !== undefined)
  ) {
    throw new RangeError(
      "finalization view: a prepared attempt pins no candidate, or a failed one pins one",
    );
  }
  if (
    attempt !== undefined &&
    (attempt.outcome === "Failed") !== (attempt.failureKind !== undefined)
  ) {
    throw new RangeError(
      "finalization view: a failed attempt names no kind, or a prepared one names one",
    );
  }
  if (
    permit !== undefined &&
    attempt !== undefined &&
    permit.attempt !== attempt.attempt
  ) {
    throw new RangeError("finalization view: the permit names another attempt");
  }
  if (permit === undefined && reconciliation !== undefined) {
    throw new RangeError(
      "finalization view: a reconciliation is present with no permit to conclude",
    );
  }
  if (
    permit !== undefined &&
    reconciliation !== undefined &&
    reconciliation.permit !== permit.permit
  ) {
    throw new RangeError(
      "finalization view: the reconciliation concludes another permit",
    );
  }
}

/** Whether another preparation is authorized, and the hold that is left when it is not. */
function finalizationNextRestart(
  config: FinalizerConfig,
  view: FinalizationView,
): FinalizationDecision {
  const target = view.observedTarget;
  if (target === undefined) return { decide: "Hold", hold: "TargetUnreadable" };
  if (allClosingLifecycles.includes(view.lifecycle)) {
    return { decide: "Abort", target };
  }
  const restartsSpent = view.attemptsMade > 0 ? view.attemptsMade - 1 : 0;
  if (restartsSpent >= config.preparationRestartsMax) {
    return { decide: "Hold", hold: "PreparationRestartsExhausted" };
  }
  return { decide: "Prepare", target, restartsSpent };
}

/**
 * What a promoted candidate concludes as. A brief landing by pull request is
 * not finished when the branch moved — the proposal it asked for still has to
 * exist — where a handoff never proposes at all, its promotion being into a
 * repository the ticket never worked in.
 */
function finalizationNextPromoted(
  view: FinalizationView,
): FinalizationDecision {
  if (view.claim.kind === "PromoteForHandoff") {
    return { decide: "Conclude", conclusion: { outcome: "PromotionAccepted" } };
  }
  if (
    view.claim.kind === "RunFinalizer" &&
    view.finalizationMode === "PullRequest"
  ) {
    return { decide: "Propose" };
  }
  return {
    decide: "Conclude",
    conclusion: { outcome: "FinalizationSucceeded" },
  };
}

/**
 * What a finalization holding a permit may do next. A granted permit is
 * abandoned only by a reconciliation that concluded, so an ambiguous promotion
 * has no path to a conclusive outcome through here.
 */
function finalizationNextUnderPermit(
  config: FinalizerConfig,
  view: FinalizationView,
  permit: CommitPermit,
): FinalizationDecision {
  const reconciliation = view.reconciliation;
  if (permit.state === "Concluded") {
    if (
      reconciliation === undefined ||
      reconciliation.verdict === "Unreadable"
    ) {
      return { decide: "Hold", hold: "ContradictoryEvidence" };
    }
    if (reconciliation.verdict === "Promoted") {
      return finalizationNextPromoted(view);
    }
    return finalizationNextRestart(config, view);
  }
  if (reconciliation === undefined) {
    return { decide: "Reconcile", permit: permit.permit };
  }
  if (reconciliation.verdict === "Unreadable") {
    if (view.claim.kind === "PublishHandoff") {
      return {
        decide: "Conclude",
        conclusion: { outcome: "HandoffPublicationUnproven" },
      };
    }
    return { decide: "Hold", hold: "ReconciliationUnreadable" };
  }
  return { decide: "Hold", hold: "ContradictoryEvidence" };
}

/**
 * What a finalization that has obtained no permit may do next, the revision
 * fence and the closure abort included. A failure already recorded is concluded
 * before anything is read of the remote, because the evidence is the rows.
 */
function finalizationNextBeforePermit(
  config: FinalizerConfig,
  view: FinalizationView,
): FinalizationDecision {
  const attempt = view.attempt;
  if (attempt?.outcome === "Failed" && attempt.failureKind !== undefined) {
    return {
      decide: "Conclude",
      conclusion:
        view.claim.kind === "PublishHandoff"
          ? { outcome: "HandoffPublicationUnproven" }
          : { outcome: "FinalizationFailed", kind: attempt.failureKind },
    };
  }
  const aborting = view.observedTarget ?? attempt?.target;
  if (allClosingLifecycles.includes(view.lifecycle)) {
    return aborting === undefined
      ? { decide: "Hold", hold: "TargetUnreadable" }
      : { decide: "Abort", target: aborting };
  }
  const target = view.observedTarget;
  if (target === undefined) return { decide: "Hold", hold: "TargetUnreadable" };
  if (attempt === undefined) {
    return { decide: "Prepare", target, restartsSpent: 0 };
  }
  if (
    attempt.target.commit !== target.commit ||
    attempt.target.ref !== target.ref
  ) {
    return finalizationNextRestart(config, view);
  }
  if (view.approval === "Declined") {
    return { decide: "Hold", hold: "ApprovalDeclined" };
  }
  if (attempt.approvalRequired && view.approval === "Pending") {
    return { decide: "AwaitApproval", attempt: attempt.attempt };
  }
  return { decide: "Promote", attempt: attempt.attempt };
}

/**
 * The one move an observed view authorizes for one claimed request. It reads
 * nothing, performs nothing and awaits nothing.
 */
export function finalizationNext(
  config: FinalizerConfig,
  view: FinalizationView,
): FinalizationDecision {
  finalizationNextAssertView(view);
  if (view.claim.state === "Fulfilled" || view.claim.state === "Invalidated") {
    return { decide: "Settled" };
  }
  if (view.repository === undefined) {
    return { decide: "Hold", hold: "RepositoryUnbound" };
  }
  const permit = view.permit;
  if (permit !== undefined) {
    return finalizationNextUnderPermit(config, view, permit);
  }
  return finalizationNextBeforePermit(config, view);
}

/** What observing the remote's default branch found, an unreadable remote kept apart from a target. */
export type TargetObserved =
  | { readonly observed: "Target"; readonly target: ObservedTarget }
  | { readonly observed: "Unreadable"; readonly evidence: GitEvidence };

/** The most files one candidate is built from, so a preparation cannot grow into a payload. */
export const candidateFilesMax = 1_024;

/** The most content one candidate is built from, summed over every file it carries. */
export const candidateBytesMax = 64 * 1024 * 1024;

/**
 * The most passed work executions one finalization gathers. Every one of them
 * must pin the same configuration revision, so the ceiling is on the rows the
 * agreement is decided over rather than on a page of them.
 */
export const candidateExecutionsMax = 256;

/**
 * One verified handoff artifact's bytes, under the path it takes in the
 * candidate tree. Content is passed by value because the port that writes it
 * may not read the store that holds it.
 */
export interface CandidateFile {
  readonly path: string;
  readonly content: Uint8Array;
}

/** One candidate asked of a bare scratch repository, built from the artifacts one bundle pins. */
export interface CandidatePreparation {
  readonly repository: RepositoryBinding;
  readonly ticket: TicketId;
  readonly bundle: InputBundleId;
  readonly base: ObservedTarget;
  readonly files: readonly CandidateFile[];
}

/** One worker-authored candidate whose immutable identity must be proven from its remote ref. */
export interface CandidateSourcePreparation {
  readonly repository: RepositoryBinding;
  readonly ref: GitRefName;
  readonly commit: GitObjectId;
  readonly base: GitObjectId;
}

/** What constructing a candidate found, a git refusal a value like every other here. */
export type CandidatePrepared =
  | { readonly prepared: "Candidate"; readonly candidate: GitObjectId }
  | { readonly prepared: "Failed"; readonly evidence: GitEvidence };

/** One integration against exactly one observed target, which is what bounded means here. */
export interface CandidateIntegration {
  readonly repository: RepositoryBinding;
  readonly target: ObservedTarget;
  readonly candidate: GitObjectId;
  readonly strategy: IntegrationStrategy;
}

/** The conflicting paths one integration reported, bounded so a summary cannot become a payload. */
export interface ConflictSummary {
  readonly paths: readonly string[];
  readonly truncated: boolean;
}

/**
 * What integrating found: an integrated candidate, a genuine conflict, or a git
 * refusal. A conflict carries the merge base it was computed against, absent
 * only where the two commits share no history at all.
 */
export type CandidateIntegrated =
  | { readonly integrated: "Candidate"; readonly candidate: GitObjectId }
  | {
      readonly integrated: "Conflicted";
      readonly conflict: ConflictSummary;
      readonly base?: GitObjectId;
    }
  | { readonly integrated: "Failed"; readonly evidence: GitEvidence };

/** The one irreversible act, which names the permit that authorizes it so an unpermitted one is unspellable. */
export interface CandidatePromotion {
  readonly repository: RepositoryBinding;
  readonly permit: CommitPermitId;
  readonly target: ObservedTarget;
  readonly candidate: GitObjectId;
}

/**
 * What the conditional ref update found. `Ambiguous` is the answer that neither
 * confirms nor denies, and it is why the permit cannot be abandoned before
 * reconciliation.
 */
export type CandidatePromoted =
  | { readonly promoted: "Advanced" }
  | { readonly promoted: "Rejected"; readonly observed: GitObjectId }
  | { readonly promoted: "Ambiguous"; readonly evidence: GitEvidence };

/** One reading of what a ref proves about an immutable candidate identity. */
export interface AncestryProof {
  readonly repository: RepositoryBinding;
  readonly ref: GitRefName;
  readonly candidate: GitObjectId;
}

/** What the ref proved, an unreadable ref kept apart from a ref that proved the candidate absent. */
export type AncestryProved =
  | { readonly proved: "Ancestor"; readonly observed: GitObjectId }
  | { readonly proved: "NotAncestor"; readonly observed: GitObjectId }
  | { readonly proved: "Unreadable"; readonly evidence: GitEvidence };

/**
 * Git, behind a typed port so the durable state machine can be driven without a
 * remote. A non-zero exit is one of the values below; only git being unable to
 * run at all raises.
 */
export interface GitPromotionPort {
  /** Re-reads the remote's default branch, which every preparation pins and none remembers. */
  observeTarget(repository: RepositoryBinding): Promise<TargetObserved>;

  /** Writes the candidate tree and commit into a bare scratch repository, with no working tree at any point. */
  prepareCandidate(
    preparation: CandidatePreparation,
  ): Promise<CandidatePrepared>;

  /** Fetches a worker source ref and proves its exact commit descends from its declared base. */
  prepareSource(
    preparation: CandidateSourcePreparation,
  ): Promise<CandidatePrepared>;

  /** Integrates one candidate against one observed target, deterministically. */
  integrateCandidate(
    integration: CandidateIntegration,
  ): Promise<CandidateIntegrated>;

  /** Advances the target ref to the candidate under a permit, conditionally on the target it observed. */
  promoteCandidate(promotion: CandidatePromotion): Promise<CandidatePromoted>;

  /** Reads back whether the target ref proves the candidate reached it. */
  proveCandidateAncestry(proof: AncestryProof): Promise<AncestryProved>;
}

/** What resolving a repository credential found, a denial kept apart from an outage. */
export type CredentialResolved =
  | {
      readonly resolved: "Credential";
      readonly credential: RepositoryCredential;
    }
  | { readonly resolved: "Denied" }
  | { readonly resolved: "Unavailable" };

/**
 * Where a repository's credential comes from, which is the composition root and
 * never the environment. Nothing under `src/` reads an environment variable.
 */
export interface RepositoryCredentialPort {
  credential(repository: RepositoryBinding): Promise<CredentialResolved>;
}

/**
 * The finalizer's bounded configuration, every value of it an operational
 * choice. A permit carries no lease among them, because a permit that expired
 * into safety would release an act nothing had yet proved.
 */
export interface FinalizerConfig {
  readonly requestClaimLeaseSecs: number;
  readonly requestsPerPassMax: number;
  readonly preparationRestartsMax: number;
  readonly preparationsPerPassMax: number;
  readonly promotionsPerPassMax: number;
  readonly reconciliationsPerPassMax: number;
  readonly heldPermitsPerPassMax: number;
  readonly proposalsPerPassMax: number;
  readonly proposalCreationsMax: number;
  readonly proposalReconciliationsMax: number;
}

/** The values a deployment starts from when it names none. */
export const finalizerDefaults: FinalizerConfig = {
  requestClaimLeaseSecs: 30,
  requestsPerPassMax: 32,
  preparationRestartsMax: 3,
  preparationsPerPassMax: 8,
  promotionsPerPassMax: 8,
  reconciliationsPerPassMax: 32,
  heldPermitsPerPassMax: 32,
  proposalsPerPassMax: 8,
  proposalCreationsMax: 3,
  proposalReconciliationsMax: 3,
};

/**
 * Every bound a configuration must name, read from the defaults so that a bound
 * added to the interface has a default and a required name at once. Reading the
 * offered configuration's own keys would check the bounds it happens to carry
 * rather than the ones it owes.
 */
const finalizerBounds = Object.keys(
  finalizerDefaults,
) as readonly (keyof FinalizerConfig)[];

/** Refuses a configuration whose bounds are not positive safe integers. */
export function checkedFinalizerConfig(
  config: FinalizerConfig,
): FinalizerConfig {
  for (const name of finalizerBounds) {
    const value: number = config[name];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(
        `finalizer configuration: ${name} must be a positive safe integer`,
      );
    }
  }
  return config;
}

/** One permit asked for, naming the claim that fences it and the attempt it would authorize. */
export interface PermitRequest {
  readonly claim: FinalizationClaim;
  readonly attempt: FinalizationAttemptId;
}

/**
 * Why no permit was granted. Every arm is a durable fact the caller reads and
 * none of them is a failure, so a refused grant leaves the finalization exactly
 * where it stood.
 */
export type PermitRefusal =
  | "Fenced"
  | "ProjectClosed"
  | "PermitLive"
  | "PermitSpent"
  | "AttemptUnprepared";

/** Every refusal, so a suite iterates rather than restates. */
export const allPermitRefusals: readonly PermitRefusal[] = [
  "Fenced",
  "ProjectClosed",
  "PermitLive",
  "PermitSpent",
  "AttemptUnprepared",
];

/** What asking for the one permit found, the granted permit itself or the refusal that stands. */
export type PermitGranted =
  | { readonly granted: "Permit"; readonly permit: CommitPermit }
  | { readonly granted: "Refused"; readonly refusal: PermitRefusal };

/** One reading of the target ref, offered for the permit it concludes. */
export interface ReconciliationRecord {
  readonly partition: Partition;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly reconciliation: FinalizationReconciliation;
}

/**
 * What recording a reading did to the permit it was read for. `Held` is the
 * unreadable ref durably written down, which is why a hold is never an absence.
 */
export type Reconciled =
  | { readonly recorded: "Concluded" }
  | { readonly recorded: "Held" }
  | { readonly recorded: "Refused" };

/** One permit a reading could not settle, carrying everything a re-reading needs. */
export interface HeldPermit {
  readonly partition: Partition;
  readonly permit: CommitPermitId;
  readonly repository: RepositoryBinding;
  readonly target: GitRefName;
  readonly candidate: GitObjectId;
}

/** One conclusion offered to the one authenticated door, naming the attempt that produced it. */
export interface FinalizationOffer {
  readonly claim: FinalizationClaim;
  readonly attempt: FinalizationAttemptId;
  readonly conclusion: FinalizationConclusion;
}

/**
 * What the door answered. Every arm but `Submitted` and `AlreadySubmitted`
 * wrote no journal entry, no operation and no decision input.
 */
export type FinalizationSubmitted =
  | { readonly submitted: "Submitted"; readonly operation: string }
  | { readonly submitted: "AlreadySubmitted"; readonly operation: string }
  | { readonly submitted: "UnknownRequest" }
  | { readonly submitted: "BindingMismatch" }
  | { readonly submitted: "NotAdmitted" };

/**
 * The durable finalization authority for one installation, which the finalizer
 * role reaches and nothing else does. It orders requests, holds them, gathers
 * what the pure pass reads and submits a conclusion through one door.
 */
export interface FinalizerStore {
  /**
   * Takes a bounded lease on at most `requestsMax` unclaimed or lapsed requests
   * in `authorizing_seq` order, refusing every claim under a superseded epoch.
   */
  claimRequests(
    owner: FinalizerOwnerId,
    epoch: RecoveryEpoch,
    requestsMax: number,
    leaseSecs: number,
  ): Promise<readonly FinalizationClaim[]>;

  /** Extends a claim still held at its own generation under the current epoch. */
  extendClaim(claim: FinalizationClaim, leaseSecs: number): Promise<boolean>;

  /** Everything the pure pass reads of the durable rows, gathered before it runs. */
  durableView(claim: FinalizationClaim): Promise<FinalizationView | undefined>;

  /**
   * Grants the one permit that authorizes the one irreversible act, fenced by
   * the claim, the recovery epoch and the project's lifecycle generation.
   */
  grantPermit(request: PermitRequest): Promise<PermitGranted>;

  /**
   * Records what the target ref proved, spending the permit in the same
   * transaction where the reading concluded and leaving it granted where it did
   * not.
   */
  recordReconciliation(record: ReconciliationRecord): Promise<Reconciled>;

  /** The permits at most `permitsMax` of whose readings could not settle, in key order. */
  heldPermits(
    epoch: RecoveryEpoch,
    permitsMax: number,
  ): Promise<readonly HeldPermit[]>;

  /**
   * Offers one conclusion to `submit_finalization_result`, and invalidates the
   * request when the project will admit no result for it ever again.
   */
  submitResult(offer: FinalizationOffer): Promise<FinalizationSubmitted>;

  /** Gives back the claim on a request that has settled, so no lease outlives its work. */
  settleClaim(claim: FinalizationClaim): Promise<boolean>;

  /** Reopens at most `requestsMax` claims whose lease has run out, and drops the leases on settled rows. */
  reclaimLapsed(epoch: RecoveryEpoch, requestsMax: number): Promise<number>;

  /** Reopens at most `requestsMax` claims held under an epoch a restore superseded. */
  reclaimStaleEpoch(epoch: RecoveryEpoch, requestsMax: number): Promise<number>;
}
