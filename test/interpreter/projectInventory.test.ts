import assert from "node:assert/strict";
import { test } from "node:test";

import { authorizedProjectInventory } from "../../src/interpreter/projectInventory.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

test("authorized inventory bounds hidden-project scanning and returns progress", async () => {
  const tenant = asTenantId("tenant");
  const projects = Array.from({ length: 10 }, (_unused, index) => ({
    tenant,
    project: asProjectId(`project-${String(index + 1)}`),
    name: `Project ${String(index + 1)}`,
  }));
  let reads = 0;
  const inventory = authorizedProjectInventory(
    {
      authorize: () => Promise.resolve(undefined),
      authorizeTenant: () => Promise.resolve(undefined),
      authorizeSite: projectAccessSiteRefused,
    },
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
  assert.deepEqual(page.nextAfter, {
    tenant,
    project: asProjectId("project-4"),
  });
});

test("authorized inventory lists each readable project with its name, and resumes after a partition alone", async () => {
  const tenant = asTenantId("tenant");
  const projects = [
    { tenant, project: asProjectId("billing"), name: "Acme Billing" },
    { tenant, project: asProjectId("hidden"), name: "Hidden" },
    { tenant, project: asProjectId("ledger"), name: "Ledger" },
    { tenant, project: asProjectId("zeta"), name: "Zeta" },
  ];
  const inventory = authorizedProjectInventory(
    {
      authorize: (_principal, partition) =>
        Promise.resolve(
          partition.project === "hidden"
            ? undefined
            : memberAuthority(asPrincipal("reader")),
        ),
      authorizeTenant: () => Promise.resolve(undefined),
      authorizeSite: projectAccessSiteRefused,
    },
    {
      projects: (after, limit) =>
        Promise.resolve(
          projects
            .filter(
              (candidate) =>
                after === undefined || candidate.project > after.project,
            )
            .slice(0, limit),
        ),
    },
  );
  const page = await inventory.projects(asPrincipal("reader"), undefined, 2);
  assert.deepEqual(page.projects, [projects[0], projects[2]]);
  assert.deepEqual(page.nextAfter, { tenant, project: asProjectId("ledger") });
});
