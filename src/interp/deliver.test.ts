import assert from "node:assert/strict";
import { test } from "node:test";

import { keyed } from "../effects/keyed.ts";
import { deliverOnce } from "./deliver.ts";

const record = (): {
  handle: (keyed: { seq: number; effect: string }) => string;
  seen: number[];
} => {
  const seen: number[] = [];
  return {
    seen,
    handle: (k) => {
      seen.push(k.seq);
      return k.effect.toUpperCase();
    },
  };
};

test("delivers every effect once, in issue order", () => {
  const { handle, seen } = record();
  const results = deliverOnce(
    [keyed(0, "a"), keyed(1, "b"), keyed(2, "c")],
    handle,
    8,
  );
  assert.deepEqual(seen, [0, 1, 2]);
  assert.deepEqual(results, ["A", "B", "C"]);
});

test("absorbs a redelivered sequence number", () => {
  const { handle, seen } = record();
  const results = deliverOnce(
    [keyed(0, "a"), keyed(1, "b"), keyed(0, "a"), keyed(1, "b")],
    handle,
    8,
  );
  assert.deepEqual(seen, [0, 1], "the handler must not see a redelivery");
  assert.deepEqual(results, ["A", "B"]);
});

test("refuses a fresh effect that arrives behind one already handled", () => {
  const { handle, seen } = record();
  assert.throws(() => deliverOnce([keyed(1, "b"), keyed(0, "a")], handle, 8), {
    name: "AssertionError",
    message: /effect 0 arrived behind 1/,
  });
  assert.deepEqual(seen, [1], "the out-of-order effect must not be handled");
});

test("refuses to exceed the stated bound", () => {
  const { handle, seen } = record();
  assert.throws(() => deliverOnce([keyed(0, "a"), keyed(1, "b")], handle, 1), {
    name: "AssertionError",
    message: /bound of 1 exceeded by 2 effects/,
  });
  assert.deepEqual(seen, [], "the bound is checked before anything is handled");
});

test("refuses a bound that is not a non-negative safe integer", () => {
  const { handle } = record();
  assert.throws(() => deliverOnce([], handle, -1), {
    message: /delivery bound must be a non-negative safe integer, got -1/,
  });
});

test("delivers nothing when there is nothing to deliver", () => {
  const { handle, seen } = record();
  assert.deepEqual(deliverOnce([], handle, 0), []);
  assert.deepEqual(seen, []);
});
