/**
 * A session's live events and what a reader of a thread's live stream holds
 * after each: the bounds an event is refused at, and the fold a server and a
 * browser share.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  jsonTextBytes,
  sessionLiveBlockCharsMax,
  sessionLiveBlocksMax,
  sessionLiveTextBytesMax,
} from "../../src/contract/http.ts";
import {
  isSessionLiveText,
  sessionLiveEventSchema,
  type SessionLiveEvent,
} from "../../src/contract/sessionLive.ts";
import {
  parseThreadLiveEvent,
  threadLiveHeard,
  threadLiveHeldSchema,
  threadLiveNothing,
  threadLiveVersion,
  type ThreadLiveHeld,
} from "../../src/contract/threadLive.ts";

const message = "msg_first";

function block(
  index: number,
  kind: "Text" | "Thinking" = "Text",
  of = message,
): SessionLiveEvent {
  return { live: "Block", message: of, index, kind };
}

function text(
  index: number,
  offset: number,
  written: string,
  of = message,
): SessionLiveEvent {
  return { live: "Text", message: of, index, offset, text: written };
}

function heard(
  events: readonly SessionLiveEvent[],
  turn = "turn-1",
  from: ThreadLiveHeld = threadLiveNothing,
): ThreadLiveHeld {
  return events.reduce(
    (held, event) => threadLiveHeard(held, turn, event),
    from,
  );
}

test("a text's weight is its JSON string's UTF-8 length", () => {
  for (const written of ["", "plain", "line\nbreak", "\u0001", "é", "漢", "😀"])
    assert.equal(
      jsonTextBytes(written),
      Buffer.byteLength(JSON.stringify(written)),
      JSON.stringify(written),
    );
});

test("a live text is refused empty, ill formed, holding a NUL, or heavier than its bound", () => {
  const quotesBytes = jsonTextBytes("");
  const heaviest = "a".repeat(sessionLiveTextBytesMax - quotesBytes);
  assert.equal(isSessionLiveText(heaviest), true);
  assert.equal(isSessionLiveText(`${heaviest}a`), false);
  assert.equal(isSessionLiveText(""), false);
  assert.equal(isSessionLiveText("a\u0000"), false);
  assert.equal(isSessionLiveText("😀".slice(0, 1)), false);
});

test("a block names a tool exactly where it is a tool's", () => {
  const begun = { live: "Block", message, index: 0 };
  const accepted = (event: unknown) =>
    sessionLiveEventSchema.safeParse(event).success;
  assert.equal(accepted({ ...begun, kind: "ToolUse", name: "Read" }), true);
  assert.equal(accepted({ ...begun, kind: "ToolUse" }), false);
  assert.equal(accepted({ ...begun, kind: "Text" }), true);
  assert.equal(accepted({ ...begun, kind: "Text", name: "Read" }), false);
  assert.equal(accepted({ ...begun, kind: "Thinking" }), true);
  assert.equal(accepted({ ...begun, index: sessionLiveBlocksMax }), false);
});

test("a text is refused where it would end past a block's bound", () => {
  const accepted = (offset: number) =>
    sessionLiveEventSchema.safeParse(text(0, offset, "ab")).success;
  assert.equal(accepted(sessionLiveBlockCharsMax - 2), true);
  assert.equal(accepted(sessionLiveBlockCharsMax - 1), false);
});

test("text placed where a block's text ends is appended", () => {
  assert.deepEqual(heard([block(0), text(0, 0, "Hel"), text(0, 3, "lo")]), {
    turn: "turn-1",
    message,
    blocks: [{ index: 0, kind: "Text", text: "Hello", gapped: false }],
  });
});

test("text placed inside a block's text replaces what followed", () => {
  const held = heard([block(0), text(0, 0, "Hello"), text(0, 3, "p me")]);
  assert.equal(held.blocks[0]?.text, "Help me");
});

test("text placed past a block's end leaves it gapped until it begins again", () => {
  const gapped = heard([block(0), text(0, 0, "Hel"), text(0, 5, "lo")]);
  assert.deepEqual(gapped.blocks, [
    { index: 0, kind: "Text", text: "", gapped: true },
  ]);
  const still = heard([text(0, 0, "Hello")], "turn-1", gapped);
  assert.deepEqual(still.blocks, gapped.blocks);
  const again = heard([block(0), text(0, 0, "Hello")], "turn-1", gapped);
  assert.deepEqual(again.blocks, [
    { index: 0, kind: "Text", text: "Hello", gapped: false },
  ]);
});

test("text for a block that never began, or that is not text, leaves it gapped", () => {
  assert.deepEqual(heard([text(2, 0, "Hello")]).blocks, [
    { index: 2, kind: "Text", text: "", gapped: true },
  ]);
  assert.deepEqual(heard([block(0, "Thinking"), text(0, 0, "Hello")]).blocks, [
    { index: 0, kind: "Thinking", text: "", gapped: true },
  ]);
});

test("blocks are held in index order whatever order they began in", () => {
  const held = heard([
    block(1),
    { live: "Block", message, index: 2, kind: "ToolUse", name: "Read" },
    block(0, "Thinking"),
  ]);
  assert.deepEqual(
    held.blocks.map(({ index, kind, name }) => [index, kind, name]),
    [
      [0, "Thinking", undefined],
      [1, "Text", undefined],
      [2, "ToolUse", "Read"],
    ],
  );
});

test("an event of another message or another turn begins it with nothing held", () => {
  const first = heard([block(0), text(0, 0, "Hello")]);
  const next = heard([block(0, "Text", "msg_second")], "turn-1", first);
  assert.deepEqual(next, {
    turn: "turn-1",
    message: "msg_second",
    blocks: [{ index: 0, kind: "Text", text: "", gapped: false }],
  });
  const turned = heard([text(0, 5, " there")], "turn-2", first);
  assert.deepEqual(turned, {
    turn: "turn-2",
    message,
    blocks: [{ index: 0, kind: "Text", text: "", gapped: true }],
  });
});

test("the end of the turn held leaves nothing, and the end of another turn changes nothing", () => {
  const held = heard([block(0), text(0, 0, "Hello")]);
  assert.deepEqual(heard([{ live: "End" }], "turn-1", held), threadLiveNothing);
  assert.deepEqual(heard([{ live: "End" }], "turn-0", held), held);
});

test("whatever is held after any events is a snapshot the stream can carry", () => {
  const held = heard([
    block(0, "Thinking"),
    block(1),
    text(1, 0, "Hello"),
    text(3, 0, "lost"),
  ]);
  assert.deepEqual(threadLiveHeldSchema.parse(held), held);
  assert.deepEqual(
    parseThreadLiveEvent({
      event: "snapshot",
      data: { version: threadLiveVersion, held },
    }),
    { event: "snapshot", data: { version: threadLiveVersion, held } },
  );
});

test("a frame naming an unknown event, or carrying a body its event does not have, is refused", () => {
  assert.throws(() =>
    parseThreadLiveEvent({ event: "ready", data: { version: 1 } }),
  );
  assert.throws(() =>
    parseThreadLiveEvent({
      event: "live",
      data: { version: threadLiveVersion, event: { live: "End" } },
    }),
  );
  assert.deepEqual(
    parseThreadLiveEvent({
      event: "live",
      data: { version: threadLiveVersion, turn: "t", event: { live: "End" } },
    }).event,
    "live",
  );
});
