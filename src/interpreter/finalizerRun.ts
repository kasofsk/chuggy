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
 * and a permit it was refused.
 *
 * A PASS FENCES BEFORE IT MOVES ANYTHING ELSE. Claims held under a superseded
 * epoch and claims past their expiry are reopened first, because a lease that
 * lapsed is not self-healing and nothing claimable can be drawn until those rows
 * say so again.
 *
 * PREPARING A CANDIDATE IS NOT YET THIS SERVICE'S TO DO, so the pass performs
 * neither the preparation the revision fence asks for nor the approval that
 * follows one: it counts the decision and leaves the finalization exactly where
 * it stood. Constructing a candidate needs the verified handoff artifacts'
 * content, which arrives with the adapter that reads them, and a simulated
 * preparation would forge an attempt nothing had produced.
 *
 * NOTHING HERE READS A CLOCK. Every lease and expiry is a duration handed to the
 * store, which asks the database what time it is.
 */

import { assertNever } from "../domain/assertNever.ts";
import {
  checkedFinalizerConfig,
  finalizationNext,
  type AncestryProved,
  type CommitPermitId,
  type FinalizationAttempt,
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
  type ObservedTarget,
  type RepositoryBinding,
} from "./finalizer.ts";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";

/** Everything a finalizer pass calls out through, and the bounds it works within. */
export interface FinalizerService {
  readonly store: FinalizerStore;
  readonly git: GitPromotionPort;
  readonly config: FinalizerConfig;
}

/** What one bounded pass moved, which is what a deployment's loop paces itself by. */
export interface FinalizerPassReport {
  readonly reopened: number;
  readonly rereadings: number;
  readonly promotions: number;
  readonly reconciliations: number;
  readonly conclusions: number;
  readonly deferrals: number;
  readonly holds: number;
}

/**
 * What one pass has spent so far, which is both its ceiling and its report.
 * Re-reading a hold and reconciling a permit nobody has read are counted apart,
 * because one ceiling over both would let a backlog of holds starve recovery.
 */
interface FinalizerTally {
  rereadings: number;
  promotions: number;
  reconciliations: number;
  conclusions: number;
  deferrals: number;
  holds: number;
}

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
  if (recorded.recorded !== "Concluded") tally.holds += 1;
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
    tally.holds += 1;
    return;
  }
  const permit = granted.permit.permit;
  const promoted = await service.git.promoteCandidate({
    repository: pinned.repository,
    permit,
    target: pinned.target,
    candidate: pinned.candidate,
  });
  const subject = finalizerSubjectOf(view, permit);
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
  switch (decision.decide) {
    case "Settled":
      await service.store.settleClaim(claim);
      return;
    case "Hold":
      tally.holds += 1;
      return;
    case "Prepare":
    case "AwaitApproval":
      tally.deferrals += 1;
      return;
    case "Promote":
      if (tally.promotions >= config.promotionsPerPassMax) return;
      tally.promotions += 1;
      await finalizerPromote(service, view, tally);
      return;
    case "Reconcile":
      if (tally.reconciliations >= config.reconciliationsPerPassMax) return;
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
    promotions: 0,
    reconciliations: 0,
    conclusions: 0,
    deferrals: 0,
    holds: 0,
  };
  await finalizerReadHolds(service, epoch, tally);
  const claims = await service.store.claimRequests(
    owner,
    epoch,
    config.requestsPerPassMax,
    config.requestClaimLeaseSecs,
  );
  for (const claim of claims) await finalizerAdvance(service, claim, tally);
  return { reopened, ...tally };
}
