/**
 * A tenant's invite links against a real PostgreSQL, driven as the access
 * plane's own role: one spend of a token where two race, the database's clock
 * deciding what has expired, a spend given back, an open link read without
 * spending it, and the tenant's bounds kept under the mint's lock.
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
