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
