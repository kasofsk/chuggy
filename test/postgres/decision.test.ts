/**
 * The decision transaction: what commits together, what refuses independently,
 * and what a writer that never learned its own commit gets back.
 *
 * ATOMICITY IS PROVED BY BREAKING ONE WRITE, not by reading the adapter. A
 * conflicting entry is planted at the sequence the decision is about to take,
 * so the insert fails inside the transaction that had already settled the
 * operation and acknowledged its item — and the case then asserts that none of
 * the four writes survived. An assertion that they all appear together on a
 * happy path proves nothing about a failure it never produced.
 *
 * THE THREE FENCES ARE ASSERTED SEPARATELY because they refuse separately. A
 * case that suspended a project and expired its lease at once would pass with
 * either check deleted, which is the shape of a test that names a guard it
 * does not exercise.
 *
 * THE AMBIGUOUS COMMIT IS THE RETRY WITH THE HEAD THE WRITER STILL BELIEVES.
 * That is exactly the state a caller is left in when the commit lands and the
 * answer does not, and the claim is that reading the durable operation
 * resolves it: the recorded outcome comes back, no second entry is written,
 * and the head has moved once. `crash.test.ts` produces the same seam with a
 * process that really dies.
 *
 * REPLAY IS DRIVEN THROUGH A LOAD THAT SHARES NOTHING WITH THE WRITER. The
 * writer's `Core` came from folding its own decisions; the loaded one came
 * from the journal, and the projection is compared against that second one so
 * the table is checked against the durable history rather than against the
 * memory that wrote it.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { journalLegalOn, replayCore } from "../../src/actor/journal.ts";
import {
  projectionOf,
  projectWriterDecide,
  projectWriterLoad,
} from "../../src/interpreter/projectWriter.ts";
import { refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessAccept,
  postgresHarnessAccepted,
  postgresHarnessDecisionSubmission,
  postgresHarnessEntry,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessHeld,
  postgresHarnessOpen,
  postgresHarnessOwner,
  postgresHarnessProject,
  postgresHarnessSubmission,
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

/** Every projection row the partition holds, as the text a case compares against. */
async function projectionRows(
  tenant: string,
  project: string,
): Promise<readonly string[]> {
  const rows = (await harness.query(
    "SELECT ticket, phase, seq FROM ticket_projection WHERE tenant = $1 AND project = $2 ORDER BY ticket",
    [tenant, project],
  )) as readonly { ticket: string; phase: string; seq: string }[];
  return rows.map((row) => `${row.ticket} ${row.phase} ${row.seq}`);
}

/** What the operation row says about itself, including the outcome only a decision writes. */
async function operationRow(
  operation: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = await harness.query(
    `SELECT o.state, o.outcome_code, o.decided_seq, o.settled_authority_kind,
            o.settled_authority_subject, i.consumable
       FROM operation o JOIN inbox_item i USING (tenant, project, operation)
      WHERE o.operation = $1`,
    [operation],
  );
  return rows[0];
}

test("a decision commits its entry, its outcome, its acknowledgement and its projection together", async () => {
  const partition = await postgresHarnessProject(harness.store, "commit");
  const writer = postgresHarnessWriter(harness);
  const lease = await postgresHarnessHeld(harness.store, partition, "writer");
  const memory = await projectWriterLoad(writer, lease);
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "commit",
    0,
  );

  const step = await projectWriterDecide(writer, memory, item);
  assert.ok(step.decided.decided === "Committed");
  assert.equal(step.decided.lease.head, 1);
  assert.equal(step.memory.lease.head, 1);

  assert.deepEqual(await operationRow(item.operation), {
    state: "Succeeded",
    outcome_code: null,
    decided_seq: "1",
    settled_authority_kind: "ProjectWriter",
    settled_authority_subject: lease.owner,
    consumable: false,
  });
  assert.deepEqual(await projectionRows(partition.tenant, partition.project), [
    "1 Pending 1",
  ]);
  assert.deepEqual(await harness.discovery.consumable(partition, 10), []);
});

test("a decision that cannot write its entry leaves no outcome, no acknowledgement and no projection", async () => {
  const partition = await postgresHarnessProject(harness.store, "atomic");
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "writer"),
  );
  const blocker = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "blocker",
    0,
  );
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "atomic",
    0,
  );

  await harness.query(
    `INSERT INTO journal_entry
       (tenant, project, seq, entry, entry_digest, prev_digest, owner, fencing_epoch,
        recovery_epoch, cause_operation)
     VALUES ($1, $2, 1, '{}', 'planted', 'planted', 'planted', 1, $3, $4)`,
    [
      partition.tenant,
      partition.project,
      await harness.store.currentRecoveryEpoch(),
      blocker.operation,
    ],
  );

  await assert.rejects(() => projectWriterDecide(writer, memory, item));

  assert.deepEqual(await operationRow(item.operation), {
    state: "Pending",
    outcome_code: null,
    decided_seq: null,
    settled_authority_kind: null,
    settled_authority_subject: null,
    consumable: true,
  });
  assert.deepEqual(
    await projectionRows(partition.tenant, partition.project),
    [],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT head FROM project WHERE tenant = $1 AND project = $2",
      [partition.tenant, partition.project],
    ),
    [{ head: "0" }],
  );
});

test("a domain refusal settles and acknowledges its operation and writes no journal entry", async () => {
  const partition = await postgresHarnessProject(harness.store, "refuse");
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "writer"),
  );
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "refuse",
    1,
  );

  const step = await projectWriterDecide(writer, memory, item);
  assert.ok(step.decided.decided === "Refused");
  assert.deepEqual(step.memory, memory);

  assert.deepEqual(await operationRow(item.operation), {
    state: "Refused",
    outcome_code: "NotEnabled",
    decided_seq: null,
    settled_authority_kind: "ProjectWriter",
    settled_authority_subject: memory.lease.owner,
    consumable: false,
  });
  const loaded = await harness.store.load(memory.lease);
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(loaded.value, []);
  assert.deepEqual(
    await projectionRows(partition.tenant, partition.project),
    [],
  );
});

test("a command the machine cannot read is refused durably rather than retried", async () => {
  const partition = await postgresHarnessProject(harness.store, "unreadable");
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "writer"),
  );
  const item = await postgresHarnessAccept(
    harness.inbox,
    postgresHarnessSubmission(partition, "unreadable"),
  );

  const step = await projectWriterDecide(writer, memory, item);
  assert.ok(step.decided.decided === "Refused");
  assert.equal(
    (await operationRow(item.operation))?.["outcome_code"],
    "CommandUnreadable",
  );
});

test("a suspended project refuses a decision from the writer that held it", async () => {
  const partition = await postgresHarnessProject(harness.store, "suspend");
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "writer"),
  );
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "suspend",
    0,
  );
  await harness.store.fence(partition, "IntegrityBlocked");

  const step = await projectWriterDecide(writer, memory, item);
  assert.ok(step.decided.decided === "NotActive");
  assert.equal(step.decided.lifecycle, "IntegrityBlocked");
  assert.deepEqual(step.memory, memory);
  assert.equal((await operationRow(item.operation))?.["state"], "Pending");
});

test("a fenced writer cannot decide, even holding a lease that was once valid", async () => {
  const partition = await postgresHarnessProject(harness.store, "fenced");
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "former"),
  );
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "fenced",
    0,
  );

  await harness.query(
    "UPDATE project SET lease_expires_at = now() - interval '1 second' WHERE tenant = $1 AND project = $2",
    [partition.tenant, partition.project],
  );
  const successor = await harness.store.acquire(
    partition,
    postgresHarnessOwner("successor"),
    60,
  );
  assert.ok(successor.acquired === "Granted");

  const step = await projectWriterDecide(writer, memory, item);
  assert.ok(step.decided.decided === "Fenced");
  assert.equal(step.decided.fencingEpoch, successor.lease.fencingEpoch);
  assert.deepEqual(step.memory, memory);
  assert.equal((await operationRow(item.operation))?.["state"], "Pending");
});

test("a stale head is refused, and the refusal carries the head the writer should have seen", async () => {
  const partition = await postgresHarnessProject(harness.store, "stale");
  const writer = postgresHarnessWriter(harness);
  const stale = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "writer"),
  );
  const first = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "stalefirst",
    0,
  );
  const second = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "stalesecond",
    0,
  );

  const moved = await projectWriterDecide(writer, stale, first);
  assert.ok(moved.decided.decided === "Committed");

  const step = await projectWriterDecide(writer, stale, second);
  assert.ok(step.decided.decided === "StaleHead");
  assert.equal(step.decided.head, 1);
  assert.deepEqual(step.memory, stale);
  assert.equal((await operationRow(second.operation))?.["state"], "Pending");
});

test("two decisions racing at one head commit exactly one", async () => {
  const partition = await postgresHarnessProject(harness.store, "race");
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "writer"),
  );
  const left = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "raceleft",
    0,
  );
  const right = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "raceright",
    0,
  );

  const [one, two] = await Promise.all([
    projectWriterDecide(writer, memory, left),
    projectWriterDecide(writer, memory, right),
  ]);
  assert.deepEqual([one.decided.decided, two.decided.decided].sort(), [
    "Committed",
    "StaleHead",
  ]);
});

test("a decision retried at the head it committed from answers with the outcome it never heard", async () => {
  const partition = await postgresHarnessProject(harness.store, "ambiguous");
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "writer"),
  );
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "ambiguous",
    0,
  );

  const committed = await projectWriterDecide(writer, memory, item);
  assert.ok(committed.decided.decided === "Committed");

  const retried = await projectWriterDecide(writer, memory, item);
  assert.ok(retried.decided.decided === "AlreadyTerminal");
  assert.deepEqual(retried.decided.outcome, { settled: "Succeeded", seq: 1 });
  assert.equal(retried.memory.lease.head, 0);

  const loaded = await harness.store.load(memory.lease);
  assert.ok(loaded.parsed === "Ok");
  assert.equal(loaded.value.length, 1);
});

test("a refusal retried the same way answers with the code it recorded", async () => {
  const partition = await postgresHarnessProject(harness.store, "refusedagain");
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "writer"),
  );
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "refusedagain",
    1,
  );

  assert.equal(
    (await projectWriterDecide(writer, memory, item)).decided.decided,
    "Refused",
  );
  const retried = await projectWriterDecide(writer, memory, item);
  assert.ok(retried.decided.decided === "AlreadyTerminal");
  assert.deepEqual(retried.decided.outcome, {
    settled: "Refused",
    code: "NotEnabled",
  });
});

test("an operation cancelled while the writer was deciding is never journaled", async () => {
  const partition = await postgresHarnessProject(harness.store, "cancelrace");
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, "writer"),
  );
  const submission = postgresHarnessDecisionSubmission(
    partition,
    "cancelrace",
    0,
  );
  const item = await postgresHarnessAccept(harness.inbox, submission);
  assert.equal(
    (
      await harness.inbox.cancel({
        partition,
        operation: submission.operation,
        authority: submission.authority,
      })
    ).cancelled,
    "Cancelled",
  );

  const step = await projectWriterDecide(writer, memory, item);
  assert.ok(step.decided.decided === "AlreadyTerminal");
  assert.deepEqual(step.decided.outcome, { settled: "Cancelled" });
  const loaded = await harness.store.load(memory.lease);
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(loaded.value, []);
});

test("a second entry for one cause is refused by the server, whatever a writer believes", async () => {
  const partition = await postgresHarnessProject(harness.store, "onecause");
  const memory = await postgresHarnessHistory(harness, partition, "writer", 1);
  const causes = (await harness.query(
    "SELECT cause_operation FROM journal_entry WHERE tenant = $1 AND project = $2",
    [partition.tenant, partition.project],
  )) as readonly { cause_operation: string }[];
  const cause = causes[0]?.cause_operation;
  assert.ok(cause !== undefined);

  await assert.rejects(
    () =>
      harness.query(
        `INSERT INTO journal_entry
           (tenant, project, seq, entry, entry_digest, prev_digest, owner, fencing_epoch,
            recovery_epoch, cause_operation)
         VALUES ($1, $2, 2, '{}', 'd', 'p', 'o', 1, $3, $4)`,
        [
          partition.tenant,
          partition.project,
          memory.lease.recoveryEpoch,
          cause,
        ],
      ),
    /journal_entry_cause_is_effective/,
  );
});

test("a fresh load replays to the writer's own state, and the projection agrees with it", async () => {
  const partition = await postgresHarnessProject(harness.store, "replay");
  const journal = postgresHarnessJournal();
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "writer",
    journal.length,
  );

  const loaded = await harness.store.load(memory.lease);
  assert.ok(loaded.parsed === "Ok");
  assert.ok(journalLegalOn(refinementInstance, loaded.value));
  const replayed = replayCore(refinementInstance, loaded.value);
  assert.deepEqual(replayed, memory.core);

  assert.deepEqual(
    await projectionRows(partition.tenant, partition.project),
    projectionOf(replayed).map(
      (row) => `${String(row.ticket)} ${row.phase} ${String(journal.length)}`,
    ),
  );
});

test("a command naming a decision the state has moved past is refused rather than journaled", async () => {
  const partition = await postgresHarnessProject(harness.store, "moved");
  const writer = postgresHarnessWriter(harness);
  const memory = await postgresHarnessHistory(harness, partition, "writer", 2);
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "moved",
    1,
  );

  const step = await projectWriterDecide(writer, memory, item);
  assert.ok(step.decided.decided === "Refused");
  assert.equal(
    (await operationRow(item.operation))?.["outcome_code"],
    "NotEnabled",
  );
  assert.equal(memory.lease.head, 2);
});

test("the outcome columns admit exactly the vocabulary this code declares", async () => {
  const partition = await postgresHarnessProject(harness.store, "vocabulary");
  const submission = postgresHarnessSubmission(partition, "vocabulary");
  const accepted = await harness.inbox.accept(submission);
  assert.ok(accepted.accepted === "Accepted");
  const columns = `
    tenant, project, operation, authority_kind, authority_subject, admission,
    key_version, key_digest, payload_digest, command, lifecycle_generation,
    state, settled_at, decided_seq, outcome_code
  `;
  const born = (
    state: string,
    decided: string,
    code: string,
  ): Promise<unknown> =>
    harness.query(
      `INSERT INTO operation (${columns})
       VALUES ($1, $2, $3, 'k', 's', 'Ordinary', 'v', $4, 'p', '{}', 1, '${state}',
               now(), ${decided}, ${code})`,
      [
        partition.tenant,
        partition.project,
        `${submission.operation}-${state}-${decided}-${code}`,
        `digest-${state}-${decided}-${code}`,
      ],
    );

  await assert.rejects(
    () => born("Refused", "NULL", "'WhoKnows'"),
    /operation_outcome_code_is_known/,
  );
  await assert.rejects(
    () => born("Succeeded", "NULL", "NULL"),
    /operation_outcome_is_whole/,
  );
  await assert.rejects(
    () => born("Refused", "NULL", "NULL"),
    /operation_outcome_is_whole/,
  );
  await assert.rejects(
    () =>
      harness.query(
        "INSERT INTO ticket_projection (tenant, project, ticket, phase, seq) VALUES ($1, $2, 1, 'Sideways', 1)",
        [partition.tenant, partition.project],
      ),
    /ticket_projection_phase_is_known/,
  );
  const epoch = await harness.store.currentRecoveryEpoch();
  await assert.rejects(
    () =>
      harness.query(
        `INSERT INTO journal_entry
           (tenant, project, seq, entry, entry_digest, prev_digest, owner, fencing_epoch,
            recovery_epoch, cause_operation)
         VALUES ($1, $2, 1, '{}', 'd', 'p', 'o', 1, $3, 'a-cause-nobody-accepted')`,
        [partition.tenant, partition.project, epoch],
      ),
    /journal_entry_has_its_cause/,
  );
});

test("an entry offered at the wrong sequence is the writer's bug, not a refusal", async () => {
  const partition = await postgresHarnessProject(harness.store, "misnumber");
  const memory = await postgresHarnessHistory(harness, partition, "writer", 0);
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "misnumber",
    0,
  );
  await assert.rejects(
    () =>
      harness.decisions.decide({
        lease: memory.lease,
        cause: item.operation,
        outcome: {
          outcome: "Journaled",
          entry: postgresHarnessEntry(1),
          projection: [],
        },
      }),
    /was offered against head/,
  );
  assert.equal((await operationRow(item.operation))?.["state"], "Pending");
});
