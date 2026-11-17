/**
 * Admission and launch take a started ticket's execution before an unstarted
 * ticket's, past the reservation deficit admission leads with, so a freed slot
 * goes to a ticket's evaluation rather than to older work of a ticket not yet
 * begun.
 *
 * EACH ADMISSION CASE MAKES ITS STARTED TICKET THE SAME WAY: its work is
 * registered and admitted, unstarted work is registered after it, and only
 * then its evaluation, so the unstarted work is the older of what is queued.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import {
  schedulerClaimFor,
  schedulerEvaluationRequest,
  schedulerExecutions,
  schedulerFurtherTicket,
  schedulerInCluster,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
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

/** Registers every logical task one request of the project authorizes. */
async function startedFirstRegister(
  project: SchedulerProject,
  request: string,
  label: string,
): Promise<void> {
  const registered = await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      request,
      schedulerOwner(label),
    ),
    executionSchedulerDefaults.nTasks,
    schedulerInCluster,
  );
  assert.equal(registered.registered, "Registered");
}

/** The execution one request of the project registered, of the one task each case's requests declare. */
async function startedFirstExecution(
  project: SchedulerProject,
  request: string,
): Promise<string> {
  const found = (await rig.harness.query(
    `SELECT execution FROM execution
      WHERE tenant=$1 AND project=$2 AND source_request=$3`,
    [project.partition.tenant, project.partition.project, request],
  )) as readonly { execution: string }[];
  assert.equal(found.length, 1);
  return String(found[0]?.execution);
}

/** One project's started and unstarted tickets, each with one execution queued: what every case ranks. */
interface StartedFirstQueue {
  readonly started: string;
  readonly unstarted: string;
}

/**
 * Registers the project's ticket's work and admits it, then another ticket's
 * work and whatever else `beforeEvaluation` registers, then the first ticket's
 * evaluation, leaving all but the first work queued.
 */
async function startedFirstQueue(
  project: SchedulerProject,
  label: string,
  beforeEvaluation: () => Promise<void> = async () => {},
): Promise<StartedFirstQueue> {
  await startedFirstRegister(project, project.request, label);
  const work = await rig.store.admit(project.cluster);
  assert.deepEqual(work, {
    admitted: "Admitted",
    execution: await startedFirstExecution(project, project.request),
  });
  const further = await schedulerFurtherTicket(
    rig,
    project,
    project.memory,
    `${label}-unstarted`,
    1,
  );
  await startedFirstRegister(project, further.request, `${label}-unstarted`);
  await beforeEvaluation();
  const evaluation = await schedulerEvaluationRequest(rig, project, label, {
    cycle: 1,
    stage: 1,
    generation: 1,
    evaluator: 1,
  });
  await startedFirstRegister(project, evaluation, `${label}-evaluation`);
  return {
    started: await startedFirstExecution(project, evaluation),
    unstarted: await startedFirstExecution(project, further.request),
  };
}

/** What each of the project's executions is, by execution. */
async function startedFirstStatuses(
  project: SchedulerProject,
): Promise<ReadonlyMap<string, string>> {
  const rows = await schedulerExecutions(rig, project.partition);
  return new Map(rows.map((row) => [row.execution, row.status]));
}

test("an account at its maximum admits a started ticket's evaluation before an older unstarted ticket's work", async () => {
  const project = await schedulerProject(rig, "started-account", {
    slotsMax: 8,
    maximum: 2,
    tasks: 1,
  });
  const queue = await startedFirstQueue(project, "started-account");
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: queue.started,
  });
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "AccountAtMaximum",
  });
  assert.equal(
    (await startedFirstStatuses(project)).get(queue.unstarted),
    "Queued",
  );
});

test("a binding cluster admits an account owed its reservation first, then a started ticket's evaluation before another account's older work", async () => {
  const project = await schedulerProject(rig, "started-cluster", {
    slotsMax: 3,
    reserved: 0,
    maximum: 8,
    tasks: 1,
  });
  const other = await schedulerProject(rig, "started-cluster-other", {
    cluster: project.cluster,
    reserved: 0,
    maximum: 8,
    tasks: 1,
  });
  const owed = await schedulerProject(rig, "started-cluster-owed", {
    cluster: project.cluster,
    reserved: 1,
    maximum: 8,
    tasks: 1,
  });
  const queue = await startedFirstQueue(project, "started-cluster", () =>
    startedFirstRegister(other, other.request, "started-cluster-other"),
  );
  await startedFirstRegister(owed, owed.request, "started-cluster-owed");
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: await startedFirstExecution(owed, owed.request),
  });
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: queue.started,
  });
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "ClusterFull",
  });
  assert.equal(
    (await startedFirstStatuses(project)).get(queue.unstarted),
    "Queued",
  );
  assert.deepEqual(
    [...(await startedFirstStatuses(other)).values()],
    ["Queued"],
  );
});

test("launch offers an admitted started ticket's evaluation before older admitted work of an unstarted ticket", async () => {
  const project = await schedulerProject(rig, "started-launch", {
    slotsMax: 8,
    maximum: 8,
    tasks: 1,
  });
  await startedFirstRegister(project, project.request, "started-launch");
  const work = await rig.store.admit(project.cluster);
  assert.ok(work.admitted === "Admitted");
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: work.execution,
    epoch: project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
    runtime: schedulerRuntime,
  });
  assert.equal(opened.opened, "Opened");
  const further = await schedulerFurtherTicket(
    rig,
    project,
    project.memory,
    "started-launch-unstarted",
    1,
  );
  await startedFirstRegister(
    project,
    further.request,
    "started-launch-unstarted",
  );
  const unstarted = await startedFirstExecution(project, further.request);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: unstarted,
  });
  const evaluation = await schedulerEvaluationRequest(
    rig,
    project,
    "started-launch",
    { cycle: 1, stage: 1, generation: 1, evaluator: 1 },
  );
  await startedFirstRegister(project, evaluation, "started-launch-evaluation");
  const started = await startedFirstExecution(project, evaluation);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: started,
  });
  const waiting = await rig.store.unlaunched(project.epoch, 256);
  assert.deepEqual(
    waiting
      .filter((row) => row.partition.project === project.partition.project)
      .map((row) => row.execution),
    [started, unstarted],
  );
});
