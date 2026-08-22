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
 * PREPARATION OBSERVES THE TARGET TWICE AND INTEGRATES AGAINST THE SECOND. The
 * candidate is the tree of the target the view observed with the verified
 * handoff artifacts standing in it, so integrating it against that same commit
 * could only ever be the candidate itself and no automatic integration would
 * ever be attempted at all. The remote is therefore re-read once the candidate
 * exists, and the one integration this preparation is allowed is against what
 * the remote holds then — which is where a merge base, a clean automatic merge
 * and a genuine conflict all come from. The attempt pins that second
 * observation, because it is the commit the promotion will be conditional on.
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
  inputBundleReferencesMax,
} from "./finalizer.ts";
import {
  canonicalFinalizationAttempt,
  canonicalInputBundle,
  conflictManifestText,
  handoffAccepted,
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

/** Everything a finalizer pass calls out through, and the bounds it works within. */
export interface FinalizerService {
  readonly store: FinalizerStore & FinalizerPreparationStore;
  readonly git: GitPromotionPort;
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
 * Everything the pure pass reads, the remote's current target among it. The read
 * happens here so the decision that follows awaits nothing.
 */
async function finalizerGather(
  service: FinalizerService,
  claim: FinalizationClaim,
): Promise<FinalizationView | undefined> {
  const durable = await service.store.durableView(claim);
  if (durable === undefined || durable.repository === undefined) return durable;
  const observed = await service.git.observeTarget(durable.repository);
  if (observed.observed !== "Target") return durable;
  return { ...durable, observedTarget: observed.target };
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
 * Builds the candidate over the target the view observed, re-reads the remote,
 * and integrates against what it holds now. No working tree is asked for at any
 * point, and nothing is written down until the integration has answered.
 */
async function finalizerBuild(
  service: FinalizerService,
  subject: FinalizerPreparation,
  files: readonly CandidateFile[],
  tally: FinalizerTally,
): Promise<void> {
  const prepared = await service.git.prepareCandidate({
    repository: subject.repository,
    ticket: subject.view.claim.ticket,
    bundle: subject.bundle.bundle,
    target: subject.target,
    files,
  });
  if (prepared.prepared !== "Candidate") {
    finalizerHold(service, tally, "CandidateUnbuilt");
    return;
  }
  const observed = await service.git.observeTarget(subject.repository);
  if (observed.observed !== "Target") {
    finalizerHold(service, tally, "TargetUnobserved");
    return;
  }
  const integrated = await service.git.integrateCandidate({
    repository: subject.repository,
    target: observed.target,
    candidate: prepared.candidate,
    strategy: finalizerStrategy,
  });
  await finalizerIntegrated(
    service,
    subject,
    observed.target,
    prepared.candidate,
    integrated,
    tally,
  );
}

/**
 * Everything one preparation or one abort pins, gathered before any of it is
 * written down, and the handoff where the ticket's work declared one.
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
  const gathering = await service.store.handoffGathering(view.claim);
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
  const gathered = await finalizerGathered(service, view, target, tally);
  if (gathered === undefined) return;
  const { subject, handoff } = gathered;
  if (handoff === undefined) {
    await finalizerPreparationFailed(service, subject, target, tally);
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
  const view = await finalizerGather(service, claim);
  if (view === undefined) return;
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
