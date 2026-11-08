/**
 * The readings of a session's context window, against a real server: kept in
 * the transaction that answers the turn they were taken in, refused with the
 * answer where they are past the wire's bounds or the turn is not the
 * attempt's, and read back by turn through the API's own doors with what the
 * session was opened under.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { sessionContextPageTurnsMax } from "../../src/contract/http.ts";
import { postgresSessionContextReads } from "../../src/adapters/postgres/sessionContextReads.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import type {
  SessionId,
  SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { SessionContextRecord } from "../../src/interpreter/sessionContext.ts";
import { sessionContextReadingsBody } from "../adapters/workerPlaneFixtures.ts";
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
let reads: ReturnType<typeof postgresSessionContextReads>;
let api: ReturnType<typeof postgresHarnessRolePool>;
before(async () => {
  rig = await sessionRigOpen();
  api = postgresHarnessRolePool(apiRole);
  reads = postgresSessionContextReads(api);
});
after(async () => {
  await api.end();
  await rig.close();
});

/** What a pod read as one turn compacted and then ended. */
const readings: readonly SessionContextRecord[] = sessionContextReadingsBody;

/** A lead opened under a prompt and a window, with `turns` turns queued and a live attempt. */
async function opened(label: string, turns: number) {
  const partition = await sessionRigProject(rig, label);
  const session = await sessionRigSession(rig, partition, label, {
    systemPrompt: `the objectives of ${label}`,
    autoCompactWindow: 400_000,
  });
  const queued: SessionTurnId[] = [];
  for (let index = 0; index < turns; index += 1)
    queued.push(
      await sessionRigTurn(
        rig,
        partition,
        session,
        `${label}-${String(index)}`,
      ),
    );
  const held = await sessionRigAttempt(rig, partition, session, label);
  return { partition, session, queued, held };
}

/** The turn a case queued at `index`, which every case queued. */
function queuedAt(
  queued: readonly SessionTurnId[],
  index: number,
): SessionTurnId {
  const turn = queued[index];
  if (turn === undefined)
    throw new Error(`no turn was queued at ${String(index)}`);
  return turn;
}

/** Claims the next turn and answers it, with `offered` where a case offers readings. */
async function answered(
  held: SessionRigAttempt,
  offered?: readonly SessionContextRecord[],
): Promise<string> {
  const claimed = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.ok(claimed !== undefined, "a queued turn is claimed");
  return rig.plane.answer({
    secret: held.secret,
    generation: held.attempt.generation,
    turn: claimed.turn,
    result: "done",
    ...(offered === undefined ? {} : { readings: offered }),
  });
}

/** How many readings the relation keeps for one session, whatever the read answers. */
async function kept(partition: Partition, session: SessionId): Promise<number> {
  const rows = await rig.harness.query(
    `SELECT count(*)::int AS kept FROM session_turn_context
      WHERE tenant=$1 AND project=$2 AND session=$3`,
    [partition.tenant, partition.project, session],
  );
  return Number(rows[0]?.["kept"]);
}

/** The readings of a turn as a reader is answered them, the server's date aside. */
function undated(page: Awaited<ReturnType<typeof reads.turns>>) {
  return page.turns.map((turn) => ({
    turn: turn.turn,
    ordinal: turn.ordinal,
    readings: turn.readings.map((reading) => {
      assert.match(reading.recordedAt, /^\d{4}-\d{2}-\d{2}T/u);
      return Object.fromEntries(
        Object.entries(reading).filter(([field]) => field !== "recordedAt"),
      );
    }),
  }));
}

test("a turn's readings are kept with its answer and read back in the order they were taken, and an answer with none keeps none", async () => {
  const { partition, session, queued, held } = await opened("kept", 2);

  assert.equal(await answered(held, readings), "Answered");
  assert.equal(await answered(held), "Answered");

  const page = await reads.turns({ partition, session, query: { limit: 4 } });
  assert.deepEqual(undated(page), [{ turn: queued[0], ordinal: 1, readings }]);
  assert.equal(page.nextAfter, undefined);
  assert.equal(await kept(partition, session), readings.length);
  assert.equal(
    (await sessionRigTurnState(rig, partition, session, queuedAt(queued, 1)))[
      "state"
    ],
    "Answered",
    "an answer without readings settles its turn as it always did",
  );
});

test("readings are paged by turn, resumed after the last turn's ordinal", async () => {
  const turns = sessionContextPageTurnsMax + 1;
  const { partition, session, queued, held } = await opened("paged", turns);
  for (let index = 0; index < turns; index += 1)
    assert.equal(
      await answered(held, [{ cause: "End" }]),
      "Answered",
      String(index),
    );

  const first = await reads.turns({
    partition,
    session,
    query: { limit: sessionContextPageTurnsMax },
  });
  assert.deepEqual(
    first.turns.map((turn) => turn.turn),
    queued.slice(0, sessionContextPageTurnsMax),
  );
  assert.equal(first.nextAfter, sessionContextPageTurnsMax);
  const second = await reads.turns({
    partition,
    session,
    query: { after: first.nextAfter, limit: sessionContextPageTurnsMax },
  });
  assert.deepEqual(
    second.turns.map((turn) => turn.turn),
    queued.slice(sessionContextPageTurnsMax),
  );
  assert.equal(second.nextAfter, undefined);
});

test("readings past their bound, or malformed, refuse the whole answer and keep nothing", async () => {
  const { partition, session, queued, held } = await opened("bounded", 1);
  const claimed = await rig.plane.claim({
    secret: held.secret,
    generation: held.attempt.generation,
  });
  assert.equal(claimed?.turn, queued[0]);
  const answer = (offered: unknown) =>
    rig.harness.query(
      `SELECT answer_session_turn($1,$2,$3,'done',NULL,NULL,NULL,NULL,NULL,NULL,NULL,$4::jsonb)::text AS answered`,
      [
        held.digest,
        held.attempt.generation,
        queued[0],
        JSON.stringify(offered),
      ],
    );
  for (const offered of [
    Array.from({ length: 9 }, () => ({ cause: "End" })),
    [{ cause: "Start" }],
    [{ cause: "End", compaction: { trigger: "Auto", tokensBefore: 1 } }],
    [
      {
        cause: "Compaction",
        compaction: { trigger: "Auto", tokensBefore: "1" },
      },
    ],
    [{ cause: "End", window: "the whole window" }],
    { cause: "End" },
  ])
    assert.deepEqual(
      await answer(offered),
      [{ answered: "Conflict" }],
      JSON.stringify(offered),
    );
  assert.equal(await kept(partition, session), 0);
  assert.equal(
    (await sessionRigTurnState(rig, partition, session, queuedAt(queued, 0)))[
      "state"
    ],
    "Claimed",
    "a refused answer leaves the turn with the attempt that holds it",
  );
});

test("a turn the attempt does not hold keeps no readings, and an answer offered again keeps the first answer's", async () => {
  const { partition, session, queued, held } = await opened("unheld", 2);
  const unheld = await rig.plane.answer({
    secret: held.secret,
    generation: held.attempt.generation,
    turn: queuedAt(queued, 1),
    result: "done",
    readings,
  });
  assert.equal(
    unheld,
    "Conflict",
    "a turn nobody claimed is not this attempt's",
  );
  assert.equal(await kept(partition, session), 0);

  assert.equal(await answered(held, [{ cause: "End" }]), "Answered");
  const again = await rig.plane.answer({
    secret: held.secret,
    generation: held.attempt.generation,
    turn: queuedAt(queued, 0),
    result: "done",
    readings,
  });
  assert.equal(again, "AlreadyAnswered");
  const page = await reads.turns({ partition, session, query: { limit: 1 } });
  assert.deepEqual(undated(page), [
    { turn: queued[0], ordinal: 1, readings: [{ cause: "End" }] },
  ]);
});

test("the opening answers the prompt and the window a session was opened under, and nothing of a session holding neither", async () => {
  const partition = await sessionRigProject(rig, "opening");
  const session = await sessionRigSession(rig, partition, "opening", {
    systemPrompt: "the objectives of opening",
    autoCompactWindow: 400_000,
  });
  assert.deepEqual(await reads.opening(partition, session), {
    systemPrompt: "the objectives of opening",
    autoCompactWindow: 400_000,
  });
  const bare = await sessionRigProject(rig, "opening-bare");
  const plain = await sessionRigSession(rig, bare, "opening-bare", {
    kind: "Thread",
  });
  assert.deepEqual(await reads.opening(bare, plain), {});
  assert.deepEqual(
    await reads.opening(partition, plain),
    {},
    "a session is read only in its own partition",
  );
});
