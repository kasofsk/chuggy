/**
 * The one thing on a conversation that moves while a turn is out.
 *
 * Each case is a moment a thread can be in, and what is held to is that the
 * answer names one place or none: never the engine and an exchange together,
 * and never nothing while a turn is out.
 */

import { expect, test } from "vitest";

import {
  conversationExchangeBegun,
  conversationIndicator,
} from "../app/core/conversation.ts";
import type {
  ConversationActivity,
  ConversationExchange,
  ConversationRunningState,
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

test("the engine runs for a turn nobody has said a word of, whatever it is waiting on", () => {
  for (const state of ["Queued", "Waiting", "Claimed"] as const)
    expect(
      conversationIndicator([answered("a"), running("b", state)], composing),
    ).toEqual({ indicator: "Engine" });
  expect(
    conversationIndicator(
      [running("b", "Claimed", { activity: { activity: "Thinking" } })],
      composing,
    ),
  ).toEqual({ indicator: "Engine" });
});

test("a turn with words takes it from the engine, and keeps it while a send is on its way", () => {
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

test("a turn whose last message is whole holds it until it settles, words or none", () => {
  expect(
    conversationIndicator(
      [running("b", "Claimed", { activity: { activity: "Whole" } })],
      composing,
    ),
  ).toEqual({ indicator: "Exchange", id: "b" });
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
