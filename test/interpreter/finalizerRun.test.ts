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
import { createHash } from "node:crypto";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import { asCanonicalConfiguration } from "../../src/interpreter/authoring.ts";
import {
  allClosingLifecycles,
  asCommitPermitId,
  asFinalizationAttemptId,
  asFinalizerOwnerId,
  asGitObjectId,
  asGitRefName,
  asInputBundleId,
  asRepositoryId,
  finalizerDefaults,
  type AncestryProof,
  type AncestryProved,
  type CandidateIntegrated,
  type CandidateIntegration,
  type CandidatePrepared,
  type CandidatePreparation,
  type CandidateSourcePreparation,
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
  type TargetObserved,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectArtifactId,
  type ApprovalAsk,
  type ApprovalAsked,
  type AttemptRecord,
  type FinalizerIdentityFactory,
  type FinalizerPreparationStore,
  type HandoffArtifact,
  type HandoffContentPort,
  type HandoffGathering,
  type HandoffRead,
  type HandoffRequest,
  type HandoffSource,
  type HandoffWork,
  type ProjectArtifactPort,
  type ProjectArtifactWrite,
  type ProjectArtifactWritten,
} from "../../src/interpreter/finalizerPreparation.ts";
import {
  finalizerTelemetry,
  silentFinalizerMetrics,
  silentFinalizerTelemetry,
  type FinalizerHoldReason,
  type FinalizerMetrics,
  type FinalizerTelemetry,
} from "../../src/interpreter/finalizerTelemetry.ts";
import {
  telemetryObservations,
  telemetryRecording,
  telemetryThrowing,
} from "./telemetrySinks.ts";
import { populated } from "./roster.ts";
import {
  asArtifactDigest,
  asArtifactPath,
  asResultManifestId,
} from "../../src/interpreter/resultManifest.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";
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
import {
  asBriefBranch,
  asBriefIntent,
  type TicketBriefPort,
} from "../../src/interpreter/ticketBrief.ts";

/** Every observation the finalizer declares, read off the sink that ignores them all. */
const declared: readonly string[] = telemetryObservations(
  silentFinalizerMetrics,
);

/** The epoch every claim in this suite is fenced by. */
const epoch = asRecoveryEpoch("epoch-run");

/** The commit widths git addresses objects at, spelled once for the fixtures. */
const commitOf = (marker: string): string => marker.repeat(40).slice(0, 40);

/** The hash every digest in this suite is taken under, which is the root's own choice. */
const digestOf = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

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
    kind: "RunFinalizer",
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
interface FinalizerRecorder extends FinalizerStore, FinalizerPreparationStore {
  readonly grants: PermitRequest[];
  readonly readings: ReconciliationRecord[];
  readonly settled: string[];
  readonly submitted: string[];
  readonly attempts: AttemptRecord[];
  readonly asks: ApprovalAsk[];
  gathering: HandoffGathering;
  asked: ApprovalAsked;
  granted?: PermitGranted;
}

/** One passed work execution every preparation fixture reads its revision from. */
const passedWork: HandoffWork = {
  execution: asExecutionId("execution-run"),
  attempt: asAttemptId("attempt-run"),
  spawn: "spawn-run",
  task: 1,
  manifest: asResultManifestId("manifest-run"),
  configuration: { revision: "revision-run", digest: digestOf("revision-run") },
  canonical: asCanonicalConfiguration('{"image":"i","version":1}'),
};

/** One declared handoff artifact, whose digest is a real hash of the bytes named for it. */
function handoffOf(path: string, content: string): HandoffArtifact {
  return {
    execution: passedWork.execution,
    attempt: passedWork.attempt,
    path: asArtifactPath(path),
    digest: asArtifactDigest(digestOf(content)),
    bytes: content.length,
  };
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
    attempts: [],
    asks: [],
    gathering: {
      work: [passedWork],
      artifacts: [handoffOf("one.txt", "one")],
      sources: [],
    },
    asked: { asked: "Requested" },
    handoffGathering: () => Promise.resolve(own.gathering),
    recordAttempt: (record) => {
      own.attempts.push(record);
      return Promise.resolve({ recorded: "Attempt" });
    },
    requestApproval: (ask) => {
      own.asks.push(ask);
      return Promise.resolve(own.asked);
    },
    claimRequests: () => Promise.resolve(views.map((view) => view.claim)),
    extendClaim: () => Promise.resolve(true),
    durableView: (claim) =>
      Promise.resolve(
        views.find((view) => view.claim.request === claim.request),
      ),
    grantPermit: (request): Promise<PermitGranted> => {
      own.grants.push(request);
      return Promise.resolve(
        own.granted ?? {
          granted: "Permit",
          permit: permitOf(request.claim.request),
        },
      );
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
  readonly observations: RepositoryBinding[];
  readonly promotions: CandidatePromotion[];
  readonly proofs: AncestryProof[];
  readonly preparations: CandidatePreparation[];
  readonly sourcePreparations: CandidateSourcePreparation[];
  readonly integrations: CandidateIntegration[];
  promoted: CandidatePromoted;
  proved: AncestryProved;
  observed: TargetObserved;
  prepared: CandidatePrepared;
  integrated: CandidateIntegrated;
}

/**
 * A remote that records every act and answers each of them however the case
 * chose. A binding that names a reference is observed at that reference, as the
 * adapter behind this port does.
 */
function recordingGit(): GitRecorder {
  const own: GitRecorder = {
    observations: [],
    promotions: [],
    proofs: [],
    preparations: [],
    sourcePreparations: [],
    integrations: [],
    promoted: { promoted: "Advanced" },
    proved: { proved: "Ancestor", observed: asGitObjectId(commitOf("c")) },
    observed: { observed: "Target", target: attemptOf("any").target },
    prepared: {
      prepared: "Candidate",
      candidate: asGitObjectId(commitOf("c")),
    },
    integrated: {
      integrated: "Candidate",
      candidate: asGitObjectId(commitOf("c")),
    },
    observeTarget: (repository) => {
      own.observations.push(repository);
      return Promise.resolve(
        repository.targetRef === undefined
          ? own.observed
          : {
              observed: "Target",
              target: {
                ref: repository.targetRef,
                commit: asGitObjectId(commitOf("a")),
              },
            },
      );
    },
    prepareCandidate: (preparation) => {
      own.preparations.push(preparation);
      return Promise.resolve(own.prepared);
    },
    prepareSource: (preparation) => {
      own.sourcePreparations.push(preparation);
      return Promise.resolve(own.prepared);
    },
    integrateCandidate: (integration) => {
      own.integrations.push(integration);
      return Promise.resolve(own.integrated);
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

/** The two artifact ports one case drives, each answering whatever it chose. */
interface ArtifactRecorder extends HandoffContentPort, ProjectArtifactPort {
  readonly requests: HandoffRequest[];
  readonly writes: ProjectArtifactWrite[];
  read: HandoffRead;
  wrote: ProjectArtifactWritten;
}

/** A store that hands back the bytes a case named and records what it was asked to write. */
function recordingArtifacts(): ArtifactRecorder {
  const own: ArtifactRecorder = {
    requests: [],
    writes: [],
    read: {
      read: "Files",
      files: [{ path: "one.txt", content: new TextEncoder().encode("one") }],
    },
    wrote: {
      written: "Artifact",
      digest: asArtifactDigest(digestOf("evidence")),
    },
    readHandoff: (request) => {
      own.requests.push(request);
      return Promise.resolve(own.read);
    },
    writeArtifact: (write) => {
      own.writes.push(write);
      return Promise.resolve(own.wrote);
    },
  };
  return own;
}

/** Identities drawn in order, so a case can name the attempt a preparation will mint. */
function countingIdentities(): FinalizerIdentityFactory {
  let drawn = 0;
  return {
    next: () => {
      drawn += 1;
      return {
        attempt: asFinalizationAttemptId(`attempt-${String(drawn)}`),
        bundle: asInputBundleId(`bundle-${String(drawn)}`),
        conflict: asProjectArtifactId(`conflict-${String(drawn)}`),
      };
    },
  };
}

/** One view of a claimed request that is ready to promote. */
function promotableView(request: string): FinalizationView {
  return {
    lifecycle: "Active",
    claim: claimOf(request),
    repository: binding,
    attempt: attemptOf(request),
    approval: "Pending",
    attemptsMade: 1,
  };
}

/** A brief port answering the branch a case names, and no brief at all when it names none. */
function briefsOf(branch?: string): TicketBriefPort {
  return {
    brief: () =>
      Promise.resolve(
        branch === undefined
          ? undefined
          : {
              intent: asBriefIntent("carry the ticket's own branch"),
              links: [],
              branch: asBriefBranch(branch),
            },
      ),
  };
}

/** The service a case drives, over the ceilings it names. */
function serviceOf(
  store: FinalizerRecorder,
  git: GitPromotionPort,
  bounds: Partial<typeof finalizerDefaults> = {},
  artifacts: ArtifactRecorder = recordingArtifacts(),
  metrics: FinalizerTelemetry = silentFinalizerTelemetry,
): FinalizerService {
  return {
    store,
    git,
    ticketBriefs: briefsOf(),
    handoffs: artifacts,
    artifacts,
    identities: countingIdentities(),
    digestOf,
    config: { ...finalizerDefaults, ...bounds },
    metrics,
  };
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
  assert.equal(report.holds, 1, "the third was neither moved nor held");
});

test("a request the pass had no budget left for is held under its own reason", async () => {
  const emitted: FinalizerHoldReason[] = [];
  const metrics = finalizerTelemetry({
    ...silentFinalizerMetrics,
    holding: (reason) => emitted.push(reason),
  });
  const store = recordingStore([
    promotableView("request-one"),
    promotableView("request-two"),
  ]);
  const report = await passOver(
    serviceOf(
      store,
      recordingGit(),
      { promotionsPerPassMax: 1 },
      recordingArtifacts(),
      metrics,
    ),
  );
  assert.equal(report.promotions, 1);
  assert.equal(report.holds, 1);
  assert.deepEqual(emitted, ["PassCeilingReached"]);
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

test("a candidate awaiting approval opens the ask and reaches neither the remote nor the permit", async () => {
  const waiting = promotableView("request-one");
  const store = recordingStore([
    {
      ...waiting,
      attempt: { ...attemptOf("request-one"), approvalRequired: true },
    },
  ]);
  const git = recordingGit();
  const report = await passOver(serviceOf(store, git));
  assert.equal(report.approvals, 1);
  assert.equal(report.promotions, 0);
  assert.deepEqual(
    store.asks.map((ask) => ask.attempt),
    ["attempt-request-one"],
  );
  assert.deepEqual(git.promotions, []);
  assert.deepEqual(store.grants, []);
});

test("an ask already standing holds rather than opening a second question", async () => {
  const store = recordingStore([
    {
      ...promotableView("request-one"),
      attempt: { ...attemptOf("request-one"), approvalRequired: true },
    },
  ]);
  store.asked = { asked: "AlreadyRequested" };
  const report = await passOver(serviceOf(store, recordingGit()));
  assert.equal(report.approvals, 0);
  assert.equal(report.holds, 1);
});

test("a settled request gives its claim back and moves nothing else", async () => {
  const settled: FinalizationView = {
    lifecycle: "Active",
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

/** One view of a claimed request that has no attempt yet, which is what prepares one. */
function preparableView(request: string): FinalizationView {
  return {
    lifecycle: "Active",
    claim: claimOf(request),
    repository: binding,
    observedTarget: attemptOf(request).target,
    approval: "Pending",
    attemptsMade: 0,
  };
}

test("a clean preparation builds over the observed target and records one prepared attempt", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = recordingGit();
  const integrated = asGitObjectId(commitOf("e"));
  git.integrated = { integrated: "Candidate", candidate: integrated };
  const report = await passOver(serviceOf(store, git));
  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 0);
  assert.deepEqual(
    git.preparations.map((each) => each.target.commit),
    [commitOf("a")],
  );
  assert.deepEqual(
    git.preparations.map((each) => each.files.map((file) => file.path)),
    [["one.txt"]],
  );
  const recorded = store.attempts[0];
  assert.equal(store.attempts.length, 1);
  assert.equal(recorded?.outcome, "Prepared");
  assert.equal(recorded?.candidate, integrated);
  assert.equal(recorded?.strategy, "Merge");
  assert.equal(recorded?.configuration.revision, "revision-run");
  assert.equal(recorded?.approvalRequired, false);
  assert.equal(recorded?.attemptDigest.length, 64);
  assert.deepEqual(
    recorded?.bundle.references.map((each) => each.kind),
    ["Repository", "ConfigurationRevision", "ResultManifest"],
  );
});

/** The branch the brief-bearing cases name, which is nobody's default. */
const briefBranch = "refs/heads/chuggy/footer-2026";

test("a finalization observes and pins the branch the ticket's brief names", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = recordingGit();

  await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(briefBranch),
  });

  assert.deepEqual(
    git.observations.map((each) => each.targetRef),
    [briefBranch, briefBranch],
    "the target is read at the ticket's branch before and after the candidate",
  );
  assert.equal(git.integrations[0]?.target.ref, briefBranch);
  assert.equal(store.attempts[0]?.target.ref, briefBranch);
});

test("a ticket whose brief names no branch is finalized against the binding's own default", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = recordingGit();

  await passOver(serviceOf(store, git));

  assert.deepEqual(
    git.observations.map((each) => each.targetRef),
    [undefined, undefined],
  );
  assert.equal(store.attempts[0]?.target.ref, "refs/heads/main");
});

test("the promotion pushes the branch the brief names and never the binding default", async () => {
  const view = promotableView("request-one");
  const store = recordingStore([
    {
      ...view,
      attempt: {
        ...attemptOf("request-one"),
        target: {
          ref: asGitRefName(briefBranch),
          commit: asGitObjectId(commitOf("a")),
        },
      },
    },
  ]);
  const git = recordingGit();

  const report = await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(briefBranch),
  });

  assert.equal(report.promotions, 1);
  assert.deepEqual(
    git.promotions.map((each) => each.target.ref),
    [briefBranch],
  );
});

test("a source handoff is verified from Git and integrated without reading artifact bytes", async () => {
  const store = recordingStore([preparableView("request-one")]);
  store.gathering = {
    work: [passedWork],
    artifacts: [],
    sources: [
      {
        execution: passedWork.execution,
        attempt: passedWork.attempt,
        repository: binding.repository,
        ref: asGitRefName(
          "refs/heads/chuggy/tickets/1/attempts/" + "a".repeat(64),
        ),
        commit: asGitObjectId(commitOf("c")),
        base: asGitObjectId(commitOf("a")),
        expectedBase: asGitObjectId(commitOf("a")),
      },
    ],
  };
  const git = recordingGit();
  const artifacts = recordingArtifacts();

  await passOver(serviceOf(store, git, {}, artifacts));

  assert.deepEqual(artifacts.requests, []);
  assert.deepEqual(git.preparations, []);
  assert.deepEqual(git.sourcePreparations, [
    {
      repository: binding,
      ref: "refs/heads/chuggy/tickets/1/attempts/" + "a".repeat(64),
      commit: commitOf("c"),
      base: commitOf("a"),
    },
  ]);
  assert.equal(store.attempts[0]?.outcome, "Prepared");
});

/** One immutable candidate the named execution declared, over the commit the marker spells. */
function sourceOf(work: HandoffWork, marker: string): HandoffSource {
  return {
    execution: work.execution,
    attempt: work.attempt,
    repository: binding.repository,
    ref: asGitRefName(
      `refs/heads/chuggy/tickets/1/attempts/${marker.repeat(64)}`,
    ),
    commit: asGitObjectId(commitOf(marker)),
    base: asGitObjectId(commitOf("a")),
    expectedBase: asGitObjectId(commitOf("a")),
  };
}

test("a ticket that reworked prepares the source its latest passed work declared", async () => {
  const reworked: HandoffWork = {
    ...passedWork,
    execution: asExecutionId("execution-rework"),
    attempt: asAttemptId("attempt-rework"),
    manifest: asResultManifestId("manifest-rework"),
    spawn: "spawn-rework",
    task: 3,
  };
  const store = recordingStore([preparableView("request-one")]);
  store.gathering = {
    work: [reworked, passedWork],
    artifacts: [],
    sources: [sourceOf(reworked, "d"), sourceOf(passedWork, "c")],
  };
  const git = recordingGit();

  await passOver(serviceOf(store, git, {}, recordingArtifacts()));

  assert.deepEqual(
    git.sourcePreparations.map((each) => each.commit),
    [commitOf("d")],
  );
  assert.equal(store.attempts[0]?.outcome, "Prepared");
  assert.deepEqual(
    store.attempts[0]?.bundle.references
      .filter((each) => each.kind === "ResultManifest")
      .map((each) => each.reference),
    ["manifest-rework"],
  );
});

/** The release remote a publication names, which is no repository the ticket worked in. */
const handoffRepository: RepositoryBinding = {
  partition,
  repository: asRepositoryId("ssh://git.internal/platform-releases"),
  recoveryEpoch: epoch,
  targetRef: asGitRefName("refs/heads/team-blue"),
  credentialReference: "platform-release-writer",
};

/** One claimed publication of an accepted work commit into that release remote. */
function publicationView(request: string): FinalizationView {
  return {
    lifecycle: "Active",
    claim: { ...claimOf(request), kind: "PublishHandoff" as const },
    repository: handoffRepository,
    handoffRequest: {
      kind: "PublishHandoff",
      configurationRevision: "revision-run",
      configurationDigest: digestOf("revision-run"),
      repository: handoffRepository,
      acceptedWorkRepository: asRepositoryId(
        "ssh://git.internal/unrelated-service",
      ),
      acceptedWorkCommit: asGitObjectId(commitOf("f")),
      destinationPath: "builds/unrelated/request.json",
      output: '{"source":"immutable"}',
      requestDigest: digestOf("publication"),
    },
    approval: "Pending",
    attemptsMade: 0,
  };
}

test("a publication prepares only its pinned request in the handoff repository", async () => {
  const store = recordingStore([publicationView("publish-unrelated-service")]);
  const git = recordingGit();
  const artifacts = recordingArtifacts();

  await passOver(serviceOf(store, git, {}, artifacts));

  assert.equal(artifacts.requests.length, 0);
  assert.equal(git.preparations.length, 1);
  assert.equal(
    git.preparations[0]?.repository.repository,
    handoffRepository.repository,
  );
  assert.deepEqual(git.preparations[0]?.files, [
    {
      path: "builds/unrelated/request.json",
      content: new TextEncoder().encode('{"source":"immutable"}'),
    },
  ]);
  assert.equal(store.attempts[0]?.configuration.revision, "revision-run");
});

test("a publication keeps the destination it pinned however the ticket's brief reads", async () => {
  const store = recordingStore([publicationView("publish-unrelated-service")]);
  const git = recordingGit();

  await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(briefBranch),
  });

  assert.deepEqual(
    git.observations.map((each) => each.targetRef),
    [handoffRepository.targetRef, handoffRepository.targetRef],
  );
  assert.equal(store.attempts[0]?.target.ref, handoffRepository.targetRef);
});

test("the pinned revision is what says a candidate needs a person's approval", async () => {
  const store = recordingStore([preparableView("request-one")]);
  store.gathering = {
    work: [
      {
        ...passedWork,
        canonical: asCanonicalConfiguration(
          '{"finalizationApprovalRequired":true,"image":"i","version":1}',
        ),
      },
    ],
    artifacts: store.gathering.artifacts,
    sources: [],
  };
  await passOver(serviceOf(store, recordingGit()));
  assert.equal(store.attempts[0]?.approvalRequired, true);
});

/** A remote that answers each observation in turn, which is how a target moves mid-preparation. */
function movingTarget(
  git: GitRecorder,
  answers: readonly TargetObserved[],
): void {
  let asked = 0;
  git.observeTarget = () => {
    const answer = answers[Math.min(asked, answers.length - 1)];
    asked += 1;
    if (answer === undefined) {
      throw new Error("the fixture named no observation to answer with");
    }
    return Promise.resolve(answer);
  };
}

test("the target the integration was answered against is what the attempt pins", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = recordingGit();
  movingTarget(git, [
    { observed: "Target", target: attemptOf("any").target },
    {
      observed: "Target",
      target: {
        ref: asGitRefName("refs/heads/main"),
        commit: asGitObjectId(commitOf("f")),
      },
    },
  ]);
  const report = await passOver(serviceOf(store, git));
  assert.equal(report.preparations, 1);
  assert.deepEqual(
    git.preparations.map((each) => each.target.commit),
    [commitOf("a")],
  );
  assert.deepEqual(
    git.integrations.map((each) => each.target.commit),
    [commitOf("f")],
  );
  assert.equal(store.attempts[0]?.target.commit, commitOf("f"));
});

test("a genuine conflict writes a manifest with its own identity and digest and prices one failure", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = recordingGit();
  const artifacts = recordingArtifacts();
  git.integrated = {
    integrated: "Conflicted",
    conflict: { paths: ["one.txt"], truncated: false },
    base: asGitObjectId(commitOf("a")),
  };
  const report = await passOver(serviceOf(store, git, {}, artifacts));
  assert.equal(report.preparations, 1);
  const written = artifacts.writes[0];
  assert.equal(written?.artifact, "conflict-1");
  const evidence: unknown = JSON.parse(
    new TextDecoder().decode(written?.content),
  );
  assert.deepEqual(evidence, {
    version: 1,
    request: "request-one",
    attempt: "attempt-1",
    strategy: "Merge",
    candidate: commitOf("c"),
    targetRef: "refs/heads/main",
    targetCommit: commitOf("a"),
    mergeBase: commitOf("a"),
    conflictingPaths: ["one.txt"],
    truncated: false,
  });
  const recorded = store.attempts[0];
  assert.equal(recorded?.outcome, "Failed");
  assert.equal(recorded?.failureKind, "MergeConflict");
  assert.equal(recorded?.conflictManifest, "conflict-1");
  assert.equal(recorded?.conflictDigest, digestOf("evidence"));
  assert.equal(recorded?.candidate, undefined);
});

test("a conflict nothing could store leaves no attempt, because the evidence is half of it", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = recordingGit();
  const artifacts = recordingArtifacts();
  git.integrated = {
    integrated: "Conflicted",
    conflict: { paths: ["one.txt"], truncated: false },
  };
  artifacts.wrote = { written: "Unavailable", retryAfterSeconds: 30 };
  const report = await passOver(serviceOf(store, git, {}, artifacts));
  assert.equal(report.holds, 1);
  assert.deepEqual(store.attempts, []);
});

test("artifacts that could not be confirmed fail the preparation and never reach the remote", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = recordingGit();
  const artifacts = recordingArtifacts();
  artifacts.read = {
    read: "Rejected",
    failure: "DigestMismatch",
    at: { role: "Handoff", index: 0 },
  };
  await passOver(serviceOf(store, git, {}, artifacts));
  assert.deepEqual(git.preparations, []);
  assert.equal(store.attempts[0]?.outcome, "Failed");
  assert.equal(store.attempts[0]?.failureKind, "PreparationFailed");
});

test("a storage outage leaves no attempt at all, because it is evidence about nothing", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = recordingGit();
  const artifacts = recordingArtifacts();
  artifacts.read = { read: "Unavailable", retryAfterSeconds: 30 };
  const report = await passOver(serviceOf(store, git, {}, artifacts));
  assert.equal(report.holds, 1);
  assert.deepEqual(store.attempts, []);
  assert.deepEqual(git.preparations, []);
});

test("a handoff naming the repository itself is refused before any blob is written", async () => {
  const store = recordingStore([preparableView("request-one")]);
  store.gathering = {
    work: [passedWork],
    artifacts: [handoffOf(".git/config", "hijacked")],
    sources: [],
  };
  const git = recordingGit();
  await passOver(serviceOf(store, git));
  assert.deepEqual(git.preparations, []);
  assert.equal(store.attempts[0]?.failureKind, "PreparationFailed");
});

test("a ticket whose passed work has no result at all is a hold and never a failure", async () => {
  const store = recordingStore([preparableView("request-one")]);
  store.gathering = { work: [], artifacts: [], sources: [] };
  const report = await passOver(serviceOf(store, recordingGit()));
  assert.equal(report.holds, 1);
  assert.deepEqual(store.attempts, []);
});

test("a closing project's abort reaches no remote, asks for no permit and prices one failure", async () => {
  for (const lifecycle of populated(
    allClosingLifecycles,
    "allClosingLifecycles",
  )) {
    const store = recordingStore([
      { ...promotableView("request-one"), lifecycle },
    ]);
    const git = recordingGit();
    const report = await passOver(serviceOf(store, git));
    assert.deepEqual(git.promotions, [], lifecycle);
    assert.deepEqual(git.preparations, [], lifecycle);
    assert.deepEqual(store.grants, [], lifecycle);
    assert.equal(report.promotions, 0, lifecycle);
    assert.equal(store.attempts.length, 1, lifecycle);
    assert.equal(store.attempts[0]?.outcome, "Failed", lifecycle);
    assert.equal(
      store.attempts[0]?.failureKind,
      "PreparationFailed",
      lifecycle,
    );
    assert.equal(store.attempts[0]?.candidate, undefined, lifecycle);
  }
});

test("the preparation an abort spends is one the sink hears about", async () => {
  const spent: number[] = [];
  const metrics = finalizerTelemetry({
    ...silentFinalizerMetrics,
    preparation: (restartsSpent) => spent.push(restartsSpent),
  });
  const store = recordingStore([
    { ...promotableView("request-one"), lifecycle: "Deleting" },
  ]);
  const report = await passOver(
    serviceOf(store, recordingGit(), {}, recordingArtifacts(), metrics),
  );
  assert.equal(report.preparations, 1);
  assert.deepEqual(spent, [0]);
});

test("a closing project whose passed work is gone holds rather than pricing a failure", async () => {
  const store = recordingStore([
    { ...promotableView("request-one"), lifecycle: "Deleting" },
  ]);
  store.gathering = { work: [], artifacts: [], sources: [] };
  const report = await passOver(serviceOf(store, recordingGit()));
  assert.equal(report.holds, 1);
  assert.deepEqual(store.attempts, []);
});

test("a pass prepares no more candidates than its ceiling admits", async () => {
  const store = recordingStore([
    preparableView("request-one"),
    preparableView("request-two"),
    preparableView("request-three"),
  ]);
  const git = recordingGit();
  const report = await passOver(
    serviceOf(store, git, { preparationsPerPassMax: 2 }),
  );
  assert.equal(report.preparations, 2);
  assert.equal(git.preparations.length, 2);
  assert.equal(store.attempts.length, 2);
});

test("an unreadable remote after the candidate is built records nothing at all", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = recordingGit();
  movingTarget(git, [
    { observed: "Target", target: attemptOf("any").target },
    { observed: "Unreadable", evidence: "RemoteUnreachable" },
  ]);
  const report = await passOver(serviceOf(store, git));
  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 1);
  assert.deepEqual(git.integrations, []);
  assert.deepEqual(store.attempts, []);
});

test("a promotion is observed by the arm it came back on, and the permit by its states", async () => {
  const seen: string[] = [];
  const store = recordingStore([promotableView("request-observed")]);
  const report = await passOver(
    serviceOf(
      store,
      recordingGit(),
      {},
      recordingArtifacts(),
      finalizerTelemetry(telemetryRecording<FinalizerMetrics>(declared, seen)),
    ),
  );
  assert.equal(report.promotions, 1);
  assert.deepEqual(seen, [
    "reopening:Epoch:0",
    "reopening:Lapsed:0",
    `claiming:1:${String(finalizerDefaults.requestsPerPassMax)}`,
    "permit:Granted",
    "promotion:Advanced",
    "reconciliation:Promoted",
    "permit:Concluded",
  ]);
});

test("a refused permit grant is a hold that says so, which no report could", async () => {
  const seen: string[] = [];
  const store = recordingStore([promotableView("request-refused")]);
  store.granted = { granted: "Refused", refusal: "PermitLive" };
  const report = await passOver(
    serviceOf(
      store,
      recordingGit(),
      {},
      recordingArtifacts(),
      finalizerTelemetry(telemetryRecording<FinalizerMetrics>(declared, seen)),
    ),
  );
  assert.equal(report.holds, 1);
  assert.equal(
    seen.filter((each) => each.startsWith("holding:")).length,
    report.holds,
  );
  assert.deepEqual(
    seen.filter((each) => each.startsWith("holding:")),
    ["holding:PermitRefused"],
  );
});

test("a sink that fails at every observation cannot fail the pass it observed", async () => {
  const thrown: string[] = [];
  const failing = await passOver(
    serviceOf(
      recordingStore([promotableView("request-loud")]),
      recordingGit(),
      {},
      recordingArtifacts(),
      finalizerTelemetry(telemetryThrowing<FinalizerMetrics>(declared, thrown)),
    ),
  );
  const silent = await passOver(
    serviceOf(
      recordingStore([promotableView("request-quiet")]),
      recordingGit(),
    ),
  );
  assert.deepEqual(failing, silent);
  assert.ok(thrown.length > 0, "no observation was attempted");
});
