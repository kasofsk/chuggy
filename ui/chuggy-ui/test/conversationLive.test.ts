/**
 * What is heard of a turn, laid over what its transcript holds.
 *
 * The two arrive on separate paths in no agreed order, so each case here is a
 * moment the paths can be in, and the last is every order one scripted turn's
 * events can arrive in. What is held to throughout is what a reader would see
 * go wrong: text drawn twice, and text drawn that then goes away.
 */

import { expect, test } from "vitest";

import type { SessionTurnState } from "../../../src/contract/rosters.ts";
import type { SessionLiveEvent } from "../../../src/contract/sessionLive.ts";
import type {
  ThreadLiveHeld,
  ThreadLiveStreamEvent,
} from "../../../src/contract/threadLive.ts";
import { conversationExchanges } from "../app/core/conversation.ts";
import type {
  ConversationBlock,
  ConversationExchange,
  ConversationItem,
  ConversationTurn,
} from "../app/core/conversation.ts";
import {
  conversationExchangesLive,
  conversationLiveHeard,
  conversationLiveKept,
  conversationLiveMessagesMax,
  conversationLiveNothing,
  conversationLiveTurns,
  conversationLiveTurnsHeard,
  conversationStoredBlocks,
} from "../app/core/conversationLive.ts";
import type { ConversationLiveHeld } from "../app/core/conversationLive.ts";
import { leadTranscriptFoldEmpty } from "../app/core/leadTranscript.ts";
import { sessionConversationItems } from "../app/core/sessionConversation.ts";
import { conversationStoreEntries } from "./conversationFixture.ts";

const turn = "turn-1";
const input = "go";

function live(event: SessionLiveEvent, of = turn): ThreadLiveStreamEvent {
  return { event: "live", data: { version: 1, turn: of, event } };
}

function began(
  message: string,
  index: number,
  kind: "Text" | "Thinking" | "ToolUse",
  name?: string,
  of = turn,
): ThreadLiveStreamEvent {
  return live(
    {
      live: "Block",
      message,
      index,
      kind,
      ...(name === undefined ? {} : { name }),
    },
    of,
  );
}

function wrote(
  message: string,
  index: number,
  offset: number,
  text: string,
  of = turn,
): ThreadLiveStreamEvent {
  return live({ live: "Text", message, index, offset, text }, of);
}

const ended = live({ live: "End" });

function snapshot(held: ThreadLiveHeld): ThreadLiveStreamEvent {
  return { event: "snapshot", data: { version: 1, held } };
}

function heardAll(
  frames: readonly ThreadLiveStreamEvent[],
  from: ConversationLiveHeld = conversationLiveNothing,
  known?: number,
): ConversationLiveHeld {
  return frames.reduce(
    (held, frame) => conversationLiveHeard(held, frame, known),
    from,
  );
}

const asked: ConversationItem = {
  item: "Entry",
  entry: {
    id: "entry-ask",
    role: "User",
    blocks: [{ block: "Text", text: input }],
  },
};

function stored(message: string, block: ConversationBlock): ConversationItem {
  return {
    item: "Entry",
    entry: {
      id: `entry-${message}-${block.block}`,
      role: "Assistant",
      message,
      blocks: [block],
    },
  };
}

function resulted(toolUse: string): ConversationItem {
  return {
    item: "Entry",
    entry: {
      id: `entry-result-${toolUse}`,
      role: "User",
      blocks: [{ block: "ToolResult", toolUse, text: "read", isError: false }],
    },
  };
}

function turnsOf(state: SessionTurnState): readonly ConversationTurn[] {
  return [{ turn, ordinal: 1, inputKind: "UserMessage", input, state }];
}

interface Moment {
  readonly held: ConversationLiveHeld;
  readonly items: readonly ConversationItem[];
  readonly state?: SessionTurnState;
  readonly reached?: boolean;
  readonly turns?: readonly ConversationTurn[];
}

/** The exchanges a page draws at one moment, composed as the thread page
 * composes them. */
function drawn(moment: Moment): readonly ConversationExchange[] {
  const turns = moment.turns ?? turnsOf(moment.state ?? "Claimed");
  const heard = conversationLiveTurns(
    conversationLiveKept(moment.held, turns, moment.reached ?? false),
    conversationStoredBlocks(moment.items),
  );
  return conversationExchangesLive(
    conversationExchanges(
      moment.items,
      turns,
      new Set(conversationLiveTurnsHeard(heard)),
    ),
    heard,
  );
}

function only(moment: Moment): ConversationExchange {
  const exchanges = drawn(moment);
  expect(exchanges).toHaveLength(1);
  const exchange = exchanges[0];
  if (exchange === undefined) throw new Error("no exchange was drawn");
  return exchange;
}

test("text heard of a block is drawn in the answer's place and grows as more is heard", () => {
  const first = heardAll([began("m1", 0, "Text"), wrote("m1", 0, 0, "Hel")]);
  expect(only({ held: first, items: [asked] }).answer).toBe("Hel");
  const more = heardAll([wrote("m1", 0, 3, "lo")], first);
  expect(only({ held: more, items: [asked] }).answer).toBe("Hello");
});

test("a block that has begun and said nothing draws nothing", () => {
  const held = heardAll([began("m1", 0, "Text")]);
  const exchange = only({ held, items: [asked] });
  expect(exchange.answer).toBeUndefined();
  expect(exchange.activity).toBeUndefined();
});

test("text sent again from inside what is held replaces what followed", () => {
  const held = heardAll([
    began("m1", 0, "Text"),
    wrote("m1", 0, 0, "Hello wor"),
    wrote("m1", 0, 6, "there"),
  ]);
  expect(only({ held, items: [asked] }).answer).toBe("Hello there");
});

test("a gap takes away nothing heard before it and draws nothing after it", () => {
  const before = heardAll([began("m1", 0, "Text"), wrote("m1", 0, 0, "Hello")]);
  const gapped = heardAll([wrote("m1", 0, 9, "lost")], before);
  expect(gapped.writing.blocks).toEqual([
    { index: 0, kind: "Text", text: "", gapped: true },
  ]);
  expect(only({ held: gapped, items: [asked] }).answer).toBe("Hello");
  const after = heardAll([wrote("m1", 0, 13, " more")], gapped);
  expect(only({ held: after, items: [asked] }).answer).toBe("Hello");
});

test("text for a block that never began is never drawn", () => {
  const held = heardAll([wrote("m1", 0, 40, "middle of something")]);
  const exchange = only({ held, items: [asked] });
  expect(exchange.answer).toBeUndefined();
  expect(exchange.work).toEqual([]);
});

test("a stored block landing before the end changes nothing drawn", () => {
  const held = heardAll([
    began("m1", 0, "Thinking"),
    began("m1", 1, "Text"),
    wrote("m1", 1, 0, "Hello"),
  ]);
  const before = only({ held, items: [asked] });
  const thought = stored("m1", { block: "Thinking", text: "" });
  const after = only({ held, items: [asked, thought] });
  expect(after).toEqual({ ...before, id: after.id });
  const whole = only({
    held,
    items: [asked, thought, stored("m1", { block: "Text", text: "Hello" })],
  });
  expect(whole.answer).toBe("Hello");
  expect(whole.work).toEqual(before.work);
});

test("a stored block landing after the end changes nothing drawn", () => {
  const held = heardAll([
    began("m1", 0, "Text"),
    wrote("m1", 0, 0, "Hello"),
    ended,
  ]);
  expect(held.writing).toEqual({ blocks: [] });
  const before = only({ held, items: [asked] });
  expect(before.answer).toBe("Hello");
  expect(before.activity).toEqual({ activity: "Whole" });
  const after = only({
    held,
    items: [asked, stored("m1", { block: "Text", text: "Hello" })],
  });
  expect(after).toEqual(before);
});

test("a second message beginning before the first is stored keeps the first drawn", () => {
  const held = heardAll([
    began("m1", 0, "Text"),
    wrote("m1", 0, 0, "Looking."),
    began("m1", 1, "ToolUse", "Read"),
    began("m2", 0, "Text"),
    wrote("m2", 0, 0, "Found it."),
  ]);
  const exchange = only({ held, items: [asked] });
  expect(exchange.answer).toBe("Found it.");
  expect(exchange.work).toEqual([
    { step: "Text", text: "Looking." },
    { step: "ToolCall", id: "", name: "Read", input: undefined },
  ]);
});

test("a message heard before one the transcript holds part of is drawn from the transcript alone", () => {
  const held = heardAll([
    began("m1", 0, "Text"),
    wrote("m1", 0, 0, "Abandoned"),
    began("m2", 0, "Text"),
    wrote("m2", 0, 0, "Kept"),
    began("m2", 1, "ToolUse", "Read"),
  ]);
  const exchange = only({
    held,
    items: [asked, stored("m2", { block: "Text", text: "Kept" })],
  });
  expect(exchange.answer).toBe("Kept");
  expect(exchange.work).toEqual([
    { step: "ToolCall", id: "", name: "Read", input: undefined },
  ]);
});

test("a settled turn keeps what was heard until the walk has read to the mark", () => {
  const held = heardAll([
    began("m1", 0, "Text"),
    wrote("m1", 0, 0, "Hello"),
    ended,
  ]);
  const settled = only({ held, items: [asked], state: "Answered" });
  expect(settled.answer).toBe("Hello");
  expect(settled.standing).toEqual({ standing: "Answered" });
  expect(settled.activity).toBeUndefined();
  const items = [asked, stored("m1", { block: "Text", text: "Hello" })];
  const reached = drawn({ held, items, state: "Answered", reached: true });
  expect(reached).toEqual(conversationExchanges(items, turnsOf("Answered")));
});

test("a settled turn the store never held is drawn as the transcript alone once the walk is done", () => {
  const held = heardAll([began("m1", 0, "Text"), wrote("m1", 0, 0, "Hello")]);
  const exchange = only({
    held,
    items: [asked],
    state: "Failed",
    reached: true,
  });
  expect(exchange.answer).toBeUndefined();
});

test("an answered turn the transcript does not hold stands while something heard of it is drawn", () => {
  const held = heardAll([
    began("m1", 0, "Text"),
    wrote("m1", 0, 0, "Hello"),
    ended,
  ]);
  const exchange = only({ held, items: [], state: "Answered" });
  expect(exchange.answer).toBe("Hello");
  expect(drawn({ held, items: [], state: "Answered", reached: true })).toEqual(
    [],
  );
});

test("a reader who opens mid-message starts from the snapshot and appends to it", () => {
  const opened = heardAll([
    snapshot({
      turn,
      message: "m1",
      blocks: [
        { index: 0, kind: "Thinking", text: "", gapped: false },
        { index: 1, kind: "Text", text: "Hel", gapped: false },
      ],
    }),
  ]);
  expect(only({ held: opened, items: [asked] }).answer).toBe("Hel");
  const more = heardAll([wrote("m1", 1, 3, "lo")], opened);
  const exchange = only({ held: more, items: [asked] });
  expect(exchange.answer).toBe("Hello");
  expect(exchange.work).toEqual([{ step: "Thinking", text: "" }]);
});

test("a snapshot holding less than was heard takes nothing away", () => {
  const before = heardAll([began("m1", 0, "Text"), wrote("m1", 0, 0, "Hello")]);
  const less = snapshot({
    turn,
    message: "m1",
    blocks: [{ index: 0, kind: "Text", text: "", gapped: true }],
  });
  const reopened = heardAll([less], before);
  expect(only({ held: reopened, items: [asked] }).answer).toBe("Hello");
  expect(heardAll([less], reopened).written).toEqual([
    {
      turn,
      message: "m1",
      blocks: [{ index: 0, kind: "Text", text: "Hello", gapped: false }],
    },
  ]);
});

test("a snapshot holding more than was heard is what is drawn, once", () => {
  const before = heardAll([began("m1", 0, "Text"), wrote("m1", 0, 0, "Hello")]);
  const reopened = heardAll(
    [
      snapshot({
        turn,
        message: "m1",
        blocks: [
          { index: 0, kind: "Text", text: "Hello world", gapped: false },
        ],
      }),
    ],
    before,
  );
  expect(only({ held: reopened, items: [asked] }).answer).toBe("Hello world");
});

const calling: readonly ThreadLiveStreamEvent[] = [
  began("m1", 0, "Text"),
  wrote("m1", 0, 0, "Running the gates."),
  began("m1", 1, "ToolUse", "Bash"),
];

const callStored: readonly ConversationItem[] = [
  asked,
  stored("m1", { block: "Text", text: "Running the gates." }),
  stored("m1", { block: "ToolUse", id: "toolu_1", name: "Bash", input: {} }),
];

test("a snapshot of nothing ends nothing: the hub forgetting a session mid-tool leaves the tool under way", () => {
  const forgotten = heardAll([snapshot({ blocks: [] })], heardAll(calling));
  expect(forgotten.ended).toBeUndefined();
  for (const items of [[asked], callStored]) {
    const exchange = only({ held: forgotten, items, reached: true });
    expect(exchange.answer).toBe("Running the gates.");
    expect(exchange.activity).toEqual({ activity: "ToolUse", name: "Bash" });
  }
});

test("an End is heard for a turn the fold is no longer holding", () => {
  const forgotten = heardAll([snapshot({ blocks: [] })], heardAll(calling));
  const whole = heardAll([ended], forgotten);
  expect(whole.ended).toBe(turn);
  expect(only({ held: whole, items: callStored }).activity).toEqual({
    activity: "Whole",
  });
  const resumed = heardAll([began("m2", 0, "Text")], whole);
  expect(resumed.ended).toBeUndefined();
});

test("another turn being written is how an end nobody heard is read", () => {
  const next = heardAll(
    [began("m2", 0, "Text", undefined, "turn-2")],
    heardAll(calling),
  );
  expect(next.ended).toBe(turn);
});

test("a turn put back to wait after its attempt ended is not said to be whole, then or when it is taken again", () => {
  const held = heardAll([began("m1", 0, "Thinking"), ended]);
  expect(only({ held, items: [asked] }).activity).toEqual({
    activity: "Whole",
  });
  const waiting = only({ held, items: [asked], state: "Queued" });
  expect(waiting.activity).toBeUndefined();
  const kept = conversationLiveKept(held, turnsOf("Queued"), false);
  expect(kept.ended).toBeUndefined();
  expect(only({ held: kept, items: [asked] }).activity).not.toEqual({
    activity: "Whole",
  });
});

test("a running exchange says what the last thing heard of it is", () => {
  const thinking = heardAll([began("m1", 0, "Thinking")]);
  expect(only({ held: thinking, items: [asked] }).activity).toEqual({
    activity: "Thinking",
  });
  const writing = heardAll(
    [began("m1", 1, "Text"), wrote("m1", 1, 0, "Looking.")],
    thinking,
  );
  expect(only({ held: writing, items: [asked] }).activity).toEqual({
    activity: "Writing",
  });
  const calling = heardAll([began("m1", 2, "ToolUse", "Read")], writing);
  expect(only({ held: calling, items: [asked] }).activity).toEqual({
    activity: "ToolUse",
    name: "Read",
  });
  expect(
    only({ held: heardAll([ended], calling), items: [asked] }).activity,
  ).toEqual({ activity: "Whole" });
});

test("a call the transcript holds no result for is named with nothing heard", () => {
  const call: ConversationBlock = {
    block: "ToolUse",
    id: "toolu_1",
    name: "Read",
    input: { path: "a" },
  };
  const calling = [asked, stored("m1", call)];
  expect(
    only({ held: conversationLiveNothing, items: calling }).activity,
  ).toEqual({
    activity: "ToolUse",
    name: "Read",
  });
  const returned = only({
    held: conversationLiveNothing,
    items: [...calling, resulted("toolu_1")],
  });
  expect(returned.activity).toBeUndefined();
});

test("a running turn's latest text stays in the answer's place when work follows it", () => {
  const held = heardAll([
    began("m1", 0, "Text"),
    wrote("m1", 0, 0, "Looking."),
    began("m1", 1, "ToolUse", "Read"),
  ]);
  const exchange = only({ held, items: [asked] });
  expect(exchange.answer).toBe("Looking.");
  expect(exchange.work).toEqual([
    { step: "ToolCall", id: "", name: "Read", input: undefined },
  ]);
  const settled = only({ held, items: [asked], state: "Answered" });
  expect(settled.answer).toBeUndefined();
  expect(settled.work).toEqual([
    { step: "Text", text: "Looking." },
    { step: "ToolCall", id: "", name: "Read", input: undefined },
  ]);
});

test("the stored transcript alone keeps a running turn's latest text in the answer's place", () => {
  const items = [
    asked,
    stored("m1", { block: "Text", text: "Looking." }),
    stored("m1", { block: "ToolUse", id: "toolu_1", name: "Read", input: {} }),
  ];
  const exchange = only({ held: conversationLiveNothing, items });
  expect(exchange.answer).toBe("Looking.");
  expect(exchange.work.map((step) => step.step)).toEqual(["ToolCall"]);
});

test("an exchange nothing was heard of and no turn runs in is handed back as it came", () => {
  const items = [asked, stored("m1", { block: "Text", text: "Hello" })];
  const exchanges = conversationExchanges(items, turnsOf("Answered"));
  const live = conversationExchangesLive(exchanges, []);
  expect(live[0]).toBe(exchanges[0]);
});

test("text a settled turn never stored is forgotten, and does not return when the walk falls behind", () => {
  const held = heardAll([
    began("m1", 0, "Text"),
    wrote("m1", 0, 0, "Half an answ"),
  ]);
  const failed = turnsOf("Failed");
  expect(only({ held, items: [asked], state: "Failed" }).answer).toBe(
    "Half an answ",
  );
  const kept = conversationLiveKept(held, failed, true);
  expect(kept).toEqual(conversationLiveNothing);
  const again: readonly ConversationTurn[] = [
    ...failed,
    {
      turn: "turn-2",
      ordinal: 2,
      inputKind: "UserMessage",
      input: "again",
      state: "Queued",
    },
  ];
  const behind = drawn({ held: kept, items: [asked], turns: again });
  expect(behind.map((exchange) => exchange.answer)).toEqual([
    undefined,
    undefined,
  ]);
});

test("what is held is handed back itself while nothing of it is over", () => {
  const held = heardAll([began("m1", 0, "Text"), wrote("m1", 0, 0, "Hello")]);
  expect(conversationLiveKept(held, turnsOf("Claimed"), true)).toBe(held);
  expect(conversationLiveKept(held, turnsOf("Answered"), false)).toBe(held);
  expect(conversationLiveKept(held, [], true)).toBe(held);
});

const again = "continue";

const askedAgain: ConversationItem = {
  item: "Entry",
  entry: {
    id: "entry-ask-again",
    role: "User",
    blocks: [{ block: "Text", text: again }],
  },
};

function sameAsk(
  second: SessionTurnState,
  first: SessionTurnState = "Answered",
): readonly ConversationTurn[] {
  return [
    { turn, ordinal: 1, inputKind: "UserMessage", input: again, state: first },
    {
      turn: "turn-2",
      ordinal: 2,
      inputKind: "UserMessage",
      input: again,
      state: second,
    },
  ];
}

const secondHeard = heardAll([
  began("m2", 0, "Text", undefined, "turn-2"),
  wrote("m2", 0, 0, "Second answer.", "turn-2"),
]);

test("what is heard of a turn is not drawn under an earlier turn that asked the same thing", () => {
  const first = [
    askedAgain,
    stored("m1", { block: "Text", text: "First answer." }),
  ];
  const unstored = drawn({
    held: secondHeard,
    items: first,
    turns: sameAsk("Claimed"),
    reached: true,
  });
  expect(unstored.map((exchange) => exchange.answer)).toEqual([
    "First answer.",
    "Second answer.",
  ]);
  const landed = drawn({
    held: secondHeard,
    items: [
      ...first,
      { ...askedAgain, entry: { ...askedAgain.entry, id: "b" } },
    ],
    turns: sameAsk("Claimed"),
    reached: true,
  });
  expect(landed.map((exchange) => exchange.answer)).toEqual([
    "First answer.",
    "Second answer.",
  ]);
  expect(landed.map((exchange) => exchange.turn)).toEqual([turn, "turn-2"]);
});

test("the same ask sent again after a turn that failed before storing it is drawn under its own", () => {
  const turns = sameAsk("Claimed", "Failed");
  const unstored = drawn({ held: secondHeard, items: [], turns });
  expect(unstored.map((exchange) => exchange.answer)).toEqual([
    undefined,
    "Second answer.",
  ]);
  const landed = drawn({ held: secondHeard, items: [askedAgain], turns });
  expect(landed.map((exchange) => [exchange.turn, exchange.answer])).toEqual([
    ["turn-2", "Second answer."],
    [turn, undefined],
  ]);
});

test("a turn the mailbox does not name draws nothing", () => {
  const held = heardAll([
    live({ live: "Block", message: "m1", index: 0, kind: "Text" }, "turn-9"),
    live(
      { live: "Text", message: "m1", index: 0, offset: 0, text: "Hello" },
      "turn-9",
    ),
  ]);
  expect(only({ held, items: [asked] }).answer).toBeUndefined();
});

test("no more messages are kept than the bound, and the oldest leaves first", () => {
  const frames = Array.from(
    { length: conversationLiveMessagesMax + 3 },
    (_unused, at) => [
      began(`m${String(at)}`, 0, "Text"),
      wrote(`m${String(at)}`, 0, 0, `said ${String(at)}`),
    ],
  ).flat();
  const held = heardAll(frames);
  expect(held.written).toHaveLength(conversationLiveMessagesMax);
  expect(held.written[0]?.message).toBe("m2");
});

function storeItems(entries: number): readonly ConversationItem[] {
  return sessionConversationItems({
    held: {
      ...leadTranscriptFoldEmpty,
      entries: conversationStoreEntries()
        .filter((entry) => entry.type === "user" || entry.type === "assistant")
        .slice(0, entries)
        .map((entry) => ({
          uuid: entry.uuid,
          type: entry.type === "user" ? "user" : "assistant",
          message: entry.message,
        })),
      stream: "stream",
      failure: undefined,
      unreached: false,
    },
    stream: "stream",
    listed: true,
    turned: true,
  });
}

test("a heard block is matched to the store's own entries by its place in its message", () => {
  const message = "msg_011CeesakKm3chfd5xTdv5qq";
  const held = heardAll([
    began(message, 0, "Thinking"),
    began(message, 1, "Text"),
    wrote(message, 1, 0, "I've noted"),
  ]);
  const turns: readonly ConversationTurn[] = [
    {
      turn,
      ordinal: 1,
      inputKind: "UserMessage",
      input: "Remember the word NARWHAL and reply ok",
      state: "Claimed",
    },
  ];
  const blocksAt = (entries: number): readonly ConversationBlock[] => {
    const stored = conversationStoredBlocks(storeItems(entries));
    return conversationLiveTurns(
      conversationLiveKept(held, turns, false),
      stored,
    ).flatMap((heard) => heard.blocks);
  };
  expect(conversationStoredBlocks(storeItems(3)).blocks.get(message)).toBe(2);
  expect(blocksAt(1).map((block) => block.block)).toEqual(["Thinking", "Text"]);
  expect(blocksAt(2)).toEqual([{ block: "Text", text: "I've noted" }]);
  expect(blocksAt(3)).toEqual([]);
});

test("blocks the store cut from an entry count as the blocks they were", () => {
  const held = heardAll([
    began("m1", 0, "Thinking"),
    began("m1", 1, "Thinking"),
    began("m1", 2, "ToolUse", "Read"),
    began("m1", 3, "Text"),
    wrote("m1", 3, 0, "Hello"),
  ]);
  const cut: ConversationItem = {
    item: "Entry",
    entry: {
      id: "entry-cut",
      role: "Assistant",
      message: "m1",
      blocks: [
        { block: "Thinking", text: "" },
        { block: "Capped", count: 2 },
      ],
    },
  };
  const items = [asked, cut];
  expect(conversationStoredBlocks(items).blocks.get("m1")).toBe(3);
  const exchange = only({ held, items });
  expect(exchange.answer).toBe("Hello");
  expect(exchange.work).toEqual([{ step: "Thinking", text: "" }]);
});

test("a message abandoned part way leaves once the transcript holds the one that replaced it, heard or not", () => {
  const abandoned = heardAll(
    [began("m1", 0, "Text"), wrote("m1", 0, 0, "Hello, I will")],
    conversationLiveNothing,
    0,
  );
  const replaced = [
    asked,
    stored("m1b", { block: "Text", text: "Hello, I will do it." }),
  ];
  expect(only({ held: abandoned, items: [asked] }).answer).toBe(
    "Hello, I will",
  );
  expect(only({ held: abandoned, items: replaced }).answer).toBe(
    "Hello, I will do it.",
  );
  const called = [
    ...replaced,
    stored("m1b", { block: "ToolUse", id: "toolu_1", name: "Read", input: {} }),
    resulted("toolu_1"),
  ];
  const later = only({ held: abandoned, items: called });
  expect(later.answer).toBe("Hello, I will do it.");
  expect(later.work.map((step) => step.step)).toEqual(["ToolCall"]);
});

test("a message is marked with what the transcript held when it was first heard, and keeps that mark", () => {
  const first = heardAll(
    [began("m1", 0, "Text"), wrote("m1", 0, 0, "Hello, I")],
    conversationLiveNothing,
    0,
  );
  const more = conversationLiveHeard(first, wrote("m1", 0, 8, " will"), 1);
  expect(more.known).toBe(0);
  const exchange = only({
    held: more,
    items: [asked, stored("m1b", { block: "Text", text: "Hello, done." })],
  });
  expect(exchange.answer).toBe("Hello, done.");
  const next = conversationLiveHeard(more, began("m2", 0, "Text"), 1);
  expect(next.known).toBe(1);
  expect(next.written.map((message) => message.known)).toEqual([0]);
});

test("part of a message stored and a later message after it: the rest of the first is never drawn", () => {
  const held = heardAll([
    began("m1", 0, "Thinking"),
    began("m1", 1, "Text"),
    wrote("m1", 1, 0, "Abandoned"),
  ]);
  const exchange = only({
    held,
    items: [
      asked,
      stored("m1", { block: "Thinking", text: "hm" }),
      stored("m1b", { block: "Text", text: "Kept" }),
    ],
  });
  expect(exchange.answer).toBe("Kept");
});

test("a reader who opens on a later message keeps it while the transcript holds the ones before it", () => {
  const earlier = [
    asked,
    stored("m1", { block: "ToolUse", id: "toolu_1", name: "Read", input: {} }),
    resulted("toolu_1"),
  ];
  const opened = heardAll([
    snapshot({
      turn,
      message: "m2",
      blocks: [{ index: 0, kind: "Text", text: "Found", gapped: false }],
    }),
  ]);
  expect(only({ held: opened, items: earlier }).answer).toBe("Found");
  const marked = heardAll(
    [
      snapshot({
        turn,
        message: "m2",
        blocks: [{ index: 0, kind: "Text", text: "Found", gapped: false }],
      }),
    ],
    conversationLiveNothing,
    1,
  );
  expect(only({ held: marked, items: earlier }).answer).toBe("Found");
});

test("a message heard before another is never taken for the later of the two", () => {
  const held = heardAll(
    [
      began("m1", 0, "ToolUse", "Read"),
      began("m2", 0, "Text"),
      wrote("m2", 0, 0, "Found"),
    ],
    conversationLiveNothing,
    0,
  );
  const exchange = only({
    held,
    items: [
      asked,
      stored("m1", {
        block: "ToolUse",
        id: "toolu_1",
        name: "Read",
        input: {},
      }),
    ],
  });
  expect(exchange.answer).toBe("Found");
});

/** Every order two sequences can arrive in with each kept in its own. */
function interleavings<Step>(
  left: readonly Step[],
  right: readonly Step[],
): readonly (readonly Step[])[] {
  const [first, ...rest] = left;
  const [other, ...others] = right;
  if (first === undefined) return [right];
  if (other === undefined) return [left];
  return [
    ...interleavings(rest, right).map((order) => [first, ...order]),
    ...interleavings(left, others).map((order) => [other, ...order]),
  ];
}

type Step =
  | { readonly path: "Live"; readonly frame: ThreadLiveStreamEvent }
  | { readonly path: "Store"; readonly item: ConversationItem };

const scriptLive: readonly ThreadLiveStreamEvent[] = [
  began("m1", 0, "Thinking"),
  began("m1", 1, "Text"),
  wrote("m1", 1, 0, "aa"),
  wrote("m1", 1, 2, "a"),
  began("m1", 2, "ToolUse", "Read"),
  began("m2", 0, "Text"),
  wrote("m2", 0, 0, "bb"),
  wrote("m2", 0, 2, "bb"),
  ended,
];

const scriptStore: readonly ConversationItem[] = [
  asked,
  stored("m1", { block: "Thinking", text: "hm" }),
  stored("m1", { block: "Text", text: "aaa" }),
  stored("m1", { block: "ToolUse", id: "toolu_1", name: "Read", input: {} }),
  resulted("toolu_1"),
  stored("m2", { block: "Text", text: "bbbb" }),
];

/** Every character one exchange draws as text, in the answer or in its work. */
function textDrawn(exchanges: readonly ConversationExchange[]): string {
  return exchanges
    .flatMap((exchange) => [
      ...exchange.work.flatMap((step) =>
        step.step === "Text" ? [step.text] : [],
      ),
      exchange.answer ?? "",
    ])
    .join("");
}

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

test("in every order the two paths can arrive, no text is drawn twice and none drawn goes away", () => {
  const orders = interleavings<Step>(
    scriptLive.map((frame) => ({ path: "Live", frame })),
    scriptStore.map((item) => ({ path: "Store", item })),
  );
  expect(orders.length).toBeGreaterThan(scriptLive.length * scriptStore.length);
  const settledAs = conversationExchanges(scriptStore, turnsOf("Answered"));
  for (const order of orders) {
    let held = conversationLiveNothing;
    let items: readonly ConversationItem[] = [];
    let drawnBefore = { a: 0, b: 0 };
    for (const step of order) {
      if (step.path === "Live") held = conversationLiveHeard(held, step.frame);
      else items = [...items, step.item];
      const text = textDrawn(drawn({ held, items }));
      const now = { a: count(text, "a"), b: count(text, "b") };
      expect(now.a).toBeLessThanOrEqual(3);
      expect(now.b).toBeLessThanOrEqual(4);
      expect(now.a).toBeGreaterThanOrEqual(drawnBefore.a);
      expect(now.b).toBeGreaterThanOrEqual(drawnBefore.b);
      drawnBefore = now;
    }
    expect(drawnBefore).toEqual({ a: 3, b: 4 });
    const settled = drawn({ held, items, state: "Answered" });
    expect(textDrawn(settled)).toBe(textDrawn(settledAs));
    expect(drawn({ held, items, state: "Answered", reached: true })).toEqual(
      settledAs,
    );
  }
});
