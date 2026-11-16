/**
 * The lead read's handoff-note preview.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { selectorHandoffNotePreviewCharsMax } from "../../src/contract/http.ts";
import { handoffNotePreview } from "../../src/interpreter/leadRead.ts";

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

test("a note's bound counts code points, matching the schema in front of it", () => {
  const atBound = "😀".repeat(selectorHandoffNotePreviewCharsMax - 2);
  const whole = handoffNotePreview(atBound);
  const text = JSON.stringify(atBound);
  assert.equal(whole.truncated, false);
  assert.equal(whole.preview, text);
  const overBound = "😀".repeat(selectorHandoffNotePreviewCharsMax - 1);
  const cut = handoffNotePreview(overBound);
  assert.equal(cut.truncated, true);
  assert.equal([...cut.preview].length, selectorHandoffNotePreviewCharsMax);
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
