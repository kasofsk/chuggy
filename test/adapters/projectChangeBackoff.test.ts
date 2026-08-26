/**
 * The wait a lost doorbell takes before trying again.
 *
 * THE ASSERTIONS ARE BOUNDS RATHER THAN VALUES, because the wait is drawn from
 * a range on purpose: a case that pinned one number would be asserting the
 * generator rather than the property, and the property is that no draw escapes
 * the range whatever the attempt count has reached.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectChangeBackoffMs,
  projectChangeDoorbellLimitsDefault,
  type ProjectChangeDoorbellLimits,
} from "../../src/adapters/postgres/projectChangeLog.ts";

const limits: ProjectChangeDoorbellLimits = {
  reconnectBaseMs: 250,
  reconnectMaxMs: 30_000,
};

/** Attempt counts a reconnecting listener passes through, and ones it never should. */
const attempts = [0, 1, 2, 4, 8, 16, 64, 1_024, 100_000];

test("no wait escapes the ceiling, however long the listener has been trying", () => {
  for (const attempt of attempts) {
    const waited = projectChangeBackoffMs(attempt, limits);
    assert.ok(
      Number.isSafeInteger(waited),
      `attempt ${String(attempt)} drew ${String(waited)}`,
    );
    assert.ok(waited >= 1, `attempt ${String(attempt)} drew ${String(waited)}`);
    assert.ok(
      waited <= limits.reconnectMaxMs,
      `attempt ${String(attempt)} drew ${String(waited)}`,
    );
  }
});

/** How many draws the floor is asserted over, so one lucky draw cannot pass it. */
const drawsPerCase = 200;

test("a wait is always a wait, however small the range it is drawn from", () => {
  const tight: ProjectChangeDoorbellLimits = {
    reconnectBaseMs: 1,
    reconnectMaxMs: 1,
  };
  for (let draw = 0; draw < drawsPerCase; draw += 1)
    assert.ok(projectChangeBackoffMs(0, tight) >= 1);
});

test("the wait grows with the attempt until the ceiling holds it", () => {
  const first = projectChangeBackoffMs(0, limits);
  const later = projectChangeBackoffMs(6, limits);
  assert.ok(first <= limits.reconnectBaseMs);
  assert.ok(later > limits.reconnectBaseMs);
});

test("the default limits are the ones the doorbell is built with", () => {
  assert.ok(projectChangeDoorbellLimitsDefault.reconnectBaseMs >= 1);
  assert.ok(
    projectChangeDoorbellLimitsDefault.reconnectMaxMs >=
      projectChangeDoorbellLimitsDefault.reconnectBaseMs,
  );
});
