/**
 * The implemented bundle's membership, held against `model/domain.qnt` at run
 * time.
 *
 * WHAT IT CATCHES IS SILENCE. An invariant added to the model with no
 * counterpart here would otherwise cost nothing: every existing check would
 * stay green, the replay would stay green, and this tree would quietly be
 * proving less than the specification does. Reading the model's own bundle is
 * what turns that into a failure.
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
} from "../../src/domain/invariants.ts";
import { witnesses } from "../../src/domain/witnesses.ts";
import { modelInstance } from "./configs.ts";
import { declaredBundle } from "./declared.ts";
import { fleetBut, healthyFleet, initialView, type World } from "./fixtures.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const config = modelInstance;
const fleet = healthyFleet(config);

/** A view of one world, graph and ledgers as given. */
const worldView = (state: World) => initialView(state.graph, state.ledgers);

const healthy = worldView(fleetBut(fleet, 0, {}));

const bundleNames = invariantBundle.map((member) => member.invariant);
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

test("the reader is reading the model rather than agreeing with itself", () => {
  const declared = declaredBundle(ROOT);
  assert.ok(
    declared.includes("completionExclusive"),
    "the bundle roster did not parse",
  );
  assert.ok(
    declared.includes("stuckSubsetCovered"),
    "the bundle roster stopped short of its last member",
  );
});

test("no anti-vacuity witness is in the roster", () => {
  for (const { witness } of witnesses) {
    assert.ok(
      !bundleNames.includes(witness),
      `${witness} is a claim the model expects violated and has been folded into the bundle`,
    );
    assert.ok(
      !declaredBundle(ROOT).includes(witness),
      `${witness} is in the model's own bundle, which would refute this whole arrangement`,
    );
  }
});

test("the bundle's verdict is exactly an empty list of failures", () => {
  const views = [
    healthy,
    worldView(fleetBut(fleet, 1, {}, { spawned: 99 })),
    {
      ...healthy,
      pre: healthy.post,
      preLedgers: healthy.postLedgers,
    },
  ];
  for (const view of views) {
    assert.equal(
      allInvariants(config, view),
      failedInvariants(config, view).length === 0,
    );
  }
});

test("the bundle is green on a fleet in mid-flight, so no red below is a member that always fails", () => {
  assert.deepEqual(failedInvariants(config, healthy), []);
  assert.ok(allInvariants(config, healthy));
});

test("a failure names the members that failed rather than collapsing to one answer", () => {
  const broke = worldView(fleetBut(fleet, 0, {}, { closedEvaluations: [] }));
  assert.deepEqual(failedInvariants(config, broke), ["artifactWellFormed"]);
  assert.ok(!allInvariants(config, broke));
});
