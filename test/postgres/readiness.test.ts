import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { taskDoneEvent } from "../../src/actor/decisionEvent.ts";
import { asOperationDecisionEvent } from "../../src/interpreter/operationInbox.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import { id } from "../domain/fixtures.ts";
import { plainResult } from "../actor/harness.ts";
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

function completion(
  partition: Parameters<typeof postgresHarnessSubmission>[0],
  label: string,
) {
  return {
    ...postgresHarnessSubmission(partition, label),
    command: {
      version: 1 as const,
      command: "Decide" as const,
      event: asOperationDecisionEvent(
        taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
      ),
    },
  };
}

test("the bounded class-head query chooses completion before ordinary", async () => {
  const partition = await postgresHarnessProject(harness, "priority");
  const ordinary = postgresHarnessSubmission(partition, "priority-ordinary");
  const done = completion(partition, "priority-completion");
  await harness.inbox.accept(ordinary);
  await harness.inbox.accept(done);
  const next = await harness.discovery.next(partition, 300);
  assert.equal(next?.source.kind, "Operation");
  assert.equal(
    next?.source.kind === "Operation" ? next.source.operation : undefined,
    done.operation,
  );
});

test("database-time aging eventually puts old ordinary work ahead", async () => {
  const partition = await postgresHarnessProject(harness, "aging");
  const ordinary = postgresHarnessSubmission(partition, "aging-ordinary");
  const done = completion(partition, "aging-completion");
  await harness.inbox.accept(ordinary);
  await harness.inbox.accept(done);
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
  const partition = await postgresHarnessProject(harness, "ready-clear");
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
