/**
 * The dispatch pick: first ticket id first, and a pick that is always one of
 * the candidates — the membership that makes any policy a refinement of the
 * model's unrestricted choice rather than a second decider.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { policyPick } from "../../src/runtime/policy.ts";
import { id } from "../domain/fixtures.ts";

test("the pick is the least ticket id, wherever it sits in the list", () => {
  assert.equal(policyPick([id(3), id(1), id(2)]), id(1));
  assert.equal(policyPick([id(2), id(3)]), id(2));
  assert.equal(policyPick([id(5)]), id(5));
});

test("the pick is a member of the candidates", () => {
  const candidates = [id(4), id(2), id(9)];
  const picked = policyPick(candidates);
  assert.ok(picked !== undefined && candidates.includes(picked));
});

test("no candidates is no pick", () => {
  assert.equal(policyPick([]), undefined);
});
