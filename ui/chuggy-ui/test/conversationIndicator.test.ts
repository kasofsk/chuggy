/**
 * The one thing on a conversation that moves while a turn is out, and what
 * that turn is doing, which says where on its exchange the thing is drawn.
 *
 * Each case is a moment a thread can be in, and what is held to is that the
 * answer names one place or none: never the engine and an exchange together,
 * and never nothing while a turn is out and has not been heard to end.
 */

import { expect, test } from "vitest";

import {
  conversationExchangeBegun,
  conversationExchangeDoing,
  conversationExchangeQuiet,
  conversationIndicator,
} from "../app/core/conversation.ts";
import type {
  ConversationActivity,
  ConversationExchange,
  ConversationRunningState,
  ConversationStep,
} from "../app/core/conversation.ts";

const composing = { drawn: true, sending: false };

function answered(id: string): ConversationExchange {
  return {
    id,
    work: [],
    answer: "It is open.",
    standing: { standing: "Answered" },
    before: [],
  };
}

function running(
  id: string,
  state: ConversationRunningState,
  said: {
    readonly work?: readonly ConversationStep[];
    readonly answer?: string;
    readonly activity?: ConversationActivity;
  } = {},
): ConversationExchange {
  return {
    id,
    work: [],
    standing: { standing: "Running", state },
    before: [],
    ...said,
  };
}

test("nothing moves on a conversation no turn is out in", () => {
  expect(conversationIndicator([], composing)).toEqual({ indicator: "None" });
  expect(conversationIndicator([answered("a")], composing)).toEqual({
    indicator: "None",
  });
});

test("the engine runs while a send is on its way, before there is a turn to draw", () => {
  expect(
    conversationIndicator([answered("a")], { drawn: true, sending: true }),
  ).toEqual({ indicator: "Engine" });
});

test("a turn nobody has said a word of is the one that moves, whatever it is waiting on", () => {
  for (const state of ["Queued", "Waiting", "Claimed"] as const)
    for (const drawn of [true, false])
      expect(
        conversationIndicator([answered("a"), running("b", state)], {
          drawn,
          sending: false,
        }),
      ).toEqual({ indicator: "Exchange", id: "b" });
});

test("a turn with words keeps it while a send is on its way and another waits behind it", () => {
  const written = running("b", "Claimed", { answer: "It is" });
  expect(conversationIndicator([answered("a"), written], composing)).toEqual({
    indicator: "Exchange",
    id: "b",
  });
  expect(
    conversationIndicator([written, running("c", "Queued")], {
      drawn: true,
      sending: true,
    }),
  ).toEqual({ indicator: "Exchange", id: "b" });
});

test("of two turns out the one that has begun moves, wherever it stands", () => {
  const begun = running("c", "Claimed", { activity: { activity: "Thinking" } });
  expect(
    conversationIndicator([running("b", "Queued"), begun], composing),
  ).toEqual({ indicator: "Exchange", id: "c" });
});

const whole = { activity: "Whole" } as const;

test("nothing moves for a turn heard to end until the mailbox settles it, words or none", () => {
  for (const said of [{}, { answer: "It is open." }])
    for (const drawn of [true, false])
      expect(
        conversationIndicator(
          [running("b", "Claimed", { ...said, activity: whole })],
          { drawn, sending: false },
        ),
      ).toEqual({ indicator: "None" });
});

test("a turn heard to end leaves the indicator to what is still under way", () => {
  const ended = running("b", "Claimed", { answer: "Done.", activity: whole });
  const next = running("c", "Queued");
  expect(conversationIndicator([ended, next], composing)).toEqual({
    indicator: "Exchange",
    id: "c",
  });
  expect(
    conversationIndicator([ended], { drawn: true, sending: true }),
  ).toEqual({ indicator: "Engine" });
  expect(
    conversationIndicator([ended, next], { drawn: false, sending: false }),
  ).toEqual({ indicator: "Exchange", id: "c" });
});

test("a turn is quiet only while it is out and was heard to end", () => {
  expect(conversationExchangeQuiet(running("b", "Claimed"))).toBe(false);
  expect(
    conversationExchangeQuiet(
      running("b", "Claimed", { activity: { activity: "Writing" } }),
    ),
  ).toBe(false);
  expect(
    conversationExchangeQuiet(running("b", "Claimed", { activity: whole })),
  ).toBe(true);
  expect(conversationExchangeQuiet({ ...answered("a"), activity: whole })).toBe(
    false,
  );
});

test("where no engine is drawn the first turn out moves in its place", () => {
  const unseen = { drawn: false, sending: false };
  expect(
    conversationIndicator(
      [answered("a"), running("b", "Queued"), running("c", "Queued")],
      unseen,
    ),
  ).toEqual({ indicator: "Exchange", id: "b" });
  expect(conversationIndicator([answered("a")], unseen)).toEqual({
    indicator: "None",
  });
});

test("a turn has begun once a step, a word or what it is doing has reached the page", () => {
  const nothing = running("b", "Claimed");
  expect(conversationExchangeBegun(nothing)).toBe(false);
  expect(conversationExchangeBegun({ ...nothing, inputless: true })).toBe(true);
  expect(conversationExchangeBegun({ ...nothing, answer: "It" })).toBe(true);
  expect(
    conversationExchangeBegun({
      ...nothing,
      activity: { activity: "Thinking" },
    }),
  ).toBe(true);
  expect(
    conversationExchangeBegun({
      ...nothing,
      work: [{ step: "Thinking", text: "" }],
    }),
  ).toBe(true);
});

const thought: ConversationStep = { step: "Thinking", text: "" };
const read: ConversationStep = {
  step: "ToolCall",
  id: "",
  name: "Read",
  input: undefined,
};
const reading = { activity: "ToolUse", name: "Read" } as const;

test("a turn that is over or heard to end is doing nothing a page draws as under way", () => {
  expect(conversationExchangeDoing(answered("a"))).toEqual({
    doing: "Settled",
  });
  expect(
    conversationExchangeDoing(
      running("b", "Claimed", { work: [read], activity: whole }),
    ),
  ).toEqual({ doing: "Whole" });
});

test("a turn nothing is drawn of has not begun, whatever it is waiting on", () => {
  for (const state of ["Queued", "Waiting", "Claimed"] as const)
    expect(conversationExchangeDoing(running("b", state))).toEqual({
      doing: "Unbegun",
    });
});

test("a turn whose last part is work is at that work, on the step it is heard to be on where one is", () => {
  expect(
    conversationExchangeDoing(
      running("b", "Claimed", {
        work: [thought],
        activity: { activity: "Thinking" },
      }),
    ),
  ).toEqual({ doing: "Work", activity: { activity: "Thinking" } });
  expect(
    conversationExchangeDoing(
      running("b", "Claimed", {
        work: [{ step: "Text", text: "Looking." }, read],
        activity: reading,
      }),
    ),
  ).toEqual({ doing: "Work", activity: reading });
  expect(
    conversationExchangeDoing(running("b", "Claimed", { work: [read] })),
  ).toEqual({ doing: "Work", activity: undefined });
});

test("a turn whose last part is text is at that text, whatever is heard of it", () => {
  const text = { doing: "Text" };
  expect(
    conversationExchangeDoing(
      running("b", "Claimed", {
        work: [read],
        answer: "It is",
        activity: { activity: "Writing" },
      }),
    ),
  ).toEqual(text);
  expect(
    conversationExchangeDoing(running("b", "Claimed", { answer: "It is" })),
  ).toEqual(text);
  expect(
    conversationExchangeDoing(
      running("b", "Claimed", { answer: "It is", activity: reading }),
    ),
  ).toEqual(text);
});

test("a turn that has begun and has no last part still going on is said to be working and no more", () => {
  const unnamed = { doing: "Unnamed" };
  expect(
    conversationExchangeDoing(
      running("b", "Claimed", { activity: { activity: "Thinking" } }),
    ),
  ).toEqual(unnamed);
  expect(
    conversationExchangeDoing(
      running("b", "Claimed", {
        work: [read],
        activity: { activity: "Writing" },
      }),
    ),
  ).toEqual(unnamed);
});
