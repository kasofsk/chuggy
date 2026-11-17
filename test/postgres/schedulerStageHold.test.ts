/**
 * A slot a started ticket's completion freed waits for that ticket's next
 * stage: admission gives no unstarted ticket's execution the slot while the
 * ticket service has not answered the completion, nor while the stage it
 * answered with is unregistered, and then the stage takes it.
 *
 * EVERY CASE RUNS ITS STARTED TICKET THROUGH THE REAL PATH: the scheduler
 * reports its work, the writer decides the completion that leaves, and the
 * scheduler registers the evaluation that decision spawned.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  executionSchedulerDefaults,
  type ExecutionId,
} from "../../src/interpreter/executionScheduler.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import { postgresHarnessDrain } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerExecutions,
  schedulerFurtherTicket,
  schedulerInCluster,
  schedulerOwner,
  schedulerProject,
  schedulerReport,
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
async function stageHoldRegister(
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
async function stageHoldExecution(
  project: SchedulerProject,
  request: string,
): Promise<ExecutionId> {
  const found = (await rig.harness.query(
    `SELECT execution FROM execution
      WHERE tenant=$1 AND project=$2 AND source_request=$3`,
    [project.partition.tenant, project.partition.project, request],
  )) as readonly { execution: ExecutionId }[];
  assert.equal(found.length, 1);
  const [only] = found;
  assert.ok(only !== undefined);
  return only.execution;
}

/** Runs one admitted execution and reports it passed, which submits its completion. */
async function stageHoldPassed(
  project: SchedulerProject,
  execution: ExecutionId,
): Promise<void> {
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution,
    epoch: project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
    runtime: schedulerRuntime,
  });
  assert.ok(opened.opened === "Opened", `opening was ${opened.opened}`);
  const settled = await rig.store.terminalize(
    schedulerReport(opened.attempt, "Pass"),
  );
  assert.equal(settled.terminalized, "Terminalized");
}

/** The project's ticket's one open evaluation spawn. */
async function stageHoldEvaluationRequest(
  project: SchedulerProject,
): Promise<string> {
  const open = (await rig.harness.query(
    `SELECT request FROM execution_request
      WHERE tenant=$1 AND project=$2 AND ticket=$3
        AND kind='SpawnEvaluation' AND state='Open'`,
    [project.partition.tenant, project.partition.project, project.ticket],
  )) as readonly { request: string }[];
  assert.equal(open.length, 1, "the completion spawned one evaluation");
  const [only] = open;
  assert.ok(only !== undefined);
  return only.request;
}

/** What one of the project's executions is. */
async function stageHoldStatus(
  project: SchedulerProject,
  execution: ExecutionId,
): Promise<string | undefined> {
  const rows = await schedulerExecutions(rig, project.partition);
  return rows.find((row) => row.execution === execution)?.status;
}

/** A started ticket whose work ran and whose evaluation was then admitted, and what the writer knows after. */
interface StageHoldEvaluated {
  readonly evaluation: ExecutionId;
  readonly memory: ProjectMemory;
}

/**
 * Admits the project's ticket's work, runs it to a pass, and then shows that
 * admission in `cluster` holds the freed slot back from what else is queued
 * until the completion is answered and its evaluation registered, and that
 * the evaluation then takes it.
 */
async function stageHoldEvaluated(
  project: SchedulerProject,
  memory: ProjectMemory,
): Promise<StageHoldEvaluated> {
  const work = await stageHoldExecution(project, project.request);
  await stageHoldPassed(project, work);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "HeldBetweenStages",
  });
  const answered = await postgresHarnessDrain(
    rig.harness,
    project.partition,
    memory,
  );
  const request = await stageHoldEvaluationRequest(project);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "HeldBetweenStages",
  });
  await stageHoldRegister(project, request, "stage-hold-evaluation");
  const evaluation = await stageHoldExecution(project, request);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: evaluation,
  });
  return { evaluation, memory: answered.memory };
}

/** A project whose ticket's work is admitted, and another ticket of it whose work is queued behind it. */
async function stageHoldAccount(label: string) {
  const project = await schedulerProject(rig, label, {
    slotsMax: 8,
    reserved: 0,
    maximum: 1,
    tasks: 1,
  });
  await stageHoldRegister(project, project.request, label);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: await stageHoldExecution(project, project.request),
  });
  const further = await schedulerFurtherTicket(
    rig,
    project,
    project.memory,
    `${label}-unstarted`,
    1,
  );
  await stageHoldRegister(project, further.request, `${label}-unstarted`);
  const unstarted = await stageHoldExecution(project, further.request);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "AccountAtMaximum",
  });
  return { project, unstarted, memory: further.memory };
}

test("an account at its maximum holds a started ticket's freed slot from an unstarted ticket until its evaluation is admitted", async () => {
  const { project, unstarted, memory } =
    await stageHoldAccount("stage-hold-account");
  await stageHoldEvaluated(project, memory);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "AccountAtMaximum",
  });
  assert.equal(await stageHoldStatus(project, unstarted), "Queued");
});

test("a binding cluster holds a started ticket's freed slot from another account's unstarted ticket until its evaluation is admitted", async () => {
  const project = await schedulerProject(rig, "stage-hold-cluster", {
    slotsMax: 1,
    reserved: 0,
    maximum: 8,
    tasks: 1,
  });
  const other = await schedulerProject(rig, "stage-hold-cluster-other", {
    cluster: project.cluster,
    reserved: 0,
    maximum: 8,
    tasks: 1,
  });
  await stageHoldRegister(project, project.request, "stage-hold-cluster");
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: await stageHoldExecution(project, project.request),
  });
  await stageHoldRegister(other, other.request, "stage-hold-cluster-other");
  const unstarted = await stageHoldExecution(other, other.request);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "ClusterFull",
  });
  await stageHoldEvaluated(project, project.memory);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "ClusterFull",
  });
  assert.equal(await stageHoldStatus(other, unstarted), "Queued");
});

test("a completion answered with no next stage ends the hold, and the unstarted ticket takes the slot", async () => {
  const { project, unstarted, memory } = await stageHoldAccount(
    "stage-hold-answered",
  );
  const evaluated = await stageHoldEvaluated(project, memory);
  await stageHoldPassed(project, evaluated.evaluation);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "HeldBetweenStages",
  });
  await postgresHarnessDrain(rig.harness, project.partition, evaluated.memory);
  const spawned = (await rig.harness.query(
    `SELECT count(*)::int AS open FROM execution_request
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND state='Open'`,
    [project.partition.tenant, project.partition.project, project.ticket],
  )) as readonly { open: number }[];
  assert.deepEqual(spawned, [{ open: 0 }]);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: unstarted,
  });
});

test("an account below its reserved share takes a slot a started ticket's completion freed", async () => {
  const project = await schedulerProject(rig, "stage-hold-reserved", {
    slotsMax: 1,
    reserved: 0,
    maximum: 8,
    tasks: 1,
  });
  const owed = await schedulerProject(rig, "stage-hold-reserved-owed", {
    cluster: project.cluster,
    reserved: 1,
    maximum: 8,
    tasks: 1,
  });
  await stageHoldRegister(project, project.request, "stage-hold-reserved");
  const work = await stageHoldExecution(project, project.request);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: work,
  });
  await stageHoldRegister(owed, owed.request, "stage-hold-reserved-owed");
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "ClusterFull",
  });
  await stageHoldPassed(project, work);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: await stageHoldExecution(owed, owed.request),
  });
});

test("a completion its own account has no room to use holds back no other account's unstarted ticket", async () => {
  const project = await schedulerProject(rig, "stage-hold-roomless", {
    slotsMax: 2,
    reserved: 0,
    maximum: 2,
    tasks: 1,
  });
  await stageHoldRegister(project, project.request, "stage-hold-roomless");
  const work = await stageHoldExecution(project, project.request);
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: work,
  });
  const further = await schedulerFurtherTicket(
    rig,
    project,
    project.memory,
    "stage-hold-roomless-further",
    1,
  );
  await stageHoldRegister(
    project,
    further.request,
    "stage-hold-roomless-further",
  );
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: await stageHoldExecution(project, further.request),
  });
  await stageHoldPassed(project, work);
  await rig.harness.query(
    `UPDATE capacity_account SET maximum=1
      WHERE account=(SELECT account FROM execution
                      WHERE tenant=$1 AND project=$2 AND execution=$3)`,
    [project.partition.tenant, project.partition.project, work],
  );
  const other = await schedulerProject(rig, "stage-hold-roomless-other", {
    cluster: project.cluster,
    reserved: 0,
    maximum: 8,
    tasks: 1,
  });
  await stageHoldRegister(other, other.request, "stage-hold-roomless-other");
  assert.deepEqual(await rig.store.admit(project.cluster), {
    admitted: "Admitted",
    execution: await stageHoldExecution(other, other.request),
  });
});
