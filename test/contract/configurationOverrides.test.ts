/**
 * The one function that applies a ticket's overrides to the configuration it
 * names: a field the override names replaces the configuration's whole, and a
 * field it does not name is the configuration's.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { configurationWithOverrides } from "../../src/contract/configurationOverrides.ts";

const pinned = {
  version: 1,
  image: "worker:v1",
  authority: { network: false },
  brief: {
    motivation: ["It matters."],
    acceptanceCriteria: ["It works."],
    constraints: ["Keep it small."],
  },
  practices: ["RegressionCoverage"],
  work: { instructions: ["Do the work."], authority: { tools: ["Edit"] } },
  review: { instructions: ["Review."] },
  worker: {
    mode: { type: "SingleAgent", agent: "Claude", arguments: ["--one"] },
    setup: ["npm ci"],
    files: [],
  },
};

test("no overrides is the configuration itself", () => {
  assert.equal(configurationWithOverrides(pinned, undefined), pinned);
  assert.deepEqual(configurationWithOverrides(pinned, {}), pinned);
});

test("a named field replaces the configuration's whole and leaves its siblings", () => {
  assert.deepEqual(
    configurationWithOverrides(pinned, {
      worker: {
        mode: { type: "SingleAgent", agent: "Claude", arguments: ["--two"] },
      },
      brief: { constraints: [] },
      work: { instructions: ["Do other work."] },
      practices: [],
    }),
    {
      ...pinned,
      brief: { ...pinned.brief, constraints: [] },
      practices: [],
      work: {
        instructions: ["Do other work."],
        authority: { tools: ["Edit"] },
      },
      worker: {
        ...pinned.worker,
        mode: { type: "SingleAgent", agent: "Claude", arguments: ["--two"] },
      },
    },
  );
});

test("the pinned document is not changed by applying an override to it", () => {
  const before = structuredClone(pinned);
  configurationWithOverrides(pinned, { work: { instructions: [] } });
  assert.deepEqual(pinned, before);
});

test("a document that is not an object is answered as it stands, for its reader to refuse", () => {
  for (const document of [null, [], "configuration"])
    assert.equal(
      configurationWithOverrides(document, { practices: [] }),
      document,
    );
});
