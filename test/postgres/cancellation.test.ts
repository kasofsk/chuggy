/**
 * Cancellation: what it settles, what it refuses, and what happens when it
 * arrives at the same moment as the decision it is trying to overtake.
 *
 * THE WRITER'S HALF IS DRIVEN AS SQL WHERE THE LOCK HAS TO BE HELD ACROSS THE
 * CANCELLATION. The real decision transaction commits before it returns, so a
 * case that needs the operation's row held while a cancellation queues behind
 * it cannot use the port — it opens its own transaction and terminalizes
 * exactly as the writer does, without a state predicate of its own, so the
 * only thing standing between the two outcomes is the trigger. The last case
 * races the real transaction instead, where holding nothing is the point.
 *
 * CANCELLATION TOUCHES NO PROJECT ROW, and one case proves it by holding that
 * row in another transaction while cancelling. 006 requires cancellation to
 * remain available without a healthy project writer, and a cancellation that
 * queued behind the project lock would be unavailable exactly when a writer
 * was stuck holding it.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  allOperationStates,
  type Cancellation,
  type OperationId,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { projectWriterDecide } from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessAccepted,
  postgresHarnessHistory,
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

/** An accepted operation on its own partition, which is what every case here starts from. */
async function pending(label: string): Promise<Submission> {
  const partition = await postgresHarnessProject(harness.store, label);
  const submission = postgresHarnessSubmission(partition, label);
  const outcome = await harness.inbox.accept(submission);
  assert.ok(outcome.accepted === "Accepted");
  return submission;
}

/** The cancellation of a submission, audited to the authority that submitted it. */
function cancellationOf(submission: Submission): Cancellation {
  return {
    partition: submission.partition,
    operation: submission.operation,
    authority: submission.authority,
  };
}

/**
 * The writer's half of the race: lock the operation and terminalize it, with
 * no state predicate of its own, and say whether the server let it commit.
 */
async function decide(
  partition: Partition,
  operation: OperationId,
): Promise<boolean> {
  const writer = await harness.begin();
  const where = "tenant = $1 AND project = $2 AND operation = $3";
  try {
    await writer.query(`SELECT 1 FROM operation WHERE ${where} FOR UPDATE`, [
      partition.tenant,
      partition.project,
      operation,
    ]);
    await writer.query(
      `UPDATE operation SET state = 'Succeeded', settled_at = now(), decided_seq = 1
        WHERE ${where}`,
      [partition.tenant, partition.project, operation],
    );
    await writer.commit();
    return true;
  } catch {
    await writer.rollback().catch(() => undefined);
    return false;
  }
}

/** The state the operation row currently records. */
async function stateOf(submission: Submission): Promise<string | undefined> {
  const standing = await harness.inbox.operation(
    submission.partition,
    submission.operation,
  );
  return standing?.state;
}

test("cancelling a pending operation settles it and makes its inbox item non-consumable", async () => {
  const submission = await pending("cancel");
  const outcome = await harness.inbox.cancel(cancellationOf(submission));

  assert.ok(outcome.cancelled === "Cancelled");
  assert.equal(outcome.operation.state, "Cancelled");
  assert.equal(outcome.operation.ordinal, 1);
  assert.equal(await stateOf(submission), "Cancelled");
  assert.deepEqual(
    await harness.discovery.consumable(submission.partition, 10),
    [],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT consumable, settled_authority_subject FROM inbox_item i JOIN operation o USING (tenant, project, operation) WHERE o.operation = $1",
      [submission.operation],
    ),
    [
      {
        consumable: false,
        settled_authority_subject: submission.authority.subject,
      },
    ],
  );
});

test("cancellation leaves readiness alone, because lowering it is the owner's proof to make", async () => {
  const submission = await pending("cancelready");
  await harness.inbox.cancel(cancellationOf(submission));

  const ready = await harness.discovery.ready(100);
  const found = ready.find(
    (each) => each.partition.project === submission.partition.project,
  );
  assert.ok(found !== undefined);
  assert.equal(found.generation, 1);
});

test("cancelling twice is one cancellation", async () => {
  const submission = await pending("twice");
  const first = await harness.inbox.cancel(cancellationOf(submission));
  const again = await harness.inbox.cancel(cancellationOf(submission));

  assert.ok(first.cancelled === "Cancelled");
  assert.ok(again.cancelled === "AlreadyCancelled");
  assert.deepEqual(again.operation, first.operation);
});

test("an operation a writer already decided is refused rather than cancelled", async () => {
  const submission = await pending("decided");
  assert.equal(await decide(submission.partition, submission.operation), true);

  const outcome = await harness.inbox.cancel(cancellationOf(submission));
  assert.ok(outcome.cancelled === "NotPending");
  assert.equal(outcome.state, "Succeeded");
  assert.equal(await stateOf(submission), "Succeeded");
});

test("an operation this partition never accepted is unknown", async () => {
  const submission = await pending("unknown");
  const stranger = postgresHarnessSubmission(submission.partition, "stranger");
  const outcome = await harness.inbox.cancel(cancellationOf(stranger));
  assert.equal(outcome.cancelled, "Unknown");
});

test("a settled operation cannot be settled again or re-audited, whoever asks", async () => {
  const submission = await pending("terminal");
  await harness.inbox.cancel(cancellationOf(submission));

  const rewrites = [
    "state = 'Succeeded'",
    "settled_at = now()",
    "settled_authority_kind = 'Somebody'",
    "settled_authority_subject = 'somebody-else'",
  ];
  for (const rewrite of rewrites) {
    await assert.rejects(
      () =>
        harness.query(`UPDATE operation SET ${rewrite} WHERE operation = $1`, [
          submission.operation,
        ]),
      /decided once/,
    );
  }
  assert.deepEqual(
    await harness.query(
      "SELECT state, settled_authority_subject FROM operation WHERE operation = $1",
      [submission.operation],
    ),
    [
      {
        state: "Cancelled",
        settled_authority_subject: submission.authority.subject,
      },
    ],
  );
  assert.equal(await decide(submission.partition, submission.operation), false);
});

test("a writer holding the row first decides it, and the waiting cancellation is refused", async () => {
  const submission = await pending("waiting");
  const writer = await harness.begin();
  const where = "tenant = $1 AND project = $2 AND operation = $3";
  const keys = [
    submission.partition.tenant,
    submission.partition.project,
    submission.operation,
  ];
  await writer.query(`SELECT 1 FROM operation WHERE ${where} FOR UPDATE`, keys);

  const cancelling = harness.inbox.cancel(cancellationOf(submission));
  await writer.query(
    `UPDATE operation SET state = 'Succeeded', settled_at = now(), decided_seq = 1
      WHERE ${where}`,
    keys,
  );
  await writer.commit();

  const outcome = await cancelling;
  assert.ok(outcome.cancelled === "NotPending");
  assert.equal(outcome.state, "Succeeded");
  assert.equal(await stateOf(submission), "Succeeded");
});

test("cancellation does not wait on the project row a writer may be holding", async () => {
  const submission = await pending("nolock");
  const holder = await harness.begin();
  try {
    await holder.query(
      "SELECT 1 FROM project WHERE tenant = $1 AND project = $2 FOR UPDATE",
      [submission.partition.tenant, submission.partition.project],
    );
    const outcome = await harness.inbox.cancel(cancellationOf(submission));
    assert.equal(outcome.cancelled, "Cancelled");
  } finally {
    await holder.rollback();
  }
});

test("cancellation racing the writer resolves one way and never both", async () => {
  for (const attempt of [0, 1, 2, 3]) {
    const submission = await pending(`race${String(attempt)}`);
    const [cancelled, decided] = await Promise.all([
      harness.inbox.cancel(cancellationOf(submission)),
      decide(submission.partition, submission.operation),
    ]);

    const cancellationWon = cancelled.cancelled === "Cancelled";
    assert.equal(cancellationWon, !decided);
    assert.equal(
      await stateOf(submission),
      decided ? "Succeeded" : "Cancelled",
    );
    if (!cancellationWon) {
      assert.ok(cancelled.cancelled === "NotPending");
      assert.equal(cancelled.state, "Succeeded");
    }
  }
});

test("the state column admits exactly the states this code declares", async () => {
  const submission = await pending("states");
  const columns = `
    tenant, project, operation, authority_kind, authority_subject, admission,
    key_version, key_digest, payload_digest, command, lifecycle_generation,
    state, settled_at, decided_seq, outcome_code, refused_head,
    refused_lifecycle_generation
  `;
  const rehearsal = await harness.begin();
  try {
    for (const state of allOperationStates) {
      const settled = state === "Pending" ? "NULL" : "now()";
      const decided = state === "Succeeded" ? "1" : "NULL";
      const code = state === "Refused" ? "'NotEnabled'" : "NULL";
      const refusedHead = state === "Refused" ? "0" : "NULL";
      const refusedGeneration = state === "Refused" ? "1" : "NULL";
      await rehearsal.query(
        `INSERT INTO operation (${columns})
         VALUES ($1, $2, $3, 'k', 's', 'Ordinary', 'v', $4, 'p', '{}', 1, $5,
                 ${settled}, ${decided}, ${code}, ${refusedHead},
                 ${refusedGeneration})`,
        [
          submission.partition.tenant,
          submission.partition.project,
          `${submission.operation}-${state}`,
          `digest-${state}`,
          state,
        ],
      );
    }
  } finally {
    await rehearsal.rollback();
  }

  await assert.rejects(
    () =>
      harness.query(
        "UPDATE operation SET state = 'Paused', settled_at = now() WHERE operation = $1",
        [submission.operation],
      ),
    /operation_state_is_known/,
  );
});

test("a real decision racing a cancellation resolves one way and journals only when it won", async () => {
  const partition = await postgresHarnessProject(harness.store, "realrace");
  const writer = postgresHarnessWriter(harness);
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "realrace",
    0,
  );
  const item = await postgresHarnessAccepted(
    harness.inbox,
    partition,
    "realrace",
    0,
  );

  const [cancelled, step] = await Promise.all([
    harness.inbox.cancel({
      partition,
      operation: item.operation,
      authority: postgresHarnessSubmission(partition, "realrace").authority,
    }),
    projectWriterDecide(writer, memory, item),
  ]);

  const loaded = await harness.store.load(memory.lease);
  assert.ok(loaded.parsed === "Ok");
  if (cancelled.cancelled === "Cancelled") {
    assert.ok(step.decided.decided === "AlreadyTerminal");
    assert.deepEqual(step.decided.outcome, { settled: "Cancelled" });
    assert.deepEqual(loaded.value, []);
  } else {
    assert.equal(cancelled.cancelled, "NotPending");
    assert.equal(step.decided.decided, "Committed");
    assert.equal(loaded.value.length, 1);
  }
});
