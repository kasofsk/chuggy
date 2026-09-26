/**
 * The claim a pool makes against PostgreSQL, held to `workerPoolCanAssign`
 * over the rows of `test/interpreter/runnerCases.ts`: each case the database
 * can express is planted as rows and claimed under the roles the deployment
 * runs, and the claim takes the attempt exactly where the case says the model
 * assigns it.
 *
 * A CASE IS PLANTED IN A PROJECT OF ITS OWN. The case's partition is that
 * project, and a partition it names beside it is the same one with the
 * other's tenant or project name appended; its principals and assignment carry
 * a suffix of the case's own, since both are unique across the installation.
 * The pool is the registry row, the session is the identity the claim is asked
 * under, and the placement is an execution released with the case's
 * requirement, opened and invoked. A slot a session holds is an attempt its
 * pool claimed first, and a bound identity or an assigned phase is an attempt
 * another pool claimed first.
 *
 * THE REGISTRY ADMITS ONE CLASS, so this suite's own database stands the
 * CHECK down to plant the model's others: the claim's own refusal of a
 * personal pool is the term under test, and a CHECK is not that term.
 *
 * A CASE THE DATABASE CANNOT EXPRESS IS NAMED WITH THE REASON, derived from
 * the case rather than listed, so a case added to the table is planted or
 * named here without an edit.
 *
 * BESIDE THE TABLE is what no row of it states: a pool reporting less than it
 * holds, two claims of one pool made at once, and the image a claim hands out
 * reaching the pod a site places.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";

import type { WorkerPoolAssignment } from "../../src/contract/workerPool.ts";
import {
  kubernetesPoolBackend,
  type KubernetesPoolPlacementConfig,
} from "../../src/adapters/kubernetes/poolPlacement.ts";
import { apiRole, poolPlaneRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
} from "../../src/adapters/postgres/workerPool.ts";
import {
  allExecutionCapabilities,
  type ExecutionRequirement,
} from "../../src/interpreter/executionRequirement.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { materialDigest } from "../../src/interpreter/ticketDefinition.ts";
import {
  workerPoolReconcile,
  type WorkerPoolIdentity,
  type WorkerPoolPollSettings,
} from "../../src/interpreter/workerPool.ts";
import {
  workerPoolCanAssign,
  workerPoolDemandRouted,
  workerPoolPlatformToken,
  workerPoolPolicyRegistered,
  type WorkerPoolPolicy,
} from "../../src/interpreter/workerPoolAssignment.ts";
import {
  runnerCaseAssignment,
  runnerCases,
  type RunnerCase,
} from "../interpreter/runnerCases.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerInvocation,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  type SchedulerProject,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const planePool = postgresHarnessRolePool(poolPlaneRole);
const apiPool = postgresHarnessRolePool(apiRole);
const root = mkdtempSync(join(tmpdir(), "chuggy-pool-claim-"));

after(async () => {
  rmSync(root, { recursive: true, force: true });
  await Promise.all([planePool.end(), apiPool.end()]);
  await rig.close();
});

const registry = postgresWorkerPoolRegistry(apiPool);
const assignments = postgresWorkerPoolAssignments(planePool);

await rig.harness.query(
  "ALTER TABLE worker_pool DROP CONSTRAINT worker_pool_class_is_known",
);

/** How long a claim's lease runs for, past the duration of any case here. */
const leaseSecs = 300;

/** Why the claim cannot be asked a case, or undefined where it can. */
function inexpressible(c: RunnerCase): string | undefined {
  if (c.session === undefined)
    return "only a poll claims, so a pool making none asks for nothing";
  if (!c.session.leaseOpen)
    return "a poll's lease is its token, verified before any claim is asked for";
  if (c.pool.revoked)
    return "Execute is the access check's, made on each request before any claim";
  const policy = (
    Object.keys(workerPoolPolicyRegistered) as (keyof WorkerPoolPolicy)[]
  ).filter(
    (field) =>
      field !== "class" && c.pool[field] !== workerPoolPolicyRegistered[field],
  );
  if (policy.length > 0)
    return `the registry has no column for ${policy.join(", ")}, which every pool holds as registered`;
  const demand = (
    Object.keys(
      workerPoolDemandRouted,
    ) as (keyof typeof workerPoolDemandRouted)[]
  ).filter(
    (field) => c.placement.demand[field] !== workerPoolDemandRouted[field],
  );
  if (demand.length > 0)
    return `the execution has no column for ${demand.join(", ")}, which every routed execution is pinned with`;
  return undefined;
}

/** The case's names made concrete in the project planted for it. */
interface Planted {
  readonly project: SchedulerProject;
  readonly partition: (named: Partition) => Partition;
  readonly principal: (named: Principal) => Principal;
  readonly assignment: string;
}

function planted(c: RunnerCase, project: SchedulerProject): Planted {
  const home = c.placement.partition;
  const suffix = randomUUID();
  return {
    project,
    partition: (named) => ({
      tenant: asTenantId(
        named.tenant === home.tenant
          ? project.partition.tenant
          : `${project.partition.tenant}-${named.tenant}`,
      ),
      project: asProjectId(
        named.project === home.project
          ? project.partition.project
          : `${project.partition.project}-${named.project}`,
      ),
    }),
    principal: (named) =>
      asPrincipal(`https://issuer.invalid#${named}-${suffix}`),
    assignment: `${runnerCaseAssignment}-${suffix}`,
  };
}

/** A project whose every execution runs `requirement`, written into the release before registration copies it out. */
async function releasedUnder(
  label: string,
  requirement: ExecutionRequirement,
  tasks: number,
): Promise<SchedulerProject> {
  const project = await schedulerProject(rig, label, { tasks });
  await rig.harness.query(
    `UPDATE ticket_definition d SET definition=jsonb_set(d.definition,'{tasks}',
       (SELECT jsonb_agg(CASE WHEN t->>'key'='Work'
          THEN jsonb_set(jsonb_set(t,'{executionRequirements,value}',$4::jsonb),
                         '{executionRequirements,digest}',to_jsonb($5::text))
          ELSE t END ORDER BY o)
          FROM jsonb_array_elements(d.definition->'tasks') WITH ORDINALITY AS e(t,o)))
      WHERE d.tenant=$1 AND d.project=$2 AND d.ticket=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      project.ticket,
      JSON.stringify(requirement),
      materialDigest(requirement),
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

/** The next execution admitted and opened as an invoked attempt, marked for a pool unless `inCluster`. */
async function opened(
  project: SchedulerProject,
  inCluster = false,
): Promise<{ execution: string; attempt: string }> {
  const admitted = await rig.store.admit(project.cluster);
  if (admitted.admitted !== "Admitted")
    throw new Error("worker pool claim suite: nothing was admitted");
  if (!inCluster)
    await rig.harness.query(
      `UPDATE execution SET placement='Pool' WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [project.partition.tenant, project.partition.project, admitted.execution],
    );
  const attempt = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  if (attempt.opened !== "Opened")
    throw new Error("worker pool claim suite: no attempt was opened");
  if (!(await rig.store.attemptInvoked(attempt.attempt, schedulerInvocation)))
    throw new Error("worker pool claim suite: no invocation was recorded");
  return { execution: admitted.execution, attempt: attempt.attempt.attempt };
}

/** Registers one pool, making its project first where it is not the case's own. */
async function registeredPool(
  partition: Partition,
  pool: string,
  principal: Principal,
  capabilities: readonly string[],
  policy: Pick<WorkerPoolPolicy, "class">,
  home: Partition,
): Promise<string> {
  if (partition.tenant !== home.tenant || partition.project !== home.project)
    await rig.harness.store.createProject(partition);
  const clientId = `chuggy-pool-${randomUUID()}`;
  assert.equal(
    await registry.register({
      partition,
      pool,
      capabilities,
      class: policy.class,
      clientId,
      principal,
    }),
    true,
  );
  return clientId;
}

/** Claims the oldest placeable attempt for a pool that must get one. */
async function claimedBy(identity: WorkerPoolIdentity, assignment: string) {
  const claimed = await assignments.claim(
    identity,
    { leaseSecs, heldMax: Number.MAX_SAFE_INTEGER },
    assignment,
    `bearer-${randomUUID()}`,
  );
  if (claimed === undefined)
    throw new Error("worker pool claim suite: a planted claim took nothing");
}

/** What a pool declaring everything declares for one requirement: its platform, where it has one, and every capability. */
function declaringAll(requirement: ExecutionRequirement): readonly string[] {
  return [
    ...(requirement.mode === "Native"
      ? []
      : [workerPoolPlatformToken(requirement)]),
    ...allExecutionCapabilities,
  ];
}

/** The case's pool as registered, the client it was registered under, and another pool of the project declaring everything. */
interface PlantedPools {
  readonly pool: WorkerPoolIdentity;
  readonly clientId: string;
  readonly other: WorkerPoolIdentity;
}

async function plantedPools(
  c: RunnerCase,
  named: Planted,
): Promise<PlantedPools> {
  const home = named.project.partition;
  const pool: WorkerPoolIdentity = {
    partition: named.partition(c.pool.partition),
    pool: c.pool.pool,
    principal: named.principal(c.pool.principal),
  };
  const clientId = await registeredPool(
    pool.partition,
    pool.pool,
    pool.principal,
    c.pool.capabilities,
    c.pool,
    home,
  );
  const other: WorkerPoolIdentity = {
    partition: home,
    pool: "pool-other",
    principal: named.principal(asPrincipal("principal-other")),
  };
  await registeredPool(
    home,
    other.pool,
    other.principal,
    declaringAll(c.placement.requirement),
    workerPoolPolicyRegistered,
    home,
  );
  return { pool, clientId, other };
}

/** Moves an execution to a status no attempt is opened under, which only standing its trigger down can plant. */
async function statusPlanted(
  partition: Partition,
  execution: string,
  status: string,
): Promise<void> {
  await rig.harness.query(
    "ALTER TABLE execution DISABLE TRIGGER execution_status_moves_legally",
  );
  await rig.harness.query(
    `UPDATE execution SET status=$4 WHERE tenant=$1 AND project=$2 AND execution=$3`,
    [partition.tenant, partition.project, execution, status],
  );
  await rig.harness.query(
    "ALTER TABLE execution ENABLE TRIGGER execution_status_moves_legally",
  );
}

/** The case's attempt, opened after the slots its pool holds and the identity another pool bound, and placed as the case says. */
async function plantedTarget(
  c: RunnerCase,
  held: number,
  named: Planted,
  pools: PlantedPools,
): Promise<{ execution: string; attempt: string }> {
  for (let slot = 0; slot < held; slot++) {
    await opened(named.project);
    await claimedBy(pools.pool, `held-${randomUUID()}`);
  }
  if (c.assignmentsBound.includes(runnerCaseAssignment)) {
    await opened(named.project);
    await claimedBy(pools.other, named.assignment);
  }
  const target = await opened(named.project, c.placement.route === "InCluster");
  if (c.placement.phase === "Assigned")
    await claimedBy(pools.other, `assigned-${randomUUID()}`);
  if (c.placement.status !== "Launching")
    await statusPlanted(
      named.project.partition,
      target.execution,
      c.placement.status,
    );
  return target;
}

/** The case's claim, asked under its session; an identity already bound fails the statement, and that binds nothing. */
async function claimAsked(
  identity: WorkerPoolIdentity,
  heldMax: number,
  assignment: string,
): Promise<unknown> {
  try {
    return await assignments.claim(
      identity,
      { leaseSecs, heldMax },
      assignment,
      `bearer-${randomUUID()}`,
    );
  } catch (error) {
    if ((error as { code?: unknown }).code !== "23505") throw error;
    return undefined;
  }
}

/** Whether the case's claim took its execution's attempt, from the rows the case planted. */
async function claimTook(c: RunnerCase, label: string): Promise<boolean> {
  const session = c.session;
  if (session === undefined) throw new Error("an inexpressible case");
  const bystanders =
    session.held + (c.assignmentsBound.includes(runnerCaseAssignment) ? 1 : 0);
  const named = planted(
    c,
    await releasedUnder(label, c.placement.requirement, bystanders + 1),
  );
  const pools = await plantedPools(c, named);
  const target = await plantedTarget(c, session.held, named, pools);
  if (!c.pool.enabled)
    assert.equal(
      await registry.deregister(
        pools.pool.partition,
        pools.pool.pool,
        pools.clientId,
      ),
      true,
    );
  const claimed = await claimAsked(
    {
      partition: named.partition(session.partition),
      pool: session.pool,
      principal: named.principal(session.principal),
    },
    session.heldMax,
    named.assignment,
  );
  const home = named.project.partition;
  const [bound] = (await rig.harness.query(
    `SELECT pool, assignment FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [home.tenant, home.project, target.attempt],
  )) as readonly { pool: string | null; assignment: string | null }[];
  const took =
    bound?.pool === session.pool && bound.assignment === named.assignment;
  assert.equal(
    claimed !== undefined,
    took,
    "a claim answers what it bound, and binds what it answers",
  );
  return took;
}

let label = 0;
for (const c of runnerCases) {
  label += 1;
  const reason = inexpressible(c);
  test(`the claim: ${c.name}`, { skip: reason }, async () => {
    assert.equal(
      workerPoolCanAssign(
        c.placement,
        { pool: c.pool, session: c.session },
        runnerCaseAssignment,
        new Set(c.assignmentsBound),
      ),
      c.canAssign,
      "the table and the decider agree, or this case holds the claim to nothing",
    );
    assert.equal(await claimTook(c, `claim-${String(label)}`), c.canAssign);
  });
}

test("the claim is asked cases it takes and cases it refuses", () => {
  const asked = runnerCases.filter((c) => inexpressible(c) === undefined);
  assert.ok(asked.some((c) => c.canAssign));
  assert.ok(asked.some((c) => !c.canAssign));
});

/** A poll's settings, holding one assignment at a time unless a case says otherwise. */
const settings: WorkerPoolPollSettings = {
  leaseSecs,
  cpuMillis: 500,
  memoryMib: 256,
  assignmentsPerPollMax: 4,
  heldMax: 1,
  deadlineSecs: 600,
  callbackUrl: "https://plane.invalid/v1/ticket-execution",
  pollIntervalMs: 1,
  pollsMax: 1,
};

/** A pool registered in this project declaring everything, as it polls. */
async function pollingPool(
  project: SchedulerProject,
  label: string,
  requirement: ExecutionRequirement,
): Promise<WorkerPoolIdentity> {
  const identity: WorkerPoolIdentity = {
    partition: project.partition,
    pool: label,
    principal: asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`),
  };
  await registeredPool(
    identity.partition,
    identity.pool,
    identity.principal,
    declaringAll(requirement),
    workerPoolPolicyRegistered,
    identity.partition,
  );
  return identity;
}

const pinnedImage = `registry.invalid/pinned-worker@sha256:${"b".repeat(64)}`;

const pinned: ExecutionRequirement = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Amd64",
  image: pinnedImage,
};

test("a pool that reports holding nothing is held to what the database says it holds", async () => {
  const project = await releasedUnder("claim-under-report", pinned, 2);
  const pool = await pollingPool(project, "under-report", pinned);
  await opened(project);
  await claimedBy(pool, `held-${randomUUID()}`);
  await opened(project);
  const mint = () => randomUUID();
  const underReported = await workerPoolReconcile(
    assignments,
    pool,
    [],
    1,
    settings,
    mint,
  );
  assert.deepEqual(underReported.assignments, []);
  const roomier = await workerPoolReconcile(
    assignments,
    pool,
    [],
    1,
    { ...settings, heldMax: 2 },
    mint,
  );
  assert.equal(
    roomier.assignments.length,
    1,
    "the refusal was the bound's, since room for one more claims it",
  );
});

/** A pool whose clients announce a commit and then hold it until `gate` opens. */
function heldAtCommit(
  pool: pg.Pool,
  reached: () => void,
  gate: Promise<void>,
): pg.Pool {
  const connect = async (): Promise<pg.PoolClient> => {
    const client = await pool.connect();
    return new Proxy(client, {
      get(target, property) {
        if (property === "query")
          return async (text: unknown, ...rest: unknown[]) => {
            if (text === "COMMIT") {
              reached();
              await gate;
            }
            return (target.query as (...args: unknown[]) => unknown)(
              text,
              ...rest,
            );
          };
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        const bound: unknown = (value as (...args: unknown[]) => unknown).bind(
          target,
        );
        return bound;
      },
    });
  };
  return { connect } as unknown as pg.Pool;
}

/** Whether a session of this database is waiting on an advisory lock. */
async function advisoryWaiting(): Promise<boolean> {
  const [row] = (await rig.harness.query(
    `SELECT count(*)::int AS waiting FROM pg_locks
      WHERE locktype='advisory' AND NOT granted
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
  )) as readonly { waiting: number }[];
  return (row?.waiting ?? 0) > 0;
}

/**
 * The first claim is held open at its commit, so the second is made while the
 * first's attempt is claimed and not yet committed: it waits on the pool's
 * lock and then counts that attempt, where without the lock it would count
 * nothing and take the other.
 */
test("a claim made while the same pool's last is still open waits for it and counts it", async () => {
  const project = await releasedUnder("claim-racing", pinned, 2);
  const pool = await pollingPool(project, "racing", pinned);
  await opened(project);
  await opened(project);
  const terms = { leaseSecs, heldMax: 1 };
  let reach = (): void => undefined;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const first = postgresWorkerPoolAssignments(
    heldAtCommit(planePool, reach, gate),
  ).claim(pool, terms, `first-${randomUUID()}`, `bearer-${randomUUID()}`);
  await reached;
  let settled = false;
  const second = assignments
    .claim(pool, terms, `second-${randomUUID()}`, `bearer-${randomUUID()}`)
    .finally(() => (settled = true));
  while (!settled && !(await advisoryWaiting())) await delay(10);
  open();
  assert.deepEqual(
    (await Promise.all([first, second])).map((taken) => taken !== undefined),
    [true, false],
  );
});

const tokenFile = join(root, "token");
writeFileSync(tokenFile, "cluster-token\n");

const site: KubernetesPoolPlacementConfig = {
  apiBaseUrl: "https://cluster.invalid:6443",
  namespace: "pool",
  tokenFile,
  serviceAccountName: "pool-worker",
  nodeSelector: {},
  podSecurityContext: {},
  containerSecurityContext: {},
  requestTimeoutSecsMax: 2,
  unavailableRetryAfterSecs: 11,
  workerPlaneUrl: "https://worker-plane.invalid",
  capabilityFile: "/run/chuggy/capability",
  workspacePath: "/workspace",
  credentialMounts: {},
  podNamePrefix: "pool",
  image: "registry.invalid/site-worker:1",
  poolLabel: { name: "chuggy.internal/pool", value: "pool-one" },
  podLabels: {},
  podAnnotations: {},
  resources: {
    cpuRequest: "100m",
    cpuLimit: "1",
    memoryRequest: "128Mi",
    memoryLimit: "512Mi",
    ephemeralStorageLimit: "4Gi",
  },
  timeoutSecsMax: 1_800,
  outputBytesMax: 4_096,
  environment: {},
  capabilities: {},
};

/** The image of the pod a site places for one assignment, as the cluster was asked to create it. */
async function podImage(assignment: WorkerPoolAssignment): Promise<string> {
  const created: unknown[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (!path.endsWith("/pods") || typeof init?.body !== "string")
      return Promise.resolve(new Response("{}", { status: 201 }));
    const pod = JSON.parse(init.body) as { metadata: Record<string, unknown> };
    created.push(pod);
    return Promise.resolve(
      new Response(
        JSON.stringify({ metadata: { ...pod.metadata, uid: "u" } }),
        {
          status: 201,
        },
      ),
    );
  };
  assert.deepEqual(
    await kubernetesPoolBackend(site, fetcher).place(assignment),
    { placed: "Placed" },
  );
  const [pod] = created as { spec: { containers: { image: string }[] } }[];
  const image = pod?.spec.containers[0]?.image;
  if (image === undefined) throw new Error("no pod was created");
  return image;
}

/** The one assignment a poll is handed for a project released under `requirement`. */
async function handedOut(
  label: string,
  requirement: ExecutionRequirement,
): Promise<WorkerPoolAssignment> {
  const project = await releasedUnder(label, requirement, 1);
  const pool = await pollingPool(project, label, requirement);
  await opened(project);
  const answered = await workerPoolReconcile(
    assignments,
    pool,
    [],
    1,
    settings,
    () => randomUUID(),
  );
  const [assignment] = answered.assignments;
  if (assignment === undefined) throw new Error(`${label} was handed nothing`);
  return assignment;
}

test("a container's pod runs the image its requirement pinned, claimed out of the database", async () => {
  const assignment = await handedOut("claim-pinned-image", pinned);
  assert.equal(assignment.image, pinnedImage);
  assert.equal(await podImage(assignment), pinnedImage);
});

test("a capability requirement names no image, and its pod runs the pool's own", async () => {
  const assignment = await handedOut("claim-site-image", {
    mode: "ContainerCapability",
    operatingSystem: "Linux",
    architecture: "Amd64",
    capabilities: ["Agent:Claude"],
  });
  assert.equal("image" in assignment, false);
  assert.equal(await podImage(assignment), site.image);
});
