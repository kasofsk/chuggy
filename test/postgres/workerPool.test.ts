/**
 * The registry and the assignment life, driven against a real PostgreSQL under
 * the roles the deployment runs: the plane that serves pools, the plane that
 * serves harnesses, and the API that registers one.
 *
 * EVERY CASE STARTS FROM AN OPENED, UNPLACED ATTEMPT. That is the row a pool
 * claims, and it is what the scheduler leaves behind when it opens an attempt
 * for an execution registered on the pool route. Each case writes `placement`
 * itself through the owner's harness, so it routes each execution rather than
 * each project.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";

import {
  apiRole,
  poolPlaneRole,
  statusMoveFunction,
  workerPlaneRole,
  workerPoolFenceFunction,
  workerPoolReleaseFunction,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
} from "../../src/adapters/postgres/workerPool.ts";
import {
  postgresWorkerAttemptHeartbeats,
  postgresWorkerPlaneAuthority,
  postgresWorkerReportStore,
  postgresWorkerTasks,
} from "../../src/adapters/postgres/workerPlane.ts";
import { asCanonicalConfiguration } from "../../src/interpreter/authoring.ts";
import {
  asAttemptCapabilitySecret,
  type AttemptCapabilitySecret,
  type PhysicalAttempt,
} from "../../src/interpreter/executionScheduler.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type {
  WorkerPoolClaimTerms,
  WorkerPoolIdentity,
} from "../../src/interpreter/workerPool.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessNewEpoch,
  postgresHarnessPartition,
  postgresHarnessRolePool,
} from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerOwner,
  schedulerProject,
  schedulerInvocation,
  schedulerReport,
  schedulerRigOpen,
  schedulerInCluster,
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
  partition?: Partition,
): Promise<SchedulerProject> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks },
    asCanonicalConfiguration(poolConfiguration(agent)),
    partition,
  );
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      project.request,
      schedulerOwner(label),
    ),
    200,
    schedulerInCluster,
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
): Promise<{ execution: string; attempt: string; opened: PhysicalAttempt }> {
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
  return {
    execution: admitted.execution,
    attempt: opened.attempt.attempt,
    opened: opened.attempt,
  };
}

/** One registered pool of this project, declaring what the case wants it to claim, under the principal its name gives unless the case names another. */
async function registered(
  partition: Partition,
  label: string,
  capabilities: readonly string[],
  principal: Principal = asPrincipal(`https://issuer.invalid#pool-${label}`),
): Promise<WorkerPoolIdentity> {
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

test("a released attempt ends withdrawn under the pool that claimed it, spending and pacing nothing, and no pool claims it again", async () => {
  const project = await poolProject("pool-releases");
  const mine = await registered(project.partition, "releasing", [platform]);
  const released = await poolAttempt(project, "released");
  const handle = handles("released");
  assert.notEqual(
    await assignments.claim(mine, terms, handle.assignment, handle.bearer),
    undefined,
  );
  assert.equal(await assignments.release(mine, handle.assignment), true);
  const after = await rig.harness.query(
    `SELECT a.state, a.evidence, a.pool, a.assignment, a.capability_secret_digest,
            a.lease_expires_at, e.retries_spent::int AS retries_spent,
            e.placement_backoff_from
       FROM execution_attempt a
       JOIN execution e ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
      WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3`,
    [project.partition.tenant, project.partition.project, released.attempt],
  );
  assert.deepEqual(after, [
    {
      state: "Withdrawn",
      evidence: "PlacementUnavailable",
      pool: "releasing",
      assignment: handle.assignment,
      capability_secret_digest: null,
      lease_expires_at: null,
      retries_spent: 0,
      placement_backoff_from: null,
    },
  ]);
  assert.equal(await assignments.release(mine, handle.assignment), false);
  const again = handles("again");
  assert.equal(
    await assignments.claim(mine, terms, again.assignment, again.bearer),
    undefined,
    "a released attempt is offered to no pool",
  );
});

/** One more attempt of this project opened and claimed by `pool`, and the assignment the claim drew. */
async function poolHeldBy(
  project: SchedulerProject,
  pool: WorkerPoolIdentity,
  label: string,
): Promise<string> {
  await poolAttempt(project, label);
  const drawn = handles(label);
  assert.notEqual(
    await assignments.claim(pool, terms, drawn.assignment, drawn.bearer),
    undefined,
  );
  return drawn.assignment;
}

test("a pool holds the images of the attempts it may still renew, and none of another pool's, another project's, or one it refused or released", async () => {
  const project = await poolProject("pool-held-images", 4);
  const mine = await registered(project.partition, "held-mine", [platform]);
  const theirs = await registered(project.partition, "held-theirs", [platform]);
  const elsewhere = await poolProject("pool-held-elsewhere");
  const yonder = await registered(
    elsewhere.partition,
    "held-mine",
    [platform],
    poolPrincipalFresh("held-mine"),
  );
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), []);
  await poolHeldBy(project, theirs, "held-theirs");
  await poolHeldBy(elsewhere, yonder, "held-yonder");
  assert.deepEqual(await assignments.heldImages(theirs, terms.heldMax), [
    "worker:v1",
  ]);
  assert.deepEqual(await assignments.heldImages(yonder, terms.heldMax), [
    "worker:v1",
  ]);
  assert.deepEqual(
    await assignments.heldImages(mine, terms.heldMax),
    [],
    "another pool's attempt, or the same name's in another project, is not this pool's",
  );
  const refused = await poolHeldBy(project, mine, "held-refused");
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), [
    "worker:v1",
  ]);
  assert.equal(await assignments.refuse(mine, refused, "no node"), true);
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), []);
  const released = await poolHeldBy(project, mine, "held-released");
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), [
    "worker:v1",
  ]);
  assert.equal(await assignments.release(mine, released), true);
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), []);
  await assert.rejects(
    assignments.heldImages(mine, 0),
    /invalid worker pool held bound/u,
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
 * A release ends an attempt, which the plane does through the one function it
 * is granted for it; nothing it runs moves an execution's status.
 */
test("the plane serving pools ends an attempt only by releasing it, and moves no execution", async () => {
  const [granted] = (
    await planePool.query(
      `SELECT has_function_privilege('${workerPoolReleaseFunction}(text,text,text,text,text)', 'EXECUTE') AS releases,
              has_function_privilege('${statusMoveFunction}(text,text)', 'EXECUTE') AS moves_status`,
    )
  ).rows as { releases: boolean; moves_status: boolean }[];
  assert.deepEqual(granted, { releases: true, moves_status: false });
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
        "execution,placement,project,requirement_value,status,tenant",
      ],
      ["execution", "UPDATE", "placement_backoff_from"],
      [
        "execution_attempt",
        "SELECT",
        "assignment,attempt,execution,generation,invoked,lease_expires_at,lease_owner,opened_at,pool,pool_principal,pool_refusal,project,recovery_epoch,state,tenant",
      ],
      [
        "execution_attempt",
        "UPDATE",
        "assignment,capability_secret_digest,lease_expires_at,lease_owner,pool,pool_principal,pool_refusal",
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

/** What a claim left on one attempt, which a call holding nothing leaves as it was. */
async function poolClaimRow(
  project: SchedulerProject,
  attempt: string,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await rig.harness.query(
    `SELECT pool, pool_principal, assignment, pool_refusal, capability_secret_digest,
            state, lease_owner, lease_expires_at::text AS lease_expires_at
       FROM execution_attempt WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt],
  );
  return row;
}

/** A pool of this project registered, one attempt claimed by it, and the handles the claim drew. */
async function poolClaimedIn(
  project: SchedulerProject,
  pool: string,
  principal?: Principal,
): Promise<{
  project: SchedulerProject;
  identity: WorkerPoolIdentity;
  claimed: Awaited<ReturnType<typeof poolAttempt>>;
  drawn: { assignment: string; bearer: string };
}> {
  const identity = await registered(
    project.partition,
    pool,
    [platform],
    principal,
  );
  const claimed = await poolAttempt(project, pool);
  const drawn = handles(pool);
  assert.notEqual(
    await assignments.claim(identity, terms, drawn.assignment, drawn.bearer),
    undefined,
  );
  return { project, identity, claimed, drawn };
}

/** One project's pool registered and one attempt claimed by it. */
async function poolClaimed(label: string): ReturnType<typeof poolClaimedIn> {
  return poolClaimedIn(await poolProject(`pool-${label}`), label);
}

/** A principal no registration here has used, which is what registering a name again is given. */
function poolPrincipalFresh(pool: string): Principal {
  return asPrincipal(`https://issuer.invalid#pool-${pool}-${randomUUID()}`);
}

/** A registration made again of this project's pool, under a principal of its own. */
async function poolRegisteredAgain(
  project: SchedulerProject,
  pool: string,
): Promise<WorkerPoolIdentity> {
  return registered(
    project.partition,
    pool,
    [platform],
    poolPrincipalFresh(pool),
  );
}

/**
 * Registering a pool's name again is `takeOver`: the principal moves, so the
 * attempt the older registration claimed is one neither registration holds.
 */
test("a pool registered again holds nothing an older registration of its name claimed", async () => {
  const { project, identity, claimed, drawn } = await poolClaimed("takeover");
  const before = await poolClaimRow(project, claimed.attempt);
  const newer = await poolRegisteredAgain(project, "takeover");
  for (const [registration, caller] of [
    ["newer", newer],
    ["older", identity],
  ] as const) {
    assert.equal(
      await assignments.renew(caller, drawn.assignment, leaseSecs),
      false,
      `the ${registration} registration renews nothing`,
    );
    assert.equal(
      await assignments.held(caller, drawn.assignment),
      false,
      `the ${registration} registration holds nothing`,
    );
    assert.equal(
      await assignments.refuse(caller, drawn.assignment, "no node takes this"),
      false,
      `the ${registration} registration refuses nothing`,
    );
    assert.equal(
      await assignments.release(caller, drawn.assignment),
      false,
      `the ${registration} registration releases nothing`,
    );
  }
  assert.deepEqual(await poolClaimRow(project, claimed.attempt), {
    ...before,
    capability_secret_digest: null,
  });
});

/**
 * What the worker plane answers a harness offering this bearer for `opened`,
 * wherever a harness asks: the authority each attempt route but the task
 * consults, the task route's read and the report route's write.
 */
async function poolBearerAnswered(
  bearer: AttemptCapabilitySecret,
  opened: PhysicalAttempt,
): Promise<Record<string, unknown>> {
  return {
    authenticated:
      await postgresWorkerPlaneAuthority(harnessPlanePool).authenticate(bearer),
    task: await postgresWorkerTasks(harnessPlanePool).work(bearer),
    report: (
      await postgresWorkerReportStore(harnessPlanePool, bearer).terminalize(
        schedulerReport(opened, "Pass"),
      )
    ).terminalized,
  };
}

/**
 * The fenced attempt keeps its lease and loses its bearer, so the harness the
 * older registration launched is refused everywhere it asks and the lapse ends
 * the attempt as lost.
 */
test("the harness an older registration launched is refused, and its attempt ends lost", async () => {
  const { project, claimed, drawn } = await poolClaimed("fenced");
  const bearer = asAttemptCapabilitySecret(drawn.bearer);
  const authority = postgresWorkerPlaneAuthority(harnessPlanePool);
  assert.notEqual(await authority.authenticate(bearer), undefined);
  await poolRegisteredAgain(project, "fenced");
  assert.deepEqual(await poolBearerAnswered(bearer, claimed.opened), {
    authenticated: undefined,
    task: undefined,
    report: "Fenced",
  });
  await rig.harness.query(
    `UPDATE execution_attempt SET lease_expires_at=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, claimed.attempt],
  );
  await rig.store.reapLapsedAttempts(project.epoch, 10);
  const ended = (await rig.harness.query(
    `SELECT a.state, e.retries_spent::int AS retries_spent
       FROM execution_attempt a
       JOIN execution e ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
      WHERE a.tenant=$1 AND a.project=$2 AND a.attempt=$3`,
    [project.partition.tenant, project.partition.project, claimed.attempt],
  )) as readonly { state: string; retries_spent: number }[];
  assert.deepEqual(ended, [{ state: "Lost", retries_spent: 1 }]);
});

/**
 * A pool that answers Unavailable launched nothing, and releasing the
 * assignment, as the pool plane's own role does, takes its bearer back: a
 * harness launched under it anyway is answered as a bearer never issued is.
 */
test("a released attempt's bearer is answered as one never issued", async () => {
  const { identity, claimed, drawn } = await poolClaimed("released-bearer");
  const bearer = asAttemptCapabilitySecret(drawn.bearer);
  assert.notEqual(
    await postgresWorkerPlaneAuthority(harnessPlanePool).authenticate(bearer),
    undefined,
  );
  assert.equal(await assignments.release(identity, drawn.assignment), true);
  assert.deepEqual(
    await poolBearerAnswered(bearer, claimed.opened),
    await poolBearerAnswered(
      asAttemptCapabilitySecret(handles("never-issued").bearer),
      claimed.opened,
    ),
  );
});

/**
 * A pool's polls lease the attempt it claimed, so the heartbeat of the harness
 * it launched answers whether that lease holds the attempt live and writes
 * nothing, however short a lease the harness asks for.
 */
test("a harness a pool launched is answered live by its heartbeat, which renews nothing", async () => {
  const heartbeats = postgresWorkerAttemptHeartbeats(harnessPlanePool);
  const beat = (bearer: string, generation: number) =>
    heartbeats.heartbeat(asAttemptCapabilitySecret(bearer), generation, 1);
  const live = await poolClaimed("heartbeat-live");
  const before = await poolClaimRow(live.project, live.claimed.attempt);
  assert.equal(
    await beat(live.drawn.bearer, live.claimed.opened.generation),
    true,
  );
  assert.deepEqual(
    await poolClaimRow(live.project, live.claimed.attempt),
    before,
  );
  assert.equal(
    await beat(live.drawn.bearer, live.claimed.opened.generation + 1),
    false,
    "another generation is not this attempt",
  );
  await rig.harness.query(
    `UPDATE execution_attempt SET lease_expires_at=now()-interval '1 second'
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [
      live.project.partition.tenant,
      live.project.partition.project,
      live.claimed.attempt,
    ],
  );
  assert.equal(
    await beat(live.drawn.bearer, live.claimed.opened.generation),
    false,
    "a lapsed lease holds nothing",
  );
  const refused = await poolClaimed("heartbeat-refused");
  assert.equal(
    await assignments.refuse(
      refused.identity,
      refused.drawn.assignment,
      "no node takes this",
    ),
    true,
  );
  assert.equal(
    await beat(refused.drawn.bearer, refused.claimed.opened.generation),
    false,
    "a refused assignment is not live",
  );
  const reported = await poolClaimed("heartbeat-reported");
  assert.equal(
    (
      await postgresWorkerReportStore(
        harnessPlanePool,
        asAttemptCapabilitySecret(reported.drawn.bearer),
      ).terminalize(schedulerReport(reported.claimed.opened, "Pass"))
    ).terminalized,
    "Terminalized",
  );
  assert.equal(
    await beat(reported.drawn.bearer, reported.claimed.opened.generation),
    false,
    "a reported attempt is not live",
  );
  const unclaimed = await poolAttempt(
    await poolProject("pool-heartbeat-unclaimed"),
    "heartbeat-unclaimed",
  );
  assert.equal(
    await beat(unclaimed.opened.capability.secret, unclaimed.opened.generation),
    false,
    "an attempt no pool claimed is not a pool's",
  );
  const recovered = await poolClaimed("heartbeat-recovered");
  await rig.harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  assert.equal(
    await beat(recovered.drawn.bearer, recovered.claimed.opened.generation),
    false,
    "a recovery fences what the last epoch's pool claimed",
  );
});

/**
 * The fence is keyed by the pool's whole name, so registering it again takes
 * nothing from another pool of its project, from its namesake in another
 * project, or from one in another tenant whose project has its project's name.
 */
test("a pool registered again fences no other pool's attempts", async () => {
  const project = await poolProject("pool-neighbours", 2);
  const { tenant, project: named } = project.partition;
  const fenced = await poolClaimedIn(project, "neighbours");
  const neighbours = {
    "another pool of its project": await poolClaimedIn(project, "beside"),
    "its namesake in another project": await poolClaimedIn(
      await poolProject("pool-neighbours-project", 1, undefined, {
        ...postgresHarnessPartition("neighbours-project"),
        tenant,
      }),
      "neighbours",
      poolPrincipalFresh("neighbours"),
    ),
    "its namesake in another tenant": await poolClaimedIn(
      await poolProject("pool-neighbours-tenant", 1, undefined, {
        ...postgresHarnessPartition("neighbours-tenant"),
        project: named,
      }),
      "neighbours",
      poolPrincipalFresh("neighbours"),
    ),
  };
  await poolRegisteredAgain(project, "neighbours");
  assert.equal(
    (await poolClaimRow(project, fenced.claimed.attempt))?.[
      "capability_secret_digest"
    ],
    null,
  );
  const authority = postgresWorkerPlaneAuthority(harnessPlanePool);
  for (const [name, neighbour] of Object.entries(neighbours)) {
    assert.equal(
      await assignments.renew(
        neighbour.identity,
        neighbour.drawn.assignment,
        leaseSecs,
      ),
      true,
      `${name} renews what it claimed`,
    );
    assert.equal(
      (
        await authority.authenticate(
          asAttemptCapabilitySecret(neighbour.drawn.bearer),
        )
      )?.attempt,
      neighbour.claimed.attempt,
      `${name} keeps its bearer`,
    );
  }
});

/**
 * An attempt an older registration saw to its report is no longer live, so
 * registering the name again leaves it as the report left it.
 */
test("a pool registers again after an attempt it claimed has reported", async () => {
  const { project, claimed, drawn } = await poolClaimed("reported");
  assert.equal(
    (
      await postgresWorkerReportStore(
        harnessPlanePool,
        asAttemptCapabilitySecret(drawn.bearer),
      ).terminalize(schedulerReport(claimed.opened, "Fail"))
    ).terminalized,
    "Terminalized",
  );
  const reported = await poolClaimRow(project, claimed.attempt);
  assert.equal(reported?.["state"], "Reported");
  await poolRegisteredAgain(project, "reported");
  assert.deepEqual(await poolClaimRow(project, claimed.attempt), reported);
});

/**
 * The fence commits with the registration or neither does, so a registration
 * that cannot fence leaves the older one current and its bearer standing.
 */
test("a registration that cannot fence what it takes over is not made", async () => {
  const { project, identity, claimed } = await poolClaimed("unfenced");
  const before = await poolClaimRow(project, claimed.attempt);
  const fence = `${workerPoolFenceFunction}(text,text,text)`;
  const principal = poolPrincipalFresh("unfenced");
  await rig.harness.query(
    `REVOKE EXECUTE ON FUNCTION ${fence} FROM ${apiRole}`,
  );
  try {
    await assert.rejects(
      registry.register({
        partition: project.partition,
        pool: "unfenced",
        capabilities: [platform],
        class: "Dedicated",
        clientId: `chuggy-pool-${randomUUID()}`,
        principal,
      }),
      /permission denied for function/u,
    );
  } finally {
    await rig.harness.query(`GRANT EXECUTE ON FUNCTION ${fence} TO ${apiRole}`);
  }
  assert.deepEqual(
    {
      newer: await registry.identify(principal),
      older: await registry.identify(identity.principal),
      attempt: await poolClaimRow(project, claimed.attempt),
    },
    { newer: undefined, older: identity, attempt: before },
  );
});

/**
 * A pool restarted under its own credentials asks as the principal it
 * registered under, and a registration made again under that principal moves
 * no generation, so either keeps what it claimed.
 */
test("a pool that comes back under the same principal keeps what it claimed", async () => {
  const { project, identity, claimed, drawn } = await poolClaimed("restart");
  const restarted = await registry.identify(identity.principal);
  assert.deepEqual(restarted, identity);
  assert.equal(
    await assignments.held(restarted, drawn.assignment),
    true,
    "a restart under the same credentials holds what it claimed",
  );
  const before = await poolClaimRow(project, claimed.attempt);
  const again = await registered(project.partition, "restart", [platform]);
  assert.deepEqual(again, identity);
  assert.deepEqual(await poolClaimRow(project, claimed.attempt), before);
  assert.equal(
    await assignments.renew(again, drawn.assignment, leaseSecs),
    true,
    "a registration under the same principal renews what it claimed",
  );
  const authenticated = await postgresWorkerPlaneAuthority(
    harnessPlanePool,
  ).authenticate(asAttemptCapabilitySecret(drawn.bearer));
  assert.equal(authenticated?.attempt, claimed.attempt);
});

/**
 * Registration runs as the API, which is granted the fence and no column of an
 * attempt, so it can take a bearer away and never write one.
 */
test("the API registering a pool may fence its attempts and write no attempt", async () => {
  const project = await poolProject("pool-api-fence");
  await registered(project.partition, "api-fence", [platform]);
  const [granted] = (
    await apiPool.query(
      `SELECT current_user AS role,
            has_function_privilege('${workerPoolFenceFunction}(text,text,text)', 'EXECUTE') AS fences,
            has_column_privilege('execution_attempt', 'capability_secret_digest', 'UPDATE') AS writes_digest,
            has_table_privilege('execution_attempt', 'UPDATE') AS writes_attempt`,
    )
  ).rows as {
    role: string;
    fences: boolean;
    writes_digest: boolean;
    writes_attempt: boolean;
  }[];
  assert.deepEqual(granted, {
    role: apiRole,
    fences: true,
    writes_digest: false,
    writes_attempt: false,
  });
  await assert.rejects(
    apiPool.query("UPDATE execution_attempt SET capability_secret_digest=NULL"),
    /permission denied/u,
  );
});
