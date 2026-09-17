import assert from "node:assert/strict";
import { test } from "node:test";
import { projectTicketCatalogSource } from "../../src/adapters/catalog/projectCatalog.ts";

test("project catalog settings are read from the pinned snapshot", async () => {
  const files = new Map([
    [
      [".chug", "project.yaml"].join("/"),
      "version: 2\nname: demo\nrepository: ignored\ncloud_project: owner/platform\nexecution_profiles:\n  coding:\n    required_capabilities: [linux, linux]\n    runner_command: [runner]\n",
    ],
    [[".chug", "agents", "worker.md"].join("/"), "work"],
  ]);
  const source = await projectTicketCatalogSource(
    {
      read: (path) => {
        const found = files.get(path);
        if (found === undefined) throw new Error(`missing ${path}`);
        return Promise.resolve(found);
      },
    },
    "bound-repository",
  );
  assert.equal(source.repository, "bound-repository");
  assert.equal(source.reworkLimit, 3);
  assert.equal(source.cloudProject, "owner/platform");
  assert.deepEqual(source.executionProfiles.get("coding"), {
    required_capabilities: ["linux"],
    runner_command: ["runner"],
    cpu: 1000,
    memory_mb: 1024,
  });
  assert.equal(
    await source.read([".chug", "agents", "worker.md"].join("/")),
    "work",
  );
});

test("project catalog carries an explicit rework default", async () => {
  const source = await projectTicketCatalogSource(
    {
      read: () =>
        Promise.resolve(
          "version: 2\nname: demo\nrepository: repo\nrework_limit: 7\n",
        ),
    },
    "repository",
  );
  assert.equal(source.reworkLimit, 7);
});

test("project catalog rejects invalid settings from the same snapshot", async () => {
  for (const project of [
    "version: 1\nname: demo\nrepository: repo\n",
    "version: 2\nname: demo\nrepository: repo\ncloud_project: bad\n",
    "version: 2\nname: demo\nrepository: repo\nexecution_profiles: []\n",
    "version: 2\nname: demo\nrepository: repo\nextra: true\n",
  ])
    await assert.rejects(
      projectTicketCatalogSource(
        { read: () => Promise.resolve(project) },
        "repository",
      ),
    );
});
