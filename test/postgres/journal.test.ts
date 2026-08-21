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
 * about that transaction rather than about this file's subject. The load's own
 * fence stays here: it refuses a lease the row no longer honours, and that is
 * a claim about the load.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { journalLegalOn } from "../../src/actor/journal.ts";
import {
  journalChainGenesis,
  journalEnvelopeDigest,
} from "../../src/adapters/postgres/digest.ts";
import { refinementInstance } from "../actor/harness.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import {
  postgresHarnessExpire,
  postgresHarnessHeld,
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

  const loaded = await harness.store.load(memory.lease);
  assert.equal(loaded.parsed, "Ok");
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(loaded.value, journal);
  assert.ok(journalLegalOn(refinementInstance, loaded.value));
});

test("load refuses a changed complete-envelope digest", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "envelope-tamper",
  );
  const memory = await postgresHarnessHistory(harness, partition, "writer", 1);
  await harness.query(
    "UPDATE journal_entry SET entry_digest=$4 WHERE tenant=$1 AND project=$2 AND seq=$3",
    [partition.tenant, partition.project, 1, "0".repeat(64)],
  );
  const loaded = await harness.store.load(memory.lease);
  assert.equal(loaded.parsed, "Refused");
  assert.ok(loaded.parsed === "Refused");
  assert.match(loaded.why, /integrity verification/);
});

test("a load under a fenced lease is refused, not served the prefix it would replay", async () => {
  const partition = await postgresHarnessProject(harness.store, "loadfenced");
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "former",
    postgresHarnessJournal().length,
  );
  await postgresHarnessExpire(harness, partition);
  await postgresHarnessHeld(harness.store, partition, "successor");

  const refused = await harness.store.load(memory.lease);
  assert.equal(refused.parsed, "Refused");
  assert.ok(refused.parsed === "Refused");
  assert.match(refused.why, /no longer honoured/);
});

test("each stored digest chains onto its predecessor, and the first onto the partition's genesis", async () => {
  const partition = await postgresHarnessProject(harness.store, "chain");
  const journal = postgresHarnessJournal();
  await postgresHarnessHistory(harness, partition, "writer", journal.length);

  const stored = (await harness.query(
    `SELECT seq,entry_digest,prev_digest,cause_kind,cause_id,
       release_configuration_revision,release_configuration_digest
       FROM journal_entry WHERE tenant = $1 AND project = $2 ORDER BY seq`,
    [partition.tenant, partition.project],
  )) as readonly {
    entry_digest: string;
    prev_digest: string;
    cause_kind: "Operation";
    cause_id: string;
    release_configuration_revision: string | null;
    release_configuration_digest: string | null;
  }[];

  assert.equal(stored.length, journal.length);
  let previous = journalChainGenesis(partition);
  for (const [at, row] of stored.entries()) {
    const entry = journal[at];
    assert.ok(entry !== undefined);
    assert.equal(row.prev_digest, previous);
    assert.equal(
      row.entry_digest,
      journalEnvelopeDigest(partition, previous, {
        entry,
        cause: { kind: row.cause_kind, id: asOperationId(row.cause_id) },
        ...(row.release_configuration_revision === null ||
        row.release_configuration_digest === null
          ? {}
          : {
              release: {
                configurationRevision: row.release_configuration_revision,
                configurationDigest: row.release_configuration_digest,
              },
            }),
        eventSchemaVersion: 1,
        decisionSemanticsVersion: 1,
      }),
    );
    previous = row.entry_digest;
  }
});

test("every stored entry names the decision input that caused it, and no cause names two", async () => {
  const partition = await postgresHarnessProject(harness.store, "cause");
  const journal = postgresHarnessJournal();
  await postgresHarnessHistory(harness, partition, "writer", journal.length);

  const causes = (await harness.query(
    `SELECT j.seq, j.cause_id, i.state, i.decided_seq
       FROM journal_entry j JOIN decision_input i
         ON i.tenant = j.tenant AND i.project = j.project
        AND i.input_kind = j.cause_kind AND i.input_id = j.cause_id
      WHERE j.tenant = $1 AND j.project = $2 ORDER BY j.seq`,
    [partition.tenant, partition.project],
  )) as readonly {
    seq: string;
    cause_id: string;
    state: string;
    decided_seq: string;
  }[];

  assert.equal(causes.length, journal.length);
  assert.deepEqual(
    causes.map((row) => `${row.seq} ${row.state} ${row.decided_seq}`),
    journal.map(
      (entry) => `${String(entry.seq)} Journaled ${String(entry.seq)}`,
    ),
  );
  assert.equal(new Set(causes.map((row) => row.cause_id)).size, journal.length);
});

test("a stored row that is not JSON is refused by returning, not thrown on", async () => {
  const partition = await postgresHarnessProject(harness.store, "notjson");
  const memory = await postgresHarnessHistory(harness, partition, "writer", 1);

  await harness.query(
    "UPDATE journal_entry SET entry = 'not json' WHERE tenant = $1 AND project = $2 AND seq = 1",
    [partition.tenant, partition.project],
  );

  const loaded = await harness.store.load(memory.lease);
  assert.equal(loaded.parsed, "Refused");
  assert.ok(loaded.parsed === "Refused");
  assert.match(loaded.why, /not JSON/);
});

test("a stored row that is JSON but not an entry is refused by the schema", async () => {
  const partition = await postgresHarnessProject(harness.store, "notentry");
  const memory = await postgresHarnessHistory(harness, partition, "writer", 1);

  await harness.query(
    `UPDATE journal_entry SET entry = '{"seq":1}' WHERE tenant = $1 AND project = $2 AND seq = 1`,
    [partition.tenant, partition.project],
  );

  const loaded = await harness.store.load(memory.lease);
  assert.equal(loaded.parsed, "Refused");
});

test("the database rejects a journal that no longer reaches its decision input", async () => {
  const journal = postgresHarnessJournal();
  assert.ok(journal.length > 1);
  for (const seq of [1, journal.length]) {
    const partition = await postgresHarnessProject(harness.store, "torn");
    const memory = await postgresHarnessHistory(
      harness,
      partition,
      "writer",
      journal.length,
    );

    await assert.rejects(
      harness.query(
        "DELETE FROM journal_entry WHERE tenant = $1 AND project = $2 AND seq = $3",
        [partition.tenant, partition.project, seq],
      ),
      /violates foreign key constraint/,
    );
    assert.equal((await harness.store.load(memory.lease)).parsed, "Ok");
  }
});
