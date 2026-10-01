import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import { nativeHttpPageItemsMax } from "../../src/contract/http.ts";
import { workerPlaneRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerRunConfiguration,
  postgresWorkerRunTotal,
  postgresWorkerRunTranscript,
} from "../../src/adapters/postgres/workerPlane.ts";
import { canonicalConfigurationOf } from "../../src/interpreter/authoring.ts";
import { asArtifactDigest } from "../../src/interpreter/resultManifest.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessRolePool,
} from "./harness.ts";
import {
  asExecutionId,
  asPlacementId,
  type ExecutionId,
} from "../../src/interpreter/schedulerIdentity.ts";
import {
  executionSchedulerDefaults,
  type PhysicalAttempt,
} from "../../src/interpreter/executionScheduler.ts";
import { id } from "../domain/fixtures.ts";
import {
  schedulerClaimFor,
  schedulerExecutions,
  schedulerEvaluationRequest,
  schedulerFurtherTicket,
  schedulerIngressPool,
  schedulerOwner,
  schedulerPlacedAttempt,
  schedulerProject,
  schedulerRigOpen,
  schedulerInCluster,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";
import type {
  ExecutionListQuery,
  ExecutionPageCursor,
  OperationalReadStore,
} from "../../src/interpreter/operationsView.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";

let rig: SchedulerRig;
let ingress: ReturnType<typeof schedulerIngressPool>;

before(async () => {
  rig = await schedulerRigOpen();
  ingress = schedulerIngressPool();
});

after(async () => {
  await ingress.end();
  await rig.close();
});

test("operational reads page scheduler-owned execution state", async () => {
  const project = await schedulerProject(rig, "operational-page", {
    tasks: 2,
  });
  const claim = await schedulerClaimFor(
    rig,
    project.partition,
    project.request,
    schedulerOwner("operational-page"),
  );
  assert.equal(
    (
      await rig.store.registerSpawn(
        claim,
        executionSchedulerDefaults.nTasks,
        schedulerInCluster,
      )
    ).registered,
    "Registered",
  );
  const durable = await schedulerExecutions(rig, project.partition);
  const reads = postgresOperationalReads(ingress);
  const page = await reads.executions(project.partition, {
    limit: 1,
    ticket: id(project.ticket),
    selection: { selection: "NonTerminal" },
  });
  assert.equal(page.executions.length, 1);
  assert.equal(page.executions[0]?.status, "Queued");
  assert.ok(page.nextAfter !== undefined);
  assert.deepEqual(
    await reads.executions(project.partition, {
      limit: 10,
      ticket: id(project.ticket + 1),
      selection: { selection: "Selected", states: ["Queued"] },
    }),
    { executions: [] },
  );
  const detail = await reads.execution(
    project.partition,
    asExecutionId(durable[0]?.execution ?? "absent"),
  );
  assert.equal(detail?.ticket, project.ticket);
  assert.deepEqual(detail?.attempts, []);
  const status = await reads.status(project.partition);
  assert.equal(status.queued, 2);
  assert.equal(status.schedulerFreshness, "Unknown");
});

/**
 * The identity that says which executions were spawned together. Without it the
 * only thing joining a fan-out on the wire is the shape of an adapter's
 * generated execution ids.
 */
test("every execution of one fan-out names the request that spawned it", async () => {
  const project = await schedulerProject(rig, "operational-request", {
    tasks: 2,
  });
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner("operational-request"),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  const reads = postgresOperationalReads(ingress);
  const page = await reads.executions(project.partition, {
    limit: 10,
    ticket: id(project.ticket),
  });
  assert.equal(page.executions.length, 2);
  assert.deepEqual(
    [...new Set(page.executions.map((each) => each.request))],
    [project.request],
  );
  const detail = await reads.execution(
    project.partition,
    page.executions[0]?.execution ?? asExecutionId("absent"),
  );
  assert.equal(detail?.request, project.request);
});

test("an evaluation's identity is read back from its columns, counter by counter", async () => {
  const project = await schedulerProject(rig, "operational-identity", {
    tasks: 1,
  });
  /**
   * The stage and the evaluator are the only ones this deployment's plan
   * names, and a release resolves a definition per stage, so a spawn at any
   * other pair is one no ticket here was released for.
   */
  const identity = { cycle: 2, stage: 1, generation: 4, evaluator: 1 };
  const request = await schedulerEvaluationRequest(
    rig,
    project,
    "operational-identity",
    identity,
  );
  await operationalRegistered(project, request, "operational-identity");
  const reads = postgresOperationalReads(ingress);
  const page = await reads.executions(project.partition, {
    limit: 10,
    ticket: id(project.ticket),
  });
  const evaluation = page.executions.find(
    (each) => each.identity.type === "EvaluationTask",
  );
  assert.deepEqual(evaluation?.identity, {
    type: "EvaluationTask",
    value: {
      ticket: project.ticket,
      workCycle: identity.cycle,
      stage: identity.stage,
      generation: identity.generation,
      evaluator: identity.evaluator,
    },
  });
  const detail = await reads.execution(
    project.partition,
    evaluation?.execution ?? asExecutionId("absent"),
  );
  assert.deepEqual(detail?.identity, evaluation?.identity);
});

test("an execution reads back empty until its run writes evidence", async () => {
  const project = await schedulerProject(rig, "operational-run");
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner("operational-run"),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  const placed = await schedulerPlacedAttempt(rig, project, "operational-run");
  const reads = postgresOperationalReads(ingress);
  const before = await reads.execution(project.partition, placed.execution);
  assert.equal(before?.runTotals, undefined);
  assert.equal(before?.attempts[0]?.run, undefined);
  const workerPool = postgresHarnessRolePool(workerPlaneRole);
  try {
    assert.equal(
      await postgresWorkerRunTranscript(workerPool).record({
        secret: placed.attempt.capability.secret,
        generation: placed.attempt.generation,
        batch: 1,
        digest: asArtifactDigest("a".repeat(64)),
        bytes: 12,
        events: 2,
      }),
      "Stored",
    );
    assert.equal(
      await postgresWorkerRunTotal(workerPool).record({
        secret: placed.attempt.capability.secret,
        generation: placed.attempt.generation,
        totals: {
          turns: 2,
          durationMs: 10,
          durationApiMs: 5,
          tokensInput: 1,
          tokensOutput: 2,
          tokensCacheCreation: 3,
          tokensCacheRead: 4,
          costUsdMicros: 11,
          costBasis: "List",
          models: [],
          permissionDenials: 0,
          stopReason: "end_turn",
        },
      }),
      "Stored",
    );
  } finally {
    await workerPool.end();
  }
  const written = await reads.execution(project.partition, placed.execution);
  assert.equal(written?.runTotals?.costUsdMicros, 11);
  const run = written?.attempts[0]?.run;
  assert.equal(run?.transcript?.highWaterBatch, 1);
  assert.equal(run?.transcript?.bytes, 12);
  assert.equal(run?.totals?.stopReason, "end_turn");
  assert.equal(run?.configuration, undefined);
  assert.equal(run?.turnsRecorded, 0);
});

/** Registers every task one spawn request declares, refusing anything less. */
async function operationalRegistered(
  project: { readonly partition: Partition },
  request: string,
  label: string,
): Promise<void> {
  const claim = await schedulerClaimFor(
    rig,
    project.partition,
    request,
    schedulerOwner(label),
  );
  assert.equal(
    (
      await rig.store.registerSpawn(
        claim,
        executionSchedulerDefaults.nTasks,
        schedulerInCluster,
      )
    ).registered,
    "Registered",
  );
}

/** One ticket's executions as the two orders in question see them. */
async function operationalOrders(
  partition: Partition,
  ticket: number,
): Promise<{
  readonly byIdentity: readonly string[];
  readonly byTask: readonly string[];
}> {
  const of = async (order: string): Promise<readonly string[]> =>
    (
      (await rig.harness.query(
        `SELECT execution FROM execution
          WHERE tenant=$1 AND project=$2 AND ticket=$3 ORDER BY ${order}`,
        [partition.tenant, partition.project, ticket],
      )) as readonly { execution: string }[]
    ).map((row) => row.execution);
  return { byIdentity: await of("execution"), byTask: await of("task") };
}

/**
 * Every page a walk of one read answers with, as the `(ticket, task)` positions
 * each page carried. A walk that has not ended within its budget is a failure
 * rather than a shorter answer, because a cursor that never retires reads
 * exactly like a list that ran out.
 */
async function operationalWalked(
  reads: OperationalReadStore,
  partition: Partition,
  query: ExecutionListQuery,
  pagesMax: number,
): Promise<number[][][]> {
  const pages: number[][][] = [];
  let after: ExecutionPageCursor | undefined;
  for (let page = 0; page < pagesMax; page += 1) {
    const answered = await reads.executions(partition, {
      ...query,
      ...(after === undefined ? {} : { after }),
    });
    pages.push(answered.executions.map((row) => [row.ticket, row.task]));
    after = answered.nextAfter;
    if (after === undefined) return pages;
  }
  throw new Error(
    "operational read: the walk did not reach the end of the list",
  );
}

/**
 * A registration names each execution `execution-<uuid>-<task>`, so a ticket's
 * identities sort as text and its history does not: the fixture below is a
 * ticket whose two orders differ, which is what makes a read ordered by either
 * one distinguishable from a read ordered by the other. A second ticket is
 * registered beside it, and both walks use a page smaller than what they walk —
 * the project-wide one so that a page straddles the boundary between the two
 * tickets, which is the one thing the cursor does that a ticket-scoped walk
 * never asks of it.
 */
test("a ticket's executions are read and paged in task order", async () => {
  const tasks = 11;
  const project = await schedulerProject(rig, "operational-history", { tasks });
  await operationalRegistered(project, project.request, "operational-history");
  const further = await schedulerFurtherTicket(
    rig,
    project,
    project.memory,
    "operational-history-next",
    3,
  );
  await operationalRegistered(
    project,
    further.request,
    "operational-history-next",
  );
  const orders = await operationalOrders(project.partition, project.ticket);
  assert.equal(orders.byTask.length, tasks);
  assert.notDeepEqual(orders.byIdentity, orders.byTask);

  const reads = postgresOperationalReads(ingress);
  const whole = await reads.executions(project.partition, {
    limit: tasks,
    ticket: id(project.ticket),
  });
  const history = Array.from({ length: tasks }, (_unused, at) => at + 1);
  assert.deepEqual(
    whole.executions.map((row) => row.task),
    history,
  );
  assert.equal(whole.nextAfter, undefined);

  const pagesMax = tasks + further.tasks;
  const walked = await operationalWalked(
    reads,
    project.partition,
    { limit: 4, ticket: id(project.ticket) },
    pagesMax,
  );
  assert.deepEqual(
    walked.flat().map(([, task]) => task),
    history,
  );

  const across = await operationalWalked(
    reads,
    project.partition,
    { limit: 4 },
    pagesMax,
  );
  const positions = [
    ...history.map((task) => [project.ticket, task]),
    ...Array.from({ length: further.tasks }, (_unused, at) => [
      further.ticket,
      at + 1,
    ]),
  ];
  assert.deepEqual(across.flat(), positions);
  assert.deepEqual(
    across.filter((page) => new Set(page.map(([ticket]) => ticket)).size > 1),
    [
      [
        [project.ticket, tasks - 2],
        [project.ticket, tasks - 1],
        [project.ticket, tasks],
        [further.ticket, 1],
      ],
    ],
  );
});

/** Opens `opened` attempts of one execution, losing all but the last. */
async function operationalAttemptsOpened(
  label: string,
  opened: number,
): Promise<{ project: SchedulerProject; execution: ExecutionId }> {
  const project = await schedulerProject(rig, label);
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  for (let number = 1; number <= opened; number += 1) {
    const attempt = await rig.store.openAttempt({
      partition: project.partition,
      execution: admitted.execution,
      epoch: project.epoch,
      leaseSecs: 300,
      retriesMax: opened + 1,
      placementBackoffSecs: 1,
    });
    assert.equal(attempt.opened, "Opened", `attempt ${String(number)}`);
    if (attempt.opened !== "Opened" || number === opened) continue;
    assert.equal(
      await rig.store.attemptEnded(attempt.attempt, "Lost", "Vanished"),
      true,
    );
    await rig.harness.query(
      `UPDATE execution SET placement_backoff_from=NULL
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [project.partition.tenant, project.partition.project, admitted.execution],
    );
  }
  return { project, execution: admitted.execution };
}

test("an execution's attempts are read in the order they were opened", async () => {
  const opened = 11;
  const { project, execution } = await operationalAttemptsOpened(
    "operational-attempt-order",
    opened,
  );
  const detail = await postgresOperationalReads(ingress).execution(
    project.partition,
    execution,
  );
  assert.deepEqual(
    detail?.attempts.map((attempt) => attempt.number),
    Array.from({ length: opened }, (_unused, index) => index + 1),
  );
});

/**
 * A pool execution nobody claims reopens an attempt every lease, so one left
 * waiting overnight has more attempts than a page holds; the page keeps the
 * newest, which are the ones a run's reason and state are read from.
 */
test("an execution with more attempts than a page reads its newest, in the order they were opened", async () => {
  const opened = nativeHttpPageItemsMax + 2;
  const { project, execution } = await operationalAttemptsOpened(
    "operational-attempt-newest",
    opened,
  );
  const detail = await postgresOperationalReads(ingress).execution(
    project.partition,
    execution,
  );
  assert.deepEqual(
    detail?.attempts.map((attempt) => attempt.number),
    Array.from(
      { length: nativeHttpPageItemsMax },
      (_unused, index) => opened - nativeHttpPageItemsMax + index + 1,
    ),
  );
  assert.equal(detail?.attempts.at(-1)?.state, "Placing");
});

/** Opens an execution's next attempt now, past the backoff its last loss set. */
async function operationalReopened(
  project: SchedulerProject,
  execution: ExecutionId,
): Promise<void> {
  await rig.harness.query(
    `UPDATE execution SET placement_backoff_from=NULL
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [project.partition.tenant, project.partition.project, execution],
  );
  const retried = await rig.store.openAttempt({
    partition: project.partition,
    execution,
    epoch: project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  assert.equal(retried.opened, "Opened");
}

/**
 * Where the wait ends and the run begins, on the summary a row is drawn from.
 * It is the first attempt's opening and not the latest one's, so a retry does
 * not move it and a row can subtract it from `registeredAt` and be right.
 */
test("an execution's summary starts at its first attempt and stays there", async () => {
  const project = await schedulerProject(rig, "operational-started");
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner("operational-started"),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  const reads = postgresOperationalReads(ingress);
  const summaryOf = async (execution: string) =>
    (
      await reads.executions(project.partition, {
        limit: 10,
        ticket: id(project.ticket),
      })
    ).executions.find((each) => each.execution === execution);
  const queued = await reads.executions(project.partition, {
    limit: 10,
    ticket: id(project.ticket),
  });
  assert.ok(queued.executions.length >= 1);
  assert.deepEqual(
    queued.executions.map((each) => each.startedAt),
    queued.executions.map(() => undefined),
  );
  const placed = await schedulerPlacedAttempt(
    rig,
    project,
    "operational-started",
  );
  const opened = await reads.execution(project.partition, placed.execution);
  assert.ok(opened?.startedAt !== undefined);
  assert.equal(opened.startedAt, opened.attempts[0]?.openedAt);
  assert.equal(
    (await summaryOf(placed.execution))?.startedAt,
    opened.startedAt,
  );
  assert.equal(
    await rig.store.attemptEnded(placed.attempt, "Lost", "Vanished"),
    true,
  );
  await operationalReopened(project, placed.execution);
  assert.equal(
    (await summaryOf(placed.execution))?.startedAt,
    opened.startedAt,
  );
});

/**
 * A loss spends a retry whether or not anything follows it, so a relaunch is
 * counted from the attempt that followed and never from the retry spent.
 */
test("an execution counts a relaunch where another attempt followed a lost one, and not before", async () => {
  const project = await schedulerProject(rig, "operational-relaunch");
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner("operational-relaunch"),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  const reads = postgresOperationalReads(ingress);
  const counted = async (execution: string) => {
    const listed = (
      await reads.executions(project.partition, {
        limit: 10,
        ticket: id(project.ticket),
      })
    ).executions.find((each) => each.execution === execution);
    const detail = await reads.execution(
      project.partition,
      asExecutionId(execution),
    );
    return {
      listed: listed?.relaunches,
      detail: detail?.relaunches,
      retriesSpent: detail?.retriesSpent,
      errors: detail?.attempts.map((attempt) => attempt.error),
    };
  };
  const placed = await schedulerPlacedAttempt(
    rig,
    project,
    "operational-relaunch",
  );
  assert.equal(
    await rig.store.attemptEnded(placed.attempt, "Lost", "Vanished"),
    true,
  );
  assert.deepEqual(await counted(placed.execution), {
    listed: 0,
    detail: 0,
    retriesSpent: 1,
    errors: [undefined],
  });
  await operationalReopened(project, placed.execution);
  assert.deepEqual(await counted(placed.execution), {
    listed: 1,
    detail: 1,
    retriesSpent: 1,
    errors: [undefined, undefined],
  });
});

/** What both reads say of one execution's start, held to agree with each other. */
async function operationalRunStart(
  project: SchedulerProject,
  execution: ExecutionId,
) {
  const reads = postgresOperationalReads(ingress);
  const listed = (
    await reads.executions(project.partition, {
      limit: 10,
      ticket: id(project.ticket),
    })
  ).executions.find((each) => each.execution === execution);
  const detail = await reads.execution(project.partition, execution);
  assert.equal(listed?.runStartedAt, detail?.runStartedAt);
  return {
    status: detail?.status,
    runStartedAt: detail?.runStartedAt,
    run: detail?.attempts.at(-1)?.run?.startedAt,
  };
}

/** Records the attempt's run as its worker does once its agent starts. */
async function operationalRunRecorded(attempt: PhysicalAttempt): Promise<void> {
  const workerPool = postgresHarnessRolePool(workerPlaneRole);
  try {
    assert.equal(
      await postgresWorkerRunConfiguration(workerPool).record({
        secret: attempt.capability.secret,
        generation: attempt.generation,
        digest: asArtifactDigest("b".repeat(64)),
        bytes: 2,
      }),
      "Stored",
    );
  } finally {
    await workerPool.end();
  }
}

/**
 * An attempt opens, and a cluster places it, before its worker's image is
 * pulled, so neither says the worker started; its run does, and only while the
 * attempt that recorded it is the one open. A relaunch opens under an
 * execution already Running, so the status cannot say it either.
 */
test("a summary says when the open attempt's run started, and not before or after", async () => {
  const label = "operational-run-started";
  const project = await schedulerProject(rig, label);
  await operationalRegistered(project, project.request, label);
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  const read = () => operationalRunStart(project, admitted.execution);
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  assert.ok(opened.opened === "Opened");
  const unstarted = { runStartedAt: undefined, run: undefined };
  assert.deepEqual(await read(), { status: "Launching", ...unstarted });
  assert.equal(
    await rig.store.attemptPlaced(
      opened.attempt,
      asPlacementId(`placement-${label}`),
    ),
    true,
  );
  assert.deepEqual(await read(), { status: "Running", ...unstarted });
  await operationalRunRecorded(opened.attempt);
  const started = await read();
  assert.ok(started.run !== undefined);
  assert.deepEqual(started, {
    status: "Running",
    runStartedAt: started.run,
    run: started.run,
  });
  assert.equal(
    await rig.store.attemptEnded(opened.attempt, "Lost", "Vanished"),
    true,
  );
  assert.deepEqual(await read(), {
    status: "Running",
    runStartedAt: undefined,
    run: started.run,
  });
  await operationalReopened(project, admitted.execution);
  assert.deepEqual(await read(), { status: "Running", ...unstarted });
});

/**
 * The carrier is the pinned stage's own, so a work task and an evaluation
 * under one revision can differ, and the evaluation's stage key is one past
 * the index of the block it runs.
 */
test("a summary names what carries out its stage, read from the revision it pinned", async () => {
  const label = "operational-carrier";
  const project = await schedulerProject(
    rig,
    label,
    { tasks: 1 },
    canonicalConfigurationOf({
      ...(JSON.parse(postgresHarnessConfiguration) as object),
      evaluations: [{ purpose: "Check", checks: ["./check"] }],
    }),
  );
  await operationalRegistered(project, project.request, label);
  const request = await schedulerEvaluationRequest(rig, project, label, {
    cycle: 1,
    stage: 1,
    generation: 1,
    evaluator: 1,
  });
  await operationalRegistered(project, request, label);
  const reads = postgresOperationalReads(ingress);
  const page = await reads.executions(project.partition, {
    limit: 10,
    ticket: id(project.ticket),
  });
  assert.deepEqual(
    page.executions.map((each) => [each.taskKind, each.carrier]),
    [
      ["Work", "Agent"],
      ["Evaluation", "Commands"],
    ],
  );
  const detail = await reads.execution(
    project.partition,
    page.executions[1]?.execution ?? asExecutionId("absent"),
  );
  assert.equal(detail?.carrier, "Commands");
});
