/**
 * The site's tenants over an authority held in memory: which tenants are
 * listed, who administers each and whether they may make accounts, who is
 * answered, and the bounds and the directory an answer is read under.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccessSiteTenants } from "../../src/contract/accessPlane.ts";
import {
  accessDirectorySubjectsMax,
  type AccessDirectory,
} from "../../src/interpreter/accessDirectory.ts";
import { accessOwnerInvitationGrants } from "../../src/interpreter/accessOwnerInvitation.ts";
import {
  accessPlaneBoundsDefault,
  type AccessPlaneBounds,
} from "../../src/interpreter/accessPlane.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  ProjectAccessUnavailable,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectTenantGrant,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  type ProjectGrant,
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
  accessMemory,
  accessMemorySiteTenants,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

const sita = accessFixturePrincipal("sita");

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

/** An authority holding `grants`, where sita may make a tenant. */
async function sited(
  grants: readonly ProjectGrant[],
  memory: AccessMemory = accessMemory(),
): Promise<AccessMemory> {
  for (const grant of grants) await memory.grants.write(grant);
  accessGiven(memory, sita, [{ on: "Site", kind: "CreateTenant" }]);
  return memory;
}

/** The site's tenants as sita is answered them. */
function listed(
  memory: AccessMemory,
  bounds: AccessPlaneBounds = accessPlaneBoundsDefault,
  directory?: AccessDirectory,
): Promise<AccessSiteTenants | undefined> {
  return accessMemorySiteTenants(memory, bounds, directory).siteTenants(sita);
}

/** The tenant one invitation makes, its administrators making accounts. */
const invited = (subject: string, tenant: string) =>
  accessOwnerInvitationGrants(
    accessFixtureIssuer,
    asTenantId(tenant),
    subject,
    true,
  );

test("tenants are answered in name order, each with its administrator, and only the one whose administrators hold `AccountCreators` may make accounts", async () => {
  const memory = await sited([
    ...invited("bo", "owned"),
    heldBy("alice", "acme"),
  ]);
  assert.deepEqual(await listed(memory), {
    tenants: [
      {
        tenant: "acme",
        administrators: [{ subject: "alice", mine: false }],
        unnamed: 0,
        createAccounts: false,
      },
      {
        tenant: "owned",
        administrators: [{ subject: "bo", mine: false }],
        unnamed: 0,
        createAccounts: true,
      },
    ],
    truncated: false,
  });
});

test("a tenant carrying its site link alone is listed with no administrators, and one held only by a member, by a project, or under no tenant's name is not", async () => {
  const memory = await sited([
    ...tenantAuthorityDefaults(asTenantId("linked")),
    heldBy("alice", "membered", "members"),
    projectTenantGrant(accessFixturePartition("inherited", "web")),
  ]);
  memory.tuples.push({
    namespace: projectAccessTenantNamespace,
    object: "not a tenant",
    relation: "admins",
    subject: { subject: "Id", id: accessFixturePrincipal("alice") },
  });
  assert.deepEqual(await listed(memory), {
    tenants: [
      {
        tenant: "linked",
        administrators: [],
        unnamed: 0,
        createAccounts: false,
      },
    ],
    truncated: false,
  });
});

test("a person administering two tenants is named under both, and the caller is mine only where they administer", async () => {
  const memory = await sited([
    heldBy("alice", "acme"),
    heldBy("alice", "beta"),
    heldBy("sita", "beta"),
  ]);
  assert.deepEqual(
    (await listed(memory))?.tenants.map((one) => [
      one.tenant,
      one.administrators,
    ]),
    [
      ["acme", [{ subject: "alice", mine: false }]],
      [
        "beta",
        [
          { subject: "alice", mine: false },
          { subject: "sita", mine: true },
        ],
      ],
    ],
  );
});

test("an administrator under another issuer and a subject set are counted for their tenant and not named, and one in two rows is named once", async () => {
  const memory = await sited([
    heldBy("alice", "acme"),
    heldBy("bo", "beta"),
    {
      ...heldBy("alice", "acme"),
      holder: {
        subject: "Holders",
        namespace: projectAccessTenantNamespace,
        object: projectAccessTenantObject("beta"),
        relation: "members",
      },
    },
  ]);
  for (const principal of [
    accessFixturePrincipal("alice"),
    oidcPrincipal("https://other.invalid", "far"),
  ])
    memory.tuples.push({
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject("acme"),
      relation: "admins",
      subject: { subject: "Id", id: principal },
    });
  assert.deepEqual(
    (await listed(memory))?.tenants.map((one) => [
      one.tenant,
      one.administrators.map((person) => person.subject),
      one.unnamed,
    ]),
    [
      ["acme", ["alice"], 2],
      ["beta", ["bo"], 0],
    ],
  );
});

test("administrators carry the directory's account, asked once for the whole answer, and their subject alone with no directory", async () => {
  const ana = directorySubject(1);
  const memory = await sited([heldBy(ana, "acme"), heldBy("alice", "beta")]);
  const directory = directoryMemory([
    { subject: ana, email: "ana@example.com", githubLogin: "Ana-1" },
  ]);
  const administrators = async (named?: AccessDirectory) =>
    (await listed(memory, accessPlaneBoundsDefault, named))?.tenants.map(
      (one) => one.administrators,
    );
  assert.deepEqual(await administrators(directory.directory), [
    [
      {
        subject: ana,
        mine: false,
        account: true,
        email: "ana@example.com",
        githubLogin: "Ana-1",
      },
    ],
    [{ subject: "alice", mine: false, account: false }],
  ]);
  assert.deepEqual(directory.asked, [`accounts:${ana}`]);
  assert.deepEqual(await administrators(), [
    [{ subject: ana, mine: false }],
    [{ subject: "alice", mine: false }],
  ]);
});

test("across tenants the directory is asked once about no more subjects than its bound, and administrators past it carry none of its fields", async () => {
  const subjects = Array.from(
    { length: accessDirectorySubjectsMax + 3 },
    (_, index) => directorySubject(100 + index),
  );
  const memory = await sited(
    subjects.map((subject, index) =>
      heldBy(subject, index % 2 === 0 ? "acme" : "beta"),
    ),
    accessMemory(512),
  );
  const directory = directoryMemory();
  const answered = await listed(
    memory,
    accessPlaneBoundsDefault,
    directory.directory,
  );
  const people = answered?.tenants.flatMap((one) => one.administrators) ?? [];
  assert.equal(answered?.truncated, false);
  assert.equal(people.length, subjects.length);
  assert.equal(directory.asked.length, 1);
  const asked = (directory.asked[0] ?? "").slice("accounts:".length).split(",");
  assert.equal(asked.length, accessDirectorySubjectsMax);
  const unasked = people.filter((person) => person.account === undefined);
  assert.equal(unasked.length, 3);
  assert.ok(unasked.every((person) => !asked.includes(person.subject)));
});

test("a listing past the bound answers what it read and truncated, still saying which tenants may make accounts, and one within it is not truncated", async () => {
  const memory = await sited([
    ...invited("bo", "owned"),
    ...["t0", "t1", "t2", "t3"].map((tenant) => heldBy("alice", tenant)),
  ]);
  assert.equal((await listed(memory))?.truncated, false);
  const cut = await listed(memory, {
    ...accessPlaneBoundsDefault,
    tuplesMax: 3,
  });
  assert.equal(cut?.truncated, true);
  assert.deepEqual(
    cut?.tenants.map((one) => [one.tenant, one.createAccounts]),
    [
      ["owned", true],
      ["t0", false],
    ],
  );
});

test("a caller without `CreateTenant` is absent, and neither the listing nor the directory is asked anything", async () => {
  const memory = await sited([heldBy("alice", "acme")]);
  const hal = accessFixturePrincipal("hal");
  accessGiven(memory, hal, [
    { on: "Site", kind: "ManageSiteAuthorities" },
    { on: "Site", kind: "CreateAccount" },
  ]);
  const directory = directoryMemory();
  memory.asked.length = 0;
  assert.equal(
    await accessMemorySiteTenants(
      memory,
      accessPlaneBoundsDefault,
      directory.directory,
    ).siteTenants(hal),
    undefined,
  );
  assert.deepEqual(memory.asked, [["CreateTenant", "main"]]);
  assert.equal(memory.pages, 0);
  assert.deepEqual(directory.asked, []);
});

test("an authority that cannot answer fails the list as every list fails", async () => {
  const memory = await sited([heldBy("alice", "acme")]);
  memory.unavailable = true;
  await assert.rejects(listed(memory), ProjectAccessUnavailable);
});
