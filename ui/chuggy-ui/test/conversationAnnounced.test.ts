/**
 * What a conversation says aloud as it changes: a reply once as it begins and
 * once whole as it settles, the work as its line and never its body, and
 * nothing for the first draw, a read, or history read in above.
 */

import { expect, test } from "vitest";

import type {
  ConversationExchange,
  ConversationStep,
} from "../app/core/conversation.ts";
import { conversationAnnounced } from "../app/core/conversationAnnounced.ts";
import type { ConversationAnnouncement } from "../app/core/conversationAnnounced.ts";

function asked(id: string): ConversationExchange {
  return {
    id,
    turn: `turn-${id}`,
    ask: { ask: "Message", text: `ask ${id}` },
    work: [],
    standing: { standing: "Running", state: "Queued" },
    before: [],
  };
}

function answered(id: string, answer: string): ConversationExchange {
  return {
    ...asked(id),
    answer,
    standing: { standing: "Answered" },
  };
}

function writing(
  id: string,
  work: readonly ConversationStep[],
  answer?: string,
): ConversationExchange {
  return {
    ...asked(id),
    work,
    ...(answer === undefined ? {} : { answer }),
    standing: { standing: "Running", state: "Claimed" },
    activity: { activity: "Writing" },
  };
}

/** Every announcement a run of draws makes, each draw against the last. */
function saidAcross(
  draws: readonly (readonly ConversationExchange[] | undefined)[],
): readonly ConversationAnnouncement[] {
  const said: ConversationAnnouncement[] = [];
  let previous: readonly ConversationExchange[] | undefined;
  for (const next of draws) {
    const lines =
      next === undefined ? undefined : conversationAnnounced(previous, next);
    if (lines !== undefined) said.push(lines);
    previous = next;
  }
  return said;
}

const earlier = answered("a", "It is open.");

test("a streamed reply says that it is replying once, and its text once, whole, as it settles", () => {
  const fragments = ["Th", "The ti", "The ticket is", "The ticket is done."];
  const said = saidAcross([
    [earlier],
    [earlier, asked("b")],
    ...fragments.map((text) => [
      earlier,
      writing("b", [{ step: "Text", text }]),
    ]),
    [
      earlier,
      {
        ...writing("b", [], "The ticket is done."),
        activity: { activity: "Whole" },
      },
    ],
    [earlier, answered("b", "The ticket is done.")],
    [earlier, answered("b", "The ticket is done.")],
  ]);
  expect(said).toStrictEqual([
    [{ id: "conversation-announced-replying" }],
    ["The ticket is done."],
  ]);
});

test("a reply that settles before any of it was drawn says only its text", () => {
  expect(
    saidAcross([
      [earlier, asked("b")],
      [earlier, answered("b", "Done.")],
    ]),
  ).toStrictEqual([["Done."]]);
});

test("history read in above the column says nothing", () => {
  const older = [answered("x", "Old one."), answered("y", "Old two.")];
  expect(
    saidAcross([
      [earlier],
      [...older, earlier],
      [answered("w", "Older still."), ...older, earlier],
    ]),
  ).toStrictEqual([]);
});

test("history read in above while a reply arrives at the foot says only the reply", () => {
  expect(
    saidAcross([
      [earlier, asked("b")],
      [answered("x", "Old one."), earlier, answered("b", "New.")],
    ]),
  ).toStrictEqual([["New."]]);
});

test("the first draw, a read and a column that held nothing say nothing", () => {
  const history = [earlier, answered("b", "Two.")];
  expect(conversationAnnounced(undefined, history)).toBeUndefined();
  expect(conversationAnnounced([], history)).toBeUndefined();
  expect(saidAcross([[earlier], undefined, history])).toStrictEqual([]);
});

test("a column that holds nothing it held is another conversation, and says nothing", () => {
  expect(
    conversationAnnounced([earlier], [answered("p", "Elsewhere.")]),
  ).toBeUndefined();
});

test("the work is said as the line its card is closed to, never its body", () => {
  const settled: ConversationExchange = {
    ...asked("b"),
    work: [
      { step: "Thinking", text: "secret reasoning" },
      {
        step: "ToolCall",
        id: "call-1",
        name: "Read",
        input: { path: "/etc/hosts" },
        result: { text: "tool body", isError: false },
      },
      { step: "Text", text: "Read it." },
      { step: "ToolCall", id: "call-2", name: "Grep", input: {} },
    ],
    answer: "All done.",
    standing: { standing: "Answered" },
  };
  expect(
    conversationAnnounced([earlier, asked("b")], [earlier, settled]),
  ).toStrictEqual([
    { id: "conversation-work-thought-tools", args: { count: 1 } },
    "Read it.",
    { id: "conversation-work-tools", args: { count: 1 } },
    "All done.",
  ]);
});

test("a reply that did not answer says the word it settled on", () => {
  const before = [earlier, writing("b", [{ step: "Text", text: "Half" }])];
  expect(
    conversationAnnounced(before, [
      earlier,
      {
        ...writing("b", [{ step: "Text", text: "Half" }]),
        standing: { standing: "Failed", failure: "AgentRateLimited" },
      },
    ]),
  ).toStrictEqual(["Half", { id: "conversation-failure-agent-rate-limited" }]);
  expect(
    conversationAnnounced(
      [earlier, asked("b")],
      [earlier, { ...asked("b"), standing: { standing: "Stopped" } }],
    ),
  ).toStrictEqual([{ id: "tones-exchange-stopped" }]);
});

test("a reply that was already settled when last drawn says nothing again", () => {
  const history = [earlier, answered("b", "Two.")];
  expect(conversationAnnounced(history, [...history])).toBeUndefined();
});
