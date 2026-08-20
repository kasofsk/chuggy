import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresNotifications } from "../../src/adapters/postgres/notifications.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { notificationPublishFunction } from "../../src/adapters/postgres/schema.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessSubmission,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let pool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  pool = postgresPool(postgresHarnessUrl());
});
after(async () => {
  await pool.end();
  await harness.close();
});

test("cancellation publishes only an operation identity", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "notify-cancel",
  );
  const submission = postgresHarnessSubmission(partition, "notify-cancel");
  await harness.inbox.accept(submission);
  await harness.inbox.cancel({
    partition,
    operation: submission.operation,
    authority: submission.authority,
  });
  assert.deepEqual(
    await postgresNotifications(pool).read(partition, { after: 0, limit: 10 }),
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
  const partition = await postgresHarnessProject(harness.store, "notify-gap");
  await harness.query(
    `SELECT ${notificationPublishFunction}($1,$2,'Draft',g::text,NULL,g)
       FROM generate_series(1,1002) AS generated(g)`,
    [partition.tenant, partition.project],
  );
  assert.deepEqual(
    await postgresNotifications(pool).read(partition, { after: 0, limit: 10 }),
    { result: "Reset", cursor: 1002 },
  );
  assert.deepEqual(
    await harness.query(
      `SELECT min(ordinal)::text AS earliest,count(*)::text AS count
         FROM project_notification WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ earliest: "3", count: "1000" }],
  );
});
