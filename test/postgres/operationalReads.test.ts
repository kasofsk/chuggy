import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import { workerPlaneRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerRunTotal,
  postgresWorkerRunTranscript,
} from "../../src/adapters/postgres/workerPlane.ts";
import { asArtifactDigest } from "../../src/interpreter/resultManifest.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import { id } from "../domain/fixtures.ts";
import {
  schedulerClaimFor,
  schedulerExecutions,
  schedulerFurtherTicket,
  schedulerIngressPool,
  schedulerOwner,
  schedulerPlacedAttempt,
  schedulerProject,
  schedulerRigOpen,
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
    (await rig.store.registerSpawn(claim, executionSchedulerDefaults.nTasks))
      .registered,
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
    (await rig.store.registerSpawn(claim, executionSchedulerDefaults.nTasks))
      .registered,
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

test("an execution's attempts are read in the order they were opened", async () => {
  const project = await schedulerProject(rig, "operational-attempt-order");
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner("operational-attempt-order"),
    ),
    executionSchedulerDefaults.nTasks,
  );
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  const opened = 11;
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
  const detail = await postgresOperationalReads(ingress).execution(
    project.partition,
    admitted.execution,
  );
  assert.deepEqual(
    detail?.attempts.map((attempt) => attempt.number),
    Array.from({ length: opened }, (_unused, index) => index + 1),
  );
});
