/**
 * A tenant's invite links and the site's workspace links against a real
 * PostgreSQL, driven as the access plane's own role: one spend of a token
 * where two race, the database's clock deciding what has expired, a spend
 * given back, an open link read without spending it, the tenant's bounds and
 * the site's kept under each mint's lock, the two kinds never meeting, and
 * one workspace made by one link where two race for its name.
 *
 * THE SITE'S CASES CLEAR THE SITE'S ROWS FIRST, because the site's links are
 * one set across the suite where a tenant's cases isolate by tenant name.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  accessInviteLinksEndedKept,
  accessInviteLinksOpenMax,
} from "../../src/contract/accessPlane.ts";
import { postgresInviteLinks } from "../../src/adapters/postgres/inviteLinks.ts";
import { accessPlaneRole } from "../../src/adapters/postgres/schema/shared.ts";
import type { AccessInviteLinkStore } from "../../src/interpreter/accessInviteLink.ts";
import {
  asTenantId,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let plane: pg.Pool;
let links: AccessInviteLinkStore;
before(async () => {
  harness = await postgresHarnessOpen();
  plane = postgresHarnessRolePool(accessPlaneRole);
  links = postgresInviteLinks(plane);
});
after(async () => {
  await plane.end();
  await harness.close();
});

/** A digest is 64 hex characters or the row refuses it, so each link draws one. */
let drawn = 0;
function digestNext(): string {
  drawn += 1;
  return drawn.toString(16).padStart(64, "0");
}

/** A link of `tenant` granting membership and a role on one project, its digest beside it. */
async function minted(tenant: TenantId) {
  const digest = digestNext();
  const written = await links.mint({
    tenant,
    digest,
    role: "Member",
    projects: [{ project: "web", roles: ["Developer", "Viewer"] }],
    newAccounts: true,
    mintedBy: "minter",
  });
  if (written.written !== "Minted") throw new Error("the mint was refused");
  return { ...written, digest };
}

/** A workspace link carrying `createAccounts`, its digest beside it. */
async function workspaceMinted(note?: string) {
  const digest = digestNext();
  const written = await links.workspaceMint({
    digest,
    createAccounts: true,
    note,
    newAccounts: false,
    mintedBy: "site-minter",
  });
  if (written.written !== "Minted") throw new Error("the mint was refused");
  return { ...written, digest };
}

/** Removes every workspace link, as a site case starts. */
async function siteCleared(): Promise<void> {
  await harness.query("DELETE FROM invite_link WHERE tenant IS NULL");
}

async function siteStates() {
  return (await links.workspaceListed()).map((link) => [link.link, link.state]);
}

async function states(tenant: TenantId) {
  return (await links.listed(tenant)).map((link) => [link.link, link.state]);
}

test("a link is read back as it was minted, open, and spent once by the statement that takes it", async () => {
  const tenant = asTenantId("links-spend");
  const link = await minted(tenant);
  const [listed] = await links.listed(tenant);
  assert.equal(listed?.state, "Open");
  assert.deepEqual(listed?.projects, [
    { project: "web", roles: ["Developer", "Viewer"] },
  ]);
  assert.equal(listed?.expiresAtMs, link.expiresAtMs);
  assert.deepEqual(await links.spend(link.digest, "user"), {
    link: link.link,
    tenant,
    role: "Member",
    projects: [{ project: "web", roles: ["Developer", "Viewer"] }],
  });
  const [used] = await links.listed(tenant);
  assert.equal(used?.state, "Used");
  assert.equal(used?.state === "Used" ? used.usedBy : undefined, "user");
});

test("an open link is read with its `newAccounts` and is still open, and a spent one is not read", async () => {
  const tenant = asTenantId("links-opened");
  const link = await minted(tenant);
  assert.deepEqual(await links.opened(link.digest), { newAccounts: true });
  assert.deepEqual(await states(tenant), [[link.link, "Open"]]);
  assert.notEqual(await links.spend(link.digest, "user"), undefined);
  assert.equal(await links.opened(link.digest), undefined);
  assert.equal(await links.opened(digestNext()), undefined);
});

test("two redemptions of one token started together: exactly one is given the link", async () => {
  const tenant = asTenantId("links-race");
  const link = await minted(tenant);
  const spent = await Promise.all([
    links.spend(link.digest, "first"),
    links.spend(link.digest, "second"),
  ]);
  assert.equal(spent.filter((one) => one !== undefined).length, 1);
});

test("a link stored past its expiry lists as `Expired` and is not spent", async () => {
  const tenant = asTenantId("links-expired");
  const link = await minted(tenant);
  await harness.query(
    "UPDATE invite_link SET minted_at=now()-interval '2 days', expires_at=now()-interval '1 day' WHERE link=$1",
    [link.link],
  );
  assert.deepEqual(await states(tenant), [[link.link, "Expired"]]);
  assert.equal(await links.opened(link.digest), undefined);
  assert.equal(await links.spend(link.digest, "user"), undefined);
  assert.equal(await links.revoke(tenant, link.link), false);
});

test("a revoked link is not spent, and a spent link is not revoked", async () => {
  const tenant = asTenantId("links-ended");
  const revoked = await minted(tenant);
  const spent = await minted(tenant);
  assert.equal(await links.revoke(tenant, revoked.link), true);
  assert.equal(await links.spend(revoked.digest, "user"), undefined);
  assert.notEqual(await links.spend(spent.digest, "user"), undefined);
  assert.equal(await links.revoke(tenant, spent.link), false);
  assert.deepEqual(
    Object.fromEntries(await states(tenant)),
    Object.fromEntries([
      [revoked.link, "Revoked"],
      [spent.link, "Used"],
    ]),
  );
  assert.equal(await links.revoke(asTenantId("other"), revoked.link), false);
  assert.equal(await links.held(asTenantId("other"), revoked.link), undefined);
});

test("a link given back is open and can be spent", async () => {
  const tenant = asTenantId("links-restore");
  const link = await minted(tenant);
  assert.notEqual(await links.spend(link.digest, "first"), undefined);
  assert.equal(await links.restore(link.link), true);
  assert.deepEqual(await states(tenant), [[link.link, "Open"]]);
  assert.equal((await links.held(tenant, link.link))?.open, true);
  assert.notEqual(await links.spend(link.digest, "second"), undefined);
});

test("the mint past the open bound is refused, and an ended link does not count against it", async () => {
  const tenant = asTenantId("links-open-bound");
  const made = [];
  for (let count = 0; count < accessInviteLinksOpenMax; count += 1)
    made.push(await minted(tenant));
  const refused = await links.mint({
    tenant,
    digest: digestNext(),
    role: "Member",
    projects: [],
    newAccounts: false,
    mintedBy: "minter",
  });
  assert.deepEqual(refused, { written: "LimitReached" });
  assert.equal(await links.revoke(tenant, made[0]?.link ?? ""), true);
  await minted(tenant);
  assert.equal(
    (await links.listed(tenant)).length,
    accessInviteLinksOpenMax + 1,
  );
});

test("a mint with more ended links than are kept leaves that many, the most recently ended", async () => {
  const tenant = asTenantId("links-ended-kept");
  const ended: string[] = [];
  for (let count = 0; count < accessInviteLinksEndedKept + 2; count += 1) {
    const link = await minted(tenant);
    assert.equal(await links.revoke(tenant, link.link), true);
    ended.push(link.link);
  }
  const open = await minted(tenant);
  const listed = await links.listed(tenant);
  assert.deepEqual(
    listed
      .filter((link) => link.state === "Revoked")
      .map((link) => link.link)
      .sort(),
    ended.slice(-accessInviteLinksEndedKept).sort(),
  );
  assert.equal(listed[0]?.link, open.link);
});

test("a workspace link is read back with its note as written, and spent once with the workspace its use names", async () => {
  await siteCleared();
  const note = "for Octo — via the meetup, «twice»";
  const link = await workspaceMinted(note);
  assert.deepEqual(
    (await links.workspaceListed()).map((one) => [one.note, one.state]),
    [[note, "Open"]],
  );
  assert.equal(await links.presented(link.digest), "Workspace");
  assert.deepEqual(await links.opened(link.digest), { newAccounts: false });
  assert.deepEqual(
    await links.workspaceSpend(link.digest, "user", asTenantId("user-works")),
    { spent: "Spent", link: link.link, createAccounts: true },
  );
  const [used] = await links.workspaceListed();
  assert.equal(used?.state, "Used");
  assert.equal(
    used?.state === "Used" ? used.workspace : undefined,
    "user-works",
  );
  assert.equal(
    await links.workspaceSpend(link.digest, "other", asTenantId("other-works")),
    undefined,
  );
  assert.equal(await links.presented(link.digest), undefined);
});

test("the site's mint past the open bound is refused, a tenant's links not counted against it, and an ended link not either", async () => {
  await siteCleared();
  const tenant = asTenantId("links-site-bound");
  for (let count = 0; count < accessInviteLinksOpenMax; count += 1)
    await minted(tenant);
  const made = [];
  for (let count = 0; count < accessInviteLinksOpenMax; count += 1)
    made.push(await workspaceMinted());
  assert.deepEqual(
    await links.workspaceMint({
      digest: digestNext(),
      createAccounts: false,
      note: undefined,
      newAccounts: false,
      mintedBy: "site-minter",
    }),
    { written: "LimitReached" },
  );
  assert.deepEqual(
    await links
      .mint({
        tenant: asTenantId("links-site-bound-other"),
        digest: digestNext(),
        role: "Member",
        projects: [],
        newAccounts: false,
        mintedBy: "minter",
      })
      .then((written) => written.written),
    "Minted",
  );
  assert.equal(await links.workspaceRevoke(made[0]?.link ?? ""), true);
  await workspaceMinted();
  assert.equal(
    (await links.workspaceListed()).length,
    accessInviteLinksOpenMax + 1,
  );
});

test("the site's mint with more ended links than are kept leaves that many, the most recently ended, and trims no tenant's", async () => {
  await siteCleared();
  const tenant = asTenantId("links-site-kept");
  const tenantEnded = await minted(tenant);
  assert.equal(await links.revoke(tenant, tenantEnded.link), true);
  const ended: string[] = [];
  for (let count = 0; count < accessInviteLinksEndedKept + 2; count += 1) {
    const link = await workspaceMinted();
    assert.equal(await links.workspaceRevoke(link.link), true);
    ended.push(link.link);
  }
  const open = await workspaceMinted();
  const listed = await links.workspaceListed();
  assert.deepEqual(
    listed
      .filter((link) => link.state === "Revoked")
      .map((link) => link.link)
      .sort(),
    ended.slice(-accessInviteLinksEndedKept).sort(),
  );
  assert.equal(listed[0]?.link, open.link);
  assert.deepEqual(await states(tenant), [[tenantEnded.link, "Revoked"]]);
});

test("a tenant's statements never reach a workspace link, used or open, nor the site's a tenant's link", async () => {
  await siteCleared();
  const tenant = asTenantId("links-kinds");
  const tenantLink = await minted(tenant);
  const used = await workspaceMinted();
  const opened = await workspaceMinted();
  assert.equal(await links.presented(tenantLink.digest), "Tenant");
  assert.equal(await links.spend(opened.digest, "user"), undefined);
  assert.notEqual(
    await links.workspaceSpend(used.digest, "user", tenant),
    undefined,
  );
  assert.deepEqual(await states(tenant), [[tenantLink.link, "Open"]]);
  for (const link of [used.link, opened.link]) {
    assert.equal(await links.held(tenant, link), undefined);
    assert.equal(await links.revoke(tenant, link), false);
  }
  assert.equal(
    await links.workspaceSpend(tenantLink.digest, "user", asTenantId("x-y")),
    undefined,
  );
  assert.equal(await links.workspaceHeld(tenantLink.link), undefined);
  assert.equal(await links.workspaceRevoke(tenantLink.link), false);
  assert.deepEqual(
    Object.fromEntries(await siteStates()),
    Object.fromEntries([
      [used.link, "Used"],
      [opened.link, "Open"],
    ]),
  );
  assert.deepEqual(await links.opened(tenantLink.digest), {
    newAccounts: true,
  });
  assert.deepEqual(await links.workspaceHeld(opened.link), {
    createAccounts: true,
    open: true,
  });
});

test("two workspace links taking one name started together: exactly one is spent, and the other is refused it and stays open", async () => {
  await siteCleared();
  const first = await workspaceMinted();
  const second = await workspaceMinted();
  const name = asTenantId("raced-works");
  const spent = await Promise.all([
    links.workspaceSpend(first.digest, "first", name),
    links.workspaceSpend(second.digest, "second", name),
  ]);
  assert.deepEqual(spent.map((one) => one?.spent).sort(), ["Spent", "Taken"]);
  const loser = spent[0]?.spent === "Taken" ? first : second;
  assert.equal(await links.presented(loser.digest), "Workspace");
  assert.equal(
    (await links.workspaceSpend(loser.digest, "loser", asTenantId("own-works")))
      ?.spent,
    "Spent",
  );
});

test("a workspace link given back is open naming nothing, and its name is taken by another link", async () => {
  await siteCleared();
  const first = await workspaceMinted();
  const second = await workspaceMinted();
  const name = asTenantId("given-back-works");
  assert.equal(
    (await links.workspaceSpend(first.digest, "first", name))?.spent,
    "Spent",
  );
  assert.equal(await links.restore(first.link), true);
  assert.deepEqual(
    await harness.query(
      "SELECT workspace,used_by FROM invite_link WHERE link=$1",
      [first.link],
    ),
    [{ workspace: null, used_by: null }],
  );
  assert.equal((await links.workspaceHeld(first.link))?.open, true);
  assert.equal(
    (await links.workspaceSpend(second.digest, "second", name))?.spent,
    "Spent",
  );
  assert.equal(
    (await links.workspaceSpend(first.digest, "first", name))?.spent,
    "Taken",
  );
});
