/**
 * The global recovery epoch: established once, never reused, and read back as
 * the latest.
 *
 * WHY NON-REUSE IS THE CASE THAT MATTERS. The epoch's whole job is to make
 * authority issued before a restore unusable after it. An epoch that could be
 * established a second time would let a restored database re-issue the exact
 * identity a lost writer is still holding, which is the one failure the
 * mechanism exists to prevent.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  postgresHarnessNewEpoch,
  postgresHarnessOpen,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

test("the current epoch is the one most recently established", async () => {
  const established = await harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  assert.equal(await harness.store.currentRecoveryEpoch(), established);
});

test("an epoch is never established twice", async () => {
  const epoch = postgresHarnessNewEpoch();
  await harness.store.establishRecoveryEpoch(epoch);
  await assert.rejects(
    () => harness.store.establishRecoveryEpoch(epoch),
    /never reused/,
  );
});

test("establishing a later epoch leaves the earlier one on record", async () => {
  const earlier = await harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  const later = await harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  assert.notEqual(earlier, later);
  assert.equal(await harness.store.currentRecoveryEpoch(), later);
  const kept = await harness.query(
    "SELECT epoch FROM recovery_epoch WHERE epoch = $1",
    [earlier],
  );
  assert.equal(kept.length, 1);
});
