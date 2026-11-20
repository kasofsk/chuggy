/**
 * Work routed to pools end to end, against a real PostgreSQL and under the
 * roles a deployment runs: the scheduler registers an execution on the route
 * its policy names and offers its attempt, a personal runner of its owner
 * claims it through the pool plane, and the worker plane hands the claim its
 * task and takes its report.
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
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import { postgresWorkerPoolAssignments } from "../../src/adapters/postgres/workerPool.ts";
import { postgresExecutionPlacement } from "../../src/adapters/postgres/executionPlacement.ts";
import { workerPlaneUploadBytesMax } from "../../src/contract/http.ts";
import { workTaskAnswerSchema } from "../../src/contract/workerTask.ts";
import {
  asAttemptId,
  asExecutionId,
  asPlacementId,
  executionSchedulerDefaults,
  silentSchedulerTelemetry,
  type ExecutionRoutes,
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
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type { PersonalRunnerIdentity } from "../../src/interpreter/workerPool.ts";
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
  schedulerEvaluationRequest,
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

/** A member's personal runner as the pool plane admits it, and the project its claims are in. */
type Runner = PersonalRunnerIdentity & {
  readonly kind: "Personal";
  readonly partition: Partition;
};

/**
 * Makes a fresh member the author of this project's ticket, so the executions
 * it registers are that member's, registers a personal runner of theirs
 * listing the project and able to run the harness requirement under the API's
 * role, and grants the owner what admits the runner and `Read` of the project.
 */
async function runnerOwning(project: SchedulerProject): Promise<Runner> {
  const { partition } = project;
  const owner = asPrincipal(`https://issuer.invalid#owner-${randomUUID()}`);
  const drafted = (await rig.harness.query(
    `UPDATE draft_revision SET authority_kind='Member',authority_subject=$4
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND authoring_version=1
      RETURNING 1 AS one`,
    [partition.tenant, partition.project, project.ticket, owner],
  )) as readonly unknown[];
  assert.equal(drafted.length, 1, "the ticket has a first draft revision");
  const personal = postgresPersonalRunnerRegistry(apiPool);
  const principal = asPrincipal(
    `https://issuer.invalid#runner-${randomUUID()}`,
  );
  assert.equal(
    await personal.register({
      tenant: partition.tenant,
      owner,
      capabilities: ["Platform:Linux:Amd64"],
      clientId: `chuggy-personal-${randomUUID()}`,
      principal,
    }),
    "Registered",
  );
  assert.equal(
    await personal.allow(
      { tenant: partition.tenant, owner },
      partition.project,
    ),
    "Allowed",
  );
  access.grantTenant({
    tenant: partition.tenant,
    principal: owner,
    access: new Set(["RegisterPersonalRunner"]),
  });
  access.grant({ partition, principal: owner, access: new Set(["Read"]) });
  return {
    kind: "Personal",
    tenant: partition.tenant,
    owner,
    principal,
    partition,
  };
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

/** Claims this runner's next offered attempt in its project as the pool plane, under a fresh bearer, answering the bearer or nothing. */
async function claimed(runner: Runner): Promise<string | undefined> {
  const bearer = `bearer-${randomUUID()}`;
  const claim = await assignments.claimPersonal(
    runner,
    { leaseSecs: claimLeaseSecs, heldMax: 1, memoryMibDefault: 4_096 },
    `assignment-${randomUUID()}`,
    bearer,
    [runner.partition.project],
  );
  return claim === undefined ? undefined : bearer;
}

test("work registered on the pool route is offered, claimed, fetched and reported to its end", async () => {
  const label = "route-pool";
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const identity = await runnerOwning(project);
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
  assert.ok(bearer !== undefined, "no runner could claim the offered attempt");
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

test("work the policy routes in cluster is registered and placed there, and an idle runner that could run it claims nothing", async () => {
  const label = "route-cluster";
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const identity = await runnerOwning(project);
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
  await runnerOwning(project);
  const placed: string[] = [];
  const execution = await launchedUnder(
    project,
    label,
    routingPooled(project.partition),
    placed,
  );
  const key = [project.partition.tenant, project.partition.project, execution];
  const waiting = (
    await rig.store.waitingAttempts(
      project.epoch,
      executionSchedulerDefaults.attemptsPerPassMax,
    )
  ).find((attempt) => attempt.execution === execution);
  assert.ok(waiting !== undefined);
  assert.equal(
    await rig.store.waitingAttemptWithdrawn(waiting, "PlacementUnavailable"),
    true,
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

test("a project its administrator placed on pools registers there under an in-cluster default, and its owner's runner claims the work", async () => {
  const label = "route-placed";
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const identity = await runnerOwning(project);
  assert.equal(
    await postgresExecutionPlacement(apiPool).write(
      project.partition,
      { Work: "Pool", Evaluation: "Pool" },
      memberAuthority(asPrincipal("https://issuer.invalid#an-owner")),
    ),
    "Written",
  );
  const placed: string[] = [];
  const execution = await launchedUnder(
    project,
    label,
    schedulerRouting(),
    placed,
  );
  assert.equal(placed.includes(execution), false);
  assert.equal(
    (await standing(project, execution)).execution?.["placement"],
    "Pool",
  );
  assert.ok(
    (await claimed(identity)) !== undefined,
    "the owner's runner could not claim the offered attempt",
  );
});

test("a project nobody placed follows a pool default, and only its owner's runner claims the work", async () => {
  const label = "route-default";
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const stranger = await schedulerProject(rig, "route-stranger", { tasks: 1 });
  const theirs = await runnerOwning(stranger);
  const identity = await runnerOwning(project);
  const execution = await launchedUnder(
    project,
    label,
    schedulerRouting({ Work: "Pool", Evaluation: "Pool" }),
    [],
  );
  assert.equal(
    (await standing(project, execution)).execution?.["placement"],
    "Pool",
  );
  assert.equal(await claimed(theirs), undefined);
  assert.ok(
    (await claimed(identity)) !== undefined,
    "the owner's runner could not claim the offered attempt",
  );
});

/** Registers a work request and an evaluation request of one project as the scheduler under `routes`, and answers the route each kind's execution was written with. */
async function routedKinds(label: string, routes: ExecutionRoutes) {
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const evaluation = await schedulerEvaluationRequest(rig, project, label, {
    cycle: 1,
    stage: 1,
    generation: 1,
    evaluator: 1,
  });
  for (const request of [project.request, evaluation]) {
    const claim = await schedulerClaimFor(
      rig,
      project.partition,
      request,
      schedulerOwner(label),
    );
    assert.deepEqual(
      await rig.store.registerSpawn(
        claim,
        executionSchedulerDefaults.nTasks,
        routes,
      ),
      { registered: "Registered", created: 1 },
    );
  }
  return rig.harness.query(
    `SELECT t.kind, e.placement FROM execution e
       JOIN execution_request_task t
         ON t.tenant=e.tenant AND t.project=e.project
        AND t.request=e.source_request AND t.task=e.task
      WHERE e.tenant=$1 AND e.project=$2 ORDER BY t.kind`,
    [project.partition.tenant, project.partition.project],
  );
}

test("each task kind registers on its own kind's route, whichever way the policy splits them", async () => {
  assert.deepEqual(
    await routedKinds("route-split", { Work: "Pool", Evaluation: "InCluster" }),
    [
      { kind: "Evaluation", placement: "InCluster" },
      { kind: "Work", placement: "Pool" },
    ],
  );
  assert.deepEqual(
    await routedKinds("route-swapped", {
      Work: "InCluster",
      Evaluation: "Pool",
    }),
    [
      { kind: "Evaluation", placement: "Pool" },
      { kind: "Work", placement: "InCluster" },
    ],
  );
});
