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

import {
  postgresHarnessJournal,
  postgresHarnessNewEpoch,
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

test("a lease issued before a restore can neither commit nor renew after it", async () => {
  const partition = await postgresHarnessProject(harness.store, "restore");
  const acquired = await harness.store.acquire(
    partition,
    postgresHarnessOwner("preRestore"),
    3600,
  );
  assert.ok(acquired.acquired === "Granted");
  const stranded = acquired.lease;

  const first = postgresHarnessJournal()[0];
  assert.ok(first !== undefined);

  await harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());

  const refused = await harness.store.append(stranded, first);
  assert.equal(refused.appended, "Fenced");

  const renewal = await harness.store.renew(stranded, 3600);
  assert.equal(renewal.renewed, "Fenced");

  const loaded = await harness.store.load(partition);
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(loaded.value, []);
});

test("a lease taken after the restore carries the new epoch and commits", async () => {
  const partition = await postgresHarnessProject(harness.store, "reissued");
  const epoch = await harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  const acquired = await harness.store.acquire(
    partition,
    postgresHarnessOwner("postRestore"),
    3600,
  );
  assert.ok(acquired.acquired === "Granted");
  assert.equal(acquired.lease.recoveryEpoch, epoch);

  const first = postgresHarnessJournal()[0];
  assert.ok(first !== undefined);
  const appended = await harness.store.append(acquired.lease, first);
  assert.equal(appended.appended, "Committed");
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

  await harness.query(
    "UPDATE project SET lease_expires_at = now() - interval '1 second' WHERE tenant = $1 AND project = $2",
    [partition.tenant, partition.project],
  );
  const taken = await harness.store.acquire(
    partition,
    postgresHarnessOwner("successor"),
    3600,
  );
  assert.ok(taken.acquired === "Granted");
  assert.equal(taken.lease.recoveryEpoch, epoch);
  assert.equal(taken.lease.fencingEpoch, stranded.lease.fencingEpoch + 1);
});
