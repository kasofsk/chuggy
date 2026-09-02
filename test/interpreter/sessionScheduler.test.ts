/**
 * The configuration refusals, which are the only decisions this module makes.
 * Every other export of it is a shape, and a shape is checked by the compiler.
 *
 * THE BOUNDS ARE DRIVEN FROM THE DEFAULTS rather than listed here, so a bound
 * added to the interface without a refusal is a red case rather than a silent
 * gap in one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allSessionAttemptEvidences,
  checkedSessionSchedulerConfig,
  sessionSchedulerDefaults,
  type SessionSchedulerConfig,
} from "../../src/interpreter/sessionScheduler.ts";
import { populated } from "./roster.ts";

const bounds = Object.keys(
  sessionSchedulerDefaults,
) as readonly (keyof SessionSchedulerConfig)[];

test("the defaults are a configuration this installation accepts", () => {
  assert.deepEqual(
    checkedSessionSchedulerConfig(sessionSchedulerDefaults),
    sessionSchedulerDefaults,
  );
});

test("every bound is refused a value that is not a positive safe integer", () => {
  for (const name of populated(bounds, "the session scheduler bounds")) {
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      assert.throws(
        () =>
          checkedSessionSchedulerConfig({
            ...sessionSchedulerDefaults,
            [name]: value,
          }),
        (error: unknown) => {
          assert.ok(error instanceof RangeError);
          assert.match(error.message, new RegExp(`\\b${name}\\b`, "u"));
          return true;
        },
        `${name} is refused ${String(value)}`,
      );
    }
  }
});

test("a per-account ceiling above the installation's own never binds and is refused", () => {
  assert.throws(
    () =>
      checkedSessionSchedulerConfig({
        ...sessionSchedulerDefaults,
        attemptsPerAccountMax: sessionSchedulerDefaults.attemptsMax + 1,
      }),
    /attemptsPerAccountMax/u,
  );
  const atTheCeiling = {
    ...sessionSchedulerDefaults,
    attemptsPerAccountMax: sessionSchedulerDefaults.attemptsMax,
  };
  assert.deepEqual(checkedSessionSchedulerConfig(atTheCeiling), atTheCeiling);
});

test("the evidence roster is its own, and holds no member twice", () => {
  const evidences = populated(
    allSessionAttemptEvidences,
    "the session attempt evidences",
  );
  assert.equal(new Set(evidences).size, evidences.length);
  assert.deepEqual(allSessionAttemptEvidences, [
    "PolicyDenied",
    "PolicyUnavailable",
    "PlacementDenied",
    "PlacementUnavailable",
    "Evicted",
    "Vanished",
    "LeaseExpired",
    "Fenced",
    "SessionIdle",
    "SessionClosed",
    "TurnFailed",
    "StoreRefused",
  ]);
});
