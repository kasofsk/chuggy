/**
 * What the stored journal says about the history it holds: the round trip, the
 * digest chain, and the refusals a row that no longer parses earns.
 *
 * THE ENTRIES ARE THE ACTOR'S OWN, not invented rows. A fixture written by
 * hand would prove the adapter stores what it is given; entries produced by
 * `journalStep` and read back through `storedJournalLegalOn` prove the round trip
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

import { storedJournalLegalOn } from "../../src/actor/journal.ts";
import {
  journalChainGenesis,
  journalEnvelopeDigest,
} from "../../src/adapters/postgres/digest.ts";
import { postgresJournalLegality } from "../../src/adapters/postgres/journal.ts";
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
  assert.deepEqual(
    loaded.value.map((row) => row.entry),
    journal,
  );
  assert.ok(storedJournalLegalOn(refinementInstance, loaded.value));
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

test("load refuses a v2 row whose format discriminator is downgraded", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "format-downgrade",
  );
  const memory = await postgresHarnessHistory(harness, partition, "writer", 1);
  await harness.query(
    "UPDATE journal_entry SET integrity_version=1 WHERE tenant=$1 AND project=$2 AND seq=1",
    [partition.tenant, partition.project],
  );
  const loaded = await harness.store.load(memory.lease);
  assert.equal(loaded.parsed, "Refused");
  assert.ok(loaded.parsed === "Refused");
  assert.match(loaded.why, /integrity verification/);
});

test("load refuses unsupported event and decision semantic versions", async () => {
  for (const column of [
    "event_schema_version",
    "decision_semantics_version",
  ] as const) {
    const partition = await postgresHarnessProject(
      harness.store,
      `unsupported-${column}`,
    );
    const memory = await postgresHarnessHistory(
      harness,
      partition,
      "writer",
      1,
    );
    await harness.query(
      `UPDATE journal_entry SET ${column}=3 WHERE tenant=$1 AND project=$2 AND seq=1`,
      [partition.tenant, partition.project],
    );
    const loaded = await harness.store.load(memory.lease);
    assert.equal(loaded.parsed, "Refused");
    assert.ok(loaded.parsed === "Refused");
    assert.match(loaded.why, /integrity verification/);
  }
});

test("load re-verifies the retained configuration content", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "configuration-content-tamper",
  );
  const memory = await postgresHarnessHistory(harness, partition, "writer", 1);
  await harness.query(
    `UPDATE configuration_revision SET canonical='{"image":"tampered","version":1}'
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
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
       configuration_revision,configuration_digest,event_schema_version,
       decision_semantics_version
       FROM journal_entry WHERE tenant = $1 AND project = $2 ORDER BY seq`,
    [partition.tenant, partition.project],
  )) as readonly {
    entry_digest: string;
    prev_digest: string;
    cause_kind: "Operation";
    cause_id: string;
    configuration_revision: string | null;
    configuration_digest: string | null;
    event_schema_version: 1;
    decision_semantics_version: 2;
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
        configuration: {
          configurationRevision: row.configuration_revision ?? "",
          configurationDigest: row.configuration_digest ?? "",
        },
        eventSchemaVersion: row.event_schema_version,
        decisionSemanticsVersion: row.decision_semantics_version,
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

test("the legality scan names a history whose declared machine could not have decided it", async () => {
  const partition = await postgresHarnessProject(harness.store, "scanwalled");
  const journal = postgresHarnessJournal();
  await postgresHarnessHistory(
    harness,
    partition,
    "scanwalled",
    journal.length,
  );
  const named = `${partition.tenant}/${partition.project}`;
  const legality = postgresJournalLegality(harness.pool, refinementInstance);

  assert.ok(
    !(await legality.illegalPartitions(new AbortController().signal)).includes(
      named,
    ),
  );

  const rows = (await harness.query(
    `SELECT prev_digest,cause_id,configuration_revision,configuration_digest
       FROM journal_entry WHERE tenant=$1 AND project=$2 ORDER BY seq`,
    [partition.tenant, partition.project],
  )) as readonly {
    prev_digest: string;
    cause_id: string;
    configuration_revision: string;
    configuration_digest: string;
  }[];
  const second = rows[1];
  const entry = journal[1];
  assert.ok(second !== undefined && entry !== undefined);
  await harness.query(
    `UPDATE journal_entry SET decision_semantics_version=1,entry_digest=$4
       WHERE tenant=$1 AND project=$2 AND seq=$3`,
    [
      partition.tenant,
      partition.project,
      2,
      journalEnvelopeDigest(partition, second.prev_digest, {
        entry,
        cause: { kind: "Operation", id: asOperationId(second.cause_id) },
        configuration: {
          configurationRevision: second.configuration_revision,
          configurationDigest: second.configuration_digest,
        },
        eventSchemaVersion: 1,
        decisionSemanticsVersion: 1,
      }),
    ],
  );

  assert.ok(
    (await legality.illegalPartitions(new AbortController().signal)).includes(
      named,
    ),
  );
});
