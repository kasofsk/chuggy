/**
 * The one function that applies a ticket's overrides to the configuration it
 * names: a field the override names replaces the configuration's whole, and a
 * field it does not name is the configuration's, down to a catalog workload's.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { configurationPromptTextSchema } from "../../src/contract/configurationDocument.ts";
import {
  configurationOverridesSchema,
  configurationWithOverrides,
} from "../../src/contract/configurationOverrides.ts";
import {
  configurationCanonicalCharsMax,
  configurationPromptTextCharsMax,
} from "../../src/contract/http.ts";

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

test("a Codex mode override may name an effort Codex names, and one naming none parses as written", () => {
  const codex = {
    type: "SingleAgent",
    agent: "Codex",
    arguments: [],
    model: "gpt-5",
  } as const;
  for (const mode of [codex, { ...codex, effort: "high" }])
    assert.deepEqual(configurationOverridesSchema.parse({ worker: { mode } }), {
      worker: { mode },
    });
  assert.ok(
    !configurationOverridesSchema.safeParse({
      worker: { mode: { ...codex, effort: "turbo" } },
    }).success,
  );
  assert.ok(
    !configurationOverridesSchema.safeParse({
      worker: {
        mode: {
          type: "SingleAgent",
          agent: "Claude",
          arguments: [],
          effort: "high",
        },
      },
    }).success,
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

const catalog = {
  version: 2,
  workloads: {
    build: {
      runner: "Agent",
      image: "worker:v1",
      prompt: { path: "prompts/build.md", text: "Build it." },
      practices: ["RegressionCoverage"],
    },
    review: {
      runner: "Agent",
      executionRequirement: { mode: "Container", image: "worker:v1" },
      prompt: { path: "prompts/review.md", text: "Review it." },
    },
  },
};

test("a catalog workload's named field replaces its whole, and its other workloads are the catalog's", () => {
  const effective = configurationWithOverrides(catalog, {
    workloads: { build: { practices: [] } },
  }) as typeof catalog;
  assert.deepEqual(effective.workloads.build, {
    ...catalog.workloads.build,
    practices: [],
  });
  assert.equal(effective.workloads.review, catalog.workloads.review);
});

test("a workload's image and execution requirement are one placement, and naming either drops the other", () => {
  const effective = configurationWithOverrides(catalog, {
    workloads: { review: { image: "worker:v2" } },
  }) as { workloads: Record<string, Record<string, unknown>> };
  assert.equal(effective.workloads["review"]?.["image"], "worker:v2");
  assert.equal(
    "executionRequirement" in (effective.workloads["review"] ?? {}),
    false,
  );
});

test("naming another runner keeps none of the workload's fields, and naming its own runner keeps them all", () => {
  const effective = configurationWithOverrides(catalog, {
    workloads: {
      build: { runner: "Commands", commands: ["npm test"] },
      review: { runner: "Agent" },
    },
  }) as typeof catalog;
  assert.deepEqual(effective.workloads.build, {
    runner: "Commands",
    commands: ["npm test"],
  });
  assert.deepEqual(effective.workloads.review, catalog.workloads.review);
});

test("a prompt named by path is the text the catalog's import stored beside it", () => {
  const effective = configurationWithOverrides(catalog, {
    workloads: { build: { prompt: { path: "prompts/review.md" } } },
  }) as typeof catalog;
  assert.deepEqual(effective.workloads.build.prompt, {
    path: "prompts/review.md",
    text: "Review it.",
  });
});

test("a workload the catalog does not hold is left for its reader to refuse, not added", () => {
  const effective = configurationWithOverrides(catalog, {
    workloads: { absent: { practices: [] } },
  }) as { workloads: Record<string, unknown> };
  assert.deepEqual(Object.keys(effective.workloads), ["build", "review"]);
});

test("a workload override naming a field no workload has is refused by the schema", () => {
  assert.equal(
    configurationOverridesSchema.safeParse({
      workloads: { build: { colour: "blue" } },
    }).success,
    false,
  );
});

/**
 * A prompt override is text a ticket carries rather than a file an import
 * read, so no file's cap reaches it, and a configuration may now be longer
 * than one prompt may.
 */
test("a prompt override longer than one prompt may be is refused, at any length a configuration may be", () => {
  const over = "p".repeat(configurationPromptTextCharsMax + 1);
  assert.ok(over.length < configurationCanonicalCharsMax);
  assert.equal(configurationPromptTextSchema.safeParse(over).success, false);
  assert.equal(
    configurationPromptTextSchema.safeParse(over.slice(1)).success,
    true,
  );
  assert.equal(
    configurationOverridesSchema.safeParse({
      workloads: { build: { prompt: { text: over } } },
    }).success,
    false,
  );
  assert.equal(
    configurationOverridesSchema.safeParse({
      workloads: { build: { prompt: { text: over.slice(1) } } },
    }).success,
    true,
  );
});
