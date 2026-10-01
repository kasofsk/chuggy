/**
 * Where a project's sessions run, against a real server: the one resolution
 * over the published routing and the project's own row, the door that writes
 * the row, the runners a session would run on, and which role may reach each.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresSessionPlacement,
  postgresSessionRoutingPrecondition,
} from "../../src/adapters/postgres/sessionPlacement.ts";
import { postgresWorkerPoolRegistry } from "../../src/adapters/postgres/workerPool.ts";
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
import type { SessionKind } from "../../src/interpreter/agentSession.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
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
let selectorPool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  apiPool = postgresHarnessRolePool(apiRole);
  schedulerPool = postgresHarnessRolePool(schedulerRole);
  selectorPool = postgresHarnessRolePool(selectorServiceRole);
});
after(async () => {
  await Promise.all([apiPool.end(), schedulerPool.end(), selectorPool.end()]);
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

/** Each kind's route and its source, as the selector's role reads them. */
async function routed(
  partition: Partition,
): Promise<Readonly<Record<SessionKind, string>>> {
  const reads = postgresSessionPlacement(selectorPool);
  const of = async (kind: SessionKind) => {
    const resolved = await reads.route(partition, kind);
    return `${resolved.route}/${resolved.source}`;
  };
  return {
    Thread: await of("Thread"),
    Lead: await of("Lead"),
    Inquiry: await of("Inquiry"),
  };
}

test("a project nobody placed runs every session in cluster while no routing is published", async () => {
  const partition = await postgresHarnessProject(harness.store, "unpublished");
  assert.deepEqual(await routed(partition), {
    Thread: "InCluster/Default",
    Lead: "InCluster/Default",
    Inquiry: "InCluster/Default",
  });
});

test("a project's own row overrides the published default, and the deployment's override overrides both, kind by kind", async () => {
  const placed = await postgresHarnessProject(harness.store, "placed");
  const beside = await postgresHarnessProject(harness.store, "beside");
  await published({
    routes: { Thread: "Pool", Lead: "InCluster" },
    projectRoutes: new Map(),
  });
  assert.deepEqual(await routed(placed), {
    Thread: "Pool/Default",
    Lead: "InCluster/Default",
    Inquiry: "InCluster/Default",
  });
  assert.equal(
    await postgresSessionPlacement(apiPool).write(
      placed,
      { Thread: "InCluster", Lead: "Pool" },
      owner,
    ),
    "Written",
  );
  assert.deepEqual(await routed(placed), {
    Thread: "InCluster/Project",
    Lead: "Pool/Project",
    Inquiry: "Pool/Project",
  });
  await published({
    routes: { Thread: "Pool", Lead: "InCluster" },
    projectRoutes: new Map([
      [
        placed.tenant,
        new Map([[placed.project, { Lead: "InCluster" as const }]]),
      ],
    ]),
  });
  assert.deepEqual(await routed(placed), {
    Thread: "InCluster/Project",
    Lead: "InCluster/Override",
    Inquiry: "InCluster/Override",
  });
  assert.deepEqual(await routed(beside), {
    Thread: "Pool/Default",
    Lead: "InCluster/Default",
    Inquiry: "InCluster/Default",
  });
});

test("a kind the routing does not name is refused rather than placed", async () => {
  const partition = await postgresHarnessProject(harness.store, "unnamed");
  await assert.rejects(
    apiPool.query(`SELECT * FROM ${sessionRouteFunction}($1,$2,'Execution')`, [
      partition.tenant,
      partition.project,
    ]),
    /session kind Execution has no route/u,
  );
});

test("a write that changes nothing is unchanged, and a project that does not exist is not found", async () => {
  const partition = await postgresHarnessProject(harness.store, "repeat");
  const store = postgresSessionPlacement(apiPool);
  const placement = { Thread: "Pool", Lead: "Pool" } as const;
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

test("a runner counts as live for its member and the project only while its last poll is recent", async () => {
  const partition = await postgresHarnessProject(harness.store, "runners");
  const member = asPrincipal("https://issuer.invalid#a-member");
  const other = asPrincipal("https://issuer.invalid#another");
  const reads = postgresSessionPlacement(apiPool);
  assert.deepEqual(await reads.runners(partition, member), {
    mine: "Unregistered",
    project: "Unregistered",
  });
  assert.equal(
    await postgresWorkerPoolRegistry(apiPool).register({
      partition,
      pool: "laptop",
      capabilities: [],
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal: asPrincipal("https://issuer.invalid#pool-laptop"),
      registeredBy: member,
    }),
    true,
  );
  const polled = async (secondsAgo: number) =>
    harness.query(
      `UPDATE worker_pool SET last_polled_at=now()-make_interval(secs=>$3)
        WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project, secondsAgo],
    );
  assert.deepEqual(await reads.runners(partition, member), {
    mine: "Offline",
    project: "Offline",
  });
  await polled(1);
  assert.deepEqual(await reads.runners(partition, member), {
    mine: "Live",
    project: "Live",
  });
  assert.deepEqual(await reads.runners(partition, other), {
    mine: "Unregistered",
    project: "Live",
  });
  assert.deepEqual(await reads.runners(partition, undefined), {
    mine: "Unregistered",
    project: "Live",
  });
  await polled(sessionRunnerPolledSecsMax + 1);
  assert.deepEqual(await reads.runners(partition, member), {
    mine: "Offline",
    project: "Offline",
  });
});

test("only the API writes a placement, the API and the selector resolve one, and only the scheduler publishes a routing", async () => {
  const partition = await postgresHarnessProject(harness.store, "privileges");
  const project = `'${partition.tenant}','${partition.project}'`;
  const door = `SELECT ${sessionPlacementSetFunction}(${project},'Pool','Pool','Member','someone')`;
  const reads = [
    [
      sessionRouteFunction,
      `SELECT * FROM ${sessionRouteFunction}(${project},'Lead')`,
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
    for (const role of [apiRole, selectorServiceRole])
      assert.equal(await harness.attemptAs(role, read), undefined, role);
    for (const role of [ticketServiceRole, workerPlaneRole, poolPlaneRole])
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
