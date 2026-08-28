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
import type { BriefFinalizationMode } from "../../src/contract/rosters.ts";
import { asCanonicalConfiguration } from "../../src/interpreter/authoring.ts";
import {
  asForgeBindingId,
  asForgeCredentialReference,
  asProposalDisplayUrl,
  asProposalRemoteIdentity,
  type ChangeProposalCreated,
  type ChangeProposalEvidence,
  type ChangeProposalForges,
  type ChangeProposalPort,
  type ChangeProposalPublicationView,
  type ChangeProposalRead,
  type ChangeProposalRequest,
} from "../../src/interpreter/changeProposal.ts";
import type {
  ChangeProposalRecord,
  ChangeProposalResult,
  FinalizerProposalStore,
} from "../../src/interpreter/finalizationProposal.ts";
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
  asBriefFinalization,
  asBriefIntent,
  type DraftBrief,
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
interface FinalizerRecorder
  extends FinalizerStore, FinalizerPreparationStore, FinalizerProposalStore {
  readonly grants: PermitRequest[];
  readonly readings: ReconciliationRecord[];
  readonly settled: string[];
  readonly submitted: string[];
  readonly attempts: AttemptRecord[];
  readonly asks: ApprovalAsk[];
  readonly opened: ChangeProposalRecord[];
  readonly results: ChangeProposalResult[];
  gathering: HandoffGathering;
  asked: ApprovalAsked;
  granted?: PermitGranted;
  publication?: ChangeProposalPublicationView;
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
    opened: [],
    results: [],
    changeProposalPublication: () => Promise.resolve(own.publication),
    openChangeProposal: (record) => {
      if (own.publication !== undefined)
        return Promise.resolve({ opened: "Refused" });
      own.opened.push(record);
      own.publication = { reconciliations: 0 };
      return Promise.resolve({ opened: "Opened" });
    },
    recordChangeProposal: (record) => {
      own.results.push(record);
      const held = own.publication ?? { reconciliations: 0 };
      own.publication =
        record.result.records === "Creation"
          ? { ...held, creation: record.result.created }
          : {
              ...held,
              reconciliation: record.result.reconciled,
              reconciliations: held.reconciliations + 1,
            };
      return Promise.resolve({ recorded: "Result" });
    },
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

/**
 * A brief port answering whichever of the two branches a case names — the one
 * its work happens on, the one its finalization lands on, or both, each being
 * optional of the other. No brief at all when it names neither.
 */
function briefsOf(
  branch?: string,
  target?: string,
  mode: BriefFinalizationMode = "Push",
): TicketBriefPort {
  const brief: DraftBrief | undefined =
    branch === undefined && target === undefined
      ? undefined
      : {
          intent: asBriefIntent("carry the ticket's own branch"),
          links: [],
          ...(branch === undefined ? {} : { branch: asBriefBranch(branch) }),
          ...(target === undefined
            ? {}
            : { finalization: asBriefFinalization({ mode, target }) }),
        };
  return { brief: () => Promise.resolve(brief) };
}

/** The forges a case binds, none at all being what a deployment landing every ticket by pushing names. */
function forgesOf(port?: ChangeProposalPort): ChangeProposalForges {
  return {
    selector: { select: () => port },
    bindingOf: () =>
      port === undefined
        ? undefined
        : {
            forge: asForgeBindingId("forge-run"),
            credential: asForgeCredentialReference("forge-run-proposals"),
          },
  };
}

/** What one fixture forge was asked for, and what it was told to answer. */
interface ForgeRecorder extends ChangeProposalPort {
  readonly creates: ChangeProposalRequest[];
  readonly reads: ChangeProposalRequest[];
  /** Whether the row saying a create may have happened was already there when it was called. */
  readonly openedBeforeCreate: boolean[];
  created: ChangeProposalCreated["created"];
  read: ChangeProposalRead["read"];
}

/** The evidence the forge answers a request with, which is that request's own fields. */
function forgeEvidence(
  request: ChangeProposalRequest,
  overrides: Partial<ChangeProposalEvidence> = {},
): ChangeProposalEvidence {
  return {
    identity: {
      forge: request.binding.forge,
      remote: asProposalRemoteIdentity("proposal-run"),
    },
    repository: request.repository,
    marker: request.marker,
    head: request.head,
    base: request.base,
    title: request.title,
    body: request.body,
    status: "Open",
    url: asProposalDisplayUrl("https://forge.invalid/proposals/1"),
    ...overrides,
  };
}

/**
 * A forge that records what it was asked for, and reads the store as it is
 * called: the row saying a create may have happened must already be there when
 * `create` runs, and this is what sees whether it was.
 */
function recordingForge(store: FinalizerRecorder): ForgeRecorder {
  const own: ForgeRecorder = {
    creates: [],
    reads: [],
    openedBeforeCreate: [],
    created: "Ambiguous",
    read: "Absent",
    create: (request) => {
      own.creates.push(request);
      own.openedBeforeCreate.push(store.opened.length > 0);
      const created = own.created;
      if (created === "Created" || created === "AlreadyExists")
        return Promise.resolve({ created, evidence: forgeEvidence(request) });
      if (created === "Contradictory")
        return Promise.resolve({
          created,
          contradiction: "Closed",
          evidence: forgeEvidence(request, { status: "Closed" }),
        });
      return Promise.resolve({ created });
    },
    readByMarker: (request) => {
      own.reads.push(request);
      const read = own.read;
      return Promise.resolve(
        read === "Found"
          ? { read, evidence: forgeEvidence(request) }
          : { read },
      );
    },
  };
  return own;
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
    forges: forgesOf(),
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
    git.preparations.map((each) => each.base.commit),
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
    "the target is read at the ticket's branch before and after the candidate, and nowhere else",
  );
  assert.equal(git.preparations[0]?.base.ref, briefBranch);
  assert.equal(git.integrations[0]?.target.ref, briefBranch);
  assert.equal(store.attempts[0]?.target.ref, briefBranch);
});

/** A remote holding every ref a case asks for but the one it names, and its default under none. */
function gitWithoutBranch(branch: string): GitRecorder {
  const git = recordingGit();
  git.observeTarget = (repository) => {
    git.observations.push(repository);
    const answer: TargetObserved =
      repository.targetRef === branch
        ? { observed: "Unreadable", evidence: "RefUnreadable" }
        : {
            observed: "Target",
            target: {
              ref: asGitRefName(repository.targetRef ?? "refs/heads/main"),
              commit: asGitObjectId(commitOf("a")),
            },
          };
    return Promise.resolve(answer);
  };
  return git;
}

test("a brief branch the remote does not hold is prepared over the binding's own target", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = gitWithoutBranch(briefBranch);

  const report = await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(briefBranch),
  });

  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 0);
  assert.deepEqual(
    git.observations.map((each) => each.targetRef),
    [briefBranch, undefined, briefBranch],
    "the branch is asked for, the binding's own target stands in, and the branch is asked for again",
  );
  assert.deepEqual(git.preparations[0]?.base, {
    ref: briefBranch,
    commit: commitOf("a"),
    baseRef: "refs/heads/main",
  });
  assert.equal(git.integrations[0]?.target.ref, briefBranch);
  assert.equal(store.attempts[0]?.outcome, "Prepared");
  assert.equal(store.attempts[0]?.target.ref, briefBranch);
  assert.equal(store.attempts[0]?.target.commit, commitOf("a"));
});

/** The branch a case's finalization lands on, which is neither the work's nor anyone's default. */
const landingBranch = "refs/heads/chuggy/footer-landing";

/** A remote holding a commit of its own under every ref, so two branches cannot be confused. */
function gitPerBranch(): GitRecorder {
  const git = recordingGit();
  git.observeTarget = (repository) => {
    git.observations.push(repository);
    const ref = repository.targetRef ?? "refs/heads/main";
    return Promise.resolve<TargetObserved>({
      observed: "Target",
      target: {
        ref: asGitRefName(ref),
        commit: asGitObjectId(commitOf(ref === landingBranch ? "b" : "a")),
      },
    });
  };
  return git;
}

test("a brief targeting a branch apart from its work's lands there and never on the work's", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = gitPerBranch();

  await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(briefBranch, landingBranch),
  });

  assert.deepEqual(
    git.observations.map((each) => each.targetRef),
    [landingBranch, briefBranch, landingBranch],
    "the target is read, then the branch the work happened on, then the target again",
  );
  assert.equal(git.integrations[0]?.target.ref, landingBranch);
  assert.equal(store.attempts[0]?.target.ref, landingBranch);
  assert.equal(store.attempts[0]?.target.commit, commitOf("b"));
});

test("a candidate for a brief landing elsewhere is built over the branch the work happened on", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = gitPerBranch();

  const report = await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(briefBranch, landingBranch),
  });

  assert.equal(report.preparations, 1);
  assert.deepEqual(
    git.preparations[0]?.base,
    { ref: briefBranch, commit: commitOf("a") },
    "the candidate descends from the work's own branch, so what accumulated there lands too",
  );
  assert.equal(git.integrations[0]?.target.commit, commitOf("b"));
});

test("a brief landing somewhere while naming no branch of its own is built over the binding's default", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = gitPerBranch();

  const report = await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(undefined, landingBranch),
  });

  assert.equal(report.preparations, 1);
  assert.deepEqual(
    git.observations.map((each) => each.targetRef),
    [landingBranch, undefined, landingBranch],
    "the target is read, then the default the work ran against, then the target again",
  );
  assert.deepEqual(
    git.preparations[0]?.base,
    { ref: "refs/heads/main", commit: commitOf("a") },
    "the candidate is built over the tree the work was observed against",
  );
  assert.equal(git.integrations[0]?.target.commit, commitOf("b"));
  assert.notEqual(
    git.preparations[0]?.base.commit,
    git.integrations[0]?.target.commit,
    "the target is not the candidate's own parent, so the integration is a merge and not a passthrough",
  );
});

/** A remote answering for the branch a case lands on and failing on the one it worked on. */
function gitWithoutWorkBranch(): GitRecorder {
  const git = recordingGit();
  git.observeTarget = (repository) => {
    git.observations.push(repository);
    const answer: TargetObserved =
      repository.targetRef === briefBranch
        ? { observed: "Unreadable", evidence: "RemoteUnreachable" }
        : {
            observed: "Target",
            target: {
              ref: asGitRefName(repository.targetRef ?? "refs/heads/main"),
              commit: asGitObjectId(commitOf("b")),
            },
          };
    return Promise.resolve(answer);
  };
  return git;
}

test("a work branch the remote could not answer for holds rather than building over the target", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = gitWithoutWorkBranch();

  const report = await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(briefBranch, landingBranch),
  });

  assert.equal(report.holds, 1);
  assert.deepEqual(
    git.preparations,
    [],
    "no candidate is built at all, the target's own tree included",
  );
  assert.deepEqual(git.integrations, []);
  assert.deepEqual(store.attempts, []);
});

test("a target the remote does not hold is pinned at the binding's own target and built over the work", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = gitWithoutBranch(landingBranch);

  const report = await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(briefBranch, landingBranch),
  });

  assert.equal(report.preparations, 1);
  assert.equal(report.holds, 0);
  assert.deepEqual(git.preparations[0]?.base, {
    ref: briefBranch,
    commit: commitOf("a"),
  });
  assert.deepEqual(store.attempts[0]?.target, {
    ref: landingBranch,
    commit: commitOf("a"),
    baseRef: "refs/heads/main",
  });
});

test("a brief naming no target reads one branch and builds the candidate over it", async () => {
  const store = recordingStore([preparableView("request-one")]);
  const git = gitPerBranch();

  await passOver({
    ...serviceOf(store, git),
    ticketBriefs: briefsOf(briefBranch),
  });

  assert.deepEqual(
    git.observations.map((each) => each.targetRef),
    [briefBranch, briefBranch],
    "the branch the work lands on is the branch it happened on, so it is read once for both",
  );
  assert.deepEqual(git.preparations[0]?.base, store.attempts[0]?.target);
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

/** One view whose candidate is promoted and whose brief lands it by opening a proposal. */
function proposedView(request: string): FinalizationView {
  return {
    ...promotableView(request),
    finalizationMode: "PullRequest",
    permit: { ...permitOf(request), state: "Concluded" },
    attempt: {
      ...attemptOf(request),
      target: {
        ref: asGitRefName(briefBranch),
        commit: asGitObjectId(commitOf("a")),
      },
    },
    reconciliation: {
      permit: asCommitPermitId(`permit-${request}`),
      candidate: asGitObjectId(commitOf("c")),
      target: asGitRefName(briefBranch),
      verdict: "Promoted",
      observed: asGitObjectId(commitOf("c")),
    },
  };
}

/** The service every proposal case drives: the ticket's brief, and the forge it is bound to. */
function proposingService(
  store: FinalizerRecorder,
  git: GitPromotionPort,
  forge: ForgeRecorder | undefined,
  bounds: Partial<typeof finalizerDefaults> = {},
): FinalizerService {
  return {
    ...serviceOf(store, git, bounds),
    forges: forgesOf(forge),
    ticketBriefs: briefsOf(briefBranch, landingBranch, "PullRequest"),
  };
}

test("a promoted candidate whose brief proposes opens one from its branch into its target", async () => {
  const store = recordingStore([proposedView("request-one")]);
  const forge = recordingForge(store);
  forge.created = "Created";
  const service = proposingService(store, recordingGit(), forge);

  const opening = await passOver(service);

  assert.equal(opening.proposals, 1);
  assert.equal(opening.conclusions, 0, "a create is not yet a proved proposal");
  assert.deepEqual(
    forge.openedBeforeCreate,
    [true],
    "the row saying a create may have happened was written before it was called",
  );
  assert.equal(forge.creates[0]?.head.ref, briefBranch);
  assert.equal(forge.creates[0]?.head.commit, commitOf("c"));
  assert.equal(forge.creates[0]?.base.ref, landingBranch);
  assert.deepEqual(store.opened[0]?.request, forge.creates[0]);
  assert.equal(store.results[0]?.result.records, "Creation");
  assert.equal(
    forge.creates[0]?.body.includes(forge.creates[0].marker),
    true,
    "a body without its marker is one no read could conclude",
  );
  assert.equal(
    forge.creates[0]?.title,
    "ticket 1: carry the ticket's own branch",
  );

  const proved = await passOver(service);

  assert.equal(proved.conclusions, 1);
  assert.equal(proved.proposals, 0, "a proved proposal spends no forge act");
  assert.equal(forge.creates.length, 1, "no second create was authorized");
  assert.deepEqual(forge.reads, []);
  assert.deepEqual(store.submitted, ["request-one"]);
});

test("a create that may have happened is read back, and the reading is what concludes", async () => {
  const store = recordingStore([proposedView("request-one")]);
  const forge = recordingForge(store);
  const service = proposingService(store, recordingGit(), forge);

  await passOver(service);
  forge.read = "Found";
  const reading = await passOver(service);

  assert.equal(forge.creates.length, 1, "no second create was authorized");
  assert.equal(forge.reads.length, 1);
  assert.equal(reading.proposals, 1);
  assert.equal(reading.conclusions, 0);
  assert.equal(store.results[1]?.result.records, "Reconciliation");

  const proved = await passOver(service);

  assert.equal(proved.conclusions, 1);
  assert.equal(forge.reads.length, 1, "a proved proposal is not read again");
  assert.deepEqual(store.submitted, ["request-one"]);
});

test("a proposal nothing can find within its bound is held and never created again", async () => {
  const store = recordingStore([proposedView("request-one")]);
  const forge = recordingForge(store);
  const service = proposingService(store, recordingGit(), forge, {
    proposalReconciliationsMax: 2,
  });

  await passOver(service);
  for (let reading = 0; reading < 2; reading += 1) await passOver(service);
  const exhausted = await passOver(service);

  assert.equal(forge.creates.length, 1);
  assert.equal(forge.reads.length, 2);
  assert.equal(exhausted.holds, 1);
  assert.equal(exhausted.conclusions, 0);
});

test("a proposal the forge says stands against another change is refused and held", async () => {
  const store = recordingStore([proposedView("request-one")]);
  const forge = recordingForge(store);
  forge.created = "Contradictory";
  const service = proposingService(store, recordingGit(), forge);

  await passOver(service);
  const refused = await passOver(service);

  assert.equal(refused.holds, 1);
  assert.equal(refused.conclusions, 0);
  assert.equal(forge.creates.length, 1);
});

test("a pass opens no more proposals than its ceiling admits", async () => {
  const store = recordingStore([
    proposedView("request-one"),
    proposedView("request-two"),
  ]);
  const forge = recordingForge(store);
  const report = await passOver(
    proposingService(store, recordingGit(), forge, { proposalsPerPassMax: 1 }),
  );
  assert.equal(report.proposals, 1);
  assert.equal(forge.creates.length, 1);
  assert.equal(report.holds, 1);
});

test("a brief that pushes reaches no forge however the deployment is bound", async () => {
  const store = recordingStore([
    { ...proposedView("request-one"), finalizationMode: "Push" },
  ]);
  const forge = recordingForge(store);
  const report = await passOver({
    ...proposingService(store, recordingGit(), forge),
    ticketBriefs: briefsOf(briefBranch, landingBranch),
  });
  assert.equal(report.conclusions, 1);
  assert.equal(report.proposals, 0);
  assert.deepEqual(forge.creates, []);
  assert.deepEqual(store.opened, []);
});

test("a handoff promotion never proposes, whatever mode its ticket's brief names", async () => {
  const store = recordingStore([
    {
      ...proposedView("request-one"),
      claim: {
        ...proposedView("request-one").claim,
        kind: "PromoteForHandoff",
      },
    },
  ]);
  const forge = recordingForge(store);
  const report = await passOver(proposingService(store, recordingGit(), forge));
  assert.equal(report.conclusions, 1);
  assert.equal(report.proposals, 0);
  assert.deepEqual(forge.creates, []);
});

test("a base the remote does not hold holds the proposal and never creates one", async () => {
  const store = recordingStore([proposedView("request-one")]);
  const git = gitWithoutBranch(landingBranch);
  const forge = recordingForge(store);
  const report = await passOver(proposingService(store, git, forge));
  assert.equal(report.holds, 1);
  assert.deepEqual(forge.creates, []);
  assert.deepEqual(store.opened, []);
});

test("a repository this deployment binds no forge for holds rather than crashing", async () => {
  const store = recordingStore([proposedView("request-one")]);
  const report = await passOver(
    proposingService(store, recordingGit(), undefined),
  );
  assert.equal(report.holds, 1);
  assert.equal(report.conclusions, 0);
  assert.deepEqual(store.opened, []);
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
    git.preparations.map((each) => each.base.commit),
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
