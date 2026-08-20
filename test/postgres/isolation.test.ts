/**
 * Project isolation: one project does not serialize another, and no read or
 * write reaches across the composite key.
 *
 * THE GUARANTEE 006 MAKES IS EXACTLY THIS ONE — that one project does not
 * serialize another, rather than unlimited throughput inside a project. So the
 * case that matters holds one partition's append stalled on its own row and
 * requires its neighbour's to commit inside a bound while it waits, and the
 * case beside it is that a partition fenced, suspended or unowned leaves its
 * neighbour untouched.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { Entry } from "../../src/actor/journal.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import type {
  Appended,
  Lease,
  Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessOwner,
  postgresHarnessJournal,
  postgresHarnessProject,
  postgresHarnessUrl,
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

/** How long a case waits for an append it did not await to reach the lock that stalls it. */
const stallWaitMsMax = 5_000;

/** How often that wait asks, which is what bounds the loop asking. */
const stallAskMs = 25;

/** How long the neighbouring append gets while the stall is held, which is what not waiting on the other means in time. */
const neighbourWaitMsMax = 2_000;

/** One connection of its own holding a project row, and the way to give it back. */
interface RowLock {
  readonly blockerPid: number;
  readonly release: () => Promise<void>;
}

/**
 * Locks the partition's project row on a connection outside the harness pool,
 * so an append stalled behind it cannot also be starving the pool the rest of
 * the case draws from.
 */
async function rowLock(partition: Partition): Promise<RowLock> {
  const blockade = postgresPool(postgresHarnessUrl());
  const blocker = await blockade.connect();
  const release = async (): Promise<void> => {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await blockade.end();
  };
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT tenant FROM project WHERE tenant = $1 AND project = $2 FOR UPDATE",
      [partition.tenant, partition.project],
    );
    const found = await blocker.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const blockerPid = found.rows[0]?.pid;
    assert.ok(blockerPid !== undefined);
    return { blockerPid, release };
  } catch (failure) {
    await release();
    throw failure;
  }
}

/** Resolves once some backend is waiting on a lock `blockerPid` holds, which is how a case knows an append it did not await has stalled. */
async function stalledBehind(blockerPid: number): Promise<void> {
  for (let waitedMs = 0; waitedMs < stallWaitMsMax; waitedMs += stallAskMs) {
    const [waiting] = (await harness.query(
      "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
      [blockerPid],
    )) as readonly { waiting: number }[];
    if (waiting !== undefined && waiting.waiting > 0) return;
    await delay(stallAskMs);
  }
  throw new Error(
    `nothing stalled behind backend ${String(blockerPid)}, so this case never set up what it asserts against`,
  );
}

/** An append's outcome as a word, so a case can hold a stalled one without its rejection escaping. */
function appendOutcome(appending: Promise<Appended>): Promise<string> {
  return appending.then(
    (appended) => appended.appended,
    (failure: unknown) =>
      failure instanceof Error ? failure.message : String(failure),
  );
}

test("an append commits while another project's append is stalled on its own row", async () => {
  const stalled = await heldProject("stalled");
  const neighbour = await heldProject("neighbour");
  const entry = postgresHarnessFirstEntry();

  const lock = await rowLock(stalled.partition);
  const stalling = appendOutcome(harness.store.append(stalled, entry));
  try {
    await stalledBehind(lock.blockerPid);
    const appended = await Promise.race([
      appendOutcome(harness.store.append(neighbour, entry)),
      delay(neighbourWaitMsMax, "still waiting on the stalled project", {
        ref: false,
      }),
    ]);
    assert.equal(appended, "Committed");
  } finally {
    await lock.release();
  }
  assert.equal(await stalling, "Committed");
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
