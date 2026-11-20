/**
 * The assignment life, driven against a real PostgreSQL under the roles the
 * deployment runs: the plane that serves runners, the plane that serves
 * harnesses, and the API.
 *
 * EVERY CASE STARTS FROM AN OPENED, UNPLACED ATTEMPT. That is the row a
 * member's personal runner claims, and it is what the scheduler leaves behind
 * when it opens an attempt for an execution registered on the pool route. Each
 * case writes `placement` itself through the owner's harness, so it routes
 * each execution rather than each project.
 *
 * WHAT A CASE ASKS OF THE PLANE IT ASKS OF A PERSONAL RUNNER, its project's
 * executions owned by the runner's owner and on their allowlist.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";

import {
  apiRole,
  poolPlaneRole,
  statusMoveFunction,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRunners,
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
  PersonalRunnerIdentity,
  WorkerPoolClaimed,
  WorkerPoolClaimTerms,
} from "../../src/interpreter/workerPool.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessNewEpoch,
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
  schedulerRuntime,
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

const personalRegistry = postgresPersonalRunnerRegistry(apiPool);
const assignments = postgresWorkerPoolAssignments(planePool);

/** How long a claim's lease runs for, past the duration of any case here. */
const leaseSecs = 300;

/** A claim's terms, holding more than any pool here holds. */
const terms: WorkerPoolClaimTerms = {
  leaseSecs,
  heldMax: 4,
  memoryMibDefault: 4_096,
};

/** The platform every configuration here requires, as a pool declares it. */
const platform = "Platform:Linux:Amd64";

/**
 * The requirement a project's own configuration puts on every execution of it,
 * which is where the capabilities a pool is matched against come from. A
 * capability requirement is the one a single-agent worker states, and the
 * platform default has to be it rather than refine it, because a default of a
 * different mode is a widening the materializer refuses.
 */
function poolConfiguration(
  agent: "Claude" | "Codex" | undefined,
  resources?: unknown,
): string {
  const authored = {
    ...(JSON.parse(String(postgresHarnessConfiguration)) as Record<
      string,
      unknown
    >),
    ...(resources === undefined ? {} : { resources }),
  };
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
        mode: "Capability",
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
  configuration: string = poolConfiguration(undefined),
): Promise<SchedulerProject> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks },
    asCanonicalConfiguration(configuration),
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
    runtime: schedulerRuntime,
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

/** The handles one claim draws, which are opaque to the pool that is given them. */
function handles(label: string): { assignment: string; bearer: string } {
  return {
    assignment: `assignment-${label}-${randomUUID()}`,
    bearer: `bearer-${label}-${randomUUID()}`,
  };
}

/** A project `poolProject` releases, every execution of it owned by `owner`. */
async function ownedProject(
  label: string,
  tasks = 1,
  configuration: string = poolConfiguration(undefined),
  owner: Principal = asPrincipal(
    `https://issuer.invalid#owner-${randomUUID()}`,
  ),
): Promise<SchedulerProject & { readonly owner: Principal }> {
  const project = await poolProject(label, tasks, configuration);
  await rig.harness.query(
    `UPDATE execution SET owner=$3 WHERE tenant=$1 AND project=$2`,
    [project.partition.tenant, project.partition.project, owner],
  );
  return { ...project, owner };
}

/** One of a member's personal runners, and the projects it claims in. */
type Runner = PersonalRunnerIdentity & {
  readonly kind: "Personal";
  readonly serves: readonly Partition[];
};

/** One more runner of the owner of `project`, registered declaring `capabilities` and allowlisting that project. */
async function runnerOf(
  project: SchedulerProject & { readonly owner: Principal },
  label: string,
  capabilities: readonly string[],
): Promise<Runner> {
  const key = { tenant: project.partition.tenant, owner: project.owner };
  const principal = asPrincipal(
    `https://issuer.invalid#runner-${label}-${randomUUID()}`,
  );
  assert.equal(
    await personalRegistry.register({
      ...key,
      capabilities,
      clientId: `chuggy-personal-${randomUUID()}`,
      principal,
    }),
    "Registered",
  );
  assert.equal(
    await personalRegistry.allow(key, project.partition.project),
    "Allowed",
  );
  return { kind: "Personal", ...key, principal, serves: [project.partition] };
}

/** One claim by `runner` under the handles drawn, in the projects it serves. */
function runnerClaim(
  runner: Runner,
  drawn: { assignment: string; bearer: string },
): Promise<WorkerPoolClaimed | undefined> {
  return assignments.claimPersonal(
    runner,
    terms,
    drawn.assignment,
    drawn.bearer,
    runner.serves.map((partition) => partition.project),
  );
}

test("a runner claims only work marked for a pool, and only what it declared", async () => {
  const beyond = await ownedProject(
    "pool-beyond",
    1,
    poolConfiguration("Codex"),
  );
  const beyondRunner = await runnerOf(beyond, "beyond", [
    platform,
    "Agent:Claude",
  ]);
  await poolAttempt(beyond, "beyond");
  assert.equal(
    await runnerClaim(beyondRunner, handles("beyond")),
    undefined,
    "a runner claims nothing whose capability it did not declare",
  );

  const project = await ownedProject(
    "pool-claims",
    3,
    poolConfiguration("Claude"),
  );
  const runner = await runnerOf(project, "claims", [
    platform,
    "Agent:Claude",
    "Agent:Codex",
  ]);
  const wanted = await poolAttempt(project, "covered");
  const drawn = handles("covered");
  const claimed = await runnerClaim(runner, drawn);
  assert.deepEqual(claimed, {
    requirement: {
      mode: "Capability",
      operatingSystem: "Linux",
      architecture: "Amd64",
      capabilities: ["Agent:Claude"],
    },
    runtime: schedulerRuntime,
    project: project.partition.project,
  });
  const held = (await rig.harness.query(
    `SELECT attempt, pool FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND assignment=$3`,
    [project.partition.tenant, project.partition.project, drawn.assignment],
  )) as readonly { attempt: string; pool: string }[];
  assert.deepEqual(held, [{ attempt: wanted.attempt, pool: project.owner }]);
  assert.equal(await runnerClaim(runner, handles("second")), undefined);
});

test("a requirement stored as capabilities matches its pools under either name its mode has had", async () => {
  for (const mode of ["Capability", "ContainerCapability"]) {
    const requirement = JSON.stringify({
      mode,
      operatingSystem: "MacOS",
      architecture: "Arm64",
      capabilities: ["Tool:Xcode"],
    });
    const matched = (await rig.harness.query(
      `SELECT public.worker_pool_inventory_matches($1::jsonb, $2::text[]) AS covered,
              public.worker_pool_inventory_matches($1::jsonb, $3::text[]) AS short`,
      [
        requirement,
        ["Platform:MacOS:Arm64", "Tool:Xcode"],
        ["Platform:MacOS:Arm64"],
      ],
    )) as readonly { covered: boolean; short: boolean }[];
    assert.deepEqual(matched, [{ covered: true, short: false }], mode);
  }
});

/** Clears the runtime an attempt was opened under, as the owner, which is a row opened before attempts kept one. */
async function poolRuntimeCleared(
  project: SchedulerProject,
  attempt: string,
): Promise<void> {
  await rig.harness.query(
    `UPDATE execution_attempt SET runtime=NULL
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [project.partition.tenant, project.partition.project, attempt],
  );
}

test("a container claim returns the image its execution's requirement pinned and the runtime its attempt was opened under", async () => {
  const project = await ownedProject("pool-image", 2);
  const runner = await runnerOf(project, "image", [platform]);
  const requirement = {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: "worker:v1",
  };
  const named = { project: project.partition.project };
  await poolAttempt(project, "image");
  assert.deepEqual(await runnerClaim(runner, handles("image")), {
    requirement,
    runtime: schedulerRuntime,
    ...named,
  });
  const { attempt } = await poolAttempt(project, "image-unruntimed");
  await poolRuntimeCleared(project, attempt);
  assert.deepEqual(
    await runnerClaim(runner, handles("image-unruntimed")),
    { requirement, ...named },
    "an attempt that kept no runtime is claimed with none",
  );
});

test("an execution the scheduler still places is offered to no runner", async () => {
  const project = await ownedProject("pool-in-cluster");
  const runner = await runnerOf(project, "in-cluster", [platform]);
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
    runtime: schedulerRuntime,
  });
  assert.equal(opened.opened, "Opened");
  if (opened.opened !== "Opened") return;
  assert.equal(
    await rig.store.attemptInvoked(opened.attempt, schedulerInvocation),
    true,
  );
  assert.equal(await runnerClaim(runner, handles("in-cluster")), undefined);
});

test("an attempt with no invocation recorded is offered to no runner", async () => {
  const project = await ownedProject("pool-uninvoked");
  const runner = await runnerOf(project, "uninvoked", [platform]);
  await poolAttempt(project, "uninvoked", false);
  assert.equal(await runnerClaim(runner, handles("uninvoked")), undefined);
});

test("a claim binds the attempt to the bearer its harness answers under", async () => {
  const project = await ownedProject("pool-bearer");
  const runner = await runnerOf(project, "bearer", [platform]);
  const attempt = await poolAttempt(project, "bearer");
  const drawn = handles("bearer");
  assert.notEqual(await runnerClaim(runner, drawn), undefined);
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

test("an assignment is renewed, refused and released by the runner holding it", async () => {
  const project = await ownedProject("pool-settles", 3);
  const mine = await runnerOf(project, "mine", [platform]);
  const theirs = await runnerOf(project, "theirs", [platform]);
  await poolAttempt(project, "renewed");
  const renewed = handles("renewed");
  assert.notEqual(await runnerClaim(mine, renewed), undefined);
  assert.equal(await assignments.held(mine, renewed.assignment), true);
  assert.equal(
    await assignments.renew(mine, renewed.assignment, leaseSecs),
    true,
  );
  assert.equal(
    await assignments.renew(theirs, renewed.assignment, leaseSecs),
    false,
    "no runner renews another runner's lease",
  );
  assert.equal(await assignments.held(theirs, renewed.assignment), false);
  assert.equal(
    await assignments.refuse(mine, renewed.assignment, "no node takes this"),
    true,
  );
  assert.equal(
    await assignments.refuse(mine, renewed.assignment, "a later refusal"),
    false,
    "a refusal posted again is answered as an assignment no longer held",
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT pool_refusal FROM execution_attempt
        WHERE tenant=$1 AND project=$2 AND assignment=$3`,
      [project.partition.tenant, project.partition.project, renewed.assignment],
    ),
    [{ pool_refusal: "no node takes this" }],
    "the refusal taken first stands",
  );
  assert.equal(
    await assignments.renew(mine, renewed.assignment, leaseSecs),
    false,
    "a refused assignment is not renewed again",
  );
});

test("a released attempt ends withdrawn under the runner that claimed it, spending and pacing nothing, and no runner claims it again", async () => {
  const project = await ownedProject("pool-releases");
  const mine = await runnerOf(project, "releasing", [platform]);
  const released = await poolAttempt(project, "released");
  const handle = handles("released");
  assert.notEqual(await runnerClaim(mine, handle), undefined);
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
      pool: project.owner,
      assignment: handle.assignment,
      capability_secret_digest: null,
      lease_expires_at: null,
      retries_spent: 0,
      placement_backoff_from: null,
    },
  ]);
  assert.equal(await assignments.release(mine, handle.assignment), false);
  assert.equal(
    await runnerClaim(mine, handles("again")),
    undefined,
    "a released attempt is offered to no runner",
  );
});

/** One more attempt of this project opened and claimed by `runner`, and the assignment the claim drew. */
async function runnerHeldBy(
  project: SchedulerProject,
  runner: Runner,
  label: string,
): Promise<string> {
  await poolAttempt(project, label);
  const drawn = handles(label);
  assert.notEqual(await runnerClaim(runner, drawn), undefined);
  return drawn.assignment;
}

test("a runner holds the images of the attempts it may still renew, and none of another runner's, another project's, or one it refused or released", async () => {
  const project = await ownedProject("pool-held-images", 4);
  const mine = await runnerOf(project, "held-mine", [platform]);
  const theirs = await runnerOf(project, "held-theirs", [platform]);
  const elsewhere = await ownedProject("pool-held-elsewhere");
  const yonder = await runnerOf(elsewhere, "held-mine", [platform]);
  const pulls = ["worker:v1", schedulerRuntime];
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), []);
  await runnerHeldBy(project, theirs, "held-theirs");
  await runnerHeldBy(elsewhere, yonder, "held-yonder");
  assert.deepEqual(await assignments.heldImages(theirs, terms.heldMax), pulls);
  assert.deepEqual(await assignments.heldImages(yonder, terms.heldMax), pulls);
  assert.deepEqual(
    await assignments.heldImages(mine, terms.heldMax),
    [],
    "another runner's attempt, or another member's in another project, is not this runner's",
  );
  const refused = await runnerHeldBy(project, mine, "held-refused");
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), pulls);
  assert.equal(await assignments.refuse(mine, refused, "no node"), true);
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), []);
  const released = await runnerHeldBy(project, mine, "held-released");
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), pulls);
  assert.equal(await assignments.release(mine, released), true);
  assert.deepEqual(await assignments.heldImages(mine, terms.heldMax), []);
  await assert.rejects(
    assignments.heldImages(mine, 0),
    /invalid personal runner held bound/u,
  );
});

test("a runner holding one attempt may pull both its image and its runtime, a capability's attempt its runtime alone, and one that kept no runtime its image alone", async () => {
  const pinned = await ownedProject("pool-held-pulls");
  const one = await runnerOf(pinned, "held-pulls", [platform]);
  await runnerHeldBy(pinned, one, "held-pulls");
  assert.deepEqual(await assignments.heldImages(one, 1), [
    "worker:v1",
    schedulerRuntime,
  ]);
  const unruntimed = await ownedProject("pool-held-unruntimed");
  const plain = await runnerOf(unruntimed, "held-unruntimed", [platform]);
  const { attempt } = await poolAttempt(unruntimed, "held-unruntimed");
  await poolRuntimeCleared(unruntimed, attempt);
  assert.notEqual(
    await runnerClaim(plain, handles("held-unruntimed")),
    undefined,
  );
  assert.deepEqual(await assignments.heldImages(plain, terms.heldMax), [
    "worker:v1",
  ]);
  const capable = await ownedProject(
    "pool-held-capability",
    1,
    poolConfiguration("Claude"),
  );
  const agent = await runnerOf(capable, "held-capability", [
    platform,
    "Agent:Claude",
  ]);
  await runnerHeldBy(capable, agent, "held-capability");
  assert.deepEqual(await assignments.heldImages(agent, terms.heldMax), [
    schedulerRuntime,
  ]);
});

test("the plane serving harnesses cannot read worker_pool", async () => {
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

test("the plane serving pools moves no execution", async () => {
  const [granted] = (
    await planePool.query(
      `SELECT has_function_privilege('${statusMoveFunction}(text,text,boolean)', 'EXECUTE') AS moves_status`,
    )
  ).rows as { moves_status: boolean }[];
  assert.deepEqual(granted, { moves_status: false });
});

/** Every column the plane serving pools is granted, by relation and privilege. */
const poolPlaneColumns = [
  ["agent_account_press", "SELECT", "agent,principal,spent_at"],
  ["agent_account_press", "UPDATE", "spent_at"],
  [
    "chat_host",
    "SELECT",
    "credentials_named,owner,principal,runner_package,runner_version,session_capabilities,tenant,ticket_wakes",
  ],
  [
    "chat_host",
    "UPDATE",
    "credentials_named,last_polled_at,runner_package,runner_version,session_capabilities,ticket_wakes",
  ],
  [
    "execution",
    "SELECT",
    "cpu_millis,execution,memory_mib,owner,owner_fallback,placement,project,registered_at,requirement_value,status,tenant,ticket",
  ],
  ["execution", "UPDATE", "placement_backoff_from"],
  [
    "execution_attempt",
    "SELECT",
    "agent,assignment,attempt,claimed_at,evidence,execution,generation,invoked,lease_expires_at,lease_owner,opened_at,personal,pool,pool_principal,pool_refusal,project,recovery_epoch,runner_benches_credential,runtime,state,tenant",
  ],
  [
    "execution_attempt",
    "UPDATE",
    "assignment,capability_secret_digest,claimed_at,lease_expires_at,lease_owner,personal,pool,pool_principal,pool_refusal,pool_refusal_fault,runner_benches_credential",
  ],
  [
    "execution_attempt_limit",
    "SELECT",
    "attempt,execution,project,resets_at,tenant,usage_window",
  ],
  [
    "personal_runner",
    "SELECT",
    "agents_advertised,capabilities,credentials_named,executions_polled_at,memory_ceiling_mib,memory_room_mib,owner,principal,runner_package,runner_version,tenant",
  ],
  [
    "personal_runner",
    "UPDATE",
    "agents_advertised,capabilities,credentials_named,executions_polled_at,last_polled_at,memory_ceiling_mib,memory_room_mib,runner_package,runner_version",
  ],
  ["personal_runner_project", "SELECT", "owner,priority,project,tenant"],
  ["project", "SELECT", "lifecycle,project,tenant"],
  ["recovery_epoch", "SELECT", "epoch,established_at,ordinal"],
  ["schema_migration", "SELECT", "applied_at,name,version"],
  [
    "session_launch",
    "SELECT",
    "authority,backoff_secs,bounds,deadline_secs,image,mirrors,model,published_at,singleton",
  ],
  [
    "worker_pool",
    "SELECT",
    "capabilities,class,credentials_named,memory_ceiling_mib,memory_room_mib,pool,principal,project,registered_by,runner_package,runner_version,tenant",
  ],
  [
    "worker_pool",
    "UPDATE",
    "capabilities,credentials_named,executions_polled_at,last_polled_at,memory_ceiling_mib,memory_room_mib,runner_package,runner_version",
  ],
];

/**
 * A claim hands out the image its execution's requirement pinned, which the
 * plane reads to do it; this is every other column the plane may touch, so an
 * attempt's invocation, the digest a bearer is checked against and a pool's
 * client are none of them. A session's launch is read whole, and a pool's
 * liveness and the runner, capabilities, memory ceiling and credentials its
 * poll named, its memory room, and whether a personal runner's capabilities advertise its
 * agents, are all of its row the plane writes, as a chat host's liveness,
 * runner and credentials are of its, while a pool's registrant is the account its claims spend and a press
 * is read and spent by the claim it lets through, as a personal runner's
 * claim records whether it benches its credential, whose outcome is read off
 * its attempt's ending and limit.
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
    poolPlaneColumns.map(([table_name, privilege_type, columns]) => ({
      table_name,
      privilege_type,
      columns,
    })),
  );
});

test("a runner's poll naming a set that no longer runs what it holds keeps what it holds", async () => {
  const { identity, drawn } = await runnerClaimed("narrowed");
  await postgresWorkerPoolRunners(planePool).named(identity, undefined, []);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT capabilities FROM personal_runner WHERE principal=$1`,
      [identity.principal],
    ),
    [{ capabilities: [] }],
  );
  assert.equal(await assignments.held(identity, drawn.assignment), true);
  assert.equal(
    await assignments.renew(identity, drawn.assignment, leaseSecs),
    true,
  );
  assert.equal(await assignments.release(identity, drawn.assignment), true);
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

/** A runner of the owner of `project`, one attempt claimed by it, and the handles the claim drew. */
async function runnerClaimedIn(
  project: SchedulerProject & { readonly owner: Principal },
  label: string,
): Promise<{
  project: SchedulerProject;
  identity: Runner;
  claimed: Awaited<ReturnType<typeof poolAttempt>>;
  drawn: { assignment: string; bearer: string };
}> {
  const identity = await runnerOf(project, label, [platform]);
  const claimed = await poolAttempt(project, label);
  const drawn = handles(label);
  assert.notEqual(await runnerClaim(identity, drawn), undefined);
  return { project, identity, claimed, drawn };
}

/** One project's runner registered and one attempt claimed by it. */
async function runnerClaimed(
  label: string,
): ReturnType<typeof runnerClaimedIn> {
  return runnerClaimedIn(await ownedProject(`pool-${label}`), label);
}

/** The refusal one attempt keeps, read under the scheduler that blocks on it. */
async function poolRefusalKept(
  project: SchedulerProject,
  attempt: string,
): Promise<unknown> {
  return (
    await rig.pool.query(
      `SELECT pool_refusal, pool_refusal_fault FROM execution_attempt
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [project.partition.tenant, project.partition.project, attempt],
    )
  ).rows;
}

test("a refusal keeps the image fault its runner named, and a refusal naming none keeps none", async () => {
  const faulted = await runnerClaimed("refused-faulted");
  assert.equal(
    await assignments.refuse(
      faulted.identity,
      faulted.drawn.assignment,
      "git: not found",
      "ImageLacksGit",
    ),
    true,
  );
  assert.deepEqual(
    await poolRefusalKept(faulted.project, faulted.claimed.attempt),
    [{ pool_refusal: "git: not found", pool_refusal_fault: "ImageLacksGit" }],
  );
  const plain = await runnerClaimed("refused-plain");
  assert.equal(
    await assignments.refuse(plain.identity, plain.drawn.assignment, "no node"),
    true,
  );
  assert.deepEqual(
    await poolRefusalKept(plain.project, plain.claimed.attempt),
    [{ pool_refusal: "no node", pool_refusal_fault: null }],
  );
});

/** Who reads an execution back through the API's role; no ticket here is theirs. */
const reader = asPrincipal("https://issuer.invalid#an-operator");

test("a refusal is read back through the API in the runner's own words, beside the size its execution asked for", async () => {
  const sized = await runnerClaimedIn(
    await ownedProject(
      "pool-refused-sized",
      1,
      poolConfiguration(undefined, {
        ticketDefault: { cpus: 8, memoryMib: 16_384 },
      }),
    ),
    "refused-sized",
  );
  const words =
    "the assignment asks for 8000 CPU millis and this machine has 4000";
  assert.equal(
    await assignments.refuse(sized.identity, sized.drawn.assignment, words),
    true,
  );
  const read = await postgresOperationalReads(apiPool).execution(
    sized.project.partition,
    asExecutionId(sized.claimed.execution),
    reader,
  );
  assert.deepEqual(read?.resources, { cpuMillis: 8_000, memoryMib: 16_384 });
  assert.deepEqual(
    read?.attempts.map((attempt) => attempt.refusal),
    [words],
  );
  const unsized = await runnerClaimed("refused-unsized");
  const plain = await postgresOperationalReads(apiPool).execution(
    unsized.project.partition,
    asExecutionId(unsized.claimed.execution),
    reader,
  );
  assert.equal(plain?.resources, undefined);
  assert.deepEqual(
    plain?.attempts.map((attempt) => attempt.refusal),
    [undefined],
  );
});

test("no attempt keeps a fault the contract does not name, or a fault beside no refusal", async () => {
  const { project, claimed } = await runnerClaimed("refused-unknown");
  const where = [
    project.partition.tenant,
    project.partition.project,
    claimed.attempt,
  ];
  await assert.rejects(
    planePool.query(
      `UPDATE execution_attempt SET pool_refusal='no sed',pool_refusal_fault='ImageLacksSed'
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      where,
    ),
    /execution_attempt_pool_refusal_fault_is_known/u,
  );
  await assert.rejects(
    planePool.query(
      `UPDATE execution_attempt SET pool_refusal_fault='ImageLacksGit'
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      where,
    ),
    /execution_attempt_pool_refusal_fault_is_a_refusal_s/u,
  );
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
 * A runner that answers Unavailable launched nothing, and releasing the
 * assignment, as the pool plane's own role does, takes its bearer back: a
 * harness launched under it anyway is answered as a bearer never issued is.
 */
test("a released attempt's bearer is answered as one never issued", async () => {
  const { identity, claimed, drawn } = await runnerClaimed("released-bearer");
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
 * The heartbeat a harness sends for this bearer and generation, asking for a
 * lease shorter than any a runner is given.
 */
function poolHeartbeat(bearer: string, generation: number): Promise<boolean> {
  return postgresWorkerAttemptHeartbeats(harnessPlanePool).heartbeat(
    asAttemptCapabilitySecret(bearer),
    generation,
    1,
  );
}

/**
 * A runner's polls lease the attempt it claimed, so the heartbeat of the
 * harness it launched answers whether that lease holds the attempt live and writes
 * nothing, however short a lease the harness asks for.
 */
test("a harness a runner launched is answered live by its heartbeat, which renews nothing", async () => {
  const live = await runnerClaimed("heartbeat-live");
  const { bearer } = live.drawn;
  const { generation } = live.claimed.opened;
  const before = await poolClaimRow(live.project, live.claimed.attempt);
  assert.equal(await poolHeartbeat(bearer, generation), true);
  assert.deepEqual(
    await poolClaimRow(live.project, live.claimed.attempt),
    before,
  );
  assert.equal(
    await poolHeartbeat(bearer, generation + 1),
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
    await poolHeartbeat(bearer, generation),
    false,
    "a lapsed lease holds nothing",
  );
});

test("a runner's harness is answered stop once its attempt is refused, reported, never claimed, or recovered from", async () => {
  const refused = await runnerClaimed("heartbeat-refused");
  assert.equal(
    await assignments.refuse(
      refused.identity,
      refused.drawn.assignment,
      "no node takes this",
    ),
    true,
  );
  assert.equal(
    await poolHeartbeat(
      refused.drawn.bearer,
      refused.claimed.opened.generation,
    ),
    false,
    "a refused assignment is not live",
  );
  const reported = await runnerClaimed("heartbeat-reported");
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
    await poolHeartbeat(
      reported.drawn.bearer,
      reported.claimed.opened.generation,
    ),
    false,
    "a reported attempt is not live",
  );
  const unclaimed = await poolAttempt(
    await poolProject("pool-heartbeat-unclaimed"),
    "heartbeat-unclaimed",
  );
  assert.equal(
    await poolHeartbeat(
      unclaimed.opened.capability.secret,
      unclaimed.opened.generation,
    ),
    false,
    "an attempt no runner claimed is not a runner's",
  );
  const recovered = await runnerClaimed("heartbeat-recovered");
  await rig.harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  assert.equal(
    await poolHeartbeat(
      recovered.drawn.bearer,
      recovered.claimed.opened.generation,
    ),
    false,
    "a recovery fences what the last epoch's runner claimed",
  );
});
