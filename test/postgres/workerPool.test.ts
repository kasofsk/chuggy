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
import { setTimeout as delay } from "node:timers/promises";

import { workerPoolRetryAfterSecsMax } from "../../src/contract/workerPool.ts";
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
import { asCanonicalConfiguration } from "../../src/interpreter/authoring.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type {
  WorkerPoolClaimTerms,
  WorkerPoolIdentity,
} from "../../src/interpreter/workerPool.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessRolePool,
} from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerOwner,
  schedulerProject,
  schedulerInvocation,
  schedulerRigOpen,
  type SchedulerProject,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const planePool = postgresHarnessRolePool(poolPlaneRole);
const apiPool = postgresHarnessRolePool(apiRole);
const harnessPlanePool = postgresHarnessRolePool(workerPlaneRole);

after(async () => {
  await Promise.all([planePool.end(), apiPool.end(), harnessPlanePool.end()]);
  await rig.close();
});

const registry = postgresWorkerPoolRegistry(apiPool);
const assignments = postgresWorkerPoolAssignments(planePool);

/** How long a claim's lease runs for, past the duration of any case here. */
const leaseSecs = 300;

/** A claim's terms, holding more than any pool here holds. */
const terms: WorkerPoolClaimTerms = { leaseSecs, heldMax: 4 };

/** The platform every configuration here requires, as a pool declares it. */
const platform = "Platform:Linux:Amd64";

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
  if (agent === undefined) return poolCanonical(authored);
  return poolCanonical({
    ...authored,
    worker: {
      setup: [],
      files: [],
      mode: {
        type: "SingleAgent",
        agent,
        arguments: [],
        ...(agent === "Codex" ? { model: "gpt-5-codex" } : {}),
      },
    },
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

/** The same document with its keys ascending at every depth, which is the form a release pins. */
function poolCanonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(poolCanonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${poolCanonical(record[key])}`)
    .join(",")}}`;
}

/**
 * A project whose spawn request is registered, which is what leaves work to
 * admit. It is released under the configuration the case wants its work to
 * require a capability from, because the requirement is resolved by the
 * release and is a pin afterwards, which the durable authority enforces.
 */
async function poolProject(
  label: string,
  tasks = 1,
  agent?: "Claude" | "Codex",
): Promise<SchedulerProject> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks },
    asCanonicalConfiguration(poolConfiguration(agent)),
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
 * One execution of this project opened as an attempt, invoked and marked for a
 * pool, which is the row a claim takes. The scheduler routes its launch by the
 * same column, so nothing here is work it would also place.
 */
async function poolAttempt(
  project: SchedulerProject,
  label: string,
  invoked = true,
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
  if (
    invoked &&
    !(await rig.store.attemptInvoked(opened.attempt, schedulerInvocation))
  )
    throw new Error(`worker pool suite: ${label} recorded no invocation`);
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
      class: "Dedicated",
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
    platform,
    "Agent:Claude",
  ]);
  await poolAttempt(beyond, "beyond");
  const unclaimable = handles("beyond");
  assert.equal(
    await assignments.claim(
      beyondPool,
      terms,
      unclaimable.assignment,
      unclaimable.bearer,
    ),
    undefined,
    "a pool claims nothing whose capability it did not declare",
  );

  const project = await poolProject("pool-claims", 3, "Claude");
  const pool = await registered(project.partition, "claims", [
    platform,
    "Agent:Claude",
    "Agent:Codex",
  ]);
  const wanted = await poolAttempt(project, "covered");
  const drawn = handles("covered");
  const claimed = await assignments.claim(
    pool,
    terms,
    drawn.assignment,
    drawn.bearer,
  );
  assert.deepEqual(claimed, {
    requirement: {
      mode: "ContainerCapability",
      operatingSystem: "Linux",
      architecture: "Amd64",
      capabilities: ["Agent:Claude"],
    },
  });
  const held = (await rig.harness.query(
    `SELECT attempt, pool FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND assignment=$3`,
    [project.partition.tenant, project.partition.project, drawn.assignment],
  )) as readonly { attempt: string; pool: string }[];
  assert.deepEqual(held, [{ attempt: wanted.attempt, pool: "claims" }]);
  const second = handles("second");
  assert.equal(
    await assignments.claim(pool, terms, second.assignment, second.bearer),
    undefined,
  );
});

test("a container claim returns the image its execution's requirement pinned", async () => {
  const project = await poolProject("pool-image");
  const pool = await registered(project.partition, "image", [platform]);
  await poolAttempt(project, "image");
  const drawn = handles("image");
  assert.deepEqual(
    await assignments.claim(pool, terms, drawn.assignment, drawn.bearer),
    {
      requirement: {
        mode: "Container",
        operatingSystem: "Linux",
        architecture: "Amd64",
        image: "worker:v1",
      },
    },
  );
});

test("an execution the scheduler still places is offered to no pool", async () => {
  const project = await poolProject("pool-in-cluster");
  const pool = await registered(project.partition, "in-cluster", [platform]);
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
  if (opened.opened !== "Opened") return;
  assert.equal(
    await rig.store.attemptInvoked(opened.attempt, schedulerInvocation),
    true,
  );
  const drawn = handles("in-cluster");
  assert.equal(
    await assignments.claim(pool, terms, drawn.assignment, drawn.bearer),
    undefined,
  );
});

test("an attempt with no invocation recorded is offered to no pool", async () => {
  const project = await poolProject("pool-uninvoked");
  const pool = await registered(project.partition, "uninvoked", [platform]);
  await poolAttempt(project, "uninvoked", false);
  const drawn = handles("uninvoked");
  assert.equal(
    await assignments.claim(pool, terms, drawn.assignment, drawn.bearer),
    undefined,
  );
});

test("a claim binds the attempt to the bearer its harness answers under", async () => {
  const project = await poolProject("pool-bearer");
  const pool = await registered(project.partition, "bearer", [platform]);
  const attempt = await poolAttempt(project, "bearer");
  const drawn = handles("bearer");
  assert.notEqual(
    await assignments.claim(pool, terms, drawn.assignment, drawn.bearer),
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
  const mine = await registered(project.partition, "mine", [platform]);
  const theirs = await registered(project.partition, "theirs", [platform]);
  await poolAttempt(project, "renewed");
  const renewed = handles("renewed");
  assert.notEqual(
    await assignments.claim(mine, terms, renewed.assignment, renewed.bearer),
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
});

test("a released attempt backs off for as long as the pool said before it is offered again", async () => {
  const project = await poolProject("pool-releases");
  const mine = await registered(project.partition, "releasing", [platform]);
  const released = await poolAttempt(project, "released");
  const handle = handles("released");
  assert.notEqual(
    await assignments.claim(mine, terms, handle.assignment, handle.bearer),
    undefined,
  );
  assert.equal(await assignments.release(mine, handle.assignment, 30), true);
  const after = (await rig.harness.query(
    `SELECT a.pool, a.assignment, e.placement_backoff_from > now() AS backing_off
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
  const again = handles("again");
  assert.equal(
    await assignments.claim(mine, terms, again.assignment, again.bearer),
    undefined,
    "a released attempt is offered to no pool before its backoff elapses",
  );
  await rig.harness.query(
    `UPDATE execution SET placement_backoff_from=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [project.partition.tenant, project.partition.project, released.execution],
  );
  assert.notEqual(
    await assignments.claim(mine, terms, again.assignment, again.bearer),
    undefined,
    "a backoff that has elapsed offers the attempt again",
  );
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

/**
 * A claim hands out the image its execution's requirement pinned, which the
 * plane reads to do it; this is every other column the plane may touch, so an
 * attempt's invocation, the digest a bearer is checked against and a pool's
 * client are none of them.
 */
test("the plane serving pools reads and writes these columns and no others", async () => {
  assert.deepEqual(
    await rig.harness.query(
      `SELECT table_name, privilege_type,
              string_agg(column_name::text, ',' ORDER BY column_name) AS columns
         FROM information_schema.role_column_grants
        WHERE grantee=$1 AND table_schema='public'
        GROUP BY table_name, privilege_type ORDER BY table_name, privilege_type`,
      [poolPlaneRole],
    ),
    [
      [
        "execution",
        "SELECT",
        "execution,placement,placement_backoff_from,project,requirement_value,status,tenant",
      ],
      ["execution", "UPDATE", "placement_backoff_from"],
      [
        "execution_attempt",
        "SELECT",
        "assignment,attempt,execution,generation,invoked,lease_expires_at,lease_owner,opened_at,pool,pool_refusal,project,recovery_epoch,state,tenant",
      ],
      [
        "execution_attempt",
        "UPDATE",
        "assignment,capability_secret_digest,lease_expires_at,lease_owner,pool,pool_refusal",
      ],
      ["project", "SELECT", "lifecycle,project,tenant"],
      ["recovery_epoch", "SELECT", "epoch,established_at,ordinal"],
      ["schema_migration", "SELECT", "applied_at,name,version"],
      [
        "worker_pool",
        "SELECT",
        "capabilities,class,pool,principal,project,tenant",
      ],
    ].map(([table_name, privilege_type, columns]) => ({
      table_name,
      privilege_type,
      columns,
    })),
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
      capabilities: [platform],
      class: "Dedicated",
      clientId,
      principal,
    }),
    true,
  );
  const identity = (await registry.identify(principal)) as WorkerPoolIdentity;
  const attempt = await poolAttempt(project, "orphaned");
  const drawn = handles("orphaned");
  assert.notEqual(
    await assignments.claim(identity, terms, drawn.assignment, drawn.bearer),
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

test("a release past the bound on a pool's retry-after is refused before it is written", async () => {
  const project = await poolProject("pool-retry-bound");
  const mine = await registered(project.partition, "bounded", [platform]);
  await assert.rejects(
    assignments.release(mine, "never-claimed", workerPoolRetryAfterSecsMax + 1),
    RangeError,
  );
});

test("a released attempt outlives the reaper for the backoff it was given", async () => {
  const project = await poolProject("pool-parked");
  const mine = await registered(project.partition, "parking", [platform]);
  const parked = await poolAttempt(project, "parked");
  const handle = handles("parked");
  assert.notEqual(
    await assignments.claim(
      mine,
      { ...terms, leaseSecs: 1 },
      handle.assignment,
      handle.bearer,
    ),
    undefined,
  );
  assert.equal(await assignments.release(mine, handle.assignment, 3), true);
  await delay(1_500);
  assert.equal(
    await rig.store.reapLapsedAttempts(project.epoch, 10),
    0,
    "the parked row is not the reaper's",
  );
  const after = (await rig.harness.query(
    `SELECT a.state, a.lease_owner, e.retries_spent::int AS retries_spent
       FROM execution_attempt a
       JOIN execution e ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
      WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3`,
    [project.partition.tenant, project.partition.project, parked.attempt],
  )) as readonly {
    state: string;
    lease_owner: string | null;
    retries_spent: number;
  }[];
  assert.deepEqual(after, [
    { state: "Placing", lease_owner: parked.attempt, retries_spent: 0 },
  ]);
  await rig.harness.query(
    `UPDATE execution SET placement_backoff_from=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [project.partition.tenant, project.partition.project, parked.execution],
  );
  const again = handles("parked-again");
  assert.notEqual(
    await assignments.claim(mine, terms, again.assignment, again.bearer),
    undefined,
  );
});
