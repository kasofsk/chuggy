/**
 * A turn runs on the route it was admitted on, against a real server. The door
 * that admits a turn asks the hosted grant of the route it resolves and stamps
 * the turn with that route, so a route changed afterwards, by an administrator
 * or by the deployment's published routing, moves the next turn admitted and
 * never one already queued.
 *
 * WHAT A STAMP CLOSES is the gap between the door and the cluster: the grant is
 * asked when a turn is queued, and a pod is placed and claims later. A member
 * the tenant grants no hosted runs may queue a turn for a runner, and nothing
 * the route becomes after that may hand the turn to a pod on the shared
 * credential.
 *
 * A turn queued for runners needs the member to have registered one, and one
 * that no runner takes within the dwell is withdrawn, so it stops holding its
 * session.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresSessionRoutingPrecondition } from "../../src/adapters/postgres/sessionPlacement.ts";
import { schedulerRole } from "../../src/adapters/postgres/schema.ts";
import {
  nativeHttpMediaType,
  type HttpErrorEnvelope,
} from "../../src/contract/http.ts";
import {
  noRunnerCode,
  type PlacementRoute,
} from "../../src/contract/rosters.ts";
import { threadEntryResponseSchema } from "../../src/contract/responses.ts";
import {
  asSessionId,
  type SessionId,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import {
  asRecoveryEpoch,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { sessionPoolTurnDwellSecs } from "../../src/interpreter/sessionPlacement.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import { leadRigProject } from "./leadHarness.ts";
import {
  sessionRigAttempt,
  sessionRigAttemptState,
  sessionRigBoundless,
  sessionRigQueuedFor,
  sessionRigRouted,
  sessionRigRunner,
  sessionRigSession,
  sessionRigTurnId,
  sessionRigTurnRoutes,
  sessionRigTurnState,
  type SessionRigAttempt,
} from "./sessionHarness.ts";
import { sessionStoreDouble } from "./storeDouble.ts";
import {
  threadRigApp,
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  type ThreadRig,
  type ThreadRigMember,
} from "./threadHarness.ts";

let rig: ThreadRig;
let schedulerPool: pg.Pool;

before(async () => {
  rig = await threadRigOpen();
  schedulerPool = postgresHarnessRolePool(schedulerRole);
});

after(async () => {
  await schedulerPool.end();
  await rig.close();
});

const storeReads = sessionStoreDouble();
const versioned = {
  authorization: "Bearer valid",
  "content-type": nativeHttpMediaType,
};

/** Publishes one route for every kind, as a scheduler does when it starts. */
async function published(route: PlacementRoute): Promise<void> {
  assert.deepEqual(
    await postgresSessionRoutingPrecondition(schedulerPool, {
      routes: { Thread: route, Lead: route },
      projectRoutes: new Map(),
    }).check(new AbortController().signal),
    { met: "Met" },
  );
}

/** Withdraws the member's hosted grant, leaving their membership standing. */
function unhosted(partition: Partition, member: ThreadRigMember): void {
  rig.sessions.harness.access.grantTenant({
    tenant: partition.tenant,
    principal: member.principal,
    access: new Set(),
  });
}

function threadsOf(partition: Partition): string {
  return `/api/v1/tenants/${partition.tenant}/projects/${partition.project}/threads`;
}

/** What the open door answers the member. */
async function opening(
  partition: Partition,
  member: ThreadRigMember,
): Promise<{ readonly status: number; readonly body: unknown }> {
  await using app = threadRigApp({
    rig,
    principal: member.principal,
    access: rig.sessions.harness.access,
    store: storeReads,
  });
  const opened = await app.inject({
    method: "POST",
    url: threadsOf(partition),
    headers: versioned,
    payload: {},
  });
  return { status: opened.statusCode, body: opened.json() };
}

/** The member's thread, opened through the door. */
async function threadOf(
  partition: Partition,
  member: ThreadRigMember,
): Promise<SessionId> {
  const opened = await opening(partition, member);
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  return asSessionId(threadEntryResponseSchema.parse(opened.body).session);
}

/** One message through the door, answering the status, the turn it named and the body. */
async function sent(
  partition: Partition,
  member: ThreadRigMember,
  session: SessionId,
): Promise<{
  readonly status: number;
  readonly turn: SessionTurnId;
  readonly body: unknown;
}> {
  await using app = threadRigApp({
    rig,
    principal: member.principal,
    access: rig.sessions.harness.access,
    store: storeReads,
  });
  const turn = sessionRigTurnId("routed");
  const answered = await app.inject({
    method: "POST",
    url: `${threadsOf(partition)}/${session}/messages`,
    headers: versioned,
    payload: { turn, message: "have a look at the footer" },
  });
  return { status: answered.statusCode, turn, body: answered.json() };
}

/** Whether the cluster's placement read offers the session. */
async function offered(session: SessionId): Promise<boolean> {
  return (
    await rig.sessions.scheduler.awaitingPlacement(
      rig.sessions.epoch,
      sessionRigBoundless,
    )
  ).some((candidate) => candidate.session === session);
}

/** What the attempt's next claim takes, if anything. */
async function claimed(
  pod: SessionRigAttempt,
): Promise<SessionTurnId | undefined> {
  return (
    await rig.sessions.plane.claim({
      secret: pod.secret,
      generation: pod.attempt.generation,
    })
  )?.turn;
}

/** Claims and answers the attempt's next turn, which must be `turn`. */
async function answered(
  pod: SessionRigAttempt,
  turn: SessionTurnId,
): Promise<void> {
  assert.equal(await claimed(pod), turn);
  assert.equal(
    await rig.sessions.plane.answer({
      secret: pod.secret,
      generation: pod.attempt.generation,
      turn,
      result: "done",
    }),
    "Answered",
  );
}

test("a turn queued for a runner stays there when an administrator moves threads to the cluster", async () => {
  const partition = await threadRigProject(rig, "route-moved");
  const member = threadRigMember(rig, partition, "route-moved");
  unhosted(partition, member);
  await sessionRigRunner(rig.sessions, partition, member.principal);
  await sessionRigRouted(rig.sessions, partition, "Pool", "Pool");
  const session = await threadOf(partition, member);
  assert.equal((await sent(partition, member, session)).status, 202);
  assert.equal(await offered(session), false);

  await sessionRigRouted(rig.sessions, partition, "InCluster", "InCluster");
  assert.equal(
    (await sent(partition, member, session)).status,
    403,
    "the door admitted a turn in cluster without the hosted grant",
  );
  assert.equal(
    await offered(session),
    false,
    "the cluster was offered a turn admitted for a runner",
  );
  await assert.rejects(
    sessionRigAttempt(rig.sessions, partition, session, "route-moved"),
    /answered NotLaunchable/u,
  );
  assert.deepEqual(
    await sessionRigTurnRoutes(rig.sessions, partition, session),
    ["Pool"],
  );
});

test("a turn queued for a runner stays there when the published routing moves to the cluster", async () => {
  await published("Pool");
  const partition = await threadRigProject(rig, "route-published");
  const member = threadRigMember(rig, partition, "route-published");
  unhosted(partition, member);
  await sessionRigRunner(rig.sessions, partition, member.principal);
  const session = await threadOf(partition, member);
  assert.equal((await sent(partition, member, session)).status, 202);

  await published("InCluster");
  assert.equal(
    await offered(session),
    false,
    "the cluster was offered a turn admitted for a runner",
  );
  await assert.rejects(
    sessionRigAttempt(rig.sessions, partition, session, "route-published"),
    /answered NotLaunchable/u,
  );
});

/**
 * A pod already running claims whatever its session queues next, so the claim
 * is where a turn admitted for a runner would reach the cluster while every
 * placement read stayed shut. It takes the oldest queued turn or nothing, so a
 * turn admitted in cluster behind one admitted for a runner waits too.
 */
test("a running thread attempt claims no turn admitted for a runner, nor one queued behind it", async () => {
  const partition = await threadRigProject(rig, "route-claim");
  const member = threadRigMember(rig, partition, "route-claim");
  const session = await threadOf(partition, member);
  const first = await sent(partition, member, session);
  assert.equal(first.status, 202);
  const pod = await sessionRigAttempt(
    rig.sessions,
    partition,
    session,
    "route-claim",
  );
  await answered(pod, first.turn);

  unhosted(partition, member);
  await sessionRigRunner(rig.sessions, partition, member.principal);
  await sessionRigRouted(rig.sessions, partition, "Pool", "Pool");
  assert.equal((await sent(partition, member, session)).status, 202);
  assert.equal(
    await claimed(pod),
    undefined,
    "a cluster attempt claimed a turn admitted for a runner",
  );
  assert.equal(
    (await sessionRigAttemptState(rig.sessions, pod.attempt))["idle_unset"],
    false,
    "a claim that took nothing kept the attempt from idling",
  );

  rig.sessions.harness.access.grantTenant({
    tenant: partition.tenant,
    principal: member.principal,
    access: new Set(["ExecuteHosted"]),
  });
  await sessionRigRouted(rig.sessions, partition, "InCluster", "InCluster");
  assert.equal((await sent(partition, member, session)).status, 202);
  assert.deepEqual(
    await sessionRigTurnRoutes(rig.sessions, partition, session),
    ["InCluster", "Pool", "InCluster"],
  );
  assert.equal(
    await claimed(pod),
    undefined,
    "a cluster attempt claimed past an older turn admitted for a runner",
  );
});

test("a running lead attempt claims no turn the selector admitted for the project's runners", async () => {
  const partition = await leadRigProject(rig, "route-lead");
  const session = await sessionRigSession(
    rig.sessions,
    partition,
    "route-lead",
    { kind: "Lead" },
  );
  const offer = async (route: PlacementRoute) => {
    const turn = sessionRigTurnId("route-lead");
    const enqueued = await rig.mailbox.offer({
      partition,
      turn,
      input: "{}",
      route,
    });
    assert.equal(enqueued.offered, "Enqueued");
    return turn;
  };
  const first = await offer("InCluster");
  const pod = await sessionRigAttempt(
    rig.sessions,
    partition,
    session,
    "route-lead",
  );
  await answered(pod, first);

  await offer("Pool");
  assert.equal(
    await claimed(pod),
    undefined,
    "a cluster lead attempt claimed a turn admitted for a runner",
  );
});

/** The refusal code a door answered with. */
function refusal(body: unknown): string {
  return (body as HttpErrorEnvelope).error.code;
}

test("a member with no runner on the project is refused a thread routed to runners, and admitted once one is registered though it never polled", async () => {
  const partition = await threadRigProject(rig, "route-runnerless");
  const member = threadRigMember(rig, partition, "route-runnerless");
  const session = await threadOf(partition, member);
  const newcomer = threadRigMember(rig, partition, "route-runnerless-new");
  await sessionRigRouted(rig.sessions, partition, "Pool", "Pool");

  const refused = await opening(partition, newcomer);
  assert.deepEqual(
    [refused.status, refusal(refused.body)],
    [403, noRunnerCode],
  );
  const unsent = await sent(partition, member, session);
  assert.deepEqual([unsent.status, refusal(unsent.body)], [403, noRunnerCode]);
  assert.deepEqual(
    await sessionRigTurnRoutes(rig.sessions, partition, session),
    [],
  );

  await sessionRigRunner(rig.sessions, partition, member.principal);
  assert.equal((await sent(partition, member, session)).status, 202);
  assert.deepEqual(
    await sessionRigTurnRoutes(rig.sessions, partition, session),
    ["Pool"],
  );
});

/** Withdraws at most `turnsMax` turns offered to runners and queued past the dwell. */
function withdrawn(turnsMax = sessionRigBoundless): Promise<number> {
  return rig.sessions.scheduler.withdrawUnservedPoolTurns(
    rig.sessions.epoch,
    sessionPoolTurnDwellSecs,
    turnsMax,
  );
}

/** How a turn stands, as the two columns a withdrawal writes. */
async function standing(
  partition: Partition,
  session: SessionId,
  turn: SessionTurnId,
): Promise<readonly unknown[]> {
  const row = await sessionRigTurnState(rig.sessions, partition, session, turn);
  return [row["state"], row["failure"]];
}

test("a thread's turn offered to runners that none takes is withdrawn after the dwell, and the turn behind it is placed", async () => {
  const partition = await threadRigProject(rig, "dwell-thread");
  const member = threadRigMember(rig, partition, "dwell-thread");
  await sessionRigRunner(rig.sessions, partition, member.principal);
  await sessionRigRouted(rig.sessions, partition, "Pool", "Pool");
  const session = await threadOf(partition, member);
  const unserved = await sent(partition, member, session);
  assert.equal(unserved.status, 202);
  await sessionRigRouted(rig.sessions, partition, "InCluster", "InCluster");
  assert.equal((await sent(partition, member, session)).status, 202);
  assert.equal(await offered(session), false);

  await sessionRigQueuedFor(
    rig.sessions,
    unserved.turn,
    sessionPoolTurnDwellSecs - 60,
  );
  assert.equal(await withdrawn(), 0, "a turn was withdrawn inside the dwell");
  await sessionRigQueuedFor(
    rig.sessions,
    unserved.turn,
    sessionPoolTurnDwellSecs + 60,
  );
  assert.equal(
    await rig.sessions.scheduler.withdrawUnservedPoolTurns(
      asRecoveryEpoch("epoch-nobody-restored"),
      sessionPoolTurnDwellSecs,
      sessionRigBoundless,
    ),
    0,
    "a scheduler of a past epoch withdrew a turn",
  );
  assert.equal(await withdrawn(), 1);
  assert.deepEqual(await standing(partition, session, unserved.turn), [
    "Abandoned",
    "TurnWithdrawn",
  ]);
  assert.equal(
    await offered(session),
    true,
    "the turn behind a withdrawn one still waits",
  );
});

/**
 * The two turns offered to runners are backdated against their order, so the
 * one that waited longest is the later one and an order by ordinal would take
 * the other. The claimed and the in-cluster turn waited longer than both.
 */
test("the dwell withdraws the longest waiting turn first, and never a claimed turn or one admitted in cluster", async () => {
  const partition = await threadRigProject(rig, "dwell-order");
  const member = threadRigMember(rig, partition, "dwell-order");
  const session = await threadOf(partition, member);
  const held = await sent(partition, member, session);
  const pod = await sessionRigAttempt(
    rig.sessions,
    partition,
    session,
    "dwell-order",
  );
  assert.equal(await claimed(pod), held.turn);
  const cluster = await sent(partition, member, session);
  await sessionRigRunner(rig.sessions, partition, member.principal);
  await sessionRigRouted(rig.sessions, partition, "Pool", "Pool");
  const shorter = await sent(partition, member, session);
  const longer = await sent(partition, member, session);
  await rig.sessions.harness.query(
    `UPDATE session_turn SET route='Pool' WHERE turn=$1`,
    [held.turn],
  );
  const hour = 60 * 60;
  for (const [turn, waited] of [
    [held.turn, 4 * hour],
    [cluster.turn, 3 * hour],
    [longer.turn, 2 * hour],
    [shorter.turn, hour],
  ] as const)
    await sessionRigQueuedFor(
      rig.sessions,
      turn,
      sessionPoolTurnDwellSecs + waited,
    );

  assert.equal(await withdrawn(1), 1);
  assert.deepEqual(await standing(partition, session, longer.turn), [
    "Abandoned",
    "TurnWithdrawn",
  ]);
  assert.deepEqual(await standing(partition, session, shorter.turn), [
    "Queued",
    null,
  ]);
  assert.equal(await withdrawn(1), 1);
  assert.deepEqual(await standing(partition, session, shorter.turn), [
    "Abandoned",
    "TurnWithdrawn",
  ]);
  assert.equal(await withdrawn(), 0);
  assert.deepEqual(await standing(partition, session, held.turn), [
    "Claimed",
    null,
  ]);
  assert.deepEqual(await standing(partition, session, cluster.turn), [
    "Queued",
    null,
  ]);
});
