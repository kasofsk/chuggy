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
