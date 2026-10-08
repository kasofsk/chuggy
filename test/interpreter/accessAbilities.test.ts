/**
 * What a caller may do, over an authority held in memory: who is answered,
 * each kind asked once on each object, and the bounds a tenant's projects are
 * read under.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessPlaneBoundsDefault,
  accessProjectListKinds,
  accessTenantListKinds,
} from "../../src/interpreter/accessPlane.ts";
import {
  ProjectAccessUnavailable,
  projectAccessObject,
  projectAccessSiteObject,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectTenantGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessGiven,
  accessGivenTenantAdministrator,
  accessMemory,
  accessMemoryAbilities,
  accessMemoryPlane,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

const web = accessFixturePartition("acme/co", "web");
const api = accessFixturePartition("acme/co", "api");
const tenant = web.tenant;
const alice = accessFixturePrincipal("alice");
const mo = accessFixturePrincipal("mo");
const nobody = accessFixturePrincipal("nobody");

const tenantObject = projectAccessTenantObject(tenant);

/** The kinds a tenant's answer asks on each project, in the order it asks them. */
const projectKinds = [
  "GrantProjectAdmin",
  "GrantDeveloper",
  "GrantDispatcher",
  "ManageProjectAuthorities",
];

/** A tenant alice administers, holding what the defaults give her, with `partitions` linked to it; mo holds `GrantMember` alone. */
async function acme(
  partitions: readonly Partition[] = [web, api],
  memory: AccessMemory = accessMemory(),
) {
  for (const grant of [
    ...partitions.map(projectTenantGrant),
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant,
      relation: "admins",
    }),
  ])
    await memory.grants.write(grant);
  accessGivenTenantAdministrator(memory, alice, tenant, partitions);
  accessGiven(memory, mo, [{ on: "Tenant", tenant, kind: "GrantMember" }]);
  return memory;
}

/** What `answer` asked of the authority, each kind beside its object. */
async function askedBy(
  memory: AccessMemory,
  answer: () => Promise<unknown>,
): Promise<readonly (readonly [string, string])[]> {
  memory.asked.length = 0;
  await answer();
  return [...memory.asked];
}

test("a tenant's answer asks each list kind once, then `CreateAccount`, then each project's kinds once on that project, for whoever holds any list kind", async () => {
  const memory = await acme();
  const abilities = accessMemoryAbilities(memory);
  const expected = [
    ...accessTenantListKinds.map((kind) => [kind, tenantObject] as const),
    ["CreateAccount", projectAccessSiteObject] as const,
    ...[api, web].flatMap((partition) =>
      projectKinds.map(
        (kind) => [kind, projectAccessObject(partition)] as const,
      ),
    ),
  ];
  for (const caller of [alice, mo])
    assert.deepEqual(
      await askedBy(memory, () => abilities.tenantAbilities(caller, tenant)),
      expected,
      caller,
    );
  assert.deepEqual(
    await askedBy(memory, () => abilities.tenantAbilities(nobody, tenant)),
    accessTenantListKinds.map((kind) => [kind, tenantObject]),
  );
});

test("a project's answer and the site's each ask their kinds once, whoever asks", async () => {
  const memory = await acme();
  const abilities = accessMemoryAbilities(memory);
  for (const caller of [alice, mo, nobody]) {
    assert.deepEqual(
      await askedBy(memory, () => abilities.projectAbilities(caller, web)),
      accessProjectListKinds.map((kind) => [kind, projectAccessObject(web)]),
      caller,
    );
    assert.deepEqual(
      await askedBy(memory, () => abilities.siteAbilities(caller)),
      ["AdministerSite", "CreateAccount", "ManageSiteAuthorities"].map(
        (kind) => [kind, projectAccessSiteObject],
      ),
      caller,
    );
  }
});

test("each ability is the kind's own answer, and a caller holding no kind of a level is absent there", async () => {
  const memory = await acme();
  const abilities = accessMemoryAbilities(memory);
  const everything = { roles: ["Admin", "Developer", "Dispatcher"] };
  assert.deepEqual(await abilities.tenantAbilities(alice, tenant), {
    tenant,
    roles: ["Admin", "Member"],
    grantHostedRuns: false,
    createAccount: false,
    manageAuthorities: true,
    manageSiteHeldAuthorities: false,
    projects: [
      { project: "api", ...everything, manageAuthorities: true },
      { project: "web", ...everything, manageAuthorities: true },
    ],
    truncated: false,
  });
  assert.deepEqual(await abilities.tenantAbilities(mo, tenant), {
    tenant,
    roles: ["Member"],
    grantHostedRuns: false,
    createAccount: false,
    manageAuthorities: false,
    manageSiteHeldAuthorities: false,
    projects: [
      { project: "api", roles: [], manageAuthorities: false },
      { project: "web", roles: [], manageAuthorities: false },
    ],
    truncated: false,
  });
  assert.deepEqual(await abilities.projectAbilities(alice, web), {
    tenant,
    project: "web",
    ...everything,
    manageAuthorities: true,
  });
  assert.equal(await abilities.tenantAbilities(nobody, tenant), undefined);
  assert.equal(await abilities.projectAbilities(mo, web), undefined);
  assert.equal(await abilities.siteAbilities(alice), undefined);
  accessGiven(memory, mo, [{ on: "Site", kind: "CreateAccount" }]);
  assert.deepEqual(await abilities.siteAbilities(mo), {
    administer: false,
    createAccount: true,
    manageAuthorities: false,
  });
  assert.equal(
    (await abilities.tenantAbilities(mo, tenant))?.createAccount,
    true,
  );
});

test("a tenant with more projects than the bound answers the first within it, sorted, and truncated", async () => {
  const many = ["d", "b", "a", "c"].map((project) =>
    accessFixturePartition("acme/co", project),
  );
  const memory = await acme(many);
  const answered = await accessMemoryAbilities(memory, {
    ...accessPlaneBoundsDefault,
    projectsMax: 2,
  }).tenantAbilities(alice, tenant);
  assert.deepEqual(
    answered?.projects.map((project) => project.project),
    ["a", "b"],
  );
  assert.equal(answered?.truncated, true);
});

test("a tenant whose own tuples fill a list's budget still names its projects", async () => {
  const memory = await acme();
  for (const subject of ["m1", "m2", "m3", "m4"])
    await memory.grants.write(
      tenantPrincipalGrant({
        issuer: accessFixtureIssuer,
        subject,
        tenant,
        relation: "members",
      }),
    );
  const bounds = { ...accessPlaneBoundsDefault, tuplesMax: 4 };
  const people = await accessMemoryPlane(memory, bounds).tenantPeople(
    alice,
    tenant,
  );
  assert.deepEqual(people?.projects, []);
  assert.equal(people?.truncated, true);
  const answered = await accessMemoryAbilities(memory, bounds).tenantAbilities(
    alice,
    tenant,
  );
  assert.deepEqual(
    answered?.projects.map((project) => project.project),
    ["api", "web"],
  );
  assert.equal(answered?.truncated, false);
});

test("an authority that cannot answer fails each answer as it fails a list", async () => {
  const memory = await acme();
  memory.unavailable = true;
  const abilities = accessMemoryAbilities(memory);
  await assert.rejects(
    accessMemoryPlane(memory).tenantPeople(alice, tenant),
    ProjectAccessUnavailable,
  );
  for (const answer of [
    abilities.tenantAbilities(alice, tenant),
    abilities.projectAbilities(alice, web),
    abilities.siteAbilities(alice),
  ])
    await assert.rejects(answer, ProjectAccessUnavailable);
});
