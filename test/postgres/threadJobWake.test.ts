/**
 * A thread's attempt on its member's chat host waking its own thread, against a
 * real PostgreSQL and under the worker plane's role: the view answers what the
 * wake pass reads of a candidate, the door puts the turn in the thread's
 * mailbox through `wake_member_thread` and answers a replayed turn already
 * woken, and a bearer that is not a live chat-host thread attempt's is refused
 * at both. Each case holds a project of its own.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresChatHostRegistry } from "../../src/adapters/postgres/chatHost.ts";
import {
  apiRole,
  poolPlaneRole,
  schedulerRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresThreadJobWakes } from "../../src/adapters/postgres/thread.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";
import type { WorkerPoolSessionAssignment } from "../../src/contract/workerPool.ts";
import {
  asSessionBearerSecret,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { threadJobWakeTurn } from "../../src/interpreter/threadWake.ts";
import {
  workerPoolPoll,
  workerPoolSettled,
  type PoolPlaneIdentity,
} from "../../src/interpreter/workerPool.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
  sessionRigAttempt,
  sessionRigLaunchMet,
  sessionRigOpen,
  sessionRigPollSettings,
  sessionRigPoolPorts,
  sessionRigProject,
  sessionRigRouted,
  sessionRigSession,
  sessionRigTurn,
} from "./sessionHarness.ts";

const rig = await sessionRigOpen();
const apiPool = postgresHarnessRolePool(apiRole);
const poolPlanePool = postgresHarnessRolePool(poolPlaneRole);
const schedulerPool = postgresHarnessRolePool(schedulerRole);
const workerPlanePool = postgresHarnessRolePool(workerPlaneRole);
const wakes = postgresThreadJobWakes(workerPlanePool);

after(async () => {
  await Promise.all(
    [apiPool, poolPlanePool, schedulerPool, workerPlanePool].map((pool) =>
      pool.end(),
    ),
  );
  await rig.close();
});

await sessionRigLaunchMet(schedulerPool);

const ports = sessionRigPoolPorts(poolPlanePool);
const settings = sessionRigPollSettings;

function principal(label: string): Principal {
  return asPrincipal(`https://issuer.invalid#${label}-${randomUUID()}`);
}

/** A project whose threads run on runners, its member, and a thread of theirs that member's chat host holds. */
async function chatHostThread(label: string): Promise<{
  readonly partition: Partition;
  readonly member: Principal;
  readonly session: SessionId;
  readonly host: PoolPlaneIdentity;
  readonly held: WorkerPoolSessionAssignment;
}> {
  const partition = await sessionRigProject(rig, label);
  await sessionRigRouted(rig, partition, "Pool", "Pool");
  const member = principal(`member-${label}`);
  const registered = principal("host");
  const written = await postgresChatHostRegistry(apiPool).register({
    tenant: partition.tenant,
    owner: member,
    clientId: `chuggy-host-${randomUUID()}`,
    principal: registered,
  });
  assert.equal(written.written, "Registered");
  const host: PoolPlaneIdentity = {
    kind: "ChatHost",
    tenant: partition.tenant,
    owner: member,
    principal: registered,
  };
  const session = await sessionRigSession(rig, partition, label, {
    kind: "Thread",
    principal: member,
  });
  await sessionRigTurn(rig, partition, session, label);
  const answered = await workerPoolPoll(
    ports,
    host,
    { held: [], wanted: 0, wantedSessions: 1, contract: workerContractRelease },
    settings,
  );
  if (answered.polled !== "Answered")
    throw new Error(`job wake suite: a poll answered ${answered.polled}`);
  const [held, ...more] = answered.answer.sessions;
  assert.deepEqual(more, []);
  assert.ok(held !== undefined, "the host was handed no thread");
  return { partition, member, session, host, held };
}

function bearerOf(held: { readonly bearer: string }) {
  return { secret: asSessionBearerSecret(held.bearer), generation: 1 };
}

async function wakeTurns(
  session: SessionId,
): Promise<readonly Record<string, unknown>[]> {
  return rig.harness.query(
    `SELECT turn,input_kind,input,ordinal::text AS ordinal FROM session_turn
      WHERE session=$1 AND input_kind='Wake' ORDER BY ordinal`,
    [session],
  );
}

test("a chat host's thread attempt is viewed as the wake pass reads a candidate", async () => {
  const { partition, member, session, held } =
    await chatHostThread("job-wake-view");
  assert.deepEqual(await wakes.wakeView(bearerOf(held)), {
    partition,
    principal: member,
    session,
    route: "Pool",
    runner: "Live",
  });
});

test("a wake through the door is one turn in the thread's mailbox, and the same turn again is already woken", async () => {
  const { session, held } = await chatHostThread("job-wake-door");
  const turn = threadJobWakeTurn(session, "dispatcher-exit-1");
  const offered = {
    ...bearerOf(held),
    turn,
    input: '{"wake":"JobExited"}',
    route: "Pool" as const,
  };
  const woken = await wakes.wakeThread(offered);
  assert.ok(typeof woken === "object" && woken.woken === "Woken");
  assert.deepEqual(await wakes.wakeThread(offered), {
    woken: "AlreadyWoken",
    ordinal: woken.ordinal,
  });
  assert.deepEqual(await wakeTurns(session), [
    {
      turn,
      input_kind: "Wake",
      input: '{"wake":"JobExited"}',
      ordinal: String(woken.ordinal),
    },
  ]);
});

test("an attempt that is not a thread's on a chat host is refused a wake at the view and at the door", async () => {
  const partition = await sessionRigProject(rig, "job-wake-elsewhere");
  for (const kind of ["Thread", "Lead"] as const) {
    const label = `job-wake-elsewhere-${kind}`;
    const session = await sessionRigSession(rig, partition, label, { kind });
    await sessionRigTurn(rig, partition, session, label);
    const placed = await sessionRigAttempt(rig, partition, session, label);
    const bearer = { secret: placed.secret, generation: 1 };
    assert.equal(await wakes.wakeView(bearer), "NotChatHostThread", kind);
    assert.equal(
      await wakes.wakeThread({
        ...bearer,
        turn: threadJobWakeTurn(session, "e"),
        input: "{}",
        route: "Pool",
      }),
      "NotChatHostThread",
      kind,
    );
    assert.deepEqual(await wakeTurns(session), [], kind);
  }
});

test("an ended attempt's bearer is fenced at the view and at the door, and wakes nothing", async () => {
  const { session, host, held } = await chatHostThread("job-wake-fenced");
  assert.equal(
    await workerPoolSettled(ports, host, held.assignment, {
      outcome: "Unavailable",
    }),
    true,
  );
  const bearer = bearerOf(held);
  assert.equal(await wakes.wakeView(bearer), "Fenced");
  assert.equal(
    await wakes.wakeThread({
      ...bearer,
      turn: threadJobWakeTurn(session, "e"),
      input: "{}",
      route: "Pool",
    }),
    "Fenced",
  );
  assert.deepEqual(await wakeTurns(session), []);
});
