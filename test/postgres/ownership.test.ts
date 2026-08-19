/**
 * Ownership: competing owners, lease takeover, and the fencing epoch that
 * separates a tenure from its successor.
 *
 * TIME IS MOVED BY AGEING THE ROW, never by waiting. A case that slept for a
 * lease to expire would be slow and would still be racing the clock it slept
 * against; setting the expiry into the past is the same fact, decided by the
 * database exactly as a real expiry would be.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { Lease, Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessOwner,
  postgresHarnessProject,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

/** Puts the partition's lease expiry into the past, which is what a lapsed tenure looks like to the server. */
async function expire(partition: Partition): Promise<void> {
  await harness.query(
    "UPDATE project SET lease_expires_at = now() - interval '1 second' WHERE tenant = $1 AND project = $2",
    [partition.tenant, partition.project],
  );
}

/** Acquires and asserts the grant, so a case that is about something else reads as one line. */
async function granted(partition: Partition, label: string): Promise<Lease> {
  const owner = postgresHarnessOwner(label);
  const acquired = await harness.store.acquire(partition, owner, 60);
  assert.equal(acquired.acquired, "Granted");
  assert.ok(acquired.acquired === "Granted");
  return acquired.lease;
}

test("a fresh project is Active with an empty journal, and provisioning it twice is one project", async () => {
  const partition = await postgresHarnessProject(harness.store, "provision");
  const again = await harness.store.createProject(partition);
  assert.equal(again.lifecycle, "Active");
  assert.equal(again.head, 0);
  assert.equal(again.lifecycleGeneration, 1);
});

test("acquisition grants the lease and advances the fencing epoch", async () => {
  const partition = await postgresHarnessProject(harness.store, "acquire");
  const before = await harness.store.standing(partition);
  const lease = await granted(partition, "first");
  assert.ok(before !== undefined);
  assert.equal(lease.fencingEpoch, before.fencingEpoch + 1);
  assert.equal(lease.head, 0);
});

test("a competing owner is refused while the lease is live", async () => {
  const partition = await postgresHarnessProject(harness.store, "compete");
  const held = await granted(partition, "holder");
  const rival = postgresHarnessOwner("rival");
  const refused = await harness.store.acquire(partition, rival, 60);
  assert.equal(refused.acquired, "HeldByAnother");
  assert.ok(refused.acquired === "HeldByAnother");
  assert.equal(refused.owner, held.owner);
});

test("renewal extends the lease and preserves its fencing epoch", async () => {
  const partition = await postgresHarnessProject(harness.store, "renew");
  const lease = await granted(partition, "steady");
  const renewed = await harness.store.renew(lease, 60);
  assert.equal(renewed.renewed, "Extended");
  assert.ok(renewed.renewed === "Extended");
  assert.equal(renewed.lease.fencingEpoch, lease.fencingEpoch);
  assert.equal(renewed.lease.owner, lease.owner);
});

test("takeover after expiry advances the epoch, and the former owner cannot renew", async () => {
  const partition = await postgresHarnessProject(harness.store, "takeover");
  const former = await granted(partition, "former");
  await expire(partition);
  const successor = await granted(partition, "successor");
  assert.equal(successor.fencingEpoch, former.fencingEpoch + 1);
  const fenced = await harness.store.renew(former, 60);
  assert.equal(fenced.renewed, "Fenced");
  assert.ok(fenced.renewed === "Fenced");
  assert.equal(fenced.fencingEpoch, successor.fencingEpoch);
});

test("release frees the project, and a released lease releases nothing twice", async () => {
  const partition = await postgresHarnessProject(harness.store, "release");
  const lease = await granted(partition, "leaver");
  await harness.store.release(lease);
  const next = await granted(partition, "next");
  await harness.store.release(lease);
  const standing = await harness.store.standing(partition);
  assert.ok(standing !== undefined);
  assert.equal(standing.fencingEpoch, next.fencingEpoch);
});

test("a fenced project admits no dispatcher, and fencing advances both counters", async () => {
  const partition = await postgresHarnessProject(harness.store, "fence");
  const lease = await granted(partition, "held");
  const fenced = await harness.store.fence(partition, "Suspended");
  assert.equal(fenced.lifecycle, "Suspended");
  assert.equal(fenced.lifecycleGeneration, 2);
  assert.equal(fenced.fencingEpoch, lease.fencingEpoch + 1);
  const refused = await harness.store.acquire(
    partition,
    postgresHarnessOwner("hopeful"),
    60,
  );
  assert.equal(refused.acquired, "NotActive");
  assert.ok(refused.acquired === "NotActive");
  assert.equal(refused.lifecycle, "Suspended");
});

test("a partition nothing provisioned has no standing and cannot be acquired", async () => {
  const partition = await postgresHarnessProject(harness.store, "known");
  const unknown = {
    tenant: partition.tenant,
    project: partition.project.concat("-absent"),
  } as Partition;
  assert.equal(await harness.store.standing(unknown), undefined);
  await assert.rejects(
    () => harness.store.acquire(unknown, postgresHarnessOwner("nobody"), 60),
    /never provisioned/,
  );
});
