/**
 * The access plane's decisions over an authority held in memory: who is
 * listed, who may list and change, what a change writes, and where a bound
 * cuts a list short.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessProjectRoles,
  accessTenantRoles,
} from "../../src/contract/accessPlane.ts";
import { accessDirectorySubjectsMax } from "../../src/interpreter/accessDirectory.ts";
import {
  accessPlaneBoundsDefault,
  accessProjectListKinds,
  accessProjectRoleRelations,
  accessTenantListKinds,
  accessTenantRoleRelations,
} from "../../src/interpreter/accessPlane.ts";
import {
  oidcPrincipal,
  principalCharsMax,
} from "../../src/interpreter/principal.ts";
import {
  projectAuthorityDefaults,
  projectPrincipalGrant,
  projectTenantGrant,
  siteAuthorityDefaults,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  directoryMemory,
  directorySubject,
} from "./accessInvitationFixture.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessGiven,
  accessGivenProjectAdministrator,
  accessGivenTenantAdministrator,
  accessMemory,
  accessMemoryPlane,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

const web = accessFixturePartition("acme/co", "web");
const api = accessFixturePartition("acme/co", "api");
const loose = accessFixturePartition("acme/co", "loose");
const tenant = web.tenant;
const alice = accessFixturePrincipal("alice");
const priya = accessFixturePrincipal("priya");

/** Writes one tuple the plane does not write itself, as provisioning would. */
async function seeded(
  memory: AccessMemory,
  grants: readonly Parameters<typeof memory.grants.write>[0][],
): Promise<void> {
  for (const grant of grants) await memory.grants.write(grant);
  memory.changes.length = 0;
}

/**
 * A tenant administered by alice with two linked projects, priya
 * administering one of them, a third project with no link, and holders the
 * list must leave out or only count. Alice and priya hold what the defaults
 * give their roles.
 */
async function acme(memory: AccessMemory = accessMemory()) {
  const as = (
    subject: string,
    relation: string,
    issuer = accessFixtureIssuer,
  ) => tenantPrincipalGrant({ issuer, subject, tenant, relation });
  const on = (subject: string, partition: typeof web, relation: string) =>
    projectPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject,
      ...partition,
      relation,
    });
  await seeded(memory, [
    projectTenantGrant(web),
    projectTenantGrant(api),
    as("alice", "admins"),
    as("bo", "members"),
    as("bo", "hosted_execution"),
    as("elsewhere", "members", "https://other.invalid"),
    on("priya", web, "admins"),
    on("bo", web, "developers"),
    on("bo", api, "dispatchers"),
    on("robot", web, "agents"),
    on("pool", web, "pools"),
    on("stray", loose, "developers"),
  ]);
  accessGivenTenantAdministrator(memory, alice, tenant, [web, api]);
  accessGivenProjectAdministrator(memory, priya, web);
  return { memory, plane: accessMemoryPlane(memory) };
}

test("a tenant's administrator reads every holder with the roles the tuples say, itself marked, and the tenant's projects", async () => {
  const { plane } = await acme();
  assert.deepEqual(await plane.tenantPeople(alice, tenant), {
    tenant,
    projects: ["api", "web"],
    people: [
      {
        subject: "alice",
        mine: true,
        tenantRoles: ["Admin"],
        hostedRuns: false,
        projects: [],
      },
      {
        subject: "bo",
        mine: false,
        tenantRoles: ["Member"],
        hostedRuns: true,
        projects: [
          { project: "api", roles: ["Dispatcher"] },
          { project: "web", roles: ["Developer"] },
        ],
      },
      {
        subject: "priya",
        mine: false,
        tenantRoles: [],
        hostedRuns: false,
        projects: [{ project: "web", roles: ["Admin"] }],
      },
    ],
    otherIssuers: 1,
    truncated: false,
  });
});

test("a caller administering nothing, and a tenant that does not exist, are both absent", async () => {
  const { plane } = await acme();
  assert.equal(await plane.tenantPeople(priya, tenant), undefined);
  assert.equal(
    await plane.tenantPeople(
      alice,
      accessFixturePartition("nobody", "x").tenant,
    ),
    undefined,
  );
  assert.equal(
    await plane.tenantRoleGranted(priya, tenant, "zed", "Member"),
    "Absent",
  );
});

test("a project's administrator lists and changes that project alone, a tenant administrator listed with its role", async () => {
  const { memory, plane } = await acme();
  assert.deepEqual(await plane.projectPeople(priya, web), {
    tenant,
    project: "web",
    people: [
      { subject: "alice", mine: false, tenantAdmin: true, roles: [] },
      { subject: "bo", mine: false, tenantAdmin: false, roles: ["Developer"] },
      { subject: "priya", mine: true, tenantAdmin: false, roles: ["Admin"] },
    ],
    otherIssuers: 0,
    truncated: false,
  });
  assert.equal(await plane.projectPeople(priya, api), undefined);
  assert.equal(
    await plane.projectRoleGranted(priya, api, "zed", "Developer"),
    "Absent",
  );
  assert.equal(
    await plane.projectRoleGranted(priya, web, "zed", "Dispatcher"),
    "Changed",
  );
  assert.equal(
    await plane.projectRoleRemoved(priya, web, "bo", "Developer"),
    "Changed",
  );
  assert.deepEqual(
    memory.changes.map(([verb, grant]) => [verb, grant.relation]),
    [
      ["write", "dispatchers"],
      ["remove", "developers"],
    ],
  );
});

test("a project with no tenant link is not the tenant's: not listed, and its people do not list the tenant's administrator", async () => {
  const { memory, plane } = await acme();
  await seeded(memory, [
    projectPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "priya",
      ...loose,
      relation: "admins",
    }),
  ]);
  const people = await plane.projectPeople(priya, loose);
  assert.deepEqual(
    people?.people.map((person) => person.subject),
    ["priya", "stray"],
  );
  assert.equal(await plane.projectPeople(alice, loose), undefined);
});

test("granting twice and removing twice each succeed, and leave one tuple and then none", async () => {
  const { memory, plane } = await acme();
  const held = () =>
    memory.tuples.filter(
      (tuple) =>
        tuple.subject.subject === "Id" &&
        tuple.subject.id === accessFixturePrincipal("zed"),
    ).length;
  for (const round of ["first", "second"])
    assert.equal(
      await plane.tenantRoleGranted(alice, tenant, "zed", "Member"),
      "Changed",
      round,
    );
  assert.equal(held(), 1);
  for (const round of ["first", "second"])
    assert.equal(
      await plane.tenantRoleRemoved(alice, tenant, "zed", "Member"),
      "Changed",
      round,
    );
  assert.equal(held(), 0);
});

test("the only administrator of a tenant is not removed, and one of two is", async () => {
  const { memory, plane } = await acme();
  assert.equal(
    await plane.tenantRoleRemoved(alice, tenant, "alice", "Admin"),
    "LastTenantAdministrator",
  );
  assert.deepEqual(memory.changes, []);
  assert.equal(
    await plane.tenantRoleGranted(alice, tenant, "zed", "Admin"),
    "Changed",
  );
  assert.equal(
    await plane.tenantRoleRemoved(alice, tenant, "alice", "Admin"),
    "Changed",
  );
  assert.deepEqual(
    (await plane.tenantPeople(alice, tenant))?.people
      .filter((person) => person.tenantRoles.includes("Admin"))
      .map((person) => person.subject),
    ["zed"],
  );
});

test("a tenant and projects carrying their defaults list the same people and roles, and the only administrator is still kept", async () => {
  const bare = await acme();
  const { memory, plane } = await acme();
  await seeded(memory, [
    ...siteAuthorityDefaults(),
    ...tenantAuthorityDefaults(tenant),
    ...[web, api, loose].flatMap(projectAuthorityDefaults),
  ]);
  assert.deepEqual(
    await plane.tenantPeople(alice, tenant),
    await bare.plane.tenantPeople(alice, tenant),
  );
  for (const [caller, partition] of [
    [priya, web],
    [alice, api],
    [priya, loose],
  ] as const)
    assert.deepEqual(
      await plane.projectPeople(caller, partition),
      await bare.plane.projectPeople(caller, partition),
      partition.project,
    );
  assert.equal(
    await plane.tenantRoleRemoved(alice, tenant, "alice", "Admin"),
    "LastTenantAdministrator",
  );
  assert.deepEqual(memory.changes, []);
});

test("a caller answered the list is refused a role whose grant kind they lack, and nothing is written", async () => {
  const { memory, plane } = await acme();
  const mo = accessFixturePrincipal("mo");
  const sam = accessFixturePrincipal("sam");
  accessGiven(memory, mo, [{ on: "Tenant", tenant, kind: "GrantMember" }]);
  accessGiven(memory, sam, [
    { on: "Project", partition: web, kind: "ManageProjectAuthorities" },
    { on: "Project", partition: web, kind: "GrantDeveloper" },
  ]);
  assert.equal((await plane.tenantPeople(mo, tenant))?.tenant, tenant);
  assert.equal(
    await plane.tenantRoleGranted(mo, tenant, "zed", "Member"),
    "Changed",
  );
  assert.equal(
    await plane.tenantRoleRemoved(mo, tenant, "zed", "Member"),
    "Changed",
  );
  memory.changes.length = 0;
  for (const change of [
    plane.tenantRoleGranted(mo, tenant, "zed", "Admin"),
    plane.tenantRoleRemoved(mo, tenant, "alice", "Admin"),
    plane.projectRoleGranted(sam, web, "zed", "Dispatcher"),
    plane.projectRoleRemoved(sam, web, "priya", "Admin"),
  ])
    assert.equal(await change, "Refused");
  assert.equal((await plane.projectPeople(sam, web))?.project, "web");
  assert.equal(
    await plane.projectRoleGranted(sam, web, "zed", "Developer"),
    "Changed",
  );
  assert.equal(
    await plane.projectRoleGranted(sam, api, "zed", "Developer"),
    "Absent",
  );
  assert.equal(await plane.tenantPeople(sam, tenant), undefined);
  assert.deepEqual(
    memory.changes.map(([verb, grant]) => [verb, grant.relation]),
    [["write", "developers"]],
  );
});

test("an administrator of a tenant and a project carrying no defaults is answered both lists and refused every change", async () => {
  const memory = accessMemory();
  await seeded(memory, [
    projectTenantGrant(web),
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant,
      relation: "admins",
    }),
  ]);
  const plane = accessMemoryPlane(memory);
  assert.notEqual(await plane.tenantPeople(alice, tenant), undefined);
  assert.notEqual(await plane.projectPeople(alice, web), undefined);
  for (const role of accessTenantRoles)
    assert.equal(
      await plane.tenantRoleGranted(alice, tenant, "zed", role),
      "Refused",
    );
  for (const role of accessProjectRoles)
    assert.equal(
      await plane.projectRoleGranted(alice, web, "zed", role),
      "Refused",
    );
  assert.deepEqual(memory.changes, []);
});

test("a list asks its kinds in order until one is held, and a caller holding none is asked each once", async () => {
  const { memory, plane } = await acme();
  const mo = accessFixturePrincipal("mo");
  accessGiven(memory, mo, [
    { on: "Tenant", tenant, kind: "GrantMember" },
    { on: "Project", partition: web, kind: "GrantDeveloper" },
  ]);
  const asked = async (list: () => Promise<unknown>) => {
    memory.asked.length = 0;
    await list();
    return [...memory.asked];
  };
  assert.deepEqual(await asked(() => plane.tenantPeople(alice, tenant)), [
    "AdministerTenant",
  ]);
  assert.deepEqual(await asked(() => plane.tenantPeople(mo, tenant)), [
    "AdministerTenant",
    "GrantTenantAdmin",
    "GrantMember",
  ]);
  assert.deepEqual(
    await asked(() => plane.tenantPeople(priya, tenant)),
    accessTenantListKinds,
  );
  assert.deepEqual(await asked(() => plane.projectPeople(mo, web)), [
    "Administer",
    "GrantProjectAdmin",
    "GrantDeveloper",
  ]);
  assert.deepEqual(
    await asked(() => plane.projectPeople(mo, api)),
    accessProjectListKinds,
  );
});

test("each role reaches only the relation its record names, and every relation those records name is a role's", () => {
  assert.deepEqual(
    accessTenantRoles.map((role) => accessTenantRoleRelations[role]),
    ["admins", "members"],
  );
  assert.deepEqual(
    accessProjectRoles.map((role) => accessProjectRoleRelations[role]),
    ["admins", "developers", "dispatchers"],
  );
});

test("a subject is carried as the principal of the plane's issuer, separators whole, up to the principal's bound and not past it", async () => {
  const { memory, plane } = await acme();
  await plane.projectRoleGranted(alice, web, "a/b:c 7", "Developer");
  const [, grant] = memory.changes[0] ?? [];
  assert.deepEqual(grant?.holder, {
    subject: "Principal",
    principal: oidcPrincipal(accessFixtureIssuer, "a/b:c 7"),
  });
  const prefix = `${String(accessFixtureIssuer.length)}:${accessFixtureIssuer}`;
  const widest = "w".repeat(principalCharsMax - prefix.length);
  assert.equal(
    await plane.tenantRoleGranted(alice, tenant, widest, "Member"),
    "Changed",
  );
  await assert.rejects(
    plane.tenantRoleGranted(alice, tenant, `${widest}w`, "Member"),
    RangeError,
  );
});

test("a list past each of its bounds answers truncated and no more than the bound", async () => {
  const bounds = { pagesMax: 64, tuplesMax: 512, projectsMax: 32 };
  const listed = async (narrowed: Partial<typeof bounds>) => {
    const memory = accessMemory();
    await acme(memory);
    const people = await accessMemoryPlane(memory, {
      ...bounds,
      ...narrowed,
    }).tenantPeople(alice, tenant);
    return { memory, people };
  };
  assert.equal((await listed({})).people?.truncated, false);
  const pages = await listed({ pagesMax: 2 });
  assert.equal(pages.people?.truncated, true);
  assert.equal(pages.memory.pages, 2);
  const tuples = await listed({ tuplesMax: 3 });
  assert.equal(tuples.people?.truncated, true);
  assert.ok((tuples.people?.people.length ?? 0) <= 3);
  const projects = await listed({ projectsMax: 1 });
  assert.equal(projects.people?.truncated, true);
  assert.deepEqual(projects.people?.projects, ["api"]);
});

const ana = directorySubject(1);
const ghost = directorySubject(2);
const quiet = directorySubject(3);

/** A tenant whose people are an account with a login, one without, a UUID the directory has not, and a subject of no UUID's shape. */
async function accounted(memory: AccessMemory = accessMemory()) {
  const directory = directoryMemory([
    { subject: ana, email: "ana@example.com", githubLogin: "Ana-1" },
    { subject: quiet, email: "quiet@example.com" },
  ]);
  const plane = accessMemoryPlane(
    memory,
    accessPlaneBoundsDefault,
    directory.directory,
  );
  await seeded(memory, [
    projectTenantGrant(web),
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant,
      relation: "admins",
    }),
    ...[ana, ghost, quiet].map((subject) =>
      projectPrincipalGrant({
        issuer: accessFixtureIssuer,
        subject,
        ...web,
        relation: "developers",
      }),
    ),
  ]);
  return { memory, directory, plane };
}

test("both lists mark each subject with who the directory says it is, asking once and never about a subject of no UUID's shape", async () => {
  const { directory, plane } = await accounted();
  const expected = {
    [ana]: { account: true, email: "ana@example.com", githubLogin: "Ana-1" },
    [ghost]: { account: false },
    [quiet]: { account: true, email: "quiet@example.com" },
    alice: { account: false },
  };
  const of = (person: Readonly<Record<string, unknown>>) =>
    Object.fromEntries(
      ["account", "email", "githubLogin"].flatMap((field) =>
        person[field] === undefined ? [] : [[field, person[field]]],
      ),
    );
  const tenantPeople = await plane.tenantPeople(alice, tenant);
  assert.deepEqual(
    Object.fromEntries(
      (tenantPeople?.people ?? []).map((person) => [
        person.subject,
        of(person),
      ]),
    ),
    expected,
  );
  const projectPeople = await plane.projectPeople(alice, web);
  assert.deepEqual(
    Object.fromEntries(
      (projectPeople?.people ?? []).map((person) => [
        person.subject,
        of(person),
      ]),
    ),
    expected,
  );
  assert.deepEqual(directory.asked, [
    `accounts:${[ana, ghost, quiet].join(",")}`,
    `accounts:${[ana, ghost, quiet].join(",")}`,
  ]);
});

test("a list asks the directory about no more subjects than the bound, and those past it carry none of its fields", async () => {
  const { memory, directory, plane } = await accounted(accessMemory(512));
  const many = Array.from({ length: accessDirectorySubjectsMax }, (_, index) =>
    directorySubject(100 + index),
  );
  await seeded(
    memory,
    many.map((subject) =>
      tenantPrincipalGrant({
        issuer: accessFixtureIssuer,
        subject,
        tenant,
        relation: "members",
      }),
    ),
  );
  const people = (await plane.tenantPeople(alice, tenant))?.people ?? [];
  const asked = (directory.asked[0] ?? "").slice("accounts:".length).split(",");
  assert.equal(directory.asked.length, 1);
  assert.equal(asked.length, accessDirectorySubjectsMax);
  const unasked = people.filter((person) => person.account === undefined);
  assert.equal(unasked.length, 3);
  assert.ok(unasked.every((person) => !asked.includes(person.subject)));
});

test("a list with no directory answers no directory field", async () => {
  const { memory } = await accounted();
  const people = await accessMemoryPlane(memory).tenantPeople(alice, tenant);
  assert.ok(
    (people?.people ?? []).every(
      (person) =>
        !("account" in person) &&
        !("email" in person) &&
        !("githubLogin" in person),
    ),
  );
});
