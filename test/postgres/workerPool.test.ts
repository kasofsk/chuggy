/**
 * The registry and the assignment life, driven against a real PostgreSQL under
 * the roles the deployment runs: the plane that serves pools, the plane that
 * serves harnesses, and the API that registers one.
 *
 * EVERY CASE STARTS FROM AN OPENED, UNPLACED ATTEMPT. That is the row a pool
 * claims, and it is what the scheduler leaves behind when it opens an attempt
 * for an execution marked for a pool. Nothing in this tree marks one yet, so
 * each case writes `placement` itself through the owner's harness, which is
 * exactly the one fact the slice that routes work will supply.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import type pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  apiRole,
  poolPlaneRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
} from "../../src/adapters/postgres/workerPool.ts";
import { postgresWorkerPlaneAuthority } from "../../src/adapters/postgres/workerPlane.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { WorkerPoolIdentity } from "../../src/interpreter/workerPool.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessConfiguration, postgresHarnessUrl } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerProject,
} from "./schedulerHarness.ts";

/** One role's own pool over the migrated database, which is how a grant is proved. */
function rolePool(role: string): pg.Pool {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${role}`);
  return postgresPool(url.toString());
}

const rig = await schedulerRigOpen();
const planePool = rolePool(poolPlaneRole);
const apiPool = rolePool(apiRole);
const harnessPlanePool = rolePool(workerPlaneRole);

after(async () => {
  await Promise.all([planePool.end(), apiPool.end(), harnessPlanePool.end()]);
  await rig.close();
});

const registry = postgresWorkerPoolRegistry(apiPool);
const assignments = postgresWorkerPoolAssignments(planePool);

/** How long a claim's lease runs for, past the duration of any case here. */
const leaseSecs = 300;

/**
 * The requirement a project's own configuration puts on every execution of it,
 * which is where the capabilities a pool is matched against come from. A
 * capability requirement is the one a single-agent worker states, and the
 * platform default has to be it rather than refine it, because a default of a
 * different mode is a widening the materializer refuses.
 */
function poolConfiguration(agent: "Claude" | "Codex" | undefined): string {
  const authored = JSON.parse(String(postgresHarnessConfiguration)) as Record<
    string,
    unknown
  >;
  if (agent === undefined) return JSON.stringify(authored);
  return JSON.stringify({
    ...authored,
    worker: { mode: { type: "SingleAgent", agent } },
    executionRequirements: {
      platformDefault: {
        mode: "ContainerCapability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: [`Agent:${agent}`],
      },
      platformDefaultVersion: 1,
    },
  });
}

/**
 * A project whose spawn request is registered, which is what leaves work to
 * admit. Its pinned revision is rewritten first where the case wants its work
 * to require a capability: the requirement is read out of the canonical at
 * registration and is a pin afterwards, which the durable authority enforces.
 */
async function poolProject(
  label: string,
  tasks = 1,
  agent?: "Claude" | "Codex",
): Promise<SchedulerProject> {
  const project = await schedulerProject(rig, label, { tasks });
  await rig.harness.query(
    `UPDATE configuration_revision SET canonical=$3 WHERE tenant=$1 AND project=$2`,
    [
      project.partition.tenant,
      project.partition.project,
      poolConfiguration(agent),
    ],
  );
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    200,
  );
  return project;
}

/**
 * One execution of this project opened as an attempt and marked for a pool,
 * which is the row a claim takes. The scheduler's own launch read is guarded
 * by the same column, so nothing here is work it would also place.
 */
async function poolAttempt(
  project: SchedulerProject,
  label: string,
): Promise<{ execution: string; attempt: string }> {
  const admitted = await rig.store.admit(project.cluster);
  if (admitted.admitted !== "Admitted")
    throw new Error(`worker pool suite: ${label} admitted no execution`);
  await rig.harness.query(
    `UPDATE execution SET placement='Pool' WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [project.partition.tenant, project.partition.project, admitted.execution],
  );
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  if (opened.opened !== "Opened")
    throw new Error(`worker pool suite: ${label} opened no attempt`);
  return { execution: admitted.execution, attempt: opened.attempt.attempt };
}

/** One registered pool of this project, declaring what the case wants it to claim. */
async function registered(
  partition: Partition,
  label: string,
  capabilities: readonly string[],
): Promise<WorkerPoolIdentity> {
  const principal = asPrincipal(`https://issuer.invalid#pool-${label}`);
  assert.equal(
    await registry.register({
      partition,
      pool: label,
      capabilities,
      clientId: `chuggy-pool-${randomUUID()}`,
      principal,
    }),
    true,
  );
  const identified = await registry.identify(principal);
  assert.notEqual(identified, undefined);
  return identified as WorkerPoolIdentity;
}

/** The handles one claim draws, which are opaque to the pool that is given them. */
function handles(label: string): { assignment: string; bearer: string } {
  return {
    assignment: `assignment-${label}-${randomUUID()}`,
    bearer: `bearer-${label}-${randomUUID()}`,
  };
}

test("a pool claims only work marked for a pool, and only what it declared", async () => {
  const beyond = await poolProject("pool-beyond", 1, "Codex");
  const beyondPool = await registered(beyond.partition, "beyond", [
    "Agent:Claude",
  ]);
  await poolAttempt(beyond, "beyond");
  const unclaimable = handles("beyond");
  assert.equal(
    await assignments.claim(
      beyondPool,
      leaseSecs,
      unclaimable.assignment,
      unclaimable.bearer,
    ),
    undefined,
    "a pool claims nothing whose capability it did not declare",
  );

  const project = await poolProject("pool-claims", 3, "Claude");
  const pool = await registered(project.partition, "claims", [
    "Agent:Claude",
    "Agent:Codex",
  ]);
  const wanted = await poolAttempt(project, "covered");
  const drawn = handles("covered");
  const claimed = await assignments.claim(
    pool,
    leaseSecs,
    drawn.assignment,
    drawn.bearer,
  );
  assert.deepEqual(claimed, { capabilities: ["Agent:Claude"] });
  const held = (await rig.harness.query(
    `SELECT attempt, pool FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND assignment=$3`,
    [project.partition.tenant, project.partition.project, drawn.assignment],
  )) as readonly { attempt: string; pool: string }[];
  assert.deepEqual(held, [{ attempt: wanted.attempt, pool: "claims" }]);
  const second = handles("second");
  assert.equal(
    await assignments.claim(pool, leaseSecs, second.assignment, second.bearer),
    undefined,
  );
});

test("an execution the scheduler still places is offered to no pool", async () => {
  const project = await poolProject("pool-in-cluster");
  const pool = await registered(project.partition, "in-cluster", ["linux"]);
  const admitted = await rig.store.admit(project.cluster);
  assert.equal(admitted.admitted, "Admitted");
  if (admitted.admitted !== "Admitted") return;
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  assert.equal(opened.opened, "Opened");
  const drawn = handles("in-cluster");
  assert.equal(
    await assignments.claim(pool, leaseSecs, drawn.assignment, drawn.bearer),
    undefined,
  );
});

test("a claim binds the attempt to the bearer its harness answers under", async () => {
  const project = await poolProject("pool-bearer");
  const pool = await registered(project.partition, "bearer", []);
  const attempt = await poolAttempt(project, "bearer");
  const drawn = handles("bearer");
  assert.notEqual(
    await assignments.claim(pool, leaseSecs, drawn.assignment, drawn.bearer),
    undefined,
  );
  const digest = createHash("sha256")
    .update(drawn.bearer, "utf8")
    .digest("hex");
  const stored = (await rig.harness.query(
    `SELECT capability_secret_digest FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt.attempt],
  )) as readonly { capability_secret_digest: string }[];
  assert.deepEqual(stored, [{ capability_secret_digest: digest }]);
  const authority = postgresWorkerPlaneAuthority(harnessPlanePool);
  const authenticated = await authority.authenticate(
    drawn.bearer as Parameters<typeof authority.authenticate>[0],
  );
  assert.notEqual(authenticated, undefined);
  assert.equal(authenticated?.attempt, attempt.attempt);
});

test("an assignment is renewed, refused and released by the pool holding it", async () => {
  const project = await poolProject("pool-settles", 3);
  const mine = await registered(project.partition, "mine", []);
  const theirs = await registered(project.partition, "theirs", []);
  await poolAttempt(project, "renewed");
  const renewed = handles("renewed");
  assert.notEqual(
    await assignments.claim(
      mine,
      leaseSecs,
      renewed.assignment,
      renewed.bearer,
    ),
    undefined,
  );
  assert.equal(await assignments.held(mine, renewed.assignment), true);
  assert.equal(
    await assignments.renew(mine, renewed.assignment, leaseSecs),
    true,
  );
  assert.equal(
    await assignments.renew(theirs, renewed.assignment, leaseSecs),
    false,
    "no pool renews another pool's lease",
  );
  assert.equal(await assignments.held(theirs, renewed.assignment), false);
  assert.equal(
    await assignments.refuse(mine, renewed.assignment, "no node takes this"),
    true,
  );
  assert.equal(
    await assignments.renew(mine, renewed.assignment, leaseSecs),
    false,
    "a refused assignment is not renewed again",
  );

  const released = await poolAttempt(project, "released");
  const handle = handles("released");
  assert.notEqual(
    await assignments.claim(mine, leaseSecs, handle.assignment, handle.bearer),
    undefined,
  );
  assert.equal(await assignments.release(mine, handle.assignment, 30), true);
  const after = (await rig.harness.query(
    `SELECT a.pool, a.assignment, e.placement_backoff_from IS NOT NULL AS backing_off
       FROM execution_attempt a
       JOIN execution e ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
      WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3`,
    [project.partition.tenant, project.partition.project, released.attempt],
  )) as readonly {
    pool: string | null;
    assignment: string | null;
    backing_off: boolean;
  }[];
  assert.deepEqual(after, [
    { pool: null, assignment: null, backing_off: true },
  ]);
  assert.equal(await assignments.release(mine, handle.assignment, 30), false);
});

test("the plane serving harnesses cannot read the relation a pool is registered in", async () => {
  await assert.rejects(
    harnessPlanePool.query("SELECT pool FROM worker_pool"),
    /permission denied/u,
  );
});

test("the plane serving pools cannot write an attempt's outcome", async () => {
  await assert.rejects(
    planePool.query("UPDATE execution_attempt SET state='Reported'"),
    /permission denied/u,
  );
});

test("deregistration names the client the row holds, goes with that client alone, and leaves the work it held", async () => {
  const project = await poolProject("pool-deregister");
  const principal = asPrincipal("https://issuer.invalid#pool-gone");
  const clientId = `chuggy-pool-${randomUUID()}`;
  assert.equal(
    await registry.register({
      partition: project.partition,
      pool: "gone",
      capabilities: [],
      clientId,
      principal,
    }),
    true,
  );
  const identity = (await registry.identify(principal)) as WorkerPoolIdentity;
  const attempt = await poolAttempt(project, "orphaned");
  const drawn = handles("orphaned");
  assert.notEqual(
    await assignments.claim(
      identity,
      leaseSecs,
      drawn.assignment,
      drawn.bearer,
    ),
    undefined,
  );
  assert.equal(await registry.clientOf(project.partition, "gone"), clientId);
  assert.equal(
    await registry.deregister(project.partition, "gone", "chuggy-pool-other"),
    false,
    "the row goes only with the client that was read out of it",
  );
  assert.notEqual(await registry.identify(principal), undefined);
  assert.equal(
    await registry.deregister(project.partition, "gone", clientId),
    true,
  );
  assert.equal(await registry.identify(principal), undefined);
  assert.equal(await registry.clientOf(project.partition, "gone"), undefined);
  assert.equal(
    await registry.deregister(project.partition, "gone", clientId),
    false,
  );
  const left = (await rig.harness.query(
    `SELECT pool FROM execution_attempt WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt.attempt],
  )) as readonly { pool: string | null }[];
  assert.deepEqual(left, [{ pool: "gone" }]);
});
