import assert from "node:assert/strict";
import test from "node:test";

import {
  leadResponseSchema,
  projectRepositoryBoundSchema,
  projectRepositoryCreatedSchema,
} from "../../src/contract/responses.ts";

test("the interactive lead response carries only session standing", () => {
  assert.deepEqual(
    leadResponseSchema.parse({
      session: "lead-1",
      state: "Open",
      turns: [],
      streams: [],
    }),
    { session: "lead-1", state: "Open", turns: [], streams: [] },
  );
});

test("repository onboarding responses carry no legacy configuration result", () => {
  const bound = projectRepositoryBoundSchema.parse({
    repository: "forge/repository",
    landing: { mode: "Push" },
  });
  assert.equal("configurations" in bound, false);

  const created = projectRepositoryCreatedSchema.parse({
    repository: "forge/repository",
    landing: { mode: "Push" },
    created: {
      account: "account",
      name: "repository",
      url: "https://forge.invalid/account/repository",
    },
    seeded: false,
    ruleset: { result: "Skipped" },
  });
  assert.equal("configurations" in created, false);
});
