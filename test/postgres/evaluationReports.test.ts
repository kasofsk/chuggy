/**
 * Whether the scheduler's own role can run the prior-work read, asked of the
 * server by running it. A table the deployment revoked reads exactly like a
 * query that parses, so this drives the adapter on a scheduler-role pool over
 * rows a real registration, placement and report left behind.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import {
  postgresPriorEvaluationReports,
  postgresPriorWorkReports,
} from "../../src/adapters/postgres/evaluationReports.ts";
import {
  executionSchedulerDefaults,
  type AttemptReport,
  type PhysicalAttempt,
} from "../../src/interpreter/executionScheduler.ts";
import { acceptResultManifest } from "../../src/interpreter/resultManifest.ts";
import {
  schedulerClaimFor,
  schedulerDigest,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;

before(async () => {
  rig = await schedulerRigOpen();
});

after(async () => {
  await rig.close();
});

/** The execution one admitted registration names, with an attempt open on it. */
async function admittedAttempt(
  project: SchedulerProject,
): Promise<PhysicalAttempt> {
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(
    admitted.admitted === "Admitted",
    `admission was ${admitted.admitted}`,
  );
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  assert.ok(opened.opened === "Opened", `attempt was ${opened.opened}`);
  return opened.attempt;
}

/** A worker's report sealed by the acceptance a real ingress applies, summary and all. */
function reportingManifest(
  attempt: PhysicalAttempt,
  report: string,
  verdict: "Pass" | "Fail" = "Pass",
): AttemptReport {
  const accepted = acceptResultManifest(
    {
      partition: attempt.partition,
      execution: attempt.execution,
      attempt: attempt.attempt,
    },
    attempt.capability.manifest,
    JSON.stringify({
      version: 3,
      verdict,
      report,
      handoffs: [],
      diagnostics: [],
      source: null,
    }),
    schedulerDigest,
  );
  if (accepted.accepted === "Rejected") {
    throw new Error(
      `evaluation reports: the fixture manifest was ${accepted.code}`,
    );
  }
  return { ...attempt, manifest: accepted.manifest };
}

/** Pins one settled manifest into the bundle the project's spawn request consumes. */
async function bundlePins(
  project: SchedulerProject,
  manifest: string,
  kind: string,
): Promise<void> {
  const pinned = await rig.harness.query(
    `INSERT INTO input_bundle_reference
       (tenant,project,bundle,ordinal,reference_kind,reference_id)
     SELECT q.tenant,q.project,q.input_bundle,
            (SELECT coalesce(max(b.ordinal),0)+1 FROM input_bundle_reference b
              WHERE b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle),
            $5,$4
       FROM execution_request q
      WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3
     RETURNING ordinal`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      manifest,
      kind,
    ],
  );
  assert.equal(pinned.length, 1, "the spawn request has a bundle to pin into");
}

test("the scheduler role reads the work reports its execution's bundle pinned", async () => {
  const project = await schedulerProject(rig, "prior-work", { tasks: 2 });
  const registered = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner("prior-work"),
    ),
    executionSchedulerDefaults.nTasks,
  );
  assert.equal(registered.registered, "Registered");
  const worked = await admittedAttempt(project);
  const report = "Changed the importer and ran its focused test.";
  const settled = await rig.store.terminalize(
    reportingManifest(worked, report),
  );
  assert.equal(settled.terminalized, "Terminalized");
  await bundlePins(project, worked.capability.manifest, "ResultManifest");
  await bundlePins(project, worked.capability.manifest, "ConflictManifest");
  const evaluating = await rig.store.admit(project.cluster);
  assert.ok(evaluating.admitted === "Admitted");

  assert.deepEqual(
    await postgresPriorWorkReports(rig.pool).reports(
      project.partition,
      evaluating.execution,
    ),
    { read: "Reports", reports: { reports: [report] } },
  );
});

/**
 * A further spawn request on the project's ticket, declaring the named tasks
 * after the ones already spawned: the row the writer leaves when a stage or a
 * rework is spawned, written by the case because no writer runs here.
 */
async function furtherSpawn(
  project: SchedulerProject,
  kind: "SpawnWork" | "SpawnEvaluation",
  tasks: readonly number[],
  position: number,
): Promise<string> {
  const request = `request-${kind}-${randomUUID()}`;
  await rig.harness.query(
    `INSERT INTO execution_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
        kind,capacity_account,configuration_revision,configuration_digest,
        input_bundle,input_bundle_digest)
     SELECT q.tenant,q.project,$4,q.authorizing_seq,q.effect_position+$5,q.ticket,
            q.ticket_version,$6,q.capacity_account,
            q.configuration_revision,q.configuration_digest,
            q.input_bundle,q.input_bundle_digest
       FROM execution_request q
      WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      request,
      position,
      kind,
    ],
  );
  for (const task of tasks) {
    await rig.harness.query(
      `INSERT INTO execution_request_task (tenant,project,request,task,kind,stage)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        project.partition.tenant,
        project.partition.project,
        request,
        task,
        kind === "SpawnWork" ? "Work" : "Evaluation",
        kind === "SpawnWork" ? null : 0,
      ],
    );
  }
  return request;
}

/** Registers one spawn request's executions through the real store. */
async function registered(
  project: SchedulerProject,
  request: string,
  label: string,
): Promise<void> {
  const outcome = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      request,
      schedulerOwner(label),
    ),
    executionSchedulerDefaults.nTasks,
  );
  assert.equal(outcome.registered, "Registered");
}

/** Admits the next execution, opens its attempt and settles it with this report. */
async function settled(
  project: SchedulerProject,
  report: string,
  verdict: "Pass" | "Fail",
): Promise<PhysicalAttempt> {
  const attempt = await admittedAttempt(project);
  const outcome = await rig.store.terminalize(
    reportingManifest(attempt, report, verdict),
  );
  assert.equal(outcome.terminalized, "Terminalized");
  return attempt;
}

test("the scheduler role reads the failed reports of the evaluation a rework follows", async () => {
  const project = await schedulerProject(rig, "prior-eval", { tasks: 1 });
  await registered(project, project.request, "prior-eval-work");
  const first = await settled(project, "Changed the importer.", "Pass");
  assert.deepEqual(
    await postgresPriorEvaluationReports(rig.pool).reports(
      project.partition,
      first.execution,
    ),
    { read: "Reports", reports: { reports: [] } },
    "a first attempt follows no evaluation",
  );
  const evaluation = await furtherSpawn(project, "SpawnEvaluation", [2, 3], 1);
  await registered(project, evaluation, "prior-eval-stage");
  const failed = ".chug/tasks/ci.sh exited 1; last output: format FAILED";
  await settled(project, failed, "Fail");
  await settled(project, "APPROVE — every criterion is met.", "Pass");
  const rework = await furtherSpawn(project, "SpawnWork", [4], 2);
  await registered(project, rework, "prior-eval-rework");
  const reworking = await rig.store.admit(project.cluster);
  assert.ok(reworking.admitted === "Admitted");

  assert.deepEqual(
    await postgresPriorEvaluationReports(rig.pool).reports(
      project.partition,
      reworking.execution,
    ),
    { read: "Reports", reports: { reports: [failed] } },
  );
});
