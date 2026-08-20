/**
 * The expected-head append: what commits, what is refused, and what the stored
 * chain says about the history it holds.
 *
 * THE ENTRIES ARE THE ACTOR'S OWN, not invented rows. A fixture written by
 * hand would prove the adapter stores what it is given; entries produced by
 * `journalStep` and read back through `journalLegalOn` prove the round trip
 * preserves a history the machine would accept, which is the property replay
 * actually needs.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { journalLegalOn, type Entry } from "../../src/actor/journal.ts";
import {
  journalChainDigest,
  journalChainGenesis,
} from "../../src/adapters/postgres/digest.ts";
import type { Lease, Partition } from "../../src/interpreter/projectStore.ts";
import { refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessExpire,
  postgresHarnessFirstEntry,
  postgresHarnessHeld,
  postgresHarnessOpen,
  postgresHarnessJournal,
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

/** Acquires the partition, so a case that is about appending reads as one line. */
function held(partition: Partition, label: string): Promise<Lease> {
  return postgresHarnessHeld(harness.store, partition, label);
}

/** Appends the whole journal, threading each commit's head into the next lease. */
async function appendAll(
  lease: Lease,
  journal: readonly Entry[],
): Promise<Lease> {
  let at = lease;
  for (const entry of journal) {
    const appended = await harness.store.append(at, entry);
    assert.equal(appended.appended, "Committed");
    assert.ok(appended.appended === "Committed");
    at = { ...at, head: appended.head };
  }
  return at;
}

test("an append commits, advances the head, and loads back as a legal journal", async () => {
  const partition = await postgresHarnessProject(harness.store, "append");
  const journal = postgresHarnessJournal();
  const lease = await appendAll(await held(partition, "writer"), journal);
  assert.equal(lease.head, journal.length);

  const loaded = await harness.store.load(lease);
  assert.equal(loaded.parsed, "Ok");
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(loaded.value, journal);
  assert.ok(journalLegalOn(refinementInstance, loaded.value));
});

test("a stale head is refused, and the refusal carries the head the writer should have seen", async () => {
  const partition = await postgresHarnessProject(harness.store, "stale");
  const journal = postgresHarnessJournal();
  const lease = await held(partition, "writer");
  await appendAll(lease, journal);

  const refused = await harness.store.append(
    lease,
    postgresHarnessFirstEntry(),
  );
  assert.equal(refused.appended, "StaleHead");
  assert.ok(refused.appended === "StaleHead");
  assert.equal(refused.head, journal.length);
});

test("two appends racing at one head commit exactly one", async () => {
  const partition = await postgresHarnessProject(harness.store, "race");
  const lease = await held(partition, "writer");
  const first = postgresHarnessFirstEntry();

  const [left, right] = await Promise.all([
    harness.store.append(lease, first),
    harness.store.append(lease, first),
  ]);
  const outcomes = [left.appended, right.appended].sort();
  assert.deepEqual(outcomes, ["Committed", "StaleHead"]);
});

test("a fenced writer cannot commit, even holding a lease that was once valid", async () => {
  const partition = await postgresHarnessProject(harness.store, "fenced");
  const former = await held(partition, "former");
  await postgresHarnessExpire(harness, partition);
  const successor = await held(partition, "successor");

  const refused = await harness.store.append(
    former,
    postgresHarnessFirstEntry(),
  );
  assert.equal(refused.appended, "Fenced");
  assert.ok(refused.appended === "Fenced");
  assert.equal(refused.fencingEpoch, successor.fencingEpoch);
  assert.deepEqual((await harness.store.load(successor)).parsed, "Ok");
});

test("a load under a fenced lease is refused, not served the prefix it would replay", async () => {
  const partition = await postgresHarnessProject(harness.store, "loadfenced");
  const former = await held(partition, "former");
  await appendAll(former, postgresHarnessJournal());
  await postgresHarnessExpire(harness, partition);
  await held(partition, "successor");

  const refused = await harness.store.load(former);
  assert.equal(refused.parsed, "Refused");
  assert.ok(refused.parsed === "Refused");
  assert.match(refused.why, /no longer honoured/);
});

test("a suspended project accepts no entry from the writer that held it", async () => {
  const partition = await postgresHarnessProject(harness.store, "suspend");
  const lease = await held(partition, "writer");
  await harness.store.fence(partition, "IntegrityBlocked");

  const refused = await harness.store.append(
    lease,
    postgresHarnessFirstEntry(),
  );
  assert.equal(refused.appended, "NotActive");
  assert.ok(refused.appended === "NotActive");
  assert.equal(refused.lifecycle, "IntegrityBlocked");
});

test("an entry offered at the wrong sequence is the writer's bug, not a refusal", async () => {
  const partition = await postgresHarnessProject(harness.store, "misnumber");
  const lease = await held(partition, "writer");
  const second = postgresHarnessJournal()[1];
  assert.ok(second !== undefined);
  await assert.rejects(
    () => harness.store.append(lease, second),
    /was offered against head/,
  );
});

test("each stored digest chains onto its predecessor, and the first onto the partition's genesis", async () => {
  const partition = await postgresHarnessProject(harness.store, "chain");
  const journal = postgresHarnessJournal();
  await appendAll(await held(partition, "writer"), journal);

  const stored = (await harness.query(
    "SELECT seq, entry_digest, prev_digest FROM journal_entry WHERE tenant = $1 AND project = $2 ORDER BY seq",
    [partition.tenant, partition.project],
  )) as readonly { entry_digest: string; prev_digest: string }[];

  assert.equal(stored.length, journal.length);
  let previous = journalChainGenesis(partition);
  for (const [at, row] of stored.entries()) {
    const entry = journal[at];
    assert.ok(entry !== undefined);
    assert.equal(row.prev_digest, previous);
    assert.equal(
      row.entry_digest,
      journalChainDigest(partition, previous, entry),
    );
    previous = row.entry_digest;
  }
});

test("a journal grafted onto another partition disagrees at its first entry", async () => {
  const home = await postgresHarnessProject(harness.store, "graft");
  const away = await postgresHarnessProject(harness.store, "grafted");
  const journal = postgresHarnessJournal();
  await appendAll(await held(home, "writer"), journal);

  await harness.query(
    `INSERT INTO journal_entry
       (tenant, project, seq, entry, entry_digest, prev_digest, owner, fencing_epoch, recovery_epoch)
     SELECT $3, $4, seq, entry, entry_digest, prev_digest, owner, fencing_epoch, recovery_epoch
       FROM journal_entry WHERE tenant = $1 AND project = $2`,
    [home.tenant, home.project, away.tenant, away.project],
  );
  await harness.query(
    "UPDATE project SET head = $3 WHERE tenant = $1 AND project = $2",
    [away.tenant, away.project, journal.length],
  );

  const stored = (await harness.query(
    "SELECT entry_digest, prev_digest FROM journal_entry WHERE tenant = $1 AND project = $2 ORDER BY seq",
    [away.tenant, away.project],
  )) as readonly { entry_digest: string; prev_digest: string }[];
  const first = stored[0];
  const entry = journal[0];
  assert.ok(first !== undefined && entry !== undefined);
  assert.notEqual(first.prev_digest, journalChainGenesis(away));
  assert.notEqual(
    first.entry_digest,
    journalChainDigest(away, first.prev_digest, entry),
  );
});

test("a stored row that is not JSON is refused by returning, not thrown on", async () => {
  const partition = await postgresHarnessProject(harness.store, "notjson");
  const journal = postgresHarnessJournal();
  const lease = await appendAll(await held(partition, "writer"), journal);

  await harness.query(
    "UPDATE journal_entry SET entry = 'not json' WHERE tenant = $1 AND project = $2 AND seq = 1",
    [partition.tenant, partition.project],
  );

  const loaded = await harness.store.load(lease);
  assert.equal(loaded.parsed, "Refused");
  assert.ok(loaded.parsed === "Refused");
  assert.match(loaded.why, /not JSON/);
});

test("a stored row that is JSON but not an entry is refused by the schema", async () => {
  const partition = await postgresHarnessProject(harness.store, "notentry");
  const journal = postgresHarnessJournal();
  const lease = await appendAll(await held(partition, "writer"), journal);

  await harness.query(
    `UPDATE journal_entry SET entry = '{"seq":1}' WHERE tenant = $1 AND project = $2 AND seq = 1`,
    [partition.tenant, partition.project],
  );

  const loaded = await harness.store.load(lease);
  assert.equal(loaded.parsed, "Refused");
});
