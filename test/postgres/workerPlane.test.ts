import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { workerPlaneRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerPlaneAuthority,
  postgresWorkerArtifactReservations,
  postgresWorkerReportStore,
} from "../../src/adapters/postgres/workerPlane.ts";
import {
  artifactBytesMax,
  manifestArtifactsMax,
  manifestBytesMax,
} from "../../src/interpreter/resultManifest.ts";
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
  assert.equal(
    (await authority.authenticate(attempt.capability.secret))?.live,
    false,
  );
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
  assert.equal(await rig.store.attemptEnded(attempt, "Lost", "Vanished"), true);
  const authority = postgresWorkerPlaneAuthority(workerPool);
  assert.equal(
    await authority.authenticate(attempt.capability.secret),
    undefined,
  );
  assert.deepEqual(
    await postgresWorkerReportStore(
      workerPool,
      attempt.capability.secret,
    ).terminalize(schedulerReport(attempt, "Pass")),
    { terminalized: "Fenced" },
  );
});

test("artifact reservations are immutable, concurrent, bounded and fenced", async () => {
  const attempt = await placedAttempt("worker-artifacts");
  const reservations = postgresWorkerArtifactReservations(workerPool);
  const reserve = (path: string, digest: string, bytes = 1) =>
    reservations.reserve({
      secret: attempt.capability.secret,
      path,
      digest,
      bytes,
    });
  const digest = "a".repeat(64);
  assert.deepEqual(await reserve("same.txt", digest), {
    reserved: "Reserved",
  });
  assert.deepEqual(await reserve("same.txt", digest), {
    reserved: "Reserved",
  });
  assert.deepEqual(await reserve("same.txt", "b".repeat(64)), {
    reserved: "Conflict",
  });
  const concurrent = await Promise.all(
    Array.from({ length: manifestArtifactsMax - 1 }, (_unused, index) =>
      reserve(`artifact-${String(index)}.txt`, digest),
    ),
  );
  assert.equal(
    concurrent.filter((result) => result.reserved === "Reserved").length,
    manifestArtifactsMax - 1,
  );
  assert.deepEqual(await reserve("past-count.txt", digest), {
    reserved: "QuotaExceeded",
  });
  assert.equal(await rig.store.attemptEnded(attempt, "Lost", "Vanished"), true);
  assert.deepEqual(await reserve("late.txt", digest), { reserved: "Fenced" });
});

test("artifact reservation aggregate bytes are bounded without receiving content", async () => {
  const attempt = await placedAttempt("worker-artifact-bytes");
  const reservations = postgresWorkerArtifactReservations(workerPool);
  const digest = "c".repeat(64);
  const full = Math.floor(manifestBytesMax / artifactBytesMax);
  for (let index = 0; index < full; index += 1)
    assert.deepEqual(
      await reservations.reserve({
        secret: attempt.capability.secret,
        path: `large-${String(index)}.bin`,
        digest,
        bytes: artifactBytesMax,
      }),
      { reserved: "Reserved" },
    );
  assert.deepEqual(
    await reservations.reserve({
      secret: attempt.capability.secret,
      path: "past-bytes.bin",
      digest,
      bytes: manifestBytesMax - full * artifactBytesMax + 1,
    }),
    { reserved: "QuotaExceeded" },
  );
});

test("the executable result boundary refuses an over-count manifest independently", async () => {
  const attempt = await placedAttempt("worker-result-bound");
  const report = schedulerReport(attempt, "Pass");
  const artifacts = Array.from(
    { length: manifestArtifactsMax + 1 },
    (_unused, index) => ({
      ordinal: index + 1,
      role: "Diagnostic",
      path: `diagnostic-${String(index)}.txt`,
      digest: "d".repeat(64),
      bytes: 1,
    }),
  );
  const refused = await workerPool.query<{ terminalized: string }>(
    `SELECT terminalized FROM submit_worker_result($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      createHash("sha256")
        .update(attempt.capability.secret, "utf8")
        .digest("hex"),
      attempt.generation,
      report.manifest.manifest,
      report.manifest.schemaVersion,
      report.manifest.digest,
      report.manifest.verdict,
      JSON.stringify(artifacts),
      "operation-over-count",
    ],
  );
  assert.equal(refused.rows[0]?.terminalized, "Conflicting");
  assert.notEqual(
    (await rig.store.execution(attempt.partition, attempt.execution))?.status,
    "Terminal",
  );
});
