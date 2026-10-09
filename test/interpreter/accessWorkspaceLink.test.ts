/**
 * The site's workspace links over an authority and a store held in memory:
 * who may make, list and revoke one, what a person presenting one is answered
 * before and after it is spent, what using one writes, what a grant that
 * faults leaves behind, which tokens the registration gate admits, and that a
 * tenant's links and the site's never meet.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessInviteLinksEndedKept,
  accessInviteLinksOpenMax,
  type AccessWorkspaceLinkCreation,
} from "../../src/contract/accessPlane.ts";
import type { AccessInviteLinkService } from "../../src/interpreter/accessInviteLink.ts";
import { accessOwnerInvitationGrants } from "../../src/interpreter/accessOwnerInvitation.ts";
import {
  projectTenantGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import { projectAccessSiteObject } from "../../src/interpreter/projectAccess.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  accessMemoryInviteLinks,
  inviteLinkDigest,
  inviteLinkMemory,
  inviteLinkOverlapped,
  type InviteLinkMemory,
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
const alice = accessFixturePrincipal("alice");
const sita = accessFixturePrincipal("sita");
const tom = accessFixturePrincipal("tom");
const zed = accessFixturePrincipal("zed");
const dee = accessFixturePrincipal("dee");

const note = "for Octo Cat, handed over at the meetup";

/**
 * A tenant alice administers with one linked project; sita may make a tenant
 * and an account and manage the site's authorities, tom may make a tenant and
 * nothing else, and zed and dee hold nothing; with a store unless `stored` is
 * false.
 */
async function sited(stored = true) {
  const links = stored ? inviteLinkMemory() : undefined;
  const memory = accessMemory();
  await memory.grants.write(projectTenantGrant(web));
  await memory.grants.write(
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant,
      relation: "admins",
    }),
  );
  memory.changes.length = 0;
  accessGivenTenantAdministrator(memory, alice, tenant, [web]);
  accessGiven(memory, alice, [{ on: "Site", kind: "CreateAccount" }]);
  accessGiven(memory, sita, [
    { on: "Site", kind: "CreateTenant" },
    { on: "Site", kind: "CreateAccount" },
    { on: "Site", kind: "ManageSiteAuthorities" },
  ]);
  accessGiven(memory, tom, [{ on: "Site", kind: "CreateTenant" }]);
  memory.asked.length = 0;
  return { memory, links, service: accessMemoryInviteLinks(memory, links) };
}

/** A workspace link `caller` made, its id and its token. */
async function workspaceMinted(
  service: AccessInviteLinkService,
  creation: AccessWorkspaceLinkCreation = { createAccounts: true },
  caller = sita,
) {
  const result = await service.workspaceMint(caller, creation);
  assert.equal(result.outcome, "Minted");
  if (result.outcome !== "Minted") throw new Error("not minted");
  return result.minted;
}

/** A link of alice's tenant granting membership, its id and its token. */
async function tenantMinted(service: AccessInviteLinkService) {
  const result = await service.mint(alice, tenant, { role: "Member" });
  if (result.outcome !== "Minted") throw new Error("not minted");
  return result.minted;
}

/** The row the store keeps for `link`. */
function rowOf(links: InviteLinkMemory | undefined, link: string) {
  return links?.rows.find((row) => row.link === link);
}

/** Whether the link is still open in the store. */
function open(links: InviteLinkMemory | undefined, link: string): boolean {
  const row = rowOf(links, link);
  return (
    row !== undefined &&
    row.used === undefined &&
    row.revokedAtMs === undefined &&
    row.expiresAtMs > (links?.nowMs ?? 0)
  );
}

test("making, listing and revoking a workspace link are each absent to a caller without `CreateTenant`, asked before anything else, and nothing is kept or drawn", async () => {
  const { memory, links, service } = await sited();
  assert.deepEqual(
    await service.workspaceMint(zed, { createAccounts: false }),
    { outcome: "Absent" },
  );
  assert.deepEqual(memory.asked, [["CreateTenant", projectAccessSiteObject]]);
  assert.deepEqual(links?.rows, []);
  assert.deepEqual(links?.drawn, []);
  const made = await workspaceMinted(service, { createAccounts: false });
  memory.asked.length = 0;
  assert.deepEqual(await service.workspaceListed(zed), { outcome: "Absent" });
  assert.deepEqual(await service.workspaceRevoked(zed, made.link), {
    outcome: "Absent",
  });
  assert.deepEqual(memory.asked, [
    ["CreateTenant", projectAccessSiteObject],
    ["CreateTenant", projectAccessSiteObject],
  ]);
  assert.ok(open(links, made.link));
});

test("`createAccounts` without `ManageSiteAuthorities` is refused, to make or to revoke, and nothing is kept or drawn", async () => {
  const { links, service } = await sited();
  assert.deepEqual(
    await service.workspaceMint(tom, { createAccounts: true, note }),
    { outcome: "Refused" },
  );
  assert.deepEqual(links?.rows, []);
  assert.deepEqual(links?.drawn, []);
  const carrying = await workspaceMinted(service, { createAccounts: true });
  const plain = await workspaceMinted(service, { createAccounts: false });
  assert.deepEqual(await service.workspaceRevoked(tom, carrying.link), {
    outcome: "Refused",
  });
  assert.ok(open(links, carrying.link));
  assert.deepEqual(await service.workspaceRevoked(tom, plain.link), {
    outcome: "Revoked",
  });
  assert.deepEqual(await service.workspaceRevoked(tom, plain.link), {
    outcome: "Ended",
  });
  assert.deepEqual(await service.workspaceRevoked(sita, "no-such-link"), {
    outcome: "Absent",
  });
});

test("a workspace link answers its token once, `newAccounts` its maker's `CreateAccount`, and is listed newest first with its note as written", async () => {
  const { links, service } = await sited();
  const noted = await workspaceMinted(service, { createAccounts: true, note });
  assert.deepEqual(noted, {
    link: noted.link,
    token: "token-0",
    expiresAtMs: (links?.nowMs ?? 0) + 7 * 24 * 60 * 60 * 1_000,
    newAccounts: true,
  });
  assert.equal(rowOf(links, noted.link)?.digest, inviteLinkDigest("token-0"));
  const bare = await workspaceMinted(service, { createAccounts: false }, tom);
  assert.equal(bare.newAccounts, false);
  const listed = await service.workspaceListed(tom);
  assert.equal(listed.outcome, "Listed");
  if (listed.outcome !== "Listed") return;
  assert.deepEqual(listed.listed.links, [
    {
      link: bare.link,
      createAccounts: false,
      newAccounts: false,
      state: "Open",
      mintedBy: { subject: "tom" },
      mintedAtMs: rowOf(links, bare.link)?.mintedAtMs,
      expiresAtMs: bare.expiresAtMs,
    },
    {
      link: noted.link,
      note,
      createAccounts: true,
      newAccounts: true,
      state: "Open",
      mintedBy: { subject: "sita" },
      mintedAtMs: rowOf(links, noted.link)?.mintedAtMs,
      expiresAtMs: noted.expiresAtMs,
    },
  ]);
  assert.ok(!JSON.stringify(listed).includes(noted.token));
});

test("no answer to the person using a workspace link carries its note", async () => {
  const { service } = await sited();
  const made = await workspaceMinted(service, { createAccounts: true, note });
  const answers: unknown[] = [
    await service.redeemed(zed, made.token),
    await service.redeemed(zed, made.token, tenant),
    await service
      .redeemed(zed, made.token, "Not A Name")
      .catch((failure: unknown) =>
        failure instanceof Error ? failure.message : "",
      ),
    await service.redeemed(zed, made.token, "zed-works"),
    await service.redeemed(zed, made.token, "zed-works"),
  ];
  assert.equal(
    (answers[3] as { outcome: string } | undefined)?.outcome,
    "Redeemed",
  );
  for (const answer of answers)
    assert.ok(!JSON.stringify(answer).includes("Octo"), JSON.stringify(answer));
});

test("an unknown token is absent with no name and with any name the request admits, and the authority is asked nothing", async () => {
  const { memory, service } = await sited();
  await workspaceMinted(service);
  memory.asked.length = 0;
  memory.pages = 0;
  for (const workspace of [undefined, "fresh", tenant, "api", "Not A Name", ""])
    assert.deepEqual(
      await service.redeemed(zed, "token-nobody-holds", workspace),
      { outcome: "Absent" },
      String(workspace),
    );
  assert.deepEqual(memory.asked, []);
  assert.equal(memory.pages, 0);
  assert.deepEqual(memory.batches, []);
});

test("a tenant's link presented with a name, admissible or not, is used as today and the name ignored", async () => {
  for (const workspace of ["fresh", "Not A Name", "api", tenant]) {
    const { memory, links, service } = await sited();
    const link = await tenantMinted(service);
    assert.deepEqual(await service.redeemed(zed, link.token, workspace), {
      outcome: "Redeemed",
      redeemed: { tenant, role: "Member", projects: [] },
    });
    assert.equal(rowOf(links, link.link)?.used?.by, "zed");
    assert.equal(rowOf(links, link.link)?.used?.workspace, undefined);
    assert.equal(memory.batches.length, 1);
    assert.ok(
      !JSON.stringify(memory.batches).includes('"fresh"'),
      JSON.stringify(memory.batches),
    );
  }
});

test("a workspace link with no name, a name no new tenant may take, or a taken one is answered and stays open, and is then used with a free name", async () => {
  const { memory, links, service } = await sited();
  const made = await workspaceMinted(service);
  assert.deepEqual(await service.redeemed(zed, made.token), {
    outcome: "NameWanted",
  });
  assert.ok(open(links, made.link));
  for (const refused of ["Not A Name", "api", "-edge", ""]) {
    await assert.rejects(
      service.redeemed(zed, made.token, refused),
      RangeError,
      refused,
    );
    assert.ok(open(links, made.link), refused);
  }
  for (const caller of [zed, alice]) {
    assert.deepEqual(await service.redeemed(caller, made.token, tenant), {
      outcome: "TenantTaken",
    });
    assert.ok(open(links, made.link));
  }
  assert.deepEqual(memory.batches, []);
  assert.deepEqual(memory.changes, []);
  assert.deepEqual(await service.redeemed(zed, made.token, "zed-works"), {
    outcome: "Redeemed",
    redeemed: { tenant: "zed-works", role: "Admin", projects: [] },
  });
  assert.equal(rowOf(links, made.link)?.used?.workspace, "zed-works");
});

test("using a workspace link writes exactly the site's invitation's grants for the chosen name, with and without `createAccounts`, as one request", async () => {
  for (const createAccounts of [true, false]) {
    const { memory, service } = await sited();
    const made = await workspaceMinted(service, { createAccounts });
    memory.asked.length = 0;
    const workspace = asTenantId(`zed-${String(createAccounts)}`);
    assert.equal(
      (await service.redeemed(zed, made.token, workspace)).outcome,
      "Redeemed",
    );
    assert.deepEqual(memory.batches, [
      accessOwnerInvitationGrants(
        accessFixtureIssuer,
        workspace,
        "zed",
        createAccounts,
      ),
    ]);
    assert.deepEqual(memory.changes, []);
    assert.deepEqual(memory.asked, []);
  }
});

test("a grant that faults gives the link back open and naming nothing, and the name is then free for another link", async () => {
  const { memory, links, service } = await sited();
  const first = await workspaceMinted(service);
  const second = await workspaceMinted(service);
  const fault = new Error("write refused");
  const faulting = accessMemoryInviteLinks(memory, links, undefined, {
    grants: {
      write: (grant) => memory.grants.write(grant),
      remove: (grant) => memory.grants.remove(grant),
      writeAll: () => Promise.reject(fault),
    },
  });
  await assert.rejects(faulting.redeemed(zed, first.token, "shared"), fault);
  assert.ok(open(links, first.link));
  assert.equal(rowOf(links, first.link)?.used, undefined);
  assert.deepEqual(memory.batches, []);
  assert.deepEqual(await service.redeemed(dee, second.token, "shared"), {
    outcome: "Redeemed",
    redeemed: { tenant: "shared", role: "Admin", projects: [] },
  });
  assert.deepEqual(await service.redeemed(zed, first.token, "shared"), {
    outcome: "TenantTaken",
  });
  assert.equal(
    (await service.redeemed(zed, first.token, "zed-works")).outcome,
    "Redeemed",
  );
});

test("a workspace link used once is absent after to another person, with any name or none", async () => {
  const { memory, service } = await sited();
  const made = await workspaceMinted(service);
  await service.redeemed(zed, made.token, "zed-works");
  memory.batches.length = 0;
  for (const workspace of [undefined, "other-works", "zed-works"])
    assert.deepEqual(await service.redeemed(dee, made.token, workspace), {
      outcome: "Absent",
    });
  assert.deepEqual(memory.batches, []);
});

test("a workspace link's user sending again is answered the workspace it made, whatever name the send carries, and nothing is written", async () => {
  const { memory, links, service } = await sited();
  const made = await workspaceMinted(service);
  const first = await service.redeemed(zed, made.token, "zed-works");
  assert.deepEqual(first, {
    outcome: "Redeemed",
    redeemed: { tenant: "zed-works", role: "Admin", projects: [] },
  });
  for (const grant of memory.batches.flat()) await memory.grants.remove(grant);
  const row = structuredClone(rowOf(links, made.link));
  memory.batches.length = 0;
  memory.changes.length = 0;
  memory.asked.length = 0;
  if (links !== undefined) links.nowMs = made.expiresAtMs;
  for (const workspace of [
    undefined,
    "other-works",
    "zed-works",
    "Not A Name",
    "api",
    "",
  ])
    assert.deepEqual(
      await service.redeemed(zed, made.token, workspace),
      first,
      String(workspace),
    );
  assert.deepEqual(memory.batches, []);
  assert.deepEqual(memory.changes, []);
  assert.deepEqual(memory.asked, []);
  assert.deepEqual(rowOf(links, made.link), row);
});

test("a send that read a workspace link open and whose spend took nothing is answered the workspace its caller's own other send made, and absent where another person's took it", async () => {
  for (const [other, answered] of [
    [zed, "Redeemed"],
    [dee, "Absent"],
  ] as const) {
    const { memory, links, service } = await sited();
    if (links === undefined) return;
    const made = await workspaceMinted(service);
    let taken: unknown;
    const overlapping = accessMemoryInviteLinks(
      memory,
      inviteLinkOverlapped(links, async () => {
        taken = await service.redeemed(other, made.token, "first-works");
      }),
    );
    const answer = await overlapping.redeemed(zed, made.token, "second-works");
    assert.deepEqual(taken, {
      outcome: "Redeemed",
      redeemed: { tenant: "first-works", role: "Admin", projects: [] },
    });
    assert.deepEqual(
      answer,
      answered === "Redeemed" ? taken : { outcome: "Absent" },
    );
    assert.equal(memory.batches.length, 1);
  }
});

test("two links never make one workspace: where the authority does not yet hold a name another link took, the spend is refused it and the link stays open", async () => {
  const { memory, links } = await sited();
  const service = accessMemoryInviteLinks(memory, links, undefined, {
    claims: { claimed: () => Promise.resolve(false) },
  });
  const first = await workspaceMinted(service);
  const second = await workspaceMinted(service);
  assert.equal(
    (await service.redeemed(zed, first.token, "shared")).outcome,
    "Redeemed",
  );
  memory.batches.length = 0;
  assert.deepEqual(await service.redeemed(dee, second.token, "shared"), {
    outcome: "TenantTaken",
  });
  assert.ok(open(links, second.link));
  assert.deepEqual(memory.batches, []);
});

test("the registration gate admits a workspace link only with `newAccounts`, and reading it spends nothing", async () => {
  const { links, service } = await sited();
  const admitted = await workspaceMinted(service, { createAccounts: false });
  const refused = await workspaceMinted(
    service,
    { createAccounts: false },
    tom,
  );
  assert.equal(await service.registrationAdmitted(admitted.token), true);
  assert.equal(await service.registrationAdmitted(admitted.token), true);
  assert.equal(await service.registrationAdmitted(refused.token), false);
  assert.ok(open(links, admitted.link));
  const listed = await service.workspaceListed(sita);
  assert.deepEqual(
    listed.outcome === "Listed"
      ? listed.listed.links.map((link) => link.state)
      : [],
    ["Open", "Open"],
  );
  await service.redeemed(zed, admitted.token, "zed-works");
  assert.equal(await service.registrationAdmitted(admitted.token), false);
});

test("a tenant's list and revocation never see or end a workspace link, open or used, even by the tenant its use made", async () => {
  const { links, service } = await sited();
  const used = await workspaceMinted(service);
  const opened = await workspaceMinted(service);
  await service.redeemed(zed, used.token, "zed-works");
  const made = asTenantId("zed-works");
  for (const [caller, at] of [
    [zed, made],
    [alice, tenant],
  ] as const) {
    const listed = await service.listed(caller, at);
    assert.deepEqual(listed, { outcome: "Listed", listed: { links: [] } });
    for (const link of [used.link, opened.link])
      assert.deepEqual(await service.revoked(caller, at, link), {
        outcome: "Absent",
      });
  }
  assert.ok(open(links, opened.link));
});

test("the site's list and revocation never see or end a tenant's link", async () => {
  const { links, service } = await sited();
  const link = await tenantMinted(service);
  assert.deepEqual(await service.workspaceListed(sita), {
    outcome: "Listed",
    listed: { links: [] },
  });
  assert.deepEqual(await service.workspaceRevoked(sita, link.link), {
    outcome: "Absent",
  });
  assert.ok(open(links, link.link));
});

/** Mints as many links as `mint` may and asserts the next is refused at the bound. */
async function filled(
  mint: () => Promise<{ readonly outcome: string }>,
): Promise<void> {
  for (let count = 0; count < accessInviteLinksOpenMax; count += 1)
    assert.equal((await mint()).outcome, "Minted");
  assert.deepEqual(await mint(), { outcome: "LimitReached" });
}

test("a tenant's mint never counts a workspace link, and the site's never counts a tenant's", async () => {
  const { service } = await sited();
  await filled(() => service.workspaceMint(sita, { createAccounts: false }));
  assert.equal(
    (await service.mint(alice, tenant, { role: "Member" })).outcome,
    "Minted",
  );
  const other = await sited();
  await filled(() => other.service.mint(alice, tenant, { role: "Member" }));
  assert.equal(
    (await other.service.workspaceMint(sita, { createAccounts: false }))
      .outcome,
    "Minted",
  );
});

/** Mints and revokes `count` links with `mint` and `revoke`, oldest first. */
async function ended(
  count: number,
  mint: () => Promise<{ readonly link: string }>,
  revoke: (link: string) => Promise<unknown>,
): Promise<readonly string[]> {
  const made: string[] = [];
  for (let at = 0; at < count; at += 1) {
    const link = (await mint()).link;
    await revoke(link);
    made.push(link);
  }
  return made;
}

test("a tenant's mint never trims a workspace link, and the site's never trims a tenant's", async () => {
  const { service } = await sited();
  const site = () =>
    ended(
      2,
      () => workspaceMinted(service),
      (link) => service.workspaceRevoked(sita, link),
    );
  const tenants = (count: number) =>
    ended(
      count,
      () => tenantMinted(service),
      (link) => service.revoked(alice, tenant, link),
    );
  const siteOldest = await site();
  await tenants(accessInviteLinksEndedKept);
  await tenantMinted(service);
  const siteKept = await service.workspaceListed(sita);
  assert.deepEqual(
    siteKept.outcome === "Listed"
      ? siteKept.listed.links.map((link) => link.link).sort()
      : [],
    [...siteOldest].sort(),
  );
  const fresh = await sited();
  const tenantOldest = await ended(
    2,
    () => tenantMinted(fresh.service),
    (link) => fresh.service.revoked(alice, tenant, link),
  );
  await ended(
    accessInviteLinksEndedKept,
    () => workspaceMinted(fresh.service),
    (link) => fresh.service.workspaceRevoked(sita, link),
  );
  await workspaceMinted(fresh.service);
  const tenantKept = await fresh.service.listed(alice, tenant);
  assert.deepEqual(
    tenantKept.outcome === "Listed"
      ? tenantKept.listed.links.map((link) => link.link).sort()
      : [],
    [...tenantOldest].sort(),
  );
});

test("a plane with no store answers every workspace link route not configured before it asks the authority anything", async () => {
  const { memory, service } = await sited(false);
  assert.deepEqual(
    await service.workspaceMint(sita, { createAccounts: true }),
    { outcome: "NotConfigured" },
  );
  assert.deepEqual(await service.workspaceListed(sita), {
    outcome: "NotConfigured",
  });
  assert.deepEqual(await service.workspaceRevoked(sita, "link"), {
    outcome: "NotConfigured",
  });
  assert.deepEqual(await service.redeemed(zed, "token", "zed-works"), {
    outcome: "NotConfigured",
  });
  assert.deepEqual(memory.asked, []);
});
