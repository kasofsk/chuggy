/**
 * Acceptance: what one transaction writes, what a repeat of a key answers
 * with, and what a lifecycle refuses.
 *
 * THE ORDINALS ARE ASSERTED AS A SET AND NOT AS A COUNT. A concurrent
 * acceptance that lost an ordinal and one that issued the same ordinal twice
 * both leave the right number of rows behind, so the cases here compare the
 * allocated ordinals against the exact run they should be — the only
 * assertion that separates a gap from a duplicate.
 *
 * A CASE THAT NEEDS AN INTERLEAVING TAKES A LOCK RATHER THAN A TIMER. Holding
 * one partition's row in an open transaction is what makes "this project does
 * not wait on that one" a fact the server decides, and a sleep would be
 * asserting the machine's load instead.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresOperationInbox } from "../../src/adapters/postgres/operationInbox.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  asAuthorityKind,
  asOperationCommand,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessKeyVersionLater,
  postgresHarnessKeying,
  postgresHarnessOpen,
  postgresHarnessPartition,
  postgresHarnessProject,
  postgresHarnessSubmission,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

/** Accepts and asserts the acceptance, so a case about something else reads as one line. */
async function accepted(submission: Submission): Promise<number> {
  const outcome = await harness.inbox.accept(submission);
  assert.equal(outcome.accepted, "Accepted");
  assert.ok(outcome.accepted === "Accepted");
  return outcome.operation.ordinal;
}

/** The ordinals a partition's consumable items carry, in the order the inbox returns them. */
async function ordinalsOf(partition: Partition): Promise<readonly number[]> {
  const items = await harness.inbox.consumable(partition, 100);
  return items.map((item) => item.ordinal);
}

test("acceptance writes the operation, its inbox item and a readiness generation together", async () => {
  const partition = await postgresHarnessProject(harness.store, "accept");
  const submission = postgresHarnessSubmission(partition, "accept");
  const outcome = await harness.inbox.accept(submission);

  assert.ok(outcome.accepted === "Accepted");
  assert.equal(outcome.operation.ordinal, 1);
  assert.equal(outcome.operation.state, "Pending");
  assert.equal(outcome.operation.lifecycleGeneration, 1);

  assert.deepEqual(await ordinalsOf(partition), [1]);
  const ready = await harness.inbox.ready(100);
  const found = ready.find(
    (each) => each.partition.project === partition.project,
  );
  assert.ok(found !== undefined);
  assert.equal(found.generation, 1);

  const standing = await harness.inbox.operation(
    partition,
    submission.operation,
  );
  assert.deepEqual(standing, outcome.operation);
});

test("ordinals rise by one within a project and every acceptance advances readiness", async () => {
  const partition = await postgresHarnessProject(harness.store, "ordinals");
  assert.equal(await accepted(postgresHarnessSubmission(partition, "one")), 1);
  assert.equal(await accepted(postgresHarnessSubmission(partition, "two")), 2);
  assert.equal(
    await accepted(postgresHarnessSubmission(partition, "three")),
    3,
  );

  const ready = await harness.inbox.ready(100);
  const found = ready.find(
    (each) => each.partition.project === partition.project,
  );
  assert.ok(found !== undefined);
  assert.equal(found.generation, 3);
});

test("concurrent acceptance on one project allocates every ordinal exactly once", async () => {
  const partition = await postgresHarnessProject(harness.store, "concurrent");
  const submissions = Array.from({ length: 8 }, (_, each) =>
    postgresHarnessSubmission(partition, `racer${String(each)}`),
  );
  const outcomes = await Promise.all(
    submissions.map((submission) => harness.inbox.accept(submission)),
  );

  const ordinals = outcomes.map((outcome) => {
    assert.ok(outcome.accepted === "Accepted");
    return outcome.operation.ordinal;
  });
  const expected = submissions.map((_, each) => each + 1);
  assert.deepEqual(
    [...ordinals].sort((a, b) => a - b),
    expected,
  );
  assert.deepEqual(await ordinalsOf(partition), expected);
});

test("an idempotent retry returns the original operation and allocates no second ordinal", async () => {
  const partition = await postgresHarnessProject(harness.store, "retry");
  const submission = postgresHarnessSubmission(partition, "retry");
  const first = await harness.inbox.accept(submission);
  assert.ok(first.accepted === "Accepted");

  const again = await harness.inbox.accept(submission);
  assert.ok(again.accepted === "Original");
  assert.deepEqual(again.operation, first.operation);
  assert.deepEqual(await ordinalsOf(partition), [1]);

  const ready = await harness.inbox.ready(100);
  const found = ready.find(
    (each) => each.partition.project === partition.project,
  );
  assert.ok(found !== undefined);
  assert.equal(found.generation, 1);
});

test("the same key offered with a different command is a conflict and writes nothing", async () => {
  const partition = await postgresHarnessProject(harness.store, "conflict");
  const submission = postgresHarnessSubmission(partition, "conflict");
  await accepted(submission);

  const conflicting: Submission = {
    ...submission,
    command: asOperationCommand('{"label":"something else"}'),
  };
  const outcome = await harness.inbox.accept(conflicting);
  assert.equal(outcome.accepted, "IdempotencyConflict");
  assert.deepEqual(await ordinalsOf(partition), [1]);
});

test("idempotency is scoped by authority kind, so the same key under another kind is new work", async () => {
  const partition = await postgresHarnessProject(harness.store, "scope");
  const submission = postgresHarnessSubmission(partition, "scope");
  await accepted(submission);

  const elsewhere: Submission = {
    ...submission,
    operation: postgresHarnessSubmission(partition, "scopeother").operation,
    authority: { ...submission.authority, kind: asAuthorityKind("Scheduler") },
    admission: "CorrectnessReducing",
  };
  assert.equal(await accepted(elsewhere), 2);
});

test("a key accepted before a rotation is still found under the version that follows it", async () => {
  const partition = await postgresHarnessProject(harness.store, "rotation");
  const submission = postgresHarnessSubmission(partition, "rotation");
  const first = await harness.inbox.accept(submission);
  assert.ok(first.accepted === "Accepted");

  const later = postgresPool(postgresHarnessUrl());
  const fresh = postgresHarnessSubmission(partition, "rotationfresh");
  try {
    const rotated = postgresOperationInbox(
      later,
      postgresHarnessKeying(postgresHarnessKeyVersionLater),
    );
    const again = await rotated.accept(submission);
    assert.ok(again.accepted === "Original");
    assert.deepEqual(again.operation, first.operation);
    assert.equal((await rotated.accept(fresh)).accepted, "Accepted");
  } finally {
    await later.end();
  }

  const written = await harness.query(
    "SELECT key_version FROM operation WHERE operation = $1",
    [fresh.operation],
  );
  assert.deepEqual(written, [{ key_version: postgresHarnessKeyVersionLater }]);
});

test("ordinary work is refused by a suspended project, and nothing is allocated for it", async () => {
  const partition = await postgresHarnessProject(harness.store, "suspended");
  await harness.store.fence(partition, "Suspended");
  const submission = postgresHarnessSubmission(partition, "suspended");

  const outcome = await harness.inbox.accept(submission);
  assert.ok(outcome.accepted === "NotAdmitted");
  assert.equal(outcome.lifecycle, "Suspended");
  assert.deepEqual(
    await harness.query("SELECT 1 FROM operation WHERE operation = $1", [
      submission.operation,
    ]),
    [],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT ingress_next FROM project WHERE tenant = $1 AND project = $2",
      [partition.tenant, partition.project],
    ),
    [{ ingress_next: "1" }],
  );
});

test("a correctness-reducing class still enters a suspended project, and none enters retention", async () => {
  const partition = await postgresHarnessProject(harness.store, "reducing");
  await harness.store.fence(partition, "Suspended");
  const reducing: Submission = {
    ...postgresHarnessSubmission(partition, "reducing"),
    admission: "CorrectnessReducing",
  };
  const outcome = await harness.inbox.accept(reducing);
  assert.ok(outcome.accepted === "Accepted");
  assert.equal(outcome.operation.lifecycleGeneration, 2);

  await harness.store.fence(partition, "Retention");
  for (const admission of ["Ordinary", "CorrectnessReducing"] as const) {
    const late: Submission = {
      ...postgresHarnessSubmission(partition, `retention${admission}`),
      admission,
    };
    const refused = await harness.inbox.accept(late);
    assert.ok(refused.accepted === "NotAdmitted");
    assert.equal(refused.lifecycle, "Retention");
  }
});

test("one project's held lifecycle row does not delay another project's acceptance", async () => {
  const blocked = await postgresHarnessProject(harness.store, "blockedproject");
  const free = await postgresHarnessProject(harness.store, "freeproject");
  const holder = await harness.begin();
  await holder.query(
    "SELECT 1 FROM project WHERE tenant = $1 AND project = $2 FOR UPDATE",
    [blocked.tenant, blocked.project],
  );

  let settled = false;
  const waiting = harness.inbox
    .accept(postgresHarnessSubmission(blocked, "waiting"))
    .then((outcome) => {
      settled = true;
      return outcome;
    });
  assert.equal(await accepted(postgresHarnessSubmission(free, "unblocked")), 1);
  assert.equal(settled, false);

  await holder.rollback();
  assert.equal((await waiting).accepted, "Accepted");
});

test("an operation identity is never reused, not even by another project", async () => {
  const first = await postgresHarnessProject(harness.store, "identityone");
  const second = await postgresHarnessProject(harness.store, "identitytwo");
  const submission = postgresHarnessSubmission(first, "identity");
  await accepted(submission);

  const elsewhere: Submission = {
    ...postgresHarnessSubmission(second, "identityreuse"),
    operation: submission.operation,
  };
  await assert.rejects(
    () => harness.inbox.accept(elsewhere),
    /operation_identity_is_never_reused/,
  );
});

test("a submission for a project nothing provisioned is refused rather than accepted", async () => {
  const absent = postgresHarnessPartition("unprovisioned");
  await assert.rejects(
    () => harness.inbox.accept(postgresHarnessSubmission(absent, "absent")),
    /never provisioned/,
  );
});
