/**
 * Cancellation: what it settles, what it refuses, and what happens when it
 * arrives at the same moment as the decision it is trying to overtake.
 *
 * THE WRITER'S HALF IS DRIVEN AS SQL BECAUSE THERE IS NO WRITER YET. The
 * decision transaction is slice I2, and the claim under test here belongs to
 * this slice: whichever transaction takes the operation's row lock first
 * decides it, and the server refuses the second. So a case opens its own
 * transaction, takes that lock and terminalizes exactly as a writer will —
 * without a state predicate of its own, so the only thing standing between the
 * two outcomes is the trigger this slice installed.
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
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessSubmission,
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
      `UPDATE operation SET state = 'Succeeded', settled_at = now() WHERE ${where}`,
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
    `UPDATE operation SET state = 'Succeeded', settled_at = now() WHERE ${where}`,
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
    state, settled_at
  `;
  const rehearsal = await harness.begin();
  try {
    for (const state of allOperationStates) {
      const settled = state === "Pending" ? "NULL" : "now()";
      await rehearsal.query(
        `INSERT INTO operation (${columns})
         VALUES ($1, $2, $3, 'k', 's', 'Ordinary', 'v', $4, 'p', '{}', 1, $5, ${settled})`,
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
