/**
 * Work routed to pools end to end, against a real PostgreSQL and under the
 * roles a deployment runs: the scheduler registers an execution on the route
 * its policy names and offers its attempt, the pool plane claims it, and the
 * worker plane hands the claim its task and takes its report.
 *
 * A PASS IS INSTALLATION-WIDE and the cases share one database, so each reads
 * back only its own project's rows, and placement records what it is asked for
 * rather than refusing work another case routed in the cluster.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import {
  apiRole,
  poolPlaneRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerPlaneAuthority,
  postgresWorkerReportStore,
  postgresWorkerTasks,
} from "../../src/adapters/postgres/workerPlane.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
} from "../../src/adapters/postgres/workerPool.ts";
import { workerPlaneUploadBytesMax } from "../../src/contract/http.ts";
import { workTaskAnswerSchema } from "../../src/contract/workerTask.ts";
import {
  asAttemptId,
  asExecutionId,
  asPlacementId,
  silentSchedulerTelemetry,
  type ExecutionRouting,
  type RequestClaim,
} from "../../src/interpreter/executionScheduler.ts";
import { executionSchedulerIngest } from "../../src/interpreter/executionSchedulerReport.ts";
import {
  executionSchedulerAdmit,
  executionSchedulerLaunch,
  executionSchedulerRegister,
  type ExecutionSchedulerService,
} from "../../src/interpreter/executionSchedulerRun.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type { WorkerPoolIdentity } from "../../src/interpreter/workerPool.ts";
import {
  inertWorkerPlane,
  taskFetched,
} from "../adapters/workerPlaneFixtures.ts";
import {
  postgresHarnessPartition,
  postgresHarnessRolePool,
} from "./harness.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";
import {
  schedulerClaimFor,
  schedulerDeclaredSource,
  schedulerDigest,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  schedulerRouting,
  type SchedulerProject,
} from "./schedulerHarness.ts";
import { poolRoutedService } from "./schedulerPoolsHarness.ts";

const rig = await schedulerRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const poolPlanePool = postgresHarnessRolePool(poolPlaneRole);
const planePool = postgresHarnessRolePool(workerPlaneRole);

after(async () => {
  await Promise.all([apiPool.end(), poolPlanePool.end(), planePool.end()]);
  await rig.close();
});

const access = memoryProjectAccess();
const assignments = postgresWorkerPoolAssignments(poolPlanePool);

/** A worker plane whose reports are ingested as the plane's root ingests them, every artifact confirmed. */
const plane = createWorkerPlaneApp({
  ...inertWorkerPlane(workerPlaneUploadBytesMax),
  authority: postgresWorkerPlaneAuthority(planePool),
  tasks: postgresWorkerTasks(planePool),
  reports: {
    report: (secret, submission) =>
      executionSchedulerIngest(
        {
          store: postgresWorkerReportStore(planePool, secret),
          artifacts: {
            verifyManifest: () => Promise.resolve({ verified: "Verified" }),
          },
          digestOf: schedulerDigest,
          metrics: silentSchedulerTelemetry,
        },
        submission,
      ),
  },
});

after(() => plane.close());

/**
 * The scheduler a case runs under `routing`: every port but placement is the
 * pool suites', placement records each execution it is asked to place, and
 * registration claims only this case's request.
 */
function routedService(
  routing: ExecutionRouting,
  placed: string[],
  claims: readonly RequestClaim[] = [],
): ExecutionSchedulerService {
  const service = poolRoutedService(rig, access);
  return {
    ...service,
    store: { ...rig.store, claimRequests: () => Promise.resolve(claims) },
    placement: {
      ...service.placement,
      place: (placement) => {
        placed.push(placement.execution);
        return Promise.resolve({
          placed: "Placed",
          placement: asPlacementId(`placement-${randomUUID()}`),
        });
      },
    },
    policy: { ...service.policy, routing },
  };
}

/** A routing that sends only `partition`'s work to pools. */
function routingPooled(partition: Partition): ExecutionRouting {
  return {
    ...schedulerRouting(),
    projectRoutes: new Map([
      [partition.tenant, new Map([[partition.project, { Work: "Pool" }]])],
    ]),
  };
}

/** Registers this project's spawn request through a pass under `routing`, then admits and launches it. */
async function launchedUnder(
  project: SchedulerProject,
  label: string,
  routing: ExecutionRouting,
  placed: string[],
): Promise<string> {
  const claim = await schedulerClaimFor(
    rig,
    project.partition,
    project.request,
    schedulerOwner(label),
  );
  assert.equal(
    await executionSchedulerRegister(
      routedService(routing, placed, [claim]),
      schedulerOwner(label),
    ),
    1,
  );
  const service = routedService(routing, placed);
  assert.equal(await executionSchedulerAdmit(service, project.cluster), 1);
  await executionSchedulerLaunch(service, project.epoch);
  const [row] = (await rig.harness.query(
    `SELECT execution FROM execution WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { execution: string }[];
  assert.ok(row !== undefined);
  return row.execution;
}

/** Registers a pool of this project under the API's role, able to run the harness requirement, grants it `Execute`, and answers it as the pool plane identifies it. */
async function poolRegistered(
  partition: Partition,
  pool: string,
): Promise<WorkerPoolIdentity> {
  const principal = asPrincipal(
    `https://issuer.invalid#${pool}-${randomUUID()}`,
  );
  assert.equal(
    await postgresWorkerPoolRegistry(apiPool).register({
      partition,
      pool,
      capabilities: ["Platform:Linux:Amd64"],
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal,
    }),
    true,
  );
  access.grant({ partition, principal, access: new Set(["Execute"]) });
  const identity =
    await postgresWorkerPoolRegistry(poolPlanePool).identify(principal);
  assert.ok(identity !== undefined);
  return identity;
}

/** What one execution's row and attempts stand at, read as the owner. */
async function standing(project: SchedulerProject, execution: string) {
  const key = [project.partition.tenant, project.partition.project, execution];
  const [row] = await rig.harness.query(
    `SELECT placement, status, outcome FROM execution
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    key,
  );
  const attempts = await rig.harness.query(
    `SELECT state, pool, invocation IS NOT NULL AS invoked FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND execution=$3
      ORDER BY opened_at, attempt`,
    key,
  );
  return { execution: row, attempts };
}

/** How long a claim's lease runs for, past the duration of any case here. */
const claimLeaseSecs = 300;

/** Claims this pool's next offered attempt as the pool plane, under a fresh bearer, answering the bearer or nothing. */
async function claimed(
  identity: WorkerPoolIdentity,
): Promise<string | undefined> {
  const bearer = `bearer-${randomUUID()}`;
  const claim = await assignments.claim(
    identity,
    { leaseSecs: claimLeaseSecs, heldMax: 1 },
    `assignment-${randomUUID()}`,
    bearer,
  );
  return claim === undefined ? undefined : bearer;
}

test("work registered on the pool route is offered, claimed, fetched and reported to its end", async () => {
  const label = "route-pool";
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const identity = await poolRegistered(project.partition, "route-pool");
  const placed: string[] = [];
  const execution = await launchedUnder(
    project,
    label,
    routingPooled(project.partition),
    placed,
  );
  assert.equal(placed.includes(execution), false);
  assert.deepEqual(await standing(project, execution), {
    execution: { placement: "Pool", status: "Launching", outcome: null },
    attempts: [{ state: "Placing", pool: null, invoked: true }],
  });
  const bearer = await claimed(identity);
  assert.ok(bearer !== undefined, "no pool could claim the offered attempt");
  const fetched = await taskFetched(plane, bearer);
  assert.equal(fetched.status, 200);
  const task = workTaskAnswerSchema.parse(fetched.body);
  const [invocation] = await rig.harness.query(
    `SELECT invocation->'profile' AS profile, invocation->'briefing' AS briefing,
            invocation->'authority' AS authority
       FROM execution_attempt WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [project.partition.tenant, project.partition.project, execution],
  );
  assert.deepEqual(
    {
      execution: task.execution,
      profile: task.profile,
      briefing: task.briefing,
      authority: task.authority,
    },
    { execution, ...invocation },
  );
  const reported = await plane.inject({
    method: "POST",
    url: "/v1/report",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "text/plain",
    },
    payload: JSON.stringify({
      version: 2,
      verdict: "Pass",
      handoffs: [],
      diagnostics: [],
      source: schedulerDeclaredSource({
        partition: project.partition,
        execution: asExecutionId(task.execution),
        attempt: asAttemptId(task.attempt),
        generation: task.generation,
      }),
    }),
  });
  assert.equal(reported.statusCode, 202, reported.body);
  assert.deepEqual((await standing(project, execution)).execution, {
    placement: "Pool",
    status: "Terminal",
    outcome: "Passed",
  });
});

test("work the policy routes in cluster is registered and placed there, and an idle pool that could run it claims nothing", async () => {
  const label = "route-cluster";
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const identity = await poolRegistered(project.partition, "route-idle");
  const placed: string[] = [];
  const execution = await launchedUnder(
    project,
    label,
    schedulerRouting(),
    placed,
  );
  assert.deepEqual(placed, [execution]);
  assert.deepEqual(await standing(project, execution), {
    execution: { placement: "InCluster", status: "Running", outcome: null },
    attempts: [{ state: "Running", pool: null, invoked: true }],
  });
  assert.equal(await claimed(identity), undefined);
});

test("a policy that moves between attempts leaves the route the execution registered with", async () => {
  const label = "route-moved";
  const project = await schedulerProject(rig, label, { tasks: 1 });
  await poolRegistered(project.partition, "route-moved");
  const placed: string[] = [];
  const execution = await launchedUnder(
    project,
    label,
    routingPooled(project.partition),
    placed,
  );
  const key = [project.partition.tenant, project.partition.project, execution];
  await rig.harness.query(
    `UPDATE execution_attempt SET lease_expires_at=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND execution=$3 AND state='Placing'`,
    key,
  );
  const moved = routedService(schedulerRouting(), placed);
  await executionSchedulerLaunch(moved, project.epoch);
  await rig.harness.query(
    `UPDATE execution
        SET placement_backoff_from=placement_backoff_from-make_interval(secs=>$4)
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...key, moved.config.placementBackoffSecs],
  );
  await executionSchedulerLaunch(moved, project.epoch);
  assert.equal(placed.includes(execution), false);
  assert.deepEqual(await standing(project, execution), {
    execution: { placement: "Pool", status: "Launching", outcome: null },
    attempts: [
      { state: "Withdrawn", pool: null, invoked: true },
      { state: "Placing", pool: null, invoked: true },
    ],
  });
});

test("a project's override routes that project, and neither one beside it nor one of its name in another tenant", async () => {
  const pooled = await schedulerProject(rig, "route-named", { tasks: 1 });
  const beside = await schedulerProject(
    rig,
    "route-beside",
    { tasks: 1 },
    undefined,
    {
      tenant: pooled.partition.tenant,
      project: asProjectId(`project-route-beside-${randomUUID()}`),
    },
  );
  const elsewhere = await schedulerProject(
    rig,
    "route-elsewhere",
    { tasks: 1 },
    undefined,
    {
      ...postgresHarnessPartition("route-elsewhere"),
      project: pooled.partition.project,
    },
  );
  const routing = routingPooled(pooled.partition);
  const placements: Record<string, unknown> = {};
  for (const [label, project] of [
    ["route-named", pooled],
    ["route-beside", beside],
    ["route-elsewhere", elsewhere],
  ] as const) {
    const execution = await launchedUnder(project, label, routing, []);
    placements[label] = (await standing(project, execution)).execution?.[
      "placement"
    ];
  }
  assert.deepEqual(placements, {
    "route-named": "Pool",
    "route-beside": "InCluster",
    "route-elsewhere": "InCluster",
  });
});
