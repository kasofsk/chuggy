/**
 * The recovery epoch as a fence: what a writer holding authority from before a
 * restore may still do.
 *
 * THIS IS THE CASE THE EPOCH EXISTS FOR, and it is the one the project row
 * cannot answer on its own. A point-in-time restore brings every project-local
 * counter back exactly as the lost interval left it, so a pre-restore owner
 * finds its own identity, its own fencing epoch and an unexpired lease waiting
 * for it. Only the global epoch has moved, so only the global epoch can tell
 * that writer it is no longer current.
 *
 * ESTABLISHING AN EPOCH HERE MOVES THE WHOLE DATABASE, which is why
 * `.chug/tasks/check-postgres.sh` runs these suites one at a time: a second
 * case holding a lease concurrently would be fenced by this one and would
 * report it as the adapter's fault.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { projectWriterDecide } from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessAccepted,
  postgresHarnessExpire,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessNewEpoch,
  postgresHarnessOpen,
  postgresHarnessOwner,
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

test("a lease issued before a restore can neither commit nor renew after it", async () => {
  const partition = await postgresHarnessProject(harness.store, "restore");
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "preRestore",
    0,
  );
  const stranded = memory.lease;
  const item = await postgresHarnessAccepted(harness, partition, "restore", 0);

  await harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());

  const refused = await projectWriterDecide(
    postgresHarnessWriter(harness),
    memory,
    item,
  );
  assert.equal(refused.decided.decided, "Fenced");

  const renewal = await harness.store.renew(stranded, 3600);
  assert.equal(renewal.renewed, "Fenced");

  const stored = await harness.query(
    "SELECT seq FROM journal_entry WHERE tenant = $1 AND project = $2",
    [partition.tenant, partition.project],
  );
  assert.deepEqual(stored, []);
});

test("a lease issued before a restore cannot release the project either", async () => {
  const partition = await postgresHarnessProject(harness.store, "stranded");
  const acquired = await harness.store.acquire(
    partition,
    postgresHarnessOwner("preRestore"),
    3600,
  );
  assert.ok(acquired.acquired === "Granted");

  await harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  await harness.store.release(acquired.lease);

  const successor = await harness.store.acquire(
    partition,
    postgresHarnessOwner("successor"),
    3600,
  );
  assert.equal(successor.acquired, "HeldByAnother");
  assert.ok(successor.acquired === "HeldByAnother");
  assert.equal(successor.owner, acquired.lease.owner);
});

test("a lease taken after the restore carries the new epoch, and commits and replays under it", async () => {
  const partition = await postgresHarnessProject(harness.store, "reissued");
  const epoch = await harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "postRestore",
    1,
  );
  assert.equal(memory.lease.recoveryEpoch, epoch);
  assert.equal(memory.lease.head, 1);

  const loaded = await harness.store.load(memory.lease);
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(
    loaded.value.map((row) => row.entry),
    [postgresHarnessJournal()[0]],
  );
});

test("the stranded owner's project is acquired afresh under the current epoch", async () => {
  const partition = await postgresHarnessProject(harness.store, "reacquire");
  const stranded = await harness.store.acquire(
    partition,
    postgresHarnessOwner("stranded"),
    3600,
  );
  assert.ok(stranded.acquired === "Granted");

  const epoch = await harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  const successor = await harness.store.acquire(
    partition,
    postgresHarnessOwner("successor"),
    3600,
  );
  assert.ok(successor.acquired === "HeldByAnother");

  await postgresHarnessExpire(harness, partition);
  const taken = await harness.store.acquire(
    partition,
    postgresHarnessOwner("successor"),
    3600,
  );
  assert.ok(taken.acquired === "Granted");
  assert.equal(taken.lease.recoveryEpoch, epoch);
  assert.equal(taken.lease.fencingEpoch, stranded.lease.fencingEpoch + 1);
});
