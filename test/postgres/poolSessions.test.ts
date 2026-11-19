/**
 * A runner's claim of a session, against a real PostgreSQL and under the roles a
 * deployment runs: a member's chat host claims their threads through the pool
 * plane's role, while their personal runner claims none;
 * the worker plane serves the attempt a claim opened, and the scheduler's
 * sweeps reach it. Each case holds a project of its own.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { sessionAttemptMint } from "../../src/adapters/crypto/sessionAttemptMint.ts";
import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import { postgresChatHostRegistry } from "../../src/adapters/postgres/chatHost.ts";
import { postgresPersonalRunnerRegistry } from "../../src/adapters/postgres/personalRunner.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  apiRole,
  poolPlaneRole,
  schedulerRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresSessionPlacement } from "../../src/adapters/postgres/sessionPlacement.ts";
import {
  postgresSessionBearerAuthority,
  postgresSessionPlane,
} from "../../src/adapters/postgres/sessionPlane.ts";
import { postgresThreads } from "../../src/adapters/postgres/thread.ts";
import { postgresWorkerTasks } from "../../src/adapters/postgres/workerPlane.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRunners,
} from "../../src/adapters/postgres/workerPool.ts";
import { postgresWorkerPoolSessions } from "../../src/adapters/postgres/workerPoolSessions.ts";
import { sessionBearerPattern } from "../../src/contract/sessionPlane.ts";
import {
  workerContractHeader,
  workerContractRelease,
} from "../../src/contract/workerContract.ts";
import {
  workerPoolPollIdleSecsMax,
  type WorkerPoolReconciliation,
  type WorkerPoolSessionAssignment,
} from "../../src/contract/workerPool.ts";
import {
  asSessionBearerSecret,
  asSessionId,
  asSessionTurnId,
  memberScopePartition,
  type SessionId,
  type SessionCapability,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
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
  type PoolPlaneIdentity,
  type WorkerPoolPollSettings,
  type WorkerPoolPorts,
} from "../../src/interpreter/workerPool.ts";
import { asPlacementId } from "../../src/interpreter/schedulerIdentity.ts";
import { asThreadOpenKey } from "../../src/interpreter/threadRead.ts";
import { sessionTaskInvocation } from "../../src/interpreter/workerTask.ts";
import type {
  WorkerPoolSessionCandidate,
  WorkerPoolSessionClaimant,
  WorkerPoolSessionOpened,
} from "../../src/interpreter/workerPoolSessions.ts";
import { planeListening } from "../adapters/planeBodies.ts";
import {
  inertSessionPlane,
  inertWorkerPlane,
} from "../adapters/workerPlaneFixtures.ts";
import {
  agentAccountHarnessCommitted,
  agentAccountHarnessCredentialsOver,
} from "./agentAccountHarness.ts";
import {
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessStalled,
  type PostgresTransaction,
} from "./harness.ts";
import {
  sessionRigAttempt,
  sessionRigAttemptState,
  sessionRigBoundless,
  sessionRigLaunch,
  sessionRigLaunchMet,
  sessionRigReadingEverything,
  sessionRigOpen,
  sessionRigProject,
  sessionRigQueuedFor,
  sessionRigRouted,
  sessionRigSession,
  sessionRigTurn,
  sessionRigTurnState,
} from "./sessionHarness.ts";
import { workerContractPeerNaming } from "../interpreter/workerContractPeerFixture.ts";

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

const launch = sessionRigLaunch;
await sessionRigLaunchMet(schedulerPool);

const readingEverything = sessionRigReadingEverything;

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

/** A project whose sessions run on runners, with a member. */
async function hostedProject(label: string): Promise<{
  readonly partition: Partition;
  readonly member: Principal;
}> {
  const partition = await sessionRigProject(rig, label);
  await sessionRigRouted(rig, partition, "Pool");
  return { partition, member: principal(`member-${label}`) };
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
  await sessionRigRouted(rig, beside, "Pool");
  return beside;
}

/** A thread held by `holder` with one turn queued. */
async function waiting(
  partition: Partition,
  label: string,
  holder: Principal,
): Promise<{ readonly session: SessionId; readonly turn: SessionTurnId }> {
  const session = await sessionRigSession(rig, partition, label, {
    principal: holder,
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
            idle_unbounded,pool_principal::text AS pool_principal,pool_refusal,image,launch,
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
  by: "assignment" | "attempt" = "assignment",
): Promise<void> {
  const backdating = await rig.harness.begin();
  const fence = "TRIGGER session_attempt_is_fenced";
  await committedAfter(backdating, async () => {
    await backdating.query(`ALTER TABLE session_attempt DISABLE ${fence}`);
    await backdating.query(
      `UPDATE session_attempt SET ${column}=now()-make_interval(secs=>$2)
        WHERE ${by}=$1`,
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
  const host = await chatHost(partition, member);
  const inCluster = await waiting(partition, "claim-cluster", member);
  assert.deepEqual((await polled(host, 4)).sessions, []);
  await sessionRigRouted(rig, partition, "Pool");
  await sessionRigTurn(rig, partition, inCluster.session, "claim-behind");
  const offered = await waiting(partition, "claim-pool", member);

  const [claimed, ...more] = (await polled(host, 4)).sessions;
  assert.deepEqual(more, []);
  assert.ok(claimed !== undefined);
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
    idle_unbounded: true,
    pool_principal: host.principal,
    pool_refusal: null,
    image: launch.image,
    launch: {
      api: { url: settings.sessionApiUrl },
      bounds: {
        mailboxPollMs: launch.bounds.mailboxPollMs,
        resultDrainMs: launch.bounds.resultDrainMs,
        loadTimeoutMs: launch.bounds.loadTimeoutMs,
        turnsMax: launch.bounds.turnsMax,
        budgetUsd: launch.bounds.budgetUsd,
      },
      model: launch.model,
    },
    lease_owner: member,
    idle: true,
    lease: opened["lease"],
  });
  assert.equal(await runnerClaimed(claimed), offered.turn);
  assert.deepEqual((await polled(host, 4, [claimed.assignment])).sessions, []);
});

test("every attempt a chat host opens names its holder's kind, its holder and the principal that claimed, a personal runner opens none, and an attempt in the cluster names none", async () => {
  const partition = await sessionRigProject(rig, "pool-holders");
  await sessionRigRouted(rig, partition, "Pool");
  const runs = principal("member-holders-runs");
  const hosts = principal("member-holders-hosts");
  await waiting(partition, "holders-runs", runs);
  await waiting(partition, "holders-hosts", hosts);
  await waiting(partition, "holders-hosts-second", hosts);
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
  assert.deepEqual(await holders(personalRunner), []);
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

test("a thread is handed to its member's chat host alone, never to their personal runner, and nothing to another project's", async () => {
  const partition = await sessionRigProject(rig, "pool-whose");
  await sessionRigRouted(rig, partition, "Pool");
  const member = principal("member-whose");
  const other = principal("other-whose");
  const thread = await waiting(partition, "whose-thread", member);
  const elsewhere = await sessionRigProject(rig, "pool-whose-elsewhere");
  await sessionRigRouted(rig, elsewhere, "Pool");
  const handed = async (pool: PoolPlaneIdentity) =>
    new Set(await Promise.all((await polled(pool, 4)).sessions.map(sessionOf)));

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
    await handed(await personal(partition, member)),
    new Set(),
    "a personal runner was handed its owner's thread while they have no chat host",
  );
  assert.deepEqual(
    await handed(await chatHost(partition, member)),
    new Set([thread.session]),
  );
});

test("a member's live personal runner is handed none of their threads whether their chat host is absent, never polled, live or stopped, and their chat host is handed them in every case", async () => {
  const { partition, member } = await hostedProject("pool-precedence");
  const thread = await waiting(partition, "precedence", member);
  const runs = await personal(partition, member);
  const nothing = async (when: string) => {
    assert.deepEqual((await polled(runs, 4)).sessions, [], when);
  };
  await nothing("with no chat host");
  const host = await chatHost(partition, member);
  await nothing("with a chat host that never polled");
  await hostPolled(host);
  await nothing("with a live chat host");
  await hostPolled(host, sessionRunnerPolledSecsMax + 1);
  await nothing("with a stopped chat host");
  assert.deepEqual(
    new Set(await Promise.all((await polled(host, 4)).sessions.map(sessionOf))),
    new Set([thread.session]),
    "a stopped chat host coming back was not handed what waited",
  );
});

/** A project with a thread its member holds, with a turn queued for runners. */
async function confinedProject(label: string): Promise<{
  readonly partition: Partition;
  readonly member: Principal;
  readonly thread: SessionId;
}> {
  const partition = await sessionRigProject(rig, label);
  await sessionRigRouted(rig, partition, "Pool");
  const member = principal(`member-${label}`);
  const thread = await waiting(partition, `${label}-thread`, member);
  return { partition, member, thread: thread.session };
}

async function awaitingOf(
  pool: WorkerPoolSessionClaimant,
): Promise<ReadonlySet<SessionId>> {
  return new Set(
    (await store.awaiting(pool, launch.placementBackoffSecs, 4, true)).map(
      ({ session }) => session,
    ),
  );
}

/** Opens `candidate` through `pool` as a claim would, whichever runner read it as waiting. */
async function openedFor(
  pool: WorkerPoolSessionClaimant,
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

test("a thread is read as waiting by its member's chat host alone", async () => {
  const { partition, member, thread } = await confinedProject("pool-read");
  assert.deepEqual(
    await awaitingOf(await chatHost(partition, principal("other-read"))),
    new Set(),
  );
  assert.deepEqual(
    await awaitingOf(await chatHost(partition, member)),
    new Set([thread]),
  );
});

/** The candidate each session was read as by one of `readers`, refusing a session none read. */
async function candidatesRead(
  readers: readonly WorkerPoolSessionClaimant[],
): Promise<(session: SessionId) => WorkerPoolSessionCandidate> {
  const read: WorkerPoolSessionCandidate[] = [];
  for (const reader of readers)
    read.push(
      ...(await store.awaiting(reader, launch.placementBackoffSecs, 4, true)),
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
  refused: readonly (readonly [WorkerPoolSessionClaimant, SessionId, string])[],
): Promise<void> {
  for (const [opening, session, refusal] of refused)
    assert.equal(
      await openedFor(opening, candidate(session)),
      "NotClaimable",
      refusal,
    );
}

test("a session read as waiting by the runner it is for is opened by no chat host it is not for", async () => {
  const { partition, member, thread } = await confinedProject("host-open");
  const host = await chatHost(partition, member);
  const candidate = await candidatesRead([host]);
  const other = await chatHost(partition, principal("other-open"));
  await hostPolled(host);
  await openedByNone(candidate, [
    [other, thread, "a chat host opened another member's thread"],
  ]);
  assert.equal(await openedFor(host, candidate(thread)), "Opened");
});

test("a chat host holds no more sessions than its bound, and a session is not handed out while an attempt holds it or its backoff runs", async () => {
  const { partition, member } = await hostedProject("pool-bound");
  const thread = await waiting(partition, "bound-thread", member);
  const host = await chatHost(partition, member);
  const one = { ...settings, sessionsHeldMax: 1 };
  await waiting(partition, "bound-second", member);
  const [first] = (await polled(host, 1, [], ports, one)).sessions;
  assert.ok(first !== undefined);
  assert.deepEqual(
    (await polled(host, 1, [first.assignment], ports, one)).sessions,
    [],
    "a chat host was handed one past its bound",
  );
  const [second] = (await polled(host, 4, [first.assignment])).sessions;
  assert.ok(second !== undefined);
  assert.deepEqual(
    (await polled(host, 4, [first.assignment, second.assignment])).sessions,
    [],
    "a session was handed out while held",
  );
  const [assignment, other] =
    (await sessionOf(first)) === thread.session
      ? [first.assignment, second.assignment]
      : [second.assignment, first.assignment];
  assert.equal(
    await workerPoolSettled(ports, host, assignment, {
      outcome: "Unavailable",
    }),
    true,
  );
  assert.deepEqual(
    (await polled(host, 4, [other])).sessions,
    [],
    "a session was handed out inside its backoff",
  );
  await backdated(assignment, "ended_at", launch.placementBackoffSecs + 1);
  const [again] = (await polled(host, 4, [other])).sessions;
  assert.ok(again !== undefined);
  assert.equal(await sessionOf(again), thread.session);
});

test("renewal keeps a held session's lease, and one an idle reap ended is to be stopped", async () => {
  const { partition, member } = await hostedProject("host-renew");
  await waiting(partition, "renew", member);
  const host = await chatHost(partition, member);
  const held = await hostClaimedDeclaring(host, [], 600);
  await backdated(held, "lease_expires_at", -5);
  const short = (await attemptOf(held))["lease"];
  assert.deepEqual((await polled(host, 0, [held])).stop, []);
  assert.notEqual((await attemptOf(held))["lease"], short);

  await backdated(held, "idle_since", 3600);
  assert.equal(
    await rig.scheduler.reapIdleAttempts(rig.epoch, 1800, sessionRigBoundless),
    1,
  );
  assert.deepEqual([(await attemptOf(held))["evidence"]], ["SessionIdle"]);
  assert.deepEqual((await polled(host, 0, [held])).stop, [held]);
});

test("a held session that closes, or whose project is suspended, is to be stopped", async () => {
  const { partition, member } = await hostedProject("host-closed");
  const host = await chatHost(partition, member);
  await waiting(partition, "closed-kept", member);
  const thread = await waiting(partition, "closed-thread", member);
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

test("a chat host's poll ends Lost, as Vanished, an attempt it holds and does not list, releasing its claimed turn, renews one it lists, and leaves one it opens", async () => {
  const { partition, member } = await hostedProject("host-unlisted");
  const host = await chatHost(partition, member);
  const dropped = await waiting(partition, "unlisted-dropped", member);
  await waiting(partition, "unlisted-listed", member);
  const [first, second] = (await polled(host, 2)).sessions;
  assert.ok(first !== undefined && second !== undefined);
  const [gone, kept] =
    (await sessionOf(first)) === dropped.session
      ? [first, second]
      : [second, first];
  assert.equal(await runnerClaimed(gone), dropped.turn);
  await backdated(kept.assignment, "lease_expires_at", -5);
  const short = (await attemptOf(kept.assignment))["lease"];
  await waiting(partition, "unlisted-opened", member);

  const answered = await polled(host, 1, [kept.assignment]);
  const [opened, ...more] = answered.sessions;
  assert.ok(opened !== undefined, "the poll opened no attempt");
  assert.deepEqual(more, []);
  assert.deepEqual(answered.stop, []);
  assert.deepEqual(
    await endingsOf([gone.assignment, kept.assignment, opened.assignment]),
    [
      ["Lost", "Vanished"],
      ["Running", null],
      ["Running", null],
    ],
  );
  assert.notEqual((await attemptOf(kept.assignment))["lease"], short);
  assert.equal(
    (await turnStanding(partition, dropped.session, dropped.turn))[0],
    "Queued",
  );
});

/**
 * Neither reaper filters on the holder, and the cluster observes no pod a chat
 * host holds, so on a closed session the reapers are what end its attempt.
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
    const label = `host-reaped-closed-${column}`.replaceAll("_", "-");
    const { partition, member } = await hostedProject(label);
    const { session } = await waiting(partition, label, member);
    const held = await hostClaimedDeclaring(
      await chatHost(partition, member),
      [],
      600,
    );
    await rig.sessions.close(partition, session);
    await backdated(held, column, 3600);
    assert.equal(await reaped(), 1, column);
    assert.deepEqual(
      await endingsOf([held]),
      [["Lost", "SessionClosed"]],
      column,
    );
  }
});

test("an accepted session writes nothing, an unavailable one is withdrawn with its turn uncharged, and a refused one ends charged with its refusal recorded", async () => {
  const { partition, member } = await hostedProject("host-settle");
  const host = await chatHost(partition, member);
  await waiting(partition, "settle-thread", member);
  await waiting(partition, "settle-second", member);
  await waiting(partition, "settle-third", member);
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

test("only a poll that could take a session marks a runner live, and a member's own runner is their chat host alone, never their personal runner however live it is", async () => {
  const { partition, member } = await hostedProject("pool-live");
  const standing = () =>
    postgresSessionPlacement(apiPool).runners(partition, member);
  const unregistered = { mine: "Unregistered", inquiry: "Unregistered" };
  assert.deepEqual(await standing(), unregistered);

  const runs = await personal(partition, member);
  await polled(runs, 1);
  assert.deepEqual(
    await standing(),
    unregistered,
    "a member's live personal runner stood for their sessions",
  );

  const host = await chatHost(partition, member);
  const hosted = { mine: "Offline", inquiry: "Offline" };
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
  await chatHost(partition, member);
  await polled(runs, 1);
  assert.deepEqual(
    await standing(),
    hosted,
    "a member's live personal runner stood beside a chat host offline",
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

test("a chat host's attempt's task names what it is launched with to a release whose runners launch sessions, and an in-cluster attempt's names nothing more", async () => {
  const { partition, member } = await hostedProject("host-task");
  await waiting(partition, "task", member);
  const held = await claimedOne(await chatHost(partition, member));
  const launched = documentOf((await attemptOf(held.assignment))["launch"]);
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
      bounds: launched["bounds"],
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
  const { partition, member } = await hostedProject("host-unclaimed");
  const host = await chatHost(partition, member);
  const { session, turn } = await waiting(partition, "unclaimed", member);
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
    const held = await claimedOne(host);
    assert.equal(
      await workerPoolSettled(ports, host, held.assignment, settlement),
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
  const { partition, member } = await hostedProject("host-dwell");
  const host = await chatHost(partition, member);
  const { session, turn } = await waiting(partition, "dwell", member);
  await sessionRigQueuedFor(rig, turn, 2 * sessionPoolTurnDwellSecs);
  const held = await claimedOne(host);
  assert.equal(await runnerClaimed(held), turn);
  assert.equal(await withdrawn(), 0, "a turn was withdrawn under its attempt");
  assert.equal(
    await workerPoolSettled(ports, host, held.assignment, {
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
  const { partition, member } = await hostedProject("host-exclusive");
  const host = await chatHost(partition, member);
  const first = await waiting(partition, "exclusive-first", member);
  await sessionRigQueuedFor(rig, first.turn, 2 * sessionPoolTurnDwellSecs);
  const withdrawing = await rig.harness.begin();
  await withdrawing.query(`SELECT withdraw_unserved_pool_turns($1,$2,$3)`, [
    rig.epoch,
    sessionPoolTurnDwellSecs,
    sessionRigBoundless,
  ]);
  const lateClaim = polled(host);
  await committedAfter(withdrawing, () =>
    postgresHarnessStalled(rig.harness.pool, 1),
  );
  assert.deepEqual((await lateClaim).sessions, []);
  assert.deepEqual(await turnStanding(partition, first.session, first.turn), [
    "Abandoned",
    "TurnWithdrawn",
    "0",
  ]);

  const second = await waiting(partition, "exclusive-second", member);
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

test("a chat host runs the session it is handed through its turn, its end ends the attempt, and its next poll is handed and told to stop nothing", async () => {
  const { partition, member } = await hostedProject("pool-runner");
  const host = await chatHost(partition, member);
  const { session, turn } = await waiting(partition, "runner", member);
  const held = await claimedOne(host);
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
  const ended = await workerPlane.inject({
    method: "POST",
    url: "/v1/session/ended",
    headers: {
      authorization: `Bearer ${held.bearer}`,
      [workerContractHeader]: workerContractRelease,
    },
    payload: { phase: "Succeeded" },
  });
  assert.equal(ended.statusCode, 204);
  assert.deepEqual([(await attemptOf(held.assignment))["state"]], ["Lost"]);
  const next = await polled(host);
  assert.deepEqual([next.sessions, next.stop], [[], []]);
});

test("a personal runner's poll with room for a session asks the authority nothing of one and opens nothing for its owner's waiting thread", async () => {
  const { partition, member } = await hostedProject("personal-read");
  const thread = await waiting(partition, "personal-read", member);
  const runs = await personal(partition, member);
  const asked: string[] = [];
  const asking: WorkerPoolPorts = {
    ...ports,
    access: {
      ...readingEverything,
      authorize: (caller, at, kind) => {
        asked.push(`${caller}:${at.project}:${kind}`);
        return Promise.resolve(memberAuthority(caller));
      },
    },
  };
  assert.deepEqual((await polled(runs, 4, [], asking)).sessions, []);
  assert.deepEqual(asked, []);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT assignment FROM session_attempt WHERE session=$1`,
      [thread.session],
    ),
    [],
  );
});

test("a chat host's room spans every project of its tenant, and each session's credential is asked in that session's own project", async () => {
  const { partition, member } = await hostedProject("host-room");
  const beside = await besideOf(partition, "host-room-beside");
  const here = await waiting(partition, "host-here", member);
  const there = await waiting(beside, "host-there", member);
  const host = await chatHost(partition, member);
  const one = { ...settings, sessionsHeldMax: 1 };
  const [first, ...more] = (await polled(host, 4, [], ports, one)).sessions;
  assert.ok(first !== undefined);
  assert.deepEqual(more, []);
  assert.deepEqual(
    (await polled(host, 4, [first.assignment], ports, one)).sessions,
    [],
    "a chat host was handed one past its bound in another project",
  );
  const [second, ...after] = (await polled(host, 4, [first.assignment]))
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

test("a personal runner holds no session: one it names is told to stop, settles nothing and pins no image, its poll is still recorded, and its owner's chat host holds it on", async () => {
  const { partition, member } = await hostedProject("personal-holds-none");
  await waiting(partition, "personal-holds-none", member);
  const runs = await personal(partition, member);
  const held = await claimedOne(await chatHost(partition, member));
  const polledAt = async (): Promise<readonly unknown[]> =>
    rig.harness.query(
      `SELECT last_polled_at IS NOT NULL AS polled
         FROM personal_runner WHERE tenant=$1 AND owner=$2`,
      [partition.tenant, member],
    );
  await rig.harness.query(
    `UPDATE personal_runner SET last_polled_at=NULL WHERE tenant=$1 AND owner=$2`,
    [partition.tenant, member],
  );

  assert.deepEqual((await polled(runs, 1, [held.assignment])).stop, [
    held.assignment,
  ]);
  assert.equal(
    await workerPoolSettled(ports, runs, held.assignment, {
      outcome: "Accepted",
    }),
    false,
  );
  assert.deepEqual(await workerPoolHeldImages(ports, runs, settings), []);
  assert.deepEqual(await polledAt(), [{ polled: true }]);
  assert.deepEqual(await endingsOf([held.assignment]), [["Running", null]]);
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

test("registering a member's chat host again ends what the replaced one held, and taking it off ends what it holds, while taking their personal runner off ends none of the host's", async () => {
  const { partition, member } = await hostedProject("host-fence");
  const key = { tenant: partition.tenant, owner: member };
  await waiting(partition, "host-fence-thread", member);
  await waiting(partition, "host-fence-one", member);
  const runs = await personal(partition, member);
  const one = { ...settings, sessionsHeldMax: 1 };
  const first = await chatHost(partition, member);
  const [replaced] = (await polled(first, 1, [], ports, one)).sessions;
  assert.ok(replaced !== undefined);
  const running = ["Running", null];
  const fenced = ["Superseded", "Fenced"];

  const second = await chatHost(partition, member);
  assert.deepEqual(await endingsOf([replaced.assignment]), [fenced]);
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
  assert.deepEqual(await endingsOf([hosted.assignment]), [running]);

  assert.equal(await chatHostRegistry.deregister(key, second.clientId), true);
  assert.deepEqual(await endingsOf([hosted.assignment]), [fenced]);
});

test("a chat host is handed its member's sessions in every project of the tenant they may read, with no project named to it", async () => {
  const { partition, member } = await hostedProject("host-projects");
  const beside = await besideOf(partition, "host-projects-beside");
  const unread = await besideOf(partition, "host-projects-unread");
  const here = await waiting(partition, "host-projects-here", member);
  const there = await waiting(beside, "host-projects-there", member);
  const kept = await waiting(unread, "host-projects-kept", member);
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

/** The one session `host` is claimed by a poll declaring `idleSecs`, or declaring none. */
async function hostClaimedDeclaring(
  host: PoolPlaneIdentity,
  held: readonly string[],
  idleSecs?: number,
): Promise<string> {
  const answered = await workerPoolPoll(
    ports,
    host,
    {
      held,
      wanted: 0,
      wantedSessions: 1,
      ...(idleSecs === undefined ? {} : { idleSecs }),
    },
    settings,
  );
  if (answered.polled !== "Answered")
    throw new Error(`pool session suite: a poll answered ${answered.polled}`);
  const [claimed, ...more] = answered.answer.sessions;
  assert.deepEqual(more, []);
  assert.ok(claimed !== undefined);
  return claimed.assignment;
}

/** The idle bound an attempt records, whether it records none, and the idle limit it was launched with. */
async function idleBoundOf(assignment: string): Promise<readonly unknown[]> {
  const attempt = await attemptOf(assignment);
  const bounds = documentOf(documentOf(attempt["launch"])["bounds"]);
  return [
    attempt["idle_secs"],
    attempt["idle_unbounded"],
    "idleMs" in bounds,
    bounds["idleMs"],
  ];
}

test("a chat host's declared idle bound is recorded on its claim as named, above the scheduler's window too, and launched as its idle limit, one naming none is launched with none and never idle-reaped", async () => {
  const { partition, member } = await hostedProject("host-idle");
  await waiting(partition, "host-idle-short", member);
  await waiting(partition, "host-idle-long", member);
  await waiting(partition, "host-idle-unbounded", member);
  const host = await chatHost(partition, member);
  const windowSecs = 300;
  const short = await hostClaimedDeclaring(host, [], 600);
  const long = await hostClaimedDeclaring(host, [short], 7200);
  const unbounded = await hostClaimedDeclaring(host, [short, long]);
  assert.deepEqual(await idleBoundOf(short), ["600", false, true, 600_000]);
  assert.deepEqual(await idleBoundOf(long), ["7200", false, true, 7_200_000]);
  assert.deepEqual(await idleBoundOf(unbounded), [
    null,
    true,
    false,
    undefined,
  ]);

  const reaped = (): Promise<number> =>
    rig.scheduler.reapIdleAttempts(rig.epoch, windowSecs, sessionRigBoundless);
  for (const assignment of [short, long, unbounded])
    await backdated(assignment, "idle_since", windowSecs - 60);
  assert.equal(await reaped(), 0);
  for (const assignment of [short, long, unbounded])
    await backdated(assignment, "idle_since", 700);
  assert.equal(await reaped(), 1);
  assert.deepEqual(await endingsOf([short, long, unbounded]), [
    ["Lost", "SessionIdle"],
    ["Running", null],
    ["Running", null],
  ]);
  const yearSecs = 365 * 24 * 3600;
  for (const assignment of [long, unbounded])
    await backdated(assignment, "idle_since", 10 * yearSecs);
  assert.equal(await reaped(), 1);
  assert.deepEqual(await endingsOf([long, unbounded]), [
    ["Lost", "SessionIdle"],
    ["Running", null],
  ]);
});

test("an attempt recorded with the longest idle bound a poll admits does not stop the reaper ending another past the scheduler's window, and an attempt cannot record a longer one", async () => {
  const { partition, member } = await hostedProject("host-idle-max");
  await waiting(partition, "host-idle-max-thread", member);
  const host = await chatHost(partition, member);
  const longest = await hostClaimedDeclaring(
    host,
    [],
    workerPoolPollIdleSecsMax,
  );
  assert.equal(
    (await attemptOf(longest))["idle_secs"],
    String(workerPoolPollIdleSecsMax),
  );
  const elsewhere = await sessionRigProject(rig, "host-idle-max-cluster");
  const session = await sessionRigSession(rig, elsewhere, "idle-max-cluster");
  await sessionRigTurn(rig, elsewhere, session, "idle-max-cluster");
  const pod = await sessionRigAttempt(rig, elsewhere, session, "idle-max");
  await rig.scheduler.attemptPlaced(
    pod.attempt,
    asPlacementId("placement-idle-max"),
  );
  const windowSecs = 300;
  await backdated(longest, "idle_since", windowSecs + 60);
  await backdated(
    pod.attempt.attempt,
    "idle_since",
    windowSecs + 60,
    "attempt",
  );
  assert.equal(
    await rig.scheduler.reapIdleAttempts(
      rig.epoch,
      windowSecs,
      sessionRigBoundless,
    ),
    1,
  );
  assert.deepEqual(await endingsOf([longest]), [["Running", null]]);
  const reaped = await sessionRigAttemptState(rig, pod.attempt);
  assert.deepEqual(
    [reaped["state"], reaped["evidence"]],
    ["Lost", "SessionIdle"],
  );

  const lengthening = await rig.harness.begin();
  await assert.rejects(
    committedAfter(lengthening, async () => {
      await lengthening.query(
        `ALTER TABLE session_attempt DISABLE TRIGGER session_attempt_is_fenced`,
      );
      await lengthening.query(
        `UPDATE session_attempt SET idle_secs=$2 WHERE assignment=$1`,
        [longest, workerPoolPollIdleSecsMax + 1],
      );
    }),
    { code: "23514" },
  );
});

/** A limit on `member`'s Claude whose reset is ahead, under the threads option named. */
function claudePaused(
  member: Principal,
  options: { readonly pausesThreads: boolean },
): Promise<void> {
  return agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    limit: { observedSecs: -60, resetsSecs: 3600 },
    setting: { fiveHourPercent: 80, sevenDayPercent: 90, ...options },
  });
}

test("a chat host claims its owner's thread while their Claude is paused, and none once threads pause", async () => {
  const partition = await sessionRigProject(rig, "host-paused");
  await sessionRigRouted(rig, partition, "Pool");
  const member = principal("member-host-paused");
  const host = await chatHost(partition, member);
  const thread = await waiting(partition, "paused-thread", member);
  const read = await candidatesRead([host]);
  await claudePaused(member, { pausesThreads: false });
  assert.deepEqual(
    await awaitingOf(host),
    new Set([thread.session]),
    "threads do not pause by default",
  );
  await claudePaused(member, { pausesThreads: true });
  assert.deepEqual(await awaitingOf(host), new Set());
  assert.equal(await openedFor(host, read(thread.session)), "NotClaimable");
  await agentAccountHarnessCommitted(rig.harness, member, "Codex", {
    limit: { observedSecs: -60, resetsSecs: 3600 },
  });
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    setting: {
      fiveHourPercent: 80,
      sevenDayPercent: 90,
      pausesThreads: true,
    },
  });
  assert.deepEqual(
    await awaitingOf(host),
    new Set([thread.session]),
    "a session spends Claude, so Codex paused holds none back",
  );
});

/** One case of a session's claim under named credentials: why, the Claude credentials its runner named, those of them or others paused, its owner's threads option, and whether the session is taken. */
type SessionNamedCase = readonly [
  string,
  readonly string[] | undefined,
  readonly string[],
  boolean,
  boolean,
];

/**
 * Whether a thread, its chat host's member's own, is taken once the host has
 * named `named` of Claude, `paused` of that member's Claude credentials are
 * each over a threshold and `off` are turned off: both the waiting read and
 * the opening one are asked, and refused where they disagree.
 */
async function sessionNamedTaken(
  [why, named, paused, pausesThreads]: SessionNamedCase,
  off: readonly string[] = [],
): Promise<boolean> {
  const label = `named-thread-${randomUUID()}`;
  const partition = await sessionRigProject(rig, label);
  await sessionRigRouted(rig, partition, "Pool");
  const member = principal(`member-${label}`);
  const claimant = await chatHost(partition, member);
  await hostPolled(claimant);
  const { session } = await waiting(partition, label, member);
  const candidate = (await candidatesRead([claimant]))(session);
  await ports.runners.named(
    claimant,
    undefined,
    undefined,
    undefined,
    false,
    named === undefined ? {} : { Claude: [...named] },
  );
  await agentAccountHarnessCommitted(rig.harness, member, "Claude", {
    ...agentAccountHarnessCredentialsOver(
      Object.fromEntries(paused.map((credential) => [credential, 3600])),
    ),
    setting: { fiveHourPercent: 80, sevenDayPercent: 90, pausesThreads },
    off,
  });
  const read = (await awaitingOf(claimant)).has(session);
  assert.equal(
    (await openedFor(claimant, candidate)) === "Opened",
    read,
    `${why}: the opening agrees with the waiting read`,
  );
  return read;
}

test("a chat host takes its owner's thread while any Claude credential it named is free where threads pause, and always where they do not", async () => {
  for (const named of [
    ["one of two named paused", ["work", "home"], ["work"], true, true],
    ["both named paused", ["work", "home"], ["work", "home"], true, false],
    ["none named and one paused", undefined, ["work"], true, false],
    [
      "both named paused, threads not pausing",
      ["work", "home"],
      ["work", "home"],
      false,
      true,
    ],
    [
      "none named and one paused, threads not pausing",
      undefined,
      ["work"],
      false,
      true,
    ],
  ] as const satisfies readonly SessionNamedCase[])
    assert.equal(await sessionNamedTaken(named), named[4], named[0]);
});

test("a chat host takes no thread of its owner while every Claude credential it named is off, whatever their setting, and takes it once one is on", async () => {
  for (const pausesThreads of [true, false]) {
    const all = [
      `all named off, threads pausing ${String(pausesThreads)}`,
      ["work", "home"],
      [],
      pausesThreads,
      false,
    ] as const satisfies SessionNamedCase;
    assert.equal(await sessionNamedTaken(all, ["work", "home"]), false, all[0]);
    const one = [
      `one named off, threads pausing ${String(pausesThreads)}`,
      ["work", "home"],
      [],
      pausesThreads,
      true,
    ] as const satisfies SessionNamedCase;
    assert.equal(await sessionNamedTaken(one, ["work"]), true, one[0]);
  }
});

const memberThreads = postgresThreads(apiPool, { streamsMax: 4 });

/** One of `member`'s own threads in the tenant of `partition`, opened as the API opens one, with one message queued for runners. */
async function ownWaiting(
  partition: Partition,
  member: Principal,
  label: string,
): Promise<{ readonly partition: Partition; readonly session: SessionId }> {
  const own = memberScopePartition(partition.tenant, member);
  const opened = await memberThreads.openUnscoped({
    partition: own,
    principal: member,
    session: asSessionId(`thread-${label}-${randomUUID()}`),
    key: asThreadOpenKey(randomUUID()),
    systemPrompt: "you are a member's own thread",
    credentialSlot: "claude-code",
  });
  if (opened.opened === "ThreadLimitReached")
    throw new Error("pool session suite: a member's own thread was refused");
  const queued = await memberThreads.enqueueMessage({
    partition: own,
    principal: member,
    session: opened.thread.session,
    turn: asSessionTurnId(`turn-${label}-${randomUUID()}`),
    input: "which projects may I see?",
    route: "Pool",
  });
  assert.equal(queued.enqueued, "Enqueued");
  return { partition: own, session: opened.thread.session };
}

/** One poll of `caller` offering `contract`, with room for four sessions. */
async function polledOffering(
  caller: PoolPlaneIdentity,
  contract: string,
  through: WorkerPoolPorts = ports,
): Promise<readonly WorkerPoolSessionAssignment[]> {
  const answered = await workerPoolPoll(
    through,
    caller,
    {
      held: [],
      wanted: 0,
      wantedSessions: 4,
      contract: workerContractPeerNaming(contract),
    },
    settings,
  );
  if (answered.polled !== "Answered")
    throw new Error(`pool session suite: a poll answered ${answered.polled}`);
  return answered.answer.sessions;
}

test("a member's own thread is handed to their chat host alone, on a contract that runs one, with no repository, and its bearer answers its member's scope and capabilities", async () => {
  const { partition, member } = await hostedProject("host-own");
  const runs = await personal(partition, member);
  const host = await chatHost(partition, member);
  const another = await chatHost(partition, principal("host-own-other"));
  const own = await ownWaiting(partition, member, "host-own");

  assert.deepEqual(await polledOffering(host, "1.28.0"), []);
  assert.deepEqual(await polledOffering(another, workerContractRelease), []);
  assert.deepEqual(await polledOffering(runs, workerContractRelease), []);
  const [claimed, ...more] = await polledOffering(host, workerContractRelease);
  assert.deepEqual(more, []);
  assert.ok(claimed !== undefined);
  assert.equal(await sessionOf(claimed), own.session);
  const [opened] = await rig.harness.query(
    `SELECT holder_kind,invocation FROM session_attempt WHERE assignment=$1`,
    [claimed.assignment],
  );
  assert.equal(opened?.["holder_kind"], "ChatHost");
  assert.equal(documentOf(opened?.["invocation"])["repository"], undefined);
  assert.deepEqual(documentOf(opened?.["invocation"])["capabilities"], [
    "MemberRead",
  ]);
  assert.deepEqual(
    await postgresSessionBearerAuthority(apiPool).authenticate(
      asSessionBearerSecret(claimed.bearer),
    ),
    {
      partition: own.partition,
      session: own.session,
      kind: "Thread",
      principal: member,
      scope: "Member",
      capabilities: ["MemberRead"],
    },
  );
});

/** What the API reads a thread to hold while a chat host holds it, NULL while none does. */
async function threadHostCapabilitiesOf(
  partition: Partition,
  session: SessionId,
): Promise<unknown> {
  const found = await apiPool.query<{ held: string[] | null }>(
    `SELECT thread_chat_host_capabilities($1,$2,$3) AS held`,
    [partition.tenant, partition.project, session],
  );
  return found.rows[0]?.held;
}

/** The host's set and the capabilities an attempt's invocation names. */
async function attemptCapabilitiesOf(
  assignment: string,
): Promise<readonly unknown[]> {
  const [attempt] = await rig.harness.query(
    `SELECT host_capabilities,invocation FROM session_attempt WHERE assignment=$1`,
    [assignment],
  );
  return [
    attempt?.["host_capabilities"],
    documentOf(attempt?.["invocation"])["capabilities"],
  ];
}

/** The capabilities the session plane tells the pod holding `claimed` it holds. */
async function factsCapabilitiesOf(
  claimed: WorkerPoolSessionAssignment,
): Promise<readonly SessionCapability[] | undefined> {
  const identity = await postgresSessionPlane(planePool).authenticate(
    asSessionBearerSecret(claimed.bearer),
  );
  return identity?.capabilities;
}

/** Whether the session plane tells the pod holding `claimed` that its shell is handed its credential. */
async function factsShellCredentialOf(
  claimed: WorkerPoolSessionAssignment,
): Promise<true | undefined> {
  const identity = await postgresSessionPlane(planePool).authenticate(
    asSessionBearerSecret(claimed.bearer),
  );
  assert.ok(identity !== undefined);
  return identity.shellCredentialHanded;
}

/** The one session a poll of `host` naming `named` for its threads claims. */
async function hostClaimedNaming(
  host: PoolPlaneIdentity,
  named: readonly SessionCapability[],
): Promise<WorkerPoolSessionAssignment> {
  const answered = await workerPoolPoll(
    ports,
    host,
    { held: [], wanted: 0, wantedSessions: 4, sessionCapabilities: named },
    settings,
  );
  if (answered.polled !== "Answered")
    throw new Error(`pool session suite: a poll answered ${answered.polled}`);
  const [claimed, ...more] = answered.answer.sessions;
  assert.deepEqual(more, []);
  assert.ok(claimed !== undefined);
  return claimed;
}

test("a chat host naming its threads' capabilities records them, opens its thread under its roster less what it left out, and tells its pod and confines its bearer to the same, and that its shell is handed its credential, while a thread it claims naming none keeps its roster and is told nothing of its shell", async () => {
  const { partition, member } = await hostedProject("host-capabilities");
  const roster = ["RepositoryRead", "RunCommands", "ProjectRead"] as const;
  const opened = async (label: string) => {
    const session = await sessionRigSession(rig, partition, label, {
      principal: member,
      capabilities: [...roster],
    });
    await sessionRigTurn(rig, partition, session, label);
    return session;
  };
  const owner = { tenant: partition.tenant, owner: member };
  const thread = await opened("host-capabilities-thread");
  const host = await chatHost(partition, member);
  const named = ["ProjectRead", "RepositoryRead", "MemberRead"] as const;
  const held = ["RepositoryRead", "ProjectRead"];
  assert.equal(await threadHostCapabilitiesOf(partition, thread), null);
  const claimed = await hostClaimedNaming(host, named);
  assert.equal(await sessionOf(claimed), thread);
  assert.deepEqual(await attemptCapabilitiesOf(claimed.assignment), [
    named,
    held,
  ]);
  assert.deepEqual(
    (
      await postgresSessionBearerAuthority(apiPool).authenticate(
        asSessionBearerSecret(claimed.bearer),
      )
    )?.capabilities,
    held,
  );
  assert.deepEqual(
    await factsCapabilitiesOf(claimed),
    held,
    "the pod's facts name what its bearer is confined to",
  );
  assert.equal(
    await factsShellCredentialOf(claimed),
    true,
    "a thread on a host naming a set is told its shell is handed its credential",
  );
  assert.deepEqual(await threadHostCapabilitiesOf(partition, thread), held);
  assert.deepEqual(
    (await chatHostRegistry.host(owner))?.sessionCapabilities,
    named,
  );

  const unnamed = await opened("host-capabilities-unnamed");
  const [asked] = await polledOffering(host, workerContractRelease);
  assert.ok(asked !== undefined);
  assert.equal(await sessionOf(asked), unnamed);
  assert.deepEqual(await attemptCapabilitiesOf(asked.assignment), [
    null,
    roster,
  ]);
  assert.deepEqual(await factsCapabilitiesOf(asked), roster);
  assert.equal(await factsShellCredentialOf(asked), undefined);
  assert.equal(
    (await chatHostRegistry.host(owner))?.sessionCapabilities,
    undefined,
    "a poll naming no set clears the one recorded",
  );
});

test("an attempt records a host's set only where a chat host holds it, and only capabilities a session may hold, and a thread on a host naming none is told nothing of its shell", async () => {
  const { partition, member } = await hostedProject("host-capabilities-held");
  const session = await sessionRigSession(
    rig,
    partition,
    "host-capabilities-held",
    {
      kind: "Thread",
      principal: member,
    },
  );
  await sessionRigTurn(rig, partition, session, "host-capabilities-held");
  const host = await chatHost(partition, member);
  const [claimed] = await polledOffering(host, workerContractRelease);
  assert.ok(claimed !== undefined);
  assert.equal(
    await factsShellCredentialOf(claimed),
    undefined,
    "a thread on a host naming no set is told nothing of its shell",
  );
  for (const [set, holder, constraint] of [
    [
      ["ProjectSettings"],
      "ChatHost",
      "session_attempt_host_capabilities_are_known",
    ],
    [
      ["ProjectRead"],
      "Pool",
      "session_attempt_host_capabilities_are_a_chat_hosts",
    ],
  ] as const)
    await assert.rejects(
      rig.harness.query(
        `UPDATE session_attempt SET host_capabilities=$2::text[],holder_kind=$3
          WHERE assignment=$1`,
        [claimed.assignment, set, holder],
      ),
      (failure: unknown) =>
        failure instanceof Error &&
        "constraint" in failure &&
        failure.constraint === constraint,
      JSON.stringify([set, holder]),
    );
});

test("a chat host is handed no member's own thread once its owner may no longer open unscoped chat, asking the tenant rather than any project", async () => {
  const { partition, member } = await hostedProject("host-own-revoked");
  const host = await chatHost(partition, member);
  const own = await ownWaiting(partition, member, "host-own-revoked");
  const asked: string[] = [];
  const refusing: WorkerPoolPorts = {
    ...ports,
    access: {
      ...readingEverything,
      authorize: (caller, at, kind) => {
        asked.push(`${at.project}:${kind}`);
        return Promise.resolve(memberAuthority(caller));
      },
      authorizeTenant: (caller, tenant, kind) => {
        asked.push(`${tenant}:${kind}`);
        return Promise.resolve(
          kind === "OpenUnscopedChat" ? undefined : memberAuthority(caller),
        );
      },
    },
  };
  assert.deepEqual(
    await polledOffering(host, workerContractRelease, refusing),
    [],
  );
  assert.deepEqual(asked, [`${partition.tenant}:OpenUnscopedChat`]);
  assert.deepEqual(
    await rig.harness.query(
      `SELECT assignment FROM session_attempt WHERE session=$1`,
      [own.session],
    ),
    [],
  );
});

test("a chat host's awaiting read naming no scope, as an earlier pool plane makes it, is answered its member's project sessions and none of their own", async () => {
  const { partition, member } = await hostedProject("host-unnamed");
  const host = await chatHost(partition, member);
  const thread = await waiting(partition, "host-unnamed-thread", member);
  const own = await ownWaiting(partition, member, "host-unnamed");
  const read = async (scoped: readonly boolean[]) =>
    new Set(
      (
        await poolPlanePool.query<{ session: string }>(
          `SELECT session FROM chat_host_sessions_awaiting_claim(
             $1,$2,$3,$4,$5${scoped.length === 0 ? "" : ",$6"})`,
          [
            host.tenant,
            host.owner,
            host.principal,
            launch.placementBackoffSecs,
            4,
            ...scoped,
          ],
        )
      ).rows.map(({ session }) => session),
    );
  assert.deepEqual(await read([]), new Set([thread.session]));
  assert.deepEqual(await read([true]), new Set([thread.session, own.session]));
});
