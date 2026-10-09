/**
 * The caller's own tenants over an authority held in memory: which tenants are
 * listed and with which roles, `administer` as the authority answers it, and
 * the bounds an answer is read under.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccessCallerTenants } from "../../src/contract/accessPlane.ts";
import {
  accessPlaneBoundsDefault,
  accessTuplesRead,
  accessBudget,
  type AccessPlaneBounds,
} from "../../src/interpreter/accessPlane.ts";
import {
  memberAuthority,
  ProjectAccessUnavailable,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectPrincipalGrant,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  accessFixtureIssuer,
  accessFixturePrincipal,
  accessMemory,
  accessMemoryCallerTenants,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

const alice = accessFixturePrincipal("alice");

/** `subject` holding `relation` on `tenant`. */
function heldBy(
  subject: string,
  tenant: string,
  relation = "admins",
): ProjectGrant {
  return tenantPrincipalGrant({
    issuer: accessFixtureIssuer,
    subject,
    tenant,
    relation,
  });
}

async function written(grants: readonly ProjectGrant[]): Promise<AccessMemory> {
  const memory = accessMemory();
  for (const grant of grants) await memory.grants.write(grant);
  return memory;
}

/** Alice's tenants as she is answered them over `memory`. */
function listed(
  memory: AccessMemory,
  bounds: AccessPlaneBounds = accessPlaneBoundsDefault,
  access?: ProjectAccess,
): Promise<AccessCallerTenants> {
  return accessMemoryCallerTenants(memory, bounds, access).callerTenants(alice);
}

test("a caller holding `Admin` on one tenant and `Member` on another is answered both in name order, each with its own roles", async () => {
  const memory = await written([
    heldBy("alice", "beta", "members"),
    heldBy("alice", "acme"),
  ]);
  assert.deepEqual(await listed(memory), {
    tenants: [
      { tenant: "acme", roles: ["Admin"], administer: true },
      { tenant: "beta", roles: ["Member"], administer: false },
    ],
    truncated: false,
  });
});

test("a caller holding both roles on one tenant is answered it once, with both roles in the roster's order", async () => {
  const memory = await written([
    heldBy("alice", "acme", "members"),
    heldBy("alice", "acme"),
  ]);
  assert.deepEqual(await listed(memory), {
    tenants: [{ tenant: "acme", roles: ["Admin", "Member"], administer: true }],
    truncated: false,
  });
});

test("another person's tuples, on the caller's tenants and on one the caller holds nothing on, add nothing, though a listing across the namespace names them", async () => {
  const memory = await written([
    heldBy("alice", "acme"),
    heldBy("bo", "acme", "members"),
    heldBy("bo", "beta"),
  ]);
  assert.deepEqual(await listed(memory), {
    tenants: [{ tenant: "acme", roles: ["Admin"], administer: true }],
    truncated: false,
  });
  const across = await accessTuplesRead(
    memory.reader,
    accessBudget(accessPlaneBoundsDefault),
    { query: "Namespace", namespace: projectAccessTenantNamespace },
  );
  assert.ok(
    across.some(
      (tuple) =>
        tuple.subject.subject === "Id" &&
        tuple.subject.id === accessFixturePrincipal("bo"),
    ),
  );
});

test("a tuple naming the caller in a relation that is no role's lists nothing", async () => {
  const memory = await written([
    heldBy("alice", "acme", "hosted_execution"),
    { ...heldBy("alice", "acme"), relation: "member_granters" },
  ]);
  assert.deepEqual(await listed(memory), { tenants: [], truncated: false });
});

test("a tenant the caller reaches only through the site's set, or holds only a project's role in, is not listed", async () => {
  const memory = await written([
    ...tenantAuthorityDefaults(asTenantId("linked")),
    {
      namespace: projectAccessSiteNamespace,
      object: projectAccessSiteObject,
      relation: "admins",
      holder: { subject: "Principal", principal: alice },
    },
    projectPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant: "projected",
      project: "web",
      relation: "admins",
    }),
  ]);
  assert.deepEqual(await listed(memory), { tenants: [], truncated: false });
});

test("a role tuple held in two copies lists its tenant once, with the role once", async () => {
  const memory = await written([heldBy("alice", "acme")]);
  const stored = memory.tuples[0];
  assert.ok(stored !== undefined);
  memory.tuples.push({ ...stored });
  assert.deepEqual(await listed(memory), {
    tenants: [{ tenant: "acme", roles: ["Admin"], administer: true }],
    truncated: false,
  });
});

test("an object no tenant's name decodes from is left out", async () => {
  const memory = await written([heldBy("alice", "acme")]);
  memory.tuples.push({
    namespace: projectAccessTenantNamespace,
    object: "not a tenant",
    relation: "admins",
    subject: { subject: "Id", id: alice },
  });
  assert.deepEqual(
    (await listed(memory)).tenants.map((one) => one.tenant),
    ["acme"],
  );
});

test("`administer` is the authority's answer and not the role's", async () => {
  const memory = await written([
    heldBy("alice", "acme"),
    heldBy("alice", "beta", "members"),
  ]);
  const opposite: ProjectAccess = {
    ...memory.access,
    authorizeTenant: async (principal, tenant, kind) =>
      (await memory.access.authorizeTenant(principal, tenant, kind)) ===
      undefined
        ? memberAuthority(principal)
        : undefined,
  };
  assert.deepEqual(
    (await listed(memory, accessPlaneBoundsDefault, opposite)).tenants,
    [
      { tenant: "acme", roles: ["Admin"], administer: false },
      { tenant: "beta", roles: ["Member"], administer: true },
    ],
  );
  assert.deepEqual(memory.asked, [
    ["AdministerTenant", projectAccessTenantObject("acme")],
    ["AdministerTenant", projectAccessTenantObject("beta")],
  ]);
});

test("a caller written into nothing is answered an empty list, not absent", async () => {
  const memory = await written([heldBy("bo", "acme")]);
  assert.deepEqual(await listed(memory), { tenants: [], truncated: false });
});

test("a caller in more tenants than the bound is answered the first in name order, truncated, and asked `AdministerTenant` no more than the bound", async () => {
  const memory = await written(
    ["t3", "t1", "t0", "t2"].map((tenant) =>
      heldBy("alice", tenant, "members"),
    ),
  );
  const answered = await listed(memory, {
    ...accessPlaneBoundsDefault,
    tenantsMax: 2,
  });
  assert.deepEqual(
    answered.tenants.map((one) => one.tenant),
    ["t0", "t1"],
  );
  assert.equal(answered.truncated, true);
  assert.deepEqual(
    memory.asked.map(([kind, object]) => [kind, object]),
    [
      ["AdministerTenant", projectAccessTenantObject("t0")],
      ["AdministerTenant", projectAccessTenantObject("t1")],
    ],
  );
});

test("a listing the budget cuts answers what it read and truncated", async () => {
  const memory = await written([
    heldBy("alice", "acme"),
    heldBy("alice", "beta"),
  ]);
  const cut = await listed(memory, {
    ...accessPlaneBoundsDefault,
    tuplesMax: 1,
  });
  assert.equal(cut.truncated, true);
  assert.equal(cut.tenants.length, 1);
});

test("an authority that cannot answer fails the list as every list fails", async () => {
  const memory = await written([heldBy("alice", "acme")]);
  memory.unavailable = true;
  await assert.rejects(listed(memory), ProjectAccessUnavailable);
});
