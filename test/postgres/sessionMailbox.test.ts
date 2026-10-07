/**
 * The mailbox as a pod drives it: claiming a turn under an attempt's
 * generation, answering or failing it exactly once, and what an attempt that
 * ends does to the turn it was holding.
 *
 * A STALE GENERATION IS THE WHOLE POINT OF THESE CASES. A pod that was fenced
 * still holds a bearer, so every boundary here is offered one under a
 * generation the durable side has moved past, and a boundary that answered it
 * would be a second writer for one turn.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import { sessionTurnAttemptsMax } from "../../src/contract/http.ts";
import { sessionPlaneRoutes } from "../../src/contract/sessionPlane.ts";
import { asPlacementId } from "../../src/interpreter/schedulerIdentity.ts";
import {
  inertSessionPlane,
  inertWorkerPlane,
} from "../adapters/workerPlaneFixtures.ts";
import {
  sessionRigAttempt,
  sessionRigAttemptState,
  sessionRigOpen,
  sessionRigProject,
  sessionRigSession,
  sessionRigTurn,
  sessionRigTurnState,
  type SessionRig,
} from "./sessionHarness.ts";

let rig: SessionRig;
before(async () => {
  rig = await sessionRigOpen();
});
after(async () => {
  await rig.close();
});

/** What either read finds of a live attempt on an open session that has failed no turn. */
const none = { turnFailure: undefined, sessionClosed: false };

/** A session with two queued turns and a live attempt holding its bearer. */
async function mailbox(label: string) {
  const partition = await sessionRigProject(rig, label);
  const session = await sessionRigSession(rig, partition, label);
  const first = await sessionRigTurn(rig, partition, session, `${label}-first`);
  const second = await sessionRigTurn(
    rig,
    partition,
    session,
    `${label}-second`,
  );
  const held = await sessionRigAttempt(rig, partition, session, label);
  return { partition, session, first, second, held };
}

test("a claim takes the lowest queued turn, and takes the same one again", async () => {
  const { first, held } = await mailbox("claim");
  const claimed = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.equal(claimed?.turn, first);
  assert.equal(claimed?.ordinal, 1);
  assert.equal(claimed?.inputKind, "UserMessage");
  const again = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.equal(again?.turn, first);
});

test("a claim under a generation the durable side has moved past takes nothing", async () => {
  const { held } = await mailbox("stale");
  assert.equal(
    await rig.plane.claim({
      secret: held.secret,
      generation: held.attempt.generation + 1,
    }),
    undefined,
  );
  const claimed = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.notEqual(claimed, undefined);
});

test("answering is idempotent, a different answer conflicts, and a stale one is fenced", async () => {
  const { partition, session, first, held } = await mailbox("answer");
  await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  const answer = {
    secret: held.secret,
    generation: held.attempt.generation,
    turn: first,
    result: "the answer",
    batchFirst: 1,
    batchLast: 2,
  };
  assert.equal(await rig.plane.answer(answer), "Answered");
  assert.equal(await rig.plane.answer(answer), "AlreadyAnswered");
  assert.equal(
    await rig.plane.answer({ ...answer, result: "a different answer" }),
    "Conflict",
  );
  assert.equal(await rig.plane.answer({ ...answer, generation: 99 }), "Fenced");
  const stored = await sessionRigTurnState(rig, partition, session, first);
  assert.equal(stored["state"], "Answered");
  assert.equal(stored["result"], "the answer");
  assert.equal(stored["batch_first"], "1");
  assert.equal(stored["attempt"], null);
});

test("failing a turn is idempotent, and a failure outside the roster is refused", async () => {
  const { partition, session, first, held } = await mailbox("failing");
  await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.equal(
    await rig.plane.fail({
      secret: held.secret,
      generation: held.attempt.generation,
      turn: first,
      failure: "StoreRefused",
    }),
    "Failed",
  );
  assert.equal(
    await rig.plane.fail({
      secret: held.secret,
      generation: held.attempt.generation,
      turn: first,
      failure: "StoreRefused",
    }),
    "AlreadyFailed",
  );
  assert.equal(
    await rig.plane.fail({
      secret: held.secret,
      generation: held.attempt.generation,
      turn: first,
      failure: "AgentFailed",
    }),
    "Conflict",
  );
  assert.equal(
    (await sessionRigTurnState(rig, partition, session, first))["failure"],
    "StoreRefused",
  );
});

test("an ending attempt returns the turn it held and spends one of its attempts", async () => {
  const { partition, session, first, held } = await mailbox("returned");
  await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  await rig.scheduler.attemptEnded(held.attempt, "Vanished");
  const returned = await sessionRigTurnState(rig, partition, session, first);
  assert.equal(returned["state"], "Queued");
  assert.equal(returned["attempts_spent"], "1");
  assert.equal(returned["attempt"], null);
  assert.equal(returned["claim_generation"], null);
});

test("the attempt that exhausts a turn's budget fails it, and the mailbox moves on", async () => {
  const { partition, session, first, second, held } =
    await mailbox("exhausted");
  let attempt = held;
  for (let spent = 0; spent < sessionTurnAttemptsMax; spent++) {
    const claimed = await rig.plane.claim({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
    });
    assert.equal(claimed?.turn, first);
    await rig.scheduler.attemptEnded(attempt.attempt, "Vanished");
    if (spent + 1 < sessionTurnAttemptsMax)
      attempt = await sessionRigAttempt(
        rig,
        partition,
        session,
        `retry-${String(spent)}`,
      );
  }
  const exhausted = await sessionRigTurnState(rig, partition, session, first);
  assert.equal(exhausted["state"], "Failed");
  assert.equal(exhausted["failure"], "AttemptLost");
  assert.equal(exhausted["attempts_spent"], String(sessionTurnAttemptsMax));
  const next = await sessionRigAttempt(
    rig,
    partition,
    session,
    "after-exhausted",
  );
  assert.equal(
    (
      await rig.plane.claim({
        secret: next.secret,
        generation: next.attempt.generation,
      })
    )?.turn,
    second,
  );
});

/**
 * The session twin of kasofsk/chuggy#386. The pair is what makes either half
 * falsifiable: a boundary that charged nothing on both arms would pass the held
 * case alone, and one that charged on both would pass the lost case alone.
 */
test("a held attempt returns its turn uncharged, where a lost one spends an attempt", async () => {
  const { partition, session, first, held } = await mailbox("held");
  assert.equal(
    (
      await rig.plane.claim({
        secret: held.secret,
        generation: held.attempt.generation,
      })
    )?.turn,
    first,
  );
  assert.equal(
    await rig.plane.hold(held.secret, held.attempt.generation),
    true,
  );
  const requeued = await sessionRigTurnState(rig, partition, session, first);
  assert.equal(requeued["state"], "Queued");
  assert.equal(requeued["attempts_spent"], "0");
  assert.equal(requeued["attempt"], null);
  assert.equal(requeued["failure"], null);
  const ended = await sessionRigAttemptState(rig, held.attempt);
  assert.equal(ended["state"], "Withdrawn");
  assert.equal(ended["evidence"], "AgentRateLimited");

  const next = await sessionRigAttempt(rig, partition, session, "held-next");
  assert.equal(
    (
      await rig.plane.claim({
        secret: next.secret,
        generation: next.attempt.generation,
      })
    )?.turn,
    first,
  );
  await rig.scheduler.attemptEnded(next.attempt, "Vanished");
  assert.equal(
    (await sessionRigTurnState(rig, partition, session, first))[
      "attempts_spent"
    ],
    "1",
  );
});

test("a hold under a generation the durable side has moved past holds nothing", async () => {
  const { partition, session, first, held } = await mailbox("held-stale");
  await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.equal(
    await rig.plane.hold(held.secret, held.attempt.generation + 1),
    false,
  );
  assert.equal(
    (await sessionRigTurnState(rig, partition, session, first))["state"],
    "Claimed",
  );
  const unmoved = await sessionRigAttemptState(rig, held.attempt);
  assert.equal(unmoved["running"], true);
  assert.equal(unmoved["evidence"], null);
});

test("a pod reads its own session's facts, renews its lease, and loses its attempt", async () => {
  const { partition, session, held } = await mailbox("plane");
  const authority = await rig.plane.authenticate(held.secret);
  assert.equal(authority?.session, session);
  assert.equal(authority?.kind, "Lead");
  assert.equal(authority?.live, true);
  assert.deepEqual(authority?.capabilities, ["RepositoryRead"]);
  assert.equal(authority?.credentialSlot, "claude-code");
  assert.equal(authority?.agentReference, undefined);
  assert.equal(
    await rig.plane.heartbeat(held.secret, held.attempt.generation, 120),
    true,
  );
  assert.equal(await rig.plane.heartbeat(held.secret, 99, 120), false);
  assert.equal(
    await rig.plane.lose(held.secret, held.attempt.generation, "TurnFailed"),
    true,
  );
  assert.equal((await rig.plane.authenticate(held.secret))?.live, false);
  await rig.sessions.close(partition, session);
});

/** The worker plane over the rig's own plane, so a runner's report reaches the real boundaries. */
function endedReporter(secret: string) {
  const app = createWorkerPlaneApp({
    ...inertWorkerPlane(1),
    sessions: { ...inertSessionPlane(rig.plane), losses: rig.plane },
  });
  const ended = (phase: string) =>
    app.inject({
      method: sessionPlaneRoutes.ended.method,
      url: sessionPlaneRoutes.ended.path,
      headers: { authorization: `Bearer ${secret}` },
      payload: { phase },
    });
  return { app, ended };
}

test("a runner's report that its session's container failed loses the attempt as the observed failure would, once", async () => {
  const { partition, session, first, held } = await mailbox("ended");
  await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  const { app, ended } = endedReporter(held.secret);
  assert.equal((await ended("Failed")).statusCode, 204);
  const lost = await sessionRigAttemptState(rig, held.attempt);
  assert.equal(lost["state"], "Lost");
  assert.equal(lost["evidence"], "TurnFailed");
  assert.equal(lost["running"], false);
  const returned = await sessionRigTurnState(rig, partition, session, first);
  assert.equal(returned["state"], "Queued");
  assert.equal(returned["attempts_spent"], "1");
  const again = await ended("Succeeded");
  assert.equal(again.statusCode, 401);
  assert.equal(
    (await sessionRigAttemptState(rig, held.attempt))["evidence"],
    "TurnFailed",
  );
  await app.close();
  await rig.sessions.close(partition, session);
});

/**
 * The container exited cleanly, and the runner says so; the turn it refused to
 * store is what the attempt is charged with, read by the bearer exactly as the
 * scheduler reads it by the attempt, and by no stale or ended bearer.
 */
test("a container that exited cleanly after refusing a turn's store is charged StoreRefused", async () => {
  const { partition, session, first, held } = await mailbox("ended-store");
  const { secret } = held;
  const { generation } = held.attempt;
  await rig.plane.claim({ secret, generation });
  assert.equal(
    await rig.plane.fail({
      secret,
      generation,
      turn: first,
      failure: "StoreRefused",
    }),
    "Failed",
  );
  const refused = { turnFailure: "StoreRefused", sessionClosed: false };
  assert.deepEqual(await rig.plane.turnFailure(secret, generation), refused);
  assert.deepEqual(
    await rig.scheduler.attemptTurnFailure(held.attempt),
    refused,
  );
  assert.deepEqual(await rig.plane.turnFailure(secret, generation + 1), none);
  const { app, ended } = endedReporter(secret);
  assert.equal((await ended("Succeeded")).statusCode, 204);
  const lost = await sessionRigAttemptState(rig, held.attempt);
  assert.equal(lost["state"], "Lost");
  assert.equal(lost["evidence"], "StoreRefused");
  assert.deepEqual(await rig.plane.turnFailure(secret, generation), none);
  await app.close();
  await rig.sessions.close(partition, session);
});

/**
 * The bearer's read answers the session's close beside the failure, as the
 * worker plane's own role and through a bearer the close leaves live.
 */
test("a live bearer's read answers its session closed once it is, and open until then", async () => {
  const { partition, session, first, held } = await mailbox("ended-closed");
  const { secret } = held;
  const { generation } = held.attempt;
  await rig.plane.claim({ secret, generation });
  assert.deepEqual(await rig.plane.turnFailure(secret, generation), none);
  await rig.plane.fail({
    secret,
    generation,
    turn: first,
    failure: "StoreRefused",
  });
  assert.deepEqual(await rig.plane.turnFailure(secret, generation), {
    turnFailure: "StoreRefused",
    sessionClosed: false,
  });
  await rig.sessions.close(partition, session);
  assert.deepEqual(await rig.plane.turnFailure(secret, generation), {
    turnFailure: "StoreRefused",
    sessionClosed: true,
  });
  assert.deepEqual(await rig.plane.turnFailure(secret, generation + 1), none);
});

test("the runtime's session id is bound once, and a second one is a conflict", async () => {
  const { partition, session, held } = await mailbox("reference");
  assert.equal(
    await rig.plane.bind({
      secret: held.secret,
      generation: held.attempt.generation,
      reference: "runtime-1",
    }),
    "Bound",
  );
  assert.equal(
    await rig.plane.bind({
      secret: held.secret,
      generation: held.attempt.generation,
      reference: "runtime-1",
    }),
    "AlreadyBound",
  );
  assert.equal(
    await rig.plane.bind({
      secret: held.secret,
      generation: held.attempt.generation,
      reference: "runtime-2",
    }),
    "Conflict",
  );
  assert.equal(
    await rig.plane.bind({
      secret: held.secret,
      generation: 99,
      reference: "runtime-3",
    }),
    "Fenced",
  );
  assert.equal(
    (await rig.sessions.session(partition, session))?.agentReference,
    "runtime-1",
  );
});

test("the bearer resolves to the partition, session and principal it was minted for", async () => {
  const { partition, session, held } = await mailbox("binding");
  await rig.scheduler.attemptPlaced(
    held.attempt,
    asPlacementId("placement-binding"),
  );
  const bound = await rig.plane.binding({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.deepEqual(bound?.partition, partition);
  assert.equal(bound?.session, session);
  assert.equal(bound?.kind, "Lead");
  assert.equal(bound?.principal, "principal-binding");
  assert.equal(
    await rig.plane.binding({ secret: held.secret, generation: 99 }),
    undefined,
  );
});
