/**
 * A session's context readings as a pod's answer stores them and the API reads
 * them back: kept with the answer that carried them and with no other, paged
 * by turn, and beside what the session was opened under.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type pg from "pg";

import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { postgresSessionContext } from "../../src/adapters/postgres/sessionContext.ts";
import { sessionTurnContextReadingsMax } from "../../src/contract/http.ts";
import {
  runCompactionSchema,
  runContextWindowSchema,
  type SessionContextOffered,
} from "../../src/contract/responses.ts";
import type { SessionTurnId } from "../../src/interpreter/agentSession.ts";
import type { SessionContextRead } from "../../src/interpreter/sessionContext.ts";
import { runContextReadingBody } from "../adapters/workerPlaneFixtures.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
  sessionRigAttempt,
  sessionRigOpen,
  sessionRigProject,
  sessionRigSession,
  sessionRigTurn,
  sessionRigTurnState,
  type SessionRig,
  type SessionRigAttempt,
} from "./sessionHarness.ts";

let rig: SessionRig;
let api: pg.Pool;
let context: SessionContextRead;
before(async () => {
  rig = await sessionRigOpen();
  api = postgresHarnessRolePool(apiRole);
  context = postgresSessionContext(api);
});
after(async () => {
  await api.end();
  await rig.close();
});

/** A run's reading's window, which is the window a session's reading holds. */
const window = runContextWindowSchema.parse(runContextReadingBody.window);

/** A compaction the turn ran through, and the turn's end, each carrying what a reading may. */
const readings: readonly SessionContextOffered[] = [
  {
    cause: "Compaction",
    compaction: runCompactionSchema.parse(runContextReadingBody.compaction),
    window,
  },
  { cause: "End", window },
];

/** A session with `count` queued turns and a live attempt holding its bearer. */
async function mailbox(label: string, count: number) {
  const partition = await sessionRigProject(rig, label);
  const session = await sessionRigSession(rig, partition, label, {
    systemPrompt: `the ${label} objectives`,
    autoCompactWindow: 150_000,
  });
  const turns: SessionTurnId[] = [];
  for (let index = 1; index <= count; index += 1)
    turns.push(
      await sessionRigTurn(
        rig,
        partition,
        session,
        `${label}-${String(index)}`,
      ),
    );
  const held = await sessionRigAttempt(rig, partition, session, label);
  return { partition, session, turns, held };
}

/** Claims the next turn and answers it, carrying `offered` where it is given. */
async function answered(
  held: SessionRigAttempt,
  turn: SessionTurnId,
  offered?: readonly SessionContextOffered[],
) {
  const claimed = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.equal(claimed?.turn, turn);
  return rig.plane.answer({
    secret: held.secret,
    generation: held.attempt.generation,
    turn,
    result: "the answer",
    ...(offered === undefined ? {} : { readings: offered }),
  });
}

test("a turn's readings are stored with its answer and read back in the order it took them", async () => {
  const { partition, session, turns, held } = await mailbox("stored", 1);
  const [turn] = turns;
  assert.ok(turn !== undefined);
  assert.equal(await answered(held, turn, readings), "Answered");
  const page = await context.turns({ partition, session, after: 0, limit: 4 });
  assert.equal(page.length, 1);
  assert.equal(page[0]?.turn, turn);
  assert.equal(page[0]?.ordinal, 1);
  assert.deepEqual(
    page[0]?.readings.map(({ recordedAt, ...reading }) => {
      assert.match(recordedAt, /Z$/u);
      return reading;
    }),
    readings,
  );
  assert.deepEqual(await context.opening(partition, session), {
    systemPrompt: "the stored objectives",
    autoCompactWindow: 150_000,
  });
});

test("an answer without readings stores the turn as it did and keeps none", async () => {
  const { partition, session, turns, held } = await mailbox("without", 1);
  const [turn] = turns;
  assert.ok(turn !== undefined);
  assert.equal(await answered(held, turn), "Answered");
  const stored = await sessionRigTurnState(rig, partition, session, turn);
  assert.equal(stored["state"], "Answered");
  assert.equal(stored["result"], "the answer");
  assert.deepEqual(
    await context.turns({ partition, session, after: 0, limit: 4 }),
    [],
  );
});

test("the readings are paged by turn, resumed after the last turn answered, and a turn without them is passed over", async () => {
  const { partition, session, turns, held } = await mailbox("paged", 3);
  const [first, second, third] = turns;
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  assert.equal(await answered(held, first, readings), "Answered");
  assert.equal(await answered(held, second), "Answered");
  assert.equal(await answered(held, third, [{ cause: "End" }]), "Answered");
  const head = await context.turns({ partition, session, after: 0, limit: 1 });
  assert.deepEqual(
    head.map((each) => [each.ordinal, each.readings.length]),
    [[1, 2]],
  );
  const rest = await context.turns({ partition, session, after: 1, limit: 4 });
  assert.deepEqual(
    rest.map((each) => [each.turn, each.ordinal, each.readings.length]),
    [[third, 3, 1]],
  );
  assert.deepEqual(
    await context.turns({ partition, session, after: 3, limit: 4 }),
    [],
  );
});

test("an answer carrying more readings than a turn may is refused whole, and its turn is still held", async () => {
  const { partition, session, turns, held } = await mailbox("bound", 1);
  const [turn] = turns;
  assert.ok(turn !== undefined);
  const over = Array.from(
    { length: sessionTurnContextReadingsMax + 1 },
    () => ({ cause: "End" }) as const,
  );
  assert.equal(await answered(held, turn, over), "Conflict");
  assert.equal(
    (await sessionRigTurnState(rig, partition, session, turn))["state"],
    "Claimed",
  );
  assert.deepEqual(
    await context.turns({ partition, session, after: 0, limit: 4 }),
    [],
  );
  const most = over.slice(0, sessionTurnContextReadingsMax);
  assert.equal(
    await rig.plane.answer({
      secret: held.secret,
      generation: held.attempt.generation,
      turn,
      result: "the answer",
      readings: most,
    }),
    "Answered",
  );
  const [stored] = await context.turns({
    partition,
    session,
    after: 0,
    limit: 4,
  });
  assert.equal(stored?.readings.length, sessionTurnContextReadingsMax);
});

test("a malformed reading is refused whole, as a malformed batch range is", async () => {
  const { partition, session, turns, held } = await mailbox("malformed", 1);
  const [turn] = turns;
  assert.ok(turn !== undefined);
  await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  for (const offered of [
    [{ cause: "Start" }],
    [{ cause: "End", compaction: runContextReadingBody.compaction }],
    [{ cause: "Compaction", compaction: { trigger: "Auto" } }],
    [{ cause: "End", window: [] }],
  ])
    assert.equal(
      await rig.plane.answer({
        secret: held.secret,
        generation: held.attempt.generation,
        turn,
        result: "the answer",
        readings: offered as unknown as readonly SessionContextOffered[],
      }),
      "Conflict",
      JSON.stringify(offered),
    );
  assert.deepEqual(
    await context.turns({ partition, session, after: 0, limit: 4 }),
    [],
  );
});

test("readings for a turn the attempt does not hold are refused, and none is kept", async () => {
  const { partition, session, turns, held } = await mailbox("unheld", 2);
  const [first, second] = turns;
  assert.ok(first !== undefined && second !== undefined);
  await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.equal(
    await rig.plane.answer({
      secret: held.secret,
      generation: held.attempt.generation,
      turn: second,
      result: "the answer",
      readings,
    }),
    "Conflict",
  );
  assert.equal(
    await rig.plane.answer({
      secret: held.secret,
      generation: held.attempt.generation + 1,
      turn: first,
      result: "the answer",
      readings,
    }),
    "Fenced",
  );
  assert.deepEqual(
    await context.turns({ partition, session, after: 0, limit: 4 }),
    [],
  );
});

test("a failed turn carries no readings, and an answer reaching it afterwards keeps none", async () => {
  const { partition, session, turns, held } = await mailbox("failed", 1);
  const [turn] = turns;
  assert.ok(turn !== undefined);
  await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.equal(
    await rig.plane.fail({
      secret: held.secret,
      generation: held.attempt.generation,
      turn,
      failure: "AgentFailed",
    }),
    "Failed",
  );
  assert.equal(
    await rig.plane.answer({
      secret: held.secret,
      generation: held.attempt.generation,
      turn,
      result: "the answer",
      readings,
    }),
    "Conflict",
  );
  assert.deepEqual(
    await context.turns({ partition, session, after: 0, limit: 4 }),
    [],
  );
});

test("an answer offered again keeps the readings the first carried", async () => {
  const { partition, session, turns, held } = await mailbox("again", 1);
  const [turn] = turns;
  assert.ok(turn !== undefined);
  assert.equal(await answered(held, turn, readings), "Answered");
  assert.equal(
    await rig.plane.answer({
      secret: held.secret,
      generation: held.attempt.generation,
      turn,
      result: "the answer",
      readings: [{ cause: "End" }],
    }),
    "AlreadyAnswered",
  );
  const [stored] = await context.turns({
    partition,
    session,
    after: 0,
    limit: 4,
  });
  assert.equal(stored?.readings.length, readings.length);
});

test("a stored reading is written once", async () => {
  const { session, turns, held } = await mailbox("immutable", 1);
  const [turn] = turns;
  assert.ok(turn !== undefined);
  assert.equal(await answered(held, turn, readings), "Answered");
  for (const statement of [
    `UPDATE session_turn_context SET cause='End' WHERE session=$1`,
    `DELETE FROM session_turn_context WHERE session=$1`,
  ])
    await assert.rejects(
      rig.harness.query(statement, [session]),
      /written once/u,
    );
});

test("a session opened under no prompt and no window answers neither", async () => {
  const partition = await sessionRigProject(rig, "bare");
  const session = await sessionRigSession(rig, partition, "bare", {
    kind: "Thread",
  });
  assert.deepEqual(await context.opening(partition, session), {});
});

test("another session's readings and opening are not this session's", async () => {
  const { partition, turns, held } = await mailbox("mine", 1);
  const [turn] = turns;
  assert.ok(turn !== undefined);
  assert.equal(await answered(held, turn, readings), "Answered");
  const other = await sessionRigSession(rig, partition, "theirs", {
    kind: "Thread",
  });
  assert.deepEqual(
    await context.turns({ partition, session: other, after: 0, limit: 4 }),
    [],
  );
  const elsewhere = await sessionRigProject(rig, "elsewhere");
  assert.deepEqual(
    await context.turns({
      partition: elsewhere,
      session: held.attempt.session,
      after: 0,
      limit: 4,
    }),
    [],
  );
  assert.deepEqual(await context.opening(elsewhere, held.attempt.session), {});
});
