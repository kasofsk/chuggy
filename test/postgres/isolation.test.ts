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
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import { projectWriterDecide } from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessAccepted,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

/** A provisioned partition already held by its own owner, with nothing decided yet. */
async function heldProject(label: string): Promise<ProjectMemory> {
  const partition = await postgresHarnessProject(harness.store, label);
  return postgresHarnessHistory(harness, partition, label, 0);
}

/** Decides the fixture history's first entry for a partition this memory holds. */
async function commitFirst(memory: ProjectMemory, label: string) {
  const item = await postgresHarnessAccepted(
    harness.inbox,
    memory.lease.partition,
    label,
    0,
  );
  return projectWriterDecide(postgresHarnessWriter(harness), memory, item);
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

  const [one, two] = await Promise.all([
    commitFirst(left, "left"),
    commitFirst(right, "right"),
  ]);
  assert.equal(one.decided.decided, "Committed");
  assert.equal(two.decided.decided, "Committed");
});

test("a load returns the partition's own entries and no other partition's", async () => {
  const left = await heldProject("ownleft");
  const right = await heldProject("ownright");
  await commitFirst(left, "ownleft");

  assert.deepEqual(await entriesOf(left.lease.partition), [
    postgresHarnessJournal()[0],
  ]);
  assert.deepEqual(await entriesOf(right.lease.partition), []);
});

test("fencing one project leaves its neighbour Active and its lease intact", async () => {
  const doomed = await heldProject("doomed");
  const spared = await heldProject("spared");

  await harness.store.fence(doomed.lease.partition, "Deleting");

  const standing = await harness.store.standing(spared.lease.partition);
  assert.ok(standing !== undefined);
  assert.equal(standing.lifecycle, "Active");
  assert.equal(standing.fencingEpoch, spared.lease.fencingEpoch);

  const committed = await commitFirst(spared, "spared");
  assert.equal(committed.decided.decided, "Committed");
});

test("two tenants may hold the same project name without sharing a partition", async () => {
  const left = await heldProject("samename");
  const shadow: Partition = {
    tenant: left.lease.partition.tenant.concat("-other") as Partition["tenant"],
    project: left.lease.partition.project,
  };
  await harness.store.createProject(shadow);
  await commitFirst(left, "samename");

  assert.deepEqual(await entriesOf(shadow), []);
  const standing = await harness.store.standing(shadow);
  assert.ok(standing !== undefined);
  assert.equal(standing.head, 0);
});
