/**
 * The guarded evaluation is the same bundle, and it survives the state that
 * takes the unguarded one down.
 *
 * BOTH HALVES ARE NEEDED. Agreeing with `failedInvariants` wherever nothing
 * throws is what says this is the model's bundle and not a second opinion of
 * it; naming the leaf that threw is what it was written for. Every member of
 * today's bundle answers on the malformed state below, so the refusal is
 * demonstrated against a partial leaf handed to the evaluation directly — a
 * guard nobody has seen catch anything is the unverified control this repo
 * refuses.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ticketAt } from "../../src/domain/ticketGraph.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import {
  failedInvariants,
  invariantBundle,
  type NamedInvariant,
} from "../../src/domain/invariants.ts";
import { modelInstance } from "../domain/configs.ts";
import {
  graphOf,
  depsOf,
  fleetBut,
  healthyFleet,
  id,
  initialView,
  ticketOn,
} from "../domain/fixtures.ts";
import { bundleHolds, evaluateBundle } from "./evaluate.ts";

const config = modelInstance;
const fleet = healthyFleet(config);
const healthy = initialView(fleetBut(fleet, 0, {}));

/** A ticket whose dependency is not in the map, which is where a derived walk falls over. */
const dangling = initialView(graphOf([ticketOn(config, { deps: depsOf(9) })]));

test("a healthy state answers every leaf, and answers each of them yes", () => {
  const verdict = evaluateBundle(config, healthy);
  assert.deepEqual(verdict.failed, []);
  assert.deepEqual(verdict.refused, []);
  assert.ok(bundleHolds(verdict));
});

test("where nothing throws, the guarded evaluation is the bundle itself", () => {
  const broke = initialView(fleetBut(fleet, 0, { artifact: "NoArtifact" }));
  assert.ok(
    failedInvariants(config, broke).length > 0,
    "the broken view answers every leaf yes, so the two evaluations agree vacuously",
  );
  for (const view of [healthy, broke]) {
    assert.deepEqual(evaluateBundle(config, view).failed, [
      ...failedInvariants(config, view),
    ]);
  }
});

test("a malformed state fails the leaf that names it, and answers every other", () => {
  const verdict = evaluateBundle(config, dangling);
  assert.deepEqual(verdict.failed, ["depsAcyclic"]);
  assert.deepEqual(
    verdict.refused,
    [],
    "every member of today's bundle is total on this state",
  );
  assert.ok(!bundleHolds(verdict));
});

test("a leaf that cannot be asked is named rather than taking the run down", () => {
  const partial: NamedInvariant = {
    invariant: "readsADanglingDep",
    holds: (_config, view) =>
      [...ticketAt(view.post, id(1)).deps].every(
        (d) => ticketAt(view.post, d as TicketId).phase !== "Revoked",
      ),
  };
  assert.throws(() => partial.holds(config, dangling), /no ticket 9/);
  const verdict = evaluateBundle(config, dangling, [
    ...invariantBundle,
    partial,
  ]);
  assert.deepEqual(verdict.failed, ["depsAcyclic"]);
  assert.deepEqual(verdict.refused, [
    "readsADanglingDep (graph: no ticket 9; a decider was called on a state that refuses it)",
  ]);
  assert.ok(!bundleHolds(verdict), "a refusal is a finding, not a pass");
});
