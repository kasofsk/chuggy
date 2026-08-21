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
  asAttemptId,
  asCapacityAccountId,
  asClusterId,
  asExecutionId,
  asSchedulerOwnerId,
  asWorkloadId,
  executionSchedulerDefaults,
  silentExecutionSchedulerMetrics,
  type ExecutionPolicy,
  type ExecutionSchedulerStore,
  type LogicalExecution,
  type PhysicalAttempt,
  type ProfileResolved,
  type WorkerLaunchPort,
  type WorkerPlaced,
} from "../../src/interpreter/executionScheduler.ts";
import {
  executionSchedulerAdmit,
  executionSchedulerLaunch,
  executionSchedulerRegister,
  type ExecutionSchedulerService,
} from "../../src/interpreter/executionSchedulerRun.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";

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
  sourceSeq: 1,
  sourceEffect: 0,
  ticketVersion: 1,
  account: asCapacityAccountId("project"),
  cluster,
  configurationRevision: "revision",
  configurationDigest: "digest",
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
};

/** A store that records every durable move asked of it and takes none. */
function recordingStore(calls: string[]): ExecutionSchedulerStore {
  return {
    claimRequests: () => Promise.resolve([]),
    registerSpawn: () =>
      Promise.resolve({ registered: "Registered", created: 1 }),
    registerCancellation: () =>
      Promise.resolve({ cancelled: "Registered", fenced: 0 }),
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
    unlaunched: () => Promise.resolve([execution]),
    fenceOldEpochAttempts: () => Promise.resolve(0),
  };
}

/** A service whose policy and fabric answer exactly what a case is about. */
function serviceWith(
  calls: string[],
  resolved: ProfileResolved,
  placed: WorkerPlaced,
): ExecutionSchedulerService {
  const policy: ExecutionPolicy = {
    profileFor: () => Promise.resolve(resolved),
  };
  const workers: WorkerLaunchPort = {
    place: () => Promise.resolve(placed),
    delete: () => Promise.resolve(),
  };
  return {
    store: recordingStore(calls),
    workers,
    policy,
    config: executionSchedulerDefaults,
    metrics: silentExecutionSchedulerMetrics,
  };
}

const runnable: ProfileResolved = {
  resolved: "Profile",
  profile: { profile: "standard", runtimeVersion: "1" },
};

const placedOk: WorkerPlaced = {
  placed: "Placed",
  workload: asWorkloadId("workload-one"),
};

test("a placed attempt records its workload and nothing else", async () => {
  const calls: string[] = [];
  assert.equal(
    await executionSchedulerLaunch(
      serviceWith(calls, runnable, placedOk),
      epoch,
    ),
    1,
  );
  assert.deepEqual(calls, ["placed:workload-one"]);
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

test("a temporary policy hold blocks nothing and spends no retry", async () => {
  const calls: string[] = [];
  const service = serviceWith(calls, { resolved: "Unavailable" }, placedOk);
  assert.equal(await executionSchedulerLaunch(service, epoch), 0);
  assert.deepEqual(calls, ["ended:Withdrawn:PolicyUnavailable"]);
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
