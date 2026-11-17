/**
 * The hard backlog guard the rest of the installation consults, driven as the
 * role that will actually ask: that it names the ceiling that stopped a
 * dispatch, and that the same credential reads nothing behind it.
 *
 * THE INGRESS ROLE HOLDS NOTHING BEHIND THE FUNCTIONS. The last case is what
 * makes the others mean anything: the same credential that may ask cannot
 * read `execution` or capacity policy at all, so the function's return type is
 * the whole of what crosses the boundary.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type pg from "pg";

import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import {
  activeWorkFunction,
  apiRole,
  backlogFunction,
} from "../../src/adapters/postgres/schema.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import { postgresHarnessDenial } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerIngressPool,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  schedulerInCluster,
  type SchedulerProject,
  type SchedulerRig,
} from "./schedulerHarness.ts";

let rig: SchedulerRig;
let ingress: pg.Pool;

before(async () => {
  rig = await schedulerRigOpen();
  ingress = schedulerIngressPool();
});

after(async () => {
  await ingress.end();
  await rig.close();
});

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
    schedulerInCluster,
  );
}

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
