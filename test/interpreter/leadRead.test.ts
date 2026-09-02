/**
 * The lead read's two bounds and its handoff-note preview.
 *
 * The chain the page is built over is proved against a real store in
 * `test/interpreter/sessionTranscript.test.ts`; what is left here is what a
 * real store is too small to reach — a stream long enough to pass the entry
 * bound — so the entries below are synthetic and are only ever counted.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  selectorHandoffNotePreviewCharsMax,
  sessionStorePageBatchesMax,
  sessionTranscriptEntriesMax,
} from "../../src/contract/http.ts";
import {
  checkedLeadTranscriptQuery,
  handoffNotePreview,
  leadTranscriptPage,
} from "../../src/interpreter/leadRead.ts";
import { asSessionStoreStream } from "../../src/interpreter/agentSession.ts";
import type { SessionStoreRead } from "../../src/interpreter/sessionStore.ts";

const stream = asSessionStoreStream("stream");

/** A chain of `length` user entries, each naming the one before it. */
function chainText(length: number): string {
  return Array.from({ length }, (_unused, index) =>
    JSON.stringify({
      type: "user",
      uuid: `entry-${String(index)}`,
      ...(index === 0 ? {} : { parentUuid: `entry-${String(index - 1)}` }),
      message: { role: "user", content: "one" },
    }),
  ).join("\n");
}

function drawn(text: string): SessionStoreRead {
  return { read: "Content", content: text };
}

test("the handoff note crosses as its size and its leading characters", () => {
  const small = handoffNotePreview({ watching: "one" });
  assert.equal(small.truncated, false);
  assert.equal(small.preview, '{"watching":"one"}');
  assert.equal(small.bytes, small.preview.length);
  const large = handoffNotePreview({
    padding: "x".repeat(selectorHandoffNotePreviewCharsMax * 2),
  });
  assert.equal(large.truncated, true);
  assert.equal(large.preview.length, selectorHandoffNotePreviewCharsMax);
  assert.ok(large.bytes > selectorHandoffNotePreviewCharsMax);
});

test("a note the cut did not reach is whole, whatever it weighs in bytes", () => {
  const note = { watching: "依存関係がまだ失敗しています".repeat(110) };
  const whole = handoffNotePreview(note);
  const text = JSON.stringify(note);
  assert.ok(
    text.length < selectorHandoffNotePreviewCharsMax,
    "the note is shorter than the cut",
  );
  assert.ok(
    whole.bytes > selectorHandoffNotePreviewCharsMax,
    "and heavier than it in bytes, which is the case the flag must not confuse",
  );
  assert.equal(whole.preview, text);
  assert.equal(whole.truncated, false);
});

test("a transcript query outside its bounds is refused rather than clamped", () => {
  assert.deepEqual(
    checkedLeadTranscriptQuery({ after: 0, limit: sessionStorePageBatchesMax }),
    { after: 0, limit: sessionStorePageBatchesMax },
  );
  for (const limit of [0, -1, sessionStorePageBatchesMax + 1, 1.5])
    assert.throws(() => checkedLeadTranscriptQuery({ after: 0, limit }));
  for (const after of [-1, 2.5])
    assert.throws(() => checkedLeadTranscriptQuery({ after, limit: 1 }));
});

test("a page longer than the entry bound is cut and says so", () => {
  const held = new Set<string>();
  const page = leadTranscriptPage({
    stream,
    walk: { held },
    drawn: [drawn(chainText(sessionTranscriptEntriesMax + 4))],
  });
  assert.equal(page.entries.length, sessionTranscriptEntriesMax);
  assert.equal(page.truncated, true);
  const whole = leadTranscriptPage({
    stream,
    walk: { held },
    drawn: [drawn(chainText(sessionTranscriptEntriesMax))],
  });
  assert.equal(whole.entries.length, sessionTranscriptEntriesMax);
  assert.equal(whole.truncated, false);
});

test("a walk that could not decide what is held truncates the page", () => {
  const undecided = leadTranscriptPage({
    stream,
    drawn: [drawn(chainText(2))],
  });
  assert.equal(undecided.held, undefined);
  assert.equal(undecided.truncated, true);
  const decided = leadTranscriptPage({
    stream,
    walk: { held: new Set(["entry-1"]) },
    drawn: [drawn(chainText(2))],
  });
  assert.deepEqual(decided.held, ["entry-1"]);
  assert.equal(decided.truncated, false);
});

test("a page names the held entries it carries, and no others", () => {
  const page = leadTranscriptPage({
    stream,
    walk: { held: new Set(["entry-2", "elsewhere"]) },
    drawn: [drawn(chainText(3))],
  });
  assert.equal(page.compaction, undefined);
  assert.deepEqual(
    page.held,
    ["entry-2"],
    "held is the subset of this page's entries, never a uuid it did not send",
  );
  const dropped = leadTranscriptPage({
    stream,
    walk: { held: new Set(["elsewhere"]) },
    drawn: [drawn(chainText(3))],
  });
  assert.deepEqual(
    dropped.held,
    [],
    "a page the last cut dropped entirely holds none of its own entries",
  );
});

test("a batch nobody could draw is counted and the page still stands", () => {
  const page = leadTranscriptPage({
    stream,
    walk: { held: new Set(["entry-0", "entry-1"]) },
    drawn: [drawn(chainText(2)), { read: "Corrupt" }, { read: "NotFound" }],
    nextAfter: 3,
  });
  assert.equal(page.elided, 2);
  assert.equal(page.entries.length, 2);
  assert.equal(page.nextAfter, 3);
  assert.equal(page.compaction, undefined);
  assert.deepEqual(page.held, ["entry-0", "entry-1"]);
});
