import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  transcriptEntryPreviewCharsMax,
  transcriptPageAnswer,
} from "./transcriptPage.mjs";

const bytesMax = 4_096;
const fits = (text) => Buffer.byteLength(text) <= bytesMax;

/** One page as the route answers it: entries of one store batch, and the next batch. */
function pageOf(entries, nextAfter) {
  return {
    stream: "s-1",
    entries,
    held: ["u-1", "u-2"],
    elided: 0,
    truncated: false,
    ...(nextAfter === undefined ? {} : { nextAfter }),
  };
}

function entryOf(index, bytes) {
  return {
    uuid: `u-${String(index)}`,
    type: "assistant",
    timestamp: "2026-09-04T12:00:00.000Z",
    message: { role: "assistant", content: "x".repeat(bytes) },
  };
}

/** The whole of one store batch, read the way a caller reads it: page after page. */
function walked(page, pagesMax = 64) {
  const read = [];
  const previews = [];
  let cursor = { after: 0, entry: 0 };
  for (let taken = 0; taken < pagesMax; taken += 1) {
    const text = transcriptPageAnswer(page, cursor, fits);
    assert.ok(fits(text), `page ${String(taken)} is over the bound`);
    const answer = JSON.parse(text);
    for (const entry of answer.entries)
      if (entry.preview === undefined) read.push(entry);
      else previews.push(entry);
    if (answer.next === undefined) return { read, previews, pages: taken + 1 };
    cursor = answer.next;
  }
  assert.fail("the walk did not terminate");
}

test("one batch larger than an answer is read whole, page by page, under the bound", () => {
  const entries = Array.from({ length: 89 }, (_, index) => entryOf(index, 700));

  const { read, pages } = walked(pageOf(entries));

  assert.ok(pages > 1, "a batch over the bound was answered in one page");
  assert.deepEqual(
    read.map(({ uuid }) => uuid),
    entries.map(({ uuid }) => uuid),
  );
});

test("a page that fits whole names no next and ends the walk", () => {
  const { read, pages } = walked(pageOf([entryOf(1, 8), entryOf(2, 8)]));

  assert.equal(pages, 1);
  assert.equal(read.length, 2);
});

test("the cursor moves to the route's next batch once a page is exhausted", () => {
  const answer = JSON.parse(
    transcriptPageAnswer(pageOf([entryOf(1, 8)], 12), { after: 4 }, fits),
  );

  assert.deepEqual(answer.next, { after: 12, entry: 0 });
});

test("an entry larger than any answer is given as a marked preview and the walk goes on", () => {
  const entries = [entryOf(1, 40), entryOf(2, bytesMax * 2), entryOf(3, 40)];

  const { read, previews, pages } = walked(pageOf(entries));

  assert.equal(pages, 3);
  assert.deepEqual(
    read.map(({ uuid }) => uuid),
    ["u-1", "u-3"],
  );
  assert.equal(previews.length, 1);
  assert.equal(previews[0].uuid, "u-2");
  assert.equal(previews[0].type, "assistant");
  assert.ok(previews[0].bytes > bytesMax);
  assert.ok(previews[0].preview.length <= transcriptEntryPreviewCharsMax);
  assert.ok(
    previews[0].preview.startsWith('{"uuid":"u-2"'),
    "the preview is not the head of the entry",
  );
});

test("the page's own facts are carried and the held set is not", () => {
  const answer = JSON.parse(
    transcriptPageAnswer(pageOf([entryOf(1, 8)]), { after: 0 }, fits),
  );

  assert.equal(answer.stream, "s-1");
  assert.equal(answer.elided, 0);
  assert.equal(answer.truncated, false);
  assert.equal(answer.held, undefined);
});

test("a cursor past the page's entries answers none and does not name itself again", () => {
  const answer = JSON.parse(
    transcriptPageAnswer(pageOf([entryOf(1, 8)]), { after: 0, entry: 9 }, fits),
  );

  assert.deepEqual(answer.entries, []);
  assert.equal(answer.next, undefined);
});
