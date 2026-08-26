/**
 * The remembered project, and why it is never an authority.
 *
 * A partition the inventory no longer carries has to fall back to a real one,
 * because a route built from it is a route the API refuses.
 */

import { expect, test } from "vitest";

import {
  lastProjectKey,
  lastProjectOrFirst,
  lastProjectRead,
  lastProjectWrite,
} from "../app/core/lastProject.ts";
import type { KeyValuePort } from "../app/core/sessionHolder.ts";

function store(seed?: string): KeyValuePort {
  const held = new Map<string, string>();
  if (seed !== undefined) held.set(lastProjectKey, seed);
  return {
    read: (key) => held.get(key) ?? null,
    write: (key, value) => {
      held.set(key, value);
    },
    remove: (key) => {
      held.delete(key);
    },
  };
}

const atlas = { tenant: "acme", project: "atlas" };
const beta = { tenant: "acme", project: "beta" };

test("what was written is what is read back", () => {
  const held = store();
  lastProjectWrite(held, atlas);
  expect(lastProjectRead(held)).toEqual(atlas);
});

test("a stored value that is not a partition is discarded quietly", () => {
  expect(lastProjectRead(store("not json"))).toBeUndefined();
  expect(lastProjectRead(store('{"tenant":"acme"}'))).toBeUndefined();
  expect(lastProjectRead(store())).toBeUndefined();
});

test("a remembered project the inventory still has is the one chosen", () => {
  expect(lastProjectOrFirst(beta, [atlas, beta])).toEqual(beta);
});

test("a remembered project the inventory has lost falls back to the first", () => {
  expect(lastProjectOrFirst(beta, [atlas])).toEqual(atlas);
  expect(lastProjectOrFirst(undefined, [atlas])).toEqual(atlas);
});

test("an inventory with nothing in it chooses nothing", () => {
  expect(lastProjectOrFirst(beta, [])).toBeUndefined();
});
