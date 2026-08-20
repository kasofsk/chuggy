import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  asAuthorityKind,
  asAuthoritySubject,
  type Cancellation,
} from "../../src/interpreter/operationInbox.ts";
import {
  projectWriterDecide,
  projectWriterLoad,
} from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessDecisionSubmission,
  postgresHarnessHeld,
  postgresHarnessOpen,
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

test("typed operation acceptance creates one decision input and derives priority", async () => {
  const partition = await postgresHarnessProject(harness.store, "typed-input");
  const submission = postgresHarnessSubmission(partition, "typed-input");
  const accepted = await harness.inbox.accept(submission);
  assert.equal(accepted.accepted, "Accepted");
  assert.deepEqual(
    await harness.query(
      `SELECT input_kind, input_id, base_priority, state FROM decision_input
        WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [
      {
        input_kind: "Operation",
        input_id: submission.operation,
        base_priority: "Ordinary",
        state: "Pending",
      },
    ],
  );
});

test("cancellation terminalizes the decision input without a journal entry", async () => {
  const partition = await postgresHarnessProject(harness.store, "cancel-input");
  const submission = postgresHarnessSubmission(partition, "cancel-input");
  await harness.inbox.accept(submission);
  const cancellation: Cancellation = {
    partition,
    operation: submission.operation,
    authority: {
      kind: asAuthorityKind("User"),
      subject: asAuthoritySubject("canceller"),
    },
  };
  assert.equal(
    (await harness.inbox.cancel(cancellation)).cancelled,
    "Cancelled",
  );
  assert.deepEqual(
    await harness.query(
      `SELECT state, decided_seq FROM decision_input
      WHERE tenant=$1 AND project=$2 AND input_id=$3`,
      [partition.tenant, partition.project, submission.operation],
    ),
    [{ state: "Cancelled", decided_seq: null }],
  );
});

test("journal, input outcome, projection and focused execution request commit together", async () => {
  const partition = await postgresHarnessProject(harness.store, "materialized");
  const lease = await postgresHarnessHeld(
    harness.store,
    partition,
    "materialized",
  );
  const writer = postgresHarnessWriter(harness);
  let memory = await projectWriterLoad(writer, lease);

  for (const index of [0, 1]) {
    const submission = postgresHarnessDecisionSubmission(
      partition,
      `decision-${String(index)}`,
      index,
    );
    assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
    const input = await harness.discovery.next(partition, 300);
    assert.ok(input !== undefined);
    const result = await projectWriterDecide(writer, memory, input);
    assert.equal(result.decided.decided, "Committed");
    memory = result.memory;
  }

  assert.deepEqual(
    await harness.query(
      `SELECT kind, state FROM execution_request WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ kind: "SpawnWork", state: "Open" }],
  );
  assert.ok(
    (
      await harness.query(
        `SELECT task, kind FROM execution_request_task WHERE tenant=$1 AND project=$2 ORDER BY task`,
        [partition.tenant, partition.project],
      )
    ).length > 0,
  );
  assert.deepEqual(
    await harness.query(
      `SELECT state, decided_seq FROM decision_input
      WHERE tenant=$1 AND project=$2 ORDER BY ordinal`,
      [partition.tenant, partition.project],
    ),
    [
      { state: "Journaled", decided_seq: "1" },
      { state: "Journaled", decided_seq: "2" },
    ],
  );
});

test("the API role cannot fabricate a continuation input", async () => {
  const refusal = await harness.attemptAs(
    "chuggy_api",
    `INSERT INTO decision_input
       (tenant,project,ordinal,input_kind,input_id,base_priority,lifecycle_generation)
     VALUES ('t','p',1,'Continuation','c','Continuation',1)`,
  );
  assert.match(refusal ?? "", /permission denied/);
});
