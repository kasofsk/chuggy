/**
 * The claim a member's runner makes against PostgreSQL, held to
 * `workerPoolCanAssign` over the rows of `test/interpreter/runnerCases.ts`:
 * each case the database can express is planted as rows and claimed under the
 * roles the deployment runs, and the claim takes the attempt exactly where the
 * case says the model assigns it.
 *
 * A CASE IS PLANTED IN A PROJECT OF ITS OWN. The case's partition is that
 * project, and a partition it names beside it is the same one with the
 * other's tenant or project name appended; its principals and assignment carry
 * a suffix of the case's own, since both are unique across the installation.
 * The session is the identity the claim is asked under, and the placement is
 * an execution released with the case's requirement and size, opened and
 * invoked. A slot a session holds is an attempt its runner claimed first, and
 * a bound identity or an assigned phase is an attempt planted as claimed by an
 * owner the case does not name.
 *
 * ONLY A MEMBER'S RUNNER CLAIMS, since the pool plane admits no pool's poll. A
 * case's runner is a personal pool with an owner, planted as its row and its
 * allowlist in its partition's tenant and claimed as one; a registered pool
 * beside it is a registry row. An execution's owner and its project's fallback
 * are its columns. A runner beside the case's is live where it makes a poll
 * whose token is open, which is a last poll the claim reads as recent.
 *
 * A CASE THE DATABASE CANNOT EXPRESS IS NAMED WITH THE REASON, derived from
 * the case rather than listed, so a case added to the table is planted or
 * named here without an edit.
 *
 * BESIDE THE TABLE is what no row of it states: a runner reporting less than it
 * holds, two claims of one runner made at once, the image and size a claim
 * hands out, a claim passing over a job whose account has paused its agent,
 * and the order a claim takes what it may in, both of which the model leaves
 * to be chosen outside it. A ticket's age and whether it was started are read
 * from its executions' registrations, which a case plants by moving them back;
 * a second ticket in one project is an execution planted under another number.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type {
  AccountAgent,
  PersonalRunnerPriority,
} from "../../src/contract/rosters.ts";
import type {
  WorkerPoolAssignment,
  WorkerRunnerCredentials,
} from "../../src/contract/workerPool.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";
import { sessionAttemptMint } from "../../src/adapters/crypto/sessionAttemptMint.ts";
import {
  personalRunnerHeldAnsweredMax,
  personalRunnerWaitingCountedMax,
} from "../../src/contract/http.ts";
import { postgresOperationalReads } from "../../src/adapters/postgres/operationalReads.ts";
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  agentAccountNamedPauseFunction,
  apiRole,
  poolPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { agentAccountCredentialOffSecsAt191 } from "../../src/adapters/postgres/schema/migrations/191-agent-account-credential-off.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRunners,
  postgresWorkerPoolRegistry,
} from "../../src/adapters/postgres/workerPool.ts";
import { postgresWorkerPoolSessions } from "../../src/adapters/postgres/workerPoolSessions.ts";
import type { ExecutionRequirement } from "../../src/contract/executionRequirement.ts";
import type { WorkTaskInvocation } from "../../src/interpreter/executionScheduler.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
  type ProjectId,
} from "../../src/interpreter/projectStore.ts";
import { asExecutionId } from "../../src/interpreter/schedulerIdentity.ts";
import { sessionRunnerPolledSecsMax } from "../../src/interpreter/sessionPlacement.ts";
import { materialDigest } from "../../src/interpreter/ticketDefinition.ts";
import type { TaskResources } from "../../src/interpreter/taskResources.ts";
import {
  workerPoolMemoryMibDefault,
  workerPoolReconcile,
  type PersonalRunnerIdentity,
  type WorkerPoolClaimTerms,
  type WorkerPoolPollSettings,
  type WorkerPoolPorts,
} from "../../src/interpreter/workerPool.ts";
import {
  workerPoolAgentOffered,
  workerPoolCanAssign,
  workerPoolDemandRouted,
  workerPoolIsLive,
  workerPoolOwnerPools,
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
  agentAccountHarnessCommitted,
  agentAccountHarnessPressed,
  type AgentAccountHarnessLimit,
  type AgentAccountHarnessState,
} from "./agentAccountHarness.ts";
import {
  postgresHarnessAdvisoryWaiting,
  postgresHarnessConfiguration,
  postgresHarnessHeldAtCommit,
  postgresHarnessPartition,
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
  type SchedulerCapacity,
  type SchedulerProject,
} from "./schedulerHarness.ts";
import { workerContractPeerNaming } from "../interpreter/workerContractPeerFixture.ts";

const rig = await schedulerRigOpen();
const planePool = postgresHarnessRolePool(poolPlaneRole);
const apiPool = postgresHarnessRolePool(apiRole);

after(async () => {
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

/** The ports `polling` names, under an authority that lets every owner read every project, as a runner's poll asks before it claims. */
function pollingRead(mint: () => string): WorkerPoolPorts {
  const ports = polling(mint);
  return {
    ...ports,
    access: {
      ...ports.access,
      authorize: (principal) => Promise.resolve(memberAuthority(principal)),
    },
  };
}

/** How long a claim's lease runs for, past the duration of any case here. */
const leaseSecs = 300;

/** The size a claim reads an execution naming no memory as, which no case's size is. */
const memoryMibDefault = 256;

/** The member's read of their runners, which counts what waits for them as the API answers it. */
const personalRunners = postgresPersonalRunnerRegistry(
  apiPool,
  memoryMibDefault,
);

/** The owner's read of a run, which says what it waits on of their runners as the API answers it. */
const operationalReads = postgresOperationalReads(apiPool, memoryMibDefault);

/** How many attempts the owner's read counts waiting in each of `projects`, every project read. */
async function waitingCounted(
  identity: PersonalRunnerIdentity,
  projects: readonly ProjectId[],
): Promise<ReadonlyMap<ProjectId, number>> {
  const read = await personalRunners.runners(
    { tenant: identity.tenant, owner: identity.owner },
    () => Promise.resolve(true),
  );
  return new Map(
    (read?.projects ?? [])
      .filter(({ project }) => projects.includes(project))
      .map(({ project, waiting }) => [project, waiting]),
  );
}

/** The sum of what `counted` names. */
function waitingSum(counted: ReadonlyMap<ProjectId, number>): number {
  return [...counted.values()].reduce((sum, each) => sum + each, 0);
}

/** Whether `identity` is the only runner its owner holds in its tenant. */
async function runnerAlone(identity: PersonalRunnerIdentity): Promise<boolean> {
  const [row] = (await rig.harness.query(
    `SELECT count(*)::int AS held FROM personal_runner WHERE tenant=$1 AND owner=$2`,
    [identity.tenant, identity.owner],
  )) as readonly { held: number }[];
  return row?.held === 1;
}

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
    if (!runnerOwned(other.pool) && other.pool.agentsAdvertised)
      return "a project's pool beside the case's advertises no agents";
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
  if (!runnerOwned(c.pool))
    return c.pool.class === "Personal"
      ? "a personal pool owning nothing is no member's runner, and the plane admits no other"
      : "the pool plane refuses a pool's poll, so only a member's runner claims";
  if (c.pool.revoked)
    return "a member's permit and Read are the authority's, asked before any claim";
  const policy = policyUnplanted(c.pool);
  if (policy.length > 0)
    return `a member's runner has no column for ${policy.join(", ")}, which every pool holds as registered`;
  const reason = runnerUnplanted(
    { pool: c.pool, session: c.session },
    c.placement.partition,
  );
  if (reason !== undefined) return reason;
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
 * registration copies it out, on the capacity `capacity` names beside the
 * harness's own.
 */
async function releasedUnder(
  label: string,
  requirement: ExecutionRequirement,
  tasks: number,
  resources?: TaskResources,
  partition?: Partition,
  capacity: Omit<SchedulerCapacity, "tasks"> = {},
): Promise<SchedulerProject> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks, ...capacity },
    undefined,
    partition,
  );
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

/** An invocation whose worker spends each agent, Claude by the bare arguments that predate modes too, or none where it runs commands. */
const spending = {
  Claude: {
    ...schedulerInvocation,
    worker: {
      mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
      setup: [],
      files: [],
    },
  },
  Codex: {
    ...schedulerInvocation,
    worker: {
      mode: {
        type: "SingleAgent",
        agent: "Codex",
        arguments: [],
        model: "model",
      },
      setup: [],
      files: [],
    },
  },
  BareArguments: {
    ...schedulerInvocation,
    worker: { arguments: ["--verbose"], setup: [], files: [] },
  },
  Commands: {
    ...schedulerInvocation,
    worker: {
      mode: { type: "Commands", commands: ["just check"] },
      setup: [],
      files: [],
    },
  },
} as const satisfies Record<string, WorkTaskInvocation>;

/** The invocation an attempt running `agent` is invoked with, or one running commands where it runs none. */
function invocationRunning(
  agent: AccountAgent | undefined,
): WorkTaskInvocation {
  return agent === undefined ? spending.Commands : spending[agent];
}

/** The next execution admitted and opened as an attempt, invoked with `invocation` unless that is null, marked for a pool unless `inCluster`, and owned as `owned` says. */
async function opened(
  project: SchedulerProject,
  inCluster = false,
  owned: Owned = unowned,
  invocation: WorkTaskInvocation | null = schedulerInvocation,
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
  if (
    invocation !== null &&
    !(await rig.store.attemptInvoked(attempt.attempt, invocation))
  )
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
): Promise<void> {
  await projectPlanted(partition, home);
  assert.equal(
    await registry.register({
      partition,
      pool,
      capabilities,
      class: policy.class,
      clientId: `chuggy-pool-${randomUUID()}`,
      principal,
    }),
    true,
  );
}

/** A member's runner as its row and allowlist, polled `polledSecsAgo` before now where it is `live` and never otherwise, under the ceiling it names. */
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
    pool.memoryCeilingMib,
    pool.agentsAdvertised,
  );
  return identity;
}

/** A runner's row and the projects it is allowed into, polled `polledSecsAgo` before now where that is named and never otherwise, under `memoryCeilingMib` where that is named, and advertising its agents where `agentsAdvertised` says so. */
async function plantedRunnerRows(
  identity: PersonalPlaneIdentity,
  capabilities: readonly string[],
  polledSecsAgo: number | undefined,
  allowlist: readonly ProjectId[],
  memoryCeilingMib?: number,
  agentsAdvertised = false,
): Promise<void> {
  await rig.harness.query(
    `INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id,executions_polled_at,memory_ceiling_mib,agents_advertised)
      VALUES($1,$2,$3,$4,$5,
        CASE WHEN $6::boolean THEN now()-make_interval(secs=>$7::double precision) END,$8,$9)`,
    [
      identity.tenant,
      identity.owner,
      capabilities,
      identity.principal,
      `chuggy-personal-${randomUUID()}`,
      polledSecsAgo !== undefined,
      polledSecsAgo ?? 0,
      memoryCeilingMib ?? null,
      agentsAdvertised,
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

/** Whether the claim `takes` would make on these terms would take anything in `home`, asked of the probe that takes nothing. */
function waiting(
  identity: PersonalPlaneIdentity,
  terms: WorkerPoolClaimTerms,
  home: Partition | undefined,
): Promise<boolean> {
  return assignments.waitingPersonal(
    identity,
    terms,
    home === undefined ? [] : [home.project],
  );
}

/**
 * Whether a runner claims the oldest placeable attempt it may in `home`,
 * under `assignment` and within `memoryRoomMib` where it is named; the probe
 * is asked first, and answers what the claim then does.
 */
async function takes(
  identity: PersonalPlaneIdentity,
  home?: Partition,
  assignment = `assignment-${randomUUID()}`,
  memoryRoomMib?: number,
): Promise<boolean> {
  return takesAmong(
    identity,
    home === undefined ? [] : [home.project],
    assignment,
    memoryRoomMib,
  );
}

/**
 * Whether a runner claims an attempt across `projects`, under `assignment`
 * and within `memoryRoomMib` where it is named, the probe asked first and held
 * to the claim's answer. Where it names no room, its owner's count of what
 * waits is held to the claim too: something waits where the owner's only
 * runner takes something, and what it takes was counted.
 */
async function takesAmong(
  identity: PersonalPlaneIdentity,
  projects: readonly ProjectId[],
  assignment: string,
  memoryRoomMib?: number,
): Promise<boolean> {
  const terms: WorkerPoolClaimTerms = {
    leaseSecs,
    heldMax: Number.MAX_SAFE_INTEGER,
    memoryMibDefault,
    ...(memoryRoomMib === undefined ? {} : { memoryRoomMib }),
  };
  const asked = await assignments.waitingPersonal(identity, terms, projects);
  const counting = memoryRoomMib === undefined;
  const before = counting
    ? await waitingCounted(identity, projects)
    : new Map<ProjectId, number>();
  const claimed = await assignments.claimPersonal(
    identity,
    terms,
    assignment,
    `bearer-${randomUUID()}`,
    projects,
  );
  assert.equal(asked, claimed !== undefined, "the probe answers the claim");
  if (!counting) return claimed !== undefined;
  if (claimed !== undefined) {
    const after = await waitingCounted(identity, projects);
    assert.ok(
      (after.get(claimed.project) ?? 0) < (before.get(claimed.project) ?? 0),
      "what a runner takes was counted waiting",
    );
  }
  if (await runnerAlone(identity))
    assert.equal(
      waitingSum(before) > 0,
      claimed !== undefined,
      "something waits where the owner's only runner takes something",
    );
  return claimed !== undefined;
}

/** Claims the oldest placeable attempt in `home` for a runner that must get one. */
async function claimedBy(
  identity: PersonalPlaneIdentity,
  assignment: string,
  home?: Partition,
) {
  if (!(await takes(identity, home, assignment)))
    throw new Error("worker pool claim suite: a planted claim took nothing");
}

/** Plants `attempt` as claimed under `assignment` by a runner of an owner no case names, holding its lease, as a claim writes it. */
async function claimPlanted(
  attempt: string,
  assignment: string,
): Promise<void> {
  const owner = `https://issuer.invalid#claimant-${randomUUID()}`;
  await rig.harness.query(
    `UPDATE execution_attempt SET pool=$2,pool_principal=$3,personal=true,
        assignment=$4,lease_owner=$2,
        lease_expires_at=now()+make_interval(secs=>$5::double precision),
        claimed_at=now()
      WHERE attempt=$1`,
    [attempt, owner, `${owner}-runner`, assignment, leaseSecs],
  );
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

/** One pool beside the case's as the case registers it, or a member's runner where it has an owner. */
async function plantedBeside(
  named: Planted,
  { pool, session }: WorkerPoolEnrolment,
  polledSecsAgo: number,
): Promise<void> {
  if (runnerOwned(pool)) {
    await plantedRunner(
      named,
      pool,
      session?.leaseOpen === true,
      polledSecsAgo,
    );
    return;
  }
  await registeredPool(
    named.partition(pool.partition),
    pool.pool,
    named.principal(pool.principal),
    pool.capabilities,
    pool,
    named.project.partition,
  );
}

/** The case's runner as planted, and every pool beside it. */
async function plantedPools(
  c: RunnerCase,
  named: Planted,
  polledSecsAgo: number,
): Promise<PersonalPlaneIdentity> {
  const runner = await plantedRunner(
    named,
    c.pool,
    c.session?.leaseOpen === true,
    polledSecsAgo,
  );
  for (const beside of c.others)
    await plantedBeside(named, beside, polledSecsAgo);
  return runner;
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

/** The case's attempt, opened after the slots its runner holds and the identity already bound, and placed as the case says. */
async function plantedTarget(
  c: RunnerCase,
  held: number,
  named: Planted,
  runner: PersonalPlaneIdentity,
): Promise<{ execution: string; attempt: string }> {
  const home = named.project.partition;
  const owned = ownedAs(c, named);
  for (let slot = 0; slot < held; slot++) {
    await opened(named.project, false, owned);
    await claimedBy(runner, `held-${randomUUID()}`, home);
  }
  if (c.assignmentsBound.includes(runnerCaseAssignment))
    await claimPlanted((await opened(named.project)).attempt, named.assignment);
  const target = await opened(
    named.project,
    c.placement.route === "InCluster",
    owned,
    invocationRunning(c.placement.agent),
  );
  if (c.placement.phase === "Assigned")
    await claimPlanted(target.attempt, `assigned-${randomUUID()}`);
  if (c.placement.status !== "Launching")
    await statusPlanted(home, target.execution, c.placement.status);
  return target;
}

/** The case's claim, asked under its session; an identity already bound fails the statement, and that binds nothing. */
async function claimAsked(
  identity: PersonalPlaneIdentity,
  heldMax: number,
  assignment: string,
  home: Partition,
): Promise<unknown> {
  const terms = { leaseSecs, heldMax, memoryMibDefault };
  try {
    return await assignments.claimPersonal(
      identity,
      terms,
      assignment,
      `bearer-${randomUUID()}`,
      [home.project],
    );
  } catch (error) {
    if ((error as { code?: unknown }).code !== "23505") throw error;
    return undefined;
  }
}

/** That the owner counts something waiting in `home` exactly where their runner's registration could take it, its slots aside, as the probe held to the claim answers. */
async function waitingCountedProbed(
  runner: PersonalPlaneIdentity,
  home: Partition,
): Promise<void> {
  assert.equal(
    ((await waitingCounted(runner, [home.project])).get(home.project) ?? 0) > 0,
    await assignments.waitingPersonal(
      runner,
      { leaseSecs, heldMax: Number.MAX_SAFE_INTEGER, memoryMibDefault },
      [home.project],
    ),
    "the owner counts waiting what their runner's registration could take with its slots aside",
  );
}

/** Whether the case's run waits on a live runner of its owner's offered its agent, by the model's terms and a poll `polledSecsAgo` before now. */
function waitsOnLive(c: RunnerCase, polledSecsAgo: number): boolean {
  const { placement } = c;
  const registry = [{ pool: c.pool, session: c.session }, ...c.others];
  return (
    placement.route === "Pool" &&
    placement.status === "Launching" &&
    placement.phase === "Waiting" &&
    polledSecsAgo < sessionRunnerPolledSecsMax &&
    workerPoolOwnerPools(placement, registry).some(
      (owner) =>
        workerPoolIsLive(owner) &&
        workerPoolAgentOffered(placement, owner.pool),
    )
  );
}

/**
 * That the owner's read of the case's run says it waits on their live runners
 * exactly where the model has a live runner of theirs offered its agent. A
 * runner's row keeps no poll made under a principal registered over, nor
 * knows a permit the case revokes.
 */
async function runnerWaitRead(
  c: RunnerCase,
  named: Planted,
  execution: string,
  polledSecsAgo: number,
): Promise<void> {
  const owner = c.placement.demand.ownerOf;
  if (owner === undefined) return;
  const registry = [{ pool: c.pool, session: c.session }, ...c.others];
  if (
    registry.some(
      ({ pool, session }) =>
        pool.revoked ||
        (runnerOwned(pool) &&
          session !== undefined &&
          session.principal !== pool.principal),
    )
  )
    return;
  const read = await operationalReads.execution(
    named.project.partition,
    asExecutionId(execution),
    named.principal(owner),
  );
  assert.equal(
    read?.personalRunnerWait === "Live",
    waitsOnLive(c, polledSecsAgo),
    "the owner's run waits on their live runners where the model has one offered its agent",
  );
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
    await releasedUnder(label, c.placement.requirement, bystanders + 1, {
      memoryMib: c.placement.memoryMib,
    }),
  );
  const runner = await plantedPools(c, named, polledSecsAgo);
  const target = await plantedTarget(c, session.held, named, runner);
  const home = named.project.partition;
  await runnerWaitRead(c, named, target.execution, polledSecsAgo);
  await waitingCountedProbed(runner, home);
  const identity = { ...runner, principal: named.principal(session.principal) };
  const asked = await waiting(
    identity,
    { leaseSecs, heldMax: session.heldMax, memoryMibDefault },
    home,
  );
  const claimed = await claimAsked(
    identity,
    session.heldMax,
    named.assignment,
    home,
  );
  const [bound] = (await rig.harness.query(
    `SELECT pool, assignment FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [home.tenant, home.project, target.attempt],
  )) as readonly { pool: string | null; assignment: string | null }[];
  const took =
    bound?.pool === identity.owner && bound.assignment === named.assignment;
  assert.equal(
    claimed !== undefined,
    took,
    "a claim answers what it bound, and binds what it answers",
  );
  assert.equal(
    asked,
    c.assignmentsBound.includes(runnerCaseAssignment)
      ? workerPoolCanAssign(
          c.placement,
          { pool: c.pool, session },
          [{ pool: c.pool, session }, ...c.others],
          runnerCaseAssignment,
          new Set(),
        )
      : took,
    "the probe answers what the claim takes, an assignment's name aside",
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

const pinnedImage = `registry.invalid/pinned-worker@sha256:${"b".repeat(64)}`;

const pinned: ExecutionRequirement = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Amd64",
  image: pinnedImage,
};

/** An owner's runner for `project` alone, live and declaring all `pinned` asks, under `memoryCeilingMib` where it is named. */
async function ownersRunner(
  project: SchedulerProject,
  label: string,
  memoryCeilingMib?: number,
): Promise<PersonalPlaneIdentity> {
  const runner: PersonalPlaneIdentity = {
    kind: "Personal",
    tenant: project.partition.tenant,
    owner: asPrincipal(`https://issuer.invalid#${label}-owner-${randomUUID()}`),
    principal: asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`),
  };
  await plantedRunnerRows(
    runner,
    declaringAll(pinned),
    0,
    [project.partition.project],
    memoryCeilingMib,
  );
  return runner;
}

test("a runner that reports holding nothing is held to what the database says it holds", async () => {
  const project = await releasedUnder("claim-under-report", pinned, 2);
  const runner = await ownersRunner(project, "under-report");
  const strict = { owner: runner.owner, fallback: "Strict" };
  await opened(project, false, strict);
  await claimedBy(runner, `held-${randomUUID()}`, project.partition);
  await opened(project, false, strict);
  const ports = pollingRead(() => randomUUID());
  const underReported = await workerPoolReconcile(
    ports,
    runner,
    { jobs: [], sessions: [] },
    { wanted: 1, wantedSessions: 0 },
    settings,
  );
  assert.deepEqual(underReported.assignments, []);
  const roomier = await workerPoolReconcile(
    ports,
    runner,
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

/**
 * The first claim is held open at its commit, so the second is made while the
 * first's attempt is claimed and not yet committed: it waits on the owner's
 * lock and then counts that attempt, where without the lock it would count
 * nothing and take the other.
 */
test("a claim made while the same runner's last is still open waits for it and counts it", async () => {
  const project = await releasedUnder("claim-racing", pinned, 2);
  const runner = await ownersRunner(project, "racing");
  const strict = { owner: runner.owner, fallback: "Strict" };
  await opened(project, false, strict);
  await opened(project, false, strict);
  const terms = { leaseSecs, heldMax: 1, memoryMibDefault };
  const projects = [project.partition.project];
  let reach = (): void => undefined;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const first = postgresWorkerPoolAssignments(
    postgresHarnessHeldAtCommit(planePool, reach, gate),
  ).claimPersonal(
    runner,
    terms,
    `first-${randomUUID()}`,
    `bearer-${randomUUID()}`,
    projects,
  );
  await reached;
  let settled = false;
  const second = assignments
    .claimPersonal(
      runner,
      terms,
      `second-${randomUUID()}`,
      `bearer-${randomUUID()}`,
      projects,
    )
    .finally(() => (settled = true));
  while (!settled && !(await postgresHarnessAdvisoryWaiting(rig.harness)))
    await delay(10);
  open();
  assert.deepEqual(
    (await Promise.all([first, second])).map((taken) => taken !== undefined),
    [true, false],
  );
});

/** The one assignment an owner's runner's poll is handed for a project released under `requirement`, sized as `resources` names. */
async function handedOut(
  label: string,
  requirement: ExecutionRequirement,
  resources?: TaskResources,
): Promise<WorkerPoolAssignment> {
  const project = await releasedUnder(label, requirement, 1, resources);
  const runner: PersonalPlaneIdentity = {
    kind: "Personal",
    tenant: project.partition.tenant,
    owner: asPrincipal(`https://issuer.invalid#${label}-owner-${randomUUID()}`),
    principal: asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`),
  };
  await plantedRunnerRows(runner, declaringAll(requirement), 0, [
    project.partition.project,
  ]);
  await opened(project, false, { owner: runner.owner, fallback: "Strict" });
  const answered = await workerPoolReconcile(
    pollingRead(() => randomUUID()),
    runner,
    { jobs: [], sessions: [] },
    { wanted: 1, wantedSessions: 0 },
    settings,
  );
  const [assignment] = answered.assignments;
  if (assignment === undefined) throw new Error(`${label} was handed nothing`);
  return assignment;
}

test("an execution naming no memory meets a ceiling at the plane's size for it", async () => {
  for (const [ceiling, fits] of [
    [memoryMibDefault, true],
    [memoryMibDefault - 1, false],
  ] as const) {
    const label = `claim-unsized-${String(ceiling)}`;
    const owned = await releasedUnder(label, pinned, 1);
    const runner = await ownersRunner(owned, label, ceiling);
    await opened(owned, false, { owner: runner.owner, fallback: "Strict" });
    assert.equal(
      await takes(runner, owned.partition),
      fits,
      `a runner under ${String(ceiling)}`,
    );
  }
});

test("a claim takes no job larger than the room its poll named, a job naming no memory at the plane's size", async () => {
  for (const [memoryMib, room, fits] of [
    [4_096, 4_096, true],
    [4_096, 4_095, false],
    [4_096, undefined, true],
    [undefined, memoryMibDefault, true],
    [undefined, memoryMibDefault - 1, false],
  ] as const) {
    const label = `claim-room-${String(memoryMib)}-${String(room)}`;
    const resources = memoryMib === undefined ? undefined : { memoryMib };
    const owned = await releasedUnder(label, pinned, 1, resources);
    const runner = await ownersRunner(owned, label);
    await opened(owned, false, { owner: runner.owner, fallback: "Strict" });
    assert.equal(
      await takes(runner, owned.partition, undefined, room),
      fits,
      label,
    );
  }
});

test("a poll's claims together fit the room it named, and it is told whether one more it fits is waiting under its ceiling", async () => {
  const label = "claim-room-poll";
  const project = await releasedUnder(label, pinned, 3, { memoryMib: 3_000 });
  const runner = await ownersRunner(project, label);
  for (let opening = 0; opening < 3; opening += 1)
    await opened(project, false, { owner: runner.owner, fallback: "Strict" });
  const runners = postgresWorkerPoolRunners(planePool);
  const poll = (wanted: number, memoryRoomMib: number) =>
    workerPoolReconcile(
      pollingRead(() => randomUUID()),
      runner,
      { jobs: [], sessions: [] },
      {
        wanted,
        wantedSessions: 0,
        memoryRoomMib,
        contract: workerContractPeerNaming(workerContractRelease),
      },
      { ...settings, heldMax: 4 },
    );
  const first = await poll(2, 4_096);
  assert.deepEqual(
    first.assignments.map((taken) => taken.memoryMib),
    [3_000],
  );
  assert.equal(first.jobsWaiting, false, "the room the first claim left");
  assert.equal((await poll(0, 3_000)).jobsWaiting, true, "a room it fits");
  assert.equal((await poll(0, 2_999)).jobsWaiting, false, "a room too small");
  await runners.named(runner, undefined, undefined, 2_048);
  assert.equal((await poll(0, 8_192)).jobsWaiting, false, "a ceiling below");
  await runners.named(runner, undefined, undefined, 3_000);
  assert.equal((await poll(0, 8_192)).jobsWaiting, true, "a ceiling at");
  const last = await poll(2, 6_000);
  assert.deepEqual(
    last.assignments.map((taken) => taken.memoryMib),
    [3_000, 3_000],
  );
  assert.equal(last.jobsWaiting, false, "nothing left to claim");
});

test("a job naming no memory is claimed at 2,048 MiB where the plane names no size of its own, and one naming 4,096 MiB at 4,096 as before", async () => {
  for (const [resources, sized] of [
    [undefined, 2_048],
    [{ memoryMib: 4_096 }, 4_096],
  ] as const) {
    const label = `claim-default-${String(sized)}`;
    const project = await releasedUnder(label, pinned, 1, resources);
    const runner = await ownersRunner(project, label);
    await opened(project, false, { owner: runner.owner, fallback: "Strict" });
    const polled = await workerPoolReconcile(
      pollingRead(() => randomUUID()),
      runner,
      { jobs: [], sessions: [] },
      {
        wanted: 1,
        wantedSessions: 0,
        memoryRoomMib: 8_192,
        contract: workerContractPeerNaming(workerContractRelease),
      },
      { ...settings, memoryMib: workerPoolMemoryMibDefault },
    );
    assert.deepEqual(
      polled.assignments.map((taken) => taken.memoryMib),
      [sized],
      label,
    );
  }
});

test("a claim or a probe whose size is no positive count, or whose room is no count, is refused before anything is asked", async () => {
  const partition = { tenant: "terms", project: "terms" } as Partition;
  const runner: PersonalPlaneIdentity = {
    kind: "Personal",
    tenant: partition.tenant,
    owner: asPrincipal("https://issuer.invalid#terms-owner"),
    principal: asPrincipal("https://issuer.invalid#terms-runner"),
  };
  for (const [over, refusal] of [
    [{ memoryMibDefault: 0 }, /invalid worker pool memory default/u],
    [{ memoryRoomMib: -1 }, /invalid worker pool memory room/u],
    [{ memoryRoomMib: 1.5 }, /invalid worker pool memory room/u],
  ] as const) {
    const terms = { leaseSecs, heldMax: 1, memoryMibDefault, ...over };
    for (const asked of [
      () =>
        assignments.claimPersonal(runner, terms, "terms", "terms", [
          partition.project,
        ]),
      () => assignments.waitingPersonal(runner, terms, [partition.project]),
    ])
      await assert.rejects(asked, refusal, JSON.stringify(over));
  }
});

test("a claim and its probe take nothing of a project that is not Active, nor an attempt a newer recovery epoch superseded", async () => {
  const label = "claim-fenced";
  const owned = await releasedUnder(label, pinned, 2);
  const runner = await ownersRunner(owned, label);
  for (let opening = 0; opening < 2; opening += 1)
    await opened(owned, false, { owner: runner.owner, fallback: "Strict" });
  for (const [lifecycle, taken] of [
    ["Suspended", false],
    ["Active", true],
  ] as const) {
    await rig.harness.query(
      `UPDATE project SET lifecycle=$3, lifecycle_generation=lifecycle_generation+1
        WHERE tenant=$1 AND project=$2`,
      [owned.partition.tenant, owned.partition.project, lifecycle],
    );
    assert.equal(
      await takes(runner, owned.partition),
      taken,
      `a project ${lifecycle}`,
    );
  }
  await rig.harness.store.establishRecoveryEpoch(
    asRecoveryEpoch(`epoch-${label}-${randomUUID()}`),
  );
  assert.equal(
    await takes(runner, owned.partition),
    false,
    "an attempt under a superseded epoch",
  );
});

/** Ends an attempt as a lapse ends one no runner claimed: withdrawn, holding no lease. */
async function withdrawnUnclaimed(attempt: string): Promise<void> {
  await rig.harness.query(
    `UPDATE execution_attempt SET state='Withdrawn', evidence='PlacementUnavailable',
        ended_at=now(), lease_owner=NULL, lease_expires_at=NULL
      WHERE attempt=$1`,
    [attempt],
  );
}

/** A case's project, its owner's runner in it, and the ownership its jobs are opened under. */
interface RunnerPlanted {
  readonly project: SchedulerProject;
  readonly runner: PersonalPlaneIdentity;
  readonly owned: Owned;
}

/** Asks the claim as the case's runner, of the case's project. */
function runnerAsked({ runner, project }: RunnerPlanted): Promise<boolean> {
  return takes(runner, project.partition);
}

/** Opens the case project's next job as its runner's owner's. */
function runnerOpened({
  project,
  owned,
}: RunnerPlanted): Promise<{ execution: string; attempt: string }> {
  return opened(project, false, owned);
}

/** Each way an owner's runner is asked for a job it may not take: a label, what its project is released under, and how its job is opened and the claim asked. */
const runnerTakesNothing: readonly (readonly [
  string,
  ExecutionRequirement,
  (planted: RunnerPlanted) => Promise<boolean>,
])[] = [
  [
    "unlike",
    { ...pinned, architecture: "Arm64" },
    async (planted) => {
      await runnerOpened(planted);
      return runnerAsked(planted);
    },
  ],
  [
    "in-cluster",
    pinned,
    async (planted) => {
      const { project, owned } = planted;
      const target = await opened(project);
      await rig.harness.query(
        `UPDATE execution SET placement='InCluster',owner=$4,owner_fallback=$5
          WHERE tenant=$1 AND project=$2 AND execution=$3`,
        [
          project.partition.tenant,
          project.partition.project,
          target.execution,
          owned.owner,
          owned.fallback,
        ],
      );
      return runnerAsked(planted);
    },
  ],
  [
    "admitted",
    pinned,
    async (planted) => {
      const target = await runnerOpened(planted);
      await statusPlanted(
        planted.project.partition,
        target.execution,
        "Admitted",
      );
      return runnerAsked(planted);
    },
  ],
  [
    "withdrawn",
    pinned,
    async (planted) => {
      await withdrawnUnclaimed((await runnerOpened(planted)).attempt);
      return runnerAsked(planted);
    },
  ],
  [
    "claimed",
    pinned,
    async (planted) => {
      await runnerOpened(planted);
      await claimedBy(
        planted.runner,
        `claimed-${randomUUID()}`,
        planted.project.partition,
      );
      return runnerAsked(planted);
    },
  ],
  [
    "uninvoked",
    pinned,
    async (planted) => {
      await opened(planted.project, false, planted.owned, null);
      return runnerAsked(planted);
    },
  ],
  [
    "another-owner",
    pinned,
    async (planted) => {
      await runnerOpened(planted);
      return takes(
        {
          ...planted.runner,
          owner: asPrincipal(`https://issuer.invalid#other-${randomUUID()}`),
        },
        planted.project.partition,
      );
    },
  ],
  [
    "another-tenant",
    pinned,
    async (planted) => {
      await runnerOpened(planted);
      return takes(
        { ...planted.runner, tenant: asTenantId(`other-${randomUUID()}`) },
        planted.project.partition,
      );
    },
  ],
  [
    "no-project",
    pinned,
    async (planted) => {
      await runnerOpened(planted);
      return takes(planted.runner);
    },
  ],
];

test("an owner's runner's claim and its probe take nothing it cannot run, routed in the cluster, not launching, withdrawn, claimed or not yet invoked, nor for a runner named under another owner or tenant or asking of no project", async () => {
  const label = "probe-runner";
  for (const [why, requirement, arranged] of runnerTakesNothing) {
    const project = await releasedUnder(`${label}-${why}`, requirement, 2);
    const runner = await ownersRunner(project, `${label}-${why}`);
    const owned = { owner: runner.owner, fallback: "Strict" };
    assert.equal(await arranged({ project, runner, owned }), false, why);
  }
});

test("an assignment names the image its requirement pinned, claimed out of the database", async () => {
  const assignment = await handedOut("claim-pinned-image", pinned);
  assert.equal(assignment.image, pinnedImage);
});

test("an execution released with no size is claimed on the plane's box", async () => {
  const assignment = await handedOut("claim-unsized", pinned);
  assert.deepEqual(
    [assignment.cpuMillis, assignment.memoryMib],
    [settings.cpuMillis, settings.memoryMib],
  );
});

test("an execution released with a size is claimed asking for it", async () => {
  const assignment = await handedOut("claim-sized", pinned, {
    cpuMillis: 2_000,
    memoryMib: 1_024,
  });
  assert.deepEqual(
    [assignment.cpuMillis, assignment.memoryMib],
    [2_000, 1_024],
  );
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

test("a capability requirement's assignment names no image", async () => {
  const assignment = await handedOut("claim-site-image", {
    mode: "Capability",
    operatingSystem: "Linux",
    architecture: "Amd64",
    capabilities: ["Agent:Claude"],
  });
  assert.equal("image" in assignment, false);
});

/** A limit whose reset is ahead, which pauses an agent until a reading after it or a press. */
const limited: AgentAccountHarnessState = {
  limit: { observedSecs: -60, resetsSecs: 3600 },
};

/** `owner`'s live runner for `project` alone, declaring everything `pinned` asks. */
async function ownedRunner(
  project: SchedulerProject,
  label: string,
  owner: Principal,
): Promise<PersonalPlaneIdentity> {
  const runner: PersonalPlaneIdentity = {
    kind: "Personal",
    tenant: project.partition.tenant,
    owner,
    principal: asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`),
  };
  await plantedRunnerRows(runner, declaringAll(pinned), 0, [
    project.partition.project,
  ]);
  return runner;
}

/** The agent of the attempt `assignment` bound, or none where it bound nothing. */
async function agentClaimed(
  assignment: string,
): Promise<string | null | undefined> {
  const [row] = (await rig.harness.query(
    `SELECT agent FROM execution_attempt WHERE assignment=$1`,
    [assignment],
  )) as readonly { agent: string | null }[];
  return row?.agent;
}

/** What each of `claims` claims in turn, as the agent of what it bound, the probe asked before each and held to its answer. */
async function claimedInTurn(
  identity: PersonalPlaneIdentity,
  home: Partition,
  claims: number,
): Promise<readonly (string | null | undefined)[]> {
  const agents: (string | null | undefined)[] = [];
  for (let claim = 0; claim < claims; claim++) {
    const assignment = `paused-${randomUUID()}`;
    await takes(identity, home, assignment);
    agents.push(await agentClaimed(assignment));
  }
  return agents;
}

/** A project with an attempt spending each of Claude, Codex and commands, oldest first, owned by `owner` for their runner. */
async function spendingEach(
  label: string,
  owner: Principal,
): Promise<SchedulerProject> {
  const project = await releasedUnder(label, pinned, 3);
  const owned: Owned = { owner, fallback: "Strict" };
  for (const invocation of [spending.Claude, spending.Codex, spending.Commands])
    await opened(project, false, owned, invocation);
  return project;
}

test("a runner passes over a job of its account's paused agent and takes the other agent's and a command's, the probe answering each claim", async () => {
  const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  const label = "claim-paused-runner";
  const project = await spendingEach(label, member);
  const runner = await ownedRunner(project, label, member);
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", limited);
  assert.deepEqual(
    await claimedInTurn(runner, project.partition, 3),
    ["Codex", null, undefined],
    "Codex, then the command, then nothing",
  );
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {});
  assert.deepEqual(
    await claimedInTurn(runner, project.partition, 1),
    ["Claude"],
    "the pause lifted, its job is taken at the next claim",
  );
});

test("a press lets exactly one claim of the agent through its limit, and a second press one more", async () => {
  const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  const project = await releasedUnder("claim-pressed", pinned, 3);
  const owned = { owner: member, fallback: "Strict" };
  for (let attempt = 0; attempt < 3; attempt++)
    await opened(project, false, owned, spending.Claude);
  const runner = await ownedRunner(project, "pressed", member);
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", limited);
  assert.deepEqual(await claimedInTurn(runner, project.partition, 1), [
    undefined,
  ]);
  await agentAccountHarnessPressed(rig.harness, member, "Claude");
  assert.deepEqual(await claimedInTurn(runner, project.partition, 2), [
    "Claude",
    undefined,
  ]);
  await agentAccountHarnessPressed(rig.harness, member, "Claude");
  assert.deepEqual(await claimedInTurn(runner, project.partition, 2), [
    "Claude",
    undefined,
  ]);
});

test("a press lets no claim through a threshold its account is over", async () => {
  const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  const project = await releasedUnder("claim-pressed-soft", pinned, 1);
  await opened(
    project,
    false,
    { owner: member, fallback: "Strict" },
    spending.Claude,
  );
  const runner = await ownedRunner(project, "pressed-soft", member);
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    readings: [
      {
        window: "five_hour",
        utilization: 0.95,
        resetsSecs: 3600,
        observedSecs: -120,
      },
    ],
    ...limited,
  });
  await agentAccountHarnessPressed(rig.harness, member, "Claude");
  assert.equal(await takes(runner, project.partition), false);
});

/** `runner` as its poll names `agents` among its capabilities beside `pinned`'s platform, advertising them as the agents it takes where `advertised` says so. */
async function runnerAdvertised(
  runner: PersonalPlaneIdentity,
  agents: readonly string[],
  advertised: boolean,
): Promise<void> {
  await postgresWorkerPoolRunners(planePool).named(
    runner,
    undefined,
    [workerPoolPlatformToken(pinned), ...agents],
    undefined,
    advertised,
  );
}

/** A member's live runner of `project`, naming `pinned`'s platform alone until a poll names more. */
async function advertisingRunner(
  project: SchedulerProject,
  label: string,
  member: Principal,
): Promise<PersonalPlaneIdentity> {
  const runner: PersonalPlaneIdentity = {
    kind: "Personal",
    tenant: project.partition.tenant,
    owner: member,
    principal: asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`),
  };
  await plantedRunnerRows(runner, [workerPoolPlatformToken(pinned)], 0, [
    project.partition.project,
  ]);
  return runner;
}

for (const [why, agents, advertised, taken] of [
  [
    "advertising Codex alone takes Codex's job and the command's",
    ["Agent:Codex"],
    true,
    ["Codex", null, undefined],
  ],
  [
    "advertising no agent takes the command's job alone",
    [],
    true,
    [null, undefined],
  ],
  [
    "advertising both agents takes every job",
    ["Agent:Claude", "Agent:Codex"],
    true,
    ["Claude", "Codex", null, "Claude", undefined],
  ],
  [
    "of an earlier release naming Codex alone takes every job",
    ["Agent:Codex"],
    false,
    ["Claude", "Codex", null, "Claude", undefined],
  ],
] as const)
  test(`a runner ${why}, a job of bare arguments being Claude's, the probe answering each claim`, async () => {
    const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
    const label = `claim-agents-${randomUUID().slice(0, 8)}`;
    const project = await releasedUnder(label, pinned, 4);
    for (const invocation of [
      spending.Claude,
      spending.Codex,
      spending.Commands,
      spending.BareArguments,
    ])
      await opened(
        project,
        false,
        { owner: member, fallback: "Strict" },
        invocation,
      );
    const runner = await advertisingRunner(project, label, member);
    await runnerAdvertised(runner, agents, advertised);
    assert.deepEqual(
      await claimedInTurn(runner, project.partition, taken.length),
      taken,
    );
  });

test("every poll writes afresh whether its runner advertises its agents, so a runner moved back to an earlier release is read as one", async () => {
  const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  const project = await releasedUnder("claim-agents-moved", pinned, 1);
  await opened(
    project,
    false,
    { owner: member, fallback: "Strict" },
    spending.Claude,
  );
  const runner = await advertisingRunner(project, "claim-agents-moved", member);
  const kept = async () =>
    (
      (await rig.harness.query(
        `SELECT agents_advertised FROM personal_runner WHERE principal=$1`,
        [runner.principal],
      )) as readonly { agents_advertised: boolean }[]
    ).map((row) => row.agents_advertised);
  await runnerAdvertised(runner, ["Agent:Codex"], true);
  assert.deepEqual(await kept(), [true]);
  assert.equal(await takes(runner, project.partition), false);
  await runnerAdvertised(runner, ["Agent:Codex"], false);
  assert.deepEqual(await kept(), [false]);
  assert.equal(await takes(runner, project.partition), true);
});

/** `claimant`'s poll as it names `credentials`, a runner's capabilities and its advertising as `capabilities` and `advertised` say, or left as they are where it names none. */
async function credentialsNamed(
  claimant: PersonalPlaneIdentity,
  credentials: WorkerRunnerCredentials,
  capabilities?: readonly string[],
  advertised = false,
): Promise<void> {
  await postgresWorkerPoolRunners(planePool).named(
    claimant,
    undefined,
    capabilities,
    undefined,
    advertised,
    credentials,
  );
}

/** The credentials `claimant`'s row keeps, as its newest poll named them. */
async function credentialsKept(
  claimant: PersonalPlaneIdentity,
): Promise<unknown> {
  const [row] = (await rig.harness.query(
    `SELECT credentials_named FROM personal_runner WHERE principal=$1`,
    [claimant.principal],
  )) as readonly { credentials_named: unknown }[];
  return row?.credentials_named;
}

/**
 * A project with Claude attempts of `member`'s, `Strict`, and their live
 * runner of it naming `credentials` of Claude on their account.
 */
async function namingRunner(
  label: string,
  member: Principal,
  credentials: WorkerRunnerCredentials,
  attempts = 1,
): Promise<{
  readonly project: SchedulerProject;
  readonly claimant: PersonalPlaneIdentity;
}> {
  const project = await releasedUnder(label, pinned, attempts);
  for (let attempt = 0; attempt < attempts; attempt++)
    await opened(
      project,
      false,
      { owner: member, fallback: "Strict" },
      spending.Claude,
    );
  const claimant = await ownedRunner(project, label, member);
  await credentialsNamed(claimant, credentials);
  return { project, claimant };
}

/** A limit of `credential` whose reset is `resetsSecs` ahead, arrived a minute ago. */
function limitOf(
  credential: string,
  resetsSecs = 3600,
): AgentAccountHarnessLimit {
  return { observedSecs: -60, resetsSecs, credential };
}

/** Whether `member`'s press of Claude is still unspent. */
async function pressUnspent(member: Principal): Promise<boolean> {
  const [row] = (await rig.harness.query(
    `SELECT spent_at IS NULL AS unspent FROM agent_account_press
      WHERE principal=$1 AND agent='Claude'`,
    [member],
  )) as readonly { unspent: boolean }[];
  return row?.unspent === true;
}

test("a personal runner naming two credentials takes a job while one is paused and the other is free, or never reported", async () => {
  for (const [why, readings] of [
    [
      "the other reported under its threshold",
      [
        {
          window: "five_hour",
          utilization: 0.1,
          resetsSecs: 1800,
          observedSecs: -30,
          credential: "home",
        },
      ],
    ],
    ["the other never reported", []],
  ] as const) {
    const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
    const { project, claimant } = await namingRunner(
      `claim-named-free-${readings.length}`,
      member,
      { Claude: ["work", "home"] },
    );
    await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
      readings,
      limits: [limitOf("work")],
    });
    assert.equal(await takes(claimant, project.partition), true, why);
  }
});

test("a personal runner whose every named credential is paused takes nothing, its probe and a runner's owner's count agreeing, until the earliest pause ends, and the pause names each reason once", async () => {
  const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  const { project, claimant } = await namingRunner("claim-named-held", member, {
    Claude: ["work", "home", "spare"],
  });
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    readings: [
      {
        window: "five_hour",
        utilization: 0.95,
        resetsSecs: 7200,
        observedSecs: -30,
        credential: "spare",
      },
    ],
    limits: [limitOf("work", 3600), limitOf("home", 5400)],
  });
  assert.equal(await takes(claimant, project.partition), false);
  await waitingCountedProbed(claimant, project.partition);
  const [answer] = await rig.harness.query(
    `SELECT h.reasons,h.admitted_by_press,
              h.paused_until=(SELECT min(l.resets_at) FROM agent_account_limit l
                               WHERE l.principal=$1 AND l.agent='Claude') AS earliest
         FROM ${agentAccountNamedPauseFunction}($1,'Claude',$2) h`,
    [member, ["work", "home", "spare", "work"]],
  );
  assert.deepEqual(answer, {
    reasons: ["five_hour", "limit"],
    admitted_by_press: false,
    earliest: true,
  });
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    limits: [limitOf("work", -1), limitOf("home", 5400)],
  });
  assert.equal(
    await takes(claimant, project.partition),
    true,
    "the earlier pause ended",
  );
});

test("of a personal runner's named credentials one free and one held by a limit a press came after, the claim takes the job and spends no press, and with both held by limits the press lets one through and no more", async () => {
  const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  const { project, claimant } = await namingRunner(
    "claim-named-pressed",
    member,
    { Claude: ["work", "home"] },
    3,
  );
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    limits: [limitOf("work")],
    press: { pressedSecs: 0 },
  });
  assert.equal(await takes(claimant, project.partition), true);
  assert.equal(await pressUnspent(member), true, "the free credential took it");
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    limits: [limitOf("work"), limitOf("home")],
    press: { pressedSecs: 0 },
  });
  assert.equal(await takes(claimant, project.partition), true);
  assert.equal(await pressUnspent(member), false, "the press let it through");
  assert.equal(
    await takes(claimant, project.partition),
    false,
    "the spent press lets no second claim through",
  );
});

for (const [why, credentials] of [
  ["naming none", {}],
  ["naming credentials of another agent alone", { Codex: ["work"] }],
] as readonly (readonly [string, WorkerRunnerCredentials])[])
  test(`a personal runner ${why} claims a job of an agent as its account's pause reads it`, async () => {
    const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
    const { project, claimant } = await namingRunner(
      `claim-named-none-${Object.keys(credentials).length}`,
      member,
      credentials,
    );
    await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
      limits: [limitOf("other")],
    });
    assert.equal(await takes(claimant, project.partition), false, "paused");
    await agentAccountHarnessCommitted(rig.harness, member, "Claude", {});
    assert.equal(await takes(claimant, project.partition), true, "unpaused");
  });

test("a personal runner's poll naming credentials keeps them, and one naming none after clears them", async () => {
  const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  const { claimant } = await namingRunner("claim-named-cleared", member, {
    Claude: ["work", "home"],
    Codex: ["codex"],
  });
  assert.deepEqual(await credentialsKept(claimant), {
    Claude: ["work", "home"],
    Codex: ["codex"],
  });
  await credentialsNamed(claimant, {});
  assert.equal(await credentialsKept(claimant), null);
});

test("a personal runner is answered the pause of each credential it named that is paused, and of none it did not name", async () => {
  const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  const { claimant } = await namingRunner("claim-named-answered", member, {});
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    limits: [limitOf("work"), limitOf("unnamed")],
  });
  await agentAccountHarnessCommitted(rig.harness, member, "Codex", {
    limits: [limitOf("codex", 5400)],
  });
  const [limit] = (await rig.harness.query(
    `SELECT ceil(extract(epoch FROM resets_at))::bigint::text AS until
         FROM agent_account_limit WHERE principal=$1 AND credential='work'`,
    [member],
  )) as readonly { until: string }[];
  const pauses = await assignments.credentialPauses(claimant, {
    Claude: ["work", "home"],
  });
  assert.deepEqual(pauses, [
    {
      agent: "Claude",
      credential: "work",
      pausedUntil: Number(limit?.until),
    },
  ]);
  assert.deepEqual(await assignments.credentialPauses(claimant, {}), []);
});

test("a personal runner is answered each named credential its owner turned off as paused, and waits while every one it names is off, claiming once one is on", async () => {
  const member = asPrincipal(`https://issuer.invalid#member-${randomUUID()}`);
  const { project, claimant } = await namingRunner("claim-named-off", member, {
    Claude: ["work", "home"],
  });
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    off: ["work", "home", "unnamed"],
  });
  const pauses = await assignments.credentialPauses(claimant, {
    Claude: ["work", "home"],
  });
  assert.deepEqual(
    pauses.map((pause) => [pause.agent, pause.credential]),
    [
      ["Claude", "home"],
      ["Claude", "work"],
    ],
  );
  const nowSecs = Date.now() / 1000;
  for (const pause of pauses)
    assert.ok(
      pause.pausedUntil > nowSecs + agentAccountCredentialOffSecsAt191 - 3600,
      "an off credential's pause ends past every window",
    );
  assert.equal(await takes(claimant, project.partition), false, "all off");
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    off: ["work", "unnamed"],
  });
  assert.equal(await takes(claimant, project.partition), true, "one on");
});

/** How many claims a case asking for an order makes at most, past the attempts any of them opens. */
const orderClaimsMax = 8;

/**
 * Moves an execution's registration `secsAgo` back, under `ticket` where one
 * is named: a ticket and a registration nothing writes after registering, so
 * they are written past the triggers that hold them.
 */
async function registeredAs(
  project: SchedulerProject,
  execution: string,
  secsAgo: number,
  ticket?: number,
): Promise<void> {
  const client = await rig.harness.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role=replica");
    await client.query(
      `UPDATE execution SET ticket=COALESCE($4::bigint,ticket),
          registered_at=now()-make_interval(secs=>$5::double precision)
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        execution,
        ticket ?? null,
        secsAgo,
      ],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

/** What a case planted at `index` of `list`. */
function plantedAt<Planted>(list: readonly Planted[], index: number): Planted {
  const found = list[index];
  if (found === undefined)
    throw new Error("worker pool claim suite: nothing was planted there");
  return found;
}

/** The execution an assignment bound. */
async function executionAssigned(assignment: string): Promise<string> {
  const [row] = (await rig.harness.query(
    `SELECT execution FROM execution_attempt WHERE assignment=$1`,
    [assignment],
  )) as readonly { execution: string }[];
  if (row === undefined)
    throw new Error("worker pool claim suite: an assignment bound nothing");
  return row.execution;
}

/** The executions a runner takes across `projects`, one claim after another until one takes nothing, each within `memoryRoomMib` where it is named. */
async function takenInTurn(
  identity: PersonalPlaneIdentity,
  projects: readonly SchedulerProject[],
  memoryRoomMib?: number,
): Promise<readonly string[]> {
  const taken: string[] = [];
  for (let claim = 0; claim < orderClaimsMax; claim += 1) {
    const assignment = `order-${randomUUID()}`;
    if (
      !(await takesAmong(
        identity,
        projects.map((project) => project.partition.project),
        assignment,
        memoryRoomMib,
      ))
    )
      return taken;
    taken.push(await executionAssigned(assignment));
  }
  throw new Error("worker pool claim suite: an order took more than its bound");
}

/** An owner's runner across projects of one tenant, each released with `tasks` executions sized as `resources` names and on the runner's allowlist at its priority. */
async function prioritizedRunner(
  label: string,
  priorities: readonly PersonalRunnerPriority[],
  tasks = 1,
  resources: readonly (TaskResources | undefined)[] = [],
): Promise<{
  readonly runner: PersonalPlaneIdentity;
  readonly owned: Owned;
  readonly projects: readonly SchedulerProject[];
}> {
  const home = postgresHarnessPartition(label);
  const projects: SchedulerProject[] = [];
  for (const [at, priority] of priorities.entries())
    projects.push(
      await releasedUnder(
        `${label}-${priority.toLowerCase()}`,
        pinned,
        tasks,
        resources[at],
        { tenant: home.tenant, project: asProjectId(`${home.project}-${at}`) },
      ),
    );
  const runner: PersonalPlaneIdentity = {
    kind: "Personal",
    tenant: home.tenant,
    owner: asPrincipal(`https://issuer.invalid#${label}-owner-${randomUUID()}`),
    principal: asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`),
  };
  await plantedRunnerRows(
    runner,
    declaringAll(pinned),
    0,
    projects.map((project) => project.partition.project),
  );
  for (const [at, priority] of priorities.entries())
    await rig.harness.query(
      `UPDATE personal_runner_project SET priority=$4
        WHERE tenant=$1 AND owner=$2 AND project=$3`,
      [
        runner.tenant,
        runner.owner,
        plantedAt(projects, at).partition.project,
        priority,
      ],
    );
  return {
    runner,
    owned: { owner: runner.owner, fallback: "Strict" },
    projects,
  };
}

/**
 * A ticket a runner has started: of a project's two executions, the first,
 * registered an hour back, ended without a claim, and the second opened,
 * which is its ticket's next stage.
 */
async function startedOpened(
  project: SchedulerProject,
  owned: Owned,
): Promise<string> {
  const work = await opened(project, false, owned);
  await withdrawnUnclaimed(work.attempt);
  await registeredAs(project, work.execution, 3_600);
  return (await opened(project, false, owned)).execution;
}

test("a runner takes a High project's new ticket before an older Normal one's, and a Low project's only once nothing above it could be taken", async () => {
  const { runner, owned, projects } = await prioritizedRunner("order-high", [
    "Low",
    "Normal",
    "High",
  ]);
  const opening: string[] = [];
  for (const project of projects)
    opening.push((await opened(project, false, owned)).execution);
  await registeredAs(plantedAt(projects, 0), plantedAt(opening, 0), 7_200);
  await registeredAs(plantedAt(projects, 1), plantedAt(opening, 1), 3_600);
  assert.deepEqual(await takenInTurn(runner, projects), [
    opening[2],
    opening[1],
    opening[0],
  ]);
});

test("a runner takes a smaller Low project's attempt into room a High project's waiting one does not fit, and the High one once it fits", async () => {
  const { runner, owned, projects } = await prioritizedRunner(
    "order-room",
    ["High", "Low"],
    1,
    [{ memoryMib: 4_096 }, { memoryMib: 1_024 }],
  );
  const high = (await opened(plantedAt(projects, 0), false, owned)).execution;
  const low = (await opened(plantedAt(projects, 1), false, owned)).execution;
  assert.deepEqual(await takenInTurn(runner, projects, 2_048), [low]);
  assert.deepEqual(await takenInTurn(runner, projects, 4_096), [high]);
});

test("a runner takes a started ticket's next stage before an older new ticket's Work, and a Low project's started ticket before a High project's new one", async () => {
  for (const [label, priorities] of [
    ["order-started", ["Normal", "Normal"]],
    ["order-started-low", ["High", "Low"]],
  ] as const) {
    const { runner, owned, projects } = await prioritizedRunner(
      label,
      priorities,
      2,
    );
    const fresh = (await opened(plantedAt(projects, 0), false, owned))
      .execution;
    await registeredAs(plantedAt(projects, 0), fresh, 7_200);
    const review = await startedOpened(plantedAt(projects, 1), owned);
    assert.deepEqual(
      await takenInTurn(runner, projects),
      [review, fresh],
      label,
    );
  }
});

test("an execution an earlier attempt of was claimed is started, and one whose earlier attempt was withdrawn unclaimed, as a runtime roll withdraws one, is not", async () => {
  for (const claimed of [true, false]) {
    const label = `order-reopened-${String(claimed)}`;
    const project = await releasedUnder(label, pinned, 2);
    const runner = await ownersRunner(project, label);
    const owned = { owner: runner.owner, fallback: "Strict" };
    const fresh = (await opened(project, false, owned)).execution;
    await registeredAs(project, fresh, 7_200, project.ticket + 1);
    const first = await opened(project, false, owned);
    if (claimed)
      await rig.harness.query(
        `UPDATE execution_attempt SET claimed_at=opened_at WHERE attempt=$1`,
        [first.attempt],
      );
    await withdrawnUnclaimed(first.attempt);
    const reopened = await rig.store.openAttempt({
      partition: project.partition,
      execution: asExecutionId(first.execution),
      epoch: project.epoch,
      leaseSecs,
      retriesMax: 3,
      placementBackoffSecs: 1,
      runtime: schedulerRuntime,
    });
    if (reopened.opened !== "Opened")
      throw new Error(`worker pool claim suite: ${reopened.opened}`);
    assert.equal(
      await rig.store.attemptInvoked(reopened.attempt, schedulerInvocation),
      true,
    );
    assert.deepEqual(
      await takenInTurn(runner, [project]),
      claimed ? [first.execution, fresh] : [fresh, first.execution],
      label,
    );
  }
});

/** Two runners of one owner in one project released with `tasks` executions, and the owner. */
async function contendedRunners(
  label: string,
  tasks: number,
): Promise<{
  readonly project: SchedulerProject;
  readonly busy: PersonalPlaneIdentity;
  readonly idle: PersonalPlaneIdentity;
  readonly owned: Owned;
}> {
  const project = await releasedUnder(
    label,
    pinned,
    tasks,
    undefined,
    undefined,
    { slotsMax: tasks, maximum: tasks },
  );
  const owner = asPrincipal(
    `https://issuer.invalid#${label}-owner-${randomUUID()}`,
  );
  const runner = (named: string): PersonalPlaneIdentity => ({
    kind: "Personal",
    tenant: project.partition.tenant,
    owner,
    principal: asPrincipal(
      `https://issuer.invalid#${label}-${named}-${randomUUID()}`,
    ),
  });
  const busy = runner("busy");
  const idle = runner("idle");
  await plantedRunnerRows(busy, declaringAll(pinned), 0, [
    project.partition.project,
  ]);
  await plantedRunnerRows(idle, declaringAll(pinned), 0, []);
  return { project, busy, idle, owned: { owner, fallback: "Strict" } };
}

/** What the owner's read answers of one runner, found by its principal. */
async function runnerRead(identity: PersonalRunnerIdentity) {
  const [row] = (await rig.harness.query(
    `SELECT client_id FROM personal_runner WHERE principal=$1`,
    [identity.principal],
  )) as readonly { client_id: string }[];
  const read = await personalRunners.runners(
    { tenant: identity.tenant, owner: identity.owner },
    () => Promise.resolve(true),
  );
  return read?.runners.find((runner) => runner.id === row?.client_id);
}

test("a member's read names what each runner holds, the earliest claimed first and as far as its bound, and a runner holding nothing holds none", async () => {
  const { project, busy, idle, owned } = await contendedRunners(
    "held-read",
    personalRunnerHeldAnsweredMax + 1,
  );
  for (let claim = 0; claim <= personalRunnerHeldAnsweredMax; claim += 1) {
    await opened(project, false, owned);
    assert.equal(await takes(busy, project.partition), true);
  }
  const held = await runnerRead(busy);
  assert.deepEqual(
    held?.held,
    Array.from({ length: personalRunnerHeldAnsweredMax }, (_, at) => ({
      project: project.partition.project,
      ticket: project.ticket,
      identity: {
        type: "WorkTask",
        value: { ticket: project.ticket, cycle: at + 1 },
      },
    })),
  );
  assert.equal(held?.heldTruncated, true);
  const nothing = await runnerRead(idle);
  assert.deepEqual([nothing?.held, nothing?.heldTruncated], [[], false]);
});

test("an attempt a runner no longer holds is not read as held, and the count of what waits stops at its bound and says more wait", async () => {
  const { project, busy, owned } = await contendedRunners(
    "held-ended",
    personalRunnerWaitingCountedMax + 2,
  );
  const first = await opened(project, false, owned);
  assert.equal(await takes(busy, project.partition), true);
  await withdrawnUnclaimed(first.attempt);
  assert.deepEqual((await runnerRead(busy))?.held, []);
  for (let open = 0; open <= personalRunnerWaitingCountedMax; open += 1)
    await opened(project, false, owned);
  const read = await personalRunners.runners(
    { tenant: busy.tenant, owner: busy.owner },
    () => Promise.resolve(true),
  );
  assert.deepEqual(read?.projects, [
    {
      project: project.partition.project,
      priority: "Normal",
      waiting: personalRunnerWaitingCountedMax,
      waitingTruncated: true,
    },
  ]);
});
