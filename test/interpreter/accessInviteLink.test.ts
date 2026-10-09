/**
 * Invite links over an authority and a store held in memory: who may make,
 * list and revoke one, what redeeming grants and to whom, what a grant that
 * faults leaves behind, and which tokens the registration gate admits.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccessInvitationGrants } from "../../src/contract/accessPlane.ts";
import {
  ProjectAccessUnavailable,
  projectAccessObject,
  projectAccessTenantObject,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectTenantGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  accessMemoryInvitations,
  directoryMemory,
  directorySubject,
  githubMemory,
  githubUser,
} from "./accessInvitationFixture.ts";
import {
  accessMemoryInviteLinks,
  inviteLinkMemory,
} from "./accessInviteLinkFixture.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessGiven,
  accessGivenTenantAdministrator,
  accessMemory,
  type AccessMemory,
} from "./accessPlaneFixture.ts";

const web = accessFixturePartition("acme", "web");
const tenant = web.tenant;
const alice = accessFixturePrincipal("alice");
const bob = accessFixturePrincipal("bob");
const dee = accessFixturePrincipal("dee");
const zed = accessFixturePrincipal("zed");

/** What every case's link grants: membership, and two roles on `web`. */
const granted: AccessInvitationGrants = {
  role: "Member",
  projects: [{ project: "web", roles: ["Developer", "Dispatcher"] }],
};

/**
 * A tenant with one linked project that alice and bob administer, alice alone
 * making accounts, dee granting `Member` and `Developer` on `web` and zed
 * holding nothing; with a store unless `stored` is false.
 */
async function linked(stored = true) {
  const links = stored ? inviteLinkMemory() : undefined;
  const memory = accessMemory();
  await memory.grants.write(projectTenantGrant(web));
  for (const subject of ["alice", "bob"])
    await memory.grants.write(
      tenantPrincipalGrant({
        issuer: accessFixtureIssuer,
        subject,
        tenant,
        relation: "admins",
      }),
    );
  memory.changes.length = 0;
  accessGivenTenantAdministrator(memory, alice, tenant, [web]);
  accessGivenTenantAdministrator(memory, bob, tenant, [web]);
  accessGiven(memory, alice, [{ on: "Site", kind: "CreateAccount" }]);
  accessGiven(memory, dee, [
    { on: "Tenant", tenant, kind: "GrantMember" },
    { on: "Project", partition: web, kind: "GrantDeveloper" },
  ]);
  memory.asked.length = 0;
  return { memory, links, service: accessMemoryInviteLinks(memory, links) };
}

/** A link alice made, its id and its token. */
async function minted(
  service: Awaited<ReturnType<typeof linked>>["service"],
  grants = granted,
) {
  const result = await service.mint(alice, tenant, grants);
  assert.equal(result.outcome, "Minted");
  if (result.outcome !== "Minted") throw new Error("not minted");
  return result.minted;
}

/** Every tuple `memory` holds, as text. */
function held(memory: AccessMemory): readonly string[] {
  return memory.tuples.map((tuple) => JSON.stringify(tuple)).sort();
}

test("a link answers its token once, expires a lifetime after it was made, and is listed open with what it grants", async () => {
  const { links, service } = await linked();
  const link = await minted(service);
  assert.deepEqual(link, {
    link: link.link,
    token: "token-0",
    expiresAtMs: (links?.nowMs ?? 0) + 7 * 24 * 60 * 60 * 1_000,
    newAccounts: true,
  });
  assert.equal(links?.rows[0]?.digest, "digest:token-0");
  const listed = await service.listed(alice, tenant);
  assert.equal(listed.outcome, "Listed");
  if (listed.outcome !== "Listed") return;
  assert.deepEqual(listed.listed.links, [
    {
      link: link.link,
      role: "Member",
      projects: granted.projects,
      newAccounts: true,
      state: "Open",
      mintedBy: { subject: "alice" },
      mintedAtMs: links?.nowMs,
      expiresAtMs: link.expiresAtMs,
    },
  ]);
});

test("a caller missing the kind for one project role named is refused and nothing is stored or drawn", async () => {
  const { memory, links, service } = await linked();
  assert.deepEqual(await service.mint(dee, tenant, granted), {
    outcome: "Refused",
  });
  assert.deepEqual(links?.rows, []);
  assert.deepEqual(links?.drawn, []);
  assert.deepEqual(memory.asked.at(-1), [
    "GrantDispatcher",
    projectAccessObject(web),
  ]);
  assert.ok(!memory.asked.some(([kind]) => kind === "CreateAccount"));
});

test("a mint asks what an invitation asks: absent to a caller not answered the list, and a project not the tenant's unknown, each storing nothing", async () => {
  const { links, service } = await linked();
  assert.deepEqual(await service.mint(zed, tenant, granted), {
    outcome: "Absent",
  });
  assert.deepEqual(
    await service.mint(alice, tenant, {
      role: "Member",
      projects: [{ project: "elsewhere", roles: ["Viewer"] }],
    }),
    { outcome: "ProjectUnknown" },
  );
  assert.deepEqual(links?.rows, []);
});

test("`newAccounts` follows `CreateAccount`, and the link is made either way", async () => {
  const { links, service } = await linked();
  assert.equal((await minted(service)).newAccounts, true);
  const other = await service.mint(bob, tenant, granted);
  assert.equal(other.outcome, "Minted");
  assert.equal(
    other.outcome === "Minted" ? other.minted.newAccounts : undefined,
    false,
  );
  assert.deepEqual(
    links?.rows.map((row) => [row.mintedBy, row.newAccounts]),
    [
      ["alice", true],
      ["bob", false],
    ],
  );
});

test("a redemption writes the caller exactly the tuples an invitation of the same roles writes, as one request, though they hold no kind at all", async () => {
  const { memory, links, service } = await linked();
  const link = await minted(service);
  memory.asked.length = 0;
  assert.deepEqual(await service.redeemed(zed, link.token), {
    outcome: "Redeemed",
    redeemed: { tenant, role: "Member", projects: granted.projects },
  });
  assert.deepEqual(memory.asked, []);
  assert.deepEqual(memory.changes, []);
  assert.equal(memory.batches.length, 1);

  const invited = await linked();
  const directory = directoryMemory([
    { subject: "zed", email: "zed@example.com", githubId: "990000009" },
  ]);
  await accessMemoryInvitations(
    invited.memory,
    directory,
    githubMemory({ zed: githubUser("990000009", "zed") }),
  ).invite(alice, tenant, {
    github: "zed",
    email: "zed@example.com",
    ...granted,
  });
  assert.deepEqual(
    memory.batches[0],
    invited.memory.changes.map(([, grant]) => grant),
  );
  assert.equal(links?.rows[0]?.used?.by, "zed");
});

test("a grant that faults gives the link back open, grants nothing, and rejects, and the link is then spent", async () => {
  const { memory, links, service } = await linked();
  const link = await minted(service);
  const before = held(memory);
  memory.unavailable = true;
  await assert.rejects(
    service.redeemed(zed, link.token),
    ProjectAccessUnavailable,
  );
  memory.unavailable = false;
  assert.equal(links?.rows[0]?.used, undefined);
  assert.deepEqual(held(memory), before);
  assert.deepEqual(memory.batches, []);
  assert.equal((await service.redeemed(zed, link.token)).outcome, "Redeemed");
});

test("an unknown token and a used, revoked or expired link are each absent, and grant nothing", async () => {
  const { memory, links, service } = await linked();
  assert.deepEqual(await service.redeemed(zed, "token-none"), {
    outcome: "Absent",
  });
  const used = await minted(service);
  await service.redeemed(bob, used.token);
  const revoked = await minted(service);
  assert.deepEqual(await service.revoked(alice, tenant, revoked.link), {
    outcome: "Revoked",
  });
  const expired = await minted(service);
  if (links !== undefined) links.nowMs = expired.expiresAtMs;
  memory.batches.length = 0;
  for (const token of [used.token, revoked.token, expired.token])
    assert.deepEqual(await service.redeemed(zed, token), {
      outcome: "Absent",
    });
  assert.deepEqual(memory.batches, []);
});

test("revoking asks the kinds the link's own roles need, so a caller who may grant `Member` but not a project role it carries is refused", async () => {
  const { memory, service } = await linked();
  const link = await minted(service);
  memory.asked.length = 0;
  assert.deepEqual(await service.revoked(dee, tenant, link.link), {
    outcome: "Refused",
  });
  assert.deepEqual(memory.asked.slice(-3), [
    ["GrantMember", projectAccessTenantObject(tenant)],
    ["GrantDeveloper", projectAccessObject(web)],
    ["GrantDispatcher", projectAccessObject(web)],
  ]);
  const lesser = await minted(service, {
    role: "Member",
    projects: [{ project: "web", roles: ["Developer"] }],
  });
  assert.deepEqual(await service.revoked(dee, tenant, lesser.link), {
    outcome: "Revoked",
  });
  assert.deepEqual(await service.revoked(bob, tenant, link.link), {
    outcome: "Revoked",
  });
  assert.deepEqual(await service.revoked(bob, tenant, link.link), {
    outcome: "Ended",
  });
  assert.deepEqual(await service.revoked(bob, tenant, "no-such-link"), {
    outcome: "Absent",
  });
  assert.deepEqual(await service.revoked(zed, tenant, lesser.link), {
    outcome: "Absent",
  });
});

test("the list is absent to a caller not answered the tenant's people, and carries no token or digest", async () => {
  const { service } = await linked();
  const link = await minted(service);
  await service.redeemed(zed, link.token);
  assert.deepEqual(await service.listed(zed, tenant), { outcome: "Absent" });
  const listed = JSON.stringify(await service.listed(alice, tenant));
  assert.ok(!listed.includes(link.token), listed);
  assert.ok(!listed.includes("digest"), listed);
  assert.ok(listed.includes('"usedBy":{"subject":"zed"}'), listed);
});

test("every subject a list answers is named by the directory in one question, each once", async () => {
  const minter = directorySubject(1);
  const user = directorySubject(2);
  const { memory, links } = await linked();
  accessGivenTenantAdministrator(
    memory,
    accessFixturePrincipal(minter),
    tenant,
    [web],
  );
  const directory = directoryMemory([
    { subject: minter, email: "m@example.com", githubLogin: "minter" },
    { subject: user, email: "u@example.com" },
  ]);
  const service = accessMemoryInviteLinks(memory, links, directory.directory);
  for (const redeemer of [user, user]) {
    const made = await service.mint(accessFixturePrincipal(minter), tenant, {
      role: "Member",
    });
    if (made.outcome === "Minted")
      await service.redeemed(
        accessFixturePrincipal(redeemer),
        made.minted.token,
      );
  }
  const listed = await service.listed(accessFixturePrincipal(minter), tenant);
  assert.deepEqual(directory.asked, [`accounts:${minter},${user}`]);
  assert.equal(listed.outcome, "Listed");
  if (listed.outcome !== "Listed") return;
  for (const link of listed.listed.links) {
    assert.deepEqual(link.mintedBy, {
      subject: minter,
      account: true,
      email: "m@example.com",
      githubLogin: "minter",
    });
    assert.equal(link.state, "Used");
  }
});

test("a plane with no store answers every route not configured before it asks the authority anything", async () => {
  const { memory, service } = await linked(false);
  assert.deepEqual(await service.mint(alice, tenant, granted), {
    outcome: "NotConfigured",
  });
  assert.deepEqual(await service.listed(alice, tenant), {
    outcome: "NotConfigured",
  });
  assert.deepEqual(await service.revoked(alice, tenant, "link"), {
    outcome: "NotConfigured",
  });
  assert.deepEqual(await service.redeemed(zed, "token"), {
    outcome: "NotConfigured",
  });
  assert.deepEqual(memory.asked, []);
  assert.equal(memory.pages, 0);
});

/** Each token the registration gate is asked about, set up as its case names, and whether it is admitted. */
const registrationCases: readonly (readonly [
  string,
  (made: Awaited<ReturnType<typeof linked>>) => Promise<string | undefined>,
  boolean,
])[] = [
  [
    "an open link with `newAccounts`",
    async ({ service }) => (await minted(service)).token,
    true,
  ],
  [
    "an open link without `newAccounts`",
    async ({ service }) => {
      const made = await service.mint(bob, tenant, granted);
      return made.outcome === "Minted" ? made.minted.token : undefined;
    },
    false,
  ],
  [
    "a used link",
    async ({ service }) => {
      const link = await minted(service);
      await service.redeemed(zed, link.token);
      return link.token;
    },
    false,
  ],
  [
    "a revoked link",
    async ({ service }) => {
      const link = await minted(service);
      await service.revoked(alice, tenant, link.link);
      return link.token;
    },
    false,
  ],
  [
    "an expired link",
    async ({ links, service }) => {
      const link = await minted(service);
      if (links !== undefined) links.nowMs = link.expiresAtMs;
      return link.token;
    },
    false,
  ],
  ["an unknown token", () => Promise.resolve("token-none"), false],
  ["an empty token", () => Promise.resolve(""), false],
  ["an absent token", () => Promise.resolve(undefined), false],
];

for (const [name, presented, admitted] of registrationCases)
  test(`the registration gate ${admitted ? "admits" : "refuses"} ${name}`, async () => {
    const made = await linked();
    const token = await presented(made);
    assert.equal(await made.service.registrationAdmitted(token), admitted);
  });

test("a link admitted to registration is still open, and a redemption after it is given it", async () => {
  const { links, service } = await linked();
  const link = await minted(service);
  assert.equal(await service.registrationAdmitted(link.token), true);
  assert.equal(await service.registrationAdmitted(link.token), true);
  assert.equal(links?.rows[0]?.used, undefined);
  const listed = await service.listed(alice, tenant);
  assert.equal(
    listed.outcome === "Listed" ? listed.listed.links[0]?.state : undefined,
    "Open",
  );
  assert.equal((await service.redeemed(zed, link.token)).outcome, "Redeemed");
});

test("a plane with no store refuses every registration, and a store that rejects makes the gate reject", async () => {
  assert.equal(
    await (await linked(false)).service.registrationAdmitted("token-0"),
    false,
  );
  const { links, service } = await linked();
  const link = await minted(service);
  const fault = new Error("store down");
  if (links !== undefined)
    Object.assign(links.store, { opened: () => Promise.reject(fault) });
  await assert.rejects(service.registrationAdmitted(link.token), fault);
});
