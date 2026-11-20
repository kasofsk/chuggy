/**
 * A project's icon and banner as the API keeps them, against a real server
 * and under the API's role: each role named, repeated as Unchanged, cleared
 * alone and kept with who named it; the inventory listing each project with
 * the icon it names; and the API reaching the relation but through its door
 * only to read it.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { postgresProjectImages } from "../../src/adapters/postgres/projectImages.ts";
import { postgresProjectInventory } from "../../src/adapters/postgres/projectInventory.ts";
import { apiRole } from "../../src/adapters/postgres/schema.ts";
import { asProjectArtifactId } from "../../src/interpreter/finalizerPreparation.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
} from "./harness.ts";

const harness = await postgresHarnessOpen();
const apiPool = postgresHarnessRolePool(apiRole);

after(async () => {
  await apiPool.end();
  await harness.close();
});

const images = postgresProjectImages(apiPool);

const setter = {
  kind: asAuthorityKind("Member"),
  subject: asAuthoritySubject("alice"),
};

const icon = asProjectArtifactId("image/png:mark");
const banner = asProjectArtifactId("image/webp:wide");

function project(): Promise<Partition> {
  return postgresHarnessProject(harness.store, `imaged-${randomUUID()}`);
}

test("each role is named, repeated as Unchanged, cleared alone, and kept with who named it", async () => {
  const partition = await project();
  assert.deepEqual(await images.images(partition), {});
  assert.equal(
    await images.writeImage(partition, "icon", undefined, setter),
    "Unchanged",
    "clearing an icon never named moves nothing",
  );
  assert.equal(
    await images.writeImage(partition, "icon", icon, setter),
    "Written",
  );
  assert.equal(
    await images.writeImage(partition, "banner", banner, setter),
    "Written",
  );
  assert.equal(
    await images.writeImage(partition, "icon", icon, setter),
    "Unchanged",
  );
  assert.deepEqual(await images.images(partition), { icon, banner });
  const kept = await harness.query(
    `SELECT role,set_by_kind,set_by_subject FROM project_image
      WHERE tenant=$1 AND project=$2 ORDER BY role`,
    [partition.tenant, partition.project],
  );
  assert.deepEqual(kept, [
    { role: "banner", set_by_kind: "Member", set_by_subject: "alice" },
    { role: "icon", set_by_kind: "Member", set_by_subject: "alice" },
  ]);
  assert.equal(
    await images.writeImage(partition, "icon", undefined, setter),
    "Written",
  );
  assert.deepEqual(await images.images(partition), { banner });
  assert.equal(
    await images.writeImage(
      { tenant: asTenantId("absent"), project: asProjectId("absent") },
      "icon",
      icon,
      setter,
    ),
    "NotFound",
  );
});

test("the inventory lists each project with the icon it names, and none with its banner or a cleared icon", async () => {
  const named = await project();
  const plain = await project();
  const cleared = await project();
  await images.writeImage(named, "icon", icon, setter);
  await images.writeImage(plain, "banner", banner, setter);
  await images.writeImage(cleared, "icon", icon, setter);
  await images.writeImage(cleared, "icon", undefined, setter);
  const page = await postgresProjectInventory(apiPool).projects(undefined, 100);
  assert.ok(page.length < 100, "the suite's projects fit one page");
  const listed = new Map(
    page.map((each) => [`${each.tenant}/${each.project}`, each.icon]),
  );
  const iconOf = (partition: Partition) =>
    listed.get(`${partition.tenant}/${partition.project}`);
  assert.equal(iconOf(named), icon);
  for (const partition of [plain, cleared]) {
    assert.ok(listed.has(`${partition.tenant}/${partition.project}`));
    assert.equal(iconOf(partition), undefined);
  }
});

test("the API reads the relation and writes it through its door alone", async () => {
  for (const statement of [
    "INSERT INTO project_image(tenant,project,role,set_by_kind,set_by_subject,set_at) VALUES('t','p','icon','k','s',now())",
    "UPDATE project_image SET artifact=NULL",
    "DELETE FROM project_image",
  ])
    assert.match(
      (await harness.attemptAs(apiRole, statement)) ?? "",
      postgresHarnessDenial("project_image"),
      statement,
    );
  assert.equal(
    await harness.attemptAs(apiRole, "SELECT artifact FROM project_image"),
    undefined,
  );
});
