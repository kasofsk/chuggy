/**
 * The finalizer's row vocabulary, which is where a column the server typed as
 * nullable stops being one: the bound check, the presence refusal and the
 * closed-set narrowing.
 *
 * A REFUSAL IS THE WHOLE POINT OF THESE, so each case drives the raising branch
 * rather than the one that returns. `finalizerRowPresent` exists because
 * `projectRowCounter` would read `null` as a valid zero and carry it into a
 * fence, so a test that only proved the pass-through would prove the half that
 * cannot go wrong.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  finalizerBounded,
  finalizerRowPresent,
  finalizerRowValue,
} from "../../src/adapters/postgres/finalizerRows.ts";

test("a present column is handed back as itself", () => {
  assert.equal(finalizerRowPresent("42", "claim generation"), "42");
  assert.equal(finalizerRowPresent(0, "attempts made"), 0);
  assert.equal(finalizerRowPresent(false, "approval required"), false);
});

test("a null column raises and names the column", () => {
  assert.throws(
    () => finalizerRowPresent(null, "claim generation"),
    /claim generation/,
  );
});

test("a bound no work can be drawn under is refused", () => {
  assert.throws(() => {
    finalizerBounded(0, "requestsMax");
  }, RangeError);
  assert.throws(() => {
    finalizerBounded(-1, "requestsMax");
  }, RangeError);
  assert.throws(() => {
    finalizerBounded(1.5, "requestsMax");
  }, RangeError);
  assert.doesNotThrow(() => {
    finalizerBounded(1, "requestsMax");
  });
});

test("a value outside the closed set the port declares is refused", () => {
  const admitted = ["Open", "Registered"] as const;
  assert.equal(finalizerRowValue(admitted, "Open", "request state"), "Open");
  assert.throws(
    () => finalizerRowValue(admitted, "Fulfilled", "request state"),
    /request state/,
  );
});
