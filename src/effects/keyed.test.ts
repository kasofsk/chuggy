import assert from "node:assert/strict";
import { test } from "node:test";

import { keyed } from "./keyed.ts";

test("keyed pairs an effect with its journal sequence number", () => {
  assert.deepEqual(keyed(0, "open-gate"), { seq: 0, effect: "open-gate" });
});

test("keyed rejects a negative sequence number", () => {
  assert.throws(() => keyed(-1, "open-gate"), {
    name: "AssertionError",
    message: /non-negative safe integer, got -1$/,
  });
});

test("keyed rejects a fractional sequence number", () => {
  assert.throws(() => keyed(1.5, "open-gate"), {
    name: "AssertionError",
    message: /got 1\.5$/,
  });
});

test("keyed rejects a sequence number past the safe integer range", () => {
  assert.throws(() => keyed(Number.MAX_SAFE_INTEGER + 1, "open-gate"), {
    name: "AssertionError",
  });
});

test("keyed accepts the first sequence number a journal can hand out", () => {
  assert.equal(keyed(0, { kind: "complete" }).seq, 0);
});
