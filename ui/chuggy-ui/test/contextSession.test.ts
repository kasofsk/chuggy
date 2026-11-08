/**
 * A session's panel: its growth per turn from its readings where its turns
 * carried any, with each compaction the transcript recorded after the turn
 * before the one it fell in, and from the usage its transcript's entries were billed otherwise; and
 * the mark its readings are keyed by moving only when a turn does.
 */

import { expect, test } from "vitest";

import type { LeadTranscriptEntry } from "../app/core/leadTranscript.ts";
import {
  contextSessionInputsOf,
  contextSessionMarkOf,
  contextSessionOf,
  contextSessionPaged,
  contextThreadSeedOf,
} from "../app/core/contextSession.ts";
import { contextSessionBody } from "./contextFixture.ts";

function asked(uuid: string, text: string): LeadTranscriptEntry {
  return { uuid, type: "user", message: { content: text } };
}

function answered(uuid: string, read: number): LeadTranscriptEntry {
  return {
    uuid,
    type: "assistant",
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

test("with no readings, each turn is the context its last billed entry sent, and a cut follows the turn before the one holding it", () => {
  const view = contextSessionOf({
    context: { turns: [], autoCompactWindow: 200_000 },
    entries: [
      asked("u1", "first"),
      answered("a1", 40_000),
      asked("u2", "second"),
      answered("a2", 172_000),
      { uuid: "cut", type: "system", message: undefined },
      answered("a3", 36_000),
    ],
    cuts: [{ boundary: "cut", tokensBefore: 172_355, tokensAfter: 36_000 }],
  });
  expect(
    view.growth.points.map((point) => [point.ordinal, point.tokens]),
  ).toStrictEqual([
    [1, 40_002],
    [2, 36_002],
  ]);
  expect(view.growth.compactions).toStrictEqual([
    { ordinal: 1, before: 172_355, after: 36_000 },
  ]);
  expect([
    view.window.reading,
    view.window.used,
    view.window.window,
  ]).toStrictEqual([false, 36_002, 200_000]);
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
