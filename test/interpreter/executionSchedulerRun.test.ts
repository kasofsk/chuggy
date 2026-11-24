/**
 * The scheduler pass at the lowest tier that can express it: which durable
 * move each policy and placement answer produces, with the store and the
 * fabric replaced by recorders.
 *
 * WHAT THIS TIER CAN DECIDE is the branch, and that is exactly the thing 006
 * separates into two inabilities: a definitive denial must reach
 * `blockExecution` and a temporary one must reach neither it nor the retry
 * budget. Whether the durable move is atomic is a claim about PostgreSQL and is
 * proved against a real server in `test/postgres/`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  schedulerTelemetry,
  asAttemptId,
  asCapacityAccountId,
  asClusterId,
  asAttemptCapabilityId,
  asAttemptCapabilitySecret,
  asExecutionId,
  asSchedulerOwnerId,
  asPlacementId,
  executionSchedulerDefaults,
  silentSchedulerTelemetry,
  type CancellationRegistered,
  type ExecutionOutcome,
  type ExecutionPolicy,
  type ExecutionRouting,
  type ExecutionSchedulerStore,
  type LogicalExecution,
  type PhysicalAttempt,
  type ProfileResolved,
  type RequestClaim,
  type RunnerLossResumed,
  type AttemptPlacementPort,
  type AttemptPlacementOutcome,
  type AttemptPlacement,
  type AttemptErrorWritten,
  type AttemptWorkloadObserved,
  type AttemptOpening,
  type Terminalized,
  type WaitingAttempt,
  type WaitingAttemptRecord,
  type WorkTaskInvocation,
} from "../../src/interpreter/executionScheduler.ts";
import {
  workTask,
  workTaskInvocation,
} from "../../src/interpreter/workerTask.ts";
import {
  executionSchedulerAdmit,
  executionSchedulerCancel,
  executionSchedulerCleanup,
  executionSchedulerLaunch,
  executionSchedulerObserve,
  executionSchedulerPass,
  executionSchedulerRegister,
  executionSchedulerResume,
  type ExecutionSchedulerService,
} from "../../src/interpreter/executionSchedulerRun.ts";
import { workerImageFaults } from "../../src/contract/workerEnvironment.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
import { resultReportCharsMax } from "../../src/contract/http.ts";
import {
  blessedPracticeCatalog,
  type ConfigurationRead,
  type PinnedTaskConfiguration,
  type RuntimeFacts,
  type RuntimeFactsRead,
} from "../../src/interpreter/taskBriefing.ts";
import {
  taskAuthorityGrant,
  type PolicyAuthorityGrant,
} from "../../src/interpreter/taskAuthority.ts";
import type { ConfigurationPin } from "../../src/interpreter/projectDecision.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  asRepositoryId,
  finalizerDefaults,
} from "../../src/interpreter/finalizer.ts";
import { finalizerRemoteDefaultRef } from "../../src/interpreter/finalizerLanding.ts";
import {
  briefingLabels,
  briefingPipelinesUnwritable,
} from "../../src/interpreter/briefingTemplate.ts";
import { ticketServiceDefaults } from "../../src/interpreter/ticketService.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { recordingMetrics, throwingMetrics } from "./schedulerSinks.ts";
import {
  asDraftBrief,
  type DraftBrief,
} from "../../src/interpreter/ticketBrief.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  ProjectAccessUnavailable,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  workerPoolMemoryMibDefault,
  type PersonalRunnerRegistered,
} from "../../src/interpreter/workerPool.ts";
import {
  workerPoolIncompatibility,
  type WorkerPoolAnswered,
} from "../../src/interpreter/workerPoolAssignment.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

/** An authority answering every project question for whoever asks, and no tenant question. */
const anyAccess: ProjectAccess = {
  authorize: (principal) => Promise.resolve(memberAuthority(principal)),
  authorizeTenant: () =>
    Promise.reject(new Error("the scheduler asks no tenant question here")),
  authorizeSite: projectAccessSiteRefused,
};
const epoch = asRecoveryEpoch("epoch");
const cluster = asClusterId("cluster");
const owner = asSchedulerOwnerId("scheduler-one");

/** The runtime the service opens every attempt under. */
const workerRuntime = `registry.chuggy.internal/chuggy/worker-runtime@sha256:${"e".repeat(64)}`;

const execution: LogicalExecution = {
  partition,
  execution: asExecutionId("execution-one"),
  route: "InCluster",
  ticket: asTicketId(1),
  task: asTaskId(1),
  taskKind: "Work",
  sourceRequest: "1:0:ExecuteTask",
  inputBundle: "1:0:InputBundle",
  inputBundleDigest: "b".repeat(64),
  sourceSeq: 1,
  sourceEffect: 0,
  ticketVersion: 1,
  account: asCapacityAccountId("project"),
  cluster,
  configurationRevision: "revision",
  configurationDigest: "digest",
  requirementIdentity: "requirement-one",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: "worker:v1",
  },
  requirementDigest: "requirement-digest",
  requirementSource: "PlatformDefault",
  platformDefaultVersion: 1,
  status: "Admitted",
  attemptsOpened: 0,
  retriesSpent: 0,
};

const attempt: PhysicalAttempt = {
  partition,
  execution: execution.execution,
  attempt: asAttemptId("attempt-one"),
  attemptNumber: 1,
  generation: 1,
  recoveryEpoch: epoch,
  state: "Placing",
  authoritative: true,
  capability: {
    id: asAttemptCapabilityId("capability-one"),
    secret: asAttemptCapabilitySecret("secret-one"),
    manifest: asResultManifestId("manifest-one"),
  },
};

/** A conclusion recorded as `call`, answered as terminalized with `outcome`. */
function recordedConclusion(
  calls: string[],
  call: string,
  outcome: ExecutionOutcome,
): Promise<Terminalized> {
  calls.push(call);
  return Promise.resolve({
    terminalized: "Terminalized",
    outcome,
    operation: asOperationId("operation"),
  });
}

/** The store's concluding moves, each recorded by name and answered as a settlement. */
function recordedConclusions(
  calls: string[],
): Pick<
  ExecutionSchedulerStore,
  "retriesExhausted" | "assignmentEnded" | "stepFailed" | "carryVerdict"
> {
  return {
    retriesExhausted: () =>
      recordedConclusion(calls, "retriesExhausted", "Failed"),
    assignmentEnded: () =>
      recordedConclusion(calls, "assignmentEnded", "ProcessFailed"),
    stepFailed: () => recordedConclusion(calls, "stepFailed", "ProcessFailed"),
    carryVerdict: (opening, source) =>
      recordedConclusion(
        calls,
        `carryVerdict:${opening.execution}:${source}`,
        "Passed",
      ),
  };
}

/** A store that records every durable move asked of it and takes none. */
function recordingStore(calls: string[]): ExecutionSchedulerStore {
  return {
    claimRequests: () => Promise.resolve([]),
    projectPlacement: () => Promise.resolve(undefined),
    registerSpawn: () =>
      Promise.resolve({ registered: "Registered", created: 1 }),
    registerCancellation: () =>
      Promise.resolve({ cancelled: "Registered", fenced: 0, placements: [] }),
    admit: () => Promise.resolve({ admitted: "ClusterFull" }),
    openAttempt: () => Promise.resolve({ opened: "Opened", attempt }),
    attemptInvoked: () => Promise.resolve(true),
    attemptPlaced: (_attempt, workload) => {
      calls.push(`placed:${workload}`);
      return Promise.resolve(true);
    },
    attemptEnded: (_attempt, loss, evidence) => {
      calls.push(`ended:${loss}:${evidence}`);
      return Promise.resolve(true);
    },
    ...recordedConclusions(calls),
    terminalize: () =>
      Promise.resolve({
        terminalized: "Terminalized",
        outcome: "Passed",
        operation: asOperationId("operation"),
      }),
    blockExecution: (_partition, _execution, reason) => {
      calls.push(`blocked:${reason}`);
      return Promise.resolve({
        blocked: "Blocked",
        operation: asOperationId("operation"),
      });
    },
    execution: () => Promise.resolve(undefined),
    refusedAttempts: () => Promise.resolve([]),
    attemptsAwaitingObservation: () => Promise.resolve([]),
    reapLapsedAttempts: () => Promise.resolve(0),
    attemptsAwaitingCleanup: () => Promise.resolve([]),
    attemptCleanupCompleted: () => Promise.resolve(true),
    waitingAttempts: () => Promise.resolve([]),
    waitingAttemptWithdrawn: (_attempt, evidence) => {
      calls.push(`waiting-withdrawn:${evidence}`);
      return Promise.resolve(true);
    },
    waitingAttemptOutdated: () => {
      calls.push("waiting-outdated");
      return Promise.resolve(true);
    },
    unlaunched: () => Promise.resolve([execution]),
    fenceOldEpochAttempts: () => {
      calls.push("fenced");
      return Promise.resolve(0);
    },
    runnerLostTickets: () => Promise.resolve([]),
    resumeRunnerLoss: (resume) => {
      calls.push(`resumed:${String(resume.ticket.ticket)}`);
      return Promise.resolve({
        resumed: "Submitted",
        operation: asOperationId("resume"),
      });
    },
    rateLimitedTickets: () => Promise.resolve([]),
    resumeRateLimit: () => Promise.resolve({ resumed: "NotResumable" }),
  };
}

const grant: PolicyAuthorityGrant = {
  tools: ["editor", "shell"],
  credentials: ["workspace"],
  network: false,
  filesystem: "WriteWorkspace",
  mayCompleteTask: true,
};

/** The line only the work block carries, so a briefing says which block it read. */
const workInstruction = "Change the importer and nothing beside it.";

/** The line only the review block carries, for the same reason. */
const reviewInstruction = "Walk the call paths the change reaches.";

const configuration: PinnedTaskConfiguration = {
  configurationRevision: "revision",
  configurationDigest: "digest",
  brief: {
    motivation: ["The importer drops rows and reports a success."],
    acceptanceCriteria: ["A dropped row is reported as a failure."],
    constraints: [],
  },
  practices: ["AcceptanceCriteria"],
  work: { instructions: [workInstruction] },
  review: { instructions: [reviewInstruction] },
};

const noFacts: RuntimeFacts = { changedFiles: [], handoff: [] };

/** A service whose policy, configuration store and fabric answer what a case is about. */
function serviceWith(
  calls: string[],
  resolved: ProfileResolved,
  placed: AttemptPlacementOutcome,
  read: ConfigurationRead = { read: "Configuration", configuration },
  facts: RuntimeFactsRead = { read: "Facts", facts: noFacts },
  brief?: DraftBrief,
): ExecutionSchedulerService {
  const policy: ExecutionPolicy = {
    routing: {
      routes: { Work: "InCluster", Evaluation: "InCluster" },
      projectRoutes: new Map(),
    },
    profileFor: () => Promise.resolve(resolved),
  };
  const placement: AttemptPlacementPort = {
    place: () => Promise.resolve(placed),
    cancel: (cancelled) => {
      calls.push(
        `cancelled:${cancelled.attempt}:${String(cancelled.generation)}`,
      );
      return Promise.resolve({ cancelled: "Accepted" });
    },
    observe: () => Promise.resolve({ observed: "Unfaulted" }),
    writeError: () => Promise.resolve({ written: "Written" }),
  };
  return {
    store: recordingStore(calls),
    placement,
    workerPools: {
      personal: () => {
        calls.push("personal");
        return Promise.resolve([]);
      },
    },
    access: anyAccess,
    policy,
    configurations: { configuration: () => Promise.resolve(read) },
    runtimeFacts: { facts: () => Promise.resolve(facts) },
    priorWorkReports: {
      reports: () =>
        Promise.resolve({ read: "Reports", reports: { reports: [] } }),
    },
    priorEvaluationReports: {
      reports: () =>
        Promise.resolve({ read: "Reports", reports: { reports: [] } }),
    },
    failedLanding: { landing: () => Promise.resolve({ read: "Landing" }) },
    readOnlyRepositories: {
      repositories: () =>
        Promise.resolve({ read: "Repositories", repositories: [] }),
    },
    northStar: { northStar: () => Promise.resolve({ read: "NorthStar" }) },
    dependencyDeliveries: {
      deliveries: () => Promise.resolve({ read: "Deliveries", deliveries: [] }),
    },
    ticketBriefs: { brief: () => Promise.resolve(brief) },
    bindings: { binding: () => Promise.resolve(undefined) },
    practices: blessedPracticeCatalog,
    pipelinePaths: [".forgejo/workflows/"],
    workerRuntime,
    poolMemoryMib: workerPoolMemoryMibDefault,
    config: executionSchedulerDefaults,
    ticketService: ticketServiceDefaults,
    finalizer: finalizerDefaults,
    metrics: silentSchedulerTelemetry,
  };
}

const runnable: ProfileResolved = {
  resolved: "Profile",
  profile: { profile: "standard", runtimeVersion: "1" },
  grant,
};

const placedOk: AttemptPlacementOutcome = {
  placed: "Placed",
  placement: asPlacementId("placement-one"),
};

test("ended attempts are removed before their cleanup debt is acknowledged", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    attemptsAwaitingCleanup: () => Promise.resolve([attempt]),
    attemptCleanupCompleted: (cleaned) => {
      calls.push(`cleaned:${cleaned.attempt}`);
      return Promise.resolve(true);
    },
  };
  assert.equal(await executionSchedulerCleanup({ ...service, store }), 1);
  assert.deepEqual(calls, ["cancelled:attempt-one:1", "cleaned:attempt-one"]);
});

test("failed external cleanup remains durable debt for the next pass", async () => {
  const service = serviceWith([], runnable, placedOk);
  let acknowledged = false;
  await assert.rejects(() =>
    executionSchedulerCleanup({
      ...service,
      store: {
        ...service.store,
        attemptsAwaitingCleanup: () => Promise.resolve([attempt]),
        attemptCleanupCompleted: () => {
          acknowledged = true;
          return Promise.resolve(true);
        },
      },
      placement: {
        ...service.placement,
        cancel: () => Promise.resolve({ cancelled: "Unavailable" }),
      },
    }),
  );
  assert.equal(acknowledged, false);
});

test("a placed attempt records its backend placement and nothing else", async () => {
  const calls: string[] = [];
  assert.equal(
    await executionSchedulerLaunch(
      serviceWith(calls, runnable, placedOk),
      epoch,
    ),
    1,
  );
  assert.deepEqual(calls, ["placed:placement-one"]);
});

test("an attempt is opened under the scheduler's runtime, whichever route its execution takes", async () => {
  for (const route of ["InCluster", "Pool"] as const) {
    const openings: AttemptOpening[] = [];
    const service = serviceWith([], runnable, placedOk);
    await executionSchedulerLaunch(
      {
        ...service,
        store: {
          ...service.store,
          unlaunched: () => Promise.resolve([{ ...execution, route }]),
          openAttempt: (opening) => {
            openings.push(opening);
            return Promise.resolve({ opened: "BackingOff" });
          },
        },
      },
      epoch,
    );
    assert.deepEqual(
      openings.map((opening) => opening.runtime),
      [workerRuntime],
      route,
    );
  }
});

test("independent backends substitute at the same placement port", async () => {
  const asked: string[] = [];
  const backend = (name: string): AttemptPlacementPort => ({
    place: (request) => {
      asked.push(
        `${name}:${request.requirementIdentity}:${request.profile.profile}:${String(request.generation)}`,
      );
      return Promise.resolve({
        placed: "Placed",
        placement: asPlacementId(`${name}-placement`),
      });
    },
    cancel: () => Promise.resolve({ cancelled: "Accepted" }),
    observe: () => Promise.resolve({ observed: "Unfaulted" }),
    writeError: () => Promise.resolve({ written: "Written" }),
  });
  for (const name of ["kubernetes", "registered-runner"]) {
    const service = serviceWith([], runnable, placedOk);
    assert.equal(
      await executionSchedulerLaunch(
        { ...service, placement: backend(name) },
        epoch,
      ),
      1,
    );
  }
  assert.deepEqual(asked, [
    "kubernetes:requirement-one:standard:1",
    "registered-runner:requirement-one:standard:1",
  ]);
});

test("a definitive policy denial blocks the execution and spends no retry", async () => {
  const calls: string[] = [];
  const service = serviceWith(
    calls,
    { resolved: "Denied", reason: "ExecutionPolicyDenied" },
    placedOk,
  );
  assert.equal(await executionSchedulerLaunch(service, epoch), 0);
  assert.deepEqual(calls, [
    "ended:Withdrawn:PolicyDenied",
    "blocked:ExecutionPolicyDenied",
  ]);
});

test("a block the completion boundary refuses is observed as an incident", async () => {
  const seen: string[] = [];
  const service = serviceWith(
    [],
    { resolved: "Denied", reason: "ExecutionPolicyDenied" },
    placedOk,
  );
  const store: ExecutionSchedulerStore = {
    ...service.store,
    blockExecution: () =>
      Promise.resolve({ blocked: "Conflicting", incident: "incident-one" }),
  };
  await executionSchedulerLaunch(
    {
      ...service,
      store,
      metrics: schedulerTelemetry(recordingMetrics(seen)),
    },
    epoch,
  );
  assert.deepEqual(seen, [
    "reaping:0",
    "attemptOpened:Opened",
    "attemptEnded:Withdrawn:PolicyDenied",
    "blocking:Conflicting:ExecutionPolicyDenied",
    "incident:ImpossibleState",
  ]);
});

test("a temporary policy hold blocks nothing and spends no retry", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, { resolved: "Unavailable" }, placedOk);
  assert.equal(await executionSchedulerLaunch(service, epoch), 0);
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
});

test("a pinned non-default requirement reaches placement unchanged", async () => {
  const placements: AttemptPlacement[] = [];
  const service = placingService([], placements);
  const overridden = {
    ...execution,
    requirement: { ...execution.requirement, image: "worker:v2" },
    requirementSource: "TaskKindDefault" as const,
  };
  const store: ExecutionSchedulerStore = {
    ...service.store,
    unlaunched: () => Promise.resolve([overridden]),
  };
  assert.equal(await executionSchedulerLaunch({ ...service, store }, epoch), 1);
  assert.deepEqual(placements[0]?.requirement, overridden.requirement);
  assert.equal(
    placements[0]?.requirementIdentity,
    overridden.requirementIdentity,
  );
  assert.equal(placements[0]?.requirementDigest, overridden.requirementDigest);
});

test("an execution's size reaches placement as it was released, and one with none places none", async () => {
  const placements: AttemptPlacement[] = [];
  const service = placingService([], placements);
  const sized = { ...execution, resources: { cpuMillis: 8_000 } };
  for (const unlaunched of [sized, execution]) {
    const store: ExecutionSchedulerStore = {
      ...service.store,
      unlaunched: () => Promise.resolve([unlaunched]),
    };
    assert.equal(
      await executionSchedulerLaunch({ ...service, store }, epoch),
      1,
    );
  }
  assert.equal(placements.length, 2);
  assert.deepEqual(placements[0]?.resources, sized.resources);
  assert.equal(Object.hasOwn(placements[1] ?? {}, "resources"), false);
});

test("a definitive placement denial blocks the execution", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, {
    placed: "Denied",
    reason: "ExecutionProfileUnavailable",
  });
  assert.equal(await executionSchedulerLaunch(service, epoch), 0);
  assert.deepEqual(calls, [
    "ended:Withdrawn:PlacementDenied",
    "blocked:ExecutionProfileUnavailable",
  ]);
});

test("an unavailable fabric is a hold rather than a domain failure", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, { placed: "Unavailable" });
  assert.equal(await executionSchedulerLaunch(service, epoch), 0);
  assert.deepEqual(calls, ["ended:Withdrawn:PlacementUnavailable"]);
});

test("a spent retry budget terminalizes rather than placing again", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    openAttempt: () => Promise.resolve({ opened: "RetriesExhausted" }),
  };
  assert.equal(await executionSchedulerLaunch({ ...service, store }, epoch), 0);
  assert.deepEqual(calls, ["retriesExhausted"]);
});

test("an execution whose attempt a pool claimed is concluded rather than opened again", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    openAttempt: () => Promise.resolve({ opened: "AssignmentEnded" }),
  };
  assert.equal(await executionSchedulerLaunch({ ...service, store }, epoch), 0);
  assert.deepEqual(calls, ["assignmentEnded"]);
});

test("an execution whose last attempt's run ended on a failed step is concluded rather than opened again", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    openAttempt: () => Promise.resolve({ opened: "StepFailed" }),
  };
  assert.equal(await executionSchedulerLaunch({ ...service, store }, epoch), 0);
  assert.deepEqual(calls, ["stepFailed"]);
});

test("an evaluation that carries an earlier verdict is settled on it and placed nowhere", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    openAttempt: () =>
      Promise.resolve({
        opened: "Carried",
        source: asExecutionId("execution-earlier"),
      }),
  };
  assert.equal(await executionSchedulerLaunch({ ...service, store }, epoch), 0);
  assert.deepEqual(calls, [
    `carryVerdict:${execution.execution}:execution-earlier`,
  ]);
});

test("an execution inside its placement backoff is left alone", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    openAttempt: () => Promise.resolve({ opened: "BackingOff" }),
  };
  assert.equal(await executionSchedulerLaunch({ ...service, store }, epoch), 0);
  assert.deepEqual(calls, []);
});

test("admission stops at the first refusal rather than spinning to its bound", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  let asked = 0;
  const store: ExecutionSchedulerStore = {
    ...service.store,
    admit: () => {
      asked += 1;
      return Promise.resolve(
        asked <= 2
          ? { admitted: "Admitted", execution: execution.execution }
          : { admitted: "AccountAtMaximum" },
      );
    },
  };
  assert.equal(
    await executionSchedulerAdmit({ ...service, store }, cluster),
    2,
  );
  assert.equal(asked, 3);
});

/** One claimed cancellation request, which is all the cancellation cases start from. */
const cancelClaim: RequestClaim = {
  partition,
  request: "2:0:CancelTask",
  kind: "CancelTicketWork",
  ticket: asTicketId(1),
  authorizingSeq: 2,
  generation: 1,
  owner,
};

/** A store whose one claimed cancellation request answers what a case is about. */
function cancellingStore(
  calls: string[],
  registered: CancellationRegistered,
): ExecutionSchedulerStore {
  return {
    ...recordingStore(calls),
    claimRequests: (_owner, kinds) => {
      calls.push(`claimed:${kinds.join(",")}`);
      return Promise.resolve(
        kinds.includes("CancelTicketWork") ? [cancelClaim] : [],
      );
    },
    registerCancellation: () => {
      calls.push("cancelled");
      return Promise.resolve(registered);
    },
  };
}

test("a registered cancellation asks the backend to cancel every fenced generation", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store = cancellingStore(calls, {
    cancelled: "Registered",
    fenced: 2,
    placements: [
      { ...attempt, attempt: asAttemptId("attempt-one") },
      { ...attempt, attempt: asAttemptId("attempt-two") },
    ],
  });
  assert.equal(await executionSchedulerCancel({ ...service, store }, owner), 2);
  assert.deepEqual(calls, [
    "claimed:CancelTicketWork",
    "cancelled",
    "cancelled:attempt-one:1",
    "cancelled:attempt-two:1",
  ]);
});

test("a cancellation already fulfilled retires nothing and deletes nothing", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store = cancellingStore(calls, { cancelled: "AlreadyFulfilled" });
  assert.equal(await executionSchedulerCancel({ ...service, store }, owner), 0);
  assert.deepEqual(calls, ["claimed:CancelTicketWork", "cancelled"]);
});

test("a pass fences the older epoch before it moves anything else", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    claimRequests: (_owner, kinds) => {
      calls.push(`claimed:${kinds.join(",")}`);
      return Promise.resolve([]);
    },
    admit: () => {
      calls.push("admitted");
      return Promise.resolve({ admitted: "ClusterFull" });
    },
    attemptsAwaitingObservation: () => {
      calls.push("observing");
      return Promise.resolve([]);
    },
    waitingAttempts: () => {
      calls.push("waiting");
      return Promise.resolve([]);
    },
    reapLapsedAttempts: () => {
      calls.push("reaped");
      return Promise.resolve(0);
    },
    unlaunched: () => {
      calls.push("unlaunched");
      return Promise.resolve([]);
    },
    runnerLostTickets: () => {
      calls.push("lost");
      return Promise.resolve([]);
    },
    rateLimitedTickets: () => {
      calls.push("rate-limited");
      return Promise.resolve([]);
    },
  };
  assert.deepEqual(
    await executionSchedulerPass({ ...service, store }, owner, epoch, cluster),
    {
      fenced: 0,
      cleaned: 0,
      registered: 0,
      cancelled: 0,
      admitted: 0,
      observed: 0,
      placed: 0,
      resumed: 0,
      notices: [],
    },
  );
  assert.deepEqual(calls, [
    "fenced",
    "claimed:CancelTicketWork",
    "claimed:SpawnWork,SpawnEvaluation",
    "admitted",
    "observing",
    "waiting",
    "reaped",
    "unlaunched",
    "lost",
    "rate-limited",
  ]);
});

/** A service whose pass fences, cancels, registers, admits and launches once each. */
function passService(calls: string[]): ExecutionSchedulerService {
  const service = serviceWith(calls, runnable, placedOk);
  let admitted = 0;
  const store: ExecutionSchedulerStore = {
    ...cancellingStore(calls, {
      cancelled: "Registered",
      fenced: 3,
      placements: [
        { ...attempt, attempt: asAttemptId("attempt-one") },
        { ...attempt, attempt: asAttemptId("attempt-two") },
      ],
    }),
    fenceOldEpochAttempts: () => Promise.resolve(4),
    claimRequests: (_owner, kinds) =>
      Promise.resolve(
        kinds.includes("CancelTicketWork")
          ? [cancelClaim]
          : [{ ...cancelClaim, kind: "SpawnWork" as const }],
      ),
    admit: () => {
      admitted += 1;
      return Promise.resolve(
        admitted === 1
          ? { admitted: "Admitted", execution: execution.execution }
          : { admitted: "ClusterFull" },
      );
    },
    runnerLostTickets: () =>
      Promise.resolve([{ partition, ticket: execution.ticket }]),
    rateLimitedTickets: () =>
      Promise.resolve([{ partition, ticket: asTicketId(2) }]),
    resumeRateLimit: () =>
      Promise.resolve({
        resumed: "Submitted",
        operation: asOperationId("resume-rate-limit"),
      }),
  };
  return { ...service, store };
}

test("a pass reports the count each of its steps moved", async () => {
  assert.deepEqual(
    await executionSchedulerPass(passService([]), owner, epoch, cluster),
    {
      fenced: 4,
      cleaned: 0,
      registered: 1,
      cancelled: 3,
      admitted: 1,
      observed: 0,
      placed: 1,
      resumed: 2,
      notices: [],
    },
  );
});

test("a lost ticket is resumed under the retry budget and the mailbox's bounds, and only an answer the mailbox took counts", async () => {
  const asked: string[] = [];
  const answers: readonly RunnerLossResumed[] = [
    { resumed: "Submitted", operation: asOperationId("resume-one") },
    { resumed: "AlreadySubmitted", operation: asOperationId("resume-two") },
    { resumed: "NotResumable" },
    { resumed: "Backpressure" },
  ];
  const service = serviceWith([], runnable, placedOk);
  const config = {
    ...executionSchedulerDefaults,
    attemptRetriesMax: 5,
    resumesPerPassMax: 7,
  };
  const lost = answers.map((_answer, index) => ({
    partition,
    ticket: asTicketId(index + 1),
  }));
  const store: ExecutionSchedulerStore = {
    ...service.store,
    runnerLostTickets: (lossesMax, ticketsMax) => {
      asked.push(`lost:${String(lossesMax)}:${String(ticketsMax)}`);
      return Promise.resolve(lost);
    },
    resumeRunnerLoss: (resume) => {
      asked.push(
        `resume:${String(resume.ticket.ticket)}:${String(resume.lossesMax)}`,
      );
      assert.deepEqual(resume.mailbox, ticketServiceDefaults);
      const answer = answers[resume.ticket.ticket - 1];
      assert.ok(answer !== undefined);
      return Promise.resolve(answer);
    },
  };
  assert.equal(
    await executionSchedulerResume({ ...service, store, config }),
    1,
  );
  assert.deepEqual(asked, [
    "lost:5:7",
    "resume:1:5",
    "resume:2:5",
    "resume:3:5",
    "resume:4:5",
  ]);
});

test("a rate-limited ticket is resumed after the lost ones, under both bounds and the mailbox's, and only an answer the mailbox took counts", async () => {
  const asked: string[] = [];
  const answers: readonly RunnerLossResumed[] = [
    { resumed: "Submitted", operation: asOperationId("resume-one") },
    { resumed: "Submitted", operation: asOperationId("resume-two") },
    { resumed: "NotResumable" },
    { resumed: "NotAdmitted" },
  ];
  const service = serviceWith([], runnable, placedOk);
  const config = {
    ...executionSchedulerDefaults,
    attemptRetriesMax: 5,
    attemptRateLimitsMax: 4,
    resumesPerPassMax: 7,
  };
  const store: ExecutionSchedulerStore = {
    ...service.store,
    runnerLostTickets: (lossesMax, ticketsMax) => {
      asked.push(`lost:${String(lossesMax)}:${String(ticketsMax)}`);
      return Promise.resolve([{ partition, ticket: asTicketId(1) }]);
    },
    resumeRunnerLoss: (resume) => {
      asked.push(`resume-lost:${String(resume.ticket.ticket)}`);
      return Promise.resolve(answers[0] ?? { resumed: "NotResumable" });
    },
    rateLimitedTickets: (lossesMax, rateLimitsMax, ticketsMax) => {
      asked.push(
        `rate-limited:${String(lossesMax)}:${String(rateLimitsMax)}:${String(ticketsMax)}`,
      );
      return Promise.resolve(
        [2, 3, 4].map((ticket) => ({ partition, ticket: asTicketId(ticket) })),
      );
    },
    resumeRateLimit: (resume) => {
      asked.push(
        `resume-rate-limited:${String(resume.ticket.ticket)}:${String(resume.lossesMax)}:${String(resume.rateLimitsMax)}`,
      );
      assert.deepEqual(resume.mailbox, ticketServiceDefaults);
      const answer = answers[resume.ticket.ticket - 1];
      assert.ok(answer !== undefined);
      return Promise.resolve(answer);
    },
  };
  assert.equal(
    await executionSchedulerResume({ ...service, store, config }),
    2,
  );
  assert.deepEqual(asked, [
    "lost:5:7",
    "resume-lost:1",
    "rate-limited:5:4:7",
    "resume-rate-limited:2:5:4",
    "resume-rate-limited:3:5:4",
    "resume-rate-limited:4:5:4",
  ]);
});

test("a pass observes every step it took, in the order it took them", async () => {
  const seen: string[] = [];
  const service = passService([]);
  await executionSchedulerPass(
    { ...service, metrics: schedulerTelemetry(recordingMetrics(seen)) },
    owner,
    epoch,
    cluster,
  );
  assert.deepEqual(seen, [
    "fencing:Epoch:4",
    "cancellation:Registered",
    "fencing:Cancellation:2",
    "registration:Registered",
    "admission:Admitted",
    "admission:ClusterFull",
    "reaping:0",
    "attemptOpened:Opened",
    "placement:Placed",
  ]);
});

test("a sink that fails at every observation moves exactly what a silent one moves", async () => {
  const quiet: string[] = [];
  const loud: string[] = [];
  const thrown: string[] = [];
  const quietReport = await executionSchedulerPass(
    passService(quiet),
    owner,
    epoch,
    cluster,
  );
  const service = passService(loud);
  const loudReport = await executionSchedulerPass(
    { ...service, metrics: schedulerTelemetry(throwingMetrics(thrown)) },
    owner,
    epoch,
    cluster,
  );
  assert.ok(thrown.length > 0, "no observation failed, so this proves nothing");
  assert.deepEqual(loudReport, quietReport);
  assert.deepEqual(loud, quiet);
});

test("a definitive denial is observed as one ended attempt and one retired task", async () => {
  const seen: string[] = [];
  const service = serviceWith(
    [],
    { resolved: "Denied", reason: "ExecutionPolicyDenied" },
    placedOk,
  );
  await executionSchedulerLaunch(
    { ...service, metrics: schedulerTelemetry(recordingMetrics(seen)) },
    epoch,
  );
  assert.deepEqual(seen, [
    "reaping:0",
    "attemptOpened:Opened",
    "attemptEnded:Withdrawn:PolicyDenied",
    "blocking:Blocked:ExecutionPolicyDenied",
  ]);
});

test("the fencing observation counts attempts where the report counts tasks", async () => {
  const seen: string[] = [];
  const service = serviceWith([], runnable, placedOk);
  const store = cancellingStore([], {
    cancelled: "Registered",
    fenced: 3,
    placements: [
      { ...attempt, attempt: asAttemptId("attempt-one") },
      { ...attempt, attempt: asAttemptId("attempt-two") },
    ],
  });
  const cancelled = await executionSchedulerCancel(
    { ...service, store, metrics: schedulerTelemetry(recordingMetrics(seen)) },
    owner,
  );
  assert.equal(cancelled, 3);
  assert.deepEqual(seen, ["cancellation:Registered", "fencing:Cancellation:2"]);
});

test("each sweep is asked for at most the count a pass is configured to take", async () => {
  const swept: string[] = [];
  const service = passService([]);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    fenceOldEpochAttempts: (_epoch, attemptsMax) => {
      swept.push(`fence:${String(attemptsMax)}`);
      return Promise.resolve(0);
    },
    attemptsAwaitingObservation: (_epoch, attemptsMax) => {
      swept.push(`observe:${String(attemptsMax)}`);
      return Promise.resolve([]);
    },
    waitingAttempts: (_epoch, attemptsMax) => {
      swept.push(`waiting:${String(attemptsMax)}`);
      return Promise.resolve([]);
    },
    reapLapsedAttempts: (_epoch, attemptsMax) => {
      swept.push(`reap:${String(attemptsMax)}`);
      return Promise.resolve(0);
    },
  };
  const bound = String(executionSchedulerDefaults.attemptsPerPassMax);
  await executionSchedulerPass({ ...service, store }, owner, epoch, cluster);
  assert.deepEqual(swept, [
    `fence:${bound}`,
    `observe:${bound}`,
    `waiting:${bound}`,
    `reap:${bound}`,
  ]);
});

test("a pass refuses a configuration that reserves no room for its completions", async () => {
  const service = passService([]);
  await assert.rejects(
    executionSchedulerPass(
      {
        ...service,
        config: { ...executionSchedulerDefaults, projectBacklogMax: 100_000 },
      },
      owner,
      epoch,
      cluster,
    ),
    RangeError,
  );
});

test("a placement the durable row would not take is cancelled at its backend", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    attemptPlaced: (_attempt, workload) => {
      calls.push(`placed:${workload}`);
      return Promise.resolve(false);
    },
  };
  assert.equal(await executionSchedulerLaunch({ ...service, store }, epoch), 0);
  assert.deepEqual(calls, ["placed:placement-one", "cancelled:attempt-one:1"]);
});

test("an attempt's invocation is recorded before it is placed, as its placement carries it", async () => {
  const calls: string[] = [];
  const recorded: WorkTaskInvocation[] = [];
  const placements: AttemptPlacement[] = [];
  const service = placingService(calls, placements);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    attemptInvoked: (invoked, invocation) => {
      calls.push(`invoked:${invoked.attempt}:${String(invoked.generation)}`);
      recorded.push(invocation);
      return Promise.resolve(true);
    },
  };
  const placement: AttemptPlacementPort = {
    ...service.placement,
    place: (placing) => {
      calls.push("place");
      return service.placement.place(placing);
    },
  };
  assert.equal(
    await executionSchedulerLaunch({ ...service, store, placement }, epoch),
    1,
  );
  assert.deepEqual(calls, [
    "invoked:attempt-one:1",
    "place",
    "placed:placement-one",
  ]);
  const placed = placements[0];
  assert.ok(placed !== undefined);
  const { templateVersion, purpose, text } = placed.invocation.briefing;
  assert.deepEqual(recorded, [
    {
      profile: runnable.profile,
      briefing: { templateVersion, purpose, text },
      authority: taskAuthorityGrant(placed.invocation.authority),
      credentialsListed: placed.invocation.credentialsListed,
    },
  ]);
});

test("an attempt whose invocation the durable row would not take is never placed", async () => {
  const calls: string[] = [];
  const placements: AttemptPlacement[] = [];
  const service = placingService(calls, placements);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    attemptInvoked: () => Promise.resolve(false),
  };
  assert.equal(await executionSchedulerLaunch({ ...service, store }, epoch), 0);
  assert.deepEqual(placements, []);
  assert.deepEqual(calls, []);
});

test("registration claims only spawn kinds and counts what it created", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const kinds: string[][] = [];
  const store: ExecutionSchedulerStore = {
    ...service.store,
    claimRequests: (_owner, claimed) => {
      kinds.push([...claimed]);
      return Promise.resolve([
        {
          partition,
          request: "1:0:ExecuteTask",
          kind: "SpawnWork",
          ticket: asTicketId(1),
          authorizingSeq: 1,
          generation: 1,
          owner,
        },
      ]);
    },
  };
  assert.equal(
    await executionSchedulerRegister({ ...service, store }, owner),
    1,
  );
  assert.deepEqual(kinds, [["SpawnWork", "SpawnEvaluation"]]);
});

test("registration writes each project the routes the policy resolves for it, and no other project's", async () => {
  const service = serviceWith([], runnable, placedOk);
  const elsewhere = { ...partition, project: asProjectId("project-two") };
  const otherTenant = { ...partition, tenant: asTenantId("tenant-two") };
  const unnamed = {
    tenant: asTenantId("tenant-three"),
    project: asProjectId("project-three"),
  };
  const routing: ExecutionRouting = {
    routes: { Work: "InCluster", Evaluation: "Pool" },
    projectRoutes: new Map([
      [
        partition.tenant,
        new Map([
          [partition.project, { Work: "Pool" as const }],
          [elsewhere.project, { Evaluation: "InCluster" as const }],
        ]),
      ],
      [otherTenant.tenant, new Map([[partition.project, {}]])],
    ]),
  };
  const written: string[] = [];
  const store: ExecutionSchedulerStore = {
    ...service.store,
    claimRequests: () =>
      Promise.resolve(
        [partition, elsewhere, otherTenant, unnamed].map((claimed) => ({
          partition: claimed,
          request: "1:0:ExecuteTask",
          kind: "SpawnWork" as const,
          ticket: asTicketId(1),
          authorizingSeq: 1,
          generation: 1,
          owner,
        })),
      ),
    registerSpawn: (claim, _tasksMax, routes) => {
      written.push(
        `${claim.partition.tenant}/${claim.partition.project}:${routes.Work}:${routes.Evaluation}`,
      );
      return Promise.resolve({ registered: "Registered", created: 1 });
    },
  };
  assert.equal(
    await executionSchedulerRegister(
      { ...service, store, policy: { ...service.policy, routing } },
      owner,
    ),
    4,
  );
  assert.deepEqual(written, [
    "tenant/project:Pool:Pool",
    "tenant/project-two:InCluster:InCluster",
    "tenant-two/project:InCluster:Pool",
    "tenant-three/project-three:InCluster:Pool",
  ]);
});

test("registration reads each project's own placement, which an override outranks and which outranks the default", async () => {
  const service = serviceWith([], runnable, placedOk);
  const placed = { ...partition, project: asProjectId("placed") };
  const overridden = { ...partition, project: asProjectId("overridden") };
  const unplaced = { ...partition, project: asProjectId("unplaced") };
  const routing: ExecutionRouting = {
    routes: { Work: "Pool", Evaluation: "Pool" },
    projectRoutes: new Map([
      [
        partition.tenant,
        new Map([[overridden.project, { Work: "Pool" as const }]]),
      ],
    ]),
  };
  const asked: string[] = [];
  const written: string[] = [];
  const store: ExecutionSchedulerStore = {
    ...service.store,
    claimRequests: () =>
      Promise.resolve(
        [placed, overridden, unplaced].map((claimed) => ({
          partition: claimed,
          request: "1:0:ExecuteTask",
          kind: "SpawnWork" as const,
          ticket: asTicketId(1),
          authorizingSeq: 1,
          generation: 1,
          owner,
        })),
      ),
    projectPlacement: (claimed) => {
      asked.push(claimed.project);
      return Promise.resolve(
        claimed.project === unplaced.project
          ? undefined
          : { Work: "InCluster", Evaluation: "InCluster" },
      );
    },
    registerSpawn: (claim, _tasksMax, routes) => {
      written.push(
        `${claim.partition.project}:${routes.Work}:${routes.Evaluation}`,
      );
      return Promise.resolve({ registered: "Registered", created: 1 });
    },
  };
  assert.equal(
    await executionSchedulerRegister(
      { ...service, store, policy: { ...service.policy, routing } },
      owner,
    ),
    3,
  );
  assert.deepEqual(asked, ["placed", "overridden", "unplaced"]);
  assert.deepEqual(written, [
    "placed:InCluster:InCluster",
    "overridden:Pool:InCluster",
    "unplaced:Pool:Pool",
  ]);
});

/** A service that keeps every placement it was asked for, so a briefing can be read back. */
function placingService(
  calls: string[],
  into: AttemptPlacement[],
  read: ConfigurationRead = { read: "Configuration", configuration },
  facts: RuntimeFactsRead = { read: "Facts", facts: noFacts },
  brief?: DraftBrief,
): ExecutionSchedulerService {
  const service = serviceWith(calls, runnable, placedOk, read, facts, brief);
  return {
    ...service,
    placement: {
      ...service.placement,
      place: (placement) => {
        into.push(placement);
        return Promise.resolve(placedOk);
      },
    },
  };
}

test("a launched worker is handed the briefing its pinned revision composes to", async () => {
  const placements: AttemptPlacement[] = [];
  await executionSchedulerLaunch(placingService([], placements), epoch);
  const placement = placements[0];
  assert.ok(placement !== undefined);
  assert.equal(placement.invocation.briefing.purpose, "Work");
  assert.equal(
    placement.invocation.provenance.configurationRevision,
    execution.configurationRevision,
  );
  assert.ok(
    placement.invocation.briefing.text.includes(
      "A dropped row is reported as a failure.",
    ),
  );
  assert.ok(placement.invocation.briefing.text.includes(workInstruction));
  assert.equal(
    placement.invocation.briefing.text.includes(reviewInstruction),
    false,
  );
});

test("an evaluation task is briefed from the block matching its placement stage", async () => {
  const placements: AttemptPlacement[] = [];
  const stageInstruction = "Run the command suite.";
  const stagedConfiguration: PinnedTaskConfiguration = {
    ...configuration,
    evaluations: [
      {
        purpose: "Review",
        instructions: [reviewInstruction],
        practices: ["ChangedCallPaths"],
      },
      {
        purpose: "Check",
        instructions: [stageInstruction],
        practices: ["AcceptanceCriteria"],
      },
    ],
  };
  const service = placingService([], placements, {
    read: "Configuration",
    configuration: stagedConfiguration,
  });
  const store: ExecutionSchedulerStore = {
    ...service.store,
    unlaunched: () =>
      Promise.resolve([{ ...execution, taskKind: "Evaluation", stage: 1 }]),
  };
  await executionSchedulerLaunch({ ...service, store }, epoch);
  const placement = placements[0];
  assert.ok(placement !== undefined);
  const briefing = placement.invocation.briefing;
  assert.equal(placement.stage, 1);
  assert.equal(briefing.purpose, "Check");
  assert.ok(briefing.text.includes(stageInstruction));
  assert.equal(briefing.text.includes(reviewInstruction), false);
  assert.equal(briefing.text.includes(workInstruction), false);
  assert.deepEqual(placement.invocation.provenance.practices, [
    "AcceptanceCriteria",
  ]);
});

test("a code review receives the prior work report without giving it to the check stage", async () => {
  const placements: AttemptPlacement[] = [];
  const reports = ["Changed the parser and ran its focused test."];
  const service = {
    ...placingService([], placements, {
      read: "Configuration" as const,
      configuration: {
        ...configuration,
        evaluations: [
          {
            purpose: "Review" as const,
            instructions: [reviewInstruction],
            practices: ["ChangedCallPaths"],
          },
          {
            purpose: "Check" as const,
            instructions: ["Run the command suite."],
            practices: ["AcceptanceCriteria"],
          },
        ],
      },
    }),
    priorWorkReports: {
      reports: () =>
        Promise.resolve({ read: "Reports" as const, reports: { reports } }),
    },
  };
  const reviewStore: ExecutionSchedulerStore = {
    ...service.store,
    unlaunched: () =>
      Promise.resolve([{ ...execution, taskKind: "Evaluation", stage: 0 }]),
  };
  await executionSchedulerLaunch({ ...service, store: reviewStore }, epoch);
  assert.ok(placements[0]?.invocation.briefing.text.includes(reports[0] ?? ""));
  placements.length = 0;
  const checkStore: ExecutionSchedulerStore = {
    ...service.store,
    unlaunched: () =>
      Promise.resolve([{ ...execution, taskKind: "Evaluation", stage: 1 }]),
  };
  await executionSchedulerLaunch({ ...service, store: checkStore }, epoch);
  assert.equal(
    placements[0]?.invocation.briefing.text.includes(reports[0] ?? ""),
    false,
  );
});

test("a launched worker holds no authority to complete its own task", async () => {
  const placements: AttemptPlacement[] = [];
  await executionSchedulerLaunch(placingService([], placements), epoch);
  const authority = placements[0]?.invocation.authority;
  assert.ok(authority !== undefined);
  assert.equal(grant.mayCompleteTask, true);
  assert.equal(taskAuthorityGrant(authority).mayCompleteTask, false);
});

test("the configuration is asked for by the revision the execution pinned", async () => {
  const asked: ConfigurationPin[] = [];
  const service = serviceWith([], runnable, placedOk);
  const configurations = {
    configuration: (_partition: unknown, pin: ConfigurationPin) => {
      asked.push(pin);
      return Promise.resolve<ConfigurationRead>({
        read: "Configuration",
        configuration,
      });
    },
  };
  await executionSchedulerLaunch({ ...service, configurations }, epoch);
  assert.deepEqual(
    asked.map((pin) => [pin.configurationRevision, pin.configurationDigest]),
    [[execution.configurationRevision, execution.configurationDigest]],
  );
});

test("a second attempt renders the briefing the first one was given", async () => {
  const placements: AttemptPlacement[] = [];
  const service = placingService([], placements);
  await executionSchedulerLaunch(service, epoch);
  await executionSchedulerLaunch(service, epoch);
  assert.equal(placements.length, 2);
  assert.equal(
    placements[0]?.invocation.briefing.text,
    placements[1]?.invocation.briefing.text,
  );
});

test("a pinned revision that is gone blocks the ticket as incompatible", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk, { read: "Missing" });
  assert.equal(await executionSchedulerLaunch(service, epoch), 0);
  assert.deepEqual(calls, [
    "ended:Withdrawn:PolicyDenied",
    "blocked:TicketConfigIncompatible",
  ]);
});

test("a pinned revision with incompatible authored content blocks the ticket", async () => {
  const calls: string[] = [];
  const seen: string[] = [];
  const service = serviceWith(calls, runnable, placedOk, {
    read: "Incompatible",
    fault: "BriefingShapeMissing",
  });
  assert.equal(
    await executionSchedulerLaunch(
      { ...service, metrics: schedulerTelemetry(recordingMetrics(seen)) },
      epoch,
    ),
    0,
  );
  assert.deepEqual(calls, [
    "ended:Withdrawn:PolicyDenied: BriefingShapeMissing",
    "blocked:TicketConfigIncompatible",
  ]);
  assert.ok(seen.includes("briefing:BriefingShapeMissing"));
});

test("an authoring store that cannot be read holds the attempt instead", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk, {
    read: "Unavailable",
  });
  assert.equal(await executionSchedulerLaunch(service, epoch), 0);
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
});

test("runtime facts that cannot be gathered hold the attempt instead", async () => {
  const calls: string[] = [];
  const service = serviceWith(
    calls,
    runnable,
    placedOk,
    { read: "Configuration", configuration },
    { read: "Unavailable" },
  );
  assert.equal(await executionSchedulerLaunch(service, epoch), 0);
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
});

test("the project's other repositories that cannot be read hold the attempt instead", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  assert.equal(
    await executionSchedulerLaunch(
      {
        ...service,
        readOnlyRepositories: {
          repositories: () => Promise.resolve({ read: "Unavailable" as const }),
        },
      },
      epoch,
    ),
    0,
  );
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
});

test("the project's other repositories read for this execution reach its briefing as read-only", async () => {
  const placements: AttemptPlacement[] = [];
  const asked: unknown[] = [];
  const sibling = asRepositoryId("https://github.com/mimage/argus.git");
  await executionSchedulerLaunch(
    {
      ...placingService([], placements),
      readOnlyRepositories: {
        repositories: (partitionRead, executionRead) => {
          asked.push({ partition: partitionRead, execution: executionRead });
          return Promise.resolve({
            read: "Repositories" as const,
            repositories: [sibling],
          });
        },
      },
    },
    epoch,
  );
  assert.deepEqual(asked, [{ partition, execution: execution.execution }]);
  assert.ok(
    placements[0]?.invocation.briefing.text.includes(
      `${briefingLabels.readOnlyRepositories} ${sibling}`,
    ),
  );
});

test("a project's North Star that cannot be read holds the attempt instead", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  assert.equal(
    await executionSchedulerLaunch(
      {
        ...service,
        northStar: {
          northStar: () => Promise.resolve({ read: "Unavailable" as const }),
        },
      },
      epoch,
    ),
    0,
  );
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
});

test("the North Star read for this execution's project reaches its briefing", async () => {
  const placements: AttemptPlacement[] = [];
  const asked: unknown[] = [];
  await executionSchedulerLaunch(
    {
      ...placingService([], placements),
      northStar: {
        northStar: (partitionRead) => {
          asked.push(partitionRead);
          return Promise.resolve({
            read: "NorthStar" as const,
            northStar: "plain Python with no dependencies",
          });
        },
      },
    },
    epoch,
  );
  assert.deepEqual(asked, [partition]);
  assert.ok(
    placements[0]?.invocation.briefing.text.includes(
      "plain Python with no dependencies",
    ),
  );
});

/** What one launch is placed with where its own binding is read as `pipelinesWritable` and its forge names `pipelinePaths`. */
async function pushPathsPlaced(
  pipelinesWritable: boolean | undefined,
  pipelinePaths: readonly string[],
): Promise<AttemptPlacement> {
  const placements: AttemptPlacement[] = [];
  await executionSchedulerLaunch(
    {
      ...placingService([], placements),
      pipelinePaths,
      readOnlyRepositories: {
        repositories: () =>
          Promise.resolve({
            read: "Repositories" as const,
            repositories: [],
            ...(pipelinesWritable === undefined ? {} : { pipelinesWritable }),
          }),
      },
    },
    epoch,
  );
  assert.equal(placements.length, 1);
  const [placed] = placements;
  assert.ok(placed !== undefined);
  return placed;
}

test("a work task whose binding withholds pipelines names its forge's pipeline paths in its task and its briefing", async () => {
  const forgejo = [".forgejo/workflows/"];
  const placed = await pushPathsPlaced(false, forgejo);
  assert.deepEqual(placed.pushPathsRefused, forgejo);
  assert.deepEqual(workTaskInvocation(placed).pushPathsRefused, forgejo);
  const [line] = briefingPipelinesUnwritable(forgejo);
  assert.ok(line !== undefined);
  assert.ok(placed.invocation.briefing.text.includes(line));
  assert.ok(!placed.invocation.briefing.text.includes(".github/"));
});

test("a work task whose binding allows pipelines, is not bound live, or whose forge names no pipeline path names no path and is told of none", async () => {
  for (const [pipelinesWritable, pipelinePaths] of [
    [true, [".forgejo/workflows/"]],
    [undefined, [".forgejo/workflows/"]],
    [false, []],
  ] as const) {
    const placed = await pushPathsPlaced(pipelinesWritable, pipelinePaths);
    const at = `${String(pipelinesWritable)} with ${String(pipelinePaths.length)} paths`;
    assert.ok(!Object.hasOwn(placed, "pushPathsRefused"), at);
    assert.ok(
      !Object.hasOwn(workTaskInvocation(placed), "pushPathsRefused"),
      at,
    );
    assert.ok(
      !placed.invocation.briefing.text.includes(
        "its repository's binding does not let it write pipelines",
      ),
      at,
    );
  }
});

test("what the dependencies delivered, when it cannot be read, holds the attempt instead", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  assert.equal(
    await executionSchedulerLaunch(
      {
        ...service,
        dependencyDeliveries: {
          deliveries: () => Promise.resolve({ read: "Unavailable" as const }),
        },
      },
      epoch,
    ),
    0,
  );
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
});

test("what the dependencies delivered, read for this execution, reaches its briefing", async () => {
  const placements: AttemptPlacement[] = [];
  const asked: unknown[] = [];
  await executionSchedulerLaunch(
    {
      ...placingService([], placements),
      dependencyDeliveries: {
        deliveries: (partitionRead, executionRead) => {
          asked.push({ partition: partitionRead, execution: executionRead });
          return Promise.resolve({
            read: "Deliveries" as const,
            deliveries: [
              {
                dependency: asTicketId(12),
                title: "Teach the importer to count rows",
                change: { change: "Unsourced" as const },
                report: "The importer counts its rows.",
              },
            ],
          });
        },
      },
    },
    epoch,
  );
  assert.deepEqual(asked, [{ partition, execution: execution.execution }]);
  const text = placements[0]?.invocation.briefing.text ?? "";
  assert.ok(text.includes("Ticket 12: Teach the importer to count rows"), text);
  assert.ok(text.includes("- Report: The importer counts its rows."), text);
});

test("prior work reports that cannot be read hold the attempt instead", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  assert.equal(
    await executionSchedulerLaunch(
      {
        ...service,
        priorWorkReports: {
          reports: () => Promise.resolve({ read: "Unavailable" as const }),
        },
      },
      epoch,
    ),
    0,
  );
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
});

/**
 * Launches the work task and then an evaluation through one service, holding
 * that the named section and its text reach the work task alone and that its
 * port was asked for the work task alone.
 */
async function reworkSectionReachesWorkAlone(
  service: ExecutionSchedulerService,
  placements: AttemptPlacement[],
  asked: readonly string[],
  section: string,
  text: string,
): Promise<void> {
  await executionSchedulerLaunch(service, epoch);
  const briefing = placements[0]?.invocation.briefing;
  assert.ok(briefing !== undefined);
  assert.ok(briefing.text.includes(text));
  assert.ok(briefing.sections.some((each) => each.section === section));
  assert.deepEqual(asked, [execution.execution]);
  placements.length = 0;
  const evaluationStore: ExecutionSchedulerStore = {
    ...service.store,
    unlaunched: () =>
      Promise.resolve([{ ...execution, taskKind: "Evaluation", stage: 0 }]),
  };
  await executionSchedulerLaunch({ ...service, store: evaluationStore }, epoch);
  assert.equal(placements[0]?.invocation.briefing.text.includes(text), false);
  assert.deepEqual(asked, [execution.execution]);
}

test("a rework is handed the failed evaluation's reports and an evaluation is not", async () => {
  const placements: AttemptPlacement[] = [];
  const asked: string[] = [];
  const reports = [".chug/tasks/ci.sh exited 1; last output: format FAILED"];
  const service = {
    ...placingService([], placements),
    priorEvaluationReports: {
      reports: (_partition: unknown, execution: string) => {
        asked.push(execution);
        return Promise.resolve({
          read: "Reports" as const,
          reports: { reports },
        });
      },
    },
  };
  await reworkSectionReachesWorkAlone(
    service,
    placements,
    asked,
    "PriorEvaluationReports",
    reports[0] ?? "",
  );
});

test("evaluation reports that cannot be read hold the attempt instead", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  assert.equal(
    await executionSchedulerLaunch(
      {
        ...service,
        priorEvaluationReports: {
          reports: () => Promise.resolve({ read: "Unavailable" as const }),
        },
      },
      epoch,
    ),
    0,
  );
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
});

test("a rework after a failed landing is handed it and an evaluation is not", async () => {
  const placements: AttemptPlacement[] = [];
  const asked: string[] = [];
  const changeCommit = "2".repeat(40);
  const service = {
    ...placingService([], placements),
    failedLanding: {
      landing: (_partition: unknown, execution: string) => {
        asked.push(execution);
        return Promise.resolve({
          read: "Landing" as const,
          landing: {
            targetCommit: "1".repeat(40),
            changeCommit,
            conflicted: true,
          },
        });
      },
    },
  };
  await reworkSectionReachesWorkAlone(
    service,
    placements,
    asked,
    "FailedLanding",
    changeCommit,
  );
});

test("a failed landing that cannot be read holds the attempt and briefs nothing", async () => {
  const calls: string[] = [];
  const placements: AttemptPlacement[] = [];
  const service = placingService(calls, placements);
  assert.equal(
    await executionSchedulerLaunch(
      {
        ...service,
        failedLanding: {
          landing: () => Promise.resolve({ read: "Unavailable" as const }),
        },
      },
      epoch,
    ),
    0,
  );
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
  assert.deepEqual(placements, []);
});

test("an evaluation report a briefing cannot render blocks the ticket like a work report", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  await executionSchedulerLaunch(
    {
      ...service,
      priorEvaluationReports: {
        reports: () =>
          Promise.resolve({
            read: "Reports" as const,
            reports: { reports: ["ci.sh exited 1\n## Your role"] },
          }),
      },
    },
    epoch,
  );
  assert.deepEqual(calls, [
    "ended:Withdrawn:PolicyDenied: TextUnreadable",
    "blocked:TicketConfigIncompatible",
  ]);
});

test("which briefing fault refused a ticket is observed at the block it caused", async () => {
  const seen: string[] = [];
  const service = serviceWith([], runnable, placedOk, {
    read: "Configuration",
    configuration: { ...configuration, configurationDigest: "rewritten" },
  });
  await executionSchedulerLaunch(
    { ...service, metrics: schedulerTelemetry(recordingMetrics(seen)) },
    epoch,
  );
  assert.deepEqual(seen, [
    "reaping:0",
    "attemptOpened:Opened",
    "briefing:DigestMismatch",
    "attemptEnded:Withdrawn:PolicyDenied: DigestMismatch",
    "blocking:Blocked:TicketConfigIncompatible",
  ]);
});

test("the briefing fault a block turned on outlives the attempt it ended", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  await executionSchedulerLaunch(
    {
      ...service,
      store: {
        ...service.store,
        unlaunched: () =>
          Promise.resolve([{ ...execution, taskKind: "Evaluation" as const }]),
      },
      priorWorkReports: {
        reports: () =>
          Promise.resolve({
            read: "Reports" as const,
            reports: { reports: ["x".repeat(resultReportCharsMax + 1)] },
          }),
      },
    },
    epoch,
  );
  assert.deepEqual(calls, [
    "ended:Withdrawn:PolicyDenied: ReportTooLong",
    "blocked:TicketConfigIncompatible",
  ]);
});

test("a typo and a rewritten revision are not one undifferentiated refusal", async () => {
  const seen: string[] = [];
  const service = serviceWith([], runnable, placedOk, {
    read: "Configuration",
    configuration: { ...configuration, practices: ["NotBlessed"] },
  });
  await executionSchedulerLaunch(
    { ...service, metrics: schedulerTelemetry(recordingMetrics(seen)) },
    epoch,
  );
  assert.ok(seen.includes("briefing:UnknownPractice"));
  assert.equal(seen.includes("briefing:DigestMismatch"), false);
});

test("a practice no catalog blesses blocks the ticket rather than briefing without it", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk, {
    read: "Configuration",
    configuration: { ...configuration, practices: ["NotBlessed"] },
  });
  assert.equal(await executionSchedulerLaunch(service, epoch), 0);
  assert.deepEqual(calls, [
    "ended:Withdrawn:PolicyDenied: UnknownPractice",
    "blocked:TicketConfigIncompatible",
  ]);
});

/** The repository a landing brief names, and the binding a service answers for it alone. */
const landingRepository = asRepositoryId("https://example.test/landing.git");

/** A service briefing `brief`, recording each invocation and placement, whose binding read answers the landing repository alone. */
function landingService(
  brief: DraftBrief,
  placements: AttemptPlacement[],
  recorded: WorkTaskInvocation[],
): ExecutionSchedulerService {
  const service = placingService(
    [],
    placements,
    { read: "Configuration", configuration },
    { read: "Facts", facts: noFacts },
    brief,
  );
  return {
    ...service,
    store: {
      ...service.store,
      attemptInvoked: (_invoked, invocation) => {
        recorded.push(invocation);
        return Promise.resolve(true);
      },
    },
    bindings: {
      binding: (bound, repository) =>
        Promise.resolve(
          repository === landingRepository
            ? { partition: bound, repository, recoveryEpoch: epoch }
            : undefined,
        ),
    },
  };
}

/** What one launched work task's invocation recorded and its placement carried. */
async function landingLaunched(service: ExecutionSchedulerService): Promise<{
  readonly placed: AttemptPlacement;
  readonly invoked: WorkTaskInvocation;
}> {
  const placements: AttemptPlacement[] = [];
  const recorded: WorkTaskInvocation[] = [];
  const recording: ExecutionSchedulerService = {
    ...service,
    store: {
      ...service.store,
      attemptInvoked: (_invoked, invocation) => {
        recorded.push(invocation);
        return Promise.resolve(true);
      },
    },
    placement: {
      ...service.placement,
      place: (placement) => {
        placements.push(placement);
        return Promise.resolve(placedOk);
      },
    },
  };
  assert.equal(await executionSchedulerLaunch(recording, epoch), 1);
  const [placed] = placements;
  const [invoked] = recorded;
  assert.ok(placed !== undefined && invoked !== undefined);
  return { placed, invoked };
}

const landingBrief = asDraftBrief({
  intent: "Fix the importer.",
  links: [],
  repository: landingRepository,
  branch: "refs/heads/rt/ticket-brief",
  finalization: { mode: "Push", target: "refs/heads/release" },
});

/** The landing brief, finalized as `finalization` says instead. */
function landingBriefFinalized(finalization: {
  readonly mode: string;
  readonly target?: string;
}): DraftBrief {
  return asDraftBrief({
    intent: "Fix the importer.",
    links: [],
    repository: landingRepository,
    branch: "refs/heads/rt/ticket-brief",
    finalization,
  });
}

/** The landing brief's service, its task following a failed landing that recorded `changeCommit` where one is given. */
function landingReworkService(
  changeCommit?: string,
): ExecutionSchedulerService {
  return {
    ...landingService(landingBrief, [], []),
    failedLanding: {
      landing: () =>
        Promise.resolve({
          read: "Landing" as const,
          landing: {
            targetCommit: "1".repeat(40),
            ...(changeCommit === undefined ? {} : { changeCommit }),
            conflicted: true,
          },
        }),
    },
  };
}

test("a work task's document carries no target ref, whichever way its ticket lands, since its core reads the target merge", async () => {
  for (const brief of [
    landingBrief,
    landingBriefFinalized({ mode: "Push" }),
    landingBriefFinalized({ mode: "PullRequest" }),
    landingBriefFinalized({
      mode: "PullRequestMerge",
      target: "refs/heads/release",
    }),
    asDraftBrief({ intent: "Fix the importer.", links: [] }),
  ]) {
    const { placed, invoked } = await landingLaunched(
      landingService(brief, [], []),
    );
    const document = workTask(placed, invoked);
    assert.equal(Object.hasOwn(invoked, "targetRef"), false);
    assert.equal(Object.hasOwn(document, "targetRef"), false);
  }
});

test("a first work task, a rework after a failed evaluation and one after a failed landing name no fetch or merge, though their core merges the target", async () => {
  const service = landingService(landingBrief, [], []);
  for (const each of [
    service,
    {
      ...service,
      priorEvaluationReports: {
        reports: () =>
          Promise.resolve({
            read: "Reports" as const,
            reports: { reports: ["ci.sh exited 1"] },
          }),
      },
    },
    landingReworkService("2".repeat(40)),
    landingReworkService(),
  ]) {
    const { placed } = await landingLaunched(each);
    assert.equal(placed.targetMerge?.ref, "refs/heads/release");
    const text = placed.invocation.briefing.text;
    for (const command of [
      /git fetch/,
      /git merge\b/,
      / merge --/,
      /FETCH_HEAD/,
    ])
      assert.equal(command.test(text), false, String(command));
  }
});

test("a work task that lands on a target and whose binding writes no pipelines is told its push may not change them, and given no check of the target's", async () => {
  const forgejo = [".forgejo/workflows/"];
  const { placed } = await landingLaunched({
    ...landingService(landingBrief, [], []),
    pipelinePaths: forgejo,
    readOnlyRepositories: {
      repositories: () =>
        Promise.resolve({
          read: "Repositories" as const,
          repositories: [],
          pipelinesWritable: false,
        }),
    },
  });
  assert.equal(placed.targetMerge?.pipelinesWritable, false);
  const runtime = placed.invocation.briefing.sections.find(
    (section) => section.section === "RuntimeContext",
  );
  for (const line of briefingPipelinesUnwritable(forgejo))
    assert.ok(runtime?.lines.includes(line), line);
  assert.equal(placed.invocation.briefing.text.includes("git diff"), false);
});

test("a rework after a failed landing is told the core merged the target and then the change, or only the target where the change's commit is not recorded", async () => {
  const failedLanding = async (changeCommit?: string): Promise<string> => {
    const { placed } = await landingLaunched(
      landingReworkService(changeCommit),
    );
    return (
      placed.invocation.briefing.sections
        .find((section) => section.section === "FailedLanding")
        ?.lines.join("\n") ?? ""
    );
  };
  const recorded = await failedLanding("2".repeat(40));
  assert.ok(
    recorded.includes(
      "Before you started, the core merged the target into this workspace and then that change.",
    ),
  );
  const unrecorded = await failedLanding();
  assert.ok(unrecorded.includes("The commit of that change is not recorded."));
  assert.ok(
    unrecorded.includes(
      "Before you started, the core merged only the target into this workspace.",
    ),
  );
});

const ticketBrief = asDraftBrief({
  intent: "Fix the importer.",
  links: ["https://example.test/issues/340"],
  branch: "refs/heads/rt/ticket-brief",
});

test("a launched worker is handed the brief its ticket was created with", async () => {
  const placements: AttemptPlacement[] = [];
  await executionSchedulerLaunch(
    placingService(
      [],
      placements,
      { read: "Configuration", configuration },
      { read: "Facts", facts: noFacts },
      ticketBrief,
    ),
    epoch,
  );
  const placement = placements[0];
  assert.ok(placement !== undefined);
  assert.deepEqual(
    placement.invocation.briefing.sections
      .filter(
        (section) =>
          section.section === "TicketIntent" ||
          section.section === "TicketLinks",
      )
      .map((section) => section.lines),
    [["Fix the importer."], ["- https://example.test/issues/340"]],
  );
});

test("a ticket with no brief is briefed without the sections one would fill", async () => {
  const placements: AttemptPlacement[] = [];
  await executionSchedulerLaunch(placingService([], placements), epoch);
  const placement = placements[0];
  assert.ok(placement !== undefined);
  assert.equal(
    placement.invocation.briefing.sections.some(
      (section) =>
        section.section === "TicketIntent" || section.section === "TicketLinks",
    ),
    false,
  );
});

const member = asPrincipal("member-one");

/** `member`'s personal runner, allowlisting the fixture's project unless a case says otherwise. */
const memberRunner: PersonalRunnerRegistered = {
  owner: member,
  principal: asPrincipal("chuggy-personal-one"),
  capabilities: ["Platform:Linux:Amd64"],
  memoryCeilingMib: undefined,
  allowlist: [partition],
};

/** An authority answering the scheduler's `Execute`, and the owner's permit and `Read` as a case says. */
function ownerAccess(permit: boolean, read: boolean): ProjectAccess {
  return {
    authorize: (principal, _where, kind) =>
      Promise.resolve(
        kind === "Execute" || (kind === "Read" && read)
          ? memberAuthority(principal)
          : undefined,
      ),
    authorizeTenant: (principal, _tenant, kind) =>
      Promise.resolve(
        permit && kind === "RegisterPersonalRunner"
          ? memberAuthority(principal)
          : undefined,
      ),
    authorizeSite: projectAccessSiteRefused,
  };
}

/** A pass over an execution of `owned`'s owner routed to pools, against their `runners`. */
function ownedLaunch(
  calls: string[],
  runners: readonly PersonalRunnerRegistered[],
  access: ProjectAccess,
  failing = false,
  seen: string[] = [],
  owned: LogicalExecution = { ...execution, route: "Pool", owner: member },
): Promise<number> {
  const service = serviceWith(calls, runnable, placedOk);
  return executionSchedulerLaunch(
    {
      ...service,
      store: { ...service.store, unlaunched: () => Promise.resolve([owned]) },
      placement: {
        ...service.placement,
        place: () => {
          calls.push("place");
          return Promise.resolve(placedOk);
        },
      },
      workerPools: {
        personal: (_partition, asked) => {
          calls.push(`personal:${asked}`);
          return failing
            ? Promise.reject(new Error("the roster could not be read"))
            : Promise.resolve(runners);
        },
      },
      access,
      metrics: schedulerTelemetry(recordingMetrics(seen)),
    },
    epoch,
  );
}

const blocked = [
  "ended:Withdrawn:PlacementIncompatible",
  "blocked:RequiredCapabilityUnavailable",
];

test("an owner's execution none of their runners is configured to run is blocked, and never placed", async () => {
  for (const [why, runners] of [
    ["no runner", []],
    [
      "an unlike runner",
      [{ ...memberRunner, capabilities: ["Platform:Linux:Arm64"] }],
    ],
  ] as const) {
    const calls: string[] = [];
    const seen: string[] = [];
    assert.equal(
      await ownedLaunch(calls, runners, ownerAccess(true, true), false, seen),
      0,
    );
    assert.deepEqual(calls, ["personal:member-one", ...blocked], why);
    assert.deepEqual(
      seen,
      [
        "reaping:0",
        "attemptOpened:Opened",
        "attemptEnded:Withdrawn:PlacementIncompatible",
        "blocking:Blocked:RequiredCapabilityUnavailable",
      ],
      why,
    );
  }
});

test("an execution with no owner is blocked without reading any runner", async () => {
  const calls: string[] = [];
  await ownedLaunch(calls, [memberRunner], ownerAccess(true, true), false, [], {
    ...execution,
    route: "Pool",
  });
  assert.deepEqual(calls, blocked);
});

test("an authority that cannot answer of the owner decides nothing, so the execution is held and never blocked", async () => {
  for (const failure of [
    new ProjectAccessUnavailable("the authority did not answer"),
    new Error("the authority answered something unreadable"),
  ]) {
    const calls: string[] = [];
    await ownedLaunch(calls, [memberRunner], {
      authorize: () => Promise.reject(failure),
      authorizeTenant: () => Promise.reject(failure),
      authorizeSite: projectAccessSiteRefused,
    });
    assert.deepEqual(calls, ["personal:member-one"], failure.message);
  }
});

/** The fixture's attempt as a pass reads it waiting for a runner. */
const waitingAttempt: WaitingAttempt = {
  partition,
  execution: execution.execution,
  attempt: attempt.attempt,
  generation: attempt.generation,
  projectActive: true,
};

/**
 * A pass that finds the fixture's attempt, of an execution of `member`'s,
 * waiting for a runner and nothing to open, against their runners, the policy
 * and the authority a case supplies, answering each withdrawal as `withdrawn`
 * says and noting what an outdated one was compared against.
 */
async function poolWaitingPass(
  calls: string[],
  over: {
    readonly waiting?: WaitingAttempt;
    readonly runners?: readonly PersonalRunnerRegistered[];
    readonly resolved?: ProfileResolved;
    readonly access?: ProjectAccess;
    readonly withdrawn?: boolean;
    readonly compared?: WaitingAttemptRecord[];
  } = {},
): Promise<void> {
  const service = serviceWith(calls, over.resolved ?? runnable, placedOk);
  await executionSchedulerLaunch(
    {
      ...service,
      store: {
        ...service.store,
        waitingAttempts: () =>
          Promise.resolve([over.waiting ?? waitingAttempt]),
        execution: () =>
          Promise.resolve({
            ...execution,
            route: "Pool" as const,
            status: "Launching" as const,
            owner: member,
          }),
        waitingAttemptWithdrawn: (_attempt, evidence) => {
          calls.push(`waiting-withdrawn:${evidence}`);
          return Promise.resolve(over.withdrawn ?? true);
        },
        waitingAttemptOutdated: (_attempt, current) => {
          calls.push("waiting-outdated");
          over.compared?.push(current);
          return Promise.resolve(false);
        },
        unlaunched: () => Promise.resolve([]),
      },
      workerPools: {
        personal: (_partition, asked) => {
          calls.push(`personal:${asked}`);
          return Promise.resolve(over.runners ?? [memberRunner]);
        },
      },
      access: over.access ?? ownerAccess(true, true),
    },
    epoch,
  );
}

test("a waiting attempt of a project no longer Active is withdrawn without asking of any runner", async () => {
  const calls: string[] = [];
  await poolWaitingPass(calls, {
    waiting: { ...waitingAttempt, projectActive: false },
  });
  assert.deepEqual(calls, ["waiting-withdrawn:PlacementUnavailable"]);
});

test("a waiting attempt no configured runner could take now is withdrawn and its execution blocked, and nothing is blocked where a runner took it first", async () => {
  const calls: string[] = [];
  await poolWaitingPass(calls, { runners: [] });
  assert.deepEqual(calls, [
    "personal:member-one",
    "waiting-withdrawn:PlacementIncompatible",
    "blocked:RequiredCapabilityUnavailable",
  ]);
  const raced: string[] = [];
  await poolWaitingPass(raced, { runners: [], withdrawn: false });
  assert.deepEqual(raced, [
    "personal:member-one",
    "waiting-withdrawn:PlacementIncompatible",
  ]);
});

test("a waiting attempt whose policy now denies it is blocked as at opening, and one whose policy cannot answer goes on waiting", async () => {
  const denied: string[] = [];
  await poolWaitingPass(denied, {
    resolved: { resolved: "Denied", reason: "ExecutionPolicyDenied" },
  });
  assert.deepEqual(denied, [
    "personal:member-one",
    "waiting-withdrawn:PolicyDenied",
    "blocked:ExecutionPolicyDenied",
  ]);
  const held: string[] = [];
  await poolWaitingPass(held, { resolved: { resolved: "Unavailable" } });
  assert.deepEqual(held, ["personal:member-one"]);
});

test("a waiting attempt whose authority cannot answer is neither prepared again nor ended", async () => {
  const calls: string[] = [];
  const failure = new ProjectAccessUnavailable("no answer");
  await poolWaitingPass(calls, {
    access: {
      authorize: () => Promise.reject(failure),
      authorizeTenant: () => Promise.reject(failure),
      authorizeSite: projectAccessSiteRefused,
    },
  });
  assert.deepEqual(calls, ["personal:member-one"]);
});

test("a waiting attempt that prepares is compared against what this pass would record, under the runtime the pass opens attempts under", async () => {
  const calls: string[] = [];
  const compared: WaitingAttemptRecord[] = [];
  await poolWaitingPass(calls, { compared });
  assert.deepEqual(calls, ["personal:member-one", "waiting-outdated"]);
  const [current] = compared;
  assert.equal(current?.runtime, workerRuntime);
  assert.deepEqual(current.invocation.profile, runnable.profile);
});

test("an owner's execution is held while the owner's runner could run it, polling or not, rather than blocked", async () => {
  const calls: string[] = [];
  await ownedLaunch(calls, [memberRunner], ownerAccess(true, true));
  assert.deepEqual(calls, ["personal:member-one"]);
});

test("an owner's execution is held while any one of their runners could run it, and blocked where none of them could", async () => {
  const arm: PersonalRunnerRegistered = {
    ...memberRunner,
    principal: asPrincipal("chuggy-personal-two"),
    capabilities: ["Platform:Linux:Arm64"],
  };
  for (const [runners, called] of [
    [[arm, memberRunner], ["personal:member-one"]],
    [[memberRunner, arm], ["personal:member-one"]],
    [[arm], ["personal:member-one", ...blocked]],
  ] as const) {
    const calls: string[] = [];
    await ownedLaunch(calls, runners, ownerAccess(true, true));
    assert.deepEqual(calls, called);
  }
});

test("an owner's execution is blocked where the runner that alone could run it is revoked, does not allowlist its project, or cannot run it", async () => {
  for (const [why, runner, access] of [
    ["permit", memberRunner, ownerAccess(false, true)],
    ["read", memberRunner, ownerAccess(true, false)],
    [
      "allowlist",
      {
        ...memberRunner,
        allowlist: [{ ...partition, project: asProjectId("project-two") }],
      },
      ownerAccess(true, true),
    ],
    [
      "inventory",
      { ...memberRunner, capabilities: ["Platform:Linux:Arm64"] },
      ownerAccess(true, true),
    ],
  ] as const) {
    const calls: string[] = [];
    await ownedLaunch(calls, [runner], access);
    assert.deepEqual(calls, ["personal:member-one", ...blocked], why);
  }
});

test("an owner's execution is held where the owner's runner takes its size, and blocked for its memory where only that runner's ceiling stops it", async () => {
  const small = workerPoolMemoryMibDefault - 1;
  for (const [why, runner, called] of [
    [
      "at the ceiling",
      { ...memberRunner, memoryCeilingMib: workerPoolMemoryMibDefault },
      ["personal:member-one"],
    ],
    [
      "over the ceiling",
      { ...memberRunner, memoryCeilingMib: small },
      [
        "personal:member-one",
        "ended:Withdrawn:PlacementIncompatible",
        "blocked:RequiredMemoryUnavailable",
      ],
    ],
    [
      "over the ceiling and the inventory",
      {
        ...memberRunner,
        capabilities: ["Platform:Linux:Arm64"],
        memoryCeilingMib: small,
      },
      ["personal:member-one", ...blocked],
    ],
  ] as const) {
    const calls: string[] = [];
    await ownedLaunch(calls, [runner], ownerAccess(true, true));
    assert.deepEqual(calls, called, why);
  }
});

test("an incompatible execution is blocked for its memory exactly where some personal runner would be configured for it but for its ceiling", () => {
  const owned: LogicalExecution = {
    ...execution,
    route: "Pool",
    owner: member,
  };
  const small = workerPoolMemoryMibDefault - 1;
  const arm = ["Platform:Linux:Arm64"];
  const personal = (
    capabilities: readonly string[],
    memoryCeilingMib: number,
  ): WorkerPoolAnswered => ({
    partition,
    pool: member,
    principal: memberRunner.principal,
    capabilities,
    memoryCeilingMib,
    owner: member,
    allowlist: memberRunner.allowlist,
    revoked: false,
  });
  for (const [why, answered, reason] of [
    [
      "a personal runner too small",
      [personal(memberRunner.capabilities, small)],
      "RequiredMemoryUnavailable",
    ],
    [
      "a personal runner too small and unlike",
      [personal(arm, small)],
      "RequiredCapabilityUnavailable",
    ],
    [
      "an unlike runner beside one too small",
      [personal(arm, small), personal(memberRunner.capabilities, small)],
      "RequiredMemoryUnavailable",
    ],
    ["no runner", [], "RequiredCapabilityUnavailable"],
  ] as const) {
    assert.equal(
      workerPoolIncompatibility(owned, answered, workerPoolMemoryMibDefault),
      reason,
      why,
    );
  }
});

test("a failed read of the owner's runner fails the pass rather than holding the execution", async () => {
  const calls: string[] = [];
  await assert.rejects(
    ownedLaunch(calls, [memberRunner], ownerAccess(true, true), true),
    /the roster could not be read/u,
  );
  assert.ok(!calls.some((call) => call.startsWith("ended:")));
});

test("an attempt a pool refused is withdrawn and its execution blocked before any lease is reaped, and the refusal is counted", async () => {
  const calls: string[] = [];
  const seen: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    refusedAttempts: (_epoch, attemptsMax) => {
      calls.push(`refused:${String(attemptsMax)}`);
      return Promise.resolve([attempt]);
    },
    reapLapsedAttempts: () => {
      calls.push("reaped");
      return Promise.resolve(0);
    },
    unlaunched: () => Promise.resolve([]),
  };
  assert.equal(
    await executionSchedulerLaunch(
      {
        ...service,
        store,
        metrics: schedulerTelemetry(recordingMetrics(seen)),
      },
      epoch,
    ),
    0,
  );
  assert.deepEqual(calls, [
    `refused:${String(executionSchedulerDefaults.attemptsPerPassMax)}`,
    "ended:Withdrawn:PlacementRefused",
    "blocked:RequiredCapabilityUnavailable",
    "reaped",
  ]);
  assert.deepEqual(seen, [
    "attemptEnded:Withdrawn:PlacementRefused",
    "blocking:Blocked:RequiredCapabilityUnavailable",
    "reaping:0",
  ]);
});

test("an attempt a pool refused naming an image fault is withdrawn under that fault and its execution blocked as incompatible, for every fault", async () => {
  for (const fault of workerImageFaults) {
    const calls: string[] = [];
    const seen: string[] = [];
    const service = serviceWith(calls, runnable, placedOk);
    await executionSchedulerLaunch(
      {
        ...service,
        store: {
          ...service.store,
          refusedAttempts: () => Promise.resolve([{ ...attempt, fault }]),
          unlaunched: () => Promise.resolve([]),
        },
        metrics: schedulerTelemetry(recordingMetrics(seen)),
      },
      epoch,
    );
    assert.deepEqual(calls, [
      `ended:Withdrawn:${fault}`,
      "blocked:TicketConfigIncompatible",
    ]);
    assert.deepEqual(seen, [
      `attemptEnded:Withdrawn:${fault}`,
      "blocking:Blocked:TicketConfigIncompatible",
      "reaping:0",
    ]);
  }
});

test("a refused attempt something else ended first is not counted as ended", async () => {
  const calls: string[] = [];
  const seen: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    refusedAttempts: () => Promise.resolve([attempt]),
    attemptEnded: (_attempt, loss, evidence) => {
      calls.push(`ended:${loss}:${evidence}`);
      return Promise.resolve(false);
    },
    blockExecution: (_partition, _execution, reason) => {
      calls.push(`blocked:${reason}`);
      return Promise.resolve({ blocked: "AlreadyTerminal", outcome: "Failed" });
    },
    unlaunched: () => Promise.resolve([]),
  };
  await executionSchedulerLaunch(
    { ...service, store, metrics: schedulerTelemetry(recordingMetrics(seen)) },
    epoch,
  );
  assert.deepEqual(calls, [
    "ended:Withdrawn:PlacementRefused",
    "blocked:RequiredCapabilityUnavailable",
  ]);
  assert.deepEqual(seen, [
    "blocking:AlreadyTerminal:RequiredCapabilityUnavailable",
    "reaping:0",
  ]);
});

/** A pass over an execution of `member`'s routed to pools, which their runner is configured to run, noting each invocation recorded and each placement asked for. */
function poolOffer(
  calls: string[],
  seen: string[],
  resolved: ProfileResolved = runnable,
  access: ProjectAccess = ownerAccess(true, true),
): Promise<number> {
  const service = serviceWith(calls, resolved, placedOk);
  return executionSchedulerLaunch(
    {
      ...service,
      store: {
        ...service.store,
        unlaunched: () =>
          Promise.resolve([
            {
              ...execution,
              route: "Pool" as const,
              owner: member,
            },
          ]),
        attemptInvoked: (invoked) => {
          calls.push(`invoked:${invoked.attempt}`);
          return Promise.resolve(true);
        },
      },
      placement: {
        ...service.placement,
        place: () => {
          calls.push("place");
          return Promise.resolve(placedOk);
        },
      },
      workerPools: { personal: () => Promise.resolve([memberRunner]) },
      access,
      metrics: schedulerTelemetry(recordingMetrics(seen)),
    },
    epoch,
  );
}

test("an attempt routed to pools is invoked for a runner to claim and observed as offered, and never placed", async () => {
  const calls: string[] = [];
  const seen: string[] = [];
  assert.equal(await poolOffer(calls, seen), 0);
  assert.deepEqual(calls, ["invoked:attempt-one"]);
  assert.deepEqual(seen, [
    "reaping:0",
    "attemptOpened:Opened",
    "attemptOffered",
  ]);
});

test("a policy denial blocks an attempt routed to pools before any pool is offered it", async () => {
  const calls: string[] = [];
  const seen: string[] = [];
  assert.equal(
    await poolOffer(calls, seen, {
      resolved: "Denied",
      reason: "ExecutionPolicyDenied",
    }),
    0,
  );
  assert.deepEqual(calls, [
    "ended:Withdrawn:PolicyDenied",
    "blocked:ExecutionPolicyDenied",
  ]);
  assert.equal(seen.includes("attemptOffered"), false);
});

test("an attempt routed to pools is offered to none while the authority cannot answer", async () => {
  const calls: string[] = [];
  const seen: string[] = [];
  const failure = new ProjectAccessUnavailable("the authority did not answer");
  assert.equal(
    await poolOffer(calls, seen, runnable, {
      authorize: () => Promise.reject(failure),
      authorizeTenant: () => Promise.reject(failure),
      authorizeSite: projectAccessSiteRefused,
    }),
    0,
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(seen, ["reaping:0", "attemptOpened:Opened"]);
});

/**
 * A pass's observation of the fixture attempt, whose workload is found as
 * `found` and whose error text the backend answers `written` to, noting every
 * call the step makes of the store and the backend.
 */
async function observing(
  calls: string[],
  found: AttemptWorkloadObserved,
  written: AttemptErrorWritten = { written: "Written" },
  ended = true,
  seen: string[] = [],
): Promise<unknown> {
  const service = serviceWith(calls, runnable, placedOk);
  return executionSchedulerObserve(
    {
      ...service,
      store: {
        ...service.store,
        attemptsAwaitingObservation: () => Promise.resolve([attempt]),
        attemptEnded: (_attempt, loss, evidence) => {
          calls.push(`ended:${loss}:${evidence}`);
          return Promise.resolve(ended);
        },
      },
      placement: {
        ...service.placement,
        observe: (observed) => {
          calls.push(`observed:${observed.attempt}`);
          return Promise.resolve(found);
        },
        writeError: (failed, text) => {
          calls.push(`wrote:${failed.attempt}:${text}`);
          return Promise.resolve(written);
        },
      },
      metrics: schedulerTelemetry(recordingMetrics(seen)),
    },
    epoch,
  );
}

test("each image fault stores its text, then blocks as incompatible under its own label without spending a retry, then cancels the pod", async () => {
  for (const fault of workerImageFaults) {
    const calls: string[] = [];
    const seen: string[] = [];
    assert.deepEqual(
      await observing(
        calls,
        { observed: "ImageFault", fault, text: `text of ${fault}` },
        { written: "Written" },
        true,
        seen,
      ),
      { observed: 1, notices: [] },
    );
    assert.deepEqual(calls, [
      "observed:attempt-one",
      `wrote:attempt-one:text of ${fault}`,
      `ended:Withdrawn:${fault}`,
      "blocked:TicketConfigIncompatible",
      "cancelled:attempt-one:1",
    ]);
    assert.deepEqual(seen, [
      `attemptEnded:Withdrawn:${fault}`,
      "blocking:Blocked:TicketConfigIncompatible",
    ]);
  }
});

test("a fault of the site's runtime withdraws the attempt without blocking or spending a retry, and is told", async () => {
  const calls: string[] = [];
  const why = "pod chuggy-worker-one: the runtime copy ended Error";
  assert.deepEqual(await observing(calls, { observed: "SiteFault", why }), {
    observed: 1,
    notices: [{ notice: "SiteFault", attempt, why }],
  });
  assert.deepEqual(calls, [
    "observed:attempt-one",
    "ended:Withdrawn:PlacementUnavailable",
    "cancelled:attempt-one:1",
  ]);
});

test("a run its site stopped at its deadline stores its text, then ends timed out as its worker's own report would, spending a retry, then cancels the pod", async () => {
  const calls: string[] = [];
  const seen: string[] = [];
  assert.deepEqual(
    await observing(
      calls,
      { observed: "TimedOut", text: "stopped at its deadline" },
      { written: "Written" },
      true,
      seen,
    ),
    { observed: 1, notices: [] },
  );
  assert.deepEqual(calls, [
    "observed:attempt-one",
    "wrote:attempt-one:stopped at its deadline",
    "ended:Lost:RunTimedOut",
    "cancelled:attempt-one:1",
  ]);
  assert.deepEqual(seen, ["attemptEnded:Lost:RunTimedOut"]);
});

test("a timed-out run whose text could not be stored still ends, and the text's absence is told", async () => {
  const calls: string[] = [];
  const why = "the worker plane answered 503";
  assert.deepEqual(
    await observing(
      calls,
      { observed: "TimedOut", text: "text" },
      { written: "Unwritten", why },
    ),
    {
      observed: 1,
      notices: [
        {
          notice: "ErrorUnwritten",
          attempt,
          ended: "RunTimedOut",
          text: "text",
          why,
        },
      ],
    },
  );
  assert.deepEqual(calls.slice(2), [
    "ended:Lost:RunTimedOut",
    "cancelled:attempt-one:1",
  ]);
});

test("a workload with no fault its worker cannot report is left to its lease", async () => {
  const calls: string[] = [];
  assert.deepEqual(await observing(calls, { observed: "Unfaulted" }), {
    observed: 0,
    notices: [],
  });
  assert.deepEqual(calls, ["observed:attempt-one"]);
});

test("a fault whose text could not be stored still blocks, and the text's absence is told", async () => {
  const calls: string[] = [];
  const why = "the worker plane answered 503";
  assert.deepEqual(
    await observing(
      calls,
      { observed: "ImageFault", fault: "ImageLacksGit", text: "text" },
      { written: "Unwritten", why },
    ),
    {
      observed: 1,
      notices: [
        {
          notice: "ErrorUnwritten",
          attempt,
          ended: "ImageLacksGit",
          text: "text",
          why,
        },
      ],
    },
  );
  assert.deepEqual(calls.slice(2), [
    "ended:Withdrawn:ImageLacksGit",
    "blocked:TicketConfigIncompatible",
    "cancelled:attempt-one:1",
  ]);
});

test("an attempt something else ended first is neither counted nor told", async () => {
  for (const found of [
    { observed: "SiteFault", why: "pod one: copy failed" },
    { observed: "ImageFault", fault: "ImageLacksGit", text: "text" },
    { observed: "TimedOut", text: "text" },
  ] as const) {
    assert.deepEqual(
      await observing(
        [],
        found,
        { written: "Unwritten", why: "the worker plane answered 409" },
        false,
      ),
      { observed: 0, notices: [] },
    );
  }
});

test("a pass observes after admission and before the reaper, asking for the bound every sweep has", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, runnable, placedOk);
  const store: ExecutionSchedulerStore = {
    ...service.store,
    admit: () => {
      calls.push("admitted");
      return Promise.resolve({ admitted: "ClusterFull" });
    },
    attemptsAwaitingObservation: (observedEpoch, attemptsMax) => {
      calls.push(`observing:${observedEpoch}:${String(attemptsMax)}`);
      return Promise.resolve([attempt]);
    },
    refusedAttempts: () => {
      calls.push("refused");
      return Promise.resolve([]);
    },
    reapLapsedAttempts: () => {
      calls.push("reaped");
      return Promise.resolve(0);
    },
    unlaunched: () => Promise.resolve([]),
  };
  const placement = {
    ...service.placement,
    observe: () => {
      calls.push("observed");
      return Promise.resolve({
        observed: "SiteFault",
        why: "copy failed",
      } as const);
    },
  };
  const report = await executionSchedulerPass(
    { ...service, store, placement },
    owner,
    epoch,
    cluster,
  );
  assert.equal(report.observed, 1);
  assert.deepEqual(report.notices, [
    { notice: "SiteFault", attempt, why: "copy failed" },
  ]);
  assert.deepEqual(calls.slice(calls.indexOf("admitted")), [
    "admitted",
    `observing:${epoch}:${String(executionSchedulerDefaults.attemptsPerPassMax)}`,
    "observed",
    "ended:Withdrawn:PlacementUnavailable",
    "cancelled:attempt-one:1",
    "refused",
    "reaped",
  ]);
});

/** What a launched attempt's invocation recorded and its placement carried of what its core merges in, each of which must name the same. */
async function landingTargetMerge(
  service: ExecutionSchedulerService,
): Promise<WorkTaskInvocation["targetMerge"]> {
  const { placed, invoked } = await landingLaunched(service);
  assert.equal(
    Object.hasOwn(invoked, "targetMerge"),
    placed.targetMerge !== undefined,
  );
  assert.deepEqual(invoked.targetMerge, placed.targetMerge);
  return placed.targetMerge;
}

/** The ref a launched work task's core merges in, for a brief finalized as `finalization` says. */
async function landingTargetMergeRef(finalization: {
  readonly kind: string;
  readonly mode?: string;
  readonly target?: string;
  readonly policy?: string;
}): Promise<string | undefined> {
  const brief = asDraftBrief({
    intent: "Fix the importer.",
    links: [],
    repository: landingRepository,
    branch: "refs/heads/rt/ticket-brief",
    finalization,
  });
  return (await landingTargetMerge(landingService(brief, [], [])))?.ref;
}

test("a push's work task merges in the ref it pushes to, the brief's branch where it names none", async () => {
  assert.equal(
    await landingTargetMergeRef({
      kind: "GitMerge",
      mode: "Push",
      target: "refs/heads/release",
      policy: "Direct",
    }),
    "refs/heads/release",
  );
  assert.equal(
    await landingTargetMergeRef({
      kind: "GitMerge",
      mode: "Push",
      policy: "Direct",
    }),
    "refs/heads/rt/ticket-brief",
  );
});

test("a push rework whose brief and binding name no reference merges the remote's default and then its change, so its briefing's account of that merge is true", async () => {
  const changeCommit = "2".repeat(40);
  const brief = asDraftBrief({
    intent: "Fix the importer.",
    links: [],
    repository: landingRepository,
    finalization: { mode: "Push" },
  });
  assert.deepEqual(
    await landingTargetMerge({
      ...landingService(brief, [], []),
      failedLanding: {
        landing: () =>
          Promise.resolve({
            read: "Landing" as const,
            landing: {
              targetCommit: "1".repeat(40),
              changeCommit,
              conflicted: true,
            },
          }),
      },
    }),
    {
      ref: finalizerRemoteDefaultRef,
      pipelinesWritable: true,
      change: changeCommit,
    },
  );
});

for (const [name, finalization] of [
  ["PullRequest", { kind: "PullRequest" }],
  [
    "PullRequestMerge",
    { kind: "GitMerge", mode: "PullRequestMerge", policy: "Direct" },
  ],
] as const)
  test(`a ${name} work task merges in the base its proposal opens into, the remote's default where it names none, and never its own branch`, async () => {
    assert.equal(
      await landingTargetMergeRef({
        ...finalization,
        target: "refs/heads/release",
      }),
      "refs/heads/release",
    );
    assert.equal(
      await landingTargetMergeRef(finalization),
      finalizerRemoteDefaultRef,
    );
  });

test("a work task whose ticket lands nothing, or whose brief names no bound repository, merges nothing in", async () => {
  assert.equal(await landingTargetMergeRef({ kind: "None" }), undefined);
  const unbound = asDraftBrief({
    intent: "Fix the importer.",
    links: [],
    repository: asRepositoryId("https://example.test/unbound.git"),
    branch: "refs/heads/rt/ticket-brief",
    finalization: { mode: "Push", target: "refs/heads/release" },
  });
  assert.equal(
    await landingTargetMerge(landingService(unbound, [], [])),
    undefined,
  );
});

test("a work task merges a target's pipeline change in only where its own binding is not read as writing no pipelines", async () => {
  const writable = async (pipelinesWritable: boolean | undefined) => {
    const service = landingService(landingBrief, [], []);
    const merged = await landingTargetMerge({
      ...service,
      readOnlyRepositories: {
        repositories: () =>
          Promise.resolve({
            read: "Repositories" as const,
            repositories: [],
            ...(pipelinesWritable === undefined ? {} : { pipelinesWritable }),
          }),
      },
    });
    return merged?.pipelinesWritable;
  };
  assert.equal(await writable(false), false);
  assert.equal(await writable(true), true);
  assert.equal(await writable(undefined), true);
});

test("a rework after a failed landing merges in the change that landing recorded, and a first task and a rework after a failed evaluation merge in none", async () => {
  const changeCommit = "2".repeat(40);
  const service = landingService(landingBrief, [], []);
  assert.deepEqual(
    await landingTargetMerge({
      ...service,
      failedLanding: {
        landing: () =>
          Promise.resolve({
            read: "Landing" as const,
            landing: {
              targetCommit: "1".repeat(40),
              changeCommit,
              conflicted: false,
            },
          }),
      },
    }),
    {
      ref: "refs/heads/release",
      pipelinesWritable: true,
      change: changeCommit,
    },
  );
  const unchanged = { ref: "refs/heads/release", pipelinesWritable: true };
  assert.deepEqual(await landingTargetMerge(service), unchanged);
  assert.deepEqual(
    await landingTargetMerge({
      ...service,
      priorEvaluationReports: {
        reports: () =>
          Promise.resolve({
            read: "Reports" as const,
            reports: { reports: ["ci.sh exited 1"] },
          }),
      },
    }),
    unchanged,
  );
});

test("a re-check rework whose failed landing recorded no change commit merges in the commit it re-checks as the change, and is told so", async () => {
  const recheck = "3".repeat(40);
  const changeCommit = "2".repeat(40);
  const reworked = (recorded?: string): ExecutionSchedulerService => ({
    ...landingService(landingBrief, [], []),
    failedLanding: {
      landing: () =>
        Promise.resolve({
          read: "Landing" as const,
          landing: {
            targetCommit: "1".repeat(40),
            ...(recorded === undefined ? {} : { changeCommit: recorded }),
            conflicted: false,
            failure: "QueueChecksFailed" as const,
            recheck,
          },
        }),
    },
  });
  assert.deepEqual(await landingTargetMerge(reworked()), {
    ref: "refs/heads/release",
    pipelinesWritable: true,
    change: recheck,
  });
  assert.deepEqual(
    await landingTargetMerge(reworked(changeCommit)),
    {
      ref: "refs/heads/release",
      pipelinesWritable: true,
      change: changeCommit,
    },
    "a recorded change commit is the change",
  );
  const { placed } = await landingLaunched(reworked());
  const lines =
    placed.invocation.briefing.sections
      .find((section) => section.section === "FailedLanding")
      ?.lines.join("\n") ?? "";
  assert.ok(lines.includes(`That change ends at commit ${recheck};`));
});
