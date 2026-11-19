/**
 * Where a project's threads run, against a real server: the one resolution
 * over the published routing and the project's own row, the door that writes
 * the row, the runners a thread would run on, and which role may reach each.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresSessionPlacement,
  postgresSessionRoutingPrecondition,
} from "../../src/adapters/postgres/sessionPlacement.ts";
import { postgresChatHostRegistry } from "../../src/adapters/postgres/chatHost.ts";
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import {
  apiRole,
  configurationImporterRole,
  finalizerRole,
  poolPlaneRole,
  schedulerRole,
  selectorServiceRole,
  sessionPlacementSetFunction,
  sessionRouteFunction,
  sessionRunnerStandingFunction,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  sessionRunnerPolledSecsMax,
  type SessionRouting,
} from "../../src/interpreter/sessionPlacement.ts";
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
  await Promise.all([apiPool.end(), schedulerPool.end()]);
  await harness.close();
});

const owner = {
  kind: asAuthorityKind("Member"),
  subject: asAuthoritySubject("an-owner"),
};

async function published(routing: SessionRouting): Promise<void> {
  assert.deepEqual(
    await postgresSessionRoutingPrecondition(schedulerPool, routing).check(
      new AbortController().signal,
    ),
    { met: "Met" },
  );
}

/** The thread's route and its source, as the scheduler's role reads them. */
async function routed(partition: Partition): Promise<string> {
  const resolved = await postgresSessionPlacement(schedulerPool).route(
    partition,
    "Thread",
  );
  return `${resolved.route}/${resolved.source}`;
}

test("a project nobody placed runs its threads in cluster while no routing is published", async () => {
  const partition = await postgresHarnessProject(harness.store, "unpublished");
  assert.equal(await routed(partition), "InCluster/Default");
});

test("a project's own row overrides the published default, and the deployment's override overrides both", async () => {
  const placed = await postgresHarnessProject(harness.store, "placed");
  const beside = await postgresHarnessProject(harness.store, "beside");
  await published({ routes: { Thread: "Pool" }, projectRoutes: new Map() });
  assert.equal(await routed(placed), "Pool/Default");
  assert.equal(
    await postgresSessionPlacement(apiPool).write(
      placed,
      { Thread: "InCluster" },
      owner,
    ),
    "Written",
  );
  assert.equal(await routed(placed), "InCluster/Project");
  await published({
    routes: { Thread: "InCluster" },
    projectRoutes: new Map([
      [placed.tenant, new Map([[placed.project, { Thread: "Pool" as const }]])],
    ]),
  });
  assert.equal(await routed(placed), "Pool/Override");
  assert.equal(await routed(beside), "InCluster/Default");
});

test("every kind but a thread is refused rather than placed", async () => {
  const partition = await postgresHarnessProject(harness.store, "unnamed");
  for (const kind of ["Lead", "Inquiry", "Execution"])
    await assert.rejects(
      apiPool.query(`SELECT * FROM ${sessionRouteFunction}($1,$2,$3)`, [
        partition.tenant,
        partition.project,
        kind,
      ]),
      new RegExp(`session kind ${kind} has no route`, "u"),
    );
});

test("a write that changes nothing is unchanged, and a project that does not exist is not found", async () => {
  const partition = await postgresHarnessProject(harness.store, "repeat");
  const store = postgresSessionPlacement(apiPool);
  const placement = { Thread: "Pool" } as const;
  assert.equal(await store.write(partition, placement, owner), "Written");
  assert.equal(await store.write(partition, placement, owner), "Unchanged");
  assert.equal(
    await store.write(
      postgresHarnessPartition("absent-session"),
      placement,
      owner,
    ),
    "NotFound",
  );
});

test("a write that changes the thread's route is written, and the route reads back changed", async () => {
  const partition = await postgresHarnessProject(harness.store, "one-kind");
  const store = postgresSessionPlacement(apiPool);
  for (const thread of ["Pool", "InCluster", "Pool"] as const) {
    assert.equal(
      await store.write(partition, { Thread: thread }, owner),
      "Written",
    );
    assert.equal(await routed(partition), `${thread}/Project`);
  }
});

test("a project's pool is no runner of its threads, even one polling now: the read names a member's chat hosts alone", async () => {
  const partition = await postgresHarnessProject(harness.store, "runners");
  const member = asPrincipal("https://issuer.invalid#a-member");
  const reads = postgresSessionPlacement(apiPool);
  const unregistered = { mine: "Unregistered", inquiry: "Unregistered" };
  assert.deepEqual(await reads.runners(partition, member), unregistered);
  await harness.query(
    `INSERT INTO worker_pool(tenant,project,pool,principal,client_id,class,last_polled_at)
     VALUES($1,$2,'laptop',$3,$4,'Dedicated',now())`,
    [
      partition.tenant,
      partition.project,
      `https://issuer.invalid#pool-${randomUUID()}`,
      `chuggy-pool-${randomUUID()}`,
    ],
  );
  for (const elsewhere of [member, undefined])
    assert.deepEqual(await reads.runners(partition, elsewhere), unregistered);
});

/** A member's standing for their thread and their inquiry. */
function hosted(
  mine: string,
  inquiry = mine,
): Readonly<Record<string, string>> {
  return { mine, inquiry };
}

test("a member's chat host is their own runner and their inquiries' in every project of its tenant, live only while its last poll is recent", async () => {
  const partition = await postgresHarnessProject(harness.store, "hosted");
  const beside = await postgresHarnessProject(harness.store, "hosted-beside", {
    tenant: partition.tenant,
    project: asProjectId(`project-hosted-beside-${randomUUID()}`),
  });
  const member = asPrincipal("https://issuer.invalid#a-member");
  const key = { tenant: partition.tenant, owner: member };
  const reads = postgresSessionPlacement(apiPool);
  const clientId = `chuggy-personal-${randomUUID()}`;
  assert.deepEqual(
    await postgresChatHostRegistry(apiPool).register({
      ...key,
      clientId,
      principal: asPrincipal(`https://issuer.invalid#host-${randomUUID()}`),
    }),
    { written: "Registered" },
  );
  const stopped = async () => {
    for (const at of [partition, beside])
      assert.deepEqual(await reads.runners(at, member), hosted("Offline"));
  };
  await stopped();
  const polled = async (secondsAgo: number) =>
    harness.query(
      `UPDATE chat_host SET last_polled_at=now()-make_interval(secs=>$2)
        WHERE tenant=$1`,
      [partition.tenant, secondsAgo],
    );
  await polled(1);
  for (const at of [partition, beside])
    assert.deepEqual(await reads.runners(at, member), hosted("Live"));
  assert.deepEqual(
    await reads.runners(partition, asPrincipal("https://issuer.invalid#b")),
    hosted("Unregistered"),
  );
  await polled(sessionRunnerPolledSecsMax + 1);
  await stopped();
  assert.equal(
    await postgresChatHostRegistry(apiPool).deregister(key, clientId),
    true,
  );
  assert.deepEqual(
    await reads.runners(partition, member),
    hosted("Unregistered"),
  );
});

test("a member's personal runner is no runner of theirs or of the project's, however live and in a project it serves, beside a chat host or alone", async () => {
  const partition = await postgresHarnessProject(harness.store, "mine");
  const member = asPrincipal("https://issuer.invalid#a-member");
  const key = { tenant: partition.tenant, owner: member };
  const registry = postgresPersonalRunnerRegistry(apiPool);
  const reads = postgresSessionPlacement(apiPool);
  assert.equal(
    await registry.register({
      ...key,
      capabilities: [],
      clientId: `chuggy-personal-${randomUUID()}`,
      principal: asPrincipal("https://issuer.invalid#personal-laptop"),
    }),
    "Registered",
  );
  assert.equal(await registry.allow(key, partition.project), "Allowed");
  await harness.query(
    `UPDATE personal_runner SET last_polled_at=now() WHERE tenant=$1 AND owner=$2`,
    [partition.tenant, member],
  );
  assert.deepEqual(
    await reads.runners(partition, member),
    hosted("Unregistered"),
  );
  assert.deepEqual(
    await postgresChatHostRegistry(apiPool).register({
      ...key,
      clientId: `chuggy-personal-${randomUUID()}`,
      principal: asPrincipal(`https://issuer.invalid#host-${randomUUID()}`),
    }),
    { written: "Registered" },
  );
  assert.deepEqual(await reads.runners(partition, member), hosted("Offline"));
});

test("only the API writes a placement, the API and the scheduler resolve one, and only the scheduler publishes a routing", async () => {
  const partition = await postgresHarnessProject(harness.store, "privileges");
  const project = `'${partition.tenant}','${partition.project}'`;
  const door = `SELECT ${sessionPlacementSetFunction}(${project},'Pool','Pool','Own','Member','someone')`;
  const reads = [
    [
      sessionRouteFunction,
      `SELECT * FROM ${sessionRouteFunction}(${project},'Thread')`,
    ],
    [
      sessionRunnerStandingFunction,
      `SELECT * FROM ${sessionRunnerStandingFunction}(${project},NULL,1)`,
    ],
  ] as const;
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
      postgresHarnessDenial(sessionPlacementSetFunction),
      role,
    );
  assert.equal(await harness.attemptAs(apiRole, door), undefined);
  for (const [named, read] of reads) {
    for (const role of [apiRole, schedulerRole])
      assert.equal(await harness.attemptAs(role, read), undefined, role);
    for (const role of [
      ticketServiceRole,
      selectorServiceRole,
      workerPlaneRole,
      poolPlaneRole,
    ])
      assert.match(
        (await harness.attemptAs(role, read)) ?? "",
        postgresHarnessDenial(named),
        role,
      );
  }
  for (const role of [apiRole, schedulerRole])
    assert.match(
      (await harness.attemptAs(
        role,
        `UPDATE project_session_placement SET thread_route='InCluster'`,
      )) ?? "",
      postgresHarnessDenial("project_session_placement"),
      role,
    );
  assert.match(
    (await harness.attemptAs(
      apiRole,
      `UPDATE session_routing SET thread_route='InCluster'`,
    )) ?? "",
    postgresHarnessDenial("session_routing"),
  );
});
