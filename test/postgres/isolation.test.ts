/**
 * Project isolation: one project does not serialize another, and no read or
 * write reaches across the composite key.
 *
 * THE GUARANTEE 006 MAKES IS EXACTLY THIS ONE — that one project does not
 * serialize another, rather than unlimited throughput inside a project. So the
 * case that matters holds one partition's decision stalled on its own row and
 * requires its neighbour's to commit inside a bound while it waits, and the
 * case beside it is that a partition fenced, suspended or unowned leaves its
 * neighbour untouched.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { Entry } from "../../src/actor/journal.ts";
import type { Lease, Partition } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  type ProjectDecided,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessAccepted,
  postgresHarnessHeld,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRowLock,
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
  const partition = await postgresHarnessProject(harness, label);
  return postgresHarnessHistory(harness, partition, label, 0);
}

/** Decides the fixture history's first entry for a partition this memory holds. */
async function commitFirst(memory: ProjectMemory, label: string) {
  const item = await postgresHarnessAccepted(
    harness,
    memory.lease.partition,
    label,
    0,
  );
  return projectWriterDecide(postgresHarnessWriter(harness), memory, item);
}

/** Every entry the lease's partition holds, asserted to have parsed. */
async function entriesOf(lease: Lease): Promise<readonly Entry[]> {
  const loaded = await harness.store.load(lease);
  assert.ok(loaded.parsed === "Ok");
  return loaded.value;
}

/** How long the neighbouring decision gets while the stall is held, which is what not waiting on the other means in time. */
const neighbourWaitMsMax = 2_000;

/** How many backends the blockade waits for, which is the one decision the case left unawaited. */
const stalledDecisions = 1;

/** A decision's outcome as a word, so a case can hold a stalled one without its rejection escaping. */
function decideOutcome(deciding: Promise<ProjectDecided>): Promise<string> {
  return deciding.then(
    (step) => step.decided.decided,
    (failure: unknown) =>
      failure instanceof Error ? failure.message : String(failure),
  );
}

test("a decision commits while another project's decision is stalled on its own row", async () => {
  const stalled = await heldProject("stalled");
  const neighbour = await heldProject("neighbour");
  const writer = postgresHarnessWriter(harness);
  const stalledItem = await postgresHarnessAccepted(
    harness,
    stalled.lease.partition,
    "stalled",
    0,
  );
  const neighbourItem = await postgresHarnessAccepted(
    harness,
    neighbour.lease.partition,
    "neighbour",
    0,
  );

  const lock = await postgresHarnessRowLock(stalled.lease.partition);
  const stalling = decideOutcome(
    projectWriterDecide(writer, stalled, stalledItem),
  );
  try {
    await lock.stalled(stalledDecisions);
    const decided = await Promise.race([
      decideOutcome(projectWriterDecide(writer, neighbour, neighbourItem)),
      delay(neighbourWaitMsMax, "still waiting on the stalled project", {
        ref: false,
      }),
    ]);
    assert.equal(decided, "Committed");
  } finally {
    await lock.release();
  }
  assert.equal(await stalling, "Committed");
});

test("a load returns the partition's own entries and no other partition's", async () => {
  const left = await heldProject("ownleft");
  const right = await heldProject("ownright");
  const committed = await commitFirst(left, "ownleft");
  assert.ok(committed.decided.decided === "Committed");

  assert.deepEqual(await entriesOf(committed.memory.lease), [
    postgresHarnessJournal()[0],
  ]);
  assert.deepEqual(await entriesOf(right.lease), []);
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
  /**
   * The shadow tenant is invented here rather than seeded by the helper, so it
   * is established before a project can reference it.
   */
  await harness.query(
    `INSERT INTO tenant (tenant, display_name, lifecycle)
       VALUES ($1, $1, 'Active') ON CONFLICT (tenant) DO NOTHING`,
    [shadow.tenant],
  );
  await harness.store.createProject(shadow);
  const other = await postgresHarnessHeld(
    harness.store,
    shadow,
    "samenameother",
  );
  await commitFirst(left, "samename");

  assert.deepEqual(await entriesOf(other), []);
  const standing = await harness.store.standing(shadow);
  assert.ok(standing !== undefined);
  assert.equal(standing.head, 0);
});
