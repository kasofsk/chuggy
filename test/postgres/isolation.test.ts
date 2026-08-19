/**
 * Project isolation: one project does not serialize another, and no read or
 * write reaches across the composite key.
 *
 * THE GUARANTEE 006 MAKES IS EXACTLY THIS ONE — that one project does not
 * serialize another, rather than unlimited throughput inside a project. So the
 * case that matters is two partitions committing concurrently, and the case
 * beside it is that a partition fenced, suspended or unowned leaves its
 * neighbour untouched.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { Entry } from "../../src/actor/journal.ts";
import type { Lease, Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessOwner,
  postgresHarnessJournal,
  postgresHarnessProject,
  type PostgresHarness,
} from "./harness.ts";

/** The first entry of the shared fixture history, which is all these cases need. */
function postgresHarnessFirstEntry(): Entry {
  const entry = postgresHarnessJournal()[0];
  assert.ok(entry !== undefined);
  return entry;
}

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

/** A provisioned partition already held by its own owner. */
async function heldProject(label: string): Promise<Lease> {
  const partition = await postgresHarnessProject(harness.store, label);
  const acquired = await harness.store.acquire(
    partition,
    postgresHarnessOwner(label),
    60,
  );
  assert.ok(acquired.acquired === "Granted");
  return acquired.lease;
}

/** Every entry the partition holds, asserted to have parsed. */
async function entriesOf(partition: Partition): Promise<readonly Entry[]> {
  const loaded = await harness.store.load(partition);
  assert.ok(loaded.parsed === "Ok");
  return loaded.value;
}

test("two projects commit concurrently and neither waits on the other", async () => {
  const left = await heldProject("left");
  const right = await heldProject("right");
  const entry = postgresHarnessFirstEntry();

  const [one, two] = await Promise.all([
    harness.store.append(left, entry),
    harness.store.append(right, entry),
  ]);
  assert.equal(one.appended, "Committed");
  assert.equal(two.appended, "Committed");
});

test("a load returns the partition's own entries and no other partition's", async () => {
  const left = await heldProject("ownleft");
  const right = await heldProject("ownright");
  const entry = postgresHarnessFirstEntry();
  await harness.store.append(left, entry);

  assert.deepEqual(await entriesOf(left.partition), [entry]);
  assert.deepEqual(await entriesOf(right.partition), []);
});

test("fencing one project leaves its neighbour Active and its lease intact", async () => {
  const doomed = await heldProject("doomed");
  const spared = await heldProject("spared");

  await harness.store.fence(doomed.partition, "Deleting");

  const standing = await harness.store.standing(spared.partition);
  assert.ok(standing !== undefined);
  assert.equal(standing.lifecycle, "Active");
  assert.equal(standing.fencingEpoch, spared.fencingEpoch);

  const appended = await harness.store.append(
    spared,
    postgresHarnessFirstEntry(),
  );
  assert.equal(appended.appended, "Committed");
});

test("two tenants may hold the same project name without sharing a partition", async () => {
  const left = await heldProject("samename");
  const shadow: Partition = {
    tenant: left.partition.tenant.concat("-other") as Partition["tenant"],
    project: left.partition.project,
  };
  await harness.store.createProject(shadow);
  await harness.store.append(left, postgresHarnessFirstEntry());

  assert.deepEqual(await entriesOf(shadow), []);
  const standing = await harness.store.standing(shadow);
  assert.ok(standing !== undefined);
  assert.equal(standing.head, 0);
});
