/**
 * Process death at the durable seam: what an acknowledged decision survives,
 * and what an unacknowledged one leaves behind.
 *
 * THE KILL IS `SIGKILL` AND THE CHILD NEVER EXITS ON ITS OWN. A process given
 * the chance to shut down cleanly proves that a clean shutdown is durable,
 * which nothing here doubts. The claim under test is that the store owes
 * nothing to the process that wrote it, so the process is removed without
 * being asked.
 *
 * THE PARENT RECONNECTS THROUGH A FRESH POOL. Reading back through the
 * connection the child never had is what makes this a statement about
 * PostgreSQL rather than about anything the adapter kept in memory.
 *
 * THE SUBMISSION SIDE IS THE SAME RIG WITH NO LEASE IN IT. 006 asks that a
 * crash after acceptance leave the work discoverable without an active owner,
 * and the only way to mean that is a process that took no ownership, accepted,
 * and then stopped existing.
 *
 * THE COMMITTED SEAM IS AN AMBIGUOUS COMMIT WITH NOBODY LEFT TO ASK. The child
 * commits and is removed before it can tell anyone, so the parent is in
 * exactly the position 006 has a dispatcher reconnect and read the operation
 * from — and the recorded outcome is what proves the commit rather than the
 * memory of a process that no longer exists.
 *
 * WHAT THE UNRESOLVED SEAMS ASSERT IS WEAKER THAN THEIR NAMES. `undecided` and
 * `unaccepted` start a write they mean to be killed mid-flight, and the parent
 * kills on a line the child prints before the server has necessarily begun
 * waiting on the lock. Killed early, the case passes because nothing was
 * written; killed late, it passes because the write rolled back. Both are the
 * claim, so neither can fail falsely — but only the late kill exercises the
 * rollback, and the case cannot say which one it took.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { journalLegalOn } from "../../src/actor/journal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessCrashSubmission,
  postgresHarnessOpen,
  postgresHarnessOwner,
  postgresHarnessJournal,
  postgresHarnessProject,
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

/** One child, run to the line it announces its seam with, then killed where it stands. */
async function crashAt(partition: Partition, seam: string): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("crashChild.ts", import.meta.url)),
      postgresHarnessUrl(),
      partition.tenant,
      partition.project,
      postgresHarnessOwner(seam),
      seam,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  await crashWaitFor(child, "waiting");
  child.kill("SIGKILL");
  await new Promise((done) => child.once("exit", done));
}

/** Resolves once the child has said `line`, or fails saying what it said instead. */
function crashWaitFor(child: ChildProcess, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let said = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      said += chunk.toString();
      if (said.includes(line)) resolve();
    });
    child.once("exit", (code) => {
      reject(
        new Error(
          `crash child exited with ${String(code)} before saying ${line}; it said: ${said}`,
        ),
      );
    });
  });
}

test("a commit nobody heard about is proved whole by the durable record alone", async () => {
  const partition = await postgresHarnessProject(harness.store, "crashcommit");
  const journal = postgresHarnessJournal().slice(0, 1);
  await crashAt(partition, "decided");

  const loaded = await harness.store.load(partition);
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(loaded.value, journal);
  assert.ok(journalLegalOn(refinementInstance, loaded.value));

  const standing = await harness.store.standing(partition);
  assert.ok(standing !== undefined);
  assert.equal(standing.head, 1);

  const submission = postgresHarnessCrashSubmission(partition);
  assert.deepEqual(
    await harness.query(
      `SELECT o.state, o.decided_seq, i.consumable, p.phase, p.seq
         FROM operation o
         JOIN inbox_item i USING (tenant, project, operation)
         JOIN ticket_projection p ON p.tenant = o.tenant AND p.project = o.project
        WHERE o.operation = $1`,
      [submission.operation],
    ),
    [
      {
        state: "Succeeded",
        decided_seq: "1",
        consumable: false,
        phase: "Pending",
        seq: "1",
      },
    ],
  );
});

test("a decision that never resolved leaves a legal prefix and no half-written decision", async () => {
  const partition = await postgresHarnessProject(harness.store, "crashblocked");
  await crashAt(partition, "undecided");

  const loaded = await harness.store.load(partition);
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(loaded.value, []);
  assert.ok(journalLegalOn(refinementInstance, loaded.value));

  const standing = await harness.store.standing(partition);
  assert.ok(standing !== undefined);
  assert.equal(standing.head, 0);

  const submission = postgresHarnessCrashSubmission(partition);
  const operation = await harness.inbox.operation(
    partition,
    submission.operation,
  );
  assert.equal(operation?.state, "Pending");
  assert.deepEqual(
    (await harness.discovery.consumable(partition, 10)).map(
      (item) => item.operation,
    ),
    [submission.operation],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT ticket FROM ticket_projection WHERE tenant = $1 AND project = $2",
      [partition.tenant, partition.project],
    ),
    [],
  );
});

test("a fresh process takes over a dead owner's project and resumes at its head", async () => {
  const partition = await postgresHarnessProject(harness.store, "crashresume");
  await crashAt(partition, "decided");

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
  assert.equal(successor.lease.head, 1);
});

test("a crash after acceptance leaves the work discoverable with no active owner", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "crashaccepted",
  );
  await crashAt(partition, "accepted");

  assert.deepEqual(
    await harness.query(
      "SELECT owner, head, ingress_next FROM project WHERE tenant = $1 AND project = $2",
      [partition.tenant, partition.project],
    ),
    [{ owner: null, head: "0", ingress_next: "2" }],
  );

  const submission = postgresHarnessCrashSubmission(partition);
  const operation = await harness.inbox.operation(
    partition,
    submission.operation,
  );
  assert.ok(operation !== undefined);
  assert.equal(operation.state, "Pending");
  assert.equal(operation.ordinal, 1);

  const ready = await harness.discovery.ready(1_000);
  assert.ok(ready.some((each) => each.partition.project === partition.project));
  assert.deepEqual(
    (await harness.discovery.consumable(partition, 10)).map(
      (item) => item.operation,
    ),
    [submission.operation],
  );
});

test("an acceptance that never resolved leaves no operation and no ordinal spent", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "crashunaccepted",
  );
  await crashAt(partition, "unaccepted");

  const submission = postgresHarnessCrashSubmission(partition);
  assert.equal(
    await harness.inbox.operation(partition, submission.operation),
    undefined,
  );
  assert.deepEqual(await harness.discovery.consumable(partition, 10), []);
  assert.deepEqual(
    await harness.query(
      "SELECT ingress_next FROM project WHERE tenant = $1 AND project = $2",
      [partition.tenant, partition.project],
    ),
    [{ ingress_next: "1" }],
  );
  assert.deepEqual(
    await harness.query(
      "SELECT 1 FROM project_readiness WHERE tenant = $1 AND project = $2",
      [partition.tenant, partition.project],
    ),
    [],
  );
});
