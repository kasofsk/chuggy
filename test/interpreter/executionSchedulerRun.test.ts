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
  type ExecutionPolicy,
  type ExecutionSchedulerStore,
  type LogicalExecution,
  type PhysicalAttempt,
  type ProfileResolved,
  type RequestClaim,
  type AttemptPlacementPort,
  type AttemptPlacementOutcome,
  type AttemptPlacement,
} from "../../src/interpreter/executionScheduler.ts";
import {
  executionSchedulerAdmit,
  executionSchedulerCancel,
  executionSchedulerCleanup,
  executionSchedulerLaunch,
  executionSchedulerPass,
  executionSchedulerRegister,
  type ExecutionSchedulerService,
} from "../../src/interpreter/executionSchedulerRun.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
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
import { finalizerDefaults } from "../../src/interpreter/finalizer.ts";
import { ticketServiceDefaults } from "../../src/interpreter/ticketService.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { recordingMetrics, throwingMetrics } from "./schedulerSinks.ts";
import {
  asDraftBrief,
  type DraftBrief,
} from "../../src/interpreter/ticketBrief.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const epoch = asRecoveryEpoch("epoch");
const cluster = asClusterId("cluster");
const owner = asSchedulerOwnerId("scheduler-one");

const execution: LogicalExecution = {
  partition,
  execution: asExecutionId("execution-one"),
  ticket: asTicketId(1),
  task: asTaskId(1),
  taskKind: "Work",
  sourceRequest: "1:0:SpawnWork",
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

/** A store that records every durable move asked of it and takes none. */
function recordingStore(calls: string[]): ExecutionSchedulerStore {
  return {
    claimRequests: () => Promise.resolve([]),
    registerSpawn: () =>
      Promise.resolve({ registered: "Registered", created: 1 }),
    registerCancellation: () =>
      Promise.resolve({ cancelled: "Registered", fenced: 0, placements: [] }),
    admit: () => Promise.resolve({ admitted: "ClusterFull" }),
    openAttempt: () => Promise.resolve({ opened: "Opened", attempt }),
    attemptPlaced: (_attempt, workload) => {
      calls.push(`placed:${workload}`);
      return Promise.resolve(true);
    },
    attemptEnded: (_attempt, loss, evidence) => {
      calls.push(`ended:${loss}:${evidence}`);
      return Promise.resolve(true);
    },
    retriesExhausted: () => {
      calls.push("retriesExhausted");
      return Promise.resolve({
        terminalized: "Terminalized",
        outcome: "Failed",
        operation: asOperationId("operation"),
      });
    },
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
    reapLapsedAttempts: () => Promise.resolve(0),
    attemptsAwaitingCleanup: () => Promise.resolve([]),
    attemptCleanupCompleted: () => Promise.resolve(true),
    unlaunched: () => Promise.resolve([execution]),
    fenceOldEpochAttempts: () => {
      calls.push("fenced");
      return Promise.resolve(0);
    },
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
  };
  return {
    store: recordingStore(calls),
    placement,
    policy,
    configurations: { configuration: () => Promise.resolve(read) },
    runtimeFacts: { facts: () => Promise.resolve(facts) },
    priorWorkReports: {
      reports: () =>
        Promise.resolve({ read: "Reports", reports: { reports: [] } }),
    },
    ticketBriefs: { brief: () => Promise.resolve(brief) },
    practices: blessedPracticeCatalog,
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
    requirementSource: "ExplicitTask" as const,
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
  const service = serviceWith(calls, runnable, {
    placed: "Unavailable",
    retryAfterSeconds: 5,
  });
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
  request: "2:0:CancelTicketWork",
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
    reapLapsedAttempts: () => {
      calls.push("reaped");
      return Promise.resolve(0);
    },
    unlaunched: () => {
      calls.push("unlaunched");
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
      placed: 0,
    },
  );
  assert.deepEqual(calls, [
    "fenced",
    "claimed:CancelTicketWork",
    "claimed:SpawnWork,SpawnEvaluation",
    "admitted",
    "reaped",
    "unlaunched",
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
      placed: 1,
    },
  );
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
    reapLapsedAttempts: (_epoch, attemptsMax) => {
      swept.push(`reap:${String(attemptsMax)}`);
      return Promise.resolve(0);
    },
  };
  const bound = String(executionSchedulerDefaults.attemptsPerPassMax);
  await executionSchedulerPass({ ...service, store }, owner, epoch, cluster);
  assert.deepEqual(swept, [`fence:${bound}`, `reap:${bound}`]);
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
          request: "1:0:SpawnWork",
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
    "ended:Withdrawn:PolicyDenied",
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
    "attemptEnded:Withdrawn:PolicyDenied",
    "blocking:Blocked:TicketConfigIncompatible",
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
    "ended:Withdrawn:PolicyDenied",
    "blocked:TicketConfigIncompatible",
  ]);
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
