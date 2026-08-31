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
  schedulerIngressPool,
  schedulerOwner,
  schedulerPlacedAttempt,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerRig,
} from "./schedulerHarness.ts";

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
