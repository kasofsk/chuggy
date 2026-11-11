import assert from "node:assert/strict";
import test from "node:test";

import {
  unitOutcomesLogCharsMax,
  unitOutcomesRead,
  type UnitOutcome,
} from "./unit-outcomes.ts";

const suite = "test/suite.test.ts";

/** What the runner hands a reporter when `suite` prints `message`. */
function printed(message: string): Parameters<typeof unitOutcomesRead>[1] {
  return {
    type: "test:stdout",
    data: { file: suite, message },
  } as Parameters<typeof unitOutcomesRead>[1];
}

test("a log past twice the cap keeps its end, cut back to the cap", () => {
  const outcomes = new Map<string, UnitOutcome>();
  const chunk = "x".repeat(unitOutcomesLogCharsMax / 4);
  for (let index = 0; index < 8; index += 1) {
    unitOutcomesRead(outcomes, printed(chunk));
  }
  unitOutcomesRead(outcomes, printed("the end"));
  const log = outcomes.get(suite)?.log;
  assert.ok(log !== undefined);
  assert.ok(log.endsWith(`${chunk}the end`));
  assert.ok(log.length <= 2 * unitOutcomesLogCharsMax);
  assert.equal(log.length, unitOutcomesLogCharsMax);
});

test("a log within twice the cap is kept whole", () => {
  const outcomes = new Map<string, UnitOutcome>();
  const whole = "y".repeat(
    unitOutcomesLogCharsMax + unitOutcomesLogCharsMax / 2,
  );
  unitOutcomesRead(outcomes, printed(whole));
  assert.equal(outcomes.get(suite)?.log, whole);
});
