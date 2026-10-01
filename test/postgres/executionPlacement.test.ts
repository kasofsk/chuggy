/**
 * Where a project's executions run, against a real server: the project's own
 * row and the door that writes it, the routing a scheduler publishes, and
 * which role may reach either.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresExecutionPlacement,
  postgresExecutionRoutingPrecondition,
  postgresProjectPlacement,
} from "../../src/adapters/postgres/executionPlacement.ts";
import {
  apiRole,
  configurationImporterRole,
  executionPlacementSetFunction,
  finalizerRole,
  poolPlaneRole,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import type { ExecutionRouting } from "../../src/interpreter/executionScheduler.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessPartition,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let apiPool: pg.Pool;
let schedulerPool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  apiPool = postgresHarnessRolePool(apiRole);
  schedulerPool = postgresHarnessRolePool(schedulerRole);
});
after(async () => {
  await apiPool.end();
  await schedulerPool.end();
  await harness.close();
});

const owner = {
  kind: asAuthorityKind("Member"),
  subject: asAuthoritySubject("an-owner"),
};

async function published(routing: ExecutionRouting): Promise<void> {
  assert.deepEqual(
    await postgresExecutionRoutingPrecondition(schedulerPool, routing).check(
      new AbortController().signal,
    ),
    { met: "Met" },
  );
}

async function setter(
  partition: Awaited<ReturnType<typeof postgresHarnessProject>>,
) {
  const [row] = await harness.query(
    `SELECT set_by_kind, set_by_subject, set_at FROM project_execution_placement
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  return row;
}

test("a project nobody placed stands at the published default until its own row is written", async () => {
  await published({
    routes: { Work: "Pool", Evaluation: "InCluster" },
    projectRoutes: new Map(),
  });
  const partition = await postgresHarnessProject(harness.store, "unplaced");
  const store = postgresExecutionPlacement(apiPool);
  assert.deepEqual(await store.standing(partition), {
    defaults: { Work: "Pool", Evaluation: "InCluster" },
    override: {},
    placement: undefined,
  });
  assert.equal(
    await postgresProjectPlacement(schedulerPool, partition),
    undefined,
  );
  assert.equal(
    await store.write(
      partition,
      { Work: "InCluster", Evaluation: "Pool" },
      owner,
    ),
    "Written",
  );
  assert.deepEqual((await store.standing(partition)).placement, {
    Work: "InCluster",
    Evaluation: "Pool",
  });
  assert.deepEqual(await postgresProjectPlacement(schedulerPool, partition), {
    Work: "InCluster",
    Evaluation: "Pool",
  });
});

test("a write that changes nothing is unchanged and keeps the setter that decided it", async () => {
  const partition = await postgresHarnessProject(harness.store, "repeat");
  const store = postgresExecutionPlacement(apiPool);
  const placement = { Work: "Pool", Evaluation: "Pool" } as const;
  assert.equal(await store.write(partition, placement, owner), "Written");
  const first = await setter(partition);
  assert.equal(first?.["set_by_subject"], "an-owner");
  const other = { ...owner, subject: asAuthoritySubject("another") };
  assert.equal(await store.write(partition, placement, other), "Unchanged");
  assert.deepEqual(await setter(partition), first);
  assert.equal(
    await store.write(partition, { ...placement, Work: "InCluster" }, other),
    "Written",
  );
  assert.equal((await setter(partition))?.["set_by_subject"], "another");
});

test("a project that does not exist is not found and is written nothing", async () => {
  const partition = postgresHarnessPartition("absent");
  assert.equal(
    await postgresExecutionPlacement(apiPool).write(
      partition,
      { Work: "Pool", Evaluation: "Pool" },
      owner,
    ),
    "NotFound",
  );
  assert.equal(await setter(partition), undefined);
});

test("the published routing answers each project its own override, kind by kind", async () => {
  const overridden = await postgresHarnessProject(harness.store, "overridden");
  const beside = await postgresHarnessProject(harness.store, "beside");
  await published({
    routes: { Work: "InCluster", Evaluation: "InCluster" },
    projectRoutes: new Map([
      [
        overridden.tenant,
        new Map([[overridden.project, { Evaluation: "Pool" as const }]]),
      ],
    ]),
  });
  const store = postgresExecutionPlacement(apiPool);
  assert.deepEqual((await store.standing(overridden)).override, {
    Evaluation: "Pool",
  });
  assert.deepEqual((await store.standing(beside)).override, {});
  await published({
    routes: { Work: "Pool", Evaluation: "Pool" },
    projectRoutes: new Map(),
  });
  assert.deepEqual(await store.standing(overridden), {
    defaults: { Work: "Pool", Evaluation: "Pool" },
    override: {},
    placement: undefined,
  });
});

test("only the API writes a placement, only through its door, and only the scheduler publishes a routing", async () => {
  const partition = await postgresHarnessProject(harness.store, "privileges");
  const door = `SELECT ${executionPlacementSetFunction}('${partition.tenant}','${partition.project}','Pool','Pool','Member','someone')`;
  for (const role of [
    ticketServiceRole,
    selectorServiceRole,
    schedulerRole,
    finalizerRole,
    workerPlaneRole,
    poolPlaneRole,
    configurationImporterRole,
  ])
    assert.match(
      (await harness.attemptAs(role, door)) ?? "",
      postgresHarnessDenial(executionPlacementSetFunction),
      role,
    );
  assert.equal(await harness.attemptAs(apiRole, door), undefined);
  for (const role of [apiRole, schedulerRole])
    assert.match(
      (await harness.attemptAs(
        role,
        `UPDATE project_execution_placement SET work_route='InCluster'`,
      )) ?? "",
      postgresHarnessDenial("project_execution_placement"),
      role,
    );
  assert.match(
    (await harness.attemptAs(
      apiRole,
      `UPDATE execution_routing SET work_route='InCluster'`,
    )) ?? "",
    postgresHarnessDenial("execution_routing"),
  );
});

test("a route no deployment knows is refused by the row", async () => {
  const partition = await postgresHarnessProject(harness.store, "unknown");
  await assert.rejects(
    harness.query(
      `SELECT ${executionPlacementSetFunction}($1,$2,'Elsewhere','Pool','Member','someone')`,
      [partition.tenant, partition.project],
    ),
    /project_execution_placement_work_is_known/u,
  );
});
