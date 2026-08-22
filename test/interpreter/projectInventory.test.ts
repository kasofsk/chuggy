import assert from "node:assert/strict";
import { test } from "node:test";

import { authorizedProjectInventory } from "../../src/interpreter/projectInventory.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

test("authorized inventory bounds hidden-project scanning and returns progress", async () => {
  const tenant = asTenantId("tenant");
  const projects = Array.from({ length: 10 }, (_unused, index) => ({
    tenant,
    project: asProjectId(`project-${String(index + 1)}`),
  }));
  let reads = 0;
  const inventory = authorizedProjectInventory(
    { authorize: () => Promise.resolve(undefined) },
    {
      projects: (after, limit) => {
        reads += 1;
        const start =
          after === undefined
            ? 0
            : projects.findIndex(
                (candidate) => candidate.project === after.project,
              ) + 1;
        return Promise.resolve(projects.slice(start, start + limit));
      },
    },
  );
  const page = await inventory.projects(asPrincipal("reader"), undefined, 1);
  assert.equal(reads, 4);
  assert.deepEqual(page.projects, []);
  assert.deepEqual(page.nextAfter, projects[3]);
});
