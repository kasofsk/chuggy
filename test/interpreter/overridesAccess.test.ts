/**
 * Who may make a ticket run other than its checked-in configuration: an
 * administrator to set overrides, anyone who may revise a draft to keep or
 * drop the ones it holds.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { DraftResource } from "../../src/interpreter/authoring.ts";
import {
  overridesAccess,
  overridesRevisionAccess,
} from "../../src/interpreter/overridesAccess.ts";

const overrides = { workloads: { build: { practices: [] } } };
const stored = { authoringVersion: 3, overrides } as unknown as DraftResource;

test("naming overrides asks for an administrator, and naming none or an empty set does not", () => {
  assert.equal(overridesAccess(overrides), "Administer");
  assert.equal(overridesAccess(undefined), "Mutate");
  assert.equal(overridesAccess({}), "Mutate");
});

test("a revision keeping the overrides the draft it is fenced on holds, or dropping them, asks for no administrator", () => {
  assert.equal(
    overridesRevisionAccess(stored, {
      expectedVersion: 3,
      overrides: { workloads: { build: { practices: [] } } },
    }),
    "Mutate",
  );
  assert.equal(
    overridesRevisionAccess(stored, { expectedVersion: 3 }),
    "Mutate",
  );
});

test("a revision changing the overrides, or fenced on another version than the one read, asks for an administrator", () => {
  assert.equal(
    overridesRevisionAccess(stored, {
      expectedVersion: 3,
      overrides: {
        workloads: { build: { practices: ["RegressionCoverage"] } },
      },
    }),
    "Administer",
  );
  assert.equal(
    overridesRevisionAccess(stored, { expectedVersion: 2, overrides }),
    "Administer",
  );
  assert.equal(
    overridesRevisionAccess(undefined, { expectedVersion: 3, overrides }),
    "Administer",
  );
});
