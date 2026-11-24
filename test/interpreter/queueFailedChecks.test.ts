/**
 * What one read's failed checks are kept as: deduplicated in the order found,
 * bounded in count and length, only briefing lines, and absent where none can
 * be kept.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  queueFailedCheckCharsMax,
  queueFailedChecksMax,
} from "../../src/contract/http.ts";
import { queueFailedChecksOf } from "../../src/interpreter/queueFailedChecks.ts";

test("names are kept deduplicated in the order found, cut only where the reader says it stopped", () => {
  for (const cut of [false, true])
    assert.deepEqual(queueFailedChecksOf(["e2e", "check", "e2e"], cut), {
      names: ["e2e", "check"],
      truncated: cut,
    });
});

test("no name found, or none that can be kept, keeps nothing", () => {
  assert.equal(queueFailedChecksOf([], false), undefined);
  assert.equal(queueFailedChecksOf([], true), undefined);
  assert.equal(queueFailedChecksOf(["", "a\nb"], false), undefined);
});

test("a name that is not a briefing line or is past its bound is left out as a cut", () => {
  const longest = "x".repeat(queueFailedCheckCharsMax);
  for (const refused of [
    "",
    "two\nlines",
    "tab\there",
    "\u0007",
    `${longest}x`,
  ])
    assert.deepEqual(
      queueFailedChecksOf(["check", refused], false),
      { names: ["check"], truncated: true },
      JSON.stringify(refused),
    );
  const astral = "\u{1F600}".repeat(queueFailedCheckCharsMax);
  assert.deepEqual(queueFailedChecksOf([astral], false), {
    names: [astral],
    truncated: false,
  });
  assert.deepEqual(queueFailedChecksOf([longest], false), {
    names: [longest],
    truncated: false,
  });
});

test("names past the count bound are cut, the first kept", () => {
  const found = Array.from(
    { length: queueFailedChecksMax + 1 },
    (_none, at) => `check ${String(at)}`,
  );
  assert.deepEqual(queueFailedChecksOf(found, false), {
    names: found.slice(0, queueFailedChecksMax),
    truncated: true,
  });
  assert.deepEqual(
    queueFailedChecksOf(found.slice(0, queueFailedChecksMax), false),
    {
      names: found.slice(0, queueFailedChecksMax),
      truncated: false,
    },
  );
});
