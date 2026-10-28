/**
 * A runner's claim of a session, against a real PostgreSQL and under the roles a
 * deployment runs: a project's pool claims its lead, a member's chat host their
 * threads and inquiries, and their personal runner their threads while they
 * register no chat host, each through the pool plane's role; the worker plane
 * serves the attempt a claim opened, and the scheduler's sweeps reach it. Each
 * case holds a project of its own, and the last restores the epoch away.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { sessionAttemptMint } from "../../src/adapters/crypto/sessionAttemptMint.ts";
import { poolJobPlaneClient } from "../../src/adapters/http/poolJobPlaneClient.ts";
import { poolPlaneClient } from "../../src/adapters/http/poolPlaneClient.ts";
import { createPoolPlaneApp } from "../../src/adapters/http/poolPlaneServer.ts";
import { poolSessionPlaneClient } from "../../src/adapters/http/poolSessionPlaneClient.ts";
import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import {
  postgresChatHostPlaneRegistry,
  postgresChatHostRegistry,
} from "../../src/adapters/postgres/chatHost.ts";
import {
  postgresPersonalRunnerPlaneRegistry,
  postgresPersonalRunnerRegistry,
} from "../../src/adapters/postgres/personalRunner.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  apiRole,
  poolPlaneRole,
  schedulerRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresSessionPlacement } from "../../src/adapters/postgres/sessionPlacement.ts";
import { postgresWorkerTasks } from "../../src/adapters/postgres/workerPlane.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
  postgresWorkerPoolRunners,
} from "../../src/adapters/postgres/workerPool.ts";
import {
  postgresSessionLaunchPrecondition,
  postgresWorkerPoolSessions,
} from "../../src/adapters/postgres/workerPoolSessions.ts";
import { sessionBearerPattern } from "../../src/contract/sessionPlane.ts";
import {
  workerContractHeader,
  workerContractRelease,
} from "../../src/contract/workerContract.ts";
import type {
  WorkerPoolReconciliation,
  WorkerPoolSessionAssignment,
} from "../../src/contract/workerPool.ts";
import {
  asSessionBearerSecret,
  asSessionId,
  type SessionId,
  type SessionKind,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  type Partition,
  type ProjectId,
} from "../../src/interpreter/projectStore.ts";
import {
  sessionPoolTurnDwellSecs,
  sessionRunnerPolledSecsMax,
} from "../../src/interpreter/sessionPlacement.ts";
import {
  workerPoolHeldImages,
  workerPoolPoll,
  workerPoolSettled,
  type DedicatedPoolIdentity,
  type PoolPlaneIdentity,
  type WorkerPoolPollSettings,
  type WorkerPoolPorts,
} from "../../src/interpreter/workerPool.ts";
import {
  workerPoolClientPass,
  type WorkerPoolBackend,
  type WorkerPoolClient,
  type WorkerPoolSessionEnd,
} from "../../src/interpreter/workerPoolClient.ts";
import { sessionTaskInvocation } from "../../src/interpreter/workerTask.ts";
import type {
  SessionLaunchFacts,
  WorkerPoolSessionCandidate,
  WorkerPoolSessionOpened,
} from "../../src/interpreter/workerPoolSessions.ts";
import { planeListening } from "../adapters/planeBodies.ts";
import {
  inertSessionPlane,
  inertWorkerPlane,
} from "../adapters/workerPlaneFixtures.ts";
import {
  postgresHarnessNewEpoch,
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessStalled,
  type PostgresTransaction,
} from "./harness.ts";
import {
  sessionRigAttempt,
  sessionRigBoundless,
  sessionRigOpen,
  sessionRigProject,
  sessionRigQueuedFor,
  sessionRigRouted,
  sessionRigSession,
  sessionRigTurn,
  sessionRigTurnState,
} from "./sessionHarness.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";

const rig = await sessionRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const poolPlanePool = postgresHarnessRolePool(poolPlaneRole);
const schedulerPool = postgresHarnessRolePool(schedulerRole);
const planePool = postgresHarnessRolePool(workerPlaneRole);

/** The partition each session credential was asked for in, in the order asked. */
const credentialsAsked: Partition[] = [];

/** The worker plane a claimed session's runner reaches, its session routes over the real store. */
const workerPlane = createWorkerPlaneApp({
  ...inertWorkerPlane(1),
  tasks: postgresWorkerTasks(planePool),
  credentials: {
    attempt: () => Promise.resolve({ minted: "NotFound" }),
    session: (partition) => {
      credentialsAsked.push(partition);
      return Promise.resolve({ minted: "NotFound" });
    },
  },
  sessions: {
    ...inertSessionPlane(rig.plane),
    turns: rig.plane,
    settlements: rig.plane,
    losses: rig.plane,
    turnPollIntervalMs: 10,
    turnPollSecsMax: 1,
  },
});
const callbackUrl = `http://127.0.0.1:${String(await planeListening(workerPlane))}/`;

after(async () => {
  await workerPlane.close();
  await Promise.all(
    [apiPool, poolPlanePool, schedulerPool, planePool].map((pool) =>
      pool.end(),
    ),
  );
  await rig.close();
});

/** What every session here is launched with, its backoff short of any dwell. */
const launch: SessionLaunchFacts = {
  image: "registry.invalid/session:1",
  authority: {
    tools: [],
    credentials: ["claude-code"],
    network: true,
    filesystem: "ReadWorkspace",
    mayCompleteTask: false,
  },
  mirrors: {},
  bounds: {
    mailboxPollMs: 1,
    idleMs: 2,
    resultDrainMs: 3,
    loadTimeoutMs: 4,
    turnsMax: 5,
    budgetUsd: 6,
  },
  model: "session-model",
  deadlineSecs: 900,
  placementBackoffSecs: 60,
  idleSecsMax: 1800,
};

assert.deepEqual(
  await postgresSessionLaunchPrecondition(schedulerPool, launch).check(
    new AbortController().signal,
  ),
  { met: "Met" },
);

/** An authority answering every read, so a case here turns on the rows alone. */
const readingEverything: ProjectAccess = {
  authorize: (caller) => Promise.resolve(memberAuthority(caller)),
  authorizeTenant: (caller) => Promise.resolve(memberAuthority(caller)),
  authorizeSite: projectAccessSiteRefused,
};

const store = postgresWorkerPoolSessions(poolPlanePool);
const ports: WorkerPoolPorts = {
  assignments: postgresWorkerPoolAssignments(poolPlanePool),
  runners: postgresWorkerPoolRunners(poolPlanePool),
  access: readingEverything,
  sessions: {
    store,
    bindings: postgresProjectRepositoryBinding(poolPlanePool),
    bearers: sessionAttemptMint(),
  },
  mint: () => randomUUID(),
};

/** A lease no case outlives unless it backdates one, so a sweep reaps only the attempt a case meant it to. */
const settings: WorkerPoolPollSettings = {
  leaseSecs: 3600,
  cpuMillis: 500,
  memoryMib: 256,
  assignmentsPerPollMax: 1,
  heldMax: 1,
  sessionsPerPollMax: 4,
  sessionsHeldMax: 4,
  deadlineSecs: 600,
  callbackUrl,
  sessionApiUrl: "https://api.invalid/",
  pollIntervalMs: 1,
  pollsMax: 1,
  imageHosts: new Map([["registry.invalid", "registry.public.invalid"]]),
};

function principal(label: string): Principal {
  return asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`);
}

/** A runner `member` registered on the project, or one no person registered, under the name given or one of its own. */
async function runner(
  partition: Partition,
  member: Principal | undefined,
  pool = `runner-${randomUUID()}`,
  registered: Principal = principal("pool"),
): Promise<DedicatedPoolIdentity> {
  assert.equal(
    await postgresWorkerPoolRegistry(apiPool).register({
      partition,
      pool,
      capabilities: [],
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal: registered,
      ...(member === undefined ? {} : { registeredBy: member }),
    }),
    true,
  );
  return { kind: "Dedicated", partition, pool, principal: registered };
}

/** A project whose sessions run on runners, with a member and that member's runner. */
async function routedProject(label: string): Promise<{
  readonly partition: Partition;
  readonly member: Principal;
  readonly pool: DedicatedPoolIdentity;
}> {
  const partition = await sessionRigProject(rig, label);
  await sessionRigRouted(rig, partition, "Pool", "Pool");
  const member = principal(`member-${label}`);
  return { partition, member, pool: await runner(partition, member) };
}

const personalRegistry = postgresPersonalRunnerRegistry(apiPool);

type PersonalPlaneIdentity = Extract<PoolPlaneIdentity, { kind: "Personal" }>;

/** One more of `member`'s personal runners in the tenant of `partition`, by the client it registered, adding `serves` to what their runners serve. */
async function personal(
  partition: Partition,
  member: Principal,
  serves: readonly ProjectId[] = [partition.project],
  registered: Principal = principal("personal"),
): Promise<PersonalPlaneIdentity & { readonly clientId: string }> {
  const key = { tenant: partition.tenant, owner: member };
  const clientId = `chuggy-personal-${randomUUID()}`;
  assert.equal(
    await personalRegistry.register({
      ...key,
      capabilities: [],
      clientId,
      principal: registered,
    }),
    "Registered",
  );
  for (const project of serves)
    assert.equal(await personalRegistry.allow(key, project), "Allowed");
  return { kind: "Personal", ...key, principal: registered, clientId };
}

const chatHostRegistry = postgresChatHostRegistry(apiPool);

type ChatHostPlaneIdentity = Extract<PoolPlaneIdentity, { kind: "ChatHost" }>;

/** `member`'s chat host in the tenant of `partition`, by the client it registered, in place of any they held. */
async function chatHost(
  partition: Partition,
  member: Principal,
  registered: Principal = principal("host"),
): Promise<ChatHostPlaneIdentity & { readonly clientId: string }> {
  const key = { tenant: partition.tenant, owner: member };
  const clientId = `chuggy-personal-${randomUUID()}`;
  assert.equal(
    (
      await chatHostRegistry.register({
        ...key,
        clientId,
        principal: registered,
      })
    ).written,
    "Registered",
  );
  return { kind: "ChatHost", ...key, principal: registered, clientId };
}

/** Stamps `host`'s last poll `secsAgo` back: live within the window a runner's standing is bounded by, stopped beyond it. */
async function hostPolled(
  host: ChatHostPlaneIdentity,
  secsAgo = 0,
): Promise<void> {
  await rig.harness.query(
    `UPDATE chat_host SET last_polled_at=now()-make_interval(secs=>$3)
      WHERE tenant=$1 AND owner=$2`,
    [host.tenant, host.owner, secsAgo],
  );
}

/** Another project of `partition`'s tenant, its sessions routed to runners. */
async function besideOf(
  partition: Partition,
  label: string,
): Promise<Partition> {
  const beside = await postgresHarnessProject(rig.harness.store, label, {
    tenant: partition.tenant,
    project: asProjectId(`project-${label}-${randomUUID()}`),
  });
  await sessionRigRouted(rig, beside, "Pool", "Pool");
  return beside;
}

/** A session of `kind` held by `holder` with one turn queued. */
async function waiting(
  partition: Partition,
  label: string,
  kind: SessionKind,
  holder: Principal,
  parent?: SessionId,
): Promise<{ readonly session: SessionId; readonly turn: SessionTurnId }> {
  const session = await sessionRigSession(rig, partition, label, {
    kind,
    principal: holder,
    ...(parent === undefined ? {} : { parent }),
  });
  return {
    session,
    turn: await sessionRigTurn(rig, partition, session, label),
  };
}

/** One poll of a pool that reads sessions, holding `held` and with room for `wantedSessions`. */
async function polled(
  pool: PoolPlaneIdentity,
  wantedSessions = 1,
  held: readonly string[] = [],
  through: WorkerPoolPorts = ports,
  terms: WorkerPoolPollSettings = settings,
): Promise<WorkerPoolReconciliation> {
  const answered = await workerPoolPoll(
    through,
    pool,
    {
      held,
      wanted: 0,
      wantedSessions,
    },
    terms,
  );
  if (answered.polled !== "Answered")
    throw new Error(`pool session suite: a poll answered ${answered.polled}`);
  return answered.answer;
}

/** The one session a poll hands `pool`, refusing a poll that hands it none or more. */
async function claimedOne(
  pool: PoolPlaneIdentity,
): Promise<WorkerPoolSessionAssignment> {
  const [claimed, ...more] = (await polled(pool)).sessions;
  assert.deepEqual(more, []);
  if (claimed === undefined)
    throw new Error("pool session suite: no session was handed out");
  return claimed;
}

/** The attempt an assignment opened, for the columns no port answers. */
async function attemptOf(assignment: string): Promise<Record<string, unknown>> {
  const [row] = await rig.harness.query(
    `SELECT session,project,state,evidence,pool,holder_kind,idle_secs,
            pool_principal::text AS pool_principal,pool_refusal,image,launch,
            lease_owner,idle_since IS NOT NULL AS idle,
            lease_expires_at::text AS lease
       FROM session_attempt WHERE assignment=$1`,
    [assignment],
  );
  if (row === undefined)
    throw new Error(`pool session suite: no attempt for ${assignment}`);
  return row;
}

async function sessionOf(
  claimed: WorkerPoolSessionAssignment,
): Promise<SessionId> {
  const session = (await attemptOf(claimed.assignment))["session"];
  if (typeof session !== "string")
    throw new Error(
      `pool session suite: ${claimed.assignment} names no session`,
    );
  return asSessionId(session);
}

/** The turn a claimed session's runner takes, as its container asks for one. */
async function runnerClaimed(
  claimed: WorkerPoolSessionAssignment,
): Promise<SessionTurnId | undefined> {
  return (
    await rig.plane.claim({
      secret: asSessionBearerSecret(claimed.bearer),
      generation: 1,
    })
  )?.turn;
}

/** How a turn stands, as its state, its failure and what it has spent. */
async function turnStanding(
  partition: Partition,
  session: SessionId,
  turn: SessionTurnId,
): Promise<readonly unknown[]> {
  const row = await sessionRigTurnState(rig, partition, session, turn);
  return [row["state"], row["failure"], row["attempts_spent"]];
}

/**
 * Moves one of an attempt's times back by `secs`. An ended attempt's row
 * refuses every write, so its end is moved with that refusal lifted for the
 * one statement and in a transaction no other connection sees it lifted in.
 */
async function backdated(
  assignment: string,
  column: "ended_at" | "idle_since" | "lease_expires_at",
  secs: number,
): Promise<void> {
  const backdating = await rig.harness.begin();
  const fence = "TRIGGER session_attempt_is_fenced";
  await committedAfter(backdating, async () => {
    await backdating.query(`ALTER TABLE session_attempt DISABLE ${fence}`);
    await backdating.query(
      `UPDATE session_attempt SET ${column}=now()-make_interval(secs=>$2)
        WHERE assignment=$1`,
      [assignment, secs],
    );
    await backdating.query(`ALTER TABLE session_attempt ENABLE ${fence}`);
  });
}

/** Commits `holding` once `then` has run, and rolls it back if `then` throws, so a failing case releases what it locked rather than hanging the suite. */
async function committedAfter<Result>(
  holding: PostgresTransaction,
  then: () => Promise<Result>,
): Promise<Result> {
  let result: Result;
  try {
    result = await then();
  } catch (error) {
    await holding.rollback();
    throw error;
  }
  await holding.commit();
  return result;
}

function withdrawn(): Promise<number> {
  return rig.scheduler.withdrawUnservedPoolTurns(
    rig.epoch,
    sessionPoolTurnDwellSecs,
    sessionRigBoundless,
  );
}

test("a runner is handed a session whose oldest queued turn was admitted for runners, and never one admitted in cluster", async () => {
  const partition = await sessionRigProject(rig, "pool-claim");
  const member = principal("member-pool-claim");
  const pool = await runner(partition, member);
  const host = await chatHost(partition, member);
  const inCluster = await waiting(partition, "claim-cluster", "Lead", member);
  assert.deepEqual((await polled(pool, 4)).sessions, []);
  await sessionRigRouted(rig, partition, "Pool", "Pool");
  await sessionRigTurn(rig, partition, inCluster.session, "claim-behind");
  const offered = await waiting(
    partition,
    "claim-pool",
    "Inquiry",
    member,
    inCluster.session,
  );
  assert.deepEqual((await polled(pool, 4)).sessions, []);

  const claimed = await claimedOne(host);
  assert.match(claimed.bearer, sessionBearerPattern);
  assert.deepEqual(claimed, {
    assignment: claimed.assignment,
    capabilities: [],
    image: "registry.public.invalid/session:1",
    cpuMillis: settings.cpuMillis,
    memoryMib: settings.memoryMib,
    deadlineSecs: launch.deadlineSecs,
    callbackUrl,
    bearer: claimed.bearer,
  });
  const opened = await attemptOf(claimed.assignment);
  assert.deepEqual(opened, {
    session: offered.session,
    project: partition.project,
    state: "Running",
    evidence: null,
    pool: member,
    holder_kind: "ChatHost",
    idle_secs: null,
    pool_principal: host.principal,
    pool_refusal: null,
    image: launch.image,
    launch: {
      api: { url: settings.sessionApiUrl },
      bounds: launch.bounds,
      model: launch.model,
    },
    lease_owner: member,
    idle: true,
    lease: opened["lease"],
  });
  assert.equal(await runnerClaimed(claimed), offered.turn);
  assert.deepEqual((await polled(host, 4, [claimed.assignment])).sessions, []);
});

test("every attempt a runner opens names its holder's kind, its holder and the principal that claimed, and an attempt in the cluster names none", async () => {
  const partition = await sessionRigProject(rig, "pool-holders");
  await sessionRigRouted(rig, partition, "Pool", "Pool");
  const runs = principal("member-holders-runs");
  const hosts = principal("member-holders-hosts");
  const lead = await waiting(partition, "holders-lead", "Lead", runs);
  await waiting(partition, "holders-runs", "Thread", runs);
  await waiting(partition, "holders-hosts", "Thread", hosts);
  await waiting(partition, "holders-asks", "Inquiry", hosts, lead.session);
  const pool = await runner(partition, undefined);
  const personalRunner = await personal(partition, runs);
  const host = await chatHost(partition, hosts);
  const holders = async (
    holder: PoolPlaneIdentity,
  ): Promise<readonly unknown[]> =>
    Promise.all(
      (await polled(holder, 4)).sessions.map(async ({ assignment }) => {
        const opened = await attemptOf(assignment);
        return [
          opened["holder_kind"],
          opened["pool"],
          opened["pool_principal"],
          opened["lease_owner"],
        ];
      }),
    );
  assert.deepEqual(await holders(pool), [
    ["Pool", pool.pool, pool.principal, pool.pool],
  ]);
  assert.deepEqual(await holders(personalRunner), [
    ["Personal", runs, personalRunner.principal, runs],
  ]);
  assert.deepEqual(await holders(host), [
    ["ChatHost", hosts, host.principal, hosts],
    ["ChatHost", hosts, host.principal, hosts],
  ]);

  const elsewhere = await sessionRigProject(rig, "pool-holders-cluster");
  const session = await sessionRigSession(rig, elsewhere, "holders-cluster");
  await sessionRigTurn(rig, elsewhere, session, "holders-cluster");
  await sessionRigAttempt(rig, elsewhere, session, "holders-cluster");
  assert.deepEqual(
    await rig.harness.query(
      `SELECT holder_kind,pool,pool_principal FROM session_attempt
        WHERE tenant=$1 AND project=$2 AND session=$3`,
      [elsewhere.tenant, elsewhere.project, session],
    ),
    [{ holder_kind: null, pool: null, pool_principal: null }],
  );
});

test("a lead is handed to any pool of its project and a thread and an inquiry to their member's chat host alone, a thread to their personal runner only while their chat host is not live, and nothing to another project's", async () => {
  const partition = await sessionRigProject(rig, "pool-whose");
  await sessionRigRouted(rig, partition, "Pool", "Pool");
  const member = principal("member-whose");
  const other = principal("other-whose");
  const lead = await waiting(
    partition,
    "whose-lead",
    "Lead",
    principal("lead"),
  );
  const thread = await waiting(partition, "whose-thread", "Thread", member);
  const inquiry = await waiting(
    partition,
    "whose-inquiry",
    "Inquiry",
    member,
    lead.session,
  );
  const elsewhere = await sessionRigProject(rig, "pool-whose-elsewhere");
  await sessionRigRouted(rig, elsewhere, "Pool", "Pool");
  const handed = async (pool: PoolPlaneIdentity) =>
    new Set(await Promise.all((await polled(pool, 4)).sessions.map(sessionOf)));

  assert.deepEqual(await handed(await runner(elsewhere, member)), new Set());
  assert.deepEqual(await handed(await chatHost(elsewhere, other)), new Set());
  assert.deepEqual(
    await handed(await personal(partition, member, [])),
    new Set(),
    "a personal runner was handed a thread in a project it does not serve",
  );
  assert.deepEqual(
    await handed(await personal(partition, other)),
    new Set(),
    "a personal runner was handed another member's session",
  );
  assert.deepEqual(
    await handed(await runner(partition, member)),
    new Set([lead.session]),
    "a pool its member registered was handed their inquiry",
  );
  const runs = await personal(partition, member);
  assert.deepEqual(
    await handed(await chatHost(partition, member)),
    new Set([thread.session, inquiry.session]),
  );
  assert.deepEqual(await handed(runs), new Set());
});

test("while a member's chat host is live it is handed their threads ahead of their live personal runner, and while it is not, polled never or not lately, the runner is handed them", async () => {
  const { partition, member } = await routedProject("pool-precedence");
  const thread = await waiting(partition, "precedence", "Thread", member);
  const runs = await personal(partition, member);
  const host = await chatHost(partition, member);
  const mine = async () =>
    (await postgresSessionPlacement(apiPool).runners(partition, member)).mine;
  assert.deepEqual(
    await awaitingOf(runs),
    new Set([thread.session]),
    "a chat host that never polled kept a thread from its member's runner",
  );
  await hostPolled(host);
  assert.deepEqual(await awaitingOf(runs), new Set());
  assert.deepEqual((await polled(runs, 4)).sessions, []);
  assert.equal(await mine(), "Live", "the runner refused was not live");
  assert.deepEqual(await awaitingOf(host), new Set([thread.session]));
  await hostPolled(host, sessionRunnerPolledSecsMax + 1);
  assert.equal(await mine(), "Live");
  assert.deepEqual(
    await Promise.all((await polled(runs, 4)).sessions.map(sessionOf)),
    [thread.session],
    "a stopped chat host stranded its member's thread",
  );
});

/** A project's lead, and a thread and an inquiry its member holds, each with a turn queued for runners. */
async function confinedProject(label: string): Promise<{
  readonly partition: Partition;
  readonly member: Principal;
  readonly lead: SessionId;
  readonly thread: SessionId;
  readonly inquiry: SessionId;
}> {
  const partition = await sessionRigProject(rig, label);
  await sessionRigRouted(rig, partition, "Pool", "Pool");
  const member = principal(`member-${label}`);
  const lead = await waiting(
    partition,
    `${label}-lead`,
    "Lead",
    principal("lead"),
  );
  const thread = await waiting(partition, `${label}-thread`, "Thread", member);
  const inquiry = await waiting(
    partition,
    `${label}-inquiry`,
    "Inquiry",
    member,
    lead.session,
  );
  return {
    partition,
    member,
    lead: lead.session,
    thread: thread.session,
    inquiry: inquiry.session,
  };
}

async function awaitingOf(
  pool: PoolPlaneIdentity,
): Promise<ReadonlySet<SessionId>> {
  return new Set(
    (await store.awaiting(pool, launch.placementBackoffSecs, 4)).map(
      ({ session }) => session,
    ),
  );
}

/** Opens `candidate` through `pool` as a claim would, whichever runner read it as waiting. */
async function openedFor(
  pool: PoolPlaneIdentity,
  candidate: WorkerPoolSessionCandidate,
): Promise<WorkerPoolSessionOpened> {
  const minted = ports.sessions.bearers.mint();
  return store.open(pool, {
    candidate,
    attempt: minted.attempt,
    assignment: randomUUID(),
    bearer: minted.bearer.id,
    bearerSecretDigest: minted.bearerSecretDigest,
    leaseSecs: settings.leaseSecs,
    placementBackoffSecs: launch.placementBackoffSecs,
    heldMax: settings.sessionsHeldMax,
    invocation: sessionTaskInvocation({
      capabilities: candidate.capabilities,
      authority: launch.authority,
    }),
    image: launch.image,
    launch: {
      api: { url: "https://api.invalid/" },
      bounds: launch.bounds,
      model: launch.model,
    },
  });
}

test("a lead is read as waiting by every pool of the project, a thread and an inquiry by their member's chat host, and a thread by their personal runner serving its project while their chat host is not live", async () => {
  const { partition, member, lead, thread, inquiry } =
    await confinedProject("pool-read");
  for (const elsewhere of [member, principal("other-read"), undefined])
    assert.deepEqual(
      await awaitingOf(await runner(partition, elsewhere)),
      new Set([lead]),
    );
  for (const elsewhere of [
    await personal(partition, principal("other-read")),
    await personal(partition, member, []),
    await chatHost(partition, principal("other-read")),
  ])
    assert.deepEqual(await awaitingOf(elsewhere), new Set());
  const runs = await personal(partition, member);
  assert.deepEqual(await awaitingOf(runs), new Set([thread]));
  const host = await chatHost(partition, member);
  assert.deepEqual(await awaitingOf(host), new Set([thread, inquiry]));
  assert.deepEqual(await awaitingOf(runs), new Set([thread]));
  await hostPolled(host);
  assert.deepEqual(await awaitingOf(runs), new Set());
});

/** The candidate each session was read as by one of `readers`, refusing a session none read. */
async function candidatesRead(
  readers: readonly PoolPlaneIdentity[],
): Promise<(session: SessionId) => WorkerPoolSessionCandidate> {
  const read: WorkerPoolSessionCandidate[] = [];
  for (const reader of readers)
    read.push(
      ...(await store.awaiting(reader, launch.placementBackoffSecs, 4)),
    );
  return (session) => {
    const found = read.find((waited) => waited.session === session);
    if (found === undefined)
      throw new Error(`pool session suite: ${session} was not read`);
    return found;
  };
}

/** Asserts each runner named opens no candidate of the session named beside it. */
async function openedByNone(
  candidate: (session: SessionId) => WorkerPoolSessionCandidate,
  refused: readonly (readonly [PoolPlaneIdentity, SessionId, string])[],
): Promise<void> {
  for (const [opening, session, refusal] of refused)
    assert.equal(
      await openedFor(opening, candidate(session)),
      "NotClaimable",
      refusal,
    );
}

test("a session read as waiting by the runner it is for is opened by no pool or personal runner it is not for", async () => {
  const { partition, member, lead, thread, inquiry } =
    await confinedProject("pool-open");
  const key = { tenant: partition.tenant, owner: member };
  const pool = await runner(partition, member);
  const runs = await personal(partition, member, [
    partition.project,
    (await besideOf(partition, "pool-open-beside")).project,
  ]);
  const host = await chatHost(partition, member);
  const candidate = await candidatesRead([pool, host]);
  assert.equal(await chatHostRegistry.deregister(key, host.clientId), true);
  await openedByNone(candidate, [
    [pool, thread, "a pool opened its member's thread"],
    [pool, inquiry, "a pool opened its member's inquiry"],
    [
      await runner(partition, undefined),
      inquiry,
      "a pool no person registered opened an inquiry",
    ],
    [runs, lead, "a personal runner opened a lead"],
    [runs, inquiry, "a personal runner opened its owner's inquiry"],
    [
      await personal(partition, principal("other-open")),
      thread,
      "a personal runner opened another member's thread",
    ],
  ]);
  assert.equal(await personalRegistry.disallow(key, partition.project), true);
  assert.equal(
    await openedFor(runs, candidate(thread)),
    "NotClaimable",
    "a personal runner opened a thread in a project it no longer serves",
  );
  assert.equal(await personalRegistry.allow(key, partition.project), "Allowed");
  assert.equal(await openedFor(runs, candidate(thread)), "Opened");
  assert.equal(
    await openedFor(await runner(partition, undefined), candidate(lead)),
    "Opened",
  );
});

test("a session read as waiting by the runner it is for is opened by no chat host it is not for, and a thread by no personal runner while its member's chat host is live", async () => {
  const { partition, member, lead, thread, inquiry } =
    await confinedProject("host-open");
  const runs = await personal(partition, member);
  const host = await chatHost(partition, member);
  const candidate = await candidatesRead([
    await runner(partition, undefined),
    host,
  ]);
  const other = await chatHost(partition, principal("other-open"));
  await hostPolled(host);
  await openedByNone(candidate, [
    [host, lead, "a chat host opened a lead"],
    [other, inquiry, "a chat host opened another member's inquiry"],
    [other, thread, "a chat host opened another member's thread"],
    [
      runs,
      thread,
      "a personal runner opened a thread while its owner's chat host is live",
    ],
  ]);
  assert.equal(await openedFor(host, candidate(inquiry)), "Opened");
  assert.equal(await openedFor(host, candidate(thread)), "Opened");
});

test("a runner holds no more sessions than its bound however few it says it holds, and a session is not handed out while an attempt holds it or its backoff runs", async () => {
  const { partition, member, pool } = await routedProject("pool-bound");
  const lead = await waiting(partition, "bound-lead", "Lead", member);
  await waiting(partition, "bound-thread", "Thread", member);
  await waiting(partition, "bound-inquiry", "Inquiry", member, lead.session);
  const host = await chatHost(partition, member);
  const one = { ...settings, sessionsHeldMax: 1 };
  for (const holder of [pool, host]) {
    const [first] = (await polled(holder, 1, [], ports, one)).sessions;
    assert.ok(first !== undefined);
    assert.deepEqual(
      (await polled(holder, 1, [], ports, one)).sessions,
      [],
      `a ${holder.kind} runner that said it held nothing was handed one past its bound`,
    );
  }

  const beside = await runner(partition, member);
  assert.deepEqual(
    (await polled(beside, 4)).sessions,
    [],
    "a session was handed out while held",
  );
  const [claimed] = await rig.harness.query(
    `SELECT assignment FROM session_attempt
      WHERE tenant=$1 AND project=$2 AND holder_kind='Pool'`,
    [partition.tenant, partition.project],
  );
  const assignment = String(claimed?.["assignment"]);
  assert.equal(
    await workerPoolSettled(ports, pool, assignment, {
      outcome: "Unavailable",
    }),
    true,
  );
  assert.deepEqual(
    (await polled(beside, 4)).sessions,
    [],
    "a session was handed out inside its backoff",
  );
  await backdated(assignment, "ended_at", launch.placementBackoffSecs + 1);
  const [again] = (await polled(beside, 4)).sessions;
  assert.ok(again !== undefined);
  assert.equal(await sessionOf(again), lead.session);
});

/** The ports with `between` run after the candidates are read and before any is opened, as a racing writer would. */
function racing(between: () => Promise<void>): WorkerPoolPorts {
  return {
    ...ports,
    sessions: {
      ...ports.sessions,
      store: {
        ...store,
        awaiting: async (identity, backoffSecs, max) => {
          const found = await store.awaiting(identity, backoffSecs, max);
          await between();
          return found;
        },
      },
    },
  };
}

test("a session read as waiting is not opened once its project stops being active or another pool claims it first", async () => {
  const { partition, member, pool } = await routedProject("pool-race");
  await waiting(partition, "race", "Lead", member);
  const lifecycle = async (to: string): Promise<void> => {
    await rig.harness.query(
      `UPDATE project SET lifecycle=$3 WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project, to],
    );
  };
  assert.deepEqual(
    (
      await polled(
        pool,
        4,
        [],
        racing(() => lifecycle("Suspended")),
      )
    ).sessions,
    [],
  );
  await lifecycle("Active");
  const beside = await runner(partition, member);
  let taken: readonly WorkerPoolSessionAssignment[] = [];
  const raced = racing(async () => {
    taken = (await polled(beside, 4)).sessions;
  });
  assert.deepEqual((await polled(pool, 4, [], raced)).sessions, []);
  assert.equal(taken.length, 1);
});

test("renewal keeps a held session's lease, and one an idle reap ended is to be stopped", async () => {
  const { partition, member, pool } = await routedProject("pool-renew");
  await waiting(partition, "renew", "Lead", member);
  const held = await claimedOne(pool);
  await backdated(held.assignment, "lease_expires_at", -5);
  const short = (await attemptOf(held.assignment))["lease"];
  assert.deepEqual((await polled(pool, 0, [held.assignment])).stop, []);
  assert.notEqual((await attemptOf(held.assignment))["lease"], short);

  await backdated(held.assignment, "idle_since", 3600);
  assert.equal(
    await rig.scheduler.reapIdleAttempts(rig.epoch, 1800, sessionRigBoundless),
    1,
  );
  assert.deepEqual(
    [(await attemptOf(held.assignment))["evidence"]],
    ["SessionIdle"],
  );
  assert.deepEqual((await polled(pool, 0, [held.assignment])).stop, [
    held.assignment,
  ]);
});

test("a held session that closes, or whose project is suspended, is to be stopped", async () => {
  const { partition, member } = await routedProject("host-closed");
  const host = await chatHost(partition, member);
  const lead = await waiting(partition, "closed-lead", "Lead", member);
  await waiting(partition, "closed-thread", "Thread", member);
  const thread = await waiting(
    partition,
    "closed-inquiry",
    "Inquiry",
    member,
    lead.session,
  );
  const claimed = (await polled(host, 2)).sessions;
  const held = claimed.map(({ assignment }) => assignment);
  const threadHeld =
    claimed[(await Promise.all(claimed.map(sessionOf))).indexOf(thread.session)]
      ?.assignment;
  const stopped = async (): Promise<ReadonlySet<string>> =>
    new Set((await polled(host, 0, held)).stop);
  assert.equal(held.length, 2);
  assert.deepEqual(await stopped(), new Set());

  await rig.harness.query(`SELECT close_agent_session($1,$2,$3)`, [
    partition.tenant,
    partition.project,
    thread.session,
  ]);
  assert.deepEqual(await stopped(), new Set([threadHeld]));

  await rig.harness.query(
    `UPDATE project SET lifecycle='Suspended' WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  assert.deepEqual(await stopped(), new Set(held));
});

test("a runner's heartbeat on a pool-held attempt answers whether the pool's lease holds it and renews nothing, and a lapsed lease is reaped", async () => {
  const { partition, member, pool } = await routedProject("pool-heartbeat");
  await waiting(partition, "heartbeat", "Lead", member);
  const held = await claimedOne(pool);
  const secret = asSessionBearerSecret(held.bearer);
  const leased = (await attemptOf(held.assignment))["lease"];
  assert.equal(await rig.plane.heartbeat(secret, 1, 3600), true);
  assert.equal((await attemptOf(held.assignment))["lease"], leased);
  await backdated(held.assignment, "lease_expires_at", 1);
  assert.equal(await rig.plane.heartbeat(secret, 1, 3600), false);
  assert.equal(
    await rig.scheduler.reapLapsedAttempts(rig.epoch, sessionRigBoundless),
    1,
  );
  assert.deepEqual(
    [(await attemptOf(held.assignment))["evidence"]],
    ["LeaseExpired"],
  );
});

/**
 * Neither reaper filters on the pool, and the cluster observes no pod a pool
 * holds, so on a closed session the reapers are what end its attempt.
 */
test("a held session that closes is ended SessionClosed by whichever reaper reaches it", async () => {
  for (const [column, reaped] of [
    [
      "idle_since",
      () =>
        rig.scheduler.reapIdleAttempts(rig.epoch, 1800, sessionRigBoundless),
    ],
    [
      "lease_expires_at",
      () => rig.scheduler.reapLapsedAttempts(rig.epoch, sessionRigBoundless),
    ],
  ] as const) {
    const label = `pool-reaped-closed-${column}`.replaceAll("_", "-");
    const { partition, member, pool } = await routedProject(label);
    const { session } = await waiting(partition, label, "Lead", member);
    const held = await claimedOne(pool);
    await rig.sessions.close(partition, session);
    await backdated(held.assignment, column, 3600);
    assert.equal(await reaped(), 1, column);
    assert.deepEqual(
      [
        (await attemptOf(held.assignment))["state"],
        (await attemptOf(held.assignment))["evidence"],
      ],
      ["Lost", "SessionClosed"],
      column,
    );
  }
});

test("an accepted session writes nothing, an unavailable one is withdrawn with its turn uncharged, and a refused one ends charged with its refusal recorded", async () => {
  const { partition, member } = await routedProject("host-settle");
  const host = await chatHost(partition, member);
  const lead = await waiting(partition, "settle-lead", "Lead", member);
  await waiting(partition, "settle-thread", "Thread", member);
  await waiting(partition, "settle-second", "Inquiry", member, lead.session);
  await waiting(partition, "settle-inquiry", "Inquiry", member, lead.session);
  const [accepted, unavailable, refused] = (await polled(host, 3)).sessions;
  assert.ok(
    accepted !== undefined &&
      unavailable !== undefined &&
      refused !== undefined,
  );
  const turns = new Map<string, SessionTurnId | undefined>();
  for (const claimed of [accepted, unavailable, refused])
    turns.set(claimed.assignment, await runnerClaimed(claimed));
  const standing = async (claimed: WorkerPoolSessionAssignment) => {
    const turn = turns.get(claimed.assignment);
    assert.ok(turn !== undefined);
    return turnStanding(partition, await sessionOf(claimed), turn);
  };

  const untouched = await attemptOf(accepted.assignment);
  assert.equal(
    await workerPoolSettled(ports, host, accepted.assignment, {
      outcome: "Accepted",
    }),
    true,
  );
  assert.deepEqual(await attemptOf(accepted.assignment), untouched);
  assert.equal(
    await workerPoolSettled(ports, host, unavailable.assignment, {
      outcome: "Unavailable",
    }),
    true,
  );
  const withdrawnAttempt = await attemptOf(unavailable.assignment);
  assert.deepEqual(
    [withdrawnAttempt["state"], withdrawnAttempt["evidence"]],
    ["Withdrawn", "PlacementUnavailable"],
  );
  assert.deepEqual(await standing(unavailable), ["Queued", null, "0"]);
  const refusal = { outcome: "Refused", evidence: "no runtime" } as const;
  assert.equal(
    await workerPoolSettled(ports, host, refused.assignment, refusal),
    true,
  );
  const lost = await attemptOf(refused.assignment);
  assert.deepEqual(
    [lost["state"], lost["evidence"], lost["pool_refusal"]],
    ["Lost", "PlacementDenied", "no runtime"],
  );
  assert.deepEqual(await standing(refused), ["Queued", null, "1"]);
  assert.equal(
    await workerPoolSettled(ports, host, refused.assignment, refusal),
    false,
  );
});

test("registering a pool's name again ends the sessions its old registration held", async () => {
  const { partition, member, pool } = await routedProject("pool-again");
  const { session, turn } = await waiting(partition, "again", "Lead", member);
  const held = await claimedOne(pool);
  assert.equal(await runnerClaimed(held), turn);
  const again = await runner(partition, member, pool.pool);
  const fenced = await attemptOf(held.assignment);
  assert.deepEqual(
    [fenced["state"], fenced["evidence"]],
    ["Superseded", "Fenced"],
  );
  assert.deepEqual(await turnStanding(partition, session, turn), [
    "Queued",
    null,
    "1",
  ]);
  assert.deepEqual((await polled(again, 0, [held.assignment])).stop, [
    held.assignment,
  ]);
});

test("a pool may pull the image of a session it holds and of none it does not", async () => {
  const { partition, member, pool } = await routedProject("pool-images");
  await waiting(partition, "images", "Lead", member);
  const images = (of: DedicatedPoolIdentity) =>
    workerPoolHeldImages(ports, of, settings);
  assert.deepEqual(await images(pool), []);
  const held = await claimedOne(pool);
  assert.deepEqual(await images(pool), [launch.image]);
  assert.deepEqual(await images(await runner(partition, member)), []);
  assert.equal(
    await workerPoolSettled(ports, pool, held.assignment, {
      outcome: "Refused",
      evidence: "no runtime",
    }),
    true,
  );
  assert.deepEqual(await images(pool), []);
});

test("only a poll that could take a session marks a runner live, and a member's own runners are their chat host and their personal runner while it serves the project, live while either is", async () => {
  const { partition, member, pool } = await routedProject("pool-live");
  const standing = () =>
    postgresSessionPlacement(apiPool).runners(partition, member);
  assert.deepEqual(await standing(), {
    mine: "Unregistered",
    inquiry: "Unregistered",
    project: "Offline",
  });
  await polled(pool, 1);
  assert.deepEqual(await standing(), {
    mine: "Unregistered",
    inquiry: "Unregistered",
    project: "Live",
  });

  const runs = await personal(partition, member);
  const mine = async () => (await standing()).mine;
  assert.equal(await mine(), "Offline");
  await polled(runs, 0);
  assert.equal(await mine(), "Offline", "a runner with no room");
  await polled({ ...runs, principal: principal("stale") }, 1);
  assert.equal(await mine(), "Offline", "a registration since replaced");
  await polled(runs, 1);
  assert.equal(await mine(), "Live");
  const key = { tenant: partition.tenant, owner: member };
  assert.equal(await personalRegistry.disallow(key, partition.project), true);
  assert.equal(await mine(), "Unregistered");

  const host = await chatHost(partition, member);
  const hosted = { mine: "Offline", inquiry: "Offline", project: "Live" };
  assert.deepEqual(await standing(), hosted);
  await polled(host, 0);
  assert.deepEqual(await standing(), hosted, "a chat host with no room");
  await polled({ ...host, principal: principal("stale") }, 1);
  assert.deepEqual(
    await standing(),
    hosted,
    "a chat host's registration since replaced",
  );
  await polled(host, 1);
  assert.deepEqual(await standing(), {
    ...hosted,
    mine: "Live",
    inquiry: "Live",
  });
  assert.equal(await personalRegistry.allow(key, partition.project), "Allowed");
  await chatHost(partition, member);
  assert.deepEqual(
    await standing(),
    { ...hosted, mine: "Live" },
    "a member's live personal runner did not stand beside a chat host offline",
  );
});

/** A task document's fields, refusing an answer that is not one. */
function documentOf(body: unknown): Readonly<Record<string, unknown>> {
  assert.ok(typeof body === "object" && body !== null);
  return Object.fromEntries(Object.entries(body));
}

/** The task a bearer is answered with, as a runner of `release` asks for it. */
async function taskOf(
  bearer: string,
  release?: string,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const answered = await workerPlane.inject({
    method: "GET",
    url: "/v1/task",
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(release === undefined ? {} : { [workerContractHeader]: release }),
    },
  });
  return { status: answered.statusCode, body: answered.json() };
}

test("a settlement's kind is read, and a poll recorded, only for the registration the poll is made under", async () => {
  const { partition, member, pool } = await routedProject("pool-scoped");
  const stale = { ...pool, principal: principal("stale") };
  const polledAt = async (): Promise<unknown> =>
    (
      await rig.harness.query(
        `SELECT last_polled_at IS NOT NULL AS polled FROM worker_pool
          WHERE tenant=$1 AND project=$2 AND pool=$3`,
        [partition.tenant, partition.project, pool.pool],
      )
    )[0]?.["polled"];
  await store.polled(stale);
  assert.equal(await polledAt(), false);
  await store.polled(pool);
  assert.equal(await polledAt(), true);

  await waiting(partition, "scoped", "Lead", member);
  const held = await claimedOne(pool);
  assert.deepEqual(
    await store.among(pool, [held.assignment]),
    new Set([held.assignment]),
  );
  await runner(partition, member, pool.pool);
  const moved = await runner(
    partition,
    member,
    `runner-${randomUUID()}`,
    pool.principal,
  );
  for (const elsewhere of [stale, await runner(partition, member), moved])
    assert.deepEqual(
      await store.among(elsewhere, [held.assignment]),
      new Set(),
    );
});

test("a pool-held attempt's task names what it is launched with to a release whose runners launch sessions, and an in-cluster attempt's names nothing more", async () => {
  const { partition, member, pool } = await routedProject("pool-task");
  await waiting(partition, "task", "Lead", member);
  const held = await claimedOne(pool);
  const older = await taskOf(held.bearer, "1.2.0");
  assert.equal(older.status, 200);
  for (const launched of ["api", "bounds", "model"])
    assert.equal(Object.hasOwn(documentOf(older.body), launched), false);
  assert.deepEqual(await taskOf(held.bearer), older);
  assert.deepEqual(await taskOf(held.bearer, workerContractRelease), {
    status: 200,
    body: {
      ...documentOf(older.body),
      api: { url: settings.sessionApiUrl },
      bounds: launch.bounds,
      model: launch.model,
    },
  });

  const elsewhere = await sessionRigProject(rig, "pool-task-cluster");
  const session = await sessionRigSession(rig, elsewhere, "task-cluster");
  await sessionRigTurn(rig, elsewhere, session, "task-cluster");
  const pod = await sessionRigAttempt(rig, elsewhere, session, "task-cluster");
  const podTask = await taskOf(pod.secret, workerContractRelease);
  assert.equal(podTask.status, 200);
  assert.deepEqual(await taskOf(pod.secret, "1.2.0"), podTask);
});

test("a turn no attempt claims is withdrawn once its dwell has run, however many attempts opened and ended without claiming it", async () => {
  const { partition, member, pool } = await routedProject("pool-unclaimed");
  const { session, turn } = await waiting(
    partition,
    "unclaimed",
    "Lead",
    member,
  );
  await sessionRigQueuedFor(rig, turn, 2 * sessionPoolTurnDwellSecs);
  let ended: string | undefined;
  for (const settlement of [
    { outcome: "Unavailable" },
    { outcome: "Refused", evidence: "the image could not be pulled" },
    { outcome: "Unavailable" },
    { outcome: "Refused", evidence: "the container exited" },
  ] as const) {
    if (ended !== undefined)
      await backdated(ended, "ended_at", launch.placementBackoffSecs + 1);
    const held = await claimedOne(pool);
    assert.equal(
      await workerPoolSettled(ports, pool, held.assignment, settlement),
      true,
    );
    ended = held.assignment;
  }
  assert.equal(await withdrawn(), 1);
  assert.deepEqual(await turnStanding(partition, session, turn), [
    "Abandoned",
    "TurnWithdrawn",
    "0",
  ]);
});

test("a turn left by a lost attempt waits its dwell from the loss, not from when it was sent", async () => {
  const { partition, member, pool } = await routedProject("pool-dwell");
  const { session, turn } = await waiting(partition, "dwell", "Lead", member);
  await sessionRigQueuedFor(rig, turn, 2 * sessionPoolTurnDwellSecs);
  const held = await claimedOne(pool);
  assert.equal(await runnerClaimed(held), turn);
  assert.equal(await withdrawn(), 0, "a turn was withdrawn under its attempt");
  assert.equal(
    await workerPoolSettled(ports, pool, held.assignment, {
      outcome: "Refused",
      evidence: "the container did not start",
    }),
    true,
  );
  assert.equal(
    await withdrawn(),
    0,
    "a turn was withdrawn as its attempt ended",
  );
  await rig.harness.query(
    `UPDATE session_turn SET released_at=now()-make_interval(secs=>$2)
      WHERE turn=$1`,
    [turn, sessionPoolTurnDwellSecs + 60],
  );
  assert.equal(await withdrawn(), 1);
  assert.deepEqual(await turnStanding(partition, session, turn), [
    "Abandoned",
    "TurnWithdrawn",
    "1",
  ]);
});

/**
 * Each direction is forced: the withdrawal or the claim is held open where it
 * has taken the session's row, and the other is let through only once it is
 * waiting on that row. The claim is held at its insert by a lock on the table
 * it inserts into, which nothing else here writes.
 */
test("a claim and the withdrawal of the turn it would serve exclude each other, whichever takes the session first", async () => {
  const { partition, member, pool } = await routedProject("pool-exclusive");
  const host = await chatHost(partition, member);
  const first = await waiting(partition, "exclusive-first", "Lead", member);
  await sessionRigQueuedFor(rig, first.turn, 2 * sessionPoolTurnDwellSecs);
  const withdrawing = await rig.harness.begin();
  await withdrawing.query(`SELECT withdraw_unserved_pool_turns($1,$2,$3)`, [
    rig.epoch,
    sessionPoolTurnDwellSecs,
    sessionRigBoundless,
  ]);
  const lateClaim = polled(pool);
  await committedAfter(withdrawing, () =>
    postgresHarnessStalled(rig.harness.pool, 1),
  );
  assert.deepEqual((await lateClaim).sessions, []);
  assert.deepEqual(await turnStanding(partition, first.session, first.turn), [
    "Abandoned",
    "TurnWithdrawn",
    "0",
  ]);

  const second = await waiting(
    partition,
    "exclusive-second",
    "Inquiry",
    member,
    first.session,
  );
  await sessionRigQueuedFor(rig, second.turn, 2 * sessionPoolTurnDwellSecs);
  const inserting = await rig.harness.begin();
  await inserting.query(`LOCK TABLE session_attempt IN SHARE MODE`);
  const claim = polled(host);
  const { lateWithdrawal } = await committedAfter(inserting, async () => {
    await postgresHarnessStalled(rig.harness.pool, 1);
    const behind = withdrawn();
    await postgresHarnessStalled(rig.harness.pool, 2);
    return { lateWithdrawal: behind };
  });
  assert.equal((await claim).sessions.length, 1);
  assert.equal(await lateWithdrawal, 0);
  assert.deepEqual(await turnStanding(partition, second.session, second.turn), [
    "Queued",
    null,
    "0",
  ]);
});

/** A container runtime that runs sessions only, each until the case says it ended. */
function sessionRuntime(): {
  readonly backend: WorkerPoolBackend;
  readonly running: Map<string, WorkerPoolSessionAssignment>;
  readonly finished: WorkerPoolSessionEnd[];
} {
  const running = new Map<string, WorkerPoolSessionAssignment>();
  const finished: WorkerPoolSessionEnd[] = [];
  return {
    running,
    finished,
    backend: {
      place: (offer) => {
        if (offer.kind !== "Session")
          return Promise.resolve({ placed: "Refused", evidence: "no jobs" });
        running.set(offer.assignment.assignment, offer.assignment);
        return Promise.resolve({ placed: "Placed" });
      },
      stop: (assignment) => {
        running.delete(assignment);
        return Promise.resolve({ stopped: "Stopped" });
      },
      held: () =>
        Promise.resolve(
          [...running.keys()].map((assignment) => ({
            assignment,
            kind: "Session" as const,
          })),
        ),
      ended: () => Promise.resolve(finished.splice(0)),
      clear: () => Promise.reject(new Error("a session runtime ends no job")),
    },
  };
}

/** The pool plane a runner polls, over the real stores, admitting one token as `runs` and every permit it asks. */
async function poolPlaneServing(
  runs: Principal,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const app = createPoolPlaneApp({
    authentication: {
      authenticateBearer: (token) =>
        Promise.resolve(
          token === "runner-token"
            ? { authenticated: "Bearer", bearer: { principal: runs } }
            : { authenticated: "InvalidToken" },
        ),
    },
    access: readingEverything,
    registry: postgresWorkerPoolRegistry(poolPlanePool),
    personal: postgresPersonalRunnerPlaneRegistry(poolPlanePool),
    chatHosts: postgresChatHostPlaneRegistry(poolPlanePool),
    assignments: ports.assignments,
    sessions: ports.sessions,
    runners: ports.runners,
    releases: new Map(),
    settings,
    mint: ports.mint,
    ready: () => Promise.resolve(true),
  });
  const port = await planeListening(app);
  return { url: `http://127.0.0.1:${String(port)}/`, close: () => app.close() };
}

test("a runner polls, runs the session it is handed through its turn, reports its end, and is then handed and told to stop nothing", async () => {
  const { partition, member } = await routedProject("pool-runner");
  const runs = principal("runner");
  await personal(partition, member, [partition.project], runs);
  const { session, turn } = await waiting(
    partition,
    "runner",
    "Thread",
    member,
  );
  const plane = await poolPlaneServing(runs);
  const runtime = sessionRuntime();
  const client: WorkerPoolClient = {
    tokens: {
      acquire: () =>
        Promise.resolve({ acquired: "Token", token: "runner-token" }),
      invalidate: () => undefined,
    },
    plane: poolPlaneClient({
      baseUrl: plane.url,
      pollTimeoutMs: 5_000,
      settleTimeoutMs: 5_000,
    }),
    jobs: poolJobPlaneClient({ timeoutMs: 5_000 }),
    sessions: poolSessionPlaneClient({ timeoutMs: 5_000 }),
    backend: runtime.backend,
    settings: {
      concurrencyMax: 1,
      sessionsMax: 1,
      outageBackoffMs: 1,
      passesMax: 1,
    },
  };
  try {
    const counts = { placed: 1, stopped: 0, refused: 0, ended: 0 };
    assert.deepEqual(await workerPoolClientPass(client), {
      passed: "Reconciled",
      ...counts,
    });
    const [held, ...more] = runtime.running.values();
    assert.ok(held !== undefined);
    assert.deepEqual(more, []);
    const task = await taskOf(held.bearer, workerContractRelease);
    assert.deepEqual(
      [task.status, documentOf(task.body)["session"]],
      [200, session],
    );
    assert.equal(await runnerClaimed(held), turn);
    const secret = asSessionBearerSecret(held.bearer);
    assert.equal(
      await rig.plane.answer({ secret, generation: 1, turn, result: "done" }),
      "Answered",
    );
    runtime.running.delete(held.assignment);
    runtime.finished.push({
      kind: "Session",
      session: held,
      phase: "Succeeded",
    });
    assert.deepEqual(await workerPoolClientPass(client), {
      passed: "Reconciled",
      ...counts,
      placed: 0,
      ended: 1,
    });
    assert.deepEqual([(await attemptOf(held.assignment))["state"]], ["Lost"]);
  } finally {
    await plane.close();
  }
});

test("a personal runner is handed no thread in a project its owner may no longer read, and nothing is opened for it", async () => {
  const { partition, member } = await routedProject("personal-read");
  const thread = await waiting(partition, "personal-read", "Thread", member);
  const runs = await personal(partition, member);
  const asked: string[] = [];
  const unread: WorkerPoolPorts = {
    ...ports,
    access: {
      ...readingEverything,
      authorize: (caller, at, kind) => {
        asked.push(`${caller}:${at.project}:${kind}`);
        return Promise.resolve(undefined);
      },
    },
  };
  assert.deepEqual((await polled(runs, 1, [], unread)).sessions, []);
  assert.deepEqual(asked, [`${member}:${partition.project}:Read`]);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT assignment FROM session_attempt WHERE session=$1`,
      [thread.session],
    ),
    [],
  );

  const claimed = await claimedOne(runs);
  const opened = await attemptOf(claimed.assignment);
  assert.deepEqual(
    [
      opened["session"],
      opened["pool"],
      opened["holder_kind"],
      opened["pool_principal"],
      opened["lease_owner"],
    ],
    [thread.session, member, "Personal", runs.principal, member],
  );
  assert.equal(await runnerClaimed(claimed), thread.turn);
});

test("each of a member's personal runners holds sessions to a bound of its own, apart from what another of theirs holds", async () => {
  const { partition, member } = await routedProject("personal-rooms");
  const beside = await besideOf(partition, "personal-rooms-beside");
  await waiting(partition, "personal-rooms-here", "Thread", member);
  await waiting(beside, "personal-rooms-there", "Thread", member);
  const first = await personal(partition, member, [
    partition.project,
    beside.project,
  ]);
  const second = await personal(partition, member, []);
  const one = { ...settings, sessionsHeldMax: 1 };
  assert.equal((await polled(first, 4, [], ports, one)).sessions.length, 1);
  assert.deepEqual((await polled(first, 4, [], ports, one)).sessions, []);
  assert.equal(
    (await polled(second, 4, [], ports, one)).sessions.length,
    1,
    "a runner was held to the bound of what another of its owner's holds",
  );
});

test("a personal runner's room spans every project it serves, and each session's credential is asked in that session's own project", async () => {
  const { partition, member } = await routedProject("personal-room");
  const beside = await besideOf(partition, "personal-room-beside");
  const here = await waiting(partition, "personal-here", "Thread", member);
  const there = await waiting(beside, "personal-there", "Thread", member);
  const runs = await personal(partition, member, [
    partition.project,
    beside.project,
  ]);
  const one = { ...settings, sessionsHeldMax: 1 };
  const [first, ...more] = (await polled(runs, 4, [], ports, one)).sessions;
  assert.ok(first !== undefined);
  assert.deepEqual(more, []);
  assert.deepEqual(
    (await polled(runs, 4, [], ports, one)).sessions,
    [],
    "a personal runner was handed one past its bound in another project",
  );
  const [second, ...after] = (await polled(runs, 4, [first.assignment]))
    .sessions;
  assert.ok(second !== undefined);
  assert.deepEqual(after, []);

  const asked: string[] = [];
  for (const claimed of [first, second]) {
    const from = credentialsAsked.length;
    const answered = await workerPlane.inject({
      method: "POST",
      url: "/v1/session/credential",
      headers: {
        authorization: `Bearer ${claimed.bearer}`,
        [workerContractHeader]: workerContractRelease,
      },
      payload: { repository: "github.com/owner/repo" },
    });
    assert.equal(answered.statusCode, 404);
    const [at, ...others] = credentialsAsked.slice(from);
    assert.ok(at !== undefined);
    assert.deepEqual(others, []);
    asked.push(`${await sessionOf(claimed)}:${at.tenant}/${at.project}`);
  }
  assert.deepEqual(
    new Set(asked),
    new Set([
      `${here.session}:${partition.tenant}/${partition.project}`,
      `${there.session}:${beside.tenant}/${beside.project}`,
    ]),
  );
});

test("a personal runner holds a thread only while it serves the thread's project and is the registration that claimed it, and only that registration's poll is recorded", async () => {
  const { partition, member } = await routedProject("personal-held");
  await waiting(partition, "personal-held", "Thread", member);
  const runs = await personal(partition, member, [
    partition.project,
    (await besideOf(partition, "personal-held-beside")).project,
  ]);
  const held = await claimedOne(runs);
  const stale = { ...runs, principal: principal("stale") };
  const polledAt = async (): Promise<unknown> =>
    (
      await rig.harness.query(
        `SELECT last_polled_at IS NOT NULL AS polled FROM personal_runner
          WHERE tenant=$1 AND owner=$2`,
        [partition.tenant, member],
      )
    )[0]?.["polled"];
  await rig.harness.query(
    `UPDATE personal_runner SET last_polled_at=NULL WHERE tenant=$1 AND owner=$2`,
    [partition.tenant, member],
  );
  await store.polled(stale);
  assert.equal(await polledAt(), false);
  await store.polled(runs);
  assert.equal(await polledAt(), true);

  assert.deepEqual(
    await store.among(runs, [held.assignment]),
    new Set([held.assignment]),
  );
  assert.deepEqual(await store.among(stale, [held.assignment]), new Set());
  assert.equal(
    await personalRegistry.disallow(
      { tenant: partition.tenant, owner: member },
      partition.project,
    ),
    true,
  );
  assert.deepEqual((await polled(runs, 0, [held.assignment])).stop, [
    held.assignment,
  ]);
  assert.equal(
    await workerPoolSettled(ports, runs, held.assignment, {
      outcome: "Accepted",
    }),
    false,
  );
  assert.deepEqual(await workerPoolHeldImages(ports, runs, settings), []);
});

test("removing one of a member's personal runners ends the sessions it held and leaves another's standing, and a pool named as its owner fences none of them", async () => {
  const { partition, member } = await routedProject("personal-fence");
  const key = { tenant: partition.tenant, owner: member };
  const thread = await waiting(partition, "personal-fence", "Thread", member);
  await waiting(partition, "personal-fence-lead", "Lead", member);
  const first = await personal(partition, member);
  const held = await claimedOne(first);
  assert.equal(await runnerClaimed(held), thread.turn);

  const one = { ...settings, sessionsHeldMax: 1 };
  const namesake = await runner(partition, member, member);
  assert.equal(
    (await polled(namesake, 1, [], ports, one)).sessions.length,
    1,
    "a pool was held to the bound of a personal runner named as it is",
  );
  await runner(partition, member, member);
  assert.equal((await attemptOf(held.assignment))["state"], "Running");

  const beside = await besideOf(partition, "personal-fence-beside");
  const another = await waiting(beside, "personal-fence-two", "Thread", member);
  const second = await personal(partition, member, [beside.project]);
  assert.equal(
    (await attemptOf(held.assignment))["state"],
    "Running",
    "registering another runner fenced what the first held",
  );
  const kept = await claimedOne(second);
  assert.equal(await runnerClaimed(kept), another.turn);

  assert.equal(await personalRegistry.deregister(key, first.clientId), true);
  const fenced = await attemptOf(held.assignment);
  assert.deepEqual(
    [fenced["state"], fenced["evidence"]],
    ["Superseded", "Fenced"],
  );
  assert.deepEqual(await turnStanding(partition, thread.session, thread.turn), [
    "Queued",
    null,
    "1",
  ]);
  assert.equal(
    (await attemptOf(kept.assignment))["state"],
    "Running",
    "removing one runner fenced what another of its owner's held",
  );

  assert.equal(await personalRegistry.deregister(key, second.clientId), true);
  const removed = await attemptOf(kept.assignment);
  assert.deepEqual(
    [removed["state"], removed["evidence"]],
    ["Superseded", "Fenced"],
  );
});

/** Each attempt's state and evidence, in the order the assignments are named. */
async function endingsOf(
  assignments: readonly string[],
): Promise<readonly unknown[]> {
  return Promise.all(
    assignments.map(async (assignment) => {
      const attempt = await attemptOf(assignment);
      return [attempt["state"], attempt["evidence"]];
    }),
  );
}

test("registering a member's chat host again ends what the replaced one held, and taking it off ends what it holds, while their personal runner's and their pool's sessions run on and taking the runner off ends none of the host's", async () => {
  const { partition, member, pool } = await routedProject("host-fence");
  const key = { tenant: partition.tenant, owner: member };
  const lead = await waiting(partition, "host-fence-lead", "Lead", member);
  await waiting(partition, "host-fence-thread", "Thread", member);
  await waiting(partition, "host-fence-one", "Inquiry", member, lead.session);
  await waiting(partition, "host-fence-two", "Inquiry", member, lead.session);
  const runs = await personal(partition, member);
  const thread = await claimedOne(runs);
  const led = await claimedOne(pool);
  const one = { ...settings, sessionsHeldMax: 1 };
  const first = await chatHost(partition, member);
  const [replaced] = (await polled(first, 1, [], ports, one)).sessions;
  assert.ok(replaced !== undefined);
  const running = ["Running", null];
  const fenced = ["Superseded", "Fenced"];

  const second = await chatHost(partition, member);
  assert.deepEqual(
    await endingsOf([replaced.assignment, thread.assignment, led.assignment]),
    [fenced, running, running],
  );
  assert.deepEqual((await polled(second, 0, [replaced.assignment])).stop, [
    replaced.assignment,
  ]);
  assert.equal(
    await chatHostRegistry.deregister(key, first.clientId),
    false,
    "a host's removal by the client it replaced was taken",
  );
  const [hosted] = (await polled(second, 1, [], ports, one)).sessions;
  assert.ok(hosted !== undefined);

  assert.equal(await personalRegistry.deregister(key, runs.clientId), true);
  assert.deepEqual(await endingsOf([thread.assignment, hosted.assignment]), [
    fenced,
    running,
  ]);
  await runner(partition, member, pool.pool);
  assert.deepEqual(await endingsOf([led.assignment, hosted.assignment]), [
    fenced,
    running,
  ]);
  await backdated(led.assignment, "ended_at", launch.placementBackoffSecs + 1);
  const another = await runner(partition, member);
  const [reled] = (await polled(another, 1)).sessions;
  assert.ok(reled !== undefined);

  assert.equal(await chatHostRegistry.deregister(key, second.clientId), true);
  assert.deepEqual(await endingsOf([hosted.assignment, reled.assignment]), [
    fenced,
    running,
  ]);
});

test("a chat host is handed its member's sessions in every project of the tenant they may read, with no project named to it", async () => {
  const { partition, member } = await routedProject("host-projects");
  const beside = await besideOf(partition, "host-projects-beside");
  const unread = await besideOf(partition, "host-projects-unread");
  const here = await waiting(partition, "host-projects-here", "Thread", member);
  const there = await waiting(beside, "host-projects-there", "Thread", member);
  const lead = await waiting(unread, "host-projects-lead", "Lead", member);
  const kept = await waiting(
    unread,
    "host-projects-kept",
    "Inquiry",
    member,
    lead.session,
  );
  const host = await chatHost(partition, member);
  const asked: string[] = [];
  const reading: WorkerPoolPorts = {
    ...ports,
    access: {
      ...readingEverything,
      authorize: (caller, at, kind) => {
        asked.push(`${caller}:${at.project}:${kind}`);
        return Promise.resolve(
          at.project === unread.project ? undefined : memberAuthority(caller),
        );
      },
    },
  };
  const handed = await Promise.all(
    (await polled(host, 4, [], reading)).sessions.map(sessionOf),
  );
  assert.deepEqual(new Set(handed), new Set([here.session, there.session]));
  assert.deepEqual(
    new Set(asked),
    new Set(
      [partition, beside, unread].map(
        ({ project }) => `${member}:${project}:Read`,
      ),
    ),
  );
  assert.deepEqual(
    await rig.harness.query(
      `SELECT assignment FROM session_attempt WHERE session=$1`,
      [kept.session],
    ),
    [],
  );
});

test("a chat host's declared idle bound is recorded on its claim capped at the scheduler's, launched as its idle limit, and is what the idle reaper ends its attempt by", async () => {
  const { partition, member, pool } = await routedProject("host-idle");
  const lead = await waiting(partition, "host-idle-lead", "Lead", member);
  await waiting(partition, "host-idle-thread", "Thread", member);
  await waiting(
    partition,
    "host-idle-inquiry",
    "Inquiry",
    member,
    lead.session,
  );
  const host = await chatHost(partition, member);
  const declared = async (idleSecs: number): Promise<string> => {
    const answered = await workerPoolPoll(
      ports,
      host,
      { held: [], wanted: 0, wantedSessions: 1, idleSecs },
      settings,
    );
    if (answered.polled !== "Answered")
      throw new Error(`pool session suite: a poll answered ${answered.polled}`);
    const [claimed, ...more] = answered.answer.sessions;
    assert.deepEqual(more, []);
    assert.ok(claimed !== undefined);
    return claimed.assignment;
  };
  const short = await declared(600);
  const long = await declared(7200);
  const pooled = (await claimedOne(pool)).assignment;
  const bound = async (assignment: string): Promise<readonly unknown[]> => {
    const attempt = await attemptOf(assignment);
    const launched = documentOf(attempt["launch"]);
    return [attempt["idle_secs"], documentOf(launched["bounds"])["idleMs"]];
  };
  assert.deepEqual(await bound(short), ["600", 600_000]);
  assert.deepEqual(await bound(long), ["1800", 1_800_000]);
  assert.deepEqual(await bound(pooled), [null, launch.bounds.idleMs]);

  for (const assignment of [short, long, pooled])
    await backdated(assignment, "idle_since", 700);
  assert.equal(
    await rig.scheduler.reapIdleAttempts(rig.epoch, 3600, sessionRigBoundless),
    1,
  );
  assert.deepEqual(await endingsOf([short, long, pooled]), [
    ["Lost", "SessionIdle"],
    ["Running", null],
    ["Running", null],
  ]);
});

test("an attempt a pool claimed under an epoch since restored away is no longer held, renewed or pulled for", async () => {
  const { partition, member, pool } = await routedProject("pool-epoch");
  await waiting(partition, "epoch", "Lead", member);
  const held = await claimedOne(pool);
  await rig.harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  assert.deepEqual((await polled(pool, 0, [held.assignment])).stop, [
    held.assignment,
  ]);
  assert.equal(
    await workerPoolSettled(ports, pool, held.assignment, {
      outcome: "Accepted",
    }),
    false,
  );
  assert.deepEqual(await workerPoolHeldImages(ports, pool, settings), []);
});
