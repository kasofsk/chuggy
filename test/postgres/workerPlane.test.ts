import assert from "node:assert/strict";
import { after, test } from "node:test";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { workerPlaneRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerPlaneAuthority,
  postgresWorkerReportStore,
} from "../../src/adapters/postgres/workerPlane.ts";
import { asPlacementId } from "../../src/interpreter/executionScheduler.ts";
import { postgresHarnessUrl } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerOwner,
  schedulerProject,
  schedulerReport,
  schedulerRigOpen,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const workerUrl = new URL(postgresHarnessUrl());
workerUrl.searchParams.set("options", `-c role=${workerPlaneRole}`);
const workerPool = postgresPool(workerUrl.toString());

after(async () => {
  await workerPool.end();
  await rig.close();
});

async function placedAttempt(label: string) {
  const project = await schedulerProject(rig, label);
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    200,
  );
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  assert.ok(opened.opened === "Opened");
  assert.equal(
    await rig.store.attemptPlaced(
      opened.attempt,
      asPlacementId(`placement-${label}`),
    ),
    true,
  );
  return opened.attempt;
}

test("the worker role settles once and terminal authority is immediately fenced", async () => {
  const attempt = await placedAttempt("worker-terminal");
  const authority = postgresWorkerPlaneAuthority(workerPool);
  assert.equal(
    (await authority.authenticate(attempt.capability.secret))?.attempt,
    attempt.attempt,
  );
  const store = postgresWorkerReportStore(
    workerPool,
    attempt.capability.secret,
  );
  const report = schedulerReport(attempt, "Pass");
  const first = await store.terminalize(report);
  assert.equal(first.terminalized, "Terminalized");
  assert.equal(await authority.authenticate(attempt.capability.secret), undefined);
  assert.deepEqual(await store.terminalize(report), {
    terminalized: "AlreadyTerminal",
    outcome: "Passed",
    operation:
      first.terminalized === "Terminalized" ? first.operation : assert.fail(),
  });
  assert.ok(
    (await rig.store.attemptsAwaitingCleanup(200)).some(
      (candidate) => candidate.attempt === attempt.attempt,
    ),
  );
  assert.equal(await rig.store.attemptCleanupCompleted(attempt), true);
  assert.equal(await rig.store.attemptCleanupCompleted(attempt), false);
  assert.equal(
    (await rig.store.attemptsAwaitingCleanup(200)).some(
      (candidate) => candidate.attempt === attempt.attempt,
    ),
    false,
  );
});

test("the worker boundary preserves the first result and records a contradiction", async () => {
  const attempt = await placedAttempt("worker-conflict");
  const store = postgresWorkerReportStore(
    workerPool,
    attempt.capability.secret,
  );
  assert.equal(
    (await store.terminalize(schedulerReport(attempt, "Pass"))).terminalized,
    "Terminalized",
  );
  const conflict = await store.terminalize(schedulerReport(attempt, "Fail"));
  assert.equal(conflict.terminalized, "Conflicting");
  assert.ok(
    conflict.terminalized === "Conflicting" &&
      conflict.incident.startsWith("incident-"),
  );
});

test("a lost attempt cannot use its worker boundary", async () => {
  const attempt = await placedAttempt("worker-fenced");
  assert.equal(
    await rig.store.attemptEnded(attempt, "Lost", "Vanished"),
    true,
  );
  const authority = postgresWorkerPlaneAuthority(workerPool);
  assert.equal(await authority.authenticate(attempt.capability.secret), undefined);
  assert.deepEqual(
    await postgresWorkerReportStore(
      workerPool,
      attempt.capability.secret,
    ).terminalize(schedulerReport(attempt, "Pass")),
    { terminalized: "Fenced" },
  );
});
