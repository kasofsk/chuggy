/**
 * A session's panel: its growth per turn from its readings where its turns
 * carried any, with each compaction the transcript recorded after the turn
 * before the one it fell in, and from the usage its transcript's entries were billed otherwise; and
 * the mark its readings are keyed by moving only when a turn does.
 */

import { expect, test } from "vitest";

import type {
  LeadTranscriptCut,
  LeadTranscriptEntry,
} from "../app/core/leadTranscript.ts";
import {
  contextSessionInputsOf,
  contextSessionMarkOf,
  contextSessionOf,
  contextSessionPaged,
  contextThreadSeedOf,
  contextTranscriptTurns,
} from "../app/core/contextSession.ts";
import { contextSessionBody } from "./contextFixture.ts";

function at(time: string): string {
  return `2026-11-01T${time}.000Z`;
}

function asked(uuid: string, text: string, time: string): LeadTranscriptEntry {
  return {
    uuid,
    type: "user",
    timestamp: at(time),
    message: { content: text },
  };
}

function answered(
  uuid: string,
  read: number,
  time: string,
): LeadTranscriptEntry {
  return {
    uuid,
    type: "assistant",
    timestamp: at(time),
    message: {
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: 0,
      },
    },
  };
}

test("with readings, each turn is the window its last reading held, read at the newest", () => {
  const view = contextSessionOf({
    context: contextSessionBody([
      { ordinal: 1, total: 50_000 },
      { ordinal: 2, total: 96_721 },
    ]),
    entries: [],
    cuts: [],
  });
  expect(
    view.growth.points.map((point) => [point.ordinal, point.tokens]),
  ).toStrictEqual([
    [1, 50_000],
    [2, 96_721],
  ]);
  expect([
    view.window.at,
    view.window.used,
    view.window.window,
    view.window.threshold,
  ]).toStrictEqual([2, 96_721, 200_000, 167_000]);
  expect(view.growth.unit).toBe("Turn");
});

/** A session holding turns `first` to `last`, one reading a minute from 11:00,
 * and the cuts its transcript names by their time and their size before. */
function heldTurns(
  first: number,
  last: number,
  cuts: readonly (readonly [string, number])[],
): Parameters<typeof contextSessionOf>[0] {
  const body = contextSessionBody(
    Array.from({ length: last - first + 1 }, (_unused, index) => ({
      ordinal: first + index,
      total: 60_000,
    })),
  );
  return {
    context: {
      ...body,
      turns: body.turns.map((turn) => ({
        ...turn,
        readings: turn.readings.map((reading) => ({
          ...reading,
          recordedAt: at(
            `11:${String(turn.ordinal - first).padStart(2, "0")}:00`,
          ),
        })),
      })),
    },
    entries: [],
    cuts: cuts.map(([time, before], index) => ({
      boundary: `cut-${String(index)}`,
      at: at(time),
      tokensBefore: before,
      tokensAfter: 30_000,
    })),
  };
}

test("a cut older than every held turn is not placed, and one between two held turns stands before the later", () => {
  const view = contextSessionOf(
    heldTurns(137, 140, [
      ["09:50:00", 170_000],
      ["10:40:00", 171_000],
      ["11:01:30", 172_000],
    ]),
  );
  expect(view.growth.compactions).toStrictEqual([
    { ordinal: 138, before: 172_000, after: 30_000 },
  ]);
});

test("a cut in a session's first turn is placed where the panel holds that turn", () => {
  const view = contextSessionOf(heldTurns(1, 3, [["10:59:00", 170_000]]));
  expect(view.growth.compactions).toStrictEqual([
    { ordinal: 0, before: 170_000, after: 30_000 },
  ]);
});

/** A compacted transcript as the transcript read sends it: user and assistant
 * entries only, the summary the compaction wrote a user entry like a prompt,
 * and the boundary named by its time among the page's cuts. */
const compacted: {
  readonly entries: readonly LeadTranscriptEntry[];
  readonly cuts: readonly LeadTranscriptCut[];
} = {
  entries: [
    asked("u1", "first", "10:00:00"),
    answered("a1", 40_000, "10:00:05"),
    asked("u2", "second", "10:01:00"),
    answered("a2", 172_000, "10:01:05"),
    asked("s", "This session is being continued…", "10:01:10"),
    answered("a3", 36_000, "10:01:15"),
    asked("u3", "third", "10:02:00"),
    answered("a4", 50_000, "10:02:05"),
  ],
  cuts: [
    {
      boundary: "cut",
      at: at("10:01:09"),
      trigger: "Auto",
      tokensBefore: 172_355,
      tokensAfter: 36_000,
    },
  ],
};

test("with no readings, each turn is the context its last billed entry sent, and a cut the page names stands after the turn before the one whose entries follow it", () => {
  const view = contextSessionOf({
    context: { turns: [], autoCompactWindow: 200_000 },
    ...compacted,
  });
  expect(
    view.growth.points.map((point) => [point.ordinal, point.tokens]),
  ).toStrictEqual([
    [1, 40_002],
    [2, 36_002],
    [3, 50_002],
  ]);
  expect(view.growth.compactions).toStrictEqual([
    { ordinal: 1, before: 172_355, after: 36_000 },
  ]);
  expect([
    view.window.reading,
    view.window.used,
    view.window.window,
  ]).toStrictEqual([false, 50_002, 200_000]);
});

test("a compaction's summary opens no turn, so a compacted transcript keeps its count of turns", () => {
  const without = contextTranscriptTurns(
    compacted.entries.filter((entry) => entry.uuid !== "s"),
    [],
  );
  const kept = contextTranscriptTurns(compacted.entries, compacted.cuts);
  expect(kept.turns.length).toBe(3);
  expect(kept.turns.length).toBe(without.turns.length);
});

test("with no readings, a cut older than the first entry the pane holds is not placed", () => {
  const { compactions } = contextTranscriptTurns(compacted.entries, [
    {
      boundary: "older",
      at: at("09:30:00"),
      tokensBefore: 168_000,
      tokensAfter: 31_000,
    },
    ...compacted.cuts,
  ]);
  expect(compactions).toStrictEqual([
    { ordinal: 1, before: 172_355, after: 36_000 },
  ]);
});

test("a cut with no time, or no size, is not placed", () => {
  const { compactions } = contextTranscriptTurns(compacted.entries, [
    { boundary: "untimed", tokensBefore: 172_355 },
    { boundary: "unsized", at: at("10:01:09") },
  ]);
  expect(compactions).toStrictEqual([]);
});

test("the mark moves with the newest turn and the state it is in, and with nothing else", () => {
  expect(contextSessionMarkOf([])).toStrictEqual({ newest: 0, mark: "0" });
  expect(
    contextSessionMarkOf([
      { ordinal: 3, state: "Running" },
      { ordinal: 2, state: "Answered" },
    ]),
  ).toStrictEqual({ newest: 3, mark: "3-Running" });
});

test("the first page is read for what the session was opened under, then the newest turns from where the first left off", async () => {
  const asks: number[] = [];
  const answered = await contextSessionPaged((after) => {
    asks.push(after);
    const body = contextSessionBody(
      [1, 2, 3, 4].map((at) => ({ ordinal: after + at, total: 50_000 })),
    );
    return Promise.resolve({
      outcome: "Ok" as const,
      value:
        after < 300
          ? { ...body, nextAfter: after === 0 ? 4 : after + 4 }
          : body,
    });
  }, 300);
  expect(asks.slice(0, 2)).toStrictEqual([0, 236]);
  if (answered.outcome !== "Ok") throw new Error("refused");
  expect(answered.value.systemPrompt).toBe("You are the project's lead.");
  expect(answered.value.turns.at(-1)?.ordinal).toBe(304);
});

test("a thread's inputs are its seeded block, the appended prompt and the window", () => {
  const seed = contextThreadSeedOf([
    { ordinal: 2, inputKind: "UserMessage", input: "later" },
  ]);
  expect(seed).toBeUndefined();
  expect(
    contextSessionInputsOf(
      { turns: [], systemPrompt: "Appended.", autoCompactWindow: 200_000 },
      undefined,
      {
        unit: "Turn",
        at: undefined,
        reading: false,
        used: 0,
        window: undefined,
        threshold: undefined,
        rows: [],
        segments: [],
      },
    ),
  ).toStrictEqual({ seed: undefined, prompt: "Appended.", window: 200_000 });
});
