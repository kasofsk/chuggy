import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  projectWriterDecide,
  projectWriterLoad,
} from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessDecisionSubmission,
  postgresHarnessHeld,
  postgresHarnessOpen,
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

test("an ambiguous commit is resolved from the terminal input before stale-head fences", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "ambiguous-input",
  );
  const lease = await postgresHarnessHeld(
    harness.store,
    partition,
    "ambiguous-input",
  );
  const writer = postgresHarnessWriter(harness);
  const memory = await projectWriterLoad(writer, lease);
  await harness.inbox.accept(
    postgresHarnessDecisionSubmission(partition, "ambiguous-input", 0),
  );
  const input = await harness.discovery.next(partition, 300);
  assert.ok(input !== undefined);
  assert.equal(
    (await projectWriterDecide(writer, memory, input)).decided.decided,
    "Committed",
  );
  const retry = await projectWriterDecide(writer, memory, input);
  assert.deepEqual(retry.decided, {
    decided: "AlreadyTerminal",
    outcome: {
      settled: "Succeeded",
      seq: 1,
    },
  });
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM journal_entry WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ count: "1" }],
  );
});

test("rollback before commit leaves the input pending for takeover", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "rollback-input",
  );
  const submission = postgresHarnessDecisionSubmission(
    partition,
    "rollback-input",
    0,
  );
  await harness.inbox.accept(submission);
  const transaction = await harness.begin();
  await transaction.query(
    `UPDATE project SET head=head WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  await transaction.rollback();
  assert.deepEqual(
    await harness.query(
      `SELECT state FROM decision_input WHERE tenant=$1 AND project=$2 AND input_id=$3`,
      [partition.tenant, partition.project, submission.operation],
    ),
    [{ state: "Pending" }],
  );
  assert.equal(
    (await harness.discovery.next(partition, 300))?.source.kind,
    "Operation",
  );
});
