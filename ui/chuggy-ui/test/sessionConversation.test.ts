/**
 * The walk and the mailbox as the surface takes them: what one entry becomes,
 * where the seam falls, what a walk that fell short says, and what a turn
 * carries into the overlay.
 *
 * The shortfall cases are the point of this suite: a walk that failed, one that
 * has not reached the stream's end and one whose oldest entries have left are
 * three different partial records, and a page that drew any of them as a whole
 * conversation would be telling a reader a session said less than it did.
 */

import { expect, test } from "vitest";

import { conversationExchanges } from "../app/core/conversation.ts";
import type { ConversationItem } from "../app/core/conversation.ts";
import { leadTranscriptFoldEmpty } from "../app/core/leadTranscript.ts";
import type {
  LeadTranscriptEntry,
  LeadTranscriptHeld,
} from "../app/core/leadTranscript.ts";
import {
  sessionConversationItems,
  sessionConversationTurns,
} from "../app/core/sessionConversation.ts";
import type { LeadTurnResponse } from "../../../src/contract/responses.ts";
import { threadTurn } from "./threadFixture.ts";

const stream = "9f8e7d";

function heldOf(held: Partial<LeadTranscriptHeld>): LeadTranscriptHeld {
  return {
    ...leadTranscriptFoldEmpty,
    stream,
    failure: undefined,
    unreached: false,
    ...held,
  };
}

function said(text: string): unknown {
  return { content: [{ type: "text", text }] };
}

function entryOf(
  entry: Partial<LeadTranscriptEntry> &
    Pick<LeadTranscriptEntry, "type" | "message">,
): LeadTranscriptEntry {
  return { uuid: "uuid-1", timestamp: "2026-09-02T10:00:00Z", ...entry };
}

/** The items one read makes, with the stream listed unless a case says else. */
function itemsOf(
  held: Partial<LeadTranscriptHeld>,
): readonly ConversationItem[] {
  return sessionConversationItems({
    held: heldOf(held),
    stream,
    listed: true,
    turned: true,
  });
}

function markers(items: readonly ConversationItem[]): readonly string[] {
  return items.flatMap((item) =>
    item.item === "Marker" ? [item.marker.marker] : [],
  );
}

test("a chain becomes one entry per line, in the order the walk gathered them", () => {
  const items = itemsOf({
    entries: [
      entryOf({ uuid: "uuid-a", type: "user", message: said("what of 41") }),
      entryOf({
        uuid: "uuid-b",
        type: "assistant",
        message: said("it waits on 40"),
      }),
    ],
  });
  expect(items).toStrictEqual([
    {
      item: "Entry",
      entry: {
        id: "uuid-a",
        role: "User",
        at: "2026-09-02T10:00:00Z",
        blocks: [{ block: "Text", text: "what of 41" }],
      },
    },
    {
      item: "Entry",
      entry: {
        id: "uuid-b",
        role: "Assistant",
        at: "2026-09-02T10:00:00Z",
        blocks: [{ block: "Text", text: "it waits on 40" }],
      },
    },
  ]);
});

/** The ordinal is a position in what the pane holds, which is what an entry the
 * store gave no uuid can be keyed by and all it can be keyed by. */
test("an entry with no uuid is keyed by its place in the chain", () => {
  const items = itemsOf({
    entries: [entryOf({ uuid: undefined, type: "user", message: said("one") })],
  });
  const first = items[0];
  expect(first?.item === "Entry" ? first.entry.id : undefined).toBe("entry-0");
});

test("the seam stands above the entry the compaction cut at and nowhere else", () => {
  const items = itemsOf({
    entries: [
      entryOf({ uuid: "uuid-a", type: "user", message: said("before") }),
      entryOf({ uuid: "uuid-b", type: "user", message: said("the summary") }),
    ],
    compaction: { boundary: "uuid-b", at: "2026-09-02T11:00:00Z" },
  });
  expect(items.map((item) => item.item)).toStrictEqual([
    "Entry",
    "Marker",
    "Entry",
  ]);
  expect(items[1]).toStrictEqual({
    item: "Marker",
    marker: { marker: "Compaction", at: "2026-09-02T11:00:00Z" },
  });
});

test("a session that was asked something and has no store says so, and nothing else", () => {
  const items = sessionConversationItems({
    held: heldOf({}),
    stream: undefined,
    listed: false,
    turned: true,
  });
  expect(items).toStrictEqual([
    { item: "Marker", marker: { marker: "NoStore" } },
  ]);
});

/** The store is written by the first turn, so a thread just opened names no
 * stream — and `No store` over an empty pane reads as a fault where there is
 * only a thread nobody has typed in yet. */
test("a session nobody has asked anything says nothing at all", () => {
  expect(
    sessionConversationItems({
      held: heldOf({}),
      stream: undefined,
      listed: false,
      turned: false,
    }),
  ).toStrictEqual([]);
});

/**
 * The listing is bounded, so a session can name a stream that is not on it. The
 * walk pages that stream anyway, and what it gathered is drawn under the word
 * rather than withheld: an empty conversation reads as a session that has said
 * nothing, which is what the word is there to prevent.
 */
test("a stream the listing does not carry says so and still draws what was gathered", () => {
  const items = sessionConversationItems({
    held: heldOf({ entries: [entryOf({ type: "user", message: said("hi") })] }),
    stream,
    listed: false,
    turned: true,
  });
  expect(items.map((item) => item.item)).toStrictEqual(["Marker", "Entry"]);
  expect(items[0]).toStrictEqual({
    item: "Marker",
    marker: { marker: "Unlisted" },
  });
});

/**
 * A SHORTFALL IS A FACT ABOUT THE READ WHETHER OR NOT THE STREAM IS LISTED.
 * The `Unlisted` marker withholds nothing else the walk found out.
 */
test("an unlisted stream's shortfalls stand beside the marker and what was gathered", () => {
  const items = sessionConversationItems({
    held: heldOf({
      entries: [entryOf({ type: "user", message: said("hi") })],
      failure: "the API failed with InternalError",
      truncated: true,
      elided: 2,
      entriesDropped: 1,
    }),
    stream,
    listed: false,
    turned: true,
  });
  expect(markers(items)).toStrictEqual([
    "Failure",
    "Truncated",
    "Capped",
    "Dropped",
    "Unlisted",
  ]);
  expect(items.map((item) => item.item)).toStrictEqual([
    "Marker",
    "Marker",
    "Marker",
    "Marker",
    "Marker",
    "Entry",
  ]);
});

test("a read that failed, an unreached tail, elided batches and dropped entries each say themselves", () => {
  const items = itemsOf({
    failure: "Fault · 500",
    unreached: true,
    elided: 2,
    entriesDropped: 3,
  });
  expect(markers(items)).toStrictEqual([
    "Failure",
    "Unreached",
    "Capped",
    "Dropped",
  ]);
  expect(
    items.map((item) => (item.item === "Marker" ? item.marker : undefined)),
  ).toStrictEqual([
    { marker: "Failure", reason: "Fault · 500" },
    { marker: "Unreached" },
    { marker: "Capped", sentence: "Elided · 2 batches" },
    { marker: "Dropped", count: 3 },
  ]);
});

/**
 * A page reports `truncated` for its own entries being cut and for nothing
 * else, so an undecided held set neither raises the word nor silences it. The
 * pane that guarded it on `holdingUnknown` swallowed a real cut on every page
 * of a stream longer than the route's held walk may read.
 */
test("a page whose entries were cut says so, decided or not", () => {
  expect(markers(itemsOf({ truncated: true }))).toStrictEqual(["Truncated"]);
  expect(
    markers(itemsOf({ truncated: true, holdingUnknown: true })),
    "an undecided walk is not grounds to swallow a cut this page did make",
  ).toStrictEqual(["Truncated"]);
  expect(markers(itemsOf({ holdingUnknown: true }))).toStrictEqual([]);
});

/**
 * `unreached` is the whole of what the reader is told about how far this walk
 * got, and it is a fact about this pane rather than about the route. It is
 * worded as an unreached tail rather than left silent, and does not
 * double-report beside `truncated`.
 */
test("a walk that stopped short says so, and one that reached the end says nothing for it", () => {
  expect(markers(itemsOf({ unreached: true }))).toStrictEqual(["Unreached"]);
  expect(markers(itemsOf({ unreached: false }))).toStrictEqual([]);
  expect(markers(itemsOf({ unreached: true, truncated: true }))).toStrictEqual([
    "Unreached",
  ]);
});

/**
 * The two derivations meet in `conversationExchanges`, which is the only place
 * they are ever used together: the transcript is the spine, and the turn that
 * matches its ask by text is what carries the measures and the standing.
 */
test("a chain and the turn that matches it make one measured exchange", () => {
  const items = itemsOf({
    entries: [
      entryOf({ uuid: "uuid-a", type: "user", message: said("what of 41") }),
      entryOf({
        uuid: "uuid-b",
        type: "assistant",
        message: said("it waits on 40"),
      }),
    ],
  });
  const exchanges = conversationExchanges(
    items,
    sessionConversationTurns([
      threadTurn({ turn: "thread-turn-1", input: "what of 41" }),
    ]),
  );
  expect(exchanges).toHaveLength(1);
  expect(exchanges[0]?.ask).toStrictEqual({
    ask: "Message",
    text: "what of 41",
  });
  expect(exchanges[0]?.answer).toBe("it waits on 40");
  expect(exchanges[0]?.standing).toStrictEqual({ standing: "Answered" });
  expect(exchanges[0]?.measures).toStrictEqual({
    tokens: 52_100,
    costMicros: 210_000,
    durationMs: 61_000,
  });
});

test("a turn carries every measure it was answered with and invents none", () => {
  const turns = sessionConversationTurns([
    threadTurn({
      turn: "thread-turn-1",
      state: "Failed",
      failure: "AgentRateLimited",
      tokens: undefined,
      costMicros: undefined,
      durationMs: undefined,
    }),
  ]);
  expect(turns).toStrictEqual([
    {
      turn: "thread-turn-1",
      ordinal: 1,
      inputKind: "UserMessage",
      input: "what is ticket 41 waiting on",
      state: "Failed",
      failure: "AgentRateLimited",
    },
  ]);
});

/** A lead's turn carries no `input` at all — the decision log already holds
 * it — so none is invented for it, whatever the turn's state. */
test("a lead's turn carries no input of its own", () => {
  const turn: LeadTurnResponse = {
    turn: "turn-1",
    ordinal: 1,
    inputKind: "Observation",
    state: "Answered",
    tokens: 900,
  };
  expect(sessionConversationTurns([turn])).toStrictEqual([
    {
      turn: "turn-1",
      ordinal: 1,
      inputKind: "Observation",
      state: "Answered",
      tokens: 900,
    },
  ]);
});

/** A lead turn nobody has claimed appends a running exchange that draws its
 * kind word and no text, because a lead's turn has no input for the overlay
 * to have carried in the first place. */
test("a Queued lead turn with no input appends a running exchange with its kind word", () => {
  const turn: LeadTurnResponse = {
    turn: "turn-9",
    ordinal: 9,
    inputKind: "Observation",
    state: "Queued",
  };
  const exchanges = conversationExchanges([], sessionConversationTurns([turn]));
  expect(exchanges).toHaveLength(1);
  expect(exchanges[0]?.ask).toEqual({ ask: "Observation" });
  expect(exchanges[0]?.standing).toEqual({
    standing: "Running",
    state: "Queued",
  });
});
