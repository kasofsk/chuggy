/**
 * Whether the scheduler's own role reads what an execution's project is for,
 * asked of the server by running the read a briefing is gathered from.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresProjectNorthStar } from "../../src/adapters/postgres/repositoryBinding.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessPartition } from "./harness.ts";
import { schedulerRigOpen, type SchedulerRig } from "./schedulerHarness.ts";

let rig: SchedulerRig;

before(async () => {
  rig = await schedulerRigOpen();
});

after(async () => {
  await rig.close();
});

/** A project of its own, with a settings row holding `northStar` where one is given. */
async function northStarProject(
  label: string,
  settings?: { readonly northStar: string | null },
): Promise<Partition> {
  const partition = postgresHarnessPartition(label);
  await rig.harness.store.createProject(partition);
  if (settings !== undefined)
    await rig.harness.query(
      `INSERT INTO selector_project_settings (tenant,project,north_star)
       VALUES ($1,$2,$3)`,
      [partition.tenant, partition.project, settings.northStar],
    );
  return partition;
}

test("the scheduler role reads the North Star its project's members wrote", async () => {
  const partition = await northStarProject("north-star", {
    northStar: "plain Python with no dependencies\nno build step",
  });
  await northStarProject("north-star-other", { northStar: "a Rust service" });
  assert.deepEqual(
    await postgresProjectNorthStar(rig.pool).northStar(partition),
    {
      read: "NorthStar",
      northStar: "plain Python with no dependencies\nno build step",
    },
  );
});

test("a project with no settings, or settings naming no North Star, reads as having none", async () => {
  for (const partition of [
    await northStarProject("north-star-absent"),
    await northStarProject("north-star-unwritten", { northStar: null }),
  ])
    assert.deepEqual(
      await postgresProjectNorthStar(rig.pool).northStar(partition),
      { read: "NorthStar" },
    );
});
