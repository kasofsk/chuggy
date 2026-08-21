/**
 * The finalizer pass at the lowest tier that can express it: which durable move
 * each decision produces, and the ceilings that stop a pass reaching the remote
 * more times than its configuration allows.
 *
 * WHAT THIS TIER CAN DECIDE is the branch and the bound. Whether the permit is
 * exclusive, whether the grant commits before the update, and whether a reading
 * spends the permit atomically are all claims about PostgreSQL, and are proved
 * against a real server in `test/postgres/finalizerPermit.test.ts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import {
  asCommitPermitId,
  asFinalizationAttemptId,
  asFinalizerOwnerId,
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  finalizerDefaults,
  type AncestryProof,
  type AncestryProved,
  type CandidatePromoted,
  type CandidatePromotion,
  type CommitPermit,
  type FinalizationAttempt,
  type FinalizationClaim,
  type FinalizationView,
  type FinalizerStore,
  type GitPromotionPort,
  type HeldPermit,
  type PermitGranted,
  type PermitRequest,
  type Reconciled,
  type ReconciliationRecord,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import {
  finalizerPass,
  type FinalizerService,
} from "../../src/interpreter/finalizerRun.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";

/** The epoch every claim in this suite is fenced by. */
const epoch = asRecoveryEpoch("epoch-run");

/** The commit widths git addresses objects at, spelled once for the fixtures. */
const commitOf = (marker: string): string => marker.repeat(40).slice(0, 40);

/** One project every fixture claim belongs to. */
const partition: Partition = {
  tenant: asTenantId("tenant-run"),
  project: asProjectId("project-run"),
};

/** The remote every fixture attempt promotes into. */
const binding: RepositoryBinding = {
  partition,
  repository: asRepositoryId("repository-run"),
  recoveryEpoch: epoch,
};

/** One claimed request, distinct by the request identity it names. */
function claimOf(request: string): FinalizationClaim {
  return {
    partition,
    request,
    ticket: asTicketId(1),
    authorizingSeq: 1,
    requestGeneration: 1,
    claimGeneration: 1,
    state: "Registered",
    recoveryEpoch: epoch,
    owner: asFinalizerOwnerId("owner-run"),
  };
}

/** One prepared attempt over the target the fixture remote reports. */
function attemptOf(request: string): FinalizationAttempt {
  return {
    attempt: asFinalizationAttemptId(`attempt-${request}`),
    request,
    ticket: asTicketId(1),
    repository: binding.repository,
    target: {
      ref: asGitRefName("refs/heads/main"),
      commit: asGitObjectId(commitOf("a")),
    },
    strategy: "Merge",
    configurationRevision: "revision-run",
    configurationDigest: commitOf("b").repeat(2).slice(0, 64),
    approvalRequired: false,
    outcome: "Prepared",
    candidate: asGitObjectId(commitOf("c")),
    attemptDigest: commitOf("d").repeat(2).slice(0, 64),
  };
}

/** One granted permit for one attempt. */
function permitOf(request: string): CommitPermit {
  return {
    permit: asCommitPermitId(`permit-${request}`),
    attempt: asFinalizationAttemptId(`attempt-${request}`),
    recoveryEpoch: epoch,
    lifecycleGeneration: 1,
    state: "Granted",
  };
}

/** What one fixture store hands out and what it was asked to write. */
interface FinalizerRecorder extends FinalizerStore {
  readonly grants: PermitRequest[];
  readonly readings: ReconciliationRecord[];
  readonly settled: string[];
  readonly submitted: string[];
}

/** A store that answers from the views a case hands it and records every move. */
function recordingStore(
  views: readonly FinalizationView[],
  held: readonly HeldPermit[] = [],
): FinalizerRecorder {
  const own: FinalizerRecorder = {
    grants: [],
    readings: [],
    settled: [],
    submitted: [],
    claimRequests: () => Promise.resolve(views.map((view) => view.claim)),
    extendClaim: () => Promise.resolve(true),
    durableView: (claim) =>
      Promise.resolve(
        views.find((view) => view.claim.request === claim.request),
      ),
    grantPermit: (request): Promise<PermitGranted> => {
      own.grants.push(request);
      return Promise.resolve({
        granted: "Permit",
        permit: permitOf(request.claim.request),
      });
    },
    recordReconciliation: (record): Promise<Reconciled> => {
      own.readings.push(record);
      return Promise.resolve({
        recorded:
          record.reconciliation.verdict === "Unreadable" ? "Held" : "Concluded",
      });
    },
    heldPermits: (_epoch, permitsMax) =>
      Promise.resolve(held.slice(0, permitsMax)),
    submitResult: (offer) => {
      own.submitted.push(offer.claim.request);
      return Promise.resolve({
        submitted: "Submitted",
        operation: "operation",
      });
    },
    settleClaim: (claim) => {
      own.settled.push(claim.request);
      return Promise.resolve(true);
    },
    reclaimLapsed: () => Promise.resolve(0),
    reclaimStaleEpoch: () => Promise.resolve(0),
  };
  return own;
}

/** What one fixture remote was asked for, answering whatever the case chose. */
interface GitRecorder extends GitPromotionPort {
  readonly promotions: CandidatePromotion[];
  readonly proofs: AncestryProof[];
  promoted: CandidatePromoted;
  proved: AncestryProved;
}

/** A remote that records every act and refuses the two the pass may not ask for. */
function recordingGit(): GitRecorder {
  const own: GitRecorder = {
    promotions: [],
    proofs: [],
    promoted: { promoted: "Advanced" },
    proved: { proved: "Ancestor", observed: asGitObjectId(commitOf("c")) },
    observeTarget: () =>
      Promise.resolve({
        observed: "Target",
        target: attemptOf("any").target,
      }),
    prepareCandidate: () => {
      throw new Error("the pass asked for a preparation");
    },
    integrateCandidate: () => {
      throw new Error("the pass asked for an integration");
    },
    promoteCandidate: (promotion) => {
      own.promotions.push(promotion);
      return Promise.resolve(own.promoted);
    },
    proveCandidateAncestry: (proof) => {
      own.proofs.push(proof);
      return Promise.resolve(own.proved);
    },
  };
  return own;
}

/** One view of a claimed request that is ready to promote. */
function promotableView(request: string): FinalizationView {
  return {
    claim: claimOf(request),
    repository: binding,
    attempt: attemptOf(request),
    approval: "Pending",
    attemptsMade: 1,
  };
}

/** The service a case drives, over the ceilings it names. */
function serviceOf(
  store: FinalizerStore,
  git: GitPromotionPort,
  bounds: Partial<typeof finalizerDefaults> = {},
): FinalizerService {
  return { store, git, config: { ...finalizerDefaults, ...bounds } };
}

/** One pass over the fixtures a case installed. */
function passOver(service: FinalizerService): ReturnType<typeof finalizerPass> {
  return finalizerPass(service, asFinalizerOwnerId("owner-run"), epoch);
}

test("a pass promotes no more candidates than its ceiling admits", async () => {
  const store = recordingStore([
    promotableView("request-one"),
    promotableView("request-two"),
    promotableView("request-three"),
  ]);
  const git = recordingGit();
  const report = await passOver(
    serviceOf(store, git, { promotionsPerPassMax: 2 }),
  );
  assert.equal(report.promotions, 2);
  assert.equal(git.promotions.length, 2);
  assert.equal(store.grants.length, 2);
});

test("a pass proves no more held readings than its ceiling admits", async () => {
  const held: readonly HeldPermit[] = ["one", "two", "three"].map((each) => ({
    partition,
    permit: asCommitPermitId(`permit-${each}`),
    repository: binding,
    target: asGitRefName("refs/heads/main"),
    candidate: asGitObjectId(commitOf("c")),
  }));
  const store = recordingStore([], held);
  const git = recordingGit();
  const report = await passOver(
    serviceOf(store, git, { heldPermitsPerPassMax: 2 }),
  );
  assert.equal(git.proofs.length, 2);
  assert.equal(report.rereadings, 2);
  assert.deepEqual(
    store.readings.map((each) => each.reconciliation.verdict),
    ["Promoted", "Promoted"],
  );
});

test("a pass held by an unreadable ref spends the permit on neither answer", async () => {
  const store = recordingStore([promotableView("request-one")]);
  const git = recordingGit();
  git.promoted = { promoted: "Ambiguous", evidence: "PromotionTimedOut" };
  git.proved = { proved: "Unreadable", evidence: "RefUnreadable" };
  const report = await passOver(serviceOf(store, git));
  assert.equal(report.holds, 1);
  assert.equal(store.submitted.length, 0);
  assert.deepEqual(
    store.readings.map((each) => each.reconciliation.verdict),
    ["Unreadable"],
  );
  assert.equal(store.readings[0]?.reconciliation.observed, undefined);
});

test("a decision the pass cannot perform reaches neither the remote nor the store", async () => {
  const waiting = promotableView("request-one");
  const store = recordingStore([
    {
      ...waiting,
      attempt: { ...attemptOf("request-one"), approvalRequired: true },
    },
  ]);
  const git = recordingGit();
  const report = await passOver(serviceOf(store, git));
  assert.equal(report.deferrals, 1);
  assert.equal(report.promotions, 0);
  assert.deepEqual(git.promotions, []);
  assert.deepEqual(store.grants, []);
});

test("a settled request gives its claim back and moves nothing else", async () => {
  const settled: FinalizationView = {
    claim: { ...claimOf("request-one"), state: "Fulfilled" },
    repository: binding,
    approval: "Pending",
    attemptsMade: 0,
  };
  const store = recordingStore([settled]);
  const git = recordingGit();
  const report = await passOver(serviceOf(store, git));
  assert.deepEqual(store.settled, ["request-one"]);
  assert.equal(report.promotions, 0);
  assert.equal(report.holds, 0);
});
