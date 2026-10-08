/**
 * Adding and removing an authority's holders, over an authority held in
 * memory: what is written, the order a caller and a holder are asked in, what
 * each authority admits and what a removal reaches.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessProjectAuthorities,
  accessProjectAuthorityAdmits,
  accessProjectGroups,
  accessSiteAuthorities,
  accessSiteAuthorityAdmits,
  accessTenantAuthorities,
  accessTenantAuthorityAdmits,
  accessTenantGroups,
} from "../../src/contract/accessPlane.ts";
import {
  accessTenantAuthorityKinds,
  type AccessHeld,
  type AccessHolder,
} from "../../src/interpreter/accessAuthorityHolders.ts";
import {
  ProjectAccessUnavailable,
  projectAccessNamespace,
  projectAccessObject,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectAuthorityDefaults,
  projectTenantGrant,
  siteAuthorityDefaults,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessGiven,
  accessGivenTenantAdministrator,
  accessMemory,
  accessMemoryHolders,
  accessStored,
} from "./accessPlaneFixture.ts";

const web = accessFixturePartition("acme/co", "web");
const tenant = web.tenant;
const unmade = asTenantId("unmade");
const alice = accessFixturePrincipal("alice");
const sam = accessFixturePrincipal("sam");
const hal = accessFixturePrincipal("hal");
const mo = accessFixturePrincipal("mo");
const stranger = accessFixturePrincipal("stranger");

/**
 * The site, a tenant alice administers and its linked `web`, each carrying its
 * defaults. Sam holds every manage kind at each level, hal manages only what
 * the site holds over the tenant, and mo may grant `Member` and manages
 * nothing.
 */
async function acme() {
  const memory = accessMemory();
  for (const grant of [
    ...siteAuthorityDefaults(),
    ...tenantAuthorityDefaults(tenant),
    projectTenantGrant(web),
    ...projectAuthorityDefaults(web),
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant,
      relation: "admins",
    }),
  ])
    await memory.grants.write(grant);
  memory.changes.length = 0;
  accessGivenTenantAdministrator(memory, alice, tenant, [web]);
  accessGiven(memory, sam, [
    { on: "Site", kind: "ManageSiteAuthorities" },
    { on: "Tenant", tenant, kind: "ManageTenantAuthorities" },
    { on: "Tenant", tenant, kind: "ManageSiteHeldAuthorities" },
    { on: "Project", partition: web, kind: "ManageProjectAuthorities" },
  ]);
  accessGiven(memory, hal, [
    { on: "Tenant", tenant, kind: "ManageSiteHeldAuthorities" },
  ]);
  accessGiven(memory, mo, [{ on: "Tenant", tenant, kind: "GrantMember" }]);
  return { memory, holders: accessMemoryHolders(memory) };
}

const person = (subject: string): AccessHolder => ({
  holder: "Person",
  subject,
});

const group = (named: (typeof accessProjectGroups)[number]): AccessHolder => ({
  holder: "Group",
  group: named,
});

/** Whether `memory` holds `grant`. */
function holds(
  memory: Awaited<ReturnType<typeof acme>>["memory"],
  grant: ProjectGrant,
): boolean {
  const stored = JSON.stringify(accessStored(grant));
  return memory.tuples.some((tuple) => JSON.stringify(tuple) === stored);
}

const onTenant = (
  relation: string,
  holder: ProjectGrant["holder"],
): ProjectGrant => ({
  namespace: projectAccessTenantNamespace,
  object: projectAccessTenantObject(tenant),
  relation,
  holder,
});

const tenantMembers: ProjectGrant["holder"] = {
  subject: "Holders",
  namespace: projectAccessTenantNamespace,
  object: projectAccessTenantObject(tenant),
  relation: "members",
};

test("a person is written into the authority's relation as the principal its subject is, at each level, and taken out again", async () => {
  const { memory, holders } = await acme();
  const zed = {
    subject: "Principal",
    principal: accessFixturePrincipal("zed"),
  } as const;
  for (const [held, grant] of [
    [
      { level: "Site", authority: "AuthorityManagers", holder: person("zed") },
      {
        namespace: projectAccessSiteNamespace,
        object: projectAccessSiteObject,
        relation: "authority_managers",
        holder: zed,
      },
    ],
    [
      {
        level: "Tenant",
        tenant,
        authority: "MemberGranters",
        holder: person("zed"),
      },
      onTenant("member_granters", zed),
    ],
    [
      {
        level: "Project",
        partition: web,
        authority: "DispatcherGranters",
        holder: person("zed"),
      },
      {
        namespace: projectAccessNamespace,
        object: projectAccessObject(web),
        relation: "dispatcher_granters",
        holder: zed,
      },
    ],
  ] as const satisfies readonly (readonly [AccessHeld, ProjectGrant])[]) {
    assert.equal(await holders.holderAdded(sam, held), "Changed");
    assert.ok(holds(memory, grant), held.level);
    assert.equal(await holders.holderRemoved(sam, held), "Changed");
    assert.ok(!holds(memory, grant), held.level);
  }
});

test("adding a holder already held and removing one that is not change nothing and succeed", async () => {
  const { memory, holders } = await acme();
  const held: AccessHeld = {
    level: "Tenant",
    tenant,
    authority: "AdminGranters",
    holder: group("TenantAdmins"),
  };
  const before = memory.tuples.length;
  assert.equal(await holders.holderAdded(alice, held), "Changed");
  assert.equal(memory.tuples.length, before);
  const absent: AccessHeld = { ...held, holder: person("nobody") };
  assert.equal(await holders.holderRemoved(alice, absent), "Changed");
  assert.equal(memory.tuples.length, before);
});

test("a caller not answered the level's list is absent, and one who is but lacks the authority's kind is refused, before the holder is looked at", async () => {
  const { memory, holders } = await acme();
  const unshaped = person("");
  for (const caller of [mo, stranger])
    for (const held of [
      { level: "Site", authority: "AccountCreators", holder: unshaped },
      { level: "Tenant", tenant, authority: "AdminGranters", holder: unshaped },
      {
        level: "Project",
        partition: web,
        authority: "AdminGranters",
        holder: unshaped,
      },
    ] as const satisfies readonly AccessHeld[]) {
      assert.equal(await holders.holderAdded(caller, held), "Absent");
      assert.equal(await holders.holderRemoved(caller, held), "Absent");
    }
  assert.equal(
    await holders.holderAdded(alice, {
      level: "Site",
      authority: "AccountCreators",
      holder: unshaped,
    }),
    "Absent",
  );
  for (const [caller, authority] of [
    [alice, "HostedRunsGranters"],
    [hal, "AdminGranters"],
  ] as const)
    for (const holder of [unshaped, group("TenantMembers")]) {
      const held: AccessHeld = { level: "Tenant", tenant, authority, holder };
      assert.equal(await holders.holderAdded(caller, held), "Refused");
      assert.equal(await holders.holderRemoved(caller, held), "Refused");
    }
  assert.deepEqual(memory.changes, []);
  assert.equal(
    await holders.holderAdded(hal, {
      level: "Tenant",
      tenant,
      authority: "HostedRunsGranters",
      holder: group("TenantAdmins"),
    }),
    "Changed",
  );
});

test("a group the authority admits is written as the request's own tenant's or project's set", async () => {
  const { memory, holders } = await acme();
  assert.equal(
    await holders.holderAdded(alice, {
      level: "Tenant",
      tenant,
      authority: "MemberGranters",
      holder: group("TenantMembers"),
    }),
    "Changed",
  );
  assert.ok(holds(memory, onTenant("member_granters", tenantMembers)));
  assert.equal(
    await holders.holderAdded(alice, {
      level: "Project",
      partition: web,
      authority: "DeveloperGranters",
      holder: group("ProjectDevelopers"),
    }),
    "Changed",
  );
  assert.ok(
    holds(memory, {
      namespace: projectAccessNamespace,
      object: projectAccessObject(web),
      relation: "developer_granters",
      holder: {
        subject: "Holders",
        namespace: projectAccessNamespace,
        object: projectAccessObject(web),
        relation: "developers",
      },
    }),
  );
});

test("a group the authority does not admit, or the level does not name, is refused with nothing written", async () => {
  const { memory, holders } = await acme();
  for (const held of [
    {
      level: "Tenant",
      tenant,
      authority: "AdminGranters",
      holder: group("TenantMembers"),
    },
    {
      level: "Tenant",
      tenant,
      authority: "AuthorityManagers",
      holder: group("ProjectAdmins"),
    },
    {
      level: "Project",
      partition: web,
      authority: "AdminGranters",
      holder: group("ProjectDevelopers"),
    },
    ...accessProjectGroups.map((named) => ({
      level: "Site" as const,
      authority: "AuthorityManagers" as const,
      holder: group(named),
    })),
    {
      level: "Site",
      authority: "AccountCreators",
      holder: group("TenantAdmins"),
    },
  ] as const satisfies readonly AccessHeld[])
    assert.equal(
      await holders.holderAdded(sam, held),
      "NotAdmitted",
      JSON.stringify(held),
    );
  assert.deepEqual(memory.changes, []);
});

test("a removal reaches any group the level's list names, admitted or not, and no other", async () => {
  const { memory, holders } = await acme();
  const written = onTenant("admin_granters", tenantMembers);
  await memory.grants.write(written);
  memory.changes.length = 0;
  assert.equal(
    await holders.holderRemoved(alice, {
      level: "Tenant",
      tenant,
      authority: "AdminGranters",
      holder: group("TenantMembers"),
    }),
    "Changed",
  );
  assert.ok(!holds(memory, written));
  assert.ok(
    holds(
      memory,
      onTenant("admin_granters", { ...tenantMembers, relation: "admins" }),
    ),
  );
  assert.equal(
    await holders.holderRemoved(alice, {
      level: "Tenant",
      tenant,
      authority: "AdminGranters",
      holder: group("ProjectAdmins"),
    }),
    "NotAdmitted",
  );
  assert.equal(memory.changes.length, 1);
});

test("a tenant's administrators are added to the site's account creators only for a tenant carrying its site link, and removed whether or not it does", async () => {
  const { memory, holders } = await acme();
  const creators = (named: typeof tenant): ProjectGrant => ({
    namespace: projectAccessSiteNamespace,
    object: projectAccessSiteObject,
    relation: "account_creators",
    holder: {
      subject: "Holders",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(named),
      relation: "admins",
    },
  });
  const held = (named: typeof tenant): AccessHeld => ({
    level: "Site",
    authority: "AccountCreators",
    holder: { holder: "Tenant", tenant: named },
  });
  assert.equal(await holders.holderAdded(sam, held(tenant)), "Changed");
  assert.ok(holds(memory, creators(tenant)));
  assert.equal(await holders.holderAdded(sam, held(unmade)), "Absent");
  assert.ok(!holds(memory, creators(unmade)));
  assert.equal(
    await holders.holderAdded(sam, {
      level: "Site",
      authority: "AuthorityManagers",
      holder: { holder: "Tenant", tenant },
    }),
    "NotAdmitted",
  );
  await memory.grants.write(creators(unmade));
  assert.equal(await holders.holderRemoved(sam, held(unmade)), "Changed");
  assert.ok(!holds(memory, creators(unmade)));
  assert.equal(
    await holders.holderAdded(sam, {
      level: "Tenant",
      tenant,
      authority: "AdminGranters",
      holder: { holder: "Tenant", tenant },
    }),
    "NotAdmitted",
  );
});

test("the site's tenant creators take a person and the site's administrators, and refuse a tenant's administrators", async () => {
  const { memory, holders } = await acme();
  const creating = (holder: ProjectGrant["holder"]): ProjectGrant => ({
    namespace: projectAccessSiteNamespace,
    object: projectAccessSiteObject,
    relation: "tenant_creators",
    holder,
  });
  for (const [holder, grant] of [
    [
      person("zed"),
      creating({
        subject: "Principal",
        principal: accessFixturePrincipal("zed"),
      }),
    ],
    [
      group("SiteAdmins"),
      creating({
        subject: "Holders",
        namespace: projectAccessSiteNamespace,
        object: projectAccessSiteObject,
        relation: "admins",
      }),
    ],
  ] as const) {
    const held: AccessHeld = {
      level: "Site",
      authority: "TenantCreators",
      holder,
    };
    assert.equal(await holders.holderRemoved(sam, held), "Changed");
    assert.ok(!holds(memory, grant), holder.holder);
    assert.equal(await holders.holderAdded(sam, held), "Changed");
    assert.ok(holds(memory, grant), holder.holder);
  }
  memory.changes.length = 0;
  for (const holder of [
    { holder: "Tenant", tenant },
    group("TenantAdmins"),
  ] as const)
    assert.equal(
      await holders.holderAdded(sam, {
        level: "Site",
        authority: "TenantCreators",
        holder,
      }),
      "NotAdmitted",
      holder.holder,
    );
  assert.deepEqual(memory.changes, []);
});

test("an authority that cannot answer fails a change as it fails a role change", async () => {
  const { memory, holders } = await acme();
  memory.unavailable = true;
  const held: AccessHeld = {
    level: "Tenant",
    tenant,
    authority: "MemberGranters",
    holder: person("zed"),
  };
  await assert.rejects(
    holders.holderAdded(alice, held),
    ProjectAccessUnavailable,
  );
  await assert.rejects(
    holders.holderRemoved(alice, held),
    ProjectAccessUnavailable,
  );
});

test("each authority admits only groups its level's list names, and changing a tenant's asks a kind its list answers", () => {
  assert.deepEqual(
    Object.keys(accessSiteAuthorityAdmits),
    accessSiteAuthorities,
  );
  assert.deepEqual(
    Object.keys(accessTenantAuthorityAdmits),
    accessTenantAuthorities,
  );
  assert.deepEqual(
    Object.keys(accessProjectAuthorityAdmits),
    accessProjectAuthorities,
  );
  for (const groups of Object.values(accessTenantAuthorityAdmits))
    for (const named of groups) assert.ok(accessTenantGroups.includes(named));
  assert.deepEqual(
    [...new Set(Object.values(accessTenantAuthorityKinds))].sort(),
    ["ManageSiteHeldAuthorities", "ManageTenantAuthorities"],
  );
});
