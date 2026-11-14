/**
 * A standing thread against a real PostgreSQL and under the roles a deployment
 * runs: a chat host's thread attempt reports it through the worker plane's
 * role, the pool plane keeps an attempt placed for it on the host that ran its
 * last one, the scheduler's idle reaper passes over it, and its close clears it
 * and names it to that host. Each case holds a project of its own.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { sessionAttemptMint } from "../../src/adapters/crypto/sessionAttemptMint.ts";
import { postgresChatHostRegistry } from "../../src/adapters/postgres/chatHost.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  apiRole,
  poolPlaneRole,
  schedulerRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresThreads } from "../../src/adapters/postgres/thread.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRunners,
} from "../../src/adapters/postgres/workerPool.ts";
import {
  postgresSessionLaunchPrecondition,
  postgresWorkerPoolSessions,
} from "../../src/adapters/postgres/workerPoolSessions.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";
import type {
  WorkerPoolReconciliation,
  WorkerPoolSessionAssignment,
} from "../../src/contract/workerPool.ts";
import {
  asSessionBearerSecret,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  workerPoolPoll,
  workerPoolSettled,
  type PoolPlaneIdentity,
  type WorkerPoolPollSettings,
  type WorkerPoolPorts,
} from "../../src/interpreter/workerPool.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
  sessionRigAttempt,
  sessionRigBoundless,
  sessionRigLaunch,
  sessionRigOpen,
  sessionRigProject,
  sessionRigRouted,
  sessionRigSession,
  sessionRigTurn,
} from "./sessionHarness.ts";

const rig = await sessionRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const poolPlanePool = postgresHarnessRolePool(poolPlaneRole);
const schedulerPool = postgresHarnessRolePool(schedulerRole);

after(async () => {
  await Promise.all(
    [apiPool, poolPlanePool, schedulerPool].map((pool) => pool.end()),
  );
  await rig.close();
});

const launch = sessionRigLaunch;

assert.deepEqual(
  await postgresSessionLaunchPrecondition(schedulerPool, launch).check(
    new AbortController().signal,
  ),
  { met: "Met" },
);

const readingEverything: ProjectAccess = {
  authorize: (caller) => Promise.resolve(memberAuthority(caller)),
  authorizeTenant: (caller) => Promise.resolve(memberAuthority(caller)),
  authorizeSite: projectAccessSiteRefused,
};

const ports: WorkerPoolPorts = {
  assignments: postgresWorkerPoolAssignments(poolPlanePool),
  runners: postgresWorkerPoolRunners(poolPlanePool),
  access: readingEverything,
  sessions: {
    store: postgresWorkerPoolSessions(poolPlanePool),
    bindings: postgresProjectRepositoryBinding(poolPlanePool),
    bearers: sessionAttemptMint(),
  },
  mint: () => randomUUID(),
};

const settings: WorkerPoolPollSettings = {
  leaseSecs: 3600,
  cpuMillis: 500,
  memoryMib: 256,
  assignmentsPerPollMax: 1,
  heldMax: 1,
  sessionsPerPollMax: 4,
  sessionsHeldMax: 4,
  deadlineSecs: 600,
  callbackUrl: "http://127.0.0.1:1/",
  sessionApiUrl: "https://api.invalid/",
  pollIntervalMs: 1,
  pollsMax: 1,
  imageHosts: new Map(),
};

type ChatHostPlaneIdentity = Extract<PoolPlaneIdentity, { kind: "ChatHost" }>;

function principal(label: string): Principal {
  return asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`);
}

/** A project whose sessions run on runners, its member, and that member's chat host. */
async function hosted(label: string): Promise<{
  readonly partition: Partition;
  readonly member: Principal;
  readonly host: ChatHostPlaneIdentity;
}> {
  const partition = await sessionRigProject(rig, label);
  await sessionRigRouted(rig, partition, "Pool", "Pool");
  const member = principal(`member-${label}`);
  return { partition, member, host: await chatHost(partition, member) };
}

/** `member`'s chat host in the tenant of `partition`, in place of any they held. */
async function chatHost(
  partition: Partition,
  member: Principal,
): Promise<ChatHostPlaneIdentity> {
  const registered = principal("host");
  const written = await postgresChatHostRegistry(apiPool).register({
    tenant: partition.tenant,
    owner: member,
    clientId: `chuggy-host-${randomUUID()}`,
    principal: registered,
  });
  assert.equal(written.written, "Registered");
  return {
    kind: "ChatHost",
    tenant: partition.tenant,
    owner: member,
    principal: registered,
  };
}

/** One poll of `host` with room for `wantedSessions`, on this release unless it names another. */
async function polled(
  host: PoolPlaneIdentity,
  wantedSessions = 1,
  held: readonly string[] = [],
  contract: string = workerContractRelease,
): Promise<WorkerPoolReconciliation> {
  const answered = await workerPoolPoll(
    ports,
    host,
    { held, wanted: 0, wantedSessions, contract },
    settings,
  );
  if (answered.polled !== "Answered")
    throw new Error(`standing suite: a poll answered ${answered.polled}`);
  return answered.answer;
}

async function attemptOf(assignment: string): Promise<Record<string, unknown>> {
  const [row] = await rig.harness.query(
    `SELECT session,state,evidence,ended_at IS NOT NULL AS ended
       FROM session_attempt WHERE assignment=$1`,
    [assignment],
  );
  if (row === undefined)
    throw new Error(`standing suite: no attempt for ${assignment}`);
  return row;
}

async function standingOf(session: SessionId): Promise<unknown> {
  const [row] = await rig.harness.query(
    `SELECT standing FROM agent_session WHERE session=$1`,
    [session],
  );
  return row?.["standing"];
}

/**
 * A thread of `member`'s that `host` claimed and answered the one turn of, so
 * its mailbox is empty while its attempt runs.
 */
async function threadAnswered(
  partition: Partition,
  member: Principal,
  host: ChatHostPlaneIdentity,
  label: string,
): Promise<{
  readonly session: SessionId;
  readonly held: WorkerPoolSessionAssignment;
}> {
  const session = await sessionRigSession(rig, partition, label, {
    kind: "Thread",
    principal: member,
  });
  await sessionRigTurn(rig, partition, session, label);
  const [held, ...more] = (await polled(host)).sessions;
  assert.deepEqual(more, []);
  assert.ok(held !== undefined, "the host was handed no thread");
  const secret = asSessionBearerSecret(held.bearer);
  const claimed = await rig.plane.claim({ secret, generation: 1 });
  assert.ok(claimed !== undefined, "the thread's turn was not claimed");
  assert.equal(
    await rig.plane.answer({
      secret,
      generation: 1,
      turn: claimed.turn,
      result: "answered",
    }),
    "Answered",
  );
  return { session, held };
}

/** Reports `standing` for the attempt `held` names, under its bearer. */
function reported(
  held: WorkerPoolSessionAssignment,
  standing: boolean,
): Promise<string> {
  return rig.plane.stand({
    secret: asSessionBearerSecret(held.bearer),
    generation: 1,
    standing,
  });
}

/** Moves an ended attempt's end back past the backoff, its fence lifted for the one statement. */
async function endedLongAgo(assignment: string): Promise<void> {
  const backdating = await rig.harness.begin();
  const fence = "TRIGGER session_attempt_is_fenced";
  try {
    await backdating.query(`ALTER TABLE session_attempt DISABLE ${fence}`);
    await backdating.query(
      `UPDATE session_attempt
          SET ended_at=now()-make_interval(secs=>$2) WHERE assignment=$1`,
      [assignment, launch.placementBackoffSecs + 1],
    );
    await backdating.query(`ALTER TABLE session_attempt ENABLE ${fence}`);
  } catch (error) {
    await backdating.rollback();
    throw error;
  }
  await backdating.commit();
}

/** Ends `held` as its host's runner going away does, and lets its backoff run. */
async function released(
  host: ChatHostPlaneIdentity,
  held: WorkerPoolSessionAssignment,
): Promise<void> {
  assert.equal(
    await workerPoolSettled(ports, host, held.assignment, {
      outcome: "Unavailable",
    }),
    true,
  );
  assert.equal((await attemptOf(held.assignment))["ended"], true);
  await endedLongAgo(held.assignment);
}

test("a chat host's thread attempt records its thread standing and then not, and an ended attempt's report is fenced", async () => {
  const { partition, member, host } = await hosted("standing-report");
  const { session, held } = await threadAnswered(
    partition,
    member,
    host,
    "standing-report",
  );
  assert.equal(await standingOf(session), false);
  assert.equal(await reported(held, true), "Recorded");
  assert.equal(await standingOf(session), true);
  assert.equal(await reported(held, true), "Recorded");
  assert.equal(await reported(held, false), "Recorded");
  assert.equal(await standingOf(session), false);

  await released(host, held);
  assert.equal(await reported(held, true), "Fenced");
  assert.equal(await standingOf(session), false);
});

test("an attempt that is not a thread's on a chat host is refused a standing", async () => {
  const partition = await sessionRigProject(rig, "standing-elsewhere");
  for (const kind of ["Thread", "Lead"] as const) {
    const label = `standing-elsewhere-${kind}`;
    const session = await sessionRigSession(rig, partition, label, { kind });
    await sessionRigTurn(rig, partition, session, label);
    const placed = await sessionRigAttempt(rig, partition, session, label);
    assert.equal(
      await rig.plane.stand({
        secret: placed.secret,
        generation: 1,
        standing: true,
      }),
      "NotChatHostThread",
      kind,
    );
    assert.equal(await standingOf(session), false, kind);
  }
});

test("a standing thread whose attempt ended is placed again with an empty mailbox on the host that ran it, and on no host registered in that host's place", async () => {
  const { partition, member, host } = await hosted("standing-placed");
  const { session, held } = await threadAnswered(
    partition,
    member,
    host,
    "standing-placed",
  );
  assert.deepEqual((await polled(host, 1, [held.assignment])).sessions, []);
  assert.equal(await reported(held, true), "Recorded");
  await released(host, held);

  const [again, ...more] = (await polled(host)).sessions;
  assert.deepEqual(more, []);
  assert.ok(again !== undefined, "a standing thread was not placed again");
  assert.equal((await attemptOf(again.assignment))["session"], session);
  assert.equal(await standingOf(session), true, "a new attempt cleared it");

  await released(host, again);
  const replacing = await chatHost(partition, member);
  assert.deepEqual(
    (await polled(replacing)).sessions,
    [],
    "a host registered in the last one's place was handed a standing thread",
  );
});

test("a thread that is not standing, or that an attempt reported not standing, is placed again only once a turn waits", async () => {
  const { partition, member, host } = await hosted("standing-cleared");
  const { session, held } = await threadAnswered(
    partition,
    member,
    host,
    "standing-cleared",
  );
  assert.equal(await reported(held, true), "Recorded");
  assert.equal(await reported(held, false), "Recorded");
  await released(host, held);
  assert.deepEqual((await polled(host)).sessions, []);

  await sessionRigTurn(rig, partition, session, "standing-cleared-again");
  const [waited] = (await polled(host)).sessions;
  assert.ok(
    waited !== undefined,
    "a thread with a turn waiting was not placed",
  );
  assert.equal((await attemptOf(waited.assignment))["session"], session);
});

test("the idle reaper passes over a standing thread's attempt and ends it once it is no longer standing", async () => {
  const { partition, member, host } = await hosted("standing-idle");
  const { held } = await threadAnswered(
    partition,
    member,
    host,
    "standing-idle",
  );
  await rig.harness.query(
    `UPDATE session_attempt SET idle_unbounded=false,idle_secs=60,
            idle_since=now()-make_interval(secs=>3600)
      WHERE assignment=$1`,
    [held.assignment],
  );
  const reaped = (): Promise<number> =>
    rig.scheduler.reapIdleAttempts(rig.epoch, 60, sessionRigBoundless);
  assert.equal(await reported(held, true), "Recorded");
  assert.equal(await reaped(), 0);
  assert.equal((await attemptOf(held.assignment))["state"], "Running");
  assert.equal(await reported(held, false), "Recorded");
  assert.equal(await reaped(), 1);
  assert.deepEqual(
    [
      (await attemptOf(held.assignment))["state"],
      (await attemptOf(held.assignment))["evidence"],
    ],
    ["Lost", "SessionIdle"],
  );
});

test("closing a standing thread clears it, places it nowhere, and names it to the host that ran it, only on a release that reads it, and to no other host", async () => {
  const { partition, member, host } = await hosted("standing-closed");
  const { session, held } = await threadAnswered(
    partition,
    member,
    host,
    "standing-closed",
  );
  assert.equal(await reported(held, true), "Recorded");
  assert.equal(
    (await polled(host, 0, [held.assignment])).threadsClosed,
    undefined,
  );

  const threads = postgresThreads(apiPool, { streamsMax: 8 });
  const read = (): Promise<boolean | undefined> =>
    threads
      .standing({ partition, session, query: { limit: 1 } })
      .then((found) => found?.jobsStanding);
  assert.equal(await read(), true);
  assert.equal((await threads.close({ partition, session })).closed, "Closed");
  assert.equal(await standingOf(session), false);
  assert.equal(await read(), false);
  const answered = await polled(host, 1, [held.assignment]);
  assert.deepEqual(answered.stop, [held.assignment]);
  assert.deepEqual(answered.sessions, []);
  assert.deepEqual(answered.threadsClosed, [
    { project: partition.project, session },
  ]);
  assert.equal(
    (await polled(host, 0, [], "1.91.0")).threadsClosed,
    undefined,
    "a host of a release before the field was named it",
  );
  const other = await hosted("standing-closed-other");
  assert.equal((await polled(other.host, 0)).threadsClosed, undefined);
  const replacing = await chatHost(partition, member);
  assert.equal((await polled(replacing, 0)).threadsClosed, undefined);
});
