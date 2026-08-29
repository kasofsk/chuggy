/**
 * The finalizer service: what one bounded pass does between holding a claim on a
 * finalization request and holding the one conclusion `Core` is ever told.
 *
 * JOURNAL, THEN EFFECT, AND THE PERMIT IS WHAT MAKES THAT ORDER SURVIVABLE.
 * `model/refinement.qnt` carries the other order as a proved counterexample, so
 * the permit is granted and committed before `promoteCandidate` is called and is
 * abandoned only by a reading that concluded. A crash between the two leaves a
 * granted permit with no conclusion; the claim lapses, recovery reopens the
 * request, and the next pass reads the permit and reconciles by ancestry rather
 * than assuming either answer.
 *
 * AMBIGUITY IS AN ANSWER AND NEVER AN OUTCOME. A conditional ref update that
 * neither confirmed nor denied leaves the repository the only authority on
 * whether the ref moved, so the pass proves ancestry against the immutable
 * candidate identity: an ancestor succeeded, a non-ancestor did not and the
 * attempt may proceed, and an unreadable ref is a durable hold. None of the
 * three expires the permit or authorizes a second promotion.
 *
 * A REFUSED UPDATE IS INFORMATION. The ref did not advance and the observed
 * value says what it holds instead, so the revision fence restarts preparation
 * from the newly observed immutable target under `preparationRestartsMax` and
 * exhausting that ceiling is an operational hold rather than a priced failure.
 *
 * A HELD READING IS RE-READ, BOUNDED, AND BY NOBODY ELSE. An unreadable ref is a
 * state the reconciliation carries, and the hold ends when the reading concludes
 * and no earlier — so the pass re-proves at most `heldPermitsPerPassMax` of them
 * each time it runs, under the permit's own fence rather than under a claim,
 * because the permit is the authority for the act and therefore for reading it.
 *
 * EVERY PASS IS BOUNDED AND HAS NO LOOP OF ITS OWN. Each step takes its ceiling
 * from the configuration it re-checks, advances at most one decision per claimed
 * request, and returns; the loop that calls it again is a deployment's. What it
 * reports is what it moved, and a held count is every finalization it left
 * exactly where it found it — a hold the view decided, a ref it could not read,
 * a permit it was refused, and a request the pass had no budget left for.
 *
 * A PASS FENCES BEFORE IT MOVES ANYTHING ELSE. Claims held under a superseded
 * epoch and claims past their expiry are reopened first, because a lease that
 * lapsed is not self-healing and nothing claimable can be drawn until those rows
 * say so again.
 *
 * THE TICKET'S OWN BRIEF IS THE LAST WORD ON WHERE ITS WORK LANDS, AND SAYS IT
 * APART FROM WHERE THE WORK HAPPENED. The target is the project's binding
 * narrowed by the configuration's handoff role and then by the brief: by the
 * reference its finalization targets, or by the branch the work happened on
 * where it targets none. So a ticket is promoted onto the branch its brief
 * named and never onto whatever the remote's default happens to hold. A
 * publication is the one exception, its destination being a repository the
 * ticket never worked in.
 *
 * A PULL REQUEST MOVES THAT TARGET, AND ONLY FOR THE FINALIZATION THAT OPENS
 * ONE. Under `RunFinalizer` a brief that proposes lands on the branch its work
 * happened on, because that branch is the head the proposal is opened from and
 * the reference its finalization names is the base. A handoff request narrows
 * by that reference exactly as a push does: its promotion is into a repository
 * the ticket never worked in and has nothing to do with the brief's mode. The
 * pairing is refused where the two are written — a configuration that hands off
 * will not release a brief that proposes — so this is a narrowing and not a
 * decision about which of them wins. A proposing brief naming no branch of its
 * own is a hold and never a fallback: the branch it does not name is the head
 * the proposal needs, and the binding's default is somebody else's line of
 * development rather than a stand-in for it.
 *
 * A BRIEF NAMING BOTH IS READ TWICE, AND THE TWO READS DO DIFFERENT JOBS. The
 * branch the work happened on — the one `./executionSourceObservation.ts`
 * observed that work against — is the tree a candidate is built over and the
 * commit it descends from, which is what carries everything that accumulated
 * there onto the target. The target is what that candidate is then integrated
 * against, what the attempt pins, and what the revision fence and the one
 * conditional ref update are about. The work's own branch is read once and
 * fenced by nothing: no attempt pins it, and a pass that found it moved would
 * have nothing to compare against. Where the brief lands the work where it
 * happened the two are one ref, the second read is not made at all, and the
 * remote is asked exactly what it was asked before.
 *
 * A BRANCH THE REMOTE DOES NOT HOLD YET IS CREATED BY THE PROMOTION. The base
 * is the binding's own target, the attempt pins the branch the work lands on,
 * and the one conditional ref update creates it — so a ticket landing on a
 * branch nobody has made is finalized rather than held. A branch that appeared
 * in the meantime refuses that update and the revision fence re-prepares
 * against it, which is the same path a target that moved takes.
 *
 * PREPARATION OBSERVES THE TARGET TWICE AND INTEGRATES AGAINST THE SECOND. The
 * candidate is the tree of the branch the work happened on with the verified
 * handoff artifacts standing in it, which for a ticket landing where it worked
 * is the tree of the target the view observed — so integrating it against that
 * same commit could only ever be the candidate itself and no automatic
 * integration would ever be attempted at all. The remote is therefore re-read
 * once the candidate exists, and the one integration this preparation is
 * allowed is against what the remote holds then — which is where a merge base,
 * a clean automatic merge and a genuine conflict all come from. The attempt
 * pins that second observation, because it is the commit the promotion will be
 * conditional on.
 *
 * ONE INTEGRATION PER OBSERVED TARGET, AND THE FENCE DOES THE REST. Nothing here
 * loops until the remote holds still: a target that moved again is found by the
 * next pass comparing the attempt's pinned target with a fresh observation, and
 * that restarts preparation under `preparationRestartsMax` rather than chasing.
 * Exhausting the ceiling is an operational hold, so a finalizer's own
 * re-preparations spend nothing and stay invisible to `Core`.
 *
 * ONLY CONCLUSIVE EVIDENCE IS WRITTEN DOWN. A storage outage, an unreadable
 * remote and a git call that could not answer leave no attempt at all and are
 * counted as holds; what becomes a `PreparationFailed` or a `MergeConflict` is
 * a property of the rows and the trees, and stays true however long anyone
 * waits. A ticket whose passed work has no result to read is a hold too, for
 * the plainer reason that an attempt pinning no configuration revision is a row
 * the schema will not hold.
 *
 * A CLOSING PROJECT IS ABORTED AND NEVER PROMOTED. A lifecycle that will admit
 * no further irreversible act makes the abort the only move left before the
 * permit: the finalization records the deterministic failure it aborted to and
 * concludes it, having asked for no permit and written to no remote, which is
 * what makes the abort reversible. Past the permit nothing changes at all — the
 * reading of the ref still has to conclude, because the repository is the only
 * authority on whether it advanced and no erasure may precede that reading. The
 * abort is the preparation that ticket will now get, so it spends the
 * preparation budget and is observed as one, with no restart behind it.
 *
 * A PROPOSAL IS OPENED AFTER THE PROMOTION AND UNDER THE SAME ORDER. Where the
 * brief lands by opening a change proposal, the candidate is promoted onto the
 * ticket's own branch exactly as any other, and the proposal is opened from
 * that branch into the reference the finalization names. The attempt is counted
 * and committed before `create` is called, for the reason the permit is granted
 * before the ref update: a crash between the two leaves a create in flight that
 * nobody heard back from, which sends the next pass to `readByMarker` rather
 * than to a second create. The ticket concludes on evidence that the forge
 * holds the proposal: a create answering with evidence is that proof itself,
 * and a create answering with none is read back by its marker.
 *
 * A FORGE THAT DECLINED TO BE ASKED HAS ANSWERED NOTHING. A create the forge
 * would not take — a rate limit, a credential this deployment could not read,
 * an authority a rotation withdrew — says nothing about whether a proposal
 * stands, so the attempt it declined is released with the create it stood for
 * unspent and the request holds and asks again, exactly as an unreadable remote
 * does. Readings answer the same way: one that could not be made is no reading
 * about the proposal, and readings that reached the forge and found nothing
 * spend the create they were taken about, after which another one is what
 * `proposalCreationsMax` authorizes. Every act is bounded by the pass as well: one
 * proposal act per claimed request, and no more of them in a pass than
 * `proposalsPerPassMax`.
 *
 * THE PROPOSAL'S BASE IS A THIRD OBSERVATION AND IS NEVER CREATED. The branch
 * the work happened on and the one the promotion lands are both read above; the
 * base is read as itself, without the binding's fallback, because a proposal
 * opened into a branch the remote does not hold is not one the forge could
 * accept — so an unreadable base is a hold, and making that branch is nobody's
 * job here.
 *
 * NOTHING HERE READS A CLOCK. Every lease and expiry is a duration handed to the
 * store, which asks the database what time it is.
 *
 * THE REPORT COUNTS HOLDS AND THE SINK NAMES THEM. Every hold goes through
 * `finalizerHold`, which is what keeps the count and the observations in
 * agreement; nothing branches on either, because a sealed sink answers nothing
 * and cannot be read back.
 */

import { assertNever } from "../domain/assertNever.ts";
import {
  asChangeProposalRequestIdentity,
  changeProposalRequestFromBranch,
  proposalMarkerOf,
  reconcileChangeProposal,
  type ChangeProposalForges,
  type ChangeProposalRequest,
  type ForgeBinding,
} from "./changeProposal.ts";
import {
  finalizationProposalBody,
  finalizationProposalCreationRecording,
  finalizationProposalNext,
  finalizationProposalReadingRecording,
  finalizationProposalTitle,
  type FinalizationProposalGathered,
  type FinalizationProposalRecording,
  type FinalizerProposalStore,
  type StoredChangeProposal,
} from "./finalizationProposal.ts";
import {
  checkedFinalizerConfig,
  finalizationNext,
  type AncestryProved,
  type CandidateFile,
  type CandidateIntegrated,
  type CommitPermitId,
  type FinalizationAttempt,
  type FinalizationAttemptId,
  type FinalizationClaim,
  type FinalizationConclusion,
  type FinalizationReconciliation,
  type FinalizationView,
  type FinalizerConfig,
  type FinalizerOwnerId,
  type FinalizerStore,
  type GitObjectId,
  type GitPromotionPort,
  type GitRefName,
  type HeldPermit,
  type IntegrationStrategy,
  type InputBundle,
  type InputBundleId,
  type InputBundleReference,
  type ObservedTarget,
  type RepositoryBinding,
  type RepositoryId,
  type TargetObserved,
  inputBundleReferencesMax,
  repositoryBindingNarrowed,
  repositoryTargetObserved,
} from "./finalizer.ts";
import {
  canonicalChangeProposalRequest,
  canonicalFinalizationAttempt,
  canonicalInputBundle,
  conflictManifestText,
  handoffAccepted,
  handoffSuperseded,
  type AttemptRecord,
  type FinalizationDigestFunction,
  type FinalizerIdentityFactory,
  type FinalizerPreparationStore,
  type HandoffContentPort,
  type PinnedConfiguration,
  type PreparationIdentity,
  type ProjectArtifactPort,
  type TicketHandoff,
} from "./finalizerPreparation.ts";
import {
  recordFinalizer,
  type FinalizerHoldReason,
  type FinalizerTelemetry,
} from "./finalizerTelemetry.ts";
import type { ResultManifestId } from "./resultManifest.ts";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";
import type { DraftBrief, TicketBriefPort } from "./ticketBrief.ts";

/** Everything a finalizer pass calls out through, and the bounds it works within. */
export interface FinalizerService {
  readonly store: FinalizerStore &
    FinalizerPreparationStore &
    FinalizerProposalStore;
  readonly git: GitPromotionPort;
  readonly forges: ChangeProposalForges;
  readonly ticketBriefs: TicketBriefPort;
  readonly handoffs: HandoffContentPort;
  readonly artifacts: ProjectArtifactPort;
  readonly identities: FinalizerIdentityFactory;
  readonly digestOf: FinalizationDigestFunction;
  readonly config: FinalizerConfig;
  readonly metrics: FinalizerTelemetry;
}

/** What one bounded pass moved, which is what a deployment's loop paces itself by. */
export interface FinalizerPassReport {
  readonly reopened: number;
  readonly rereadings: number;
  readonly preparations: number;
  readonly approvals: number;
  readonly promotions: number;
  readonly reconciliations: number;
  readonly proposals: number;
  readonly conclusions: number;
  readonly holds: number;
}

/**
 * What one pass has spent so far, which is both its ceiling and its report.
 * Re-reading a hold and reconciling a permit nobody has read are counted apart,
 * because one ceiling over both would let a backlog of holds starve recovery.
 */
interface FinalizerTally {
  rereadings: number;
  preparations: number;
  approvals: number;
  promotions: number;
  reconciliations: number;
  proposals: number;
  conclusions: number;
  holds: number;
}

/**
 * The one strategy a preparation integrates with. `merge-tree --write-tree` is
 * a deterministic function of two commits, where a rebase replays commits.
 */
const finalizerStrategy: IntegrationStrategy = "Merge";

/** What one reading of the target ref records, an unreadable ref among the answers. */
type FinalizerReading = Pick<
  FinalizationReconciliation,
  "verdict" | "observed"
>;

/** Everything a reading needs to name the permit it settles. */
interface FinalizerReadingSubject {
  readonly partition: Partition;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly permit: CommitPermitId;
  readonly candidate: GitObjectId;
  readonly target: GitRefName;
}

/** What the prepared attempt one claim is being advanced on pinned. */
interface FinalizerCandidate {
  readonly repository: RepositoryBinding;
  readonly target: ObservedTarget;
  readonly candidate: GitObjectId;
  readonly attempt: FinalizationAttempt;
}

/**
 * Counts one finalization the pass left exactly where it found it, and names
 * why. Every hold in this module goes through here, so the report's count and
 * the observations cannot disagree.
 */
function finalizerHold(
  service: FinalizerService,
  tally: FinalizerTally,
  reason: FinalizerHoldReason,
): void {
  tally.holds += 1;
  recordFinalizer(service.metrics, (metrics) => {
    metrics.holding(reason);
  });
}

/**
 * Whether this pass has already spent the ceiling a move draws on. A
 * finalization the budget ran out for was left exactly where it was found, so
 * it is held rather than dropped out of the report entirely.
 */
function finalizerCeilingReached(
  service: FinalizerService,
  tally: FinalizerTally,
  spent: keyof FinalizerTally,
  ceiling: number,
): boolean {
  if (tally[spent] < ceiling) return false;
  finalizerHold(service, tally, "PassCeilingReached");
  return true;
}

/** Reopens the claims a takeover and a lapsed lease each condemn, both bounded. */
export async function finalizerFence(
  service: FinalizerService,
  epoch: RecoveryEpoch,
): Promise<number> {
  const config = checkedFinalizerConfig(service.config);
  const stale = await service.store.reclaimStaleEpoch(
    epoch,
    config.requestsPerPassMax,
  );
  const lapsed = await service.store.reclaimLapsed(
    epoch,
    config.requestsPerPassMax,
  );
  recordFinalizer(service.metrics, (metrics) => {
    metrics.reopening("Epoch", stale);
    metrics.reopening("Lapsed", lapsed);
  });
  return stale + lapsed;
}

/** What one ancestry proof says the reconciliation records. */
function finalizerReadingOf(proved: AncestryProved): FinalizerReading {
  switch (proved.proved) {
    case "Ancestor":
      return { verdict: "Promoted", observed: proved.observed };
    case "NotAncestor":
      return { verdict: "NotPromoted", observed: proved.observed };
    case "Unreadable":
      return { verdict: "Unreadable" };
    default:
      return assertNever(proved);
  }
}

/** Records one reading, which spends the permit unless the ref could not be read. */
async function finalizerRecordReading(
  service: FinalizerService,
  subject: FinalizerReadingSubject,
  reading: FinalizerReading,
  tally: FinalizerTally,
): Promise<void> {
  const recorded = await service.store.recordReconciliation({
    partition: subject.partition,
    recoveryEpoch: subject.recoveryEpoch,
    reconciliation: {
      permit: subject.permit,
      candidate: subject.candidate,
      target: subject.target,
      ...reading,
    },
  });
  recordFinalizer(service.metrics, (metrics) => {
    metrics.reconciliation(reading.verdict);
    if (recorded.recorded === "Concluded") metrics.permit("Concluded");
  });
  if (recorded.recorded !== "Concluded")
    finalizerHold(service, tally, "ReconciliationUnrecorded");
}

/** Re-proves the readings that could not settle, so a hold ends where the ref becomes readable. */
async function finalizerReadHolds(
  service: FinalizerService,
  epoch: RecoveryEpoch,
  tally: FinalizerTally,
): Promise<void> {
  const config = checkedFinalizerConfig(service.config);
  const held: readonly HeldPermit[] = await service.store.heldPermits(
    epoch,
    config.heldPermitsPerPassMax,
  );
  for (const permit of held) {
    tally.rereadings += 1;
    const proved = await service.git.proveCandidateAncestry({
      repository: permit.repository,
      ref: permit.target,
      candidate: permit.candidate,
    });
    await finalizerRecordReading(
      service,
      {
        partition: permit.partition,
        recoveryEpoch: epoch,
        permit: permit.permit,
        candidate: permit.candidate,
        target: permit.target,
      },
      finalizerReadingOf(proved),
      tally,
    );
  }
}

/**
 * The branches one brief names: where the work happened, and where the
 * promotion lands it. The brief itself is kept, because the mode it names is
 * what the pure pass reads of it.
 */
interface FinalizerBranches {
  readonly work?: GitRefName;
  readonly target?: GitRefName;
  readonly brief?: DraftBrief;
}

/**
 * What the ticket's brief says about each: a push lands on the reference its
 * finalization names or on the work's own branch where it names none, a pull
 * request always lands on the work's branch — that branch being the head a
 * proposal is opened from and its finalization's reference the base — and a
 * publication names none, its destination being a repository the ticket never
 * worked in. A proposing brief naming no branch of its own is answered by none
 * of them, because such a brief is refused where briefs are written and the
 * binding's default is not a stand-in for the head a proposal opens from.
 */
async function finalizerGatherBranches(
  service: FinalizerService,
  view: FinalizationView,
): Promise<FinalizerBranches | undefined> {
  if (view.handoffRequest?.kind === "PublishHandoff") return {};
  const brief = await service.ticketBriefs.brief(
    view.claim.partition,
    view.claim.ticket,
  );
  if (brief === undefined) return {};
  const finalization = brief.finalization;
  const proposing =
    view.claim.kind === "RunFinalizer" && finalization?.mode === "PullRequest";
  if (proposing && brief.branch === undefined) return undefined;
  const target = proposing
    ? brief.branch
    : (finalization?.target ?? brief.branch);
  return {
    brief,
    ...(brief.branch === undefined ? {} : { work: brief.branch }),
    ...(target === undefined ? {} : { target }),
  };
}

/**
 * What the branch the work happened on holds, which is the tree a candidate is
 * built over — the binding's own default for a brief naming no branch of its
 * own, that being what such work was observed against. The target's observation
 * stands in only where the two are one ref, a brief naming neither among them,
 * so nothing is asked of the remote twice and nothing is built over a ref the
 * work never saw.
 */
async function finalizerGatherWorkBranch(
  service: FinalizerService,
  binding: RepositoryBinding,
  branches: FinalizerBranches,
  target: ObservedTarget,
): Promise<ObservedTarget | undefined> {
  if (branches.work === branches.target) return target;
  const observed = await repositoryTargetObserved(
    service.git,
    binding,
    branches.work,
  );
  return observed.observed === "Target" ? observed.target : undefined;
}

/**
 * What one gathering came to: the view a decision is made from, or the reason
 * one could not be made from what was read. A request nothing durable answers
 * for at all is neither, and is left to the sweep that reopens it.
 */
type FinalizerGathered =
  | { readonly gathered: "View"; readonly view: FinalizationView }
  | { readonly gathered: "Held"; readonly hold: FinalizerHoldReason };

/**
 * Everything the pure pass reads, the remote's current target among it. The read
 * happens here so the decision that follows awaits nothing.
 */
async function finalizerGather(
  service: FinalizerService,
  claim: FinalizationClaim,
): Promise<FinalizerGathered | undefined> {
  const durable = await service.store.durableView(claim);
  if (durable === undefined) return undefined;
  if (durable.repository === undefined)
    return { gathered: "View", view: durable };
  const branches = await finalizerGatherBranches(service, durable);
  if (branches === undefined)
    return { gathered: "Held", hold: "ProposalUnbranched" };
  const observed = await repositoryTargetObserved(
    service.git,
    durable.repository,
    branches.target,
  );
  const view: FinalizationView = {
    ...durable,
    repository: repositoryBindingNarrowed(durable.repository, branches.target),
    ...(branches.target === undefined ? {} : { targetBranch: branches.target }),
    ...(branches.brief?.finalization === undefined
      ? {}
      : { finalizationMode: branches.brief.finalization.mode }),
  };
  if (observed.observed !== "Target") return { gathered: "View", view };
  const work = await finalizerGatherWorkBranch(
    service,
    durable.repository,
    branches,
    observed.target,
  );
  return {
    gathered: "View",
    view: {
      ...view,
      observedTarget: observed.target,
      ...(work === undefined ? {} : { observedWorkBranch: work }),
    },
  };
}

/** What the view's prepared attempt pinned, refusing a view no promotion could act on. */
function finalizerCandidateOf(view: FinalizationView): FinalizerCandidate {
  const { attempt, repository } = view;
  if (
    attempt === undefined ||
    attempt.candidate === undefined ||
    repository === undefined
  ) {
    throw new Error(
      "finalizer pass: an act was authorized against no prepared candidate",
    );
  }
  return {
    repository,
    target: attempt.target,
    candidate: attempt.candidate,
    attempt,
  };
}

/** The permit and candidate a reading of this view settles. */
function finalizerSubjectOf(
  view: FinalizationView,
  permit: CommitPermitId,
): FinalizerReadingSubject {
  const pinned = finalizerCandidateOf(view);
  return {
    partition: view.claim.partition,
    recoveryEpoch: view.claim.recoveryEpoch,
    permit,
    candidate: pinned.candidate,
    target: pinned.target.ref,
  };
}

/** Proves what the target ref holds about the candidate, and records what it proved. */
async function finalizerProve(
  service: FinalizerService,
  view: FinalizationView,
  permit: CommitPermitId,
  tally: FinalizerTally,
): Promise<void> {
  const pinned = finalizerCandidateOf(view);
  const proved = await service.git.proveCandidateAncestry({
    repository: pinned.repository,
    ref: pinned.target.ref,
    candidate: pinned.candidate,
  });
  await finalizerRecordReading(
    service,
    finalizerSubjectOf(view, permit),
    finalizerReadingOf(proved),
    tally,
  );
}

/**
 * Takes the permit, attempts the one conditional ref update it authorizes, and
 * records what came back. The grant commits before the update is attempted and
 * an ambiguous answer reconciles rather than concluding.
 */
async function finalizerPromote(
  service: FinalizerService,
  view: FinalizationView,
  tally: FinalizerTally,
): Promise<void> {
  const pinned = finalizerCandidateOf(view);
  const granted = await service.store.grantPermit({
    claim: view.claim,
    attempt: pinned.attempt.attempt,
  });
  if (granted.granted === "Refused") {
    finalizerHold(service, tally, "PermitRefused");
    return;
  }
  const permit = granted.permit.permit;
  recordFinalizer(service.metrics, (metrics) => {
    metrics.permit("Granted");
  });
  const promoted = await service.git.promoteCandidate({
    repository: pinned.repository,
    permit,
    target: pinned.target,
    candidate: pinned.candidate,
  });
  const subject = finalizerSubjectOf(view, permit);
  recordFinalizer(service.metrics, (metrics) => {
    metrics.promotion(promoted.promoted);
  });
  switch (promoted.promoted) {
    case "Advanced":
      await finalizerRecordReading(
        service,
        subject,
        { verdict: "Promoted", observed: pinned.candidate },
        tally,
      );
      return;
    case "Rejected":
      await finalizerRecordReading(
        service,
        subject,
        { verdict: "NotPromoted", observed: promoted.observed },
        tally,
      );
      return;
    case "Ambiguous":
      await finalizerProve(service, view, permit, tally);
      return;
    default:
      return assertNever(promoted);
  }
}

/** What one preparation is working from, gathered before any of it is written down. */
interface FinalizerPreparation {
  readonly view: FinalizationView;
  readonly repository: RepositoryBinding;
  readonly identity: PreparationIdentity;
  readonly bundle: InputBundle;
  readonly target: ObservedTarget;
  readonly configuration: PinnedConfiguration;
  readonly approvalRequired: boolean;
}

/**
 * The immutable inputs one preparation pinned. The manifests are pinned rather
 * than the artifacts they declare, because a result manifest is itself
 * immutable and already names its own artifact set.
 */
function finalizerBundleOf(
  service: FinalizerService,
  claim: FinalizationClaim,
  bundle: InputBundleId,
  repository: RepositoryBinding,
  pinned: {
    readonly configuration: PinnedConfiguration;
    readonly manifests: readonly ResultManifestId[];
    readonly acceptedWorkCommit?: GitObjectId;
  },
): InputBundle {
  const references: readonly InputBundleReference[] = [
    { kind: "Repository", reference: repository.repository },
    {
      kind: "ConfigurationRevision",
      reference: pinned.configuration.revision,
      digest: pinned.configuration.digest,
    },
    ...pinned.manifests.map((manifest) => ({
      kind: "ResultManifest" as const,
      reference: manifest,
    })),
    ...(pinned.acceptedWorkCommit === undefined
      ? []
      : [
          {
            kind: "TargetCommit" as const,
            reference: pinned.acceptedWorkCommit,
          },
        ]),
  ];
  if (references.length > inputBundleReferencesMax) {
    throw new RangeError(
      `finalizer pass: ${String(references.length)} references is past the most one bundle pins`,
    );
  }
  return {
    bundle,
    digest: service.digestOf(
      canonicalInputBundle(claim.partition, bundle, references),
    ),
    references,
  };
}

/** The fields every attempt of one preparation carries, whatever the preparation came to. */
function finalizerAttemptBase(
  subject: FinalizerPreparation,
  target: ObservedTarget,
): Omit<AttemptRecord, "attemptDigest" | "outcome"> {
  return {
    claim: subject.view.claim,
    repository: subject.repository.repository,
    attempt: subject.identity.attempt,
    bundle: subject.bundle,
    target,
    strategy: finalizerStrategy,
    configuration: subject.configuration,
    approvalRequired: subject.approvalRequired,
  };
}

/** One attempt under its own digest, which is the last value computed before the row is written. */
function finalizerAttemptOf(
  service: FinalizerService,
  record: Omit<AttemptRecord, "attemptDigest">,
): AttemptRecord {
  return {
    ...record,
    attemptDigest: service.digestOf(canonicalFinalizationAttempt(record)),
  };
}

/** Writes one immutable attempt, a refusal leaving the finalization exactly where it stood. */
async function finalizerRecordAttempt(
  service: FinalizerService,
  record: AttemptRecord,
  tally: FinalizerTally,
): Promise<void> {
  const recorded = await service.store.recordAttempt(record);
  if (recorded.recorded !== "Attempt") {
    finalizerHold(service, tally, "AttemptFenced");
    return;
  }
  recordFinalizer(service.metrics, (metrics) => {
    metrics.attempt(record.outcome, record.failureKind);
  });
}

/** Records the deterministic failure a preparation reached before any candidate existed. */
async function finalizerPreparationFailed(
  service: FinalizerService,
  subject: FinalizerPreparation,
  target: ObservedTarget,
  tally: FinalizerTally,
): Promise<void> {
  await finalizerRecordAttempt(
    service,
    finalizerAttemptOf(service, {
      ...finalizerAttemptBase(subject, target),
      outcome: "Failed",
      failureKind: "PreparationFailed",
    }),
    tally,
  );
}

/** Writes the conflict manifest one failed integration leaves, and records the attempt naming it. */
async function finalizerConflicted(
  service: FinalizerService,
  subject: FinalizerPreparation,
  target: ObservedTarget,
  candidate: GitObjectId,
  integrated: Extract<CandidateIntegrated, { integrated: "Conflicted" }>,
  tally: FinalizerTally,
): Promise<void> {
  const written = await service.artifacts.writeArtifact({
    partition: subject.view.claim.partition,
    artifact: subject.identity.conflict,
    content: new TextEncoder().encode(
      conflictManifestText({
        request: subject.view.claim.request,
        attempt: subject.identity.attempt,
        strategy: finalizerStrategy,
        candidate,
        target,
        ...(integrated.base === undefined ? {} : { base: integrated.base }),
        conflict: integrated.conflict,
      }),
    ),
  });
  if (written.written !== "Artifact") {
    finalizerHold(service, tally, "ManifestUnavailable");
    return;
  }
  await finalizerRecordAttempt(
    service,
    finalizerAttemptOf(service, {
      ...finalizerAttemptBase(subject, target),
      outcome: "Failed",
      failureKind: "MergeConflict",
      conflictManifest: subject.identity.conflict,
      conflictDigest: written.digest,
    }),
    tally,
  );
}

/** Records what integrating one candidate came to, a genuine conflict among the answers. */
async function finalizerIntegrated(
  service: FinalizerService,
  subject: FinalizerPreparation,
  target: ObservedTarget,
  candidate: GitObjectId,
  integrated: CandidateIntegrated,
  tally: FinalizerTally,
): Promise<void> {
  recordFinalizer(service.metrics, (metrics) => {
    metrics.integration(integrated.integrated);
  });
  switch (integrated.integrated) {
    case "Failed":
      finalizerHold(service, tally, "IntegrationUnanswered");
      return;
    case "Candidate":
      await finalizerRecordAttempt(
        service,
        finalizerAttemptOf(service, {
          ...finalizerAttemptBase(subject, target),
          outcome: "Prepared",
          candidate: integrated.candidate,
        }),
        tally,
      );
      return;
    case "Conflicted":
      await finalizerConflicted(
        service,
        subject,
        target,
        candidate,
        integrated,
        tally,
      );
      return;
    default:
      return assertNever(integrated);
  }
}

/**
 * Builds the candidate over the branch the work happened on, re-reads the
 * remote, and integrates against what the target holds now. No working tree is
 * asked for at any point, and nothing is written down until the integration has
 * answered.
 */
async function finalizerBuild(
  service: FinalizerService,
  subject: FinalizerPreparation,
  files: readonly CandidateFile[],
  tally: FinalizerTally,
): Promise<void> {
  const base = subject.view.observedWorkBranch;
  if (base === undefined) {
    finalizerHold(service, tally, "TargetUnobserved");
    return;
  }
  const prepared = await service.git.prepareCandidate({
    repository: subject.repository,
    ticket: subject.view.claim.ticket,
    bundle: subject.bundle.bundle,
    base,
    files,
  });
  if (prepared.prepared !== "Candidate") {
    finalizerHold(service, tally, "CandidateUnbuilt");
    return;
  }
  await finalizerIntegratePrepared(service, subject, prepared.candidate, tally);
}

/**
 * What one candidate is integrated against: what the remote holds now, or the
 * target the candidate was built over where the branch the work lands on is
 * still one the remote does not hold. A branch nothing holds has nothing to
 * integrate with, and the promotion creates it at the candidate.
 */
function finalizerIntegrationTarget(
  subject: FinalizerPreparation,
  observed: TargetObserved,
): ObservedTarget | undefined {
  if (observed.observed === "Target") return observed.target;
  return subject.view.targetBranch !== undefined &&
    observed.evidence === "RefUnreadable"
    ? subject.target
    : undefined;
}

/** Re-observes and integrates one candidate, however that candidate was prepared. */
async function finalizerIntegratePrepared(
  service: FinalizerService,
  subject: FinalizerPreparation,
  candidate: GitObjectId,
  tally: FinalizerTally,
): Promise<void> {
  const target = finalizerIntegrationTarget(
    subject,
    await service.git.observeTarget(subject.repository),
  );
  if (target === undefined) {
    finalizerHold(service, tally, "TargetUnobserved");
    return;
  }
  const integrated = await service.git.integrateCandidate({
    repository: subject.repository,
    target,
    candidate,
    strategy: finalizerStrategy,
  });
  await finalizerIntegrated(
    service,
    subject,
    target,
    candidate,
    integrated,
    tally,
  );
}

/** Verifies and integrates the immutable source commit a worker published. */
async function finalizerBuildSource(
  service: FinalizerService,
  subject: FinalizerPreparation,
  source: TicketHandoff & { readonly kind: "Source" },
  tally: FinalizerTally,
): Promise<void> {
  if (source.source.repository !== subject.repository.repository) {
    await finalizerPreparationFailed(service, subject, subject.target, tally);
    return;
  }
  const prepared = await service.git.prepareSource({
    repository: subject.repository,
    ref: source.source.ref,
    commit: source.source.commit,
    base: source.source.base,
  });
  if (prepared.prepared !== "Candidate") {
    finalizerHold(service, tally, "CandidateUnbuilt");
    return;
  }
  await finalizerIntegratePrepared(service, subject, prepared.candidate, tally);
}

/**
 * Everything one preparation or one abort pins, gathered before any of it is
 * written down, and the handoff where the ticket's work declared one. The
 * gathering is superseded here rather than at either reader below, so the
 * bundle's manifests and the accepted handoff name the same spawn's work.
 */
async function finalizerGathered(
  service: FinalizerService,
  view: FinalizationView,
  target: ObservedTarget,
  tally: FinalizerTally,
): Promise<
  { subject: FinalizerPreparation; handoff?: TicketHandoff } | undefined
> {
  const repository = view.repository;
  if (repository === undefined) {
    throw new Error(
      "finalizer pass: an attempt was authorized against no bound repository",
    );
  }
  const gathering = handoffSuperseded(
    await service.store.handoffGathering(view.claim),
  );
  const accepted = handoffAccepted(gathering);
  if (accepted.accepted === "NoPassedWork") {
    finalizerHold(service, tally, "NoPassedWork");
    return undefined;
  }
  const handoff: TicketHandoff | undefined =
    accepted.accepted === "Handoff" ? accepted.handoff : undefined;
  const configuration =
    accepted.accepted === "Handoff"
      ? accepted.handoff.configuration
      : accepted.configuration;
  const identity = service.identities.next(view.claim.partition);
  return {
    subject: {
      view,
      repository,
      identity,
      bundle: finalizerBundleOf(
        service,
        view.claim,
        identity.bundle,
        repository,
        {
          configuration,
          manifests: [...new Set(gathering.work.map((each) => each.manifest))],
        },
      ),
      target,
      configuration,
      approvalRequired: handoff?.approvalRequired ?? false,
    },
    ...(handoff === undefined ? {} : { handoff }),
  };
}

/**
 * Records the failure a finalization aborts to when its project will never
 * authorize the act again. No permit is asked for and no remote is written to,
 * which is what makes the abort reversible.
 */
async function finalizerAbort(
  service: FinalizerService,
  view: FinalizationView,
  target: ObservedTarget,
  tally: FinalizerTally,
): Promise<void> {
  const gathered = await finalizerGathered(service, view, target, tally);
  if (gathered === undefined) return;
  await finalizerPreparationFailed(service, gathered.subject, target, tally);
}

/**
 * Turns one ticket's verified handoff artifacts into a candidate, or records the
 * deterministic reason they could not become one.
 */
async function finalizerPrepare(
  service: FinalizerService,
  view: FinalizationView,
  target: ObservedTarget,
  tally: FinalizerTally,
): Promise<void> {
  if (view.handoffRequest?.kind === "PublishHandoff") {
    await finalizerPreparePublication(service, view, target, tally);
    return;
  }
  const gathered = await finalizerGathered(service, view, target, tally);
  if (gathered === undefined) return;
  const { subject, handoff } = gathered;
  if (handoff === undefined) {
    await finalizerPreparationFailed(service, subject, target, tally);
    return;
  }
  if (handoff.kind === "Source") {
    await finalizerBuildSource(service, subject, handoff, tally);
    return;
  }
  const read = await service.handoffs.readHandoff({
    partition: view.claim.partition,
    artifacts: handoff.artifacts,
  });
  if (read.read === "Unavailable") {
    finalizerHold(service, tally, "HandoffUnavailable");
    return;
  }
  if (read.read === "Rejected") {
    await finalizerPreparationFailed(service, subject, target, tally);
    return;
  }
  await finalizerBuild(service, subject, read.files, tally);
}

async function finalizerPreparePublication(
  service: FinalizerService,
  view: FinalizationView,
  target: ObservedTarget,
  tally: FinalizerTally,
): Promise<void> {
  const request = view.handoffRequest;
  const repository = view.repository;
  if (request?.kind !== "PublishHandoff" || repository === undefined)
    throw new Error("finalizer publication: no pinned publication request");
  const identity = service.identities.next(view.claim.partition);
  const configuration: PinnedConfiguration = {
    revision: request.configurationRevision,
    digest: request.configurationDigest,
  };
  const subject: FinalizerPreparation = {
    view,
    repository,
    identity,
    bundle: finalizerBundleOf(
      service,
      view.claim,
      identity.bundle,
      repository,
      {
        configuration,
        manifests: [],
        acceptedWorkCommit: request.acceptedWorkCommit,
      },
    ),
    target,
    configuration,
    approvalRequired: false,
  };
  await finalizerBuild(
    service,
    subject,
    [
      {
        path: request.destinationPath,
        content: new TextEncoder().encode(request.output),
      },
    ],
    tally,
  );
}

/** Opens the approval one prepared attempt needs, leaving the finalization where it stood. */
async function finalizerAwaitApproval(
  service: FinalizerService,
  view: FinalizationView,
  attempt: FinalizationAttemptId,
  tally: FinalizerTally,
): Promise<void> {
  const asked = await service.store.requestApproval({
    claim: view.claim,
    attempt,
  });
  recordFinalizer(service.metrics, (metrics) => {
    metrics.approval(asked.asked);
  });
  if (asked.asked === "Requested") tally.approvals += 1;
  else finalizerHold(service, tally, "ApprovalUnopened");
}

/**
 * The request one stored row asked the forge for, rebuilt so that every later
 * pass reconciles and concludes against what was actually sent. Nothing is
 * observed for it: a proposal already opened is not re-derived from a remote
 * that has moved on since.
 */
function finalizerStoredProposal(
  binding: ForgeBinding,
  repository: RepositoryId,
  stored: StoredChangeProposal,
): FinalizationProposalGathered {
  const { asked } = stored;
  return {
    gathered: "Request",
    request: changeProposalRequestFromBranch({
      binding,
      repository,
      request: asked.request,
      headRef: asked.head.ref,
      headCommit: asked.head.commit,
      baseRef: asked.base.ref,
      baseCommit: asked.base.commit,
      title: asked.title,
      body: asked.body,
    }),
    publication: stored.publication,
  };
}

/**
 * The request a proposal nobody has opened yet would ask for. This is the one
 * place the base is observed, and it is read as itself rather than through the
 * binding's fallback, so a base the remote does not hold is unreadable instead
 * of silently becoming the default branch.
 */
async function finalizerOpeningProposal(
  service: FinalizerService,
  view: FinalizationView,
  pinned: FinalizerCandidate,
  binding: ForgeBinding,
): Promise<FinalizationProposalGathered> {
  const brief = await service.ticketBriefs.brief(
    view.claim.partition,
    view.claim.ticket,
  );
  const finalization = brief?.finalization;
  if (brief === undefined || finalization?.mode !== "PullRequest") {
    throw new Error(
      "finalizer proposal: a proposal was authorized by no brief that opens one",
    );
  }
  const observed = await service.git.observeTarget(
    repositoryBindingNarrowed(pinned.repository, finalization.target),
  );
  if (observed.observed !== "Target") return { gathered: "BaseUnreadable" };
  const identity = asChangeProposalRequestIdentity(
    service.digestOf(canonicalChangeProposalRequest(view.claim)),
  );
  return {
    gathered: "Request",
    request: changeProposalRequestFromBranch({
      binding,
      repository: pinned.repository.repository,
      request: identity,
      headRef: pinned.target.ref,
      headCommit: pinned.candidate,
      baseRef: observed.target.ref,
      baseCommit: observed.target.commit,
      title: finalizationProposalTitle(view.claim.ticket, brief.intent),
      body: finalizationProposalBody(brief.intent, proposalMarkerOf(identity)),
    }),
    publication: { publication: "Unopened" },
  };
}

/**
 * Everything the proposal step reads, gathered before it runs. A row already
 * there answers the whole of it, so a proposal that has been proved concludes
 * without asking the remote anything — and a base branch somebody deleted after
 * the proposal was opened holds nothing that was already settled.
 */
async function finalizerGatherProposal(
  service: FinalizerService,
  view: FinalizationView,
): Promise<FinalizationProposalGathered> {
  const pinned = finalizerCandidateOf(view);
  const repository = pinned.repository.repository;
  const binding = service.forges.bindingOf(repository);
  if (binding === undefined) return { gathered: "Unbound" };
  const stored = await service.store.changeProposal(view.claim);
  return stored === undefined
    ? finalizerOpeningProposal(service, view, pinned, binding)
    : finalizerStoredProposal(binding, repository, stored);
}

/**
 * Releases the attempt in flight so that a later pass may make another create,
 * spending the create it stood for where the forge may have taken it and
 * nothing where the forge would not.
 */
async function finalizerReleaseProposalAttempt(
  service: FinalizerService,
  view: FinalizationView,
  released: "Refused" | "Declined",
  tally: FinalizerTally,
  hold: FinalizerHoldReason | undefined,
): Promise<void> {
  const wrote =
    released === "Refused"
      ? await service.store.refuseChangeProposalAttempt(view.claim)
      : await service.store.declineChangeProposalAttempt(view.claim);
  if (wrote.wrote !== "Row")
    finalizerHold(service, tally, "ProposalUnrecorded");
  else if (hold !== undefined) finalizerHold(service, tally, hold);
}

/** Performs the one recording a forge answer authorizes, which the pure step named. */
async function finalizerRecordProposal(
  service: FinalizerService,
  view: FinalizationView,
  recording: FinalizationProposalRecording,
  tally: FinalizerTally,
): Promise<void> {
  if (recording.record === "Unanswered") return;
  if (recording.record === "Nothing") {
    finalizerHold(service, tally, recording.hold);
    return;
  }
  if (recording.record === "Decline") {
    await finalizerReleaseProposalAttempt(
      service,
      view,
      "Declined",
      tally,
      recording.hold,
    );
    return;
  }
  const wrote = await service.store.recordChangeProposal({
    claim: view.claim,
    result:
      recording.record === "Creation"
        ? { records: "Creation", created: recording.created }
        : { records: "Reconciliation", reconciled: recording.reconciled },
  });
  if (wrote.wrote !== "Row")
    finalizerHold(service, tally, "ProposalUnrecorded");
}

/**
 * Asks the forge for the one proposal this request names, over an attempt
 * counted and committed before the create is called — so a crash between the
 * two leaves a create in flight that nobody heard back from, which reads back
 * as one to be read rather than as authority for a second create.
 */
async function finalizerProposeChange(
  service: FinalizerService,
  view: FinalizationView,
  request: ChangeProposalRequest,
  tally: FinalizerTally,
): Promise<void> {
  const permit = view.permit;
  if (permit === undefined) {
    throw new Error(
      "finalizer proposal: a proposal named no permit that landed its head",
    );
  }
  const port = service.forges.selector.select(request.binding.forge);
  if (port === undefined) {
    finalizerHold(service, tally, "ProposalDenied");
    return;
  }
  const marked = await service.store.markChangeProposalAttempt({
    claim: view.claim,
    permit: permit.permit,
    request,
  });
  if (marked.wrote !== "Row") {
    finalizerHold(service, tally, "ProposalUnattempted");
    return;
  }
  tally.proposals += 1;
  const created = await port.create(request);
  await finalizerRecordProposal(
    service,
    view,
    finalizationProposalCreationRecording(created),
    tally,
  );
}

/** Reads back whether the forge holds the proposal this request's marker names. */
async function finalizerReconcileProposal(
  service: FinalizerService,
  view: FinalizationView,
  request: ChangeProposalRequest,
  tally: FinalizerTally,
): Promise<void> {
  const port = service.forges.selector.select(request.binding.forge);
  if (port === undefined) {
    finalizerHold(service, tally, "ProposalDenied");
    return;
  }
  tally.proposals += 1;
  const read = await port.readByMarker(request);
  await finalizerRecordProposal(
    service,
    view,
    finalizationProposalReadingRecording(
      reconcileChangeProposal(request, read),
    ),
    tally,
  );
}

/** Advances one promoted candidate's own change proposal by at most one act. */
async function finalizerProposal(
  service: FinalizerService,
  view: FinalizationView,
  tally: FinalizerTally,
): Promise<void> {
  const config = checkedFinalizerConfig(service.config);
  const decision = finalizationProposalNext(
    await finalizerGatherProposal(service, view),
    {
      creationsMax: config.proposalCreationsMax,
      reconciliationsMax: config.proposalReconciliationsMax,
    },
  );
  switch (decision.decide) {
    case "Hold":
      finalizerHold(service, tally, decision.hold);
      return;
    case "Conclude":
      await finalizerConclude(
        service,
        view,
        { outcome: "FinalizationSucceeded" },
        tally,
      );
      return;
    case "RefuseProposalAttempt":
      await finalizerReleaseProposalAttempt(
        service,
        view,
        "Refused",
        tally,
        undefined,
      );
      return;
    case "ProposeChange":
      await finalizerProposeChange(service, view, decision.request, tally);
      return;
    case "ReconcileProposal":
      await finalizerReconcileProposal(service, view, decision.request, tally);
      return;
    default:
      return assertNever(decision);
  }
}

/** Offers the one conclusion to the one authenticated door. */
async function finalizerConclude(
  service: FinalizerService,
  view: FinalizationView,
  conclusion: FinalizationConclusion,
  tally: FinalizerTally,
): Promise<void> {
  const attempt = view.attempt;
  if (attempt === undefined) {
    throw new Error(
      "finalizer pass: a conclusion named no attempt to carry it",
    );
  }
  const submitted = await service.store.submitResult({
    claim: view.claim,
    attempt: attempt.attempt,
    conclusion,
  });
  recordFinalizer(service.metrics, (metrics) => {
    metrics.conclusion(conclusion.outcome, submitted.submitted);
  });
  if (
    submitted.submitted === "Submitted" ||
    submitted.submitted === "AlreadySubmitted"
  ) {
    tally.conclusions += 1;
  }
}

/** Advances one claimed request by at most one decision, or by none at all. */
async function finalizerAdvance(
  service: FinalizerService,
  claim: FinalizationClaim,
  tally: FinalizerTally,
): Promise<void> {
  const config = checkedFinalizerConfig(service.config);
  const gathered = await finalizerGather(service, claim);
  if (gathered === undefined) return;
  if (gathered.gathered === "Held") {
    finalizerHold(service, tally, gathered.hold);
    return;
  }
  const { view } = gathered;
  const decision = finalizationNext(config, view);
  const ceilingReached = (
    spent: keyof FinalizerTally,
    ceiling: number,
  ): boolean => finalizerCeilingReached(service, tally, spent, ceiling);
  switch (decision.decide) {
    case "Settled":
      await service.store.settleClaim(claim);
      return;
    case "Hold":
      finalizerHold(service, tally, decision.hold);
      return;
    case "Prepare":
      if (ceilingReached("preparations", config.preparationsPerPassMax)) return;
      tally.preparations += 1;
      recordFinalizer(service.metrics, (metrics) => {
        metrics.preparation(decision.restartsSpent);
      });
      await finalizerPrepare(service, view, decision.target, tally);
      return;
    case "Abort":
      if (ceilingReached("preparations", config.preparationsPerPassMax)) return;
      tally.preparations += 1;
      recordFinalizer(service.metrics, (metrics) => {
        metrics.preparation(0);
      });
      await finalizerAbort(service, view, decision.target, tally);
      return;
    case "AwaitApproval":
      await finalizerAwaitApproval(service, view, decision.attempt, tally);
      return;
    case "Promote":
      if (ceilingReached("promotions", config.promotionsPerPassMax)) return;
      tally.promotions += 1;
      await finalizerPromote(service, view, tally);
      return;
    case "Reconcile":
      if (ceilingReached("reconciliations", config.reconciliationsPerPassMax))
        return;
      tally.reconciliations += 1;
      await finalizerProve(service, view, decision.permit, tally);
      return;
    case "Propose":
      if (ceilingReached("proposals", config.proposalsPerPassMax)) return;
      await finalizerProposal(service, view, tally);
      return;
    case "Conclude":
      await finalizerConclude(service, view, decision.conclusion, tally);
      return;
    default:
      return assertNever(decision);
  }
}

/** One bounded pass over every durable move the finalizer owns, in dependency order. */
export async function finalizerPass(
  service: FinalizerService,
  owner: FinalizerOwnerId,
  epoch: RecoveryEpoch,
): Promise<FinalizerPassReport> {
  const config = checkedFinalizerConfig(service.config);
  const reopened = await finalizerFence(service, epoch);
  const tally: FinalizerTally = {
    rereadings: 0,
    preparations: 0,
    approvals: 0,
    promotions: 0,
    reconciliations: 0,
    proposals: 0,
    conclusions: 0,
    holds: 0,
  };
  await finalizerReadHolds(service, epoch, tally);
  const claims = await service.store.claimRequests(
    owner,
    epoch,
    config.requestsPerPassMax,
    config.requestClaimLeaseSecs,
  );
  recordFinalizer(service.metrics, (metrics) => {
    metrics.claiming(claims.length, config.requestsPerPassMax);
  });
  for (const claim of claims) await finalizerAdvance(service, claim, tally);
  return { reopened, ...tally };
}
