/**
 * A pool's claim of a session, against a real PostgreSQL and under the roles a
 * deployment runs: the pool plane claims, renews and settles through its own
 * role, the worker plane serves the attempt a claim opened, and the
 * scheduler's sweeps reach it. Each case holds a project of its own, and the
 * last restores the epoch away.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { sessionAttemptMint } from "../../src/adapters/crypto/sessionAttemptMint.ts";
import { poolPlaneClient } from "../../src/adapters/http/poolPlaneClient.ts";
import { createPoolPlaneApp } from "../../src/adapters/http/poolPlaneServer.ts";
import { poolSessionPlaneClient } from "../../src/adapters/http/poolSessionPlaneClient.ts";
import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
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
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { sessionPoolTurnDwellSecs } from "../../src/interpreter/sessionPlacement.ts";
import {
  workerPoolHeldImages,
  workerPoolPoll,
  workerPoolSettled,
  type WorkerPoolIdentity,
  type WorkerPoolPollSettings,
  type WorkerPoolPorts,
} from "../../src/interpreter/workerPool.ts";
import {
  workerPoolClientPass,
  type WorkerPoolBackend,
  type WorkerPoolClient,
  type WorkerPoolSessionEnd,
} from "../../src/interpreter/workerPoolClient.ts";
import type { SessionLaunchFacts } from "../../src/interpreter/workerPoolSessions.ts";
import { planeListening } from "../adapters/planeBodies.ts";
import {
  inertSessionPlane,
  inertWorkerPlane,
} from "../adapters/workerPlaneFixtures.ts";
import {
  postgresHarnessNewEpoch,
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

const rig = await sessionRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const poolPlanePool = postgresHarnessRolePool(poolPlaneRole);
const schedulerPool = postgresHarnessRolePool(schedulerRole);
const planePool = postgresHarnessRolePool(workerPlaneRole);

/** The worker plane a claimed session's runner reaches, its session routes over the real store. */
const workerPlane = createWorkerPlaneApp({
  ...inertWorkerPlane(1),
  tasks: postgresWorkerTasks(planePool),
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
};

assert.deepEqual(
  await postgresSessionLaunchPrecondition(schedulerPool, launch).check(
    new AbortController().signal,
  ),
  { met: "Met" },
);

const store = postgresWorkerPoolSessions(poolPlanePool);
const ports: WorkerPoolPorts = {
  assignments: postgresWorkerPoolAssignments(poolPlanePool),
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

/** A runner `member` registered on the project, under the name given or one of its own. */
async function runner(
  partition: Partition,
  member: Principal,
  pool = `runner-${randomUUID()}`,
  registered: Principal = principal("pool"),
): Promise<WorkerPoolIdentity> {
  assert.equal(
    await postgresWorkerPoolRegistry(apiPool).register({
      partition,
      pool,
      capabilities: [],
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal: registered,
      registeredBy: member,
    }),
    true,
  );
  return { partition, pool, principal: registered };
}

/** A project whose sessions run on runners, with a member and that member's runner. */
async function routedProject(label: string): Promise<{
  readonly partition: Partition;
  readonly member: Principal;
  readonly pool: WorkerPoolIdentity;
}> {
  const partition = await sessionRigProject(rig, label);
  await sessionRigRouted(rig, partition, "Pool", "Pool");
  const member = principal(`member-${label}`);
  return { partition, member, pool: await runner(partition, member) };
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
  pool: WorkerPoolIdentity,
  wantedSessions = 1,
  held: readonly string[] = [],
  through: WorkerPoolPorts = ports,
  terms: WorkerPoolPollSettings = settings,
): Promise<WorkerPoolReconciliation> {
  const answered = await workerPoolPoll(
    through,
    pool,
    { held, wanted: 0, wantedSessions, readsSessions: true },
    terms,
  );
  if (answered.polled !== "Answered")
    throw new Error(`pool session suite: a poll answered ${answered.polled}`);
  return answered.answer;
}

/** The one session a poll hands `pool`, refusing a poll that hands it none or more. */
async function claimedOne(
  pool: WorkerPoolIdentity,
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
    `SELECT session,state,evidence,pool,pool_principal::text AS pool_principal,
            pool_refusal,image,launch,lease_owner,idle_since IS NOT NULL AS idle,
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

test("a pool is handed a session whose oldest queued turn was admitted for runners, and never one admitted in cluster", async () => {
  const partition = await sessionRigProject(rig, "pool-claim");
  const member = principal("member-pool-claim");
  const pool = await runner(partition, member);
  const inCluster = await waiting(partition, "claim-cluster", "Thread", member);
  assert.deepEqual((await polled(pool, 4)).sessions, []);
  await sessionRigRouted(rig, partition, "Pool", "Pool");
  await sessionRigTurn(rig, partition, inCluster.session, "claim-behind");
  const offered = await waiting(
    partition,
    "claim-pool",
    "Lead",
    principal("lead"),
  );

  const claimed = await claimedOne(pool);
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
    state: "Running",
    evidence: null,
    pool: pool.pool,
    pool_principal: pool.principal,
    pool_refusal: null,
    image: launch.image,
    launch: {
      api: { url: settings.sessionApiUrl },
      bounds: launch.bounds,
      model: launch.model,
    },
    lease_owner: pool.pool,
    idle: true,
    lease: opened["lease"],
  });
  assert.equal(await runnerClaimed(claimed), offered.turn);
  assert.deepEqual((await polled(pool, 4, [claimed.assignment])).sessions, []);
});

test("a thread or an inquiry is handed only to its member's own runner, a lead to any runner of its project, and nothing to another project's", async () => {
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
  const handed = async (pool: WorkerPoolIdentity) =>
    new Set(await Promise.all((await polled(pool, 4)).sessions.map(sessionOf)));

  assert.deepEqual(await handed(await runner(elsewhere, member)), new Set());
  assert.deepEqual(
    await handed(await runner(partition, other)),
    new Set([lead.session]),
  );
  assert.deepEqual(
    await handed(await runner(partition, member)),
    new Set([thread.session, inquiry.session]),
  );
});

test("a pool holds no more sessions than its bound however few it says it holds, and a session is not handed out while an attempt holds it or its backoff runs", async () => {
  const { partition, member, pool } = await routedProject("pool-bound");
  await waiting(partition, "bound-lead", "Lead", member);
  await waiting(partition, "bound-thread", "Thread", member);
  const one = { ...settings, sessionsHeldMax: 1 };
  const [held] = (await polled(pool, 1, [], ports, one)).sessions;
  assert.ok(held !== undefined);
  assert.deepEqual(
    (await polled(pool, 1, [], ports, one)).sessions,
    [],
    "a pool that said it held nothing was handed one past its bound",
  );

  const beside = await runner(partition, member);
  const [next, ...more] = (await polled(beside, 4)).sessions;
  assert.ok(next !== undefined);
  assert.deepEqual(more, [], "a session was handed out while held");
  assert.notEqual(await sessionOf(next), await sessionOf(held));
  assert.equal(
    await workerPoolSettled(ports, pool, held.assignment, {
      outcome: "Unavailable",
    }),
    true,
  );
  assert.deepEqual(
    (await polled(beside, 4)).sessions,
    [],
    "a session was handed out inside its backoff",
  );
  await backdated(held.assignment, "ended_at", launch.placementBackoffSecs + 1);
  const [again] = (await polled(beside, 4)).sessions;
  assert.ok(again !== undefined);
  assert.equal(await sessionOf(again), await sessionOf(held));
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

test("an accepted session writes nothing, an unavailable one is withdrawn with its turn uncharged, and a refused one ends charged with its refusal recorded", async () => {
  const { partition, member, pool } = await routedProject("pool-settle");
  const lead = await waiting(partition, "settle-lead", "Lead", member);
  await waiting(partition, "settle-thread", "Thread", member);
  await waiting(partition, "settle-inquiry", "Inquiry", member, lead.session);
  const [accepted, unavailable, refused] = (await polled(pool, 3)).sessions;
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
    await workerPoolSettled(ports, pool, accepted.assignment, {
      outcome: "Accepted",
    }),
    true,
  );
  assert.deepEqual(await attemptOf(accepted.assignment), untouched);
  assert.equal(
    await workerPoolSettled(ports, pool, unavailable.assignment, {
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
    await workerPoolSettled(ports, pool, refused.assignment, refusal),
    true,
  );
  const lost = await attemptOf(refused.assignment);
  assert.deepEqual(
    [lost["state"], lost["evidence"], lost["pool_refusal"]],
    ["Lost", "PlacementDenied", "no runtime"],
  );
  assert.deepEqual(await standing(refused), ["Queued", null, "1"]);
  assert.equal(
    await workerPoolSettled(ports, pool, refused.assignment, refusal),
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
  const images = (of: WorkerPoolIdentity) =>
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

test("only a poll that could take a session marks its member's runner live", async () => {
  const { partition, member, pool } = await routedProject("pool-live");
  const standing = async () =>
    (await postgresSessionPlacement(apiPool).runners(partition, member)).mine;
  assert.equal(await standing(), "Offline");
  await workerPoolPoll(
    ports,
    pool,
    { held: [], wanted: 1, wantedSessions: 1, readsSessions: false },
    settings,
  );
  assert.equal(await standing(), "Offline", "a release without sessions");
  await polled(pool, 0);
  assert.equal(await standing(), "Offline", "a runner with no room");
  await polled(pool, 1);
  assert.equal(await standing(), "Live");
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
  await backdated(held.assignment, "ended_at", sessionPoolTurnDwellSecs + 60);
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

  const second = await waiting(partition, "exclusive-second", "Thread", member);
  await sessionRigQueuedFor(rig, second.turn, 2 * sessionPoolTurnDwellSecs);
  const inserting = await rig.harness.begin();
  await inserting.query(`LOCK TABLE session_attempt IN SHARE MODE`);
  const claim = polled(pool);
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
    },
  };
}

/** The pool plane a runner polls, over the real stores, admitting one token as `runs`. */
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
    access: {
      authorize: (caller) =>
        Promise.resolve(caller === runs ? memberAuthority(caller) : undefined),
      authorizeTenant: () => Promise.resolve(undefined),
    },
    registry: postgresWorkerPoolRegistry(poolPlanePool),
    assignments: ports.assignments,
    sessions: ports.sessions,
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
  await runner(partition, member, "laptop", runs);
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
