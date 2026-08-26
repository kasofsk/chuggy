/**
 * The two narrow things the rest of the installation learns from the execution
 * scheduler, driven as the role that will actually ask: that the advisory
 * context answers for one project and counts no other's, and that the hard
 * backlog guard names the ceiling that stopped a dispatch.
 *
 * THE COUNTS ARE ALL DIFFERENT ON PURPOSE. A fixture whose statuses hold equal
 * numbers cannot tell a correct read from one that swapped two fields, so the
 * project below is driven into a shape where every count the port returns is a
 * different number — including the cluster total against the project's own
 * account, which is where a leak across the project boundary would show.
 *
 * THE INGRESS ROLE HOLDS NOTHING BEHIND THE FUNCTIONS. The last case is what
 * makes the first two mean anything: the same credential that may ask cannot
 * read `execution` or capacity policy at all, so the function's return type is
 * the whole of what crosses the boundary.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type pg from "pg";

import {
  postgresExecutionBacklogGuard,
  postgresExecutionContextRead,
} from "../../src/adapters/postgres/schedulerContext.ts";
import {
  activeWorkFunction,
  apiRole,
  backlogFunction,
} from "../../src/adapters/postgres/schema.ts";
import {
  asPlacementId,
  executionSchedulerDefaults,
} from "../../src/interpreter/executionScheduler.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import type { ExecutionContextRead } from "../../src/interpreter/schedulerContext.ts";
import { postgresHarnessDenial } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerExecutions,
  schedulerIngressPool,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;
let ingress: pg.Pool;
let context: ExecutionContextRead;

before(async () => {
  rig = await schedulerRigOpen();
  ingress = schedulerIngressPool();
  context = postgresExecutionContextRead(ingress);
});

after(async () => {
  await ingress.end();
  await rig.close();
});

/**
 * The shape the counted project is driven into. Every number here is distinct
 * from every other, which is the whole reason they are written down rather than
 * derived: the case is about which count lands in which field.
 */
const counted = {
  tasks: 10,
  admissions: 6,
  attempts: 4,
  placements: 3,
  reserved: 11,
  maximum: 11,
  slotsMax: 12,
  neighbourMaximum: 4,
};

/** Registers every logical task one project's spawn request authorizes. */
async function registerAll(project: SchedulerProject, label: string) {
  return rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    executionSchedulerDefaults.nTasks,
  );
}

/** The project's registrations that currently hold a slot without a live attempt. */
async function admittedOf(project: SchedulerProject): Promise<string[]> {
  return (await schedulerExecutions(rig, project.partition))
    .filter((row) => row.status === "Admitted")
    .map((row) => row.execution);
}

/** Drives one project into the counted shape, with a neighbour holding a slot beside it. */
async function countedProject(label: string): Promise<SchedulerProject> {
  const project = await schedulerProject(rig, label, {
    slotsMax: counted.slotsMax,
    reserved: counted.reserved,
    maximum: counted.maximum,
    tasks: counted.tasks,
  });
  const neighbour = await schedulerProject(rig, `${label}-neighbour`, {
    cluster: project.cluster,
    maximum: counted.neighbourMaximum,
    tasks: 1,
  });
  await registerAll(neighbour, `${label}-neighbour`);
  assert.equal((await rig.store.admit(project.cluster)).admitted, "Admitted");
  await registerAll(project, label);
  for (let taken = 0; taken < counted.admissions; taken += 1) {
    assert.equal((await rig.store.admit(project.cluster)).admitted, "Admitted");
  }
  const admitted = await admittedOf(project);
  for (const execution of admitted.slice(0, counted.attempts)) {
    const opened = await rig.store.openAttempt({
      partition: project.partition,
      execution: asExecutionId(execution),
      epoch: project.epoch,
      leaseSecs: 300,
      retriesMax: 3,
      placementBackoffSecs: 1,
    });
    assert.ok(opened.opened === "Opened");
    if (admitted.indexOf(execution) < counted.placements) {
      assert.equal(
        await rig.store.attemptPlaced(
          opened.attempt,
          asPlacementId(`placement-${execution}`),
        ),
        true,
      );
    }
  }
  return project;
}

/**
 * What the installation was already carrying, read through a project of its own
 * that registers nothing. The installation backlog counts every project in the
 * database and the gate gives a worker one database for several suites, so the
 * count below is a delta rather than a total.
 */
async function installationBacklog(label: string): Promise<number> {
  const idle = await schedulerProject(rig, label);
  return (await context.context(idle.partition)).backlog.installation;
}

test("the advisory context reports this project's own work and this cluster's total", async () => {
  const carried = await installationBacklog("context-carried");
  const project = await countedProject("context");
  const account = `${String(Buffer.byteLength(project.partition.tenant))}:${project.partition.tenant}${String(Buffer.byteLength(project.partition.project))}:${project.partition.project}`;
  assert.deepEqual(await context.context(project.partition), {
    activeWork: {
      partition: project.partition,
      queued: counted.tasks - counted.admissions,
      admitted: counted.admissions - counted.attempts,
      launching: counted.attempts - counted.placements,
      running: counted.placements,
    },
    capacity: {
      clusterSlotsMax: counted.slotsMax,
      clusterActive: counted.admissions + 1,
      accountMaximum: counted.maximum,
      accountActive: counted.admissions,
      accountReservationDeficit: counted.reserved - counted.admissions,
    },
    account,
    backlog: {
      project: counted.tasks,
      installation: carried + counted.tasks + 1,
    },
  });
});

test("the advisory context of an untouched project counts nothing at all", async () => {
  const project = await schedulerProject(rig, "quiet", {
    slotsMax: 5,
    reserved: 2,
    maximum: 3,
  });
  const answered = await context.context(project.partition);
  assert.deepEqual(answered.activeWork, {
    partition: project.partition,
    queued: 0,
    admitted: 0,
    launching: 0,
    running: 0,
  });
  assert.deepEqual(answered.capacity, {
    clusterSlotsMax: 5,
    clusterActive: 0,
    accountMaximum: 3,
    accountActive: 0,
    accountReservationDeficit: 2,
  });
});

test("the guard admits below both ceilings and names the project ceiling at it", async () => {
  const project = await schedulerProject(rig, "projectceiling", { tasks: 3 });
  await registerAll(project, "projectceiling");
  const roomy = postgresExecutionBacklogGuard(ingress, {
    ...executionSchedulerDefaults,
    projectBacklogMax: 1_000,
    installationBacklogMax: 1_000_000,
    backlogRetryAfterSeconds: 5,
  });
  assert.deepEqual(await roomy.admitsDispatch(project.partition), {
    admits: "Admits",
  });
  const tight = postgresExecutionBacklogGuard(ingress, {
    ...executionSchedulerDefaults,
    projectBacklogMax: 2,
    installationBacklogMax: 1_000_000,
    backlogRetryAfterSeconds: 7,
  });
  assert.deepEqual(await tight.admitsDispatch(project.partition), {
    admits: "Backlogged",
    scope: "Project",
    retryAfterSeconds: 7,
  });
});

test("the guard names the installation ceiling when the project is inside its own", async () => {
  const project = await schedulerProject(rig, "installationceiling", {
    tasks: 1,
  });
  await registerAll(project, "installationceiling");
  const guard = postgresExecutionBacklogGuard(ingress, {
    ...executionSchedulerDefaults,
    projectBacklogMax: 1_000,
    installationBacklogMax: 1,
    backlogRetryAfterSeconds: 11,
  });
  assert.deepEqual(await guard.admitsDispatch(project.partition), {
    admits: "Backlogged",
    scope: "Installation",
    retryAfterSeconds: 11,
  });
});

test("the ingress credential reads only the operational projection columns", async () => {
  const project = await schedulerProject(rig, "ingress");
  const named = `'${project.partition.tenant}','${project.partition.project}'`;
  for (const call of [activeWorkFunction, backlogFunction]) {
    assert.equal(
      await rig.harness.attemptAs(apiRole, `SELECT * FROM ${call}(${named})`),
      undefined,
    );
  }
  for (const [statement, relation] of [
    ["SELECT account FROM execution", "execution"],
    ["SELECT lease_owner FROM execution_attempt", "execution_attempt"],
    ["SELECT execution FROM execution_result", "execution_result"],
    ["SELECT count(*) FROM capacity_account", "capacity_account"],
    ["SELECT count(*) FROM execution_cluster", "execution_cluster"],
    ["SELECT count(*) FROM scheduler_incident", "scheduler_incident"],
  ] as const) {
    assert.match(
      (await rig.harness.attemptAs(apiRole, statement)) ?? "",
      postgresHarnessDenial(relation),
    );
  }
  for (const relation of [
    "execution",
    "execution_attempt",
    "execution_result",
    "execution_result_artifact",
  ]) {
    assert.equal(
      await rig.harness.attemptAs(apiRole, `SELECT count(*) FROM ${relation}`),
      undefined,
    );
  }
});
