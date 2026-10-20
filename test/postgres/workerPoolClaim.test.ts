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
 * CHECK down to plant a personal pool owning nothing there: a pool's own
 * refusal of a personal registration is the term under test, and a CHECK is
 * not that term.
 *
 * A PERSONAL POOL WITH AN OWNER IS A MEMBER'S RUNNER, planted as its row and
 * its allowlist in its partition's tenant and claimed as one. An execution's
 * owner and its project's fallback are its columns. A runner beside the case's
 * is live where it makes a poll whose token is open, which is a last poll the
 * claim reads as recent, and one the case revokes is named to the claim as the
 * interpreter names an owner it asked.
 *
 * A CASE THE DATABASE CANNOT EXPRESS IS NAMED WITH THE REASON, derived from
 * the case rather than listed, so a case added to the table is planted or
 * named here without an edit.
 *
 * BESIDE THE TABLE is what no row of it states: a pool reporting less than it
 * holds, two claims of one pool made at once, a claim and a registration of
 * its pool made at once, and the image a claim hands out reaching the pod a
 * site places.
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
import { sessionAttemptMint } from "../../src/adapters/crypto/sessionAttemptMint.ts";
import {
  kubernetesPoolBackend,
  type KubernetesPoolPlacementConfig,
} from "../../src/adapters/kubernetes/poolPlacement.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import { apiRole, poolPlaneRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRunners,
  postgresWorkerPoolRegistry,
} from "../../src/adapters/postgres/workerPool.ts";
import { postgresWorkerPoolSessions } from "../../src/adapters/postgres/workerPoolSessions.ts";
import type { ExecutionRequirement } from "../../src/interpreter/executionRequirement.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type ProjectId,
} from "../../src/interpreter/projectStore.ts";
import { sessionRunnerPolledSecsMax } from "../../src/interpreter/sessionPlacement.ts";
import { materialDigest } from "../../src/interpreter/ticketDefinition.ts";
import type { TaskResources } from "../../src/interpreter/taskResources.ts";
import {
  workerPoolReconcile,
  type DedicatedPoolIdentity,
  type PersonalRunnerIdentity,
  type WorkerPoolPollSettings,
  type WorkerPoolPorts,
} from "../../src/interpreter/workerPool.ts";
import {
  workerPoolCanAssign,
  workerPoolDemandRouted,
  workerPoolPlatformToken,
  workerPoolPolicyRegistered,
  type WorkerPoolDemand,
  type WorkerPoolEnrolment,
  type WorkerPoolPolicy,
  type WorkerPoolRunner,
} from "../../src/interpreter/workerPoolAssignment.ts";
import {
  runnerCaseAssignment,
  runnerCases,
  type RunnerCase,
} from "../interpreter/runnerCases.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessRolePool,
} from "./harness.ts";
import {
  schedulerClaimFor,
  schedulerInvocation,
  schedulerOwner,
  schedulerProject,
  schedulerRigOpen,
  schedulerInCluster,
  schedulerRuntime,
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

/** The pool plane's ports with no session ever waiting, since every case here is an execution's. */
function polling(mint: () => string): WorkerPoolPorts {
  return {
    assignments,
    runners: postgresWorkerPoolRunners(planePool),
    access: {
      authorize: () => Promise.resolve(undefined),
      authorizeTenant: () => Promise.resolve(undefined),
      authorizeSite: projectAccessSiteRefused,
    },
    sessions: {
      store: postgresWorkerPoolSessions(planePool),
      bindings: postgresProjectRepositoryBinding(planePool),
      bearers: sessionAttemptMint(),
    },
    mint,
  };
}

await rig.harness.query(
  "ALTER TABLE worker_pool DROP CONSTRAINT worker_pool_class_is_known",
);

/** How long a claim's lease runs for, past the duration of any case here. */
const leaseSecs = 300;

/** Whether a pool is planted as a member's runner rather than a registry row. */
function runnerOwned(pool: WorkerPoolRunner): boolean {
  return pool.class === "Personal" && pool.dedicatedOwner !== undefined;
}

/** The policy a pool varies that its row has no column for. */
function policyUnplanted(pool: WorkerPoolRunner): readonly string[] {
  const columns: readonly (keyof WorkerPoolPolicy)[] = runnerOwned(pool)
    ? ["class", "dedicatedOwner", "allowlist"]
    : ["class"];
  return (
    Object.keys(workerPoolPolicyRegistered) as (keyof WorkerPoolPolicy)[]
  ).filter(
    (field) =>
      !columns.includes(field) &&
      pool[field] !== workerPoolPolicyRegistered[field],
  );
}

/** The demand an execution carries columns for: its owner, and whether and how its project allows a personal pool. */
const demandPlanted: readonly (keyof WorkerPoolDemand)[] = [
  "personalRunnerAllowed",
  "ownerOf",
  "ownerFallback",
];

/** Why a member's runner cannot be planted as the case states it, or undefined where it can. */
function runnerUnplanted(
  { pool, session }: WorkerPoolEnrolment,
  home: Partition,
): string | undefined {
  if (
    pool.allowlist.some((allowed) => allowed.tenant !== pool.partition.tenant)
  )
    return "a member's runner allowlists projects of its own tenant only";
  if (pool.partition.tenant !== home.tenant)
    return "a member's runner of another tenant has no project of this one to allowlist";
  if (
    session !== undefined &&
    (session.pool !== pool.pool ||
      session.partition.tenant !== pool.partition.tenant ||
      session.partition.project !== pool.partition.project)
  )
    return "a member's runner is known by its principal alone, so no poll resolves to another runner under it";
  if (!pool.enabled)
    return "a member's runner taken off has no row to claim through";
  return undefined;
}

/** Why the pools beside the case's cannot be planted, or undefined where they can. */
function othersUnplanted(c: RunnerCase): string | undefined {
  const home = c.placement.partition;
  const owners = new Set(
    [c.pool, ...c.others.map(({ pool }) => pool)]
      .filter(runnerOwned)
      .map((pool) => `${pool.partition.tenant}/${String(pool.dedicatedOwner)}`),
  );
  if (
    owners.size !==
    [c.pool, ...c.others.map(({ pool }) => pool)].filter(runnerOwned).length
  )
    return "a member has one runner in a tenant";
  for (const other of c.others) {
    if (other.pool.class === "Personal" && !runnerOwned(other.pool))
      return "a personal pool owning nothing beside the case's is no member's runner";
    const policy = policyUnplanted(other.pool);
    if (policy.length > 0)
      return `the pool beside the case's varies ${policy.join(", ")}, which no row carries`;
    if (runnerOwned(other.pool)) {
      const reason = runnerUnplanted(other, home);
      if (reason !== undefined) return reason;
    } else if (
      other.pool.revoked ||
      !other.pool.enabled ||
      other.pool.partition.tenant !== home.tenant ||
      other.pool.partition.project !== home.project ||
      other.pool.pool === c.pool.pool ||
      other.pool.pool === "pool-other"
    )
      return "a pool beside the case's is planted registered in its project under a name of its own";
  }
  return undefined;
}

/** Why the claim cannot be asked a case, or undefined where it can. */
function inexpressible(c: RunnerCase): string | undefined {
  if (c.session === undefined)
    return "only a poll claims, so a pool making none asks for nothing";
  if (!c.session.leaseOpen)
    return "a poll's lease is its token, verified before any claim is asked for";
  if (c.pool.revoked)
    return "Execute, or a member's permit and Read, is the authority's, asked before any claim";
  const policy = policyUnplanted(c.pool);
  if (policy.length > 0)
    return `the registry has no column for ${policy.join(", ")}, which every pool holds as registered`;
  if (runnerOwned(c.pool)) {
    const reason = runnerUnplanted(
      { pool: c.pool, session: c.session },
      c.placement.partition,
    );
    if (reason !== undefined) return reason;
  }
  const demand = (
    Object.keys(workerPoolDemandRouted) as (keyof WorkerPoolDemand)[]
  ).filter(
    (field) =>
      !demandPlanted.includes(field) &&
      c.placement.demand[field] !== workerPoolDemandRouted[field],
  );
  if (demand.length > 0)
    return `the execution has no column for ${demand.join(", ")}, which every routed execution is pinned with`;
  return othersUnplanted(c);
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

/** The image every task of the harness configuration is released in. */
const harnessImage = (
  JSON.parse(String(postgresHarnessConfiguration)) as { readonly image: string }
).image;

/**
 * A project whose every execution runs `requirement`, and with the size
 * `resources` names where it names one, written into the release before
 * registration copies it out.
 */
async function releasedUnder(
  label: string,
  requirement: ExecutionRequirement,
  tasks: number,
  resources?: TaskResources,
): Promise<SchedulerProject> {
  const project = await schedulerProject(rig, label, { tasks });
  if (resources !== undefined)
    await rig.harness.query(
      `UPDATE ticket_definition d SET definition=jsonb_set(d.definition,'{tasks}',
         (SELECT jsonb_agg(CASE WHEN t->>'key'='Work'
            THEN jsonb_set(jsonb_set(t,'{workload,resources}',$4::jsonb),
                           '{workload,digest}',to_jsonb($5::text))
            ELSE t END ORDER BY o)
            FROM jsonb_array_elements(d.definition->'tasks') WITH ORDINALITY AS e(t,o)))
        WHERE d.tenant=$1 AND d.project=$2 AND d.ticket=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        project.ticket,
        JSON.stringify(resources),
        materialDigest({ image: harnessImage, resources }),
      ],
    );
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
    schedulerInCluster,
  );
  return project;
}

/** The owner an execution is planted with and the fallback its project named, each NULL where the case's demand has none. */
interface Owned {
  readonly owner: string | null;
  readonly fallback: string | null;
}

const unowned: Owned = { owner: null, fallback: null };

/** The next execution admitted and opened as an invoked attempt, marked for a pool unless `inCluster`, and owned as `owned` says. */
async function opened(
  project: SchedulerProject,
  inCluster = false,
  owned: Owned = unowned,
): Promise<{ execution: string; attempt: string }> {
  const admitted = await rig.store.admit(project.cluster);
  if (admitted.admitted !== "Admitted")
    throw new Error("worker pool claim suite: nothing was admitted");
  if (!inCluster)
    await rig.harness.query(
      `UPDATE execution SET placement='Pool',owner=$4,owner_fallback=$5
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        admitted.execution,
        owned.owner,
        owned.fallback,
      ],
    );
  const attempt = await rig.store.openAttempt({
    partition: project.partition,
    execution: admitted.execution,
    epoch: project.epoch,
    leaseSecs,
    retriesMax: 3,
    placementBackoffSecs: 1,
    runtime: schedulerRuntime,
  });
  if (attempt.opened !== "Opened")
    throw new Error("worker pool claim suite: no attempt was opened");
  if (!(await rig.store.attemptInvoked(attempt.attempt, schedulerInvocation)))
    throw new Error("worker pool claim suite: no invocation was recorded");
  return { execution: admitted.execution, attempt: attempt.attempt.attempt };
}

/** Makes a project of the case's tenant where it is not the case's own and no case step made it yet. */
async function projectPlanted(
  partition: Partition,
  home: Partition,
): Promise<void> {
  if (partition.tenant === home.tenant && partition.project === home.project)
    return;
  const found = (await rig.harness.query(
    `SELECT 1 FROM project WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  )) as readonly unknown[];
  if (found.length === 0) await rig.harness.store.createProject(partition);
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
  await projectPlanted(partition, home);
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

/** A member's runner as its row and allowlist, polled `polledSecsAgo` before now where it is `live` and never otherwise. */
async function plantedRunner(
  named: Planted,
  pool: WorkerPoolRunner,
  live: boolean,
  polledSecsAgo: number,
): Promise<PersonalPlaneIdentity> {
  const home = named.project.partition;
  if (pool.dedicatedOwner === undefined)
    throw new Error("worker pool claim suite: a runner owning nothing");
  const identity: PersonalPlaneIdentity = {
    kind: "Personal",
    tenant: named.partition(pool.partition).tenant,
    owner: named.principal(pool.dedicatedOwner),
    principal: named.principal(pool.principal),
  };
  const allowed = pool.allowlist.map((project) => named.partition(project));
  for (const project of allowed) await projectPlanted(project, home);
  await plantedRunnerRows(
    identity,
    pool.capabilities,
    live ? polledSecsAgo : undefined,
    allowed.map((project) => project.project),
  );
  return identity;
}

/** A runner's row and the projects it is allowed into, polled `polledSecsAgo` before now where that is named and never otherwise. */
async function plantedRunnerRows(
  identity: PersonalPlaneIdentity,
  capabilities: readonly string[],
  polledSecsAgo: number | undefined,
  allowlist: readonly ProjectId[],
): Promise<void> {
  await rig.harness.query(
    `INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id,executions_polled_at)
      VALUES($1,$2,$3,$4,$5,
        CASE WHEN $6::boolean THEN now()-make_interval(secs=>$7::double precision) END)`,
    [
      identity.tenant,
      identity.owner,
      capabilities,
      identity.principal,
      `chuggy-personal-${randomUUID()}`,
      polledSecsAgo !== undefined,
      polledSecsAgo ?? 0,
    ],
  );
  for (const project of allowlist)
    await rig.harness.query(
      `INSERT INTO personal_runner_project(tenant,owner,project) VALUES($1,$2,$3)`,
      [identity.tenant, identity.owner, project],
    );
}

type PersonalPlaneIdentity = PersonalRunnerIdentity & {
  readonly kind: "Personal";
};

type PlantedIdentity = DedicatedPoolIdentity | PersonalPlaneIdentity;

/** Claims the oldest placeable attempt for a pool or runner that must get one, a runner in the case's project. */
async function claimedBy(
  identity: PlantedIdentity,
  assignment: string,
  home?: Partition,
) {
  const terms = { leaseSecs, heldMax: Number.MAX_SAFE_INTEGER };
  const bearer = `bearer-${randomUUID()}`;
  const claimed =
    identity.kind === "Dedicated"
      ? await assignments.claim(identity, terms, assignment, bearer, [])
      : await assignments.claimPersonal(
          identity,
          terms,
          assignment,
          bearer,
          home === undefined ? [] : [home.project],
        );
  if (claimed === undefined)
    throw new Error("worker pool claim suite: a planted claim took nothing");
}

/** What a pool declaring everything declares for one requirement: its platform, both agents, and every capability it names. */
function declaringAll(requirement: ExecutionRequirement): readonly string[] {
  return [
    ...new Set([
      workerPoolPlatformToken(requirement),
      "Agent:Claude",
      "Agent:Codex",
      ...(requirement.mode === "Capability" ? requirement.capabilities : []),
    ]),
  ];
}

/** The case's pool as planted, the client a registered one was registered under, another pool of the project declaring everything, and the owners the case revokes. */
interface PlantedPools {
  readonly pool: PlantedIdentity;
  readonly clientId: string | undefined;
  readonly other: DedicatedPoolIdentity;
  readonly ownersRevoked: readonly Principal[];
}

/** One pool as the case registers it, or a member's runner where it has an owner. */
async function plantedPool(
  named: Planted,
  { pool, session }: WorkerPoolEnrolment,
  polledSecsAgo: number,
): Promise<{ identity: PlantedIdentity; clientId: string | undefined }> {
  if (runnerOwned(pool))
    return {
      identity: await plantedRunner(
        named,
        pool,
        session?.leaseOpen === true,
        polledSecsAgo,
      ),
      clientId: undefined,
    };
  const identity: DedicatedPoolIdentity = {
    kind: "Dedicated",
    partition: named.partition(pool.partition),
    pool: pool.pool,
    principal: named.principal(pool.principal),
  };
  const clientId = await registeredPool(
    identity.partition,
    identity.pool,
    identity.principal,
    pool.capabilities,
    pool,
    named.project.partition,
  );
  return { identity, clientId };
}

async function plantedPools(
  c: RunnerCase,
  named: Planted,
  polledSecsAgo: number,
): Promise<PlantedPools> {
  const home = named.project.partition;
  const { identity: pool, clientId } = await plantedPool(
    named,
    { pool: c.pool, session: c.session },
    polledSecsAgo,
  );
  const ownersRevoked: Principal[] = [];
  for (const beside of c.others) {
    await plantedPool(named, beside, polledSecsAgo);
    const owner = beside.pool.dedicatedOwner;
    if (runnerOwned(beside.pool) && beside.pool.revoked && owner !== undefined)
      ownersRevoked.push(named.principal(owner));
  }
  const other: DedicatedPoolIdentity = {
    kind: "Dedicated",
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
  return { pool, clientId, other, ownersRevoked };
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

/** The owner and fallback the case's execution is pinned with. */
function ownedAs(c: RunnerCase, named: Planted): Owned {
  const { ownerOf, personalRunnerAllowed, ownerFallback } = c.placement.demand;
  return {
    owner: ownerOf === undefined ? null : named.principal(ownerOf),
    fallback: personalRunnerAllowed ? ownerFallback : null,
  };
}

/** The case's attempt, opened after the slots its pool holds and the identity another pool bound, and placed as the case says. */
async function plantedTarget(
  c: RunnerCase,
  held: number,
  named: Planted,
  pools: PlantedPools,
): Promise<{ execution: string; attempt: string }> {
  const home = named.project.partition;
  const owned = ownedAs(c, named);
  for (let slot = 0; slot < held; slot++) {
    await opened(
      named.project,
      false,
      pools.pool.kind === "Personal" ? owned : unowned,
    );
    await claimedBy(pools.pool, `held-${randomUUID()}`, home);
  }
  if (c.assignmentsBound.includes(runnerCaseAssignment)) {
    await opened(named.project);
    await claimedBy(pools.other, named.assignment);
  }
  const target = await opened(
    named.project,
    c.placement.route === "InCluster",
    owned,
  );
  if (c.placement.phase === "Assigned")
    await claimedBy(pools.other, `assigned-${randomUUID()}`);
  if (c.placement.status !== "Launching")
    await statusPlanted(home, target.execution, c.placement.status);
  return target;
}

/** The case's claim, asked under its session; an identity already bound fails the statement, and that binds nothing. */
async function claimAsked(
  identity: PlantedIdentity,
  heldMax: number,
  assignment: string,
  pools: PlantedPools,
  home: Partition,
): Promise<unknown> {
  const terms = { leaseSecs, heldMax };
  const bearer = `bearer-${randomUUID()}`;
  try {
    return identity.kind === "Dedicated"
      ? await assignments.claim(
          identity,
          terms,
          assignment,
          bearer,
          pools.ownersRevoked,
        )
      : await assignments.claimPersonal(identity, terms, assignment, bearer, [
          home.project,
        ]);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "23505") throw error;
    return undefined;
  }
}

/** The identity the case's poll is asked under: its pool's own, or the runner its principal names. */
function sessionIdentity(
  c: RunnerCase,
  named: Planted,
  pools: PlantedPools,
): PlantedIdentity {
  const session = c.session;
  if (session === undefined) throw new Error("an inexpressible case");
  const principal = named.principal(session.principal);
  return pools.pool.kind === "Personal"
    ? { ...pools.pool, principal }
    : {
        kind: "Dedicated",
        partition: named.partition(session.partition),
        pool: session.pool,
        principal,
      };
}

/** Whether the case's claim took its execution's attempt, from the rows the case planted, a live runner's last poll `polledSecsAgo` before now. */
async function claimTook(
  c: RunnerCase,
  label: string,
  polledSecsAgo = 0,
): Promise<boolean> {
  const session = c.session;
  if (session === undefined) throw new Error("an inexpressible case");
  const bystanders =
    session.held + (c.assignmentsBound.includes(runnerCaseAssignment) ? 1 : 0);
  const named = planted(
    c,
    await releasedUnder(label, c.placement.requirement, bystanders + 1),
  );
  const pools = await plantedPools(c, named, polledSecsAgo);
  const target = await plantedTarget(c, session.held, named, pools);
  if (!c.pool.enabled && pools.pool.kind === "Dedicated")
    assert.equal(
      await registry.deregister(
        pools.pool.partition,
        pools.pool.pool,
        pools.clientId ?? "",
      ),
      true,
    );
  const home = named.project.partition;
  const identity = sessionIdentity(c, named, pools);
  const claimed = await claimAsked(
    identity,
    session.heldMax,
    named.assignment,
    pools,
    home,
  );
  const [bound] = (await rig.harness.query(
    `SELECT pool, assignment FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [home.tenant, home.project, target.attempt],
  )) as readonly { pool: string | null; assignment: string | null }[];
  const holder = identity.kind === "Dedicated" ? identity.pool : identity.owner;
  const took = bound?.pool === holder && bound.assignment === named.assignment;
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
        [{ pool: c.pool, session: c.session }, ...c.others],
        runnerCaseAssignment,
        new Set(c.assignmentsBound),
      ),
      c.canAssign,
      "the table and the decider agree, or this case holds the claim to nothing",
    );
    assert.equal(await claimTook(c, `claim-${String(label)}`), c.canAssign);
  });
}

test("a runner's poll for executions keeps a pool deferring to it for the liveness window and no longer", async () => {
  const deferring = runnerCases.find(
    (c) =>
      c.name ===
      "a dedicated pool is assigned nothing of an owner's whose personal pool is polling",
  );
  assert.ok(deferring !== undefined && !deferring.canAssign);
  assert.equal(
    await claimTook(
      deferring,
      "claim-live-inside",
      sessionRunnerPolledSecsMax - 30,
    ),
    false,
    "a poll inside the window",
  );
  assert.equal(
    await claimTook(
      deferring,
      "claim-live-outside",
      sessionRunnerPolledSecsMax + 30,
    ),
    true,
    "a poll older than the window",
  );
});

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
  sessionsPerPollMax: 1,
  sessionsHeldMax: 1,
  deadlineSecs: 600,
  callbackUrl: "https://plane.invalid/v1/ticket-execution",
  pollIntervalMs: 1,
  pollsMax: 1,
  imageHosts: new Map(),
};

/** A pool registered in this project declaring everything, as it polls. */
async function pollingPool(
  project: SchedulerProject,
  label: string,
  requirement: ExecutionRequirement,
): Promise<DedicatedPoolIdentity> {
  const identity: DedicatedPoolIdentity = {
    kind: "Dedicated",
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
  const ports = polling(() => randomUUID());
  const underReported = await workerPoolReconcile(
    ports,
    pool,
    { jobs: [], sessions: [] },
    { wanted: 1, wantedSessions: 0 },
    settings,
  );
  assert.deepEqual(underReported.assignments, []);
  const roomier = await workerPoolReconcile(
    ports,
    pool,
    { jobs: [], sessions: [] },
    { wanted: 1, wantedSessions: 0 },
    { ...settings, heldMax: 2 },
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
  ).claim(pool, terms, `first-${randomUUID()}`, `bearer-${randomUUID()}`, []);
  await reached;
  let settled = false;
  const second = assignments
    .claim(pool, terms, `second-${randomUUID()}`, `bearer-${randomUUID()}`, [])
    .finally(() => (settled = true));
  while (!settled && !(await advisoryWaiting())) await delay(10);
  open();
  assert.deepEqual(
    (await Promise.all([first, second])).map((taken) => taken !== undefined),
    [true, false],
  );
});

/**
 * An older registration's claim is held open at its commit, so the pool is
 * registered again while that attempt is claimed and not yet committed: the
 * fence waits on the pool's lock and then takes the bearer, where without the
 * lock it would read the attempt as unclaimed and the claim would commit a
 * bearer no registration answers for.
 */
test("a registration made while an older one's claim is still open waits for it and fences it", async () => {
  const project = await releasedUnder("claim-fenced", pinned, 1);
  const older = await pollingPool(project, "fenced", pinned);
  const attempt = await opened(project);
  let reach = (): void => undefined;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const claim = postgresWorkerPoolAssignments(
    heldAtCommit(planePool, reach, gate),
  ).claim(
    older,
    { leaseSecs, heldMax: 1 },
    `fenced-${randomUUID()}`,
    `bearer-${randomUUID()}`,
    [],
  );
  await reached;
  let settled = false;
  const newer = registry
    .register({
      partition: project.partition,
      pool: "fenced",
      capabilities: declaringAll(pinned),
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal: asPrincipal(`https://issuer.invalid#fenced-${randomUUID()}`),
    })
    .finally(() => (settled = true));
  while (!settled && !(await advisoryWaiting())) await delay(10);
  open();
  const [claimed, registered] = await Promise.all([claim, newer]);
  assert.notEqual(claimed, undefined);
  assert.equal(registered, true);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT pool_principal, capability_secret_digest FROM execution_attempt
        WHERE tenant=$1 AND project=$2 AND attempt=$3`,
      [project.partition.tenant, project.partition.project, attempt.attempt],
    ),
    [{ pool_principal: older.principal, capability_secret_digest: null }],
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
  workerPlaneUrl: "https://worker-plane.invalid",
  capabilityFile: "/run/chuggy/capability",
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
  sidecars: [],
};

/** The worker container of the pod a site places for one assignment, as the cluster was asked to create it. */
async function podContainer(
  assignment: WorkerPoolAssignment,
): Promise<{ readonly image: string; readonly resources: unknown }> {
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
    await kubernetesPoolBackend(site, fetcher).place({
      kind: "Job",
      assignment,
    }),
    { placed: "Placed" },
  );
  const [pod] = created as {
    spec: { containers: { image: string; resources: unknown }[] };
  }[];
  const container = pod?.spec.containers[0];
  if (container === undefined) throw new Error("no pod was created");
  return container;
}

/** The image of the pod a site places for one assignment. */
async function podImage(assignment: WorkerPoolAssignment): Promise<string> {
  return (await podContainer(assignment)).image;
}

/** The one assignment a poll is handed for a project released under `requirement`, sized as `resources` names. */
async function handedOut(
  label: string,
  requirement: ExecutionRequirement,
  resources?: TaskResources,
): Promise<WorkerPoolAssignment> {
  const project = await releasedUnder(label, requirement, 1, resources);
  const pool = await pollingPool(project, label, requirement);
  await opened(project);
  const answered = await workerPoolReconcile(
    polling(() => randomUUID()),
    pool,
    { jobs: [], sessions: [] },
    { wanted: 1, wantedSessions: 0 },
    settings,
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

test("an execution released with no size is claimed on the plane's box, and its pod on the same", async () => {
  const assignment = await handedOut("claim-unsized", pinned);
  assert.deepEqual(
    [assignment.cpuMillis, assignment.memoryMib],
    [settings.cpuMillis, settings.memoryMib],
  );
  assert.deepEqual((await podContainer(assignment)).resources, {
    requests: { cpu: "500m", memory: "256Mi", "ephemeral-storage": "4Gi" },
    limits: { cpu: "500m", memory: "256Mi", "ephemeral-storage": "4Gi" },
  });
});

test("an execution released with a size is claimed asking for it, and its pod is held to it", async () => {
  const assignment = await handedOut("claim-sized", pinned, {
    cpuMillis: 2_000,
    memoryMib: 1_024,
  });
  assert.deepEqual(
    [assignment.cpuMillis, assignment.memoryMib],
    [2_000, 1_024],
  );
  assert.deepEqual((await podContainer(assignment)).resources, {
    requests: { cpu: "2000m", memory: "1024Mi", "ephemeral-storage": "4Gi" },
    limits: { cpu: "2000m", memory: "1024Mi", "ephemeral-storage": "4Gi" },
  });
  const memoryOnly = await handedOut("claim-sized-memory", pinned, {
    memoryMib: 1_024,
  });
  assert.deepEqual(
    [memoryOnly.cpuMillis, memoryOnly.memoryMib],
    [settings.cpuMillis, 1_024],
  );
});

test("an execution released with a size is claimed asking for it by its owner's own runner", async () => {
  const label = "claim-sized-personal";
  const project = await releasedUnder(label, pinned, 1, {
    cpuMillis: 2_000,
    memoryMib: 1_024,
  });
  const runner: PersonalPlaneIdentity = {
    kind: "Personal",
    tenant: project.partition.tenant,
    owner: asPrincipal(`https://issuer.invalid#${label}-owner-${randomUUID()}`),
    principal: asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`),
  };
  await plantedRunnerRows(runner, declaringAll(pinned), 0, [
    project.partition.project,
  ]);
  await opened(project, false, { owner: runner.owner, fallback: "Strict" });
  const ports = polling(() => randomUUID());
  const answered = await workerPoolReconcile(
    {
      ...ports,
      access: {
        ...ports.access,
        authorize: (principal) => Promise.resolve(memberAuthority(principal)),
      },
    },
    runner,
    { jobs: [], sessions: [] },
    { wanted: 1, wantedSessions: 0 },
    settings,
  );
  assert.deepEqual(
    answered.assignments.map((taken) => [taken.cpuMillis, taken.memoryMib]),
    [[2_000, 1_024]],
  );
});

test("a capability requirement names no image, and its pod runs the pool's own", async () => {
  const assignment = await handedOut("claim-site-image", {
    mode: "Capability",
    operatingSystem: "Linux",
    architecture: "Amd64",
    capabilities: ["Agent:Claude"],
  });
  assert.equal("image" in assignment, false);
  assert.equal(await podImage(assignment), site.image);
});
