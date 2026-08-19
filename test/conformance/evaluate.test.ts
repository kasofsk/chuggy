/**
 * The guarded evaluation is the same bundle, and it survives the state that
 * takes the unguarded one down.
 *
 * BOTH HALVES ARE NEEDED. Agreeing with `failedInvariants` wherever nothing
 * throws is what says this is the model's bundle and not a second opinion of
 * it; naming the leaf that threw on a state where `failedInvariants` cannot
 * return at all is what it was written for. A guard nobody has seen catch
 * anything is the unverified control this repo refuses.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { failedInvariants } from "../../src/domain/invariants.ts";
import { budgetedInstance } from "../domain/configs.ts";
import {
  coreOf,
  depsOf,
  fleetBut,
  healthyFleet,
  initialView,
  ticketOn,
} from "../domain/fixtures.ts";
import { bundleHolds, evaluateBundle } from "./evaluate.ts";

const config = budgetedInstance;
const fleet = healthyFleet(config);
const healthy = initialView(fleetBut(fleet, 0, {}));

/** A ticket whose dependency is not in the map, which is where a derived walk falls over. */
const dangling = initialView(
  coreOf([ticketOn(config, "ManagedFinalizer", { deps: depsOf(9) })]),
);

test("a healthy state answers every leaf, and answers each of them yes", () => {
  const verdict = evaluateBundle(config, healthy);
  assert.deepEqual(verdict.failed, []);
  assert.deepEqual(verdict.refused, []);
  assert.ok(bundleHolds(verdict));
});

test("where nothing throws, the guarded evaluation is the bundle itself", () => {
  const broke = initialView(fleetBut(fleet, 0, { artifact: "NoArtifact" }));
  /** An initial view exempts the descent leaf by label, so one view carries a step label instead. */
  const stepped = { ...healthy, rec: { ...healthy.rec, label: "dispatch" } };
  for (const view of [healthy, broke, stepped]) {
    assert.deepEqual(evaluateBundle(config, view).failed, [
      ...failedInvariants(config, view),
    ]);
  }
  assert.ok(
    evaluateBundle(config, stepped).failed.includes("stepDescends"),
    "the leaf that computes rather than exempting was not reached",
  );
});

test("a malformed state names the leaf that could not be asked", () => {
  assert.throws(
    () => failedInvariants(config, dangling),
    /no ticket 9/,
    "the unguarded bundle no longer throws here, so this guard has nothing to catch",
  );
  const verdict = evaluateBundle(config, dangling);
  assert.ok(
    verdict.failed.includes("depsAcyclic"),
    "the leaf that names the defect answered rather than being skipped",
  );
  assert.ok(
    verdict.refused.some((why) => why.startsWith("cascadeSafety")),
    "the leaf that walks the closure was not reported as refusing",
  );
  assert.ok(!bundleHolds(verdict), "a refusal is a finding, not a pass");
});
