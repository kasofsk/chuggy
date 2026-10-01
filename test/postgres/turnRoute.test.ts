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
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresSessionRoutingPrecondition } from "../../src/adapters/postgres/sessionPlacement.ts";
import { schedulerRole } from "../../src/adapters/postgres/schema.ts";
import { nativeHttpMediaType } from "../../src/contract/http.ts";
import type { PlacementRoute } from "../../src/contract/rosters.ts";
import { threadEntryResponseSchema } from "../../src/contract/responses.ts";
import {
  asSessionId,
  type SessionId,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import { leadRigProject } from "./leadHarness.ts";
import {
  sessionRigAttempt,
  sessionRigAttemptState,
  sessionRigBoundless,
  sessionRigRouted,
  sessionRigSession,
  sessionRigTurnId,
  sessionRigTurnRoutes,
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

/** The member's thread, opened through the door. */
async function threadOf(
  partition: Partition,
  member: ThreadRigMember,
): Promise<SessionId> {
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
  assert.equal(opened.statusCode, 201, opened.body);
  return asSessionId(threadEntryResponseSchema.parse(opened.json()).session);
}

/** One message through the door, answering the status and the turn it named. */
async function sent(
  partition: Partition,
  member: ThreadRigMember,
  session: SessionId,
): Promise<{ readonly status: number; readonly turn: SessionTurnId }> {
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
  return { status: answered.statusCode, turn };
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
