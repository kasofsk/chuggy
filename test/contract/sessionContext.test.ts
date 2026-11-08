/**
 * The readings of a session's context window as a turn's answer carries them
 * and a reader is answered with them: bounded per turn, a compaction's facts
 * beside a compaction alone, and the window a run's reading holds.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { sessionTurnContextReadingsMax } from "../../src/contract/http.ts";
import {
  sessionContextResponseSchema,
  sessionTranscriptCompactionResponseSchema,
} from "../../src/contract/responses.ts";
import { sessionTurnAnswerSchema } from "../../src/contract/sessionPlane.ts";
import {
  runContextReadingBody,
  runContextWindowBare,
} from "../adapters/workerPlaneFixtures.ts";

const answer = { turn: "turn", result: "result" };

test("an answer without readings parses as it did, and one carrying them keeps them in order", () => {
  assert.deepEqual(sessionTurnAnswerSchema.parse(answer), answer);
  const parsed = sessionTurnAnswerSchema.parse({
    ...answer,
    readings: [
      {
        cause: "Compaction",
        compaction: runContextReadingBody.compaction,
        window: runContextReadingBody.window,
      },
      { cause: "End", window: runContextWindowBare },
    ],
  });
  assert.deepEqual(
    parsed.readings?.map((reading) => reading.cause),
    ["Compaction", "End"],
  );
});

test("a turn carries at most its bound of readings, and at least one where it names any", () => {
  const ends = (count: number) =>
    Array.from({ length: count }, () => ({ cause: "End" }));
  assert.ok(
    sessionTurnAnswerSchema.safeParse({
      ...answer,
      readings: ends(sessionTurnContextReadingsMax),
    }).success,
  );
  for (const count of [0, sessionTurnContextReadingsMax + 1])
    assert.ok(
      !sessionTurnAnswerSchema.safeParse({
        ...answer,
        readings: ends(count),
      }).success,
      String(count),
    );
});

test("only a compaction's reading carries a compaction's facts, and a run's start is no turn's cause", () => {
  for (const reading of [
    { cause: "End", compaction: runContextReadingBody.compaction },
    { cause: "Start" },
    { cause: "End", ordinal: 1 },
    { cause: "End", window: { ...runContextWindowBare, unnamed: 1 } },
  ])
    assert.ok(
      !sessionTurnAnswerSchema.safeParse({ ...answer, readings: [reading] })
        .success,
      JSON.stringify(reading),
    );
});

test("a context page carries the session's opening beside its turns, each turn holding one reading or more", () => {
  const instant = "2026-11-08T00:00:00.000000Z";
  const page = sessionContextResponseSchema.parse({
    turns: [
      {
        turn: "turn-1",
        ordinal: 1,
        readings: [{ cause: "End", recordedAt: instant }],
      },
    ],
    systemPrompt: "the objectives",
    autoCompactWindow: 150_000,
    nextAfter: 1,
  });
  assert.equal(page.turns[0]?.readings[0]?.cause, "End");
  assert.ok(
    !sessionContextResponseSchema.safeParse({
      turns: [{ turn: "turn-1", ordinal: 1, readings: [] }],
    }).success,
  );
  assert.ok(sessionContextResponseSchema.safeParse({ turns: [] }).success);
});

test("a transcript's compaction names its boundary, and every other fact only where the store had it", () => {
  assert.ok(
    sessionTranscriptCompactionResponseSchema.safeParse({ boundary: "uuid" })
      .success,
  );
  assert.ok(
    !sessionTranscriptCompactionResponseSchema.safeParse({
      boundary: "uuid",
      trigger: "auto",
    }).success,
  );
});
