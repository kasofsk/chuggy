/**
 * Ownership: competing owners, lease takeover, and the fencing epoch that
 * separates a tenure from its successor.
 *
 * TIME IS MOVED BY AGEING THE ROW, never by waiting. `postgresHarnessExpire`
 * is that move, and says why beside itself.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { Lease, Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessExpire,
  postgresHarnessHeld,
  postgresHarnessOpen,
  postgresHarnessOwner,
  postgresHarnessProject,
  postgresHarnessRowLock,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

/** Acquires and asserts the grant, so a case that is about something else reads as one line. */
function granted(partition: Partition, label: string): Promise<Lease> {
  return postgresHarnessHeld(harness.store, partition, label);
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

test("two replicas racing one free project are told Granted and HeldByAnother", async () => {
  const partition = await postgresHarnessProject(harness.store, "race");
  const lock = await postgresHarnessRowLock(partition);
  const racers = [
    harness.store.acquire(partition, postgresHarnessOwner("racerleft"), 60),
    harness.store.acquire(partition, postgresHarnessOwner("racerright"), 60),
  ];
  try {
    await lock.stalled(racers.length);
  } finally {
    await lock.release();
  }

  const outcomes = (await Promise.all(racers))
    .map((raced) => raced.acquired)
    .sort();
  assert.deepEqual(outcomes, ["Granted", "HeldByAnother"]);
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
  await postgresHarnessExpire(harness, partition);
  const successor = await granted(partition, "successor");
  assert.equal(successor.fencingEpoch, former.fencingEpoch + 1);
  const fenced = await harness.store.renew(former, 60);
  assert.equal(fenced.renewed, "Fenced");
  assert.ok(fenced.renewed === "Fenced");
  assert.equal(fenced.fencingEpoch, successor.fencingEpoch);
});

test("release frees the project, and a released lease cannot release its successor", async () => {
  const partition = await postgresHarnessProject(harness.store, "release");
  const lease = await granted(partition, "leaver");
  await harness.store.release(lease);
  const next = await granted(partition, "next");

  await harness.store.release(lease);

  const rival = await harness.store.acquire(
    partition,
    postgresHarnessOwner("opportunist"),
    60,
  );
  assert.equal(rival.acquired, "HeldByAnother");
  assert.ok(rival.acquired === "HeldByAnother");
  assert.equal(rival.owner, next.owner);
  const renewed = await harness.store.renew(next, 60);
  assert.equal(renewed.renewed, "Extended");
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

test("a duration no lease can be granted for names the argument, not the row it would spoil", async () => {
  const partition = await postgresHarnessProject(harness.store, "duration");
  const held = await granted(partition, "steady");
  for (const leaseSecs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      () =>
        harness.store.acquire(
          partition,
          postgresHarnessOwner("hopeful"),
          leaseSecs,
        ),
      /leaseSecs/,
    );
    await assert.rejects(
      () => harness.store.renew(held, leaseSecs),
      /leaseSecs/,
    );
  }
  const renewed = await harness.store.renew(held, 60);
  assert.equal(renewed.renewed, "Extended");
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
