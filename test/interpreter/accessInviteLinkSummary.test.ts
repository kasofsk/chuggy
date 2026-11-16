/**
 * A link's summary over an authority and a store held in memory: what it says
 * of each kind of open link and its maker, that it spends nothing and asks the
 * authority nothing, and that every token not naming an open link is answered
 * alike.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectTenantGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  directoryMemory,
  directorySubject,
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
} from "./accessPlaneFixture.ts";

const web = accessFixturePartition("acme", "web");
const tenant = web.tenant;
const maker = directorySubject(1);
const makerPrincipal = accessFixturePrincipal(maker);
const zed = accessFixturePrincipal("zed");

/**
 * A tenant named "Acme Co" with one linked project, whose administrator, known to the directory as
 * `octo-maker`, may make a tenant and an account; with a directory unless
 * `directed` is false and a store unless `stored` is false.
 */
async function summarizing(directed = true, stored = true) {
  const links = stored ? inviteLinkMemory() : undefined;
  links?.names.rows.set(tenant, "Acme Co");
  const memory = accessMemory();
  await memory.grants.write(projectTenantGrant(web));
  await memory.grants.write(
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: maker,
      tenant,
      relation: "admins",
    }),
  );
  accessGivenTenantAdministrator(memory, makerPrincipal, tenant, [web]);
  accessGiven(memory, makerPrincipal, [
    { on: "Site", kind: "CreateTenant" },
    { on: "Site", kind: "CreateAccount" },
    { on: "Site", kind: "ManageSiteAuthorities" },
  ]);
  const directory = directoryMemory([
    {
      subject: maker,
      email: "maker@example.com",
      githubLogin: "octo-maker",
    },
  ]);
  const service = accessMemoryInviteLinks(
    memory,
    links,
    directed ? directory.directory : undefined,
  );
  return { memory, links, directory, service };
}

type Summarizing = Awaited<ReturnType<typeof summarizing>>;

async function tenantLinkMinted(service: Summarizing["service"]) {
  const made = await service.mint(makerPrincipal, tenant, {
    role: "Member",
    projects: [{ project: "web", roles: ["Viewer"] }],
  });
  if (made.outcome !== "Minted") throw new Error(made.outcome);
  return made.minted;
}

async function workspaceLinkMinted(service: Summarizing["service"]) {
  const made = await service.workspaceMint(makerPrincipal, {
    createAccounts: true,
    note: "for the meetup",
  });
  if (made.outcome !== "Minted") throw new Error(made.outcome);
  return made.minted;
}

test("a tenant's open link is summarized as its tenant's display name, its role and its maker's GitHub login, and nothing else", async () => {
  const { service, memory } = await summarizing();
  const { token } = await tenantLinkMinted(service);
  memory.asked.length = 0;
  const summarized = await service.summarized(token);
  assert.deepEqual(summarized, {
    outcome: "Summarized",
    summary: {
      state: "Open",
      kind: "Tenant",
      displayName: "Acme Co",
      role: "Member",
      mintedBy: "octo-maker",
    },
  });
  const said = JSON.stringify(summarized);
  for (const unsaid of [maker, "maker@example.com", "web", "Viewer", "link-"])
    assert.ok(!said.includes(unsaid), unsaid);
  assert.deepEqual(memory.asked, []);
});

test("a tenant no row names is summarized by its id", async () => {
  const { service, links } = await summarizing();
  links?.names.rows.clear();
  const { token } = await tenantLinkMinted(service);
  const summarized = await service.summarized(token);
  assert.equal(summarized.outcome, "Summarized");
  if (summarized.outcome !== "Summarized") return;
  assert.equal(
    summarized.summary.state === "Open" &&
      summarized.summary.kind === "Tenant" &&
      summarized.summary.displayName,
    tenant,
  );
});

test("a workspace link is summarized as its kind and its maker's GitHub login, without its note", async () => {
  const { service } = await summarizing();
  const { token } = await workspaceLinkMinted(service);
  const summarized = await service.summarized(token);
  assert.deepEqual(summarized, {
    outcome: "Summarized",
    summary: { state: "Open", kind: "Workspace", mintedBy: "octo-maker" },
  });
  assert.ok(!JSON.stringify(summarized).includes("meetup"));
});

test("a maker the directory does not name, or a plane with no directory, is summarized with no maker", async () => {
  for (const directed of [true, false]) {
    const { service, directory } = await summarizing(directed);
    directory.accounts.length = 0;
    const { token } = await workspaceLinkMinted(service);
    assert.deepEqual(await service.summarized(token), {
      outcome: "Summarized",
      summary: { state: "Open", kind: "Workspace" },
    });
  }
});

test("a summary spends nothing: the link is summarized open again, and then redeemed as it would have been", async () => {
  const { service, links, memory } = await summarizing();
  for (const minted of [
    await tenantLinkMinted(service),
    await workspaceLinkMinted(service),
  ]) {
    const rows = JSON.stringify(links?.rows);
    const first = await service.summarized(minted.token);
    assert.deepEqual(await service.summarized(minted.token), first);
    assert.equal(JSON.stringify(links?.rows), rows);
    assert.equal(
      (await service.redeemed(zed, minted.token)).outcome,
      "Redeemed",
    );
  }
  assert.equal(memory.batches.length, 2);
});

test("an unknown token and a used, revoked or expired link of either kind are each summarized `Ended` alike", async () => {
  const { service, links } = await summarizing();
  const usedTenant = await tenantLinkMinted(service);
  await service.redeemed(zed, usedTenant.token);
  const usedWorkspace = await workspaceLinkMinted(service);
  await service.redeemed(zed, usedWorkspace.token);
  const revokedTenant = await tenantLinkMinted(service);
  await service.revoked(makerPrincipal, tenant, revokedTenant.link);
  const revokedWorkspace = await workspaceLinkMinted(service);
  await service.workspaceRevoked(makerPrincipal, revokedWorkspace.link);
  const expiredTenant = await tenantLinkMinted(service);
  const expiredWorkspace = await workspaceLinkMinted(service);
  if (links !== undefined) links.nowMs = expiredWorkspace.expiresAtMs;
  const ended = await Promise.all(
    [
      "token-nobody-holds",
      usedTenant.token,
      usedWorkspace.token,
      revokedTenant.token,
      revokedWorkspace.token,
      expiredTenant.token,
      expiredWorkspace.token,
    ].map((token) => service.summarized(token)),
  );
  for (const answered of ended)
    assert.deepEqual(answered, {
      outcome: "Summarized",
      summary: { state: "Ended" },
    });
});

test("a plane with no store summarizes nothing, not configured", async () => {
  const { service, directory } = await summarizing(true, false);
  assert.deepEqual(await service.summarized("token-0"), {
    outcome: "NotConfigured",
  });
  assert.deepEqual(directory.asked, []);
});
