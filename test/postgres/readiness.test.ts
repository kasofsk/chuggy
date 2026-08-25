import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { taskDoneEvent } from "../../src/actor/decisionEvent.ts";
import { asCompletionDecisionEvent } from "../../src/interpreter/ticketCommand.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import { id } from "../domain/fixtures.ts";
import { plainResult } from "../actor/harness.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessCompletion,
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

/** One settled task, written the way its boundary writes it rather than offered. */
async function completion(
  partition: Parameters<typeof postgresHarnessSubmission>[0],
  label: string,
): Promise<string> {
  const operation = `operation-${label}`;
  await postgresHarnessCompletion(
    harness,
    partition,
    operation,
    asCompletionDecisionEvent(
      taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
    ),
  );
  return operation;
}

test("the bounded class-head query chooses completion before ordinary", async () => {
  const partition = await postgresHarnessProject(harness.store, "priority");
  const ordinary = postgresHarnessSubmission(partition, "priority-ordinary");
  await harness.inbox.accept(ordinary);
  const done = await completion(partition, "priority-completion");
  const next = await harness.discovery.next(partition, 300);
  assert.equal(next?.source.kind, "Operation");
  assert.equal(
    next?.source.kind === "Operation" ? next.source.operation : undefined,
    done,
  );
});

test("database-time aging eventually puts old ordinary work ahead", async () => {
  const partition = await postgresHarnessProject(harness.store, "aging");
  const ordinary = postgresHarnessSubmission(partition, "aging-ordinary");
  await harness.inbox.accept(ordinary);
  await completion(partition, "aging-completion");
  await harness.query(
    `UPDATE decision_input SET created_at=created_at-interval '20 minutes'
      WHERE tenant=$1 AND project=$2 AND input_id=$3`,
    [partition.tenant, partition.project, ordinary.operation],
  );
  const next = await harness.discovery.next(partition, 300);
  assert.equal(
    next?.source.kind === "Operation" ? next.source.operation : undefined,
    ordinary.operation,
  );
});

test("readiness clears only when no pending input remains", async () => {
  const partition = await postgresHarnessProject(harness.store, "ready-clear");
  const submission = postgresHarnessSubmission(partition, "ready-clear");
  await harness.inbox.accept(submission);
  const readiness = (await harness.discovery.ready(100)).find(
    (item) => item.partition.project === partition.project,
  );
  assert.ok(readiness !== undefined);
  assert.deepEqual(await harness.discovery.clearReadiness(readiness), {
    cleared: "WorkRemains",
  });
});
