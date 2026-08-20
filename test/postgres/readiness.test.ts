/**
 * Readiness: what discovery finds, and what an idle owner is allowed to clear.
 *
 * THE CASE THAT MATTERS IS THE ONE THAT ERASES A WAKE-UP. An owner that
 * observes readiness, finishes its inbox and then clears is right only if
 * nothing arrived while it was looking away. So the cases here hand `clear`
 * the generation the owner actually observed — which is the whole reason the
 * port takes it as an argument — and an acceptance in between is the failure
 * being reproduced rather than a coincidence being tolerated.
 *
 * THE TWO HALVES ANSWER DIFFERENT CASES AND ARE ASSERTED SEPARATELY. The
 * emptiness proof refuses a clear over an inbox still holding work; where a
 * clear races a live acceptance it correctly finds nothing consumable and the
 * clear commits, and what keeps the wake-up is the blocked upsert raising
 * readiness again behind it. The generation is what refuses a clear whose
 * observation was taken before an acceptance, including the case whose inbox
 * really is empty again because everything accepted since was cancelled.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { Submission } from "../../src/interpreter/operationInbox.ts";
import type { Readiness } from "../../src/interpreter/projectDiscovery.ts";
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

/** Accepts one submission and asserts it, so a case about readiness reads as one line. */
async function accept(
  partition: Partition,
  label: string,
): Promise<Submission> {
  const submission = postgresHarnessSubmission(partition, label);
  const outcome = await harness.inbox.accept(submission);
  assert.ok(outcome.accepted === "Accepted");
  return submission;
}

/** What discovery says about one partition, or undefined when it says nothing. */
async function discovered(
  partition: Partition,
): Promise<Readiness | undefined> {
  const ready = await harness.discovery.ready(1_000);
  return ready.find((each) => each.partition.project === partition.project);
}

/** The readiness of a partition discovery must be reporting. */
async function observed(partition: Partition): Promise<Readiness> {
  const found = await discovered(partition);
  assert.ok(found !== undefined);
  return found;
}

/** Cancels a submission, which is one of the two ways an item stops being consumable. */
async function withdraw(submission: Submission): Promise<void> {
  const cancelled = await harness.inbox.cancel({
    partition: submission.partition,
    operation: submission.operation,
    authority: submission.authority,
  });
  assert.equal(cancelled.cancelled, "Cancelled");
}

/** An accepted-then-cancelled partition: ready, with nothing left for a writer to consume. */
async function emptied(label: string): Promise<Partition> {
  const partition = await postgresHarnessProject(harness.store, label);
  await withdraw(await accept(partition, label));
  return partition;
}

test("discovery finds a project with work and stops finding it once readiness is cleared", async () => {
  const partition = await emptied("discovery");
  const readiness = await observed(partition);
  assert.equal(readiness.generation, 1);

  assert.deepEqual(await harness.discovery.clearReadiness(readiness), {
    cleared: "Cleared",
  });
  assert.equal(await discovered(partition), undefined);
});

test("discovery is bounded by the page a caller asks for", async () => {
  await emptied("boundedone");
  await emptied("boundedtwo");
  assert.equal((await harness.discovery.ready(1)).length, 1);
  await assert.rejects(
    () => harness.discovery.ready(0),
    /is not a positive bound/,
  );
});

test("clearing is refused while a consumable item remains", async () => {
  const partition = await postgresHarnessProject(harness.store, "remains");
  await accept(partition, "remains");
  const readiness = await observed(partition);

  assert.deepEqual(await harness.discovery.clearReadiness(readiness), {
    cleared: "WorkRemains",
  });
  assert.deepEqual(await observed(partition), readiness);
});

test("clearing cannot erase a wake-up accepted since the owner observed it", async () => {
  const partition = await emptied("wakeup");
  const readiness = await observed(partition);
  await accept(partition, "wokeit");

  assert.deepEqual(await harness.discovery.clearReadiness(readiness), {
    cleared: "Superseded",
    generation: readiness.generation + 1,
  });
  const still = await observed(partition);
  assert.equal(still.generation, readiness.generation + 1);
  assert.equal((await harness.discovery.consumable(partition, 10)).length, 1);
});

test("a stale observation is refused even when the inbox it saw is still empty", async () => {
  const partition = await emptied("stale");
  const readiness = await observed(partition);
  await withdraw(await accept(partition, "stalelater"));

  assert.deepEqual(await harness.discovery.consumable(partition, 10), []);
  assert.deepEqual(await harness.discovery.clearReadiness(readiness), {
    cleared: "Superseded",
    generation: readiness.generation + 1,
  });
  assert.notEqual(await discovered(partition), undefined);
});

test("a clear and an acceptance racing each other leave the project ready", async () => {
  const partition = await emptied("racingclear");
  const readiness = await observed(partition);

  await Promise.all([
    accept(partition, "racingaccept"),
    harness.discovery.clearReadiness(readiness),
  ]);

  assert.notEqual(await discovered(partition), undefined);
  assert.equal((await harness.discovery.consumable(partition, 10)).length, 1);
});

test("consumable items come back in ordinal order, bounded by the page asked for", async () => {
  const partition = await postgresHarnessProject(harness.store, "page");
  const first = await accept(partition, "pageone");
  const second = await accept(partition, "pagetwo");
  await accept(partition, "pagethree");

  assert.deepEqual(await harness.discovery.consumable(partition, 2), [
    {
      partition,
      ordinal: 1,
      operation: first.operation,
      command: first.command,
    },
    {
      partition,
      ordinal: 2,
      operation: second.operation,
      command: second.command,
    },
  ]);
  await assert.rejects(
    () => harness.discovery.consumable(partition, 0),
    /is not a positive bound/,
  );
});

test("clearing readiness a project never had is a failure rather than a quiet success", async () => {
  const partition = await postgresHarnessProject(harness.store, "neverready");
  await assert.rejects(
    () => harness.discovery.clearReadiness({ partition, generation: 1 }),
    /never been made ready/,
  );
});
