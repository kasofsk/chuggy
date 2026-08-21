/**
 * The scheduler vocabulary's own refusals: the bounds a configuration must
 * satisfy before a pass runs on it, and the account lookup that has no answer
 * for an account the current policy revision does not cover.
 *
 * `./capacity.test.ts` holds the arithmetic to `model/capacity.qnt`. What is
 * left here is what the model has no opinion about, which is every operational
 * bound a deployment chooses.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedExecutionSchedulerConfig,
  executionCapacitySafe,
  executionEntitlementOf,
  executionMayAdmit,
  executionReservationDeficit,
  executionSchedulerDefaults,
  type CapacityExecution,
  type Entitlement,
  type ExecutionSchedulerConfig,
} from "../../src/interpreter/executionScheduler.ts";

/** Every bound a deployment names, read from the defaults so a field added later is covered. */
const bounds = Object.keys(
  executionSchedulerDefaults,
) as readonly (keyof ExecutionSchedulerConfig)[];

/** The defaults with one bound replaced, which is how a case varies one thing. */
function configWith(
  name: keyof ExecutionSchedulerConfig,
  value: number,
): ExecutionSchedulerConfig {
  return { ...executionSchedulerDefaults, [name]: value };
}

const entitlements: ReadonlyMap<string, Entitlement> = new Map([
  ["known", { reserved: 1, maximum: 2 }],
]);

/** One registration drawing on the named account. */
function registration(account: string): CapacityExecution {
  return {
    project: "project",
    ticket: 1,
    task: 1,
    account,
    sourceSeq: 1,
    sourceEffect: 0,
    status: "Queued",
  };
}

test("the defaults are a configuration a pass may run on", () => {
  assert.equal(
    checkedExecutionSchedulerConfig(executionSchedulerDefaults),
    executionSchedulerDefaults,
  );
  assert.ok(
    bounds.length > 0,
    "the defaults name no bound, so this proves nothing",
  );
});

test("no bound may be zero, negative or fractional", () => {
  for (const name of bounds) {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => checkedExecutionSchedulerConfig(configWith(name, value)),
        (error: unknown) => {
          assert.ok(error instanceof RangeError);
          assert.match(error.message, new RegExp(`\\b${name}\\b`, "u"));
          return true;
        },
        `${name} accepted ${String(value)}`,
      );
    }
  }
});

test("a bound past the safe integers is refused rather than silently rounded", () => {
  assert.throws(
    () =>
      checkedExecutionSchedulerConfig(
        configWith("attemptLeaseSecs", Number.MAX_SAFE_INTEGER + 2),
      ),
    RangeError,
  );
});

test("an account the policy revision does not cover has no entitlement to assume", () => {
  assert.deepEqual(executionEntitlementOf(entitlements, "known"), {
    reserved: 1,
    maximum: 2,
  });
  assert.throws(
    () => executionEntitlementOf(entitlements, "absent"),
    /account absent has no entitlement in the current policy revision/u,
  );
});

test("every arithmetic that reads an entitlement refuses an uncovered account", () => {
  const ledger = [registration("absent")];
  assert.throws(
    () => executionReservationDeficit(entitlements, ledger, "absent"),
    /no entitlement/u,
  );
  assert.throws(
    () => executionMayAdmit(4, entitlements, ledger, registration("absent")),
    /no entitlement/u,
  );
  assert.throws(
    () => executionCapacitySafe(4, entitlements, ledger),
    /no entitlement/u,
  );
});
