/**
 * The scheduler's half of work routed to pools, against a real PostgreSQL and
 * under the scheduler's own role: what a pass asks the registry before an
 * attempt waits for a runner, what the reaper does with one whose lease ran
 * out, what a pass does with one a runner refused, and that every other end of
 * one a runner claimed concludes its execution with no attempt opened again.
 * The runner is a personal runner of the execution's owner; a pool registered
 * to the project beside it is asked nothing.
 *
 * Everything but the authority is the role a deployment runs: the store and
 * the registry read are the scheduler's, a registration is the API's and a
 * claim is the pool plane's. The authority holds its grants in memory: every
 * pool registered here is granted `Execute`, and every runner's owner what
 * admits it and `Read` of its project; `test/keto/` asks a real one.
 *
 * A PASS IS INSTALLATION-WIDE and the cases share one database, so each reads
 * back only its own project's rows.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import {
  apiRole,
  poolPlaneRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import { postgresRunEvidenceReads } from "../../src/adapters/postgres/runEvidence.ts";
import {
  postgresWorkerArtifactReservations,
  postgresWorkerRunEnded,
} from "../../src/adapters/postgres/workerPlane.ts";
import { workerErrorPath } from "../../src/contract/http.ts";
import { workerPoolEvidenceCharsMax } from "../../src/contract/workerPool.ts";
import type { WorkerImageFault } from "../../src/contract/workerEnvironment.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolDirectory,
  postgresWorkerPoolRegistry,
  postgresWorkerPoolRunners,
} from "../../src/adapters/postgres/workerPool.ts";
import {
  asAttemptCapabilitySecret,
  asAttemptId,
} from "../../src/interpreter/executionScheduler.ts";
import {
  executionSchedulerFence,
  executionSchedulerLaunch,
} from "../../src/interpreter/executionSchedulerRun.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  type Partition,
  type RecoveryEpoch,
} from "../../src/interpreter/projectStore.ts";
import type { PersonalRunnerIdentity } from "../../src/interpreter/workerPool.ts";
import { workerPoolsAnsweredMax } from "../../src/interpreter/workerPool.ts";
import {
  postgresHarnessNewEpoch,
  postgresHarnessProject,
  postgresHarnessRolePool,
} from "./harness.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";
import {
  schedulerClaimFor,
  schedulerInCluster,
  schedulerInvocation,
  schedulerOwner,
  schedulerProject,
  schedulerRevoke,
  schedulerRigOpen,
  schedulerRuntime,
} from "./schedulerHarness.ts";
import {
  poolRoutedExecution,
  poolRoutedKey,
  poolRoutedService,
  poolRoutedStanding,
  poolRoutedUnsettled,
  type PoolRouted,
} from "./schedulerPoolsHarness.ts";

/** Who reads the executions; no ticket here is theirs. */
const reader = asPrincipal("operational-reader");
const rig = await schedulerRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const planePool = postgresHarnessRolePool(poolPlaneRole);
const harnessPlanePool = postgresHarnessRolePool(workerPlaneRole);

after(async () => {
  await Promise.all([apiPool.end(), planePool.end(), harnessPlanePool.end()]);
  await rig.close();
});

const registry = postgresWorkerPoolRegistry(apiPool);
const personalRegistry = postgresPersonalRunnerRegistry(apiPool);
const directory = postgresWorkerPoolDirectory(apiPool);
const assignments = postgresWorkerPoolAssignments(planePool);
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
    runtime: schedulerRuntime,
  });
  if (opened.opened !== "Opened")
    throw new Error(
      `scheduler pools suite: ${routed.execution} opened no attempt`,
    );
  return opened.attempt;
}

/** Registers one pool under the API's role, declaring `capabilities`, and grants it `Execute`. */
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

/** A member's personal runner as the pool plane admits it. */
type Runner = PersonalRunnerIdentity & { readonly kind: "Personal" };

/** Makes a fresh member the routed execution's owner, as taking its ticket would have, and answers them. */
async function executionOwned(routed: PoolRouted): Promise<Principal> {
  const owner = asPrincipal(`https://issuer.invalid#owner-${randomUUID()}`);
  await rig.harness.query(
    `UPDATE execution SET owner=$4
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...poolRoutedKey(routed), owner],
  );
  return owner;
}

/** What a runner `runnerOwning` registers declares. */
interface RunnerDeclared {
  readonly capabilities?: readonly string[];
  readonly memoryCeilingMib?: number;
}

/**
 * Makes a fresh member the routed execution's owner, registers a personal
 * runner of theirs listing its project and declaring `declared`, able to run
 * the harness requirement where it declares nothing, and grants the owner what
 * admits the runner and `Read` of the project. An attempt the runner claims
 * records its owner as its `pool`.
 */
async function runnerOwning(
  routed: PoolRouted,
  declared: RunnerDeclared = {},
): Promise<Runner & { readonly clientId: string }> {
  const { partition } = routed.project;
  const owner = await executionOwned(routed);
  const runner: Runner = {
    kind: "Personal",
    tenant: partition.tenant,
    owner,
    principal: asPrincipal(`https://issuer.invalid#runner-${randomUUID()}`),
  };
  const clientId = `chuggy-personal-${randomUUID()}`;
  assert.equal(
    await personalRegistry.register({
      tenant: partition.tenant,
      owner,
      capabilities: declared.capabilities ?? ["Platform:Linux:Amd64"],
      clientId,
      principal: runner.principal,
    }),
    "Registered",
  );
  if (declared.memoryCeilingMib !== undefined)
    await postgresWorkerPoolRunners(planePool).named(
      runner,
      undefined,
      undefined,
      declared.memoryCeilingMib,
    );
  assert.equal(
    await personalRegistry.allow(
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
  return { ...runner, clientId };
}

/** One claim by the runner in the routed execution's project, on the terms a runner asks under. */
function runnerClaim(
  routed: PoolRouted,
  runner: Runner,
  assignment = `assignment-${randomUUID()}`,
  bearer = `bearer-${randomUUID()}`,
) {
  return assignments.claimPersonal(
    runner,
    {
      leaseSecs: service.config.attemptLeaseSecs,
      heldMax: 1,
      memoryMibDefault: service.poolMemoryMib,
    },
    assignment,
    bearer,
    [routed.project.partition.project],
  );
}

test("an attempt offered to pools and never invoked keeps the lease it opened under, ends withdrawn when that runs out, and spends nothing", async () => {
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

test("an attempt a runner held is lost when its lease runs out, and spends the budget", async () => {
  const routed = await poolRoutedExecution(rig, "pools-claimed");
  const runner = await runnerOwning(routed);
  const attempt = await routedAttempt(routed);
  assert.equal(
    await rig.store.attemptInvoked(attempt, schedulerInvocation),
    true,
  );
  assert.notEqual(await runnerClaim(routed, runner), undefined);
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
    attempts: [{ state: "Lost", evidence: "LeaseExpired", pool: runner.owner }],
  });
});

/** Where an execution stands that a pass blocked for `reason` before any runner was offered it. */
function incompatibleStanding(reason: string) {
  return {
    execution: {
      status: "Terminal",
      outcome: "Blocked",
      blocked_reason: reason,
      retries_spent: 0,
      backed_off: true,
    },
    attempts: [
      { state: "Withdrawn", evidence: "PlacementIncompatible", pool: null },
    ],
  };
}

test("an execution routed to pools whose owner has no runner is blocked, and never placed, though a pool of its project is configured to run it", async () => {
  const routed = await poolRoutedExecution(rig, "pools-no-runner");
  await executionOwned(routed);
  await poolRegistered(routed.project.partition, "amd", [
    "Platform:Linux:Amd64",
  ]);
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    incompatibleStanding("RequiredCapabilityUnavailable"),
  );
});

test("an execution routed to pools with no owner is blocked, and never placed, though a pool of its project is configured to run it", async () => {
  const routed = await poolRoutedExecution(rig, "pools-no-owner");
  await poolRegistered(routed.project.partition, "amd", [
    "Platform:Linux:Amd64",
  ]);
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    incompatibleStanding("RequiredCapabilityUnavailable"),
  );
});

test("an execution routed to pools whose owner's every runner is configured for something else is blocked, and never placed", async () => {
  const routed = await poolRoutedExecution(rig, "pools-incompatible");
  await runnerOwning(routed, {
    capabilities: ["Platform:Linux:Arm64"],
    memoryCeilingMib: 1,
  });
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    incompatibleStanding("RequiredCapabilityUnavailable"),
  );
});

test("an execution routed to pools whose owner's runner configured to run it is too small for it is blocked as too large, and one fitting it at its ceiling waits", async () => {
  for (const [ceiling, standing] of [
    [
      service.poolMemoryMib - 1,
      incompatibleStanding("RequiredMemoryUnavailable"),
    ],
    [
      service.poolMemoryMib,
      {
        execution: {
          status: "Launching",
          ...poolRoutedUnsettled,
          backed_off: false,
        },
        attempts: [{ state: "Placing", evidence: null, pool: null }],
      },
    ],
  ] as const) {
    const routed = await poolRoutedExecution(
      rig,
      `pools-ceiling-${String(ceiling)}`,
    );
    await runnerOwning(routed, { memoryCeilingMib: ceiling });
    await executionSchedulerLaunch(service, routed.project.epoch);
    assert.deepEqual(
      await poolRoutedStanding(rig, routed),
      standing,
      String(ceiling),
    );
  }
});

test("an execution routed to pools whose owner's runner is configured to run it and not polling waits on its attempt, neither placed nor blocked", async () => {
  const routed = await poolRoutedExecution(rig, "pools-compatible");
  await runnerOwning(routed);
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

/** What an execution's one live attempt says of its wait, read as the owner. */
async function waitingRow(routed: PoolRouted) {
  const [row] = (await rig.harness.query(
    `SELECT attempt, attempt_number::int AS attempt_number, opened_at, runtime,
            lease_owner, lease_expires_at, claimed_at
       FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND execution=$3
        AND state IN ('Placing','Running')`,
    poolRoutedKey(routed),
  )) as readonly {
    attempt: string;
    attempt_number: number;
    opened_at: Date;
    runtime: string | null;
    lease_owner: string | null;
    lease_expires_at: Date | null;
    claimed_at: Date | null;
  }[];
  assert.ok(row !== undefined);
  return row;
}

/** Moves an execution's attempts' opening and backoff back by more than an attempt lease, as the owner, which is the wait a case cannot sleep through. */
async function leaseOutwaited(routed: PoolRouted): Promise<void> {
  const secs = service.config.attemptLeaseSecs + 1;
  await rig.harness.query(
    `UPDATE execution_attempt SET opened_at=opened_at-make_interval(secs=>$4)
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...poolRoutedKey(routed), secs],
  );
  await rig.harness.query(
    `UPDATE execution SET placement_backoff_from=placement_backoff_from-make_interval(secs=>$4)
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...poolRoutedKey(routed), secs],
  );
}

/** The one waiting attempt of this execution a pass would check. */
async function waitingRead(routed: PoolRouted) {
  const found = (
    await rig.store.waitingAttempts(
      routed.project.epoch,
      service.config.attemptsPerPassMax,
    )
  ).filter((attempt) => attempt.execution === routed.execution);
  assert.equal(found.length, 1);
  const [attempt] = found;
  assert.ok(attempt !== undefined);
  return attempt;
}

/** Where an execution stands whose one attempt waits for a runner. */
const waitingStanding = {
  execution: { status: "Launching", ...poolRoutedUnsettled, backed_off: false },
  attempts: [{ state: "Placing", evidence: null, pool: null }],
};

test("an invoked attempt no runner claims waits unleased past an attempt lease, keeping its opening and number, reads as unclaimed, and is then claimed", async () => {
  const routed = await poolRoutedExecution(rig, "pools-waiting");
  const runner = await runnerOwning(routed);
  await executionSchedulerLaunch(service, routed.project.epoch);
  const opened = await waitingRow(routed);
  assert.equal(opened.lease_owner, null);
  assert.equal(opened.lease_expires_at, null);
  assert.equal(opened.claimed_at, null);
  await leaseOutwaited(routed);
  const outwaited = await waitingRow(routed);
  for (let pass = 0; pass < 2; pass++)
    await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), waitingStanding);
  const waited = await waitingRow(routed);
  assert.equal(waited.attempt, opened.attempt);
  assert.equal(waited.attempt_number, 1);
  assert.deepEqual(waited.opened_at, outwaited.opened_at);
  const read = async () =>
    (
      await postgresOperationalReads(apiPool).execution(
        routed.project.partition,
        routed.execution,
        reader,
      )
    )?.attempts;
  const [unclaimed] = (await read()) ?? [];
  assert.equal(unclaimed?.state, "Placing");
  assert.equal(unclaimed.claimedAt, undefined);
  assert.notEqual(await runnerClaim(routed, runner), undefined);
  const claimed = await waitingRow(routed);
  assert.equal(claimed.attempt, opened.attempt);
  assert.ok(claimed.claimed_at !== null && claimed.lease_expires_at !== null);
  const [held] = (await read()) ?? [];
  assert.equal(held?.state, "Placing");
  assert.equal(Date.parse(held.claimedAt ?? ""), claimed.claimed_at.getTime());
});

test("a waiting attempt is withdrawn and opened again once the backoff has passed, and not before, when the runtime a pass prepares it under is repinned", async () => {
  const routed = await poolRoutedExecution(rig, "pools-repinned");
  await runnerOwning(routed);
  await executionSchedulerLaunch(service, routed.project.epoch);
  const repinned = {
    ...service,
    workerRuntime: `registry.chuggy.internal/chuggy/worker-runtime@sha256:${"f".repeat(64)}`,
  };
  await executionSchedulerLaunch(repinned, routed.project.epoch);
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
  await executionSchedulerLaunch(repinned, routed.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: true,
    },
    attempts: [withdrawn, { state: "Placing", evidence: null, pool: null }],
  });
  assert.equal((await waitingRow(routed)).runtime, repinned.workerRuntime);
  await executionSchedulerLaunch(repinned, routed.project.epoch);
  assert.equal(
    (await poolRoutedStanding(rig, routed)).attempts.length,
    2,
    "a waiting attempt prepared as it records is left waiting",
  );
});

/** What the summary read answers of an execution: when it was taken, read as the API reads it. */
async function summaryTakenAt(routed: PoolRouted): Promise<string | undefined> {
  const page = await postgresOperationalReads(apiPool).executions(
    routed.project.partition,
    { limit: 10 },
    reader,
  );
  const summary = page.executions.find(
    (each) => each.execution === routed.execution,
  );
  assert.ok(summary !== undefined);
  return summary.takenAt;
}

/** Withdraws a routed execution's first attempt unclaimed, as a repinned runtime does, and opens its second once the backoff has run out. */
async function poolReopened(routed: PoolRouted): Promise<void> {
  const repinned = {
    ...service,
    workerRuntime: `registry.chuggy.internal/chuggy/worker-runtime@sha256:${"f".repeat(64)}`,
  };
  await executionSchedulerLaunch(repinned, routed.project.epoch);
  await rig.harness.query(
    `UPDATE execution
        SET placement_backoff_from=placement_backoff_from-make_interval(secs=>$4)
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...poolRoutedKey(routed), service.config.placementBackoffSecs],
  );
  await executionSchedulerLaunch(repinned, routed.project.epoch);
  assert.equal((await poolRoutedStanding(rig, routed)).attempts.length, 2);
}

/** A routed execution whose first attempt was withdrawn unclaimed and whose second a runner claimed, with that claim. */
async function poolClaimedSecond(name: string) {
  const routed = await poolRoutedExecution(rig, name);
  const runner = await runnerOwning(routed);
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.equal(await summaryTakenAt(routed), undefined);
  await poolReopened(routed);
  assert.equal(await summaryTakenAt(routed), undefined);
  assert.notEqual(await runnerClaim(routed, runner), undefined);
  const claimed = await waitingRow(routed);
  assert.ok(claimed.claimed_at !== null);
  assert.equal(claimed.attempt_number, 2);
  return { routed, claimedAt: claimed.claimed_at };
}

test("a pool execution's summary is taken at its claim, and not by an attempt withdrawn unclaimed or one still waiting", async () => {
  const { routed, claimedAt } = await poolClaimedSecond("pools-taken");
  assert.equal(
    Date.parse((await summaryTakenAt(routed)) ?? ""),
    claimedAt.getTime(),
  );
});

/** Rewrites a finished attempt's claim, as history from before claims were recorded or from another claim would have it; a finished attempt is otherwise written once. */
async function finishedClaimed(
  attempt: readonly unknown[],
  claimedAt: Date | null,
): Promise<void> {
  const rewriting = await rig.harness.begin();
  try {
    await rewriting.query("SET LOCAL session_replication_role=replica");
    await rewriting.query(
      `UPDATE execution_attempt SET claimed_at=$5
        WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt_number=$4
          AND ended_at IS NOT NULL`,
      [...attempt, claimedAt],
    );
  } catch (error) {
    await rewriting.rollback();
    throw error;
  }
  await rewriting.commit();
}

test("a pool execution's summary is taken at its earliest claim, or at the opening of an attempt that ended unclaimed with its run recorded", async () => {
  const { routed, claimedAt } = await poolClaimedSecond("pools-taken-first");
  const first = [...poolRoutedKey(routed), 1];
  const earlier = new Date(claimedAt.getTime() - 60_000);
  await finishedClaimed(first, earlier);
  assert.equal(
    Date.parse((await summaryTakenAt(routed)) ?? ""),
    earlier.getTime(),
  );
  await finishedClaimed(first, null);
  const [opened] = (await rig.harness.query(
    `INSERT INTO execution_run (tenant,project,execution,attempt)
     SELECT tenant,project,execution,attempt FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND execution=$3 AND attempt_number=$4
        AND ended_at IS NOT NULL
     RETURNING (SELECT opened_at FROM execution_attempt a
                 WHERE a.tenant=$1 AND a.project=$2 AND a.execution=$3
                   AND a.attempt_number=$4) AS opened_at`,
    first,
  )) as readonly { opened_at: Date }[];
  assert.ok(opened !== undefined);
  assert.ok(opened.opened_at < claimedAt);
  assert.equal(
    Date.parse((await summaryTakenAt(routed)) ?? ""),
    opened.opened_at.getTime(),
  );
});

test("a waiting attempt is blocked once a registry change leaves no runner configured to run it", async () => {
  const routed = await poolRoutedExecution(rig, "pools-deregistered");
  const runner = await runnerOwning(routed);
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), waitingStanding);
  assert.equal(
    await personalRegistry.deregister(
      { tenant: runner.tenant, owner: runner.owner },
      runner.clientId,
    ),
    true,
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    incompatibleStanding("RequiredCapabilityUnavailable"),
  );
});

test("a waiting attempt of a project no longer Active is withdrawn, spending nothing, and opened again only once the project is Active", async () => {
  const routed = await poolRoutedExecution(rig, "pools-suspended");
  await runnerOwning(routed);
  await executionSchedulerLaunch(service, routed.project.epoch);
  const lifecycleSet = (lifecycle: string) =>
    rig.harness.query(
      `UPDATE project SET lifecycle=$3 WHERE tenant=$1 AND project=$2`,
      [
        routed.project.partition.tenant,
        routed.project.partition.project,
        lifecycle,
      ],
    );
  await lifecycleSet("Suspended");
  await executionSchedulerLaunch(service, routed.project.epoch);
  const withdrawn = {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: true,
    },
    attempts: [
      { state: "Withdrawn", evidence: "PlacementUnavailable", pool: null },
    ],
  };
  assert.deepEqual(await poolRoutedStanding(rig, routed), withdrawn);
  await rig.harness.query(
    `UPDATE execution
        SET placement_backoff_from=placement_backoff_from-make_interval(secs=>$4)
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [...poolRoutedKey(routed), service.config.placementBackoffSecs],
  );
  for (let pass = 0; pass < 2; pass++)
    await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), withdrawn);
  await lifecycleSet("Active");
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual((await poolRoutedStanding(rig, routed)).attempts, [
    ...withdrawn.attempts,
    { state: "Placing", evidence: null, pool: null },
  ]);
});

test("successive reads of the waiting attempts each start after where the last stopped, and start over after a short one, so a batch smaller than the attempts waiting reaches every one", async () => {
  const routedAll = [];
  for (const name of ["pools-turn-a", "pools-turn-b", "pools-turn-c"]) {
    const routed = await poolRoutedExecution(rig, name);
    await runnerOwning(routed);
    await executionSchedulerLaunch(service, routed.project.epoch);
    routedAll.push(routed);
  }
  const [first] = routedAll;
  assert.ok(first !== undefined);
  const turn = async () => {
    const read: string[] = [];
    for (let call = 0; call < 1024; call++) {
      const batch = await rig.store.waitingAttempts(first.project.epoch, 1);
      assert.ok(batch.length <= 1);
      const [attempt] = batch;
      if (attempt === undefined) return read;
      read.push(attempt.attempt);
    }
    assert.fail("the waiting attempts never ran short of a batch");
  };
  await turn();
  const read = await turn();
  assert.equal(new Set(read).size, read.length);
  for (const routed of routedAll)
    assert.ok(read.includes((await waitingRow(routed)).attempt));
  assert.deepEqual(await turn(), read);
});

test("a check that read an attempt as waiting ends nothing once a runner has claimed it", async () => {
  const routed = await poolRoutedExecution(rig, "pools-check-raced");
  const runner = await runnerOwning(routed);
  await executionSchedulerLaunch(service, routed.project.epoch);
  const read = await waitingRead(routed);
  assert.equal(read.projectActive, true);
  assert.notEqual(await runnerClaim(routed, runner), undefined);
  assert.equal(
    await rig.store.waitingAttemptWithdrawn(read, "PlacementIncompatible"),
    false,
  );
  assert.equal(
    await rig.store.waitingAttemptOutdated(read, {
      invocation: schedulerInvocation,
      runtime: "registry.chuggy.internal/elsewhere",
    }),
    false,
  );
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
    ...waitingStanding,
    attempts: [{ state: "Placing", evidence: null, pool: runner.owner }],
  });
});

test("cancelling a waiting execution ends its attempt", async () => {
  const routed = await poolRoutedExecution(rig, "pools-cancelled");
  await runnerOwning(routed);
  await executionSchedulerLaunch(service, routed.project.epoch);
  const read = await waitingRead(routed);
  const cancellation = await schedulerRevoke(
    rig,
    routed.project,
    "pools-cancelled",
  );
  const cancelled = await rig.store.registerCancellation(
    await schedulerClaimFor(
      rig,
      routed.project.partition,
      cancellation,
      schedulerOwner("pools-cancelled"),
    ),
  );
  assert.deepEqual(cancelled, {
    cancelled: "Registered",
    fenced: 1,
    placements: [
      {
        partition: read.partition,
        execution: read.execution,
        attempt: read.attempt,
        generation: read.generation,
      },
    ],
  });
  assert.deepEqual((await poolRoutedStanding(rig, routed)).attempts, [
    { state: "Superseded", evidence: "Fenced", pool: null },
  ]);
});

test("an attempt routed in the cluster keeps its lease once invoked, and is lost when that lapses", async () => {
  const project = await schedulerProject(rig, "pools-in-cluster", {
    tasks: 1,
  });
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner("pools-in-cluster"),
    ),
    1,
    schedulerInCluster,
  );
  const admitted = await rig.store.admit(project.cluster);
  assert.ok(admitted.admitted === "Admitted");
  const routed = { project, execution: admitted.execution };
  const attempt = await routedAttempt(routed);
  assert.equal(
    await rig.store.attemptInvoked(attempt, schedulerInvocation),
    true,
  );
  const invoked = await waitingRow(routed);
  assert.ok(invoked.lease_owner !== null && invoked.lease_expires_at !== null);
  await leaseLapsed(routed);
  await rig.store.reapLapsedAttempts(
    project.epoch,
    service.config.attemptsPerPassMax,
  );
  assert.deepEqual(await poolRoutedStanding(rig, routed), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      retries_spent: 1,
      backed_off: true,
    },
    attempts: [{ state: "Lost", evidence: "LeaseExpired", pool: null }],
  });
});

test("a member reads the project's own pools in name order, and is told when there are more than one read answers", async () => {
  const partition = await postgresHarnessProject(
    rig.harness.store,
    "pools-roster",
  );
  await poolRegistered(
    await postgresHarnessProject(rig.harness.store, "pools-roster-elsewhere"),
    "elsewhere",
    [],
  );
  const sibling = {
    tenant: partition.tenant,
    project: asProjectId(`project-pools-roster-sibling-${randomUUID()}`),
  };
  await rig.harness.store.createProject(sibling);
  await poolRegistered(sibling, "sibling", []);
  const names = Array.from(
    { length: workerPoolsAnsweredMax + 1 },
    (_, index) => `pool-${String(index).padStart(4, "0")}`,
  );
  for (const name of names.slice(0, workerPoolsAnsweredMax).reverse())
    await poolRegistered(partition, name, [name]);
  const answered = names
    .slice(0, workerPoolsAnsweredMax)
    .map((name) => ({ pool: name, capabilities: [name] }));
  const listed = await directory.listed(partition);
  assert.equal(listed.truncated, false);
  assert.deepEqual(
    listed.pools.map(({ pool, capabilities }) => ({ pool, capabilities })),
    answered,
  );
  const stamped = (await rig.harness.query(
    `SELECT pool, registered_at FROM worker_pool
      WHERE tenant=$1 AND project=$2 ORDER BY pool`,
    [partition.tenant, partition.project],
  )) as readonly { pool: string; registered_at: Date }[];
  assert.deepEqual(
    listed.pools.map(({ pool, registeredAt }) => ({ pool, registeredAt })),
    stamped.map((row) => ({
      pool: row.pool,
      registeredAt: row.registered_at.toISOString(),
    })),
  );
  await poolRegistered(partition, names[workerPoolsAnsweredMax] ?? "", []);
  const listedCut = await directory.listed(partition);
  assert.equal(listedCut.truncated, true);
  assert.deepEqual(
    listedCut.pools.map(({ pool }) => pool),
    names.slice(0, workerPoolsAnsweredMax),
  );
});

/** Registers a runner of a routed execution's owner, opens and invokes its attempt, and has the runner claim it, answering the runner and the assignment it claimed under. */
async function runnerClaimed(routed: PoolRouted) {
  const runner = await runnerOwning(routed);
  const attempt = await routedAttempt(routed);
  assert.equal(
    await rig.store.attemptInvoked(attempt, schedulerInvocation),
    true,
  );
  const assignment = `assignment-${randomUUID()}`;
  const bearer = `bearer-${randomUUID()}`;
  assert.notEqual(
    await runnerClaim(routed, runner, assignment, bearer),
    undefined,
  );
  return { runner, assignment, bearer };
}

/** Has a runner claim a routed execution's attempt, as `runnerClaimed` does, and refuse it, naming `fault` where one is given, answering the runner. */
async function runnerRefused(
  routed: PoolRouted,
  refusal: string,
  fault?: WorkerImageFault,
): Promise<Runner> {
  const { runner, assignment } = await runnerClaimed(routed);
  assert.equal(
    await assignments.refuse(runner, assignment, refusal, fault),
    true,
  );
  return runner;
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

/** Where an execution `runner` refused stands once a pass has read the refusal. */
function refusedStanding(runner: Runner) {
  return {
    execution: {
      status: "Terminal",
      outcome: "Blocked",
      blocked_reason: "RequiredCapabilityUnavailable",
      retries_spent: 0,
      backed_off: true,
    },
    attempts: [
      { state: "Withdrawn", evidence: "PlacementRefused", pool: runner.owner },
    ],
  };
}

/** Where an execution stands once a pass has read a refusal by `runner` naming `fault`: blocked as incompatible, its attempt withdrawn under the fault. */
function faultedStanding(fault: WorkerImageFault, runner: Runner) {
  return {
    execution: {
      ...refusedStanding(runner).execution,
      blocked_reason: "TicketConfigIncompatible",
    },
    attempts: [{ state: "Withdrawn", evidence: fault, pool: runner.owner }],
  };
}

/** Where an execution stands once a pass has concluded it on the one attempt `runner` claimed: settled as the process that died. */
function concludedStanding(
  attempt: Record<string, unknown>,
  execution: { readonly retries_spent: number; readonly backed_off: boolean },
  runner: Runner,
) {
  return {
    execution: {
      status: "Terminal",
      outcome: "ProcessFailed",
      blocked_reason: null,
      ...execution,
    },
    attempts: [{ ...attempt, pool: runner.owner }],
  };
}

/** Where an execution stands once a pass has found the attempt `runner` claimed lost. */
function lostStanding(runner: Runner) {
  return concludedStanding(
    { state: "Lost", evidence: "LeaseExpired" },
    { retries_spent: 1, backed_off: true },
    runner,
  );
}

/** Records the invocation on every live, uninvoked attempt of the execution, as the scheduler will once it invokes a runner's, and answers how many there were. */
async function poolInvokedLive(routed: PoolRouted): Promise<number> {
  const live = (await rig.harness.query(
    `SELECT attempt, generation::int AS generation FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND execution=$3
        AND state IN ('Placing','Running') AND NOT invoked`,
    poolRoutedKey(routed),
  )) as readonly { attempt: string; generation: number }[];
  for (const row of live) {
    assert.equal(
      await rig.store.attemptInvoked(
        {
          partition: routed.project.partition,
          execution: routed.execution,
          attempt: asAttemptId(row.attempt),
          generation: row.generation,
        },
        schedulerInvocation,
      ),
      true,
    );
  }
  return live.length;
}

/**
 * That a concluded execution stays concluded: a later pass, past any backoff an
 * unconcluded one would still be holding, opens no attempt, so none is left to
 * invoke and the runner that claimed the first can claim nothing.
 */
async function runnerConcludedStays(
  routed: PoolRouted,
  epoch: RecoveryEpoch,
  runner: Runner,
  standing: ReturnType<typeof concludedStanding>,
): Promise<void> {
  assert.deepEqual(await poolRoutedStanding(rig, routed), standing);
  await rig.harness.query(
    `UPDATE execution SET placement_backoff_from=now()-interval '1 hour'
      WHERE tenant=$1 AND project=$2 AND execution=$3
        AND status NOT IN ('Terminal','Cancelled')`,
    poolRoutedKey(routed),
  );
  await executionSchedulerLaunch(service, epoch);
  assert.deepEqual(await poolRoutedStanding(rig, routed), standing);
  assert.equal(await poolInvokedLive(routed), 0);
  assert.equal(await runnerClaim(routed, runner), undefined);
}

test("an attempt a runner refused is withdrawn without spending, its execution blocked, and the longest refusal kept whole", async () => {
  const routed = await poolRoutedExecution(rig, "pools-refused");
  const refusal = "r".repeat(workerPoolEvidenceCharsMax);
  const runner = await runnerRefused(routed, refusal);
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    refusedStanding(runner),
  );
  assert.deepEqual(await poolRefusals(routed), [refusal]);
});

/**
 * A refusal is ended and blocked in two transactions. Another pass can run
 * between them, a second scheduler's or this one's after a crash, and finds
 * the claimed attempt ended with no report; it blocks rather than settling the
 * process as dead, and the block committed after it is the one already there.
 */
test("a pass between a refusal's end and its block blocks the execution as refused", async () => {
  const routed = await poolRoutedExecution(rig, "pools-refused-window");
  const runner = await runnerRefused(routed, "no node takes this image");
  const refused = (
    await rig.store.refusedAttempts(
      routed.project.epoch,
      service.config.attemptsPerPassMax,
    )
  ).find((attempt) => attempt.execution === routed.execution);
  assert.ok(refused);
  assert.equal(
    await rig.store.attemptEnded(refused, "Withdrawn", "PlacementRefused"),
    true,
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    refusedStanding(runner),
  );
  const late = await rig.store.blockExecution(
    routed.project.partition,
    routed.execution,
    "RequiredCapabilityUnavailable",
  );
  assert.equal(late.blocked, "AlreadyBlocked");
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    refusedStanding(runner),
  );
});

test("an attempt a runner refused naming an image fault is withdrawn under the fault without spending, and its execution blocked as incompatible", async () => {
  const routed = await poolRoutedExecution(rig, "pools-faulted");
  const refusal = "/workspace is not writable";
  const runner = await runnerRefused(
    routed,
    refusal,
    "ImageWorkspaceUnwritable",
  );
  const read = (
    await rig.store.refusedAttempts(
      routed.project.epoch,
      service.config.attemptsPerPassMax,
    )
  ).find((attempt) => attempt.execution === routed.execution);
  assert.equal(read?.fault, "ImageWorkspaceUnwritable");
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    faultedStanding("ImageWorkspaceUnwritable", runner),
  );
  assert.deepEqual(await poolRefusals(routed), [refusal]);
});

test("a pass between a fault refusal's end and its block blocks the execution as incompatible", async () => {
  const routed = await poolRoutedExecution(rig, "pools-faulted-window");
  const runner = await runnerRefused(routed, "no shell", "ImageLacksShell");
  const refused = (
    await rig.store.refusedAttempts(
      routed.project.epoch,
      service.config.attemptsPerPassMax,
    )
  ).find((attempt) => attempt.execution === routed.execution);
  assert.ok(refused);
  assert.equal(
    await rig.store.attemptEnded(refused, "Withdrawn", "ImageLacksShell"),
    true,
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    faultedStanding("ImageLacksShell", runner),
  );
});

test("a spent budget whose last attempt a runner refused naming a fault blocks its execution as incompatible", async () => {
  const routed = await poolRoutedExecution(rig, "pools-faulted-spent");
  await runnerRefused(routed, "no git", "ImageLacksGit");
  const refused = (
    await rig.store.refusedAttempts(
      routed.project.epoch,
      service.config.attemptsPerPassMax,
    )
  ).find((attempt) => attempt.execution === routed.execution);
  assert.ok(refused);
  assert.equal(
    await rig.store.attemptEnded(refused, "Withdrawn", "ImageLacksGit"),
    true,
  );
  await rig.harness.query(
    `UPDATE execution SET retries_spent=3 WHERE tenant=$1 AND project=$2 AND execution=$3`,
    poolRoutedKey(routed),
  );
  await rig.store.retriesExhausted(routed.project.partition, routed.execution);
  const standing = await poolRoutedStanding(rig, routed);
  assert.deepEqual(
    {
      outcome: standing.execution["outcome"],
      blocked_reason: standing.execution["blocked_reason"],
    },
    { outcome: "Blocked", blocked_reason: "TicketConfigIncompatible" },
  );
});

test("a refused attempt whose lease has also run out is not the reaper's, and the pass blocks it as refused", async () => {
  const routed = await poolRoutedExecution(rig, "pools-refused-lapsed");
  const runner = await runnerRefused(routed, "no node takes this image");
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
    attempts: [{ state: "Placing", evidence: null, pool: runner.owner }],
  });
  await executionSchedulerLaunch(service, routed.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, routed),
    refusedStanding(runner),
  );
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
  const firstRunner = await runnerRefused(first, "no node takes this image");
  const secondRunner = await runnerRefused(second, "no node takes this image");
  const { runner: heldRunner } = await runnerClaimed(held);
  for (const routed of [first, second, held]) await leaseLapsed(routed);
  await executionSchedulerLaunch(one, held.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, first),
    refusedStanding(firstRunner),
  );
  assert.deepEqual(await poolRoutedStanding(rig, second), {
    execution: {
      status: "Launching",
      ...poolRoutedUnsettled,
      backed_off: false,
    },
    attempts: [{ state: "Placing", evidence: null, pool: secondRunner.owner }],
  });
  assert.deepEqual(
    await poolRoutedStanding(rig, held),
    lostStanding(heldRunner),
  );
  await executionSchedulerLaunch(one, held.project.epoch);
  assert.deepEqual(
    await poolRoutedStanding(rig, second),
    refusedStanding(secondRunner),
  );
});

test("an execution whose claimed attempt is lost concludes on that pass, and opens no attempt again", async () => {
  const routed = await poolRoutedExecution(rig, "pools-lost");
  const { runner } = await runnerClaimed(routed);
  await leaseLapsed(routed);
  await executionSchedulerLaunch(service, routed.project.epoch);
  await runnerConcludedStays(
    routed,
    routed.project.epoch,
    runner,
    lostStanding(runner),
  );
});

test("an execution whose claimed attempt its run ends rate limited concludes on the next pass, and opens no attempt again", async () => {
  const routed = await poolRoutedExecution(rig, "pools-rate-limited");
  const { runner, bearer } = await runnerClaimed(routed);
  assert.equal(
    await postgresWorkerRunEnded(harnessPlanePool).end({
      secret: asAttemptCapabilitySecret(bearer),
      generation: 1,
      evidence: "RunRateLimited",
    }),
    true,
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
  await runnerConcludedStays(
    routed,
    routed.project.epoch,
    runner,
    concludedStanding(
      { state: "Withdrawn", evidence: "RunRateLimited" },
      { retries_spent: 0, backed_off: true },
      runner,
    ),
  );
});

/**
 * What a member reads of the run a killed runner ended: the retry its loss
 * spent was never a relaunch, and the attempt carries the text its worker left.
 */
test("an execution a runner lost its one attempt of reads as relaunched never, carrying the worker's error", async () => {
  const routed = await poolRoutedExecution(rig, "pools-run-failed");
  const { bearer } = await runnerClaimed(routed);
  const left = { path: workerErrorPath, digest: "e".repeat(64), bytes: 61 };
  assert.deepEqual(
    await postgresWorkerArtifactReservations(harnessPlanePool).reserve({
      secret: asAttemptCapabilitySecret(bearer),
      ...left,
    }),
    { reserved: "Reserved" },
  );
  assert.equal(
    await postgresWorkerRunEnded(harnessPlanePool).end({
      secret: asAttemptCapabilitySecret(bearer),
      generation: 1,
      evidence: "RunFailed",
    }),
    true,
  );
  await executionSchedulerLaunch(service, routed.project.epoch);
  const { partition } = routed.project;
  const read = await postgresOperationalReads(apiPool).execution(
    partition,
    routed.execution,
    reader,
  );
  assert.equal(read?.outcome, "ProcessFailed");
  assert.equal(read.retriesSpent, 1);
  assert.equal(read.relaunches, 0);
  const [attempt] = read.attempts;
  assert.ok(attempt !== undefined && read.attempts.length === 1);
  assert.deepEqual(attempt.error, { bytes: left.bytes });
  const stored = await postgresRunEvidenceReads(apiPool).error(
    partition,
    routed.execution,
    attempt.attempt,
  );
  assert.deepEqual(
    { path: stored?.path, digest: stored?.digest, bytes: stored?.bytes },
    left,
  );
});

test("an execution whose claimed attempt its runner releases concludes on the next pass, and opens no attempt again", async () => {
  const routed = await poolRoutedExecution(rig, "pools-released");
  const { runner, assignment } = await runnerClaimed(routed);
  assert.equal(await assignments.release(runner, assignment), true);
  await executionSchedulerLaunch(service, routed.project.epoch);
  await runnerConcludedStays(
    routed,
    routed.project.epoch,
    runner,
    concludedStanding(
      { state: "Withdrawn", evidence: "PlacementUnavailable" },
      { retries_spent: 0, backed_off: false },
      runner,
    ),
  );
});

test("an execution no pool claimed an attempt of is not concluded as one whose assignment ended", async () => {
  const routed = await poolRoutedExecution(rig, "pools-unassigned");
  await routedAttempt(routed);
  await leaseLapsed(routed);
  await rig.store.reapLapsedAttempts(
    routed.project.epoch,
    service.config.attemptsPerPassMax,
  );
  const settled = await rig.store.assignmentEnded(
    routed.project.partition,
    routed.execution,
  );
  assert.equal(settled.terminalized, "Conflicting");
  assert.equal(
    (await poolRoutedStanding(rig, routed)).execution["status"],
    "Launching",
  );
});

/**
 * A restore moves the recovery epoch for the whole installation, so this case
 * runs last: every later pass here would be under the epoch it establishes.
 * The fence is bounded per pass and takes attempts in key order, so it is
 * asked until it fences nothing.
 */
test("an execution whose claimed attempt a restore fences loses it, concludes on the pass that follows, and opens no attempt again", async () => {
  const routed = await poolRoutedExecution(rig, "pools-restored");
  const { runner } = await runnerClaimed(routed);
  const restored = await rig.harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  let fenced = 0;
  for (let pass = 0; pass < 100; pass++) {
    const more = await executionSchedulerFence(service, restored);
    fenced += more;
    if (more === 0) break;
  }
  assert.ok(fenced >= 1);
  await executionSchedulerLaunch(service, restored);
  await runnerConcludedStays(
    routed,
    restored,
    runner,
    concludedStanding(
      { state: "Lost", evidence: "Fenced" },
      { retries_spent: 0, backed_off: false },
      runner,
    ),
  );
});
