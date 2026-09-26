/**
 * The scheduler's half of work routed to pools, against a real PostgreSQL and
 * under the scheduler's own role: what a pass asks the registry before an
 * attempt waits for a pool, what the reaper does with one whose lease ran out,
 * and what a pass does with one a pool refused.
 *
 * Everything but the authority is the role a deployment runs: the store and
 * the registry read are the scheduler's, a registration is the API's and a
 * claim is the pool plane's. The authority holds its grants in memory, and
 * every pool registered here is granted `Execute`; `test/keto/` asks a real
 * one about a pool it withholds that from.
 *
 * A PASS IS INSTALLATION-WIDE and the cases share one database, so each reads
 * back only its own project's rows.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { apiRole, poolPlaneRole } from "../../src/adapters/postgres/schema.ts";
import { workerPoolEvidenceCharsMax } from "../../src/contract/workerPool.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
  postgresWorkerPoolRoster,
} from "../../src/adapters/postgres/workerPool.ts";
import { executionSchedulerLaunch } from "../../src/interpreter/executionSchedulerRun.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { workerPoolsAnsweredMax } from "../../src/interpreter/workerPool.ts";
import { postgresHarnessProject, postgresHarnessRolePool } from "./harness.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";
import { schedulerInvocation, schedulerRigOpen } from "./schedulerHarness.ts";
import {
  poolRoutedExecution,
  poolRoutedKey,
  poolRoutedService,
  poolRoutedStanding,
  poolRoutedUnsettled,
  type PoolRouted,
} from "./schedulerPoolsHarness.ts";

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
const access = memoryProjectAccess();
const service = poolRoutedService(rig, access);

/** The attempt the scheduler opens for a routed execution, with the lease and budget a pass opens it under. */
async function routedAttempt(routed: PoolRouted) {
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

/** Registers one pool under the API's role, declaring what the case wants it to, and grants it `Execute`. */
async function poolRegistered(
  partition: Partition,
  pool: string,
  capabilities: readonly string[],
): Promise<void> {
  const principal = asPrincipal(
    `https://issuer.invalid#${pool}-${randomUUID()}`,
  );
  assert.equal(
    await registry.register({
      partition,
      pool,
      capabilities,
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal,
    }),
    true,
  );
  access.grant({ partition, principal, access: new Set(["Execute"]) });
}

/** Runs out the lease of every live attempt of this execution, as the owner. */
async function leaseLapsed(routed: PoolRouted): Promise<void> {
  await rig.harness.query(
    `UPDATE execution_attempt SET lease_expires_at=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND execution=$3
        AND state IN ('Placing','Running')`,
    poolRoutedKey(routed),
  );
}

test("an attempt no pool took ends withdrawn when its lease runs out, and spends nothing", async () => {
  const routed = await poolRoutedExecution(rig, "pools-unclaimed");
  await routedAttempt(routed);
  await leaseLapsed(routed);
  assert.equal(
    await rig.store.reapLapsedAttempts(
      routed.project.epoch,
      service.config.attemptsPerPassMax,
    ),
    1,
  );
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: true,
    },
    attempts: [
      { state: "Withdrawn", evidence: "PlacementUnavailable", pool: null },
    ],
  });
});

test("an attempt a pool held is lost when its lease runs out, and spends the budget", async () => {
  const routed = await poolRoutedExecution(rig, "pools-claimed");
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
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      retries_spent: 1,
      backed_off: true,
    },
    attempts: [{ state: "Lost", evidence: "LeaseExpired", pool: "claiming" }],
  });
});

test("an execution routed to pools none of its project's is configured to run is blocked, and never placed", async () => {
  const routed = await poolRoutedExecution(rig, "pools-incompatible");
  await poolRegistered(routed.project.partition, "arm", [
    "Platform:Linux:Arm64",
  ]);
  await poolRegistered(
    await postgresHarnessProject(rig.harness.store, "pools-elsewhere"),
    "elsewhere",
    ["Platform:Linux:Amd64"],
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
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
  const routed = await poolRoutedExecution(rig, "pools-compatible");
  await poolRegistered(routed.project.partition, "amd", [
    "Platform:Linux:Amd64",
  ]);
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: false,
    },
    attempts: [{ state: "Placing", evidence: null, pool: null }],
  });
});

test("an execution whose attempt no pool took is opened again once the placement backoff has passed, and not before", async () => {
  const routed = await poolRoutedExecution(rig, "pools-reopened");
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
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: true,
    },
    attempts: [withdrawn],
  });
  await rig.harness.query(
    `UPDATE execution
        SET placement_backoff_from=placement_backoff_from-make_interval(secs=>$4)
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...poolRoutedKey(routed), service.config.placementBackoffSecs],
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: true,
    },
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

/** Registers a pool for a routed execution, opens and invokes its attempt, and has the pool claim it, answering the pool and the assignment it claimed under. */
async function poolClaimed(routed: PoolRouted, name: string) {
  await poolRegistered(routed.project.partition, name, [
    "Platform:Linux:Amd64",
  ]);
  const attempt = await routedAttempt(routed);
  assert.equal(
    await rig.store.attemptInvoked(attempt, schedulerInvocation),
    true,
  );
  const [pool] = (await roster.registered(routed.project.partition)).pools;
  assert.ok(pool !== undefined);
  const assignment = `assignment-${randomUUID()}`;
  assert.notEqual(
    await assignments.claim(
      pool,
      { leaseSecs: service.config.attemptLeaseSecs, heldMax: 1 },
      assignment,
      `bearer-${randomUUID()}`,
    ),
    undefined,
  );
  return { pool, assignment };
}

/** Has a pool claim a routed execution's attempt, as `poolClaimed` does, and refuse it. */
async function poolRefused(routed: PoolRouted, refusal: string): Promise<void> {
  const { pool, assignment } = await poolClaimed(routed, "refusing");
  assert.equal(await assignments.refuse(pool, assignment, refusal), true);
}

/** The refusal each of an execution's attempts carries, read as the owner. */
async function poolRefusals(
  routed: PoolRouted,
): Promise<readonly (string | null)[]> {
  const rows = (await rig.harness.query(
    `SELECT pool_refusal FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND execution=$3
      ORDER BY opened_at, attempt`,
    poolRoutedKey(routed),
  )) as readonly { pool_refusal: string | null }[];
  return rows.map((row) => row.pool_refusal);
}

/** Where an execution a pool refused stands once a pass has read the refusal. */
const refusedStanding = {
  execution: {
    status: "Terminal",
    outcome: "Blocked",
    blocked_reason: "RequiredCapabilityUnavailable",
    retries_spent: 0,
    backed_off: true,
  },
  attempts: [
    { state: "Withdrawn", evidence: "PlacementRefused", pool: "refusing" },
  ],
};

test("an attempt a pool refused is withdrawn without spending, its execution blocked, and the longest refusal kept whole", async () => {
  const routed = await poolRoutedExecution(rig, "pools-refused");
  const refusal = "r".repeat(workerPoolEvidenceCharsMax);
  await poolRefused(routed, refusal);
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), refusedStanding);
  assert.deepEqual(await poolRefusals(routed), [refusal]);
});

test("a refused attempt whose lease has also run out is not the reaper's, and the pass blocks it as refused", async () => {
  const routed = await poolRoutedExecution(rig, "pools-refused-lapsed");
  await poolRefused(routed, "no node takes this image");
  await leaseLapsed(routed);
  await rig.store.reapLapsedAttempts(
    routed.project.epoch,
    service.config.attemptsPerPassMax,
  );
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: false,
    },
    attempts: [{ state: "Placing", evidence: null, pool: "refusing" }],
  });
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), refusedStanding);
  assert.deepEqual(await poolRefusals(routed), ["no node takes this image"]);
});

test("attempts refused past what one pass takes do not hold the reaper off an attempt that lapsed unrefused", async () => {
  const one = {
    ...service,
    config: { ...service.config, attemptsPerPassMax: 1 },
  };
  const first = await poolRoutedExecution(rig, "pools-bound-a");
  const second = await poolRoutedExecution(rig, "pools-bound-b");
  const held = await poolRoutedExecution(rig, "pools-bound-c");
  await poolRefused(first, "no node takes this image");
  await poolRefused(second, "no node takes this image");
  await poolClaimed(held, "claiming");
  for (const routed of [first, second, held]) await leaseLapsed(routed);
  await executionSchedulerLaunch(one, held.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, first), refusedStanding);
  assert.deepEqual(await poolRoutedStanding(rig, second), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: false,
    },
    attempts: [{ state: "Placing", evidence: null, pool: "refusing" }],
  });
  assert.deepEqual(await poolRoutedStanding(rig, held), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      retries_spent: 1,
      backed_off: true,
    },
    attempts: [{ state: "Lost", evidence: "LeaseExpired", pool: "claiming" }],
  });
  await executionSchedulerLaunch(one, held.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, second), refusedStanding);
});
