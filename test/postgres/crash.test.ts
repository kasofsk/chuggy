/**
 * Process death at the durable seam: what an acknowledged append survives, and
 * what an unacknowledged one leaves behind.
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

test("every acknowledged append survives the process that made it", async () => {
  const partition = await postgresHarnessProject(harness.store, "crashcommit");
  const journal = postgresHarnessJournal();
  await crashAt(partition, "commit");

  const loaded = await harness.store.load(partition);
  assert.ok(loaded.parsed === "Ok");
  assert.deepEqual(loaded.value, journal);
  assert.ok(journalLegalOn(refinementInstance, loaded.value));

  const standing = await harness.store.standing(partition);
  assert.ok(standing !== undefined);
  assert.equal(standing.head, journal.length);
});

test("an append that never resolved leaves the head exactly where it was", async () => {
  const partition = await postgresHarnessProject(harness.store, "crashblocked");
  const journal = postgresHarnessJournal();
  await crashAt(partition, "blocked");

  const loaded = await harness.store.load(partition);
  assert.ok(loaded.parsed === "Ok");
  assert.equal(loaded.value.length, 1);
  assert.deepEqual(loaded.value, journal.slice(0, 1));
  assert.ok(journalLegalOn(refinementInstance, loaded.value));

  const standing = await harness.store.standing(partition);
  assert.ok(standing !== undefined);
  assert.equal(standing.head, 1);
});

test("a fresh process takes over a dead owner's project and resumes at its head", async () => {
  const partition = await postgresHarnessProject(harness.store, "crashresume");
  const journal = postgresHarnessJournal();
  await crashAt(partition, "commit");

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
  assert.equal(successor.lease.head, journal.length);
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
