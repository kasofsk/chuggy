/**
 * Giving what exists its default holders, over an authority held in memory
 * where the suite owns every tuple, so what a run considers can be asserted
 * whole: every tenant and project holding a tuple, each once, and nothing
 * written where an object is left or skipped.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AccessDefaultsListingCut,
  accessDefaultsDecided,
  accessDefaultsProvisioned,
  type AccessDefaultsSettings,
} from "../../src/interpreter/accessDefaults.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectAuthorityDefaults,
  projectRelationGrant,
  projectTenantGrant,
  siteAuthorityDefaults,
  tenantAdministratorGrant,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessMemory,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

const administrator = accessFixturePrincipal("alice");
const member = accessFixturePrincipal("bob");
const acme = asTenantId("acme");
const web = accessFixturePartition("acme", "web");
const api = accessFixturePartition("acme", "api");
const orphan = asTenantId("orphan");
const unlinked = accessFixturePartition("orphan", "loose");

const settings: AccessDefaultsSettings = { apply: true, listingPagesMax: 64 };

/** A tuple on `namespace` whose object decodes as nothing this tree writes. */
const undecoded = (namespace: string, object: string): ProjectGrant => ({
  namespace,
  object,
  relation: "admins",
  holder: { subject: "Principal", principal: administrator },
});

/**
 * An authority as the tree wrote one before creations wrote defaults: a tenant
 * with an administrator, a member and two linked projects, a tenant whose only
 * tuple is a member's, a project with no link, and two undecodable objects.
 */
async function existing(): Promise<AccessMemory> {
  const memory = accessMemory();
  for (const grant of [
    tenantAdministratorGrant(administrator, acme),
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "bob",
      tenant: acme,
      relation: "members",
    }),
    projectTenantGrant(web),
    projectRelationGrant(member, web, "developers"),
    projectTenantGrant(api),
    projectRelationGrant(administrator, api, "admins"),
    projectRelationGrant(member, api, "dispatchers"),
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "bob",
      tenant: orphan,
      relation: "members",
    }),
    projectRelationGrant(member, unlinked, "developers"),
    undecoded(projectAccessTenantNamespace, "acme"),
    undecoded(projectAccessNamespace, "9:short"),
  ])
    await memory.grants.write(grant);
  return memory;
}

async function provisioned(
  memory: AccessMemory,
  given: AccessDefaultsSettings = settings,
): Promise<readonly string[]> {
  const lines: string[] = [];
  await accessDefaultsProvisioned(
    { tuples: memory.reader, grants: memory.grants },
    given,
    (line) => lines.push(line),
  );
  return lines;
}

const tenantLine = (tenant: string) =>
  `Tenant:${projectAccessTenantObject(tenant)}`;
const projectLine = (partition: typeof web) =>
  `Project:${projectAccessObject(partition)}`;

const firstRunLines: readonly string[] = [
  "defaults Site:main",
  `defaults ${tenantLine(acme)}`,
  `skipped ${tenantLine(orphan)}: no administrator holds it; grant one its admins first`,
  "skipped Tenant:acme: its name is no tenant's or project's this tree writes",
  `defaults ${projectLine(api)}`,
  `defaults ${projectLine(web)}`,
  `skipped ${projectLine(unlinked)}: no tenant link names its own tenant; link it with provision:project-access first`,
  "skipped Project:9:short: its name is no tenant's or project's this tree writes",
];

test("with no tenant named, every tenant and project holding a tuple is considered once, and only those that may be are given defaults", async () => {
  const memory = await existing();
  const lines = await provisioned(memory);
  assert.deepEqual(lines, firstRunLines);
  assert.equal(new Set(lines).size, lines.length);
  assert.deepEqual(memory.batches, [
    siteAuthorityDefaults(),
    tenantAuthorityDefaults(acme),
    projectAuthorityDefaults(api),
    projectAuthorityDefaults(web),
  ]);
  for (const line of lines) assert.doesNotMatch(line, /alice|bob/u, line);
});

test("without apply the same lines are reported and nothing is written", async () => {
  const memory = await existing();
  const before = [...memory.tuples];
  assert.deepEqual(
    await provisioned(memory, { ...settings, apply: false }),
    firstRunLines,
  );
  assert.deepEqual(memory.batches, []);
  assert.deepEqual(memory.tuples, before);
});

test("a second run leaves everything the first gave defaults, and writes nothing", async () => {
  const memory = await existing();
  await provisioned(memory);
  const written = memory.batches.length;
  const lines = await provisioned(memory);
  assert.equal(memory.batches.length, written);
  assert.deepEqual(
    lines.filter((line) => line.startsWith("left ")),
    [
      "left Site:main: it holds an authority tuple",
      `left ${tenantLine(acme)}: it holds an authority tuple`,
      `left ${projectLine(api)}: it holds an authority tuple`,
      `left ${projectLine(web)}: it holds an authority tuple`,
    ],
  );
  assert.equal(lines.filter((line) => line.startsWith("defaults ")).length, 0);
});

test("a default holder removed after a run is not put back by the next", async () => {
  const memory = await existing();
  await provisioned(memory);
  const [removed] = tenantAuthorityDefaults(acme).filter(
    (grant) => grant.relation === "member_granters",
  );
  assert.ok(removed !== undefined);
  await memory.grants.remove(removed);
  const written = memory.batches.length;
  await provisioned(memory);
  assert.equal(memory.batches.length, written);
  assert.ok(
    !memory.tuples.some(
      (tuple) =>
        tuple.object === projectAccessTenantObject(acme) &&
        tuple.relation === "member_granters",
    ),
  );
});

test("with a tenant named, the site, that tenant and the projects linked to it are considered and nothing else", async () => {
  const memory = await existing();
  assert.deepEqual(await provisioned(memory, { ...settings, tenant: acme }), [
    "defaults Site:main",
    `defaults ${tenantLine(acme)}`,
    `defaults ${projectLine(api)}`,
    `defaults ${projectLine(web)}`,
  ]);
  assert.deepEqual(await provisioned(memory, { ...settings, tenant: orphan }), [
    "left Site:main: it holds an authority tuple",
    `skipped ${tenantLine(orphan)}: no administrator holds it; grant one its admins first`,
  ]);
});

test("a site holding no authority tuple is given its administrators as account and tenant creators, and one holding account creators is written nothing", async () => {
  const fresh = accessMemory();
  await provisioned(fresh);
  assert.deepEqual(
    fresh.batches.flat().map((grant) => grant.relation),
    ["account_creators", "tenant_creators"],
  );
  const older = accessMemory();
  const [creators] = siteAuthorityDefaults().filter(
    (grant) => grant.relation === "account_creators",
  );
  assert.ok(creators !== undefined);
  await older.grants.write(creators);
  assert.deepEqual(await provisioned(older), [
    "left Site:main: it holds an authority tuple",
  ]);
  assert.deepEqual(older.batches, []);
  assert.ok(
    !older.tuples.some((tuple) => tuple.relation === "tenant_creators"),
  );
});

test("a listing its bound cuts fails before anything is written or reported", async () => {
  const memory = await existing();
  const lines: string[] = [];
  await assert.rejects(
    accessDefaultsProvisioned(
      { tuples: memory.reader, grants: memory.grants },
      { ...settings, listingPagesMax: 1 },
      (line) => lines.push(line),
    ),
    AccessDefaultsListingCut,
  );
  assert.deepEqual(memory.batches, []);
  assert.deepEqual(lines, []);
});

test("an object holding any authority relation is left, whatever else it lacks", () => {
  const none = { relations: new Set<string>(), linked: false };
  assert.deepEqual(
    accessDefaultsDecided(
      { level: "Tenant", tenant: acme },
      { ...none, relations: new Set(["site"]) },
    ),
    { decision: "Left" },
  );
  assert.deepEqual(
    accessDefaultsDecided(
      { level: "Project", partition: web },
      { ...none, relations: new Set(["authority_managers"]) },
    ),
    { decision: "Left" },
  );
  assert.deepEqual(
    accessDefaultsDecided(
      { level: "Site" },
      { ...none, relations: new Set(["authority_managers"]) },
    ),
    { decision: "Left" },
  );
  assert.deepEqual(
    accessDefaultsDecided({ level: "Project", partition: web }, none),
    { decision: "Skipped", skip: "Unlinked" },
  );
});
