import assert from "node:assert/strict";
import { test } from "node:test";

import { nowMillis } from "./system-clock.ts";

// A fixed instant safely in the past: 2020-01-01T00:00:00Z. Anything the host
// clock returns is later, and the three ways this function could be wrong —
// seconds instead of milliseconds, a zero, a NaN — are all below it.
const YEAR_2020_MILLIS = 1_577_836_800_000;

test("nowMillis reads the host clock in milliseconds since the epoch", () => {
  const reading = nowMillis();
  assert.ok(
    Number.isSafeInteger(reading),
    `expected a safe integer, got ${String(reading)}`,
  );
  assert.ok(
    reading > YEAR_2020_MILLIS,
    `expected milliseconds since the epoch, got ${String(reading)}`,
  );
});

test("nowMillis does not go backwards between two reads", () => {
  const first = nowMillis();
  const second = nowMillis();
  assert.ok(second >= first, `${String(second)} preceded ${String(first)}`);
});
