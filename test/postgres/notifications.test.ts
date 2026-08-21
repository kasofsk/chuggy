import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresNotifications } from "../../src/adapters/postgres/notifications.ts";
import { notificationPublishFunction } from "../../src/adapters/postgres/schema.ts";
import {
  postgresHarnessProject,
  postgresHarnessSubmission,
} from "./harness.ts";
import { postgresReadHarness } from "./readHarness.ts";

const subject = postgresReadHarness();

test("cancellation publishes only an operation identity", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "notify-cancel",
  );
  const submission = postgresHarnessSubmission(partition, "notify-cancel");
  await subject.harness.inbox.accept(submission);
  await subject.harness.inbox.cancel({
    partition,
    operation: submission.operation,
    authority: submission.authority,
  });
  assert.deepEqual(
    await postgresNotifications(subject.pool).read(partition, {
      after: 0,
      limit: 10,
    }),
    {
      result: "Events",
      cursor: 1,
      events: [
        { ordinal: 1, kind: "Operation", resource: submission.operation },
      ],
    },
  );
});

test("an expired cursor resets instead of pretending the stream is complete", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "notify-gap",
  );
  await subject.harness.query(
    `SELECT ${notificationPublishFunction}($1,$2,'Draft',g::text,NULL,g)
       FROM generate_series(1,1002) AS generated(g)`,
    [partition.tenant, partition.project],
  );
  assert.deepEqual(
    await postgresNotifications(subject.pool).read(partition, {
      after: 0,
      limit: 10,
    }),
    { result: "Reset", cursor: 1002 },
  );
  assert.deepEqual(
    await subject.harness.query(
      `SELECT min(ordinal)::text AS earliest,count(*)::text AS count
         FROM project_notification WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ earliest: "3", count: "1000" }],
  );
});

test("a cursor beyond the project log resets to its latest event", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "notify-future",
  );
  await subject.harness.query(
    `SELECT ${notificationPublishFunction}($1,$2,'Draft','1',NULL,1)`,
    [partition.tenant, partition.project],
  );
  assert.deepEqual(
    await postgresNotifications(subject.pool).read(partition, {
      after: 500,
      limit: 10,
    }),
    { result: "Reset", cursor: 1 },
  );
});
