/**
 * What the stored journal says about the history it holds: the round trip, the
 * digest chain, and the refusals a row that no longer parses earns.
 *
 * THE ENTRIES ARE THE ACTOR'S OWN, not invented rows. A fixture written by
 * hand would prove the adapter stores what it is given; entries produced by
 * `journalStep` and read back through `journalLegalOn` prove the round trip
 * preserves a history the machine would accept, which is the property replay
 * actually needs.
 *
 * THE FENCES ARE `decision.test.ts`'S. An entry is written only by the
 * decision transaction now, so what stops one from being written is a claim
 * about that transaction rather than about this file's subject.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { journalLegalOn } from "../../src/actor/journal.ts";
import {
  journalChainDigest,
  journalChainGenesis,
} from "../../src/adapters/postgres/digest.ts";
import { refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
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

test("a committed history advances the head and loads back as a legal journal", async () => {
  const partition = await postgresHarnessProject(harness.store, "append");
  const journal = postgresHarnessJournal();
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "writer",
    journal.length,
  );
  assert.equal(memory.lease.head, journal.length);

  const loaded = await harness.store.load(partition);
  assert.equal(loaded.parsed, "Ok");
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(loaded.value, journal);
  assert.ok(journalLegalOn(refinementInstance, loaded.value));
});

test("each stored digest chains onto its predecessor, and the first onto genesis", async () => {
  const partition = await postgresHarnessProject(harness.store, "chain");
  const journal = postgresHarnessJournal();
  await postgresHarnessHistory(harness, partition, "writer", journal.length);

  const stored = (await harness.query(
    "SELECT seq, entry_digest, prev_digest FROM journal_entry WHERE tenant = $1 AND project = $2 ORDER BY seq",
    [partition.tenant, partition.project],
  )) as readonly { entry_digest: string; prev_digest: string }[];

  assert.equal(stored.length, journal.length);
  let previous = journalChainGenesis;
  for (const [at, row] of stored.entries()) {
    const entry = journal[at];
    assert.ok(entry !== undefined);
    assert.equal(row.prev_digest, previous);
    assert.equal(row.entry_digest, journalChainDigest(previous, entry));
    previous = row.entry_digest;
  }
});

test("every stored entry names the operation that caused it, and no cause names two", async () => {
  const partition = await postgresHarnessProject(harness.store, "cause");
  const journal = postgresHarnessJournal();
  await postgresHarnessHistory(harness, partition, "writer", journal.length);

  const causes = (await harness.query(
    `SELECT j.seq, j.cause_operation, o.state, o.decided_seq
       FROM journal_entry j JOIN operation o
         ON o.tenant = j.tenant AND o.project = j.project AND o.operation = j.cause_operation
      WHERE j.tenant = $1 AND j.project = $2 ORDER BY j.seq`,
    [partition.tenant, partition.project],
  )) as readonly {
    seq: string;
    cause_operation: string;
    state: string;
    decided_seq: string;
  }[];

  assert.equal(causes.length, journal.length);
  assert.deepEqual(
    causes.map((row) => `${row.seq} ${row.state} ${row.decided_seq}`),
    journal.map(
      (entry) => `${String(entry.seq)} Succeeded ${String(entry.seq)}`,
    ),
  );
  assert.equal(
    new Set(causes.map((row) => row.cause_operation)).size,
    journal.length,
  );
});

test("a stored row that is not JSON is refused by returning, not thrown on", async () => {
  const partition = await postgresHarnessProject(harness.store, "notjson");
  await postgresHarnessHistory(harness, partition, "writer", 1);

  await harness.query(
    "UPDATE journal_entry SET entry = 'not json' WHERE tenant = $1 AND project = $2 AND seq = 1",
    [partition.tenant, partition.project],
  );

  const loaded = await harness.store.load(partition);
  assert.equal(loaded.parsed, "Refused");
  assert.ok(loaded.parsed === "Refused");
  assert.match(loaded.why, /not JSON/);
});

test("a stored row that is JSON but not an entry is refused by the schema", async () => {
  const partition = await postgresHarnessProject(harness.store, "notentry");
  await postgresHarnessHistory(harness, partition, "writer", 1);

  await harness.query(
    `UPDATE journal_entry SET entry = '{"seq":1}' WHERE tenant = $1 AND project = $2 AND seq = 1`,
    [partition.tenant, partition.project],
  );

  const loaded = await harness.store.load(partition);
  assert.equal(loaded.parsed, "Refused");
});
