/**
 * Who holds each authority, over an authority held in memory: the defaults
 * named as groups, what no roster names counted, who is answered, and the
 * bounds and the directory an answer is read under.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessProjectAuthorities,
  accessProjectGroups,
  accessSiteAuthorities,
  accessTenantAuthorities,
} from "../../src/contract/accessPlane.ts";
import {
  accessGroupHolders,
  accessGroupSubject,
  accessProjectAuthorityRelations,
  accessSiteAuthorityRelations,
  accessTenantAuthorityRelations,
} from "../../src/interpreter/accessAuthorities.ts";
import type { AccessDirectory } from "../../src/interpreter/accessDirectory.ts";
import { accessPlaneBoundsDefault } from "../../src/interpreter/accessPlane.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
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
  allProjectAuthorityRelations,
  allSiteAuthorityRelations,
  allTenantAuthorityRelations,
  projectAuthorityDefaults,
  projectTenantGrant,
  siteAuthorityDefaults,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  type ProjectGrant,
  type ProjectGrantHolderRelation,
} from "../../src/interpreter/projectGrant.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  directoryMemory,
  directorySubject,
} from "./accessInvitationFixture.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessGiven,
  accessGivenTenantAdministrator,
  accessMemory,
  accessMemoryAuthorities,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

const web = accessFixturePartition("acme/co", "web");
const tenant = web.tenant;
const other = asTenantId("other");
const alice = accessFixturePrincipal("alice");
const sam = accessFixturePrincipal("sam");
const mo = accessFixturePrincipal("mo");

/** One tuple on `tenant` naming the holders of `relation` on `object` of `namespace`. */
function heldOnTenant(
  relation: string,
  namespace: string,
  object: string,
  holders: ProjectGrantHolderRelation,
): ProjectGrant {
  return {
    namespace: projectAccessTenantNamespace,
    object: projectAccessTenantObject(tenant),
    relation,
    holder: { subject: "Holders", namespace, object, relation: holders },
  };
}

/**
 * A tenant alice administers with `web` linked, the site, the tenant and the
 * project carrying their defaults. Sam is the site's administrator, holding
 * every manage kind at each level and no role in the tenant; mo may grant
 * `Member` and manages nothing.
 */
async function acme(memory: AccessMemory = accessMemory()) {
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
  accessGivenTenantAdministrator(memory, alice, tenant, [web]);
  accessGiven(memory, sam, [
    { on: "Site", kind: "ManageSiteAuthorities" },
    { on: "Tenant", tenant, kind: "ManageTenantAuthorities" },
    { on: "Tenant", tenant, kind: "ManageSiteHeldAuthorities" },
    { on: "Project", partition: web, kind: "ManageProjectAuthorities" },
  ]);
  accessGiven(memory, mo, [{ on: "Tenant", tenant, kind: "GrantMember" }]);
  return memory;
}

/** Each authority's groups, by authority. */
function groupsOf(
  answered:
    | {
        readonly authorities: readonly {
          readonly authority: string;
          readonly groups: readonly string[];
        }[];
      }
    | undefined,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    (answered?.authorities ?? []).map((held) => [held.authority, held.groups]),
  );
}

test("the defaults are answered as groups, every authority present in roster order, holding nobody else", async () => {
  const authorities = accessMemoryAuthorities(await acme());
  const tenantList = await authorities.tenantAuthorities(alice, tenant);
  assert.deepEqual(
    tenantList?.authorities.map((held) => held.authority),
    accessTenantAuthorities,
  );
  assert.deepEqual(groupsOf(tenantList), {
    AdminGranters: ["TenantAdmins"],
    MemberGranters: ["TenantAdmins"],
    HostedRunsGranters: ["SiteAdmins"],
    AuthorityManagers: ["TenantAdmins"],
  });
  const projectList = await authorities.projectAuthorities(alice, web);
  assert.deepEqual(
    groupsOf(projectList),
    Object.fromEntries(
      accessProjectAuthorities.map((authority) => [
        authority,
        ["TenantAdmins", "ProjectAdmins"],
      ]),
    ),
  );
  const siteList = await authorities.siteAuthorities(sam);
  assert.deepEqual(groupsOf(siteList), {
    AccountCreators: ["SiteAdmins"],
    AuthorityManagers: [],
  });
  for (const held of [
    ...(tenantList?.authorities ?? []),
    ...(projectList?.authorities ?? []),
    ...(siteList?.authorities ?? []),
  ])
    assert.deepEqual([held.people, held.unnamed], [[], 0], held.authority);
  assert.deepEqual(
    siteList?.authorities.map((held) => held.tenants),
    [[], []],
  );
  assert.equal(tenantList?.truncated, false);
});

test("a person is answered once however many rows hold them, the caller marked, and what no roster names is counted", async () => {
  const memory = await acme();
  const tenantObject = projectAccessTenantObject(tenant);
  for (const grant of [
    heldOnTenant(
      "member_granters",
      projectAccessTenantNamespace,
      tenantObject,
      "members",
    ),
    heldOnTenant(
      "admin_granters",
      projectAccessTenantNamespace,
      projectAccessTenantObject(other),
      "admins",
    ),
    heldOnTenant(
      "admin_granters",
      projectAccessTenantNamespace,
      tenantObject,
      "hosted_execution",
    ),
    heldOnTenant(
      "admin_granters",
      projectAccessNamespace,
      projectAccessObject(web),
      "admins",
    ),
  ])
    await memory.grants.write(grant);
  for (const principal of [
    alice,
    accessFixturePrincipal("bo"),
    accessFixturePrincipal("bo"),
    oidcPrincipal("https://other.invalid", "far"),
  ])
    memory.tuples.push({
      namespace: projectAccessTenantNamespace,
      object: tenantObject,
      relation: "member_granters",
      subject: { subject: "Id", id: principal },
    });
  const answered = await accessMemoryAuthorities(memory).tenantAuthorities(
    alice,
    tenant,
  );
  const held = new Map(
    answered?.authorities.map((one) => [one.authority, one]),
  );
  assert.deepEqual(held.get("MemberGranters"), {
    authority: "MemberGranters",
    people: [
      { subject: "alice", mine: true },
      { subject: "bo", mine: false },
    ],
    groups: ["TenantAdmins", "TenantMembers"],
    unnamed: 1,
  });
  assert.deepEqual(held.get("AdminGranters"), {
    authority: "AdminGranters",
    people: [],
    groups: ["TenantAdmins"],
    unnamed: 3,
  });
});

test("a tenant's administrators on the site's authority are named by the tenant, and any other set is counted", async () => {
  const memory = await acme();
  const onSite = (
    relation: string,
    namespace: string,
    object: string,
    holders: ProjectGrantHolderRelation,
  ): ProjectGrant => ({
    namespace: projectAccessSiteNamespace,
    object: projectAccessSiteObject,
    relation,
    holder: { subject: "Holders", namespace, object, relation: holders },
  });
  for (const grant of [
    onSite(
      "account_creators",
      projectAccessTenantNamespace,
      projectAccessTenantObject(other),
      "admins",
    ),
    onSite(
      "account_creators",
      projectAccessTenantNamespace,
      projectAccessTenantObject(tenant),
      "admins",
    ),
    onSite(
      "account_creators",
      projectAccessTenantNamespace,
      projectAccessTenantObject(tenant),
      "members",
    ),
    onSite(
      "authority_managers",
      projectAccessTenantNamespace,
      "not a tenant",
      "admins",
    ),
  ])
    await memory.grants.write(grant);
  const answered = await accessMemoryAuthorities(memory).siteAuthorities(sam);
  assert.deepEqual(
    answered?.authorities.map((held) => [
      held.authority,
      held.groups,
      held.tenants,
      held.unnamed,
    ]),
    [
      ["AccountCreators", ["SiteAdmins"], [tenant, other].sort(), 1],
      ["AuthorityManagers", [], [], 1],
    ],
  );
});

test("each list is answered to a holder of its level's manage kind and to nobody else", async () => {
  const memory = await acme();
  const priya = accessFixturePrincipal("priya");
  const held = accessFixturePrincipal("held");
  accessGiven(memory, priya, [
    { on: "Project", partition: web, kind: "ManageProjectAuthorities" },
  ]);
  accessGiven(memory, held, [
    { on: "Tenant", tenant, kind: "ManageSiteHeldAuthorities" },
  ]);
  const authorities = accessMemoryAuthorities(memory);
  const answeredTo = async (caller: typeof alice) => [
    (await authorities.siteAuthorities(caller)) !== undefined,
    (await authorities.tenantAuthorities(caller, tenant)) !== undefined,
    (await authorities.projectAuthorities(caller, web)) !== undefined,
  ];
  assert.deepEqual(await answeredTo(sam), [true, true, true]);
  assert.deepEqual(await answeredTo(alice), [false, true, true]);
  assert.deepEqual(await answeredTo(priya), [false, false, true]);
  assert.deepEqual(await answeredTo(held), [false, true, false]);
  assert.deepEqual(
    (await authorities.tenantAuthorities(held, tenant))?.authorities.map(
      (one) => one.authority,
    ),
    accessTenantAuthorities,
  );
  for (const caller of [mo, accessFixturePrincipal("nobody")])
    assert.deepEqual(await answeredTo(caller), [false, false, false]);
});

test("an authority whose holders pass the bound answers those within it, every later authority present, and truncated", async () => {
  const memory = await acme(accessMemory(512));
  for (const subject of ["a", "b", "c", "d", "e"])
    await memory.grants.write({
      ...tenantPrincipalGrant({
        issuer: accessFixtureIssuer,
        subject,
        tenant,
        relation: "admins",
      }),
      relation: "admin_granters",
    });
  const answered = await accessMemoryAuthorities(memory, {
    ...accessPlaneBoundsDefault,
    tuplesMax: 4,
  }).tenantAuthorities(alice, tenant);
  assert.equal(answered?.truncated, true);
  assert.deepEqual(
    answered?.authorities.map((held) => [
      held.authority,
      held.people.length + held.groups.length + held.unnamed,
    ]),
    accessTenantAuthorities.map((authority) => [
      authority,
      authority === "AdminGranters" ? 4 : 0,
    ]),
  );
});

test("an authority is read as its own relation, so other tuples on the object fill no bound it is read under", async () => {
  const memory = await acme(accessMemory(512));
  for (const subject of ["a", "b", "c", "d", "e"])
    await memory.grants.write(
      tenantPrincipalGrant({
        issuer: accessFixtureIssuer,
        subject,
        tenant,
        relation: "members",
      }),
    );
  const answered = await accessMemoryAuthorities(memory, {
    ...accessPlaneBoundsDefault,
    tuplesMax: 4,
  }).tenantAuthorities(alice, tenant);
  assert.equal(answered?.truncated, false);
  assert.deepEqual(groupsOf(answered)["HostedRunsGranters"], ["SiteAdmins"]);
});

test("people are marked with who the directory says they are, asked once an answer, and answered by subject alone with no directory", async () => {
  const memory = await acme();
  const ana = directorySubject(1);
  for (const relation of ["admin_granters", "member_granters"])
    for (const subject of [ana, "alice"])
      await memory.grants.write({
        ...tenantPrincipalGrant({
          issuer: accessFixtureIssuer,
          subject,
          tenant,
          relation: "admins",
        }),
        relation,
      });
  const directory = directoryMemory([
    { subject: ana, email: "ana@example.com", githubLogin: "Ana-1" },
  ]);
  const people = async (named?: AccessDirectory) =>
    (
      await accessMemoryAuthorities(
        memory,
        accessPlaneBoundsDefault,
        named,
      ).tenantAuthorities(alice, tenant)
    )?.authorities
      .slice(0, 2)
      .map((held) => held.people);
  const accounted = [
    {
      subject: ana,
      mine: false,
      account: true,
      email: "ana@example.com",
      githubLogin: "Ana-1",
    },
    { subject: "alice", mine: true, account: false },
  ];
  assert.deepEqual(await people(directory.directory), [accounted, accounted]);
  assert.deepEqual(directory.asked, [`accounts:${ana}`]);
  const bare = [
    { subject: ana, mine: false },
    { subject: "alice", mine: true },
  ];
  assert.deepEqual(await people(), [bare, bare]);
});

test("an authority that cannot answer fails each list as it fails a people list", async () => {
  const memory = await acme();
  memory.unavailable = true;
  const authorities = accessMemoryAuthorities(memory);
  for (const answer of [
    authorities.siteAuthorities(sam),
    authorities.tenantAuthorities(sam, tenant),
    authorities.projectAuthorities(sam, web),
  ])
    await assert.rejects(answer, ProjectAccessUnavailable);
});

test("each authority reaches a distinct relation its level declares, and each group a distinct set of the role it names", () => {
  for (const [record, declared] of [
    [accessSiteAuthorityRelations, allSiteAuthorityRelations],
    [accessTenantAuthorityRelations, allTenantAuthorityRelations],
    [accessProjectAuthorityRelations, allProjectAuthorityRelations],
  ] as const)
    assert.deepEqual(Object.values(record).sort(), [...declared].sort());
  assert.deepEqual(
    Object.keys(accessSiteAuthorityRelations),
    accessSiteAuthorities,
  );
  const place = {
    [projectAccessSiteNamespace]: projectAccessSiteObject,
    [projectAccessTenantNamespace]: projectAccessTenantObject(tenant),
    [projectAccessNamespace]: projectAccessObject(web),
  };
  const sets = accessProjectGroups.map((group) =>
    JSON.stringify(accessGroupSubject(place, group)),
  );
  assert.equal(new Set(sets).size, accessProjectGroups.length);
  for (const group of accessProjectGroups)
    assert.equal(
      accessGroupSubject(place, group).relation,
      accessGroupHolders[group].relation,
    );
  assert.throws(() => accessGroupSubject({}, "SiteAdmins"), RangeError);
});
