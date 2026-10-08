/**
 * Whether the scheduler's own role can read what a failed landing left a
 * rework, asked of the server by running it. The rework's bundle is written as
 * the writer writes one after `TicketFinalizationNeedsWork`, beside a source a
 * real passed work result recorded, so the read is held to the rows a landing
 * actually leaves and not to rows shaped for it.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { postgresFailedLanding } from "../../src/adapters/postgres/evaluationReports.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import {
  schedulerClaimFor,
  schedulerHarnessCommit,
  schedulerOwner,
  schedulerPlacedAttempt,
  schedulerProject,
  schedulerReport,
  schedulerRigOpen,
  schedulerInCluster,
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

const targetCommit = "b".repeat(40);

/** Admits, places and settles the next execution, answering the manifest it reported under. */
async function landingSettled(
  project: SchedulerProject,
  verdict: "Pass" | "Fail",
  label: string,
): Promise<string> {
  const placed = await schedulerPlacedAttempt(rig, project, label);
  const outcome = await rig.store.terminalize(
    schedulerReport(placed.attempt, verdict),
  );
  assert.equal(outcome.terminalized, "Terminalized");
  return placed.attempt.capability.manifest;
}

/**
 * A rework spawn on the project's ticket whose own bundle pins what a failed
 * landing's evidence names, in the order the writer pins it, and registers it.
 */
async function landingRework(
  project: SchedulerProject,
  task: number,
  references: readonly (readonly [string, string])[],
): Promise<void> {
  const bundle = `bundle-landing-${randomUUID()}`;
  const digest = "c".repeat(64);
  const request = `request-landing-${randomUUID()}`;
  const { tenant, project: projectId } = project.partition;
  await rig.harness.query(
    `INSERT INTO input_bundle (tenant,project,bundle,digest) VALUES ($1,$2,$3,$4)`,
    [tenant, projectId, bundle, digest],
  );
  for (const [ordinal, [kind, reference]] of references.entries()) {
    await rig.harness.query(
      `INSERT INTO input_bundle_reference
         (tenant,project,bundle,ordinal,reference_kind,reference_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenant, projectId, bundle, ordinal + 1, kind, reference],
    );
  }
  await rig.harness.query(
    `INSERT INTO execution_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
        kind,capacity_account,configuration_revision,configuration_digest,
        input_bundle,input_bundle_digest)
     SELECT tenant,project,$4,authorizing_seq,effect_position+$5,ticket,ticket_version,
            'SpawnWork',capacity_account,configuration_revision,configuration_digest,$6,$7
       FROM execution_request
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [tenant, projectId, project.request, request, task, bundle, digest],
  );
  await rig.harness.query(
    `INSERT INTO execution_request_task
       (tenant,project,request,task,kind,cycle,stage,generation,evaluator)
     VALUES ($1,$2,$3,$4,'Work',$4,NULL,NULL,NULL)`,
    [tenant, projectId, request, task],
  );
  const outcome = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      request,
      schedulerOwner(`landing-${String(task)}`),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  assert.equal(outcome.registered, "Registered");
}

/** A project with its first work spawn registered. */
async function landingProject(label: string): Promise<SchedulerProject> {
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const outcome = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  assert.equal(outcome.registered, "Registered");
  return project;
}

/** What the scheduler's role reads for the next execution admitted. */
async function landingRead(project: SchedulerProject) {
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  return postgresFailedLanding(rig.pool).landing(
    project.partition,
    admitted.execution,
  );
}

/** The references a failed landing's rework pins, the result manifest and the conflict manifest as named. */
function landingReferences(
  manifest: string,
  conflict: boolean,
): readonly (readonly [string, string])[] {
  return [
    ["ConfigurationRevision", "revision"],
    ["Repository", "repository"],
    ["ResultManifest", manifest],
    ["FinalizationAttempt", `attempt-${randomUUID()}`],
    ["TargetCommit", targetCommit],
    ...(conflict
      ? [["ConflictManifest", `conflict-${randomUUID()}`] as const]
      : []),
  ];
}

test("the scheduler role reads the commits a failed landing left its rework, and nothing for any other task", async () => {
  const project = await landingProject("failed-landing");
  const first = await rig.store.admit(project.cluster);
  assert.ok(first.admitted === "Admitted");
  assert.deepEqual(
    await postgresFailedLanding(rig.pool).landing(
      project.partition,
      first.execution,
    ),
    { read: "Landing" },
    "a first work task follows no landing",
  );
  const placed = await rig.store.openAttempt({
    partition: project.partition,
    execution: first.execution,
    epoch: project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  assert.ok(placed.opened === "Opened");
  const passed = await rig.store.terminalize(
    schedulerReport(placed.attempt, "Pass"),
  );
  assert.equal(passed.terminalized, "Terminalized");
  const sourced = placed.attempt.capability.manifest;

  await landingRework(project, 2, landingReferences(sourced, true));
  assert.deepEqual(await landingRead(project), {
    read: "Landing",
    landing: {
      targetCommit,
      changeCommit: schedulerHarnessCommit,
      conflicted: true,
    },
  });

  await landingRework(project, 3, landingReferences(sourced, false));
  assert.deepEqual(await landingRead(project), {
    read: "Landing",
    landing: {
      targetCommit,
      changeCommit: schedulerHarnessCommit,
      conflicted: false,
    },
  });
});

test("a failed landing whose result manifest recorded no source still answers, without the change's commit", async () => {
  const project = await landingProject("failed-landing-unsourced");
  const unsourced = await landingSettled(project, "Fail", "unsourced");

  await landingRework(project, 2, landingReferences(unsourced, true));
  assert.deepEqual(await landingRead(project), {
    read: "Landing",
    landing: { targetCommit, conflicted: true },
  });
});
