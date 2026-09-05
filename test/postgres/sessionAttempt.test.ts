/**
 * One session attempt from opening to cleanup, and every fence around it: the
 * index that admits one live attempt, the trigger that refuses a finished one,
 * the sweeps that end a lapsed or idle one, and the ceilings a launch is
 * refused by.
 *
 * EVERY REFUSAL IS ATTEMPTED RATHER THAN ASSUMED. A fence nobody drove is an
 * unverified control, so each of the trigger's refusals is provoked with the
 * statement it exists to stop.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type {
  AgentSession,
  SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import { asPlacementId } from "../../src/interpreter/schedulerIdentity.ts";
import type { FencedSessionAttempt } from "../../src/interpreter/sessionScheduler.ts";
import { postgresHarnessNewEpoch, postgresHarnessProject } from "./harness.ts";
import {
  sessionRigAttempt,
  type SessionRigAttempt,
  sessionRigTurnId,
  sessionRigTurnState,
  sessionRigBoundless,
  sessionRigOpen,
  sessionRigProject,
  sessionRigSession,
  sessionRigTurn,
  sessionRigAttemptState,
  type SessionRig,
} from "./sessionHarness.ts";

let rig: SessionRig;
before(async () => {
  rig = await sessionRigOpen();
});
after(async () => {
  await rig.close();
});

/** A session with one queued turn, which is what makes it launchable at all. */
async function launchable(label: string) {
  const partition = await sessionRigProject(rig, label);
  const session = await sessionRigSession(rig, partition, label);
  await sessionRigTurn(rig, partition, session, label);
  return { partition, session };
}

/**
 * Requires the attempt exempt from the idle sweep, by ageing the column an hour
 * and sweeping at a minute. The ageing is a no-op on the NULL a claim writes,
 * which is what makes the sweep's verdict the whole of what is asserted.
 */
async function stillWorking(held: SessionRigAttempt): Promise<void> {
  assert.equal(
    (await sessionRigAttemptState(rig, held.attempt))["idle_unset"],
    true,
  );
  await rig.harness.query(
    `UPDATE session_attempt SET idle_since=idle_since-interval '1 hour'
      WHERE attempt=$1`,
    [held.attempt.attempt],
  );
  await rig.scheduler.reapIdleAttempts(rig.epoch, 60, sessionRigBoundless);
  const working = await sessionRigAttemptState(rig, held.attempt);
  assert.equal(working["state"], "Running");
  assert.equal(working["evidence"], null);
}

test("an attempt is placed, then ended, and each move is fenced on its generation", async () => {
  const { partition, session } = await launchable("placed");
  const held = await sessionRigAttempt(rig, partition, session, "placed");
  assert.equal(held.attempt.generation, 1);
  assert.equal(
    await rig.scheduler.attemptPlaced(
      { ...held.attempt, generation: 2 },
      asPlacementId("placement-wrong-generation"),
    ),
    false,
  );
  assert.equal(
    await rig.scheduler.attemptPlaced(
      held.attempt,
      asPlacementId("placement-placed"),
    ),
    true,
  );
  assert.equal(
    (await sessionRigAttemptState(rig, held.attempt))["state"],
    "Running",
  );
  assert.equal(
    await rig.scheduler.attemptEnded(held.attempt, "SessionClosed"),
    true,
  );
  const ended = await sessionRigAttemptState(rig, held.attempt);
  assert.equal(ended["state"], "Lost");
  assert.equal(ended["evidence"], "SessionClosed");
  assert.equal(ended["lease_owner"], null);
  assert.equal(
    await rig.scheduler.attemptEnded(held.attempt, "SessionClosed"),
    false,
  );
});

test("a session runs one attempt at a time, and the next opens once that one ends", async () => {
  const { partition, session } = await launchable("one-live");
  const held = await sessionRigAttempt(rig, partition, session, "one-live");
  await assert.rejects(
    sessionRigAttempt(rig, partition, session, "second"),
    /NotLaunchable/u,
  );
  await rig.scheduler.attemptEnded(held.attempt, "Vanished");
  const next = await sessionRigAttempt(rig, partition, session, "next");
  assert.notEqual(next.attempt.attempt, held.attempt.attempt);
  const numbers = await rig.harness.query(
    `SELECT attempt_number::text AS attempt_number FROM session_attempt
      WHERE tenant=$1 AND project=$2 AND session=$3 ORDER BY attempt_number`,
    [partition.tenant, partition.project, session],
  );
  assert.deepEqual(numbers, [{ attempt_number: "1" }, { attempt_number: "2" }]);
});

test("the fencing trigger refuses each of the four moves it exists to stop", async () => {
  const { partition, session } = await launchable("fenced");
  const held = await sessionRigAttempt(rig, partition, session, "fenced");
  await rig.scheduler.attemptPlaced(
    held.attempt,
    asPlacementId("placement-fenced"),
  );
  await assert.rejects(
    rig.harness.query(
      `UPDATE session_attempt SET state='Placing' WHERE attempt=$1`,
      [held.attempt.attempt],
    ),
    /would return to placement after running/u,
  );
  await assert.rejects(
    rig.harness.query(
      `UPDATE session_attempt SET generation=generation-1 WHERE attempt=$1`,
      [held.attempt.attempt],
    ),
    /would move its generation backwards/u,
  );
  await assert.rejects(
    rig.harness.query(
      `UPDATE session_attempt SET bearer=bearer||'-changed' WHERE attempt=$1`,
      [held.attempt.attempt],
    ),
    /would change the identity or epoch it was issued under/u,
  );
  await rig.scheduler.attemptEnded(held.attempt, "Evicted");
  await assert.rejects(
    rig.harness.query(
      `UPDATE session_attempt SET evidence='Vanished' WHERE attempt=$1`,
      [held.attempt.attempt],
    ),
    /is already Lost, and a finished attempt is written once/u,
  );
});

test("an ended placement waits for cleanup and stops waiting once it is acknowledged", async () => {
  const { partition, session } = await launchable("cleanup");
  const held = await sessionRigAttempt(rig, partition, session, "cleanup");
  await rig.scheduler.attemptPlaced(
    held.attempt,
    asPlacementId("placement-cleanup"),
  );
  assert.deepEqual(
    (await rig.scheduler.attemptsAwaitingCleanup(sessionRigBoundless)).filter(
      (waiting: FencedSessionAttempt) =>
        waiting.attempt === held.attempt.attempt,
    ),
    [],
  );
  await rig.scheduler.attemptEnded(held.attempt, "SessionIdle");
  assert.equal(
    (await rig.scheduler.attemptsAwaitingCleanup(sessionRigBoundless)).some(
      (waiting: FencedSessionAttempt) =>
        waiting.attempt === held.attempt.attempt,
    ),
    true,
  );
  assert.equal(await rig.scheduler.attemptCleanupCompleted(held.attempt), true);
  assert.equal(
    await rig.scheduler.attemptCleanupCompleted(held.attempt),
    false,
  );
  assert.equal(
    (await rig.scheduler.attemptsAwaitingCleanup(sessionRigBoundless)).some(
      (waiting: FencedSessionAttempt) =>
        waiting.attempt === held.attempt.attempt,
    ),
    false,
  );
});

test("a lapsed lease is reaped, and an idle attempt is reaped for its own reason", async () => {
  const lapsing = await launchable("lapsed");
  const lapsed = await sessionRigAttempt(
    rig,
    lapsing.partition,
    lapsing.session,
    "lapsed",
  );
  await rig.harness.query(
    `UPDATE session_attempt SET lease_expires_at=now()-interval '1 second'
      WHERE attempt=$1`,
    [lapsed.attempt.attempt],
  );
  assert.equal(
    (await rig.scheduler.reapLapsedAttempts(rig.epoch, sessionRigBoundless)) >=
      1,
    true,
  );
  const reaped = await sessionRigAttemptState(rig, lapsed.attempt);
  assert.equal(reaped["evidence"], "LeaseExpired");

  const idling = await launchable("idle");
  const idle = await sessionRigAttempt(
    rig,
    idling.partition,
    idling.session,
    "idle",
  );
  await rig.scheduler.attemptPlaced(
    idle.attempt,
    asPlacementId("placement-idle"),
  );
  await rig.harness.query(
    `UPDATE session_attempt SET idle_since=now()-interval '1 hour' WHERE attempt=$1`,
    [idle.attempt.attempt],
  );
  assert.equal(
    (await rig.scheduler.reapIdleAttempts(
      rig.epoch,
      60,
      sessionRigBoundless,
    )) >= 1,
    true,
  );
  assert.equal(
    (await sessionRigAttemptState(rig, idle.attempt))["evidence"],
    "SessionIdle",
  );
});

test("an attempt inside its placement backoff is refused a successor until it is out", async () => {
  const { partition, session } = await launchable("backoff");
  const held = await sessionRigAttempt(rig, partition, session, "backoff");
  await rig.scheduler.attemptEnded(held.attempt, "Vanished");
  await assert.rejects(
    sessionRigAttempt(rig, partition, session, "too-soon", {
      placementBackoffSecs: 3_600,
    }),
    /BackingOff/u,
  );
  await sessionRigAttempt(rig, partition, session, "out-of-backoff");
});

test("a session with nothing queued and a closed session are both unlaunchable", async () => {
  const partition = await sessionRigProject(rig, "quiet");
  const session = await sessionRigSession(rig, partition, "quiet");
  await assert.rejects(
    sessionRigAttempt(rig, partition, session, "quiet"),
    /NotLaunchable/u,
  );
  await sessionRigTurn(rig, partition, session, "quiet");
  await rig.sessions.close(partition, session);
  await assert.rejects(
    sessionRigAttempt(rig, partition, session, "closed"),
    /NotLaunchable/u,
  );
});

test("the read offers only sessions with queued work and no attempt already running", async () => {
  const { partition, session } = await launchable("awaiting");
  const offered = async () =>
    (
      await rig.scheduler.awaitingPlacement(rig.epoch, sessionRigBoundless)
    ).some((candidate: AgentSession) => candidate.session === session);
  assert.equal(await offered(), true);
  const held = await sessionRigAttempt(rig, partition, session, "awaiting");
  assert.equal(await offered(), false);
  await rig.scheduler.attemptEnded(held.attempt, "Vanished");
  assert.equal(await offered(), true);
  await rig.sessions.close(partition, session);
  assert.equal(await offered(), false);
});

test("a per-account ceiling binds one account and leaves another project's alone", async () => {
  const first = await sessionRigProject(rig, "account-first");
  const lead = await sessionRigSession(rig, first, "account-first");
  await sessionRigTurn(rig, first, lead, "account-first");
  await sessionRigAttempt(rig, first, lead, "account-first");
  const second = await sessionRigProject(rig, "account-second");
  const elsewhere = await sessionRigSession(rig, second, "account-second");
  await sessionRigTurn(rig, second, elsewhere, "account-second");
  const accounts = await rig.harness.query(
    `SELECT count(DISTINCT account)::text AS accounts FROM agent_session
      WHERE session = ANY($1::text[])`,
    [[lead, elsewhere]],
  );
  assert.deepEqual(accounts, [{ accounts: "2" }]);
  await sessionRigAttempt(rig, second, elsewhere, "account-second", {
    attemptsPerAccountMax: 1,
  });
});

test("a per-account ceiling and a cluster ceiling each refuse the launch they bind", async () => {
  const partition = await sessionRigProject(rig, "ceilings");
  const lead = await sessionRigSession(rig, partition, "ceiling-lead");
  await sessionRigTurn(rig, partition, lead, "ceiling-lead");
  const thread = await sessionRigSession(rig, partition, "ceiling-thread", {
    kind: "Thread",
    principal: "member-ceiling",
  });
  await sessionRigTurn(rig, partition, thread, "ceiling-thread");
  await sessionRigAttempt(rig, partition, lead, "ceiling-first");
  await assert.rejects(
    sessionRigAttempt(rig, partition, thread, "ceiling-account", {
      attemptsPerAccountMax: 1,
    }),
    /AccountAtMaximum/u,
  );
  await assert.rejects(
    sessionRigAttempt(rig, partition, thread, "ceiling-cluster", {
      clusterAttemptsMax: 1,
    }),
    /ClusterFull/u,
  );
  await sessionRigAttempt(rig, partition, thread, "ceiling-room");
});

test("the server itself admits one live attempt and one claimed turn per session", async () => {
  const { partition, session } = await launchable("indexed");
  const held = await sessionRigAttempt(rig, partition, session, "indexed");
  await assert.rejects(
    rig.harness.query(
      `INSERT INTO session_attempt
         (tenant,project,session,attempt,attempt_number,recovery_epoch,
          lease_owner,lease_expires_at,bearer,bearer_secret_digest)
       SELECT tenant,project,session,attempt||'-again',attempt_number+1,recovery_epoch,
              lease_owner,lease_expires_at,bearer||'-again',
              encode(sha256(convert_to(attempt,'UTF8')),'hex')
         FROM session_attempt WHERE attempt=$1`,
      [held.attempt.attempt],
    ),
    /session_attempt_one_live/u,
  );
  await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  await sessionRigTurn(rig, partition, session, "indexed-second");
  await assert.rejects(
    rig.harness.query(
      `UPDATE session_turn SET state='Claimed',attempt=$4,claim_generation=1,
              claimed_at=now()
        WHERE tenant=$1 AND project=$2 AND session=$3 AND state='Queued'`,
      [partition.tenant, partition.project, session, held.attempt.attempt],
    ),
    /session_turn_one_claimed/u,
  );
});

test("an attempt holding a claimed turn is never reaped as idle, however long it works", async () => {
  const { partition, session } = await launchable("busy");
  const held = await sessionRigAttempt(rig, partition, session, "busy");
  await rig.scheduler.attemptPlaced(
    held.attempt,
    asPlacementId("placement-busy"),
  );
  const claimed = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.notEqual(claimed, undefined);
  await stillWorking(held);
  if (claimed !== undefined)
    assert.equal(
      (await sessionRigTurnState(rig, partition, session, claimed.turn))[
        "state"
      ],
      "Claimed",
    );
  assert.equal(
    await rig.plane.answer({
      secret: held.secret,
      generation: held.attempt.generation,
      turn: claimed?.turn ?? sessionRigTurnId("absent"),
      result: "answered at last",
    }),
    "Answered",
  );
  assert.equal(
    (await sessionRigAttemptState(rig, held.attempt))["idle_unset"],
    false,
  );
});

test("a placement recorded after a claim leaves the working attempt exempt from the sweep", async () => {
  const { partition, session } = await launchable("placed-late");
  const held = await sessionRigAttempt(rig, partition, session, "placed-late");
  const claimed = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.notEqual(claimed, undefined);
  assert.equal(
    await rig.scheduler.attemptPlaced(
      held.attempt,
      asPlacementId("placement-placed-late"),
    ),
    true,
  );
  await stillWorking(held);
});

/**
 * Whether the observation read offers one attempt. The suites of one worker
 * share a database, so a case reads the whole bounded page and picks its own
 * attempt out of it.
 */
async function observed(
  attempt: FencedSessionAttempt,
): Promise<FencedSessionAttempt | undefined> {
  const offered = await rig.scheduler.attemptsAwaitingObservation(
    rig.epoch,
    sessionRigBoundless,
  );
  return offered.find((one) => one.attempt === attempt.attempt);
}

/** The reason the second read gives for one attempt, which is the whole of its subject. */
function reason(attempt: FencedSessionAttempt) {
  return rig.scheduler.attemptTurnFailure(attempt);
}

test("only a placed, live attempt of this epoch has a pod to observe", async () => {
  const { partition, session } = await launchable("observable");
  const held = await sessionRigAttempt(rig, partition, session, "observable");
  assert.equal(await observed(held.attempt), undefined);
  await rig.scheduler.attemptPlaced(
    held.attempt,
    asPlacementId("placement-observable"),
  );
  assert.deepEqual(await observed(held.attempt), held.attempt);
  assert.equal(
    (
      await rig.scheduler.attemptsAwaitingObservation(
        asRecoveryEpoch("epoch-nobody-restored"),
        sessionRigBoundless,
      )
    ).length,
    0,
  );
  await rig.scheduler.attemptEnded(held.attempt, "TurnFailed");
  assert.equal(await observed(held.attempt), undefined);
});

/** Places one attempt and claims the turn its session is holding for it. */
async function working(label: string) {
  const { partition, session } = await launchable(label);
  const held = await sessionRigAttempt(rig, partition, session, label);
  await rig.scheduler.attemptPlaced(
    held.attempt,
    asPlacementId(`placement-${label}`),
  );
  const claimed = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  if (claimed === undefined)
    throw new Error(`session attempt: ${label} claimed no turn`);
  return { partition, session, held, turn: claimed.turn };
}

test("the reason read carries the failure of the last turn the attempt ended", async () => {
  const { held, turn } = await working("refused");
  assert.equal(await reason(held.attempt), undefined);
  assert.equal(
    await rig.plane.fail({
      secret: held.secret,
      generation: held.attempt.generation,
      turn,
      failure: "StoreRefused",
    }),
    "Failed",
  );
  assert.equal(await reason(held.attempt), "StoreRefused");
});

test("an attempt whose last turn was answered carries no failure", async () => {
  const { held, turn } = await working("answered");
  assert.equal(
    await rig.plane.answer({
      secret: held.secret,
      generation: held.attempt.generation,
      turn,
      result: "the answer",
    }),
    "Answered",
  );
  assert.equal(await reason(held.attempt), undefined);
});

/**
 * A failed turn releases its attempt, so the read finds the attempt's own turns
 * by when they ended rather than by a column. What that has to get right is the
 * boundary: a turn an earlier attempt failed is not this one's evidence.
 */
test("a turn a previous attempt failed is not the successor's failure", async () => {
  const { partition, session, held, turn } = await working("successor");
  await rig.plane.fail({
    secret: held.secret,
    generation: held.attempt.generation,
    turn,
    failure: "AgentFailed",
  });
  await rig.scheduler.attemptEnded(held.attempt, "TurnFailed");
  await sessionRigTurn(rig, partition, session, "successor-next");
  const next = await sessionRigAttempt(
    rig,
    partition,
    session,
    "successor-next",
  );
  await rig.scheduler.attemptPlaced(
    next.attempt,
    asPlacementId("placement-successor-next"),
  );
  assert.equal(await reason(next.attempt), undefined);
});

/**
 * The reason follows the LAST turn the attempt ended, which is what the
 * ordering decides and what nothing else in this file reaches: every other case
 * has one attempt end at most one turn. `AgentFailed` is a failure the pod
 * carries on from, so the same attempt goes on to claim and answer the next.
 */
test("an attempt that ended two turns is read as the second, not the first", async () => {
  const { partition, session, held, turn } = await working("two-turns");
  const second = await sessionRigTurn(
    rig,
    partition,
    session,
    "two-turns-next",
  );
  await rig.plane.fail({
    secret: held.secret,
    generation: held.attempt.generation,
    turn,
    failure: "AgentFailed",
  });
  assert.equal(await reason(held.attempt), "AgentFailed");
  const claimed = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.equal(claimed?.turn, second);
  await rig.plane.answer({
    secret: held.secret,
    generation: held.attempt.generation,
    turn: second,
    result: "the answer",
  });
  assert.equal(await reason(held.attempt), undefined);
});

/**
 * Withdraws one turn by identity, which is what the selector's own door does
 * and what no attempt is party to. `withdraw_lead_turn` is driven directly
 * because the withdrawal is the subject: what a session's other turns do to
 * this attempt's row is a claim about the definer, not about a port.
 */
async function withdrawn(turn: SessionTurnId): Promise<void> {
  const answered = await rig.harness.query(
    `SELECT withdraw_lead_turn($1) AS withdrawn`,
    [turn],
  );
  assert.equal(answered[0]?.["withdrawn"], "Withdrawn");
}

/**
 * A turn the platform abandons is not a turn any attempt ended. This case is
 * held by the state bound and the ordering together — the withdrawal is the
 * higher ordinal AND the earlier end, so either alone would answer it — and the
 * case below is what the state bound holds by itself.
 */
test("a turn withdrawn while the attempt worked another is not the attempt's failure", async () => {
  const { partition, session, held, turn } = await working("withdrawn");
  const behind = await sessionRigTurn(
    rig,
    partition,
    session,
    "withdrawn-next",
  );
  await withdrawn(behind);
  await rig.plane.answer({
    secret: held.secret,
    generation: held.attempt.generation,
    turn,
    result: "the answer",
  });
  assert.equal(await reason(held.attempt), undefined);
});

/**
 * The same mechanism in the other direction: a withdrawal must mask no
 * refusal. The withdrawal is both the higher ordinal and the later end here, so
 * this is the case the state bound alone holds.
 */
test("a withdrawal after a refused turn leaves the refusal standing", async () => {
  const { partition, session, held, turn } = await working("masked");
  const behind = await sessionRigTurn(rig, partition, session, "masked-next");
  await rig.plane.fail({
    secret: held.secret,
    generation: held.attempt.generation,
    turn,
    failure: "StoreRefused",
  });
  await withdrawn(behind);
  assert.equal(await reason(held.attempt), "StoreRefused");
});

test("a restore fences every attempt an older epoch issued, and the sweep is bounded", async () => {
  const { partition, session } = await launchable("fencing");
  const held = await sessionRigAttempt(rig, partition, session, "fencing");
  const restored = await rig.harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  assert.equal(await rig.scheduler.fenceOldEpochAttempts(rig.epoch, 1), 0);
  assert.equal(
    (await rig.scheduler.fenceOldEpochAttempts(
      restored,
      sessionRigBoundless,
    )) >= 1,
    true,
  );
  const fenced = await sessionRigAttemptState(rig, held.attempt);
  assert.equal(fenced["state"], "Superseded");
  assert.equal(fenced["evidence"], "Fenced");
  assert.equal(fenced["generation"], "2");
  assert.equal(
    (await postgresHarnessProject(
      rig.harness.store,
      "session-fencing-after",
    )) !== undefined,
    true,
  );
});
