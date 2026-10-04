/**
 * What migration 035 adds, driven against a real PostgreSQL by the role each
 * boundary is granted to: the door a member stops a turn through, what the
 * turn then is to every reader of an ending, the end its stream is given, and
 * what the runner that held it is told and answered.
 *
 * A STOP IS AN ENDING NO POD MADE. So each case that follows a stop asks what
 * the attempt, the scheduler and the mailbox make of a turn that ended under
 * an attempt still running, which is the shape no other ending has.
 *
 * WHAT IS HEARD IS ASKED OF A LISTENER. The stop's end and a runner's events
 * are notifications, so the cases about their order hold one transaction open
 * and wait for the server to say the other is waiting on it.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type pg from "pg";

import {
  apiRole,
  configurationImporterRole,
  finalizerRole,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresSessionLiveLane,
  postgresSessionLivePublisher,
} from "../../src/adapters/postgres/sessionLive.ts";
import { sessionChangeResourceSchema } from "../../src/contract/events.ts";
import { threadTurnsAnsweredMax } from "../../src/contract/http.ts";
import type { SessionLiveEvent } from "../../src/contract/sessionLive.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import type { Principal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { asPlacementId } from "../../src/interpreter/schedulerIdentity.ts";
import type { ThreadLiveCarried } from "../../src/interpreter/threadLive.ts";
import type { ThreadTurnStopped } from "../../src/interpreter/threadRead.ts";
import {
  postgresHarnessDenial,
  postgresHarnessRolePool,
  postgresHarnessRoleUrl,
} from "./harness.ts";
import {
  sessionRigAttempt,
  sessionRigAttemptState,
  type SessionRigAttempt,
  sessionRigBoundless,
  sessionRigSession,
  sessionRigTurn,
} from "./sessionHarness.ts";
import {
  threadRigMember,
  type ThreadRigMember,
  threadRigOpen,
  threadRigProject,
  threadRigSiblingProject,
  threadRigThread,
  threadRigTurnId,
  type ThreadRig,
} from "./threadHarness.ts";

let rig: ThreadRig;
let planePool: pg.Pool;

before(async () => {
  rig = await threadRigOpen();
  planePool = postgresHarnessRolePool(workerPlaneRole);
});

after(async () => {
  await planePool.end();
  await rig.close();
});

/** One member's open thread in a project of its own. */
interface Threaded {
  readonly partition: Partition;
  readonly member: ThreadRigMember;
  readonly session: SessionId;
}

async function threaded(label: string): Promise<Threaded> {
  const partition = await threadRigProject(rig, label);
  const member = threadRigMember(rig, partition, label);
  const thread = await threadRigThread(rig, partition, member);
  return { partition, member, session: thread.session };
}

/** Sends one message to the thread, which is one queued turn. */
async function said(at: Threaded, label: string): Promise<SessionTurnId> {
  const turn = asSessionTurnId(threadRigTurnId(label));
  const enqueued = await rig.threads.enqueueMessage({
    partition: at.partition,
    principal: at.member.principal,
    session: at.session,
    turn,
    input: label,
    route: "InCluster",
  });
  assert.equal(enqueued.enqueued, "Enqueued");
  return turn;
}

/** The stop door, as the thread's own member unless the case names another caller. */
function stop(
  at: Threaded,
  turn: SessionTurnId,
  principal: Principal = at.member.principal,
): Promise<ThreadTurnStopped> {
  return rig.threads.stopTurn({
    partition: at.partition,
    principal,
    session: at.session,
    turn,
  });
}

/** A live attempt on the thread, placed, which is a runner on it. */
async function running(
  at: Threaded,
  label: string,
): Promise<SessionRigAttempt> {
  const held = await sessionRigAttempt(
    rig.sessions,
    at.partition,
    at.session,
    label,
  );
  await rig.sessions.scheduler.attemptPlaced(
    held.attempt,
    asPlacementId(`placement-${label}`),
  );
  return held;
}

/** The turn the attempt's mailbox hands it next. */
async function claimed(
  held: SessionRigAttempt,
): Promise<SessionTurnId | undefined> {
  return (
    await rig.sessions.plane.claim({
      secret: held.secret,
      generation: held.attempt.generation,
    })
  )?.turn;
}

/** Everything one turn's row holds that an ending writes or must not. */
async function stored(turn: SessionTurnId): Promise<Record<string, unknown>> {
  const rows = await rig.sessions.harness.query(
    `SELECT state,failure,ended_at::text AS ended_at,attempt,
            claim_generation::text AS claim_generation,
            claimed_at::text AS claimed_at,
            attempts_spent::text AS attempts_spent,result,
            batch_first::text AS batch_first,batch_last::text AS batch_last,
            model,tokens::text AS tokens,cost_micros::text AS cost_micros,
            duration_ms::text AS duration_ms,tools::text AS tools
       FROM session_turn WHERE turn=$1`,
    [turn],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`thread turn stop: no turn ${turn}`);
  return row;
}

/** What a stopped turn's row is, beside the instant it ended at. */
const stoppedRow = {
  state: "Abandoned",
  failure: "TurnStopped",
  attempt: null,
  claim_generation: null,
  claimed_at: null,
  attempts_spent: "0",
  result: null,
  batch_first: null,
  batch_last: null,
  model: null,
  tokens: null,
  cost_micros: null,
  duration_ms: null,
  tools: null,
};

async function endedStopped(turn: SessionTurnId): Promise<string> {
  const { ended_at: endedAt, ...row } = await stored(turn);
  assert.deepEqual(row, stoppedRow);
  assert.equal(typeof endedAt, "string", "a stopped turn has ended");
  return String(endedAt);
}

/** The instant the attempt's idle clock started, or null where it has not. */
async function idleSince(held: SessionRigAttempt): Promise<unknown> {
  const rows = await rig.sessions.harness.query(
    `SELECT idle_since::text AS idle_since FROM session_attempt WHERE attempt=$1`,
    [held.attempt.attempt],
  );
  return rows[0]?.["idle_since"];
}

test("a stop ends a claimed turn and a queued one at once, with no result and no measurement", async () => {
  const at = await threaded("ends");
  const first = await said(at, "ends-first");
  const second = await said(at, "ends-second");
  const held = await running(at, "ends");
  assert.equal(await claimed(held), first);

  assert.equal(await stop(at, first), "Stopped");
  await endedStopped(first);
  assert.equal(await stop(at, second), "Stopped");
  await endedStopped(second);

  const standing = await rig.threads.standing({
    partition: at.partition,
    session: at.session,
    query: { limit: threadTurnsAnsweredMax },
  });
  assert.deepEqual(
    standing?.turns.map((turn) => [turn.turn, turn.state, turn.failure]),
    [
      [first, "Abandoned", "TurnStopped"],
      [second, "Abandoned", "TurnStopped"],
    ],
    "the thread read lists a stopped turn as it lists any ended one",
  );
  assert.equal(standing?.thread.state, "Open", "a stop closes no thread");
});

test("a turn stopped while queued is never handed to a runner, and the one behind it is", async () => {
  const at = await threaded("unclaimed");
  const stoppedTurn = await said(at, "unclaimed-stopped");
  const behind = await said(at, "unclaimed-behind");
  assert.equal(await stop(at, stoppedTurn), "Stopped");

  const held = await running(at, "unclaimed");
  assert.equal(await claimed(held), behind);
  await endedStopped(stoppedTurn);
});

test("a stop of a turn that has ended answers that it had, and leaves the ending it has", async () => {
  const at = await threaded("again");
  const stoppedTurn = await said(at, "again-stopped");
  const answered = await said(at, "again-answered");
  const failed = await said(at, "again-failed");
  assert.equal(await stop(at, stoppedTurn), "Stopped");
  const endedAt = await endedStopped(stoppedTurn);

  assert.equal(await stop(at, stoppedTurn), "AlreadyEnded");
  assert.equal(await endedStopped(stoppedTurn), endedAt);

  const held = await running(at, "again");
  assert.equal(await claimed(held), answered);
  assert.equal(
    await rig.sessions.plane.answer({
      secret: held.secret,
      generation: held.attempt.generation,
      turn: answered,
      result: "the answer",
    }),
    "Answered",
  );
  assert.equal(await claimed(held), failed);
  assert.equal(
    await rig.sessions.plane.fail({
      secret: held.secret,
      generation: held.attempt.generation,
      turn: failed,
      failure: "AgentFailed",
    }),
    "Failed",
  );
  for (const [turn, state, failure, result] of [
    [answered, "Answered", null, "the answer"],
    [failed, "Failed", "AgentFailed", null],
  ] as const) {
    const before = await stored(turn);
    assert.equal(await stop(at, turn), "AlreadyEnded");
    assert.deepEqual(await stored(turn), before);
    assert.deepEqual(
      [before["state"], before["failure"], before["result"]],
      [state, failure, result],
    );
  }
});

/**
 * Who may stop is decided before the turn is looked at, so each refusal is
 * asked for a turn that would otherwise be stopped and for one that does not
 * exist, and answers the same.
 */
test("the door admits the caller's own open thread and refuses every other session before it reads a turn", async () => {
  const at = await threaded("admits");
  const turn = await said(at, "admits");
  const absent = asSessionTurnId(threadRigTurnId("admits-absent"));
  const other = threadRigMember(rig, at.partition, "admits-other");
  const theirs: Threaded = {
    partition: at.partition,
    member: other,
    session: (await threadRigThread(rig, at.partition, other)).session,
  };
  const theirTurn = await said(theirs, "admits-theirs");
  const sibling = await threadRigSiblingProject(rig, at.partition, "admits");
  const lead = await sessionRigSession(rig.sessions, at.partition, "admits", {
    kind: "Lead",
    principal: at.member.principal,
  });
  const leadTurn = await sessionRigTurn(
    rig.sessions,
    at.partition,
    lead,
    "admits-lead",
  );

  for (const named of [turn, absent]) {
    assert.equal(await stop(at, named, other.principal), "NotYourThread");
    assert.equal(
      await stop({ ...at, partition: sibling }, named),
      "NoThread",
      "a thread is its own project's",
    );
    assert.equal(
      await stop(
        { ...at, session: asSessionId("session-nobody-opened") },
        named,
      ),
      "NoThread",
    );
  }
  assert.equal(
    await stop({ ...at, session: lead }, leadTurn),
    "NoThread",
    "the door stops a thread's turn and no other session's",
  );
  assert.equal(await stop(at, absent), "NoTurn");
  assert.equal(
    await stop(at, theirTurn),
    "NoTurn",
    "a turn is stopped through the thread that holds it",
  );
  for (const untouched of [turn, theirTurn, leadTurn])
    assert.equal((await stored(untouched))["state"], "Queued");

  await rig.threads.close({ partition: at.partition, session: at.session });
  for (const named of [turn, absent]) {
    assert.equal(await stop(at, named), "Closed");
    assert.equal(
      await stop(at, named, other.principal),
      "NotYourThread",
      "whose thread it is is answered before whether it is open",
    );
  }
  assert.equal((await stored(turn))["failure"], "SessionClosed");
});

/**
 * Waits until a statement in this suite's database is waiting on a lock, which
 * is what the second of two transactions does while the first is open.
 */
async function blocked(): Promise<void> {
  for (let asked = 0; asked < 400; asked += 1) {
    const rows = await rig.sessions.harness.query(
      `SELECT count(*)::text AS waiting FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND state='active'`,
    );
    if (Number(rows[0]?.["waiting"]) > 0) return;
    await delay(25);
  }
  throw new Error(
    "thread turn stop: nothing ever waited on the open transaction",
  );
}

/** The stop door on a connection of the case's own, whose transaction the case can hold open. */
async function stopOn(
  client: pg.PoolClient,
  at: Threaded,
  turn: SessionTurnId,
): Promise<string | undefined> {
  const answered = await client.query<{ stopped: string }>(
    `SELECT stop_thread_turn($1,$2,$3,$4,$5)::text AS stopped`,
    [
      at.partition.tenant,
      at.partition.project,
      at.member.principal,
      at.session,
      turn,
    ],
  );
  return answered.rows[0]?.stopped;
}

/**
 * A close and a stop both end the turn, and the turn's row lock is what makes
 * one of them the ending: the later finds the turn ended and writes nothing.
 * Each order is driven with the first transaction held open until the server
 * shows the second waiting on it.
 */
test("a stop behind a close of its thread finds the turn ended, and the close is the ending", async () => {
  const at = await threaded("race-close-first");
  const turn = await said(at, "race-close-first");
  const api = await rig.apiPool.connect();
  try {
    await api.query("BEGIN");
    const closed = await api.query<{ closed: string }>(
      `SELECT close_member_thread($1,$2,$3)::text AS closed`,
      [at.partition.tenant, at.partition.project, at.session],
    );
    assert.equal(closed.rows[0]?.closed, "Closed");
    const stopping = stop(at, turn);
    await blocked();
    await api.query("COMMIT");
    assert.equal(await stopping, "AlreadyEnded");
  } finally {
    await api.query("ROLLBACK").catch(() => undefined);
    api.release();
  }
  assert.equal((await stored(turn))["failure"], "SessionClosed");
});

test("a close behind a stop closes the thread, and the stop is still the turn's ending", async () => {
  const at = await threaded("race-stop-first");
  const turn = await said(at, "race-stop-first");
  const behind = await said(at, "race-stop-first-behind");
  const api = await rig.apiPool.connect();
  try {
    await api.query("BEGIN");
    assert.equal(await stopOn(api, at, turn), "Stopped");
    const closing = rig.threads.close({
      partition: at.partition,
      session: at.session,
    });
    await blocked();
    await api.query("COMMIT");
    assert.equal((await closing).closed, "Closed");
  } finally {
    await api.query("ROLLBACK").catch(() => undefined);
    api.release();
  }
  await endedStopped(turn);
  assert.equal((await stored(behind))["failure"], "SessionClosed");
});

/** One claimed turn of a thread, stopped under the attempt that holds it. */
async function stoppedUnder(label: string) {
  const at = await threaded(label);
  const turn = await said(at, label);
  const held = await running(at, label);
  assert.equal(await claimed(held), turn);
  assert.equal(await stop(at, turn), "Stopped");
  return { at, turn, held };
}

test("a stop leaves the attempt that held the turn live, holding its lease and charged nothing", async () => {
  const { at, turn, held } = await stoppedUnder("live");
  const behind = await said(at, "live-behind");

  const standing = await sessionRigAttemptState(rig.sessions, held.attempt);
  assert.deepEqual(
    [standing["state"], standing["evidence"], standing["running"]],
    ["Running", null, true],
  );
  assert.equal(
    await rig.sessions.plane.heartbeat(
      held.secret,
      held.attempt.generation,
      60,
    ),
    true,
    "its lease is still its own to renew",
  );

  assert.equal(await idleSince(held), null, "a stop starts no idle clock");
  await rig.sessions.harness.query(
    `UPDATE session_attempt SET idle_since=idle_since-interval '1 hour'
      WHERE attempt=$1`,
    [held.attempt.attempt],
  );
  await rig.sessions.scheduler.reapIdleAttempts(
    rig.sessions.epoch,
    60,
    sessionRigBoundless,
  );
  assert.equal(
    (await sessionRigAttemptState(rig.sessions, held.attempt))["state"],
    "Running",
    "an attempt is not reaped as idle for the stop of the turn it was working",
  );
  assert.equal(
    (
      await rig.sessions.scheduler.awaitingPlacement(
        rig.sessions.epoch,
        sessionRigBoundless,
      )
    ).some((session) => session.session === at.session),
    false,
    "a session with a runner on it is placed nowhere else for the turn behind",
  );
  assert.equal(
    await rig.sessions.scheduler.attemptTurnFailure(held.attempt),
    undefined,
    "a stop is no failure of the attempt's",
  );
  assert.equal(await claimed(held), behind, "the attempt takes the next turn");
  await endedStopped(turn);
});

test("an attempt lost after its turn was stopped gives the turn back to nobody", async () => {
  const { turn, held } = await stoppedUnder("lost");
  const endedAt = await endedStopped(turn);

  assert.equal(
    await rig.sessions.scheduler.attemptEnded(held.attempt, "Vanished"),
    true,
  );
  assert.equal(await endedStopped(turn), endedAt);
});

/**
 * The runner that held a stopped turn settles it when its model stops, and one
 * that never heard of the stop settles it when its model finishes. Either is
 * answered as taken, changes nothing of the turn, and starts the idle clock a
 * settlement starts.
 */
test("a late answer and a late failure of a stopped turn are each taken, and the turn keeps its ending", async () => {
  for (const settle of ["answer", "fail"] as const) {
    const { turn, held } = await stoppedUnder(`late-${settle}`);
    const endedAt = await endedStopped(turn);
    const late = () =>
      settle === "answer"
        ? rig.sessions.plane.answer({
            secret: held.secret,
            generation: held.attempt.generation,
            turn,
            result: "what the model had written",
            batchFirst: 1,
            batchLast: 2,
            measured: {
              model: "a-model",
              tokens: 10,
              costMicros: 20,
              durationMs: 30,
              tools: ["Read"],
            },
          })
        : rig.sessions.plane.fail({
            secret: held.secret,
            generation: held.attempt.generation,
            turn,
            failure: "AgentFailed",
          });

    assert.equal(await late(), "Stopped", settle);
    assert.equal(await endedStopped(turn), endedAt, settle);
    assert.notEqual(await idleSince(held), null, settle);

    await rig.sessions.harness.query(
      `UPDATE session_attempt SET idle_since=idle_since-interval '1 hour'
        WHERE attempt=$1`,
      [held.attempt.attempt],
    );
    const aged = await idleSince(held);
    assert.equal(await late(), "Stopped", settle);
    assert.equal(
      await idleSince(held),
      aged,
      "a settlement sent again moves no idle clock forward",
    );
    assert.equal(await endedStopped(turn), endedAt, settle);
  }
});

test("a late settlement of a stopped turn starts no idle clock under an attempt working another turn", async () => {
  const { at, turn, held } = await stoppedUnder("late-working");
  const next = await said(at, "late-working-next");
  assert.equal(await claimed(held), next);

  assert.equal(
    await rig.sessions.plane.answer({
      secret: held.secret,
      generation: held.attempt.generation,
      turn,
      result: "late",
    }),
    "Stopped",
  );
  assert.equal(await idleSince(held), null);
  assert.equal((await stored(next))["state"], "Claimed");
});

/** What the attempt is answered for an answer and then a failure of one turn, sent now. */
async function settledLate(
  held: SessionRigAttempt,
  turn: SessionTurnId,
  failure: "AgentFailed" | "StoreRefused" = "AgentFailed",
): Promise<readonly string[]> {
  const by = { secret: held.secret, generation: held.attempt.generation, turn };
  return [
    await rig.sessions.plane.answer({ ...by, result: "late" }),
    await rig.sessions.plane.fail({ ...by, failure }),
  ];
}

test("a late settlement is taken from a live attempt alone", async () => {
  const { turn, held } = await stoppedUnder("late-fenced");
  await rig.sessions.scheduler.attemptEnded(held.attempt, "Vanished");
  const endedAt = await endedStopped(turn);

  assert.deepEqual(await settledLate(held, turn), ["Fenced", "Fenced"]);
  assert.equal(await endedStopped(turn), endedAt);
});

/**
 * Only a stop makes a late settlement welcome, and only a stop is what a
 * runner's watch is told of. A turn the platform withdrew under the attempt,
 * and one the attempt itself settled another way, each refuse the settlement
 * as they did before there was a stop.
 */
test("a late settlement of a turn that ended any other way is still refused", async () => {
  const partition = await threadRigProject(rig, "late-other");
  const lead = await sessionRigSession(rig.sessions, partition, "late-other");
  const withdrawn = await sessionRigTurn(
    rig.sessions,
    partition,
    lead,
    "late-other-withdrawn",
  );
  const held = await sessionRigAttempt(
    rig.sessions,
    partition,
    lead,
    "late-other",
  );
  assert.equal(await claimed(held), withdrawn);
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT withdraw_lead_turn($1)::text AS withdrawn`,
      [withdrawn],
    ),
    [{ withdrawn: "Withdrawn" }],
  );
  const abandoned = await stored(withdrawn);
  assert.deepEqual(
    [abandoned["state"], abandoned["failure"]],
    ["Abandoned", "TurnWithdrawn"],
  );
  assert.deepEqual(await settledLate(held, withdrawn), [
    "Conflict",
    "Conflict",
  ]);
  assert.deepEqual(await stored(withdrawn), abandoned);
  assert.equal(
    await rig.sessions.plane.watched({
      secret: held.secret,
      generation: held.attempt.generation,
      turn: withdrawn,
    }),
    undefined,
    "its runner is told of no stop",
  );

  const failed = await sessionRigTurn(
    rig.sessions,
    partition,
    lead,
    "late-other-failed",
  );
  assert.equal(await claimed(held), failed);
  await rig.sessions.plane.fail({
    secret: held.secret,
    generation: held.attempt.generation,
    turn: failed,
    failure: "AgentFailed",
  });
  assert.deepEqual(await settledLate(held, failed, "StoreRefused"), [
    "Conflict",
    "Conflict",
  ]);
});

/**
 * What the runner's held question reads. It is told of a stop of any turn of
 * its own session, told to go on asking only while it holds the turn claimed,
 * and told nothing of a turn that is neither or of a session not its own.
 */
test("the watch tells a live attempt its turn is held, then that it was stopped, and nothing of any other turn", async () => {
  const at = await threaded("watch");
  const turn = await said(at, "watch");
  const behind = await said(at, "watch-behind");
  const held = await running(at, "watch");
  const watched = (
    named: SessionTurnId,
    by: SessionRigAttempt = held,
    generation: number = by.attempt.generation,
  ) =>
    rig.sessions.plane.watched({ secret: by.secret, generation, turn: named });
  assert.equal(await watched(turn), undefined, "a queued turn is not held");
  assert.equal(await claimed(held), turn);

  assert.equal(await watched(turn), "Held");
  assert.equal(await watched(behind), undefined);
  assert.equal(
    await watched(asSessionTurnId(threadRigTurnId("watch-absent"))),
    undefined,
  );
  assert.equal(
    await watched(turn, held, held.attempt.generation + 1),
    undefined,
    "a generation the attempt does not hold reads nothing",
  );

  const elsewhere = await threaded("watch-elsewhere");
  const theirs = await said(elsewhere, "watch-elsewhere");
  const other = await running(elsewhere, "watch-elsewhere");
  assert.equal(await claimed(other), theirs);
  assert.equal(await watched(theirs), undefined, "another session's turn");
  assert.equal(await watched(turn, other), undefined);

  assert.equal(await stop(at, turn), "Stopped");
  assert.equal(await watched(turn), "Stopped");
  assert.equal(await watched(turn, other), undefined);
  assert.equal(await watched(theirs, other), "Held");

  assert.equal(await claimed(held), behind);
  await rig.sessions.plane.answer({
    secret: held.secret,
    generation: held.attempt.generation,
    turn: behind,
    result: "the answer",
  });
  assert.equal(
    await watched(behind),
    undefined,
    "a turn that ended any other way was not stopped",
  );

  await rig.sessions.scheduler.attemptEnded(held.attempt, "Vanished");
  assert.equal(
    await watched(turn),
    undefined,
    "an attempt that has ended is told nothing",
  );
});

/** How long a case waits for something it has already sent. */
const waitMsMax = 10_000;

async function reaches(reading: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < waitMsMax; waited += 10) {
    if (reading()) return;
    await delay(10);
  }
  throw new Error(`thread turn stop: ${what} never happened`);
}

/** The API's own listener on the live lane, and what it has heard of one project. */
async function listening(partition: Partition): Promise<{
  readonly heard: ThreadLiveCarried[];
  close: () => Promise<void>;
}> {
  const heard: ThreadLiveCarried[] = [];
  let unread = 0;
  let live = false;
  const lane = postgresSessionLiveLane(
    postgresHarnessRoleUrl(apiRole).toString(),
    { reconnectBaseMs: 50, reconnectMaxMs: 200 },
  );
  lane.open({
    arrived: () => true,
    heard: (carried) => {
      if (carried.partition.project === partition.project) heard.push(carried);
    },
    unread: () => {
      unread += 1;
    },
    sourced: (source) => {
      live = source === "Live";
    },
  });
  await reaches(() => live, "the lane listening");
  return {
    heard,
    close: async () => {
      await lane.close();
      assert.equal(unread, 0, "a payload on the lane was not one event");
    },
  };
}

const ended: SessionLiveEvent = { live: "End" };

function written(text: string): SessionLiveEvent {
  return { live: "Text", message: "message-1", index: 0, offset: 0, text };
}

/** Posts a runner's events for one turn, as the plane's own role. */
function posted(
  at: Threaded,
  turn: SessionTurnId,
  events: readonly SessionLiveEvent[],
  session: SessionId = at.session,
) {
  return postgresSessionLivePublisher(planePool, {
    dropped: () => undefined,
  }).publish({ partition: at.partition, session, turn, events });
}

test("a stop tells the thread's readers the turn's stream ended, as the event the lane reads", async () => {
  const at = await threaded("live-end");
  const queued = await said(at, "live-end-queued");
  const lane = await listening(at.partition);
  try {
    assert.equal(await stop(at, queued), "Stopped");
    await reaches(() => lane.heard.length === 1, "the stop's end");
    assert.deepEqual(lane.heard, [
      {
        partition: at.partition,
        session: at.session,
        turn: queued,
        event: ended,
      },
    ]);

    assert.equal(await stop(at, queued), "AlreadyEnded");
    const claimedTurn = await said(at, "live-end-claimed");
    const held = await running(at, "live-end");
    assert.equal(await claimed(held), claimedTurn);
    assert.equal(await stop(at, claimedTurn), "Stopped");
    await reaches(() => lane.heard.length === 2, "the second stop's end");
    assert.deepEqual(
      lane.heard.map((carried) => [carried.turn, carried.event]),
      [
        [queued, ended],
        [claimedTurn, ended],
      ],
      "a stop that ended nothing says nothing",
    );
  } finally {
    await lane.close();
  }
});

/**
 * What a runner writes of a turn reaches a reader while its session holds that
 * turn claimed and at no other time, which is what keeps a stopped turn's
 * stream ended while its model is still writing. Each post that must reach
 * nobody is followed by one that is carried, so what was heard is the whole of
 * what was published.
 */
test("what a runner writes of a turn is published while its session holds the turn claimed and at no other time", async () => {
  const at = await threaded("live-claimed");
  const turn = await said(at, "live-claimed");
  const behind = await said(at, "live-claimed-behind");
  const held = await running(at, "live-claimed");
  const elsewhere = await threaded("live-claimed-elsewhere");
  const theirs = await said(elsewhere, "live-claimed-elsewhere");
  assert.equal(
    await claimed(await running(elsewhere, "live-claimed-elsewhere")),
    theirs,
  );
  const lane = await listening(at.partition);
  const heard = () =>
    lane.heard.map((carried) => [carried.turn, carried.event]);
  try {
    assert.equal(await posted(at, turn, [written("queued")]), "Unheld");
    assert.equal(await claimed(held), turn);
    await posted(at, turn, [written("a"), written("b")]);
    await posted(at, behind, [written("behind")]);
    await posted(at, theirs, [written("another session's turn")]);
    await posted(at, turn, [written("another session")], elsewhere.session);
    assert.equal(await posted(at, turn, [written("c")]), "Published");
    await reaches(() => lane.heard.length >= 3, "the claimed turn's events");
    const whileClaimed = [
      [turn, written("a")],
      [turn, written("b")],
      [turn, written("c")],
    ];
    assert.deepEqual(heard(), whileClaimed);

    assert.equal(await stop(at, turn), "Stopped");
    assert.equal(await posted(at, turn, [written("late")]), "Unheld");
    assert.equal(await claimed(held), behind);
    await posted(at, turn, [written("later")]);
    await posted(at, behind, [written("next")]);
    await reaches(() => lane.heard.length >= 5, "the next turn's event");
    assert.deepEqual(
      heard(),
      [...whileClaimed, [turn, ended], [behind, written("next")]],
      "nothing a runner writes of a stopped turn reaches a reader",
    );
  } finally {
    await lane.close();
  }
});

/**
 * A runner posts the end of a turn's stream as it reads the turn's result, and
 * settles the turn after; nothing holds the first to arrive first. An end is
 * carried whenever it arrives, so a turn answered ahead of it is not left
 * drawn as being written, while text beside it is still left out.
 */
test("a runner's end of a turn's stream is published after the turn has ended, and what it wrote beside it is not", async () => {
  const at = await threaded("live-late-end");
  const turn = await said(at, "live-late-end");
  const held = await running(at, "live-late-end");
  assert.equal(await claimed(held), turn);
  const lane = await listening(at.partition);
  try {
    await posted(at, turn, [written("the answer")]);
    assert.equal(
      await rig.sessions.plane.answer({
        secret: held.secret,
        generation: held.attempt.generation,
        turn,
        result: "the answer",
      }),
      "Answered",
    );
    assert.equal(
      await posted(at, turn, [written("late"), ended, written("later")]),
      "Unheld",
    );
    await reaches(() => lane.heard.length >= 2, "the late end");
    const next = await said(at, "live-late-end-next");
    assert.equal(await stop(at, next), "Stopped");
    await reaches(() => lane.heard.length >= 3, "the end after it");
    assert.deepEqual(
      lane.heard.map((carried) => [carried.turn, carried.event]),
      [
        [turn, written("the answer")],
        [turn, ended],
        [next, ended],
      ],
    );
  } finally {
    await lane.close();
  }
});

/** One claimed turn of a thread with a runner on it, and a listener on its project. */
async function streaming(label: string) {
  const at = await threaded(label);
  const turn = await said(at, label);
  assert.equal(await claimed(await running(at, label)), turn);
  return { at, turn, lane: await listening(at.partition) };
}

/**
 * A reader that heard an event after the turn's end would draw the turn as
 * being written again. So a post and a stop of one turn wait on each other:
 * the post is published wholly before the stop's end or not at all.
 */
test("a post in flight when its turn is stopped is heard before the turn's end", async () => {
  const { at, turn, lane } = await streaming("live-race-post-first");
  const plane = await planePool.connect();
  try {
    await plane.query("BEGIN");
    const published = await plane.query<{ published: boolean }>(
      `SELECT publish_session_live($1,$2,$3,$4,$5::text[]) AS published`,
      [
        at.partition.tenant,
        at.partition.project,
        at.session,
        turn,
        [
          JSON.stringify({
            tenant: at.partition.tenant,
            project: at.partition.project,
            session: at.session,
            turn,
            ordinal: 0,
            event: written("in flight"),
          }),
        ],
      ],
    );
    assert.deepEqual(published.rows, [{ published: true }]);
    const stopping = stop(at, turn);
    await blocked();
    await plane.query("COMMIT");
    assert.equal(await stopping, "Stopped");
    await reaches(() => lane.heard.length >= 2, "the post and the end");
    assert.deepEqual(
      lane.heard.map((carried) => carried.event),
      [written("in flight"), ended],
    );
  } finally {
    await plane.query("ROLLBACK").catch(() => undefined);
    plane.release();
    await lane.close();
  }
});

test("a post that arrives behind a stop of its turn waits for it and reaches nobody", async () => {
  const { at, turn, lane } = await streaming("live-race-stop-first");
  const api = await rig.apiPool.connect();
  try {
    await api.query("BEGIN");
    assert.equal(await stopOn(api, at, turn), "Stopped");
    const posting = posted(at, turn, [written("too late")]);
    await blocked();
    await api.query("COMMIT");
    assert.equal(await posting, "Unheld");
    await reaches(() => lane.heard.length >= 1, "the stop's end");
    const next = await said(at, "live-race-stop-first-next");
    assert.equal(await stop(at, next), "Stopped");
    await reaches(() => lane.heard.length >= 2, "the end after it");
    assert.deepEqual(
      lane.heard.map((carried) => [carried.turn, carried.event]),
      [
        [turn, ended],
        [next, ended],
      ],
    );
  } finally {
    await api.query("ROLLBACK").catch(() => undefined);
    api.release();
    await lane.close();
  }
});

/**
 * The console re-reads a thread on the Session frame a turn's move appends, so
 * a stop has to move the turn the way the trigger watches for, or a page that
 * did not click would go on drawing the turn as running.
 */
test("a stop raises the Session frame the console re-reads the thread on", async () => {
  const at = await threaded("frame");
  const turn = await said(at, "frame");
  const framed = async () =>
    (
      await rig.sessions.harness.query(
        `SELECT resource FROM project_change
          WHERE tenant=$1 AND project=$2 AND kind='Session' ORDER BY sequence`,
        [at.partition.tenant, at.partition.project],
      )
    ).map((row) =>
      sessionChangeResourceSchema.parse(JSON.parse(String(row["resource"]))),
    );
  const frame = { session: at.session, kind: "Thread", turn };
  assert.deepEqual(await framed(), [frame]);

  assert.equal(await stop(at, turn), "Stopped");
  assert.deepEqual(await framed(), [frame, frame]);
  assert.equal(await stop(at, turn), "AlreadyEnded");
  assert.deepEqual(await framed(), [frame, frame]);
});

/** Every role a deployment holds, so each is asked for a boundary it is not granted. */
const everyRuntimeRole = [
  apiRole,
  selectorServiceRole,
  schedulerRole,
  workerPlaneRole,
  ticketServiceRole,
  finalizerRole,
  configurationImporterRole,
];

test("each boundary 035 declares is the role's it was granted to and no other's", async () => {
  for (const [granted, what, statement] of [
    [
      apiRole,
      "stop_thread_turn",
      "SELECT stop_thread_turn('t','p','m','s','u')",
    ],
    [
      workerPlaneRole,
      "session_turn_stopped",
      "SELECT session_turn_stopped('d',1,'u')",
    ],
    [
      workerPlaneRole,
      "publish_session_live",
      "SELECT publish_session_live('t','p','s','u',ARRAY[]::text[])",
    ],
  ] as const)
    for (const role of everyRuntimeRole) {
      const refusal = await rig.sessions.harness.attemptAs(role, statement);
      if (role === granted)
        assert.equal(refusal, undefined, `${role}: ${what}`);
      else
        assert.match(
          refusal ?? "",
          postgresHarnessDenial(what),
          `${role} may reach ${what}`,
        );
    }
});
