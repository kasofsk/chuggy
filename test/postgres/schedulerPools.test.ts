/**
 * The scheduler's half of work routed to pools, against a real PostgreSQL and
 * under the scheduler's own role: what a pass asks the registry before an
 * attempt waits for a pool, and what the reaper does with one whose lease ran
 * out.
 *
 * NOTHING IN THIS TREE ROUTES WORK TO A POOL YET, so each case marks its own
 * execution through the owner's harness. Everything else is the role a
 * deployment runs: the store and the registry read are the scheduler's, a
 * registration is the API's and a claim is the pool plane's.
 *
 * A PASS IS INSTALLATION-WIDE and the cases share one database, so each reads
 * back only its own project's rows. Every execution here is routed to pools,
 * and the first port the in-cluster arm asks refuses, so a pass that placed
 * any of them fails the case that ran it.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import {
  postgresPriorEvaluationReports,
  postgresPriorWorkReports,
} from "../../src/adapters/postgres/evaluationReports.ts";
import { postgresPinnedConfigurations } from "../../src/adapters/postgres/pinnedConfigurations.ts";
import { apiRole, poolPlaneRole } from "../../src/adapters/postgres/schema.ts";
import { postgresTicketBrief } from "../../src/adapters/postgres/ticketBrief.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
  postgresWorkerPoolRoster,
} from "../../src/adapters/postgres/workerPool.ts";
import type { ExecutionId } from "../../src/interpreter/executionScheduler.ts";
import {
  executionSchedulerLaunch,
  type ExecutionSchedulerService,
} from "../../src/interpreter/executionSchedulerRun.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { workerPoolsAnsweredMax } from "../../src/interpreter/workerPool.ts";
import { postgresHarnessProject, postgresHarnessRolePool } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerInvocation,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerProject,
} from "./schedulerHarness.ts";
import { schedulerRootService } from "./schedulerRootPorts.ts";

const rig = await schedulerRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const planePool = postgresHarnessRolePool(poolPlaneRole);

after(async () => {
  await Promise.all([apiPool.end(), planePool.end()]);
  await rig.close();
});

const registry = postgresWorkerPoolRegistry(apiPool);
const assignments = postgresWorkerPoolAssignments(planePool);
const roster = postgresWorkerPoolRoster(rig.pool);

/** A scheduler over the real store and registry, whose in-cluster arm refuses at its first port. */
const service: ExecutionSchedulerService = {
  ...schedulerRootService,
  store: rig.store,
  workerPools: roster,
  policy: {
    profileFor: (execution) =>
      Promise.reject(
        new Error(
          `scheduler pools suite: ${execution.execution} was placed in the cluster`,
        ),
      ),
  },
  configurations: postgresPinnedConfigurations(rig.pool),
  priorWorkReports: postgresPriorWorkReports(rig.pool),
  priorEvaluationReports: postgresPriorEvaluationReports(rig.pool),
  ticketBriefs: postgresTicketBrief(rig.pool),
};

/** One execution routed to its project's pools, and the project it belongs to. */
interface Routed {
  readonly project: SchedulerProject;
  readonly execution: ExecutionId;
}

/** The key of a routed execution's row, in the order every statement here binds it. */
function routedKey(routed: Routed): readonly string[] {
  const { tenant, project } = routed.project.partition;
  return [tenant, project, routed.execution];
}

/** The one execution of a fresh project, admitted under the platform default and marked for the project's pools. */
async function routedExecution(label: string): Promise<Routed> {
  const project = await schedulerProject(rig, label, { tasks: 1 });
  const owner = schedulerOwner(label);
  await rig.store.registerSpawn(
    await schedulerClaimFor(rig, project.partition, project.request, owner),
    1,
  );
  const admitted = await rig.store.admit(project.cluster);
  if (admitted.admitted !== "Admitted")
    throw new Error(`scheduler pools suite: ${label} admitted no execution`);
  const routed = { project, execution: admitted.execution };
  await rig.harness.query(
    `UPDATE execution SET placement='Pool'
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    routedKey(routed),
  );
  return routed;
}

/** The attempt the scheduler opens for a routed execution, with the lease and budget a pass opens it under. */
async function routedAttempt(routed: Routed) {
  const opened = await rig.store.openAttempt({
    partition: routed.project.partition,
    execution: routed.execution,
    epoch: routed.project.epoch,
    leaseSecs: service.config.attemptLeaseSecs,
    retriesMax: service.config.attemptRetriesMax,
    placementBackoffSecs: service.config.placementBackoffSecs,
  });
  if (opened.opened !== "Opened")
    throw new Error(
      `scheduler pools suite: ${routed.execution} opened no attempt`,
    );
  return opened.attempt;
}

/** Registers one pool under the API's role, declaring what the case wants it to. */
async function poolRegistered(
  partition: Partition,
  pool: string,
  capabilities: readonly string[],
): Promise<void> {
  assert.equal(
    await registry.register({
      partition,
      pool,
      capabilities,
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal: asPrincipal(`https://issuer.invalid#${pool}-${randomUUID()}`),
    }),
    true,
  );
}

/** Runs out the lease of every live attempt of this execution, as the owner. */
async function leaseLapsed(routed: Routed): Promise<void> {
  await rig.harness.query(
    `UPDATE execution_attempt SET lease_expires_at=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND execution=$3
        AND state IN ('Placing','Running')`,
    routedKey(routed),
  );
}

/** What the scheduler has made of one execution so far, read as the owner. */
async function standing(routed: Routed): Promise<{
  readonly execution: Record<string, unknown>;
  readonly attempts: readonly Record<string, unknown>[];
}> {
  const key = routedKey(routed);
  const [execution] = await rig.harness.query(
    `SELECT status, outcome, blocked_reason, retries_spent::int AS retries_spent,
            placement_backoff_from IS NOT NULL AS backed_off
       FROM execution WHERE tenant=$1 AND project=$2 AND execution=$3`,
    key,
  );
  assert.ok(execution !== undefined);
  const attempts = await rig.harness.query(
    `SELECT state, evidence, pool FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND execution=$3
      ORDER BY opened_at, attempt`,
    key,
  );
  return { execution, attempts };
}

/** The standing of an execution the scheduler has not settled and has spent nothing on. */
const unsettled = {
  outcome: null,
  blocked_reason: null,
  retries_spent: 0,
};

test("an attempt no pool took ends withdrawn when its lease runs out, and spends nothing", async () => {
  const routed = await routedExecution("pools-unclaimed");
  await routedAttempt(routed);
  await leaseLapsed(routed);
  assert.equal(
    await rig.store.reapLapsedAttempts(
      routed.project.epoch,
      service.config.attemptsPerPassMax,
    ),
    1,
  );
  assert.deepEqual(await standing(routed), {
    execution: { status: "Launching", ...unsettled, backed_off: true },
    attempts: [
      { state: "Withdrawn", evidence: "PlacementUnavailable", pool: null },
    ],
  });
});

test("an attempt a pool held is lost when its lease runs out, and spends the budget", async () => {
  const routed = await routedExecution("pools-claimed");
  await poolRegistered(routed.project.partition, "claiming", [
    "Platform:Linux:Amd64",
  ]);
  const attempt = await routedAttempt(routed);
  assert.equal(
    await rig.store.attemptInvoked(attempt, schedulerInvocation),
    true,
  );
  const [pool] = (await roster.registered(routed.project.partition)).pools;
  assert.ok(pool !== undefined);
  assert.notEqual(
    await assignments.claim(
      pool,
      { leaseSecs: service.config.attemptLeaseSecs, heldMax: 1 },
      `assignment-${randomUUID()}`,
      `bearer-${randomUUID()}`,
    ),
    undefined,
  );
  await leaseLapsed(routed);
  assert.equal(
    await rig.store.reapLapsedAttempts(
      routed.project.epoch,
      service.config.attemptsPerPassMax,
    ),
    1,
  );
  assert.deepEqual(await standing(routed), {
    execution: {
      status: "Launching",
      ...unsettled,
      retries_spent: 1,
      backed_off: true,
    },
    attempts: [{ state: "Lost", evidence: "LeaseExpired", pool: "claiming" }],
  });
});

test("an execution routed to pools none of its project's is configured to run is blocked, and never placed", async () => {
  const routed = await routedExecution("pools-incompatible");
  await poolRegistered(routed.project.partition, "arm", [
    "Platform:Linux:Arm64",
  ]);
  await poolRegistered(
    await postgresHarnessProject(rig.harness.store, "pools-elsewhere"),
    "elsewhere",
    ["Platform:Linux:Amd64"],
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await standing(routed), {
    execution: {
      status: "Terminal",
      outcome: "Blocked",
      blocked_reason: "RequiredCapabilityUnavailable",
      retries_spent: 0,
      backed_off: true,
    },
    attempts: [
      { state: "Withdrawn", evidence: "PlacementIncompatible", pool: null },
    ],
  });
});

test("an execution routed to pools one of its project's is configured to run waits on its attempt, neither placed nor blocked", async () => {
  const routed = await routedExecution("pools-compatible");
  await poolRegistered(routed.project.partition, "amd", [
    "Platform:Linux:Amd64",
  ]);
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await standing(routed), {
    execution: { status: "Launching", ...unsettled, backed_off: false },
    attempts: [{ state: "Placing", evidence: null, pool: null }],
  });
});

test("an execution whose attempt no pool took is opened again once the placement backoff has passed, and not before", async () => {
  const routed = await routedExecution("pools-reopened");
  await poolRegistered(routed.project.partition, "amd", [
    "Platform:Linux:Amd64",
  ]);
  await executionSchedulerLaunch(service, routed.project.epoch);
  await leaseLapsed(routed);
  await executionSchedulerLaunch(service, routed.project.epoch);
  const withdrawn = {
    state: "Withdrawn",
    evidence: "PlacementUnavailable",
    pool: null,
  };
  assert.deepEqual(await standing(routed), {
    execution: { status: "Launching", ...unsettled, backed_off: true },
    attempts: [withdrawn],
  });
  await rig.harness.query(
    `UPDATE execution
        SET placement_backoff_from=placement_backoff_from-make_interval(secs=>$4)
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...routedKey(routed), service.config.placementBackoffSecs],
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await standing(routed), {
    execution: { status: "Launching", ...unsettled, backed_off: true },
    attempts: [withdrawn, { state: "Placing", evidence: null, pool: null }],
  });
});

test("the scheduler reads its own project's pools in name order, and says when there are more than one read answers", async () => {
  const partition = await postgresHarnessProject(
    rig.harness.store,
    "pools-roster",
  );
  await poolRegistered(
    await postgresHarnessProject(rig.harness.store, "pools-roster-elsewhere"),
    "elsewhere",
    [],
  );
  const names = Array.from(
    { length: workerPoolsAnsweredMax + 1 },
    (_, index) => `pool-${String(index).padStart(4, "0")}`,
  );
  for (const name of names.slice(0, workerPoolsAnsweredMax).reverse())
    await poolRegistered(partition, name, [name]);
  const whole = await roster.registered(partition);
  assert.equal(whole.truncated, false);
  assert.deepEqual(
    whole.pools.map(({ pool, capabilities }) => ({ pool, capabilities })),
    names
      .slice(0, workerPoolsAnsweredMax)
      .map((name) => ({ pool: name, capabilities: [name] })),
  );
  await poolRegistered(partition, names[workerPoolsAnsweredMax] ?? "", []);
  const cut = await roster.registered(partition);
  assert.equal(cut.truncated, true);
  assert.deepEqual(
    cut.pools.map(({ pool }) => pool),
    names.slice(0, workerPoolsAnsweredMax),
  );
});
