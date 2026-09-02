/**
 * The lead's mailbox door and the reads over it, against a real server: what
 * the selector may offer, read and withdraw, what a withdrawn turn does to the
 * pod holding it, and what the API sees of a lead and its decisions.
 *
 * THE POD IS DRIVEN THROUGH THE WORKER PLANE'S OWN ROLE. A withdrawal is only
 * a proof if the answer that follows it is refused at the door the pod
 * actually uses, so the cases here claim and answer through the session plane
 * rather than by writing the turn row.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import {
  leadTurnsAnsweredMax,
  selectorHistoryLimitMax,
  sessionStorePageBatchesMax,
  sessionStoreStreamsAnswered,
  sessionTurnToolsMax,
} from "../../src/contract/http.ts";
import {
  asSessionStoreStream,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import { postgresProjectChangeLog } from "../../src/adapters/postgres/projectChangeLog.ts";
import { selectorServiceRole } from "../../src/adapters/postgres/schema.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import { leadRigDecision, leadRigOpen, leadRigProject } from "./leadHarness.ts";
import type { LeadRig } from "./leadHarness.ts";
import {
  sessionRigAttempt,
  sessionRigSession,
  sessionRigTurn,
  sessionRigTurnId,
  sessionRigTurnState,
} from "./sessionHarness.ts";

let rig: LeadRig;
before(async () => {
  rig = await leadRigOpen();
});
after(async () => {
  await rig.close();
});

/** What one turn's observation says when the case is not about the document. */
const anObservation = '{"version":1}';

/** A lead session and the project holding it, which most cases open together. */
async function leadProject(
  label: string,
): Promise<{ partition: Partition; session: SessionId }> {
  const partition = await leadRigProject(rig, label);
  const session = await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
  });
  return { partition, session };
}

/** One live attempt, which is what a pod holds when it claims a turn. */
function leadPod(partition: Partition, session: SessionId, label: string) {
  return sessionRigAttempt(rig.sessions, partition, session, label);
}

test("the mailbox answers the project's lead and nothing else", async () => {
  const { partition, session } = await leadProject("standing");
  const standing = await rig.mailbox.lead(partition);
  assert.equal(standing?.session, session);
  assert.equal(standing?.state, "Open");
  assert.equal(
    standing?.agentReference,
    undefined,
    "a session that has taken no turn has bound no runtime session",
  );

  const bare = await leadRigProject(rig, "standing-none");
  assert.equal(await rig.mailbox.lead(bare), undefined);
});

test("a project whose only session is a thread has no lead to offer a turn to", async () => {
  const partition = await leadRigProject(rig, "thread-only");
  await sessionRigSession(rig.sessions, partition, "thread-only", {
    kind: "Thread",
    principal: "member-thread-only",
  });
  assert.equal(await rig.mailbox.lead(partition), undefined);
  assert.deepEqual(
    await rig.mailbox.offer({
      partition,
      turn: sessionRigTurnId("thread-only"),
      input: anObservation,
    }),
    { offered: "NoLead" },
    "the selector may reach one session per project and a thread is not it",
  );
});

test("one decision offers one turn however often it is retried", async () => {
  const { partition, session } = await leadProject("idempotent");
  const turn = sessionRigTurnId("idempotent");
  const first = await rig.mailbox.offer({
    partition,
    turn,
    input: anObservation,
  });
  assert.equal(first.offered, "Enqueued");
  const again = await rig.mailbox.offer({
    partition,
    turn,
    input: anObservation,
  });
  assert.deepEqual(again, {
    offered: "AlreadyEnqueued",
    ordinal: first.offered === "Enqueued" ? first.ordinal : 0,
  });

  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT input_kind FROM session_turn
        WHERE tenant=$1 AND project=$2 AND session=$3`,
      [partition.tenant, partition.project, session],
    ),
    [{ input_kind: "Observation" }],
    "the door writes one input kind, so the selector cannot spell a thread's",
  );
});

test("a closed lead takes no more turns", async () => {
  const { partition, session } = await leadProject("closed");
  assert.equal(await rig.sessions.sessions.close(partition, session), true);
  assert.deepEqual(
    await rig.mailbox.offer({
      partition,
      turn: sessionRigTurnId("closed"),
      input: anObservation,
    }),
    { offered: "Closed" },
  );
});

test("an answered turn reports what the pod measured of it", async () => {
  const { partition, session } = await leadProject("measured");
  const turn = sessionRigTurnId("measured");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "measured");
  const claimed = await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.equal(claimed?.turn, turn);
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: '{"version":1,"dispatches":[]}',
      measured: {
        model: "claude-model",
        tokens: 41_234,
        costMicros: 182_000,
        durationMs: 74_210,
        tools: ["Read", "Grep"],
      },
    }),
    "Answered",
  );

  assert.deepEqual(await rig.mailbox.turn(partition, turn), {
    state: "Answered",
    result: '{"version":1,"dispatches":[]}',
    measured: {
      model: "claude-model",
      tokens: 41_234,
      costMicros: 182_000,
      durationMs: 74_210,
      tools: ["Read", "Grep"],
    },
  });
});

test("a turn answered without a measurement carries none", async () => {
  const { partition, session } = await leadProject("unmeasured");
  const turn = sessionRigTurnId("unmeasured");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "unmeasured");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: "{}",
    }),
    "Answered",
  );
  const standing = await rig.mailbox.turn(partition, turn);
  assert.equal(standing?.state, "Answered");
  assert.equal(
    standing?.measured,
    undefined,
    "a turn with no measurement is a decision with no provenance",
  );
});

test("a half-written measurement is refused by the constraint", async () => {
  const { partition, session } = await leadProject("half-measured");
  const turn = sessionRigTurnId("half-measured");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "half-measured");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  await assert.rejects(
    rig.sessions.harness.query(
      `SELECT answer_session_turn($1,$2,$3,$4,NULL,NULL,$5,$6,NULL,$7,$8)`,
      [
        attempt.digest,
        attempt.attempt.generation,
        turn,
        "{}",
        "claude-model",
        1,
        1,
        ["Read"],
      ],
    ),
    /session_turn_measure_is_whole/u,
  );
});

test("more tool names than a turn may report is refused by the constraint", async () => {
  const { partition, session } = await leadProject("tool-bound");
  const turn = sessionRigTurnId("tool-bound");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "tool-bound");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  await assert.rejects(
    rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: "{}",
      measured: {
        model: "claude-model",
        tokens: 1,
        costMicros: 1,
        durationMs: 1,
        tools: Array.from(
          { length: sessionTurnToolsMax + 1 },
          (_unused, index) => `tool-${String(index)}`,
        ),
      },
    }),
    /session_turn_measure_is_bounded/u,
  );
});

test("a withdrawn turn is abandoned and the pod holding it is refused", async () => {
  const { partition, session } = await leadProject("withdraw");
  const turn = sessionRigTurnId("withdraw");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "withdraw");
  assert.equal(
    (
      await rig.sessions.plane.claim({
        secret: attempt.secret,
        generation: attempt.attempt.generation,
      })
    )?.turn,
    turn,
  );

  assert.equal(await rig.mailbox.withdraw(partition, turn), "Withdrawn");
  assert.deepEqual(
    await sessionRigTurnState(rig.sessions, partition, session, turn),
    {
      state: "Abandoned",
      attempt: null,
      claim_generation: null,
      attempts_spent: "0",
      result: null,
      failure: "TurnWithdrawn",
      batch_first: null,
      batch_last: null,
    },
  );
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: "{}",
    }),
    "Conflict",
    "a withdrawn turn can never be answered, which is what makes it a proof",
  );
  assert.equal(await rig.mailbox.withdraw(partition, turn), "AlreadyEnded");
  assert.equal(
    await rig.mailbox.withdraw(partition, sessionRigTurnId("never-offered")),
    "NoTurn",
  );
});

test("the API reads the lead, its mailbox tail and the streams beneath it", async () => {
  const { partition, session } = await leadProject("api-read");
  const turn = sessionRigTurnId("api-read");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "api-read");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  assert.equal(
    await rig.sessions.plane.record({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream,
      batch: 1,
      digest: "b".repeat(64),
      bytes: 12,
      events: 2,
    }),
    "Stored",
  );
  await rig.sessions.plane.answer({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    turn,
    result: "{}",
    batchFirst: 1,
    batchLast: 1,
    measured: {
      model: "claude-model",
      tokens: 10,
      costMicros: 20,
      durationMs: 30,
      tools: [],
    },
  });

  const lead = await rig.apiLead.lead(partition, leadTurnsAnsweredMax);
  assert.equal(lead?.session, session);
  assert.equal(lead?.state, "Open");
  assert.equal(lead?.attention, "Monitoring");
  assert.equal(lead?.handoffNote, "{}");
  assert.deepEqual(
    lead?.turns.map((each) => [each.turn, each.state, each.inputKind]),
    [[turn, "Answered", "Observation"]],
  );
  assert.deepEqual(lead?.turns[0]?.measured, {
    model: "claude-model",
    tokens: 10,
    costMicros: 20,
    durationMs: 30,
    tools: [],
  });
  assert.equal(lead?.turns[0]?.batchFirst, 1);

  assert.deepEqual(
    await rig.apiLead.streams(partition, sessionStoreStreamsAnswered),
    [{ stream, batches: 1 }],
  );
  assert.deepEqual(
    await rig.apiLead.batches(partition, {
      stream,
      after: 0,
      limit: sessionStorePageBatchesMax,
    }),
    [{ batch: 1, digest: "b".repeat(64), bytes: 12 }],
  );
});

test("a lead that has taken no turn still reads", async () => {
  const { partition, session } = await leadProject("api-read-empty");
  const lead = await rig.apiLead.lead(partition, leadTurnsAnsweredMax);
  assert.equal(lead?.session, session);
  assert.deepEqual(lead?.turns, []);
  assert.equal(lead?.notificationCursor, 0);
});

test("the API reads the decision log and the intent one decision left", async () => {
  const partition = await leadRigProject(rig, "api-history");
  const first = await leadRigDecision(rig, partition, "api-history-one", {
    notificationCursor: 5,
  });
  const second = await leadRigDecision(rig, partition, "api-history-two", {
    notificationCursor: 9,
  });

  const page = await rig.apiLead.history(
    partition,
    undefined,
    selectorHistoryLimitMax,
  );
  assert.deepEqual(
    page.map((decision) => decision.decision),
    [first, second],
  );
  assert.deepEqual(page[0]?.observedView, []);
  assert.deepEqual(page[0]?.context.handoffNote, {});
  assert.equal(page[0]?.instructions, "choose a dispatchable ticket");
  assert.equal(page[0]?.modelRevision, "model-1");

  const after = await rig.apiLead.history(
    partition,
    page[0]?.ordinal,
    selectorHistoryLimitMax,
  );
  assert.deepEqual(
    after.map((decision) => decision.decision),
    [second],
  );
  assert.equal(await rig.apiLead.planningIntent(partition), undefined);
});

test("the API reassembles a decision whose resources outgrew one audit column", async () => {
  const partition = await leadRigProject(rig, "api-history-chunked");
  const evidence = "e".repeat(180_000);
  const decision = await leadRigDecision(
    rig,
    partition,
    "api-history-chunked",
    {
      handoffNote: { evidence },
      toolActivity: [{ evidence }],
      planningIntent: { next: "wait for the importer" },
    },
  );

  const page = await rig.apiLead.history(
    partition,
    undefined,
    selectorHistoryLimitMax,
  );
  assert.deepEqual(
    page.map((each) => each.decision),
    [decision],
  );
  assert.deepEqual(page[0]?.context.handoffNote, { evidence });
  assert.deepEqual(page[0]?.toolActivity, [{ evidence }]);
  const intent = await rig.apiLead.planningIntent(partition);
  assert.equal(intent?.selectorDecision, decision);
  assert.deepEqual(intent?.intent, { next: "wait for the importer" });
});

test("a pod cannot name the withdrawal as its own failure", async () => {
  const { partition, session } = await leadProject("forged-withdrawal");
  const turn = sessionRigTurnId("forged-withdrawal");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "forged-withdrawal");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.equal(
    await rig.sessions.plane.fail({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      failure: "TurnWithdrawn",
    }),
    "Conflict",
    "a withdrawal is the platform moving a turn out, and its proof is not a pod's to mint",
  );
  assert.equal(
    await rig.sessions.plane.fail({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      failure: "AgentFailed",
    }),
    "Failed",
    "every failure a pod is about is still its own to name",
  );
});

test("a restarted process withdraws a turn it holds no partition for", async () => {
  const { partition, session } = await leadProject("restart");
  const turn = sessionRigTurnId("restart");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "restart");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });

  const restarted = postgresHarnessRolePool(selectorServiceRole);
  try {
    assert.equal(
      (
        await restarted.query<{ withdrawn: string }>(
          "SELECT withdraw_lead_turn($1)::text AS withdrawn",
          [turn],
        )
      ).rows[0]?.withdrawn,
      "Withdrawn",
      "reconciliation holds the decision reference and no partition beside it",
    );
  } finally {
    await restarted.end();
  }
  assert.equal(
    (await rig.mailbox.turn(partition, turn))?.failure,
    "TurnWithdrawn",
  );
});

test("the seeding read answers the newest decisions first", async () => {
  const partition = await leadRigProject(rig, "api-tail");
  const decisions = [];
  for (const label of ["one", "two", "three"])
    decisions.push(
      await leadRigDecision(rig, partition, `api-tail-${label}`, {
        notificationCursor: decisions.length,
      }),
    );

  assert.deepEqual(
    (await rig.apiLead.tail(partition, 2)).map((each) => each.decision),
    [decisions[2], decisions[1]],
    "a fresh lead is seeded with the last decisions, not the first",
  );
  assert.deepEqual(
    (
      await rig.apiLead.history(partition, undefined, selectorHistoryLimitMax)
    ).map((each) => each.decision),
    decisions,
  );
});

test("a turn answer and a batch record each append one session change", async () => {
  const { partition, session } = await leadProject("session-change");
  const log = postgresProjectChangeLog(rig.sessions.harness.pool);
  const turn = sessionRigTurnId("session-change");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "session-change");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });

  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  const beforeBatch = await log.latest();
  await rig.sessions.plane.record({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    stream,
    batch: 1,
    digest: "c".repeat(64),
    bytes: 4,
    events: 1,
  });
  assert.deepEqual(
    (await log.after(partition, beforeBatch, 10)).map((row) => [
      row.kind,
      row.resource,
    ]),
    [["Session", `${session}|Lead|batch|${stream}|1`]],
    "one batch is one session change naming the stream and batch that moved",
  );

  const beforeAnswer = await log.latest();
  await rig.sessions.plane.answer({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    turn,
    result: "{}",
  });
  assert.deepEqual(
    (await log.after(partition, beforeAnswer, 10)).map((row) => [
      row.kind,
      row.resource,
    ]),
    [["Session", `${session}|Lead|turn|${turn}`]],
    "one state move is one session change naming the turn that moved",
  );
});

test("a thread's session changes are keyed to its own session", async () => {
  const partition = await leadRigProject(rig, "thread-change");
  const thread = await sessionRigSession(
    rig.sessions,
    partition,
    "thread-change",
    { kind: "Thread", principal: "member-thread-change" },
  );
  const log = postgresProjectChangeLog(rig.sessions.harness.pool);
  const before = await log.latest();
  const turn = await sessionRigTurn(
    rig.sessions,
    partition,
    thread,
    "thread-change",
  );
  assert.deepEqual(
    (await log.after(partition, before, 10)).map((row) => [
      row.kind,
      row.resource,
    ]),
    [["Session", `${thread}|Thread|turn|${turn}`]],
    "a console filters a session's own changes on the session it names first",
  );
});
