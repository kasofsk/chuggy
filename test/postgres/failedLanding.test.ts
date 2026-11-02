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
import { postgresExecutionSourceHistory } from "../../src/adapters/postgres/executionSourceHistory.ts";
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
  schedulerRuntime,
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

/** The references a failed landing's rework pins, the result manifest, the attempt and the conflict manifest as named. */
function landingReferences(
  manifest: string,
  conflict: boolean,
  attempt = `attempt-${randomUUID()}`,
): readonly (readonly [string, string])[] {
  return [
    ["ConfigurationRevision", "revision"],
    ["Repository", "repository"],
    ["ResultManifest", manifest],
    ["FinalizationAttempt", attempt],
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
    runtime: schedulerRuntime,
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

/** The finalization request the project's ticket is landed under, and the repository it binds for it. */
interface LandingFinalization {
  readonly request: string;
  readonly repository: string;
}

/** Opens one finalization request on the project's ticket, beside the request its first spawn was made under. */
async function landingFinalization(
  project: SchedulerProject,
): Promise<LandingFinalization> {
  const request = `finalization-${randomUUID()}`;
  const repository = `repository-${randomUUID()}`;
  const { tenant, project: projectId } = project.partition;
  await rig.harness.query(
    `INSERT INTO project_repository (tenant,project,repository,recovery_epoch)
     VALUES ($1,$2,$3,$4)`,
    [tenant, projectId, repository, project.epoch],
  );
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
        request_generation,state,claim_owner,claim_generation,claim_expires_at,
        recovery_epoch,kind,work_cycle,finalization_generation)
     SELECT tenant,project,$4,authorizing_seq,effect_position+1000,ticket,ticket_version,
            1,'Open','owner',1,now(),$5,'RunFinalizer',1,1
       FROM execution_request WHERE tenant=$1 AND project=$2 AND request=$3`,
    [tenant, projectId, project.request, request, project.epoch],
  );
  return { request, repository };
}

/**
 * A failed attempt as the finalizer records one under that request, over the
 * configuration and bundle the first spawn pinned, with the failure columns a
 * case names, and its identity.
 */
async function landingAttempt(
  project: SchedulerProject,
  finalization: LandingFinalization,
  failure: {
    readonly kind: string;
    readonly baseRef?: string;
    readonly baseCommit?: string;
    readonly groupCommit?: string;
  },
): Promise<string> {
  const attempt = `attempt-${randomUUID()}`;
  const { tenant, project: projectId } = project.partition;
  await rig.harness.query(
    `INSERT INTO finalization_attempt
       (tenant,project,attempt,request,ticket,repository,input_bundle,input_bundle_digest,
        target_ref,target_commit,strategy,configuration_revision,configuration_digest,
        attempt_digest,approval_required,outcome,failure_kind,proposal_base_ref,
        proposal_base_commit,queue_group_commit)
     SELECT tenant,project,$4,$5,ticket,$6,input_bundle,input_bundle_digest,
            'refs/heads/head',$7,'Merge',configuration_revision,configuration_digest,
            repeat('d',64),false,'Failed',$8,$9,$10,$11
       FROM execution_request WHERE tenant=$1 AND project=$2 AND request=$3`,
    [
      tenant,
      projectId,
      project.request,
      attempt,
      finalization.request,
      finalization.repository,
      targetCommit,
      failure.kind,
      failure.baseRef ?? null,
      failure.baseCommit ?? null,
      failure.groupCommit ?? null,
    ],
  );
  return attempt;
}

test("the scheduler role reads why the attempt a rework pins failed, and against which base", async () => {
  const project = await landingProject("failed-landing-why");
  const sourced = await landingSettled(project, "Pass", "why");
  const baseRef = "refs/heads/trunk";
  const baseCommit = "e".repeat(40);
  const groupCommit = "f".repeat(40);

  const finalization = await landingFinalization(project);
  const queued = await landingAttempt(project, finalization, {
    kind: "QueueChecksFailed",
    baseRef,
    baseCommit,
    groupCommit,
  });
  await landingRework(project, 2, landingReferences(sourced, false, queued));
  assert.deepEqual(await landingRead(project), {
    read: "Landing",
    landing: {
      targetCommit,
      changeCommit: schedulerHarnessCommit,
      conflicted: false,
      failure: "QueueChecksFailed",
      proposalBase: { ref: baseRef, commit: baseCommit },
      groupCommit,
    },
  });

  const conflicted = await landingAttempt(project, finalization, {
    kind: "MergeConflict",
    baseRef,
    baseCommit,
  });
  await landingRework(
    project,
    3,
    landingReferences(sourced, false, conflicted),
  );
  assert.deepEqual(await landingRead(project), {
    read: "Landing",
    landing: {
      targetCommit,
      changeCommit: schedulerHarnessCommit,
      conflicted: false,
      failure: "MergeConflict",
      proposalBase: { ref: baseRef, commit: baseCommit },
    },
  });
});

/**
 * The ticket service's read of the base its latest rework was sent back to
 * bring in. Catches an earlier landing's base read over a later one's, and a
 * base kept once a later landing named none.
 */
test("the ticket service reads the base the latest failed landing named, and none where it named none", async () => {
  const project = await landingProject("failed-landing-base");
  const sourced = await landingSettled(project, "Pass", "base");
  const history = postgresExecutionSourceHistory(rig.harness.writerPool);
  const ticket = project.ticket;
  assert.equal(
    await history.failedLandingBase(project.partition, ticket),
    undefined,
    "a ticket never sent back names no base",
  );

  const finalization = await landingFinalization(project);
  const queuedBase = "e".repeat(40);
  const queued = await landingAttempt(project, finalization, {
    kind: "QueueChecksFailed",
    baseRef: "refs/heads/trunk",
    baseCommit: queuedBase,
    groupCommit: "f".repeat(40),
  });
  await landingRework(project, 2, landingReferences(sourced, false, queued));
  assert.equal(
    await history.failedLandingBase(project.partition, ticket),
    queuedBase,
  );

  const conflictedBase = "a".repeat(40);
  const conflicted = await landingAttempt(project, finalization, {
    kind: "MergeConflict",
    baseRef: "refs/heads/trunk",
    baseCommit: conflictedBase,
  });
  await landingRework(
    project,
    3,
    landingReferences(sourced, false, conflicted),
  );
  assert.equal(
    await history.failedLandingBase(project.partition, ticket),
    conflictedBase,
    "the latest landing's base wins",
  );

  const unbased = await landingAttempt(project, finalization, {
    kind: "MergeConflict",
  });
  await landingRework(project, 4, landingReferences(sourced, false, unbased));
  assert.equal(
    await history.failedLandingBase(project.partition, ticket),
    undefined,
    "a latest landing naming no base names none",
  );
});
