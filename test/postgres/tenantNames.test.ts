/**
 * Each tenant's display name against a real PostgreSQL, driven as the access
 * plane's own role: a rename of a tenant with a row and of one with none, the
 * names read back only for the tenants asked, the row's bound, and that the
 * role moves the display name and nothing else of a tenant.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { projectDisplayNameCharsMax } from "../../src/contract/requests.ts";
import { tenantDisplayNameCharsMaxAt186 } from "../../src/adapters/postgres/schema/migrations/186-tenant-display-name.ts";
import { accessPlaneRole } from "../../src/adapters/postgres/schema/shared.ts";
import { postgresTenantNames } from "../../src/adapters/postgres/tenantNames.ts";
import type { AccessTenantNameStore } from "../../src/interpreter/accessTenantNames.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let plane: pg.Pool;
let names: AccessTenantNameStore;
before(async () => {
  harness = await postgresHarnessOpen();
  plane = postgresHarnessRolePool(accessPlaneRole);
  names = postgresTenantNames(plane);
});
after(async () => {
  await plane.end();
  await harness.close();
});

async function tenantRow(tenant: string) {
  return harness.query(
    "SELECT tenant,display_name FROM tenant WHERE tenant=$1",
    [tenant],
  );
}

test("a tenant inserted naming no display name is named by its id, and a rename changes the name alone", async () => {
  await harness.query("INSERT INTO tenant(tenant) VALUES('names-held')");
  assert.deepEqual(await tenantRow("names-held"), [
    { tenant: "names-held", display_name: "names-held" },
  ]);
  await names.renamed(asTenantId("names-held"), "Held Co.");
  assert.deepEqual(await tenantRow("names-held"), [
    { tenant: "names-held", display_name: "Held Co." },
  ]);
});

test("a rename of a tenant with no row writes one carrying the name", async () => {
  assert.deepEqual(await tenantRow("names-new"), []);
  await names.renamed(asTenantId("names-new"), "New Co.");
  assert.deepEqual(await tenantRow("names-new"), [
    { tenant: "names-new", display_name: "New Co." },
  ]);
});

test("names are read for the tenants asked, a tenant no row names left out", async () => {
  await names.renamed(asTenantId("names-one"), "One");
  await names.renamed(asTenantId("names-two"), "Two");
  const read = await names.named([
    asTenantId("names-one"),
    asTenantId("names-absent"),
  ]);
  assert.deepEqual([...read], [["names-one", "One"]]);
});

test("the row holds a display name to the contract's bound, in code points, and refuses one past it", async () => {
  assert.equal(tenantDisplayNameCharsMaxAt186, projectDisplayNameCharsMax);
  const widest = "\u{1F600}".repeat(projectDisplayNameCharsMax);
  await names.renamed(asTenantId("names-bound"), widest);
  assert.deepEqual(await tenantRow("names-bound"), [
    { tenant: "names-bound", display_name: widest },
  ]);
  await assert.rejects(
    names.renamed(asTenantId("names-bound"), `${widest}x`),
    /tenant_display_name_is_bounded/u,
  );
  await assert.rejects(
    names.renamed(asTenantId("names-bound"), ""),
    /tenant_display_name_is_bounded/u,
  );
});

test("a tenant whose id is longer than a display name may be is named by its id, and a rename gives it a name within the bound", async () => {
  const long = `names-long-${"l".repeat(projectDisplayNameCharsMax)}`;
  await harness.query("INSERT INTO tenant(tenant) VALUES($1)", [long]);
  assert.deepEqual(await tenantRow(long), [
    { tenant: long, display_name: long },
  ]);
  await assert.rejects(
    names.renamed(asTenantId(long), `${long}x`),
    /tenant_display_name_is_bounded/u,
  );
  await names.renamed(asTenantId(long), "Long Co.");
  assert.deepEqual(await tenantRow(long), [
    { tenant: long, display_name: "Long Co." },
  ]);
});

test("the access plane's role changes no tenant's id and deletes no tenant, and the row refuses an id's change from its owner too", async () => {
  await names.renamed(asTenantId("names-kept"), "Kept");
  for (const statement of [
    "UPDATE tenant SET tenant='names-moved' WHERE tenant='names-kept'",
    "DELETE FROM tenant WHERE tenant='names-kept'",
  ])
    assert.match(
      (await harness.attemptAs(accessPlaneRole, statement)) ?? "",
      /permission denied/u,
      statement,
    );
  await assert.rejects(
    harness.query(
      "UPDATE tenant SET tenant='names-moved',display_name='Moved' WHERE tenant='names-kept'",
    ),
    /tenant rows are immutable/u,
  );
  assert.deepEqual(await tenantRow("names-kept"), [
    { tenant: "names-kept", display_name: "Kept" },
  ]);
});
