/**
 * The implemented bundle's membership, held against `model/domain.qnt` at run
 * time.
 *
 * WHAT IT CATCHES IS SILENCE. An invariant added to the model with no
 * counterpart here would otherwise cost nothing: every existing check would
 * stay green, the replay would stay green, and this tree would quietly be
 * proving less than the specification does. Reading the model's own bundle is
 * what turns that into a failure, and it is the mechanism `test/golden/corpus.ts`
 * already uses for the label and exemption-arm rosters.
 *
 * THE WITNESSES ARE CHECKED OUT rather than in. The model expects them
 * violated, so one folded into the bundle would make a run report a failure
 * that is the machine working — which is why they carry a type that does not
 * fit and a name this roster refuses.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  allInvariants,
  failedInvariants,
  invariantBundle,
  invariantLeaves,
  measureDescends,
  measureNonNegative,
  stepDescends,
} from "../../src/domain/invariants.ts";
import { witnesses } from "../../src/domain/witnesses.ts";
import { budgetedInstance } from "./configs.ts";
import { declaredBundle, declaredLeaves } from "./declared.ts";
import { fleetBut, healthyFleet, initialView } from "./fixtures.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const config = budgetedInstance;
const fleet = healthyFleet(config);
const healthy = initialView(fleetBut(fleet, 0, {}));

const bundleNames = invariantBundle.map((member) => member.invariant);
const leafNames = invariantLeaves.map((member) => member.invariant);
const sorted = (names: readonly string[]): readonly string[] =>
  [...names].sort();

test("the bundle's membership is the model's, read out of the model", () => {
  assert.deepEqual(
    sorted(bundleNames),
    sorted(declaredBundle(ROOT)),
    "the implemented bundle and model/domain.qnt's allInvariants name different things",
  );
  assert.deepEqual(
    bundleNames,
    [...declaredBundle(ROOT)],
    "the implemented bundle carries the model's members in another order",
  );
});

test("the leaf roster is the model's bundle with every named conjunction expanded", () => {
  assert.deepEqual(
    sorted(leafNames),
    sorted(declaredLeaves(ROOT)),
    "the implemented leaves and the model's expanded bundle name different things",
  );
  assert.deepEqual(leafNames, [...declaredLeaves(ROOT)]);
  assert.ok(
    leafNames.length > bundleNames.length,
    "a conjunct of the model's bundle is itself a conjunction, so the leaves outnumber it",
  );
});

test("the reader is reading the model rather than agreeing with itself", () => {
  const declared = declaredBundle(ROOT);
  assert.ok(
    declared.includes("completionExclusive"),
    "the bundle roster did not parse",
  );
  assert.ok(
    declared.includes("measureDescends"),
    "the conjunct that is itself a bundle did not parse",
  );
  assert.ok(
    !declared.includes("measureNonNegative"),
    "the model's bundle names the conjunction, not its halves",
  );
  assert.ok(
    declaredLeaves(ROOT).includes("measureNonNegative"),
    "the expansion did not reach the halves",
  );
});

test("no anti-vacuity witness is in either roster", () => {
  for (const { witness } of witnesses) {
    assert.ok(
      !bundleNames.includes(witness) && !leafNames.includes(witness),
      `${witness} is a claim the model expects violated and has been folded into the bundle`,
    );
    assert.ok(
      !declaredBundle(ROOT).includes(witness),
      `${witness} is in the model's own bundle, which would refute this whole arrangement`,
    );
  }
});

test("the two rosters agree, because the conjunction is its halves", () => {
  const views = [
    healthy,
    initialView(fleetBut(fleet, 1, { gasLeft: -1 })),
    { ...healthy, rec: { ...healthy.rec, label: "dispatch" } },
  ];
  for (const view of views) {
    assert.equal(
      measureDescends(config, view),
      measureNonNegative(config, view) && stepDescends(config, view),
    );
    assert.equal(
      allInvariants(config, view),
      failedInvariants(config, view).length === 0,
    );
  }
});

test("the bundle is green on a fleet in mid-flight, so no red below is a leaf that always fails", () => {
  assert.deepEqual(failedInvariants(config, healthy), []);
  assert.ok(allInvariants(config, healthy));
});

test("a failure names the members that failed rather than collapsing to one answer", () => {
  const broke = initialView(
    fleetBut(fleet, 0, { artifact: { artifact: "ANone" } }),
  );
  assert.deepEqual(failedInvariants(config, broke), ["artifactWellFormed"]);
  assert.ok(!allInvariants(config, broke));
});
