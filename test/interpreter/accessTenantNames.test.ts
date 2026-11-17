/**
 * A tenant's display name changed over an authority held in memory: who may
 * change it, what a caller the tenant's list does not answer is told, and a
 * plane with no store.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { accessTenantNames } from "../../src/interpreter/accessTenantNames.ts";
import { tenantPrincipalGrant } from "../../src/interpreter/projectGrant.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  accessFixtureIssuer,
  accessFixturePrincipal,
  accessGiven,
  accessMemory,
  tenantNameMemory,
} from "./accessPlaneFixture.ts";

const acme = asTenantId("acme");

/** An authority where ada administers acme and mo may only manage who grants its roles. */
async function given() {
  const memory = accessMemory();
  await memory.grants.write(
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "ada",
      tenant: acme,
      relation: "admins",
    }),
  );
  accessGiven(memory, accessFixturePrincipal("mo"), [
    { on: "Tenant", tenant: acme, kind: "ManageTenantAuthorities" },
  ]);
  return memory;
}

test("a tenant's administrator renames it, and the store keeps the name under the same id", async () => {
  const names = tenantNameMemory({ acme: "acme" });
  const renamed = await accessTenantNames({
    access: (await given()).access,
    names,
  }).renamed(accessFixturePrincipal("ada"), acme, "Acme Co.");
  assert.equal(renamed, "Changed");
  assert.deepEqual([...names.rows], [[acme, "Acme Co."]]);
});

test("a caller the tenant's list answers who does not administer it is refused, one it does not answer is told it is absent, and neither changes the name", async () => {
  const names = tenantNameMemory({ acme: "acme" });
  const service = accessTenantNames({ access: (await given()).access, names });
  assert.equal(
    await service.renamed(accessFixturePrincipal("mo"), acme, "Mo's"),
    "Refused",
  );
  assert.equal(
    await service.renamed(accessFixturePrincipal("sam"), acme, "Sam's"),
    "Absent",
  );
  assert.equal(
    await service.renamed(
      accessFixturePrincipal("ada"),
      asTenantId("beta"),
      "Beta",
    ),
    "Absent",
  );
  assert.deepEqual([...names.rows], [[acme, "acme"]]);
});

test("a plane with no store answers a rename not configured and asks the authority nothing", async () => {
  const memory = await given();
  assert.equal(
    await accessTenantNames({ access: memory.access }).renamed(
      accessFixturePrincipal("ada"),
      acme,
      "Acme Co.",
    ),
    "NotConfigured",
  );
  assert.deepEqual(memory.asked, []);
});
