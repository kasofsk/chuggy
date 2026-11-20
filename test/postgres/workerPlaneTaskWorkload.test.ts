/**
 * The workload a job attempt's bearer finds its task runs, driven against a
 * real PostgreSQL: read under the worker plane's own role from the revision
 * the attempt pins, with its ticket's overrides and selection applied.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import {
  apiRole,
  poolPlaneRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresWorkerTasks } from "../../src/adapters/postgres/workerPlane.ts";
import type { ConfigurationOverrides } from "../../src/contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../../src/contract/configurationSelection.ts";
import {
  canonicalConfigurationOf,
  type CanonicalConfiguration,
} from "../../src/interpreter/authoring.ts";
import {
  asAttemptCapabilitySecret,
  type AttemptCapabilitySecret,
} from "../../src/interpreter/executionScheduler.ts";
import { approvalMixedRelease } from "./approvalCatalog.ts";
import { postgresHarnessDenial, postgresHarnessRolePool } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerEvaluationRequest,
  schedulerInCluster,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  schedulerRuntime,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const planePool = postgresHarnessRolePool(workerPlaneRole);
const poolPlanePool = postgresHarnessRolePool(poolPlaneRole);
const apiPool = postgresHarnessRolePool(apiRole);
const tasks = postgresWorkerTasks(planePool);

after(async () => {
  await Promise.all([planePool.end(), poolPlanePool.end(), apiPool.end()]);
  await rig.close();
});

const agentWorkload = (text: string) => ({
  runner: "Agent",
  prompt: { text },
  worker: {
    mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
    setup: [],
    files: [],
  },
});

/** A catalog of two work workloads and two plans, each a stage of two command evaluators. */
const catalog = canonicalConfigurationOf({
  version: 2,
  image: "worker:v2",
  workloads: {
    build: agentWorkload("Build it."),
    rebuild: agentWorkload("Build it again."),
    tests: { runner: "Commands", commands: ["npm test"] },
    lint: { runner: "Commands", commands: ["npm run lint"] },
  },
  plans: {
    checks: [{ name: "checks", evaluators: ["tests", "lint"] }],
    reversed: [{ name: "checks", evaluators: ["lint", "tests"] }],
  },
  defaults: { work: "build", evaluation: "checks" },
});

/** Which task a case opens: the work, or the evaluator of the first stage keyed `evaluator`. */
type Opened = "Work" | { readonly evaluator: number };

/** The bearer of the one attempt opened on a fresh project's task. */
async function openedSecret(
  label: string,
  opened: Opened,
  configuration?: CanonicalConfiguration,
  ticket: {
    readonly overrides?: ConfigurationOverrides;
    readonly selection?: ConfigurationSelection;
  } = {},
): Promise<AttemptCapabilitySecret> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks: 1 },
    configuration,
    undefined,
    ticket.overrides,
    configuration === undefined
      ? {}
      : {
          ...approvalMixedRelease,
          ...(ticket.selection === undefined
            ? {}
            : { selection: ticket.selection }),
        },
  );
  const request =
    opened === "Work"
      ? project.request
      : await schedulerEvaluationRequest(rig, project, label, {
          cycle: 1,
          stage: 1,
          generation: 1,
          evaluator: opened.evaluator,
        });
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      request,
      schedulerOwner(label),
    ),
    200,
    schedulerInCluster,
  );
  const admitted = await rig.store.admit(project.cluster);
  if (admitted.admitted !== "Admitted")
    throw new Error(`task workload suite: ${label} admitted no execution`);
  const attempt = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs: 300,
    retriesMax: 3,
    placementBackoffSecs: 1,
    runtime: schedulerRuntime,
  });
  if (attempt.opened !== "Opened")
    throw new Error(`task workload suite: ${label} opened no attempt`);
  return attempt.attempt.capability.secret;
}

test("a work attempt on a catalog reads the selected work workload and no evaluator", async () => {
  assert.deepEqual(
    await tasks.workload(await openedSecret("workload-work", "Work", catalog)),
    { taskKind: "Work", workload: "build" },
  );
});

test("an evaluation attempt reads its evaluator's key and that evaluator's workload", async () => {
  const first = await openedSecret("workload-first", { evaluator: 1 }, catalog);
  const second = await openedSecret(
    "workload-second",
    { evaluator: 2 },
    catalog,
  );
  assert.deepEqual(await tasks.workload(first), {
    taskKind: "Evaluation",
    evaluator: 1,
    workload: "tests",
  });
  assert.deepEqual(await tasks.workload(second), {
    taskKind: "Evaluation",
    evaluator: 2,
    workload: "lint",
  });
});

test("a ticket's selection and overrides choose the workload its attempt reads", async () => {
  const work = await openedSecret("workload-selected-work", "Work", catalog, {
    selection: { work: "rebuild" },
  });
  const plan = await openedSecret(
    "workload-selected-plan",
    { evaluator: 1 },
    catalog,
    { selection: { evaluation: "reversed" } },
  );
  const added = await openedSecret(
    "workload-overridden",
    { evaluator: 2 },
    catalog,
    {
      overrides: {
        workloads: { audit: { runner: "Commands", commands: ["npm audit"] } },
        plans: { checks: [{ name: "checks", evaluators: ["tests", "audit"] }] },
      },
    },
  );
  assert.deepEqual(await tasks.workload(work), {
    taskKind: "Work",
    workload: "rebuild",
  });
  assert.deepEqual(await tasks.workload(plan), {
    taskKind: "Evaluation",
    evaluator: 1,
    workload: "lint",
  });
  assert.deepEqual(await tasks.workload(added), {
    taskKind: "Evaluation",
    evaluator: 2,
    workload: "audit",
  });
});

test("an attempt on a configuration that is not a catalog reads its task and no workload name", async () => {
  assert.deepEqual(
    await tasks.workload(await openedSecret("workload-plain-work", "Work")),
    { taskKind: "Work" },
  );
  assert.deepEqual(
    await tasks.workload(
      await openedSecret("workload-plain-evaluation", { evaluator: 1 }),
    ),
    { taskKind: "Evaluation", evaluator: 1 },
  );
});

test("a secret that finds no live attempt reads nothing, and each bearer reads its own project's task", async () => {
  assert.equal(
    await tasks.workload(asAttemptCapabilitySecret(`unknown-${randomUUID()}`)),
    undefined,
  );
  const built = await openedSecret("workload-own-build", "Work", catalog);
  const rebuilt = await openedSecret("workload-own-rebuild", "Work", catalog, {
    selection: { work: "rebuild" },
  });
  assert.equal((await tasks.workload(built))?.workload, "build");
  assert.equal((await tasks.workload(rebuilt))?.workload, "rebuild");
});

test("the worker plane's role reads the door, and every role the task read is not granted to cannot", async () => {
  await planePool.query("SELECT task_kind FROM read_worker_task_workload('')");
  for (const pool of [poolPlanePool, apiPool])
    await assert.rejects(
      pool.query("SELECT task_kind FROM read_worker_task_workload('')"),
      postgresHarnessDenial("read_worker_task_workload"),
    );
  const differing = await rig.harness.query(
    `SELECT r.rolname FROM pg_roles r
      WHERE has_function_privilege(r.oid,
              'public.read_worker_task_workload(text)', 'EXECUTE')
        <> has_function_privilege(r.oid,
              'public.read_worker_task(text)', 'EXECUTE')`,
  );
  assert.deepEqual(differing, []);
});
