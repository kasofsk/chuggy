import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  postgresNativeReads,
  publicOperation,
} from "../../src/adapters/postgres/nativeReads.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import type pg from "pg";
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

test("public operations omit commands, authority, and storage coordination", () => {
  const resource = publicOperation({
    operation: "operation",
    accepted_at: "2026-01-01T00:00:00Z",
    state: "Journaled",
    decided_seq: "7",
    outcome_code: null,
    refused_head: null,
    refused_lifecycle_generation: null,
  });
  assert.deepEqual(resource, {
    operation: "operation",
    acceptedAt: "2026-01-01T00:00:00Z",
    state: "Succeeded",
    decidedSequence: 7,
  });
  assert.equal("command" in resource, false);
  assert.equal("authority" in resource, false);
  assert.equal("fencingEpoch" in resource, false);
});

test("operation polling reads the durable public state", async () => {
  const partition = await postgresHarnessProject(harness.store, "native-poll");
  const submission = postgresHarnessSubmission(partition, "native-poll");
  await harness.inbox.accept(submission);
  const resource = await postgresNativeReads(pool).operation(
    partition,
    submission.operation,
  );
  assert.equal(resource?.operation, submission.operation);
  assert.equal(resource?.state, "Pending");
  assert.match(resource?.acceptedAt ?? "", /^\d{4}-\d{2}-\d{2}/);
});

test("project reads page by ticket identity and enforce a minimum sequence", async () => {
  const partition = await postgresHarnessProject(harness.store, "native-page");
  await harness.query(
    "UPDATE project SET head=3 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  for (const [index, ticket] of [1, 3, 8].entries()) {
    await harness.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
       VALUES ($1,$2,$3,'Pending',$4)`,
      [partition.tenant, partition.project, ticket, index + 1],
    );
  }
  const reads = postgresNativeReads(pool);
  assert.deepEqual(
    await reads.project(partition, { limit: 2, minimumSequence: 4 }),
    {
      result: "Behind",
      observedSequence: 3,
    },
  );
  const first = await reads.project(partition, { limit: 2 });
  assert.equal(first.result, "Found");
  if (first.result !== "Found") return;
  assert.deepEqual(
    first.project.tickets.map(({ ticket }) => ticket),
    [1, 3],
  );
  const cursor = first.project.nextAfter;
  assert.equal(cursor, 3);
  assert.ok(cursor !== undefined);
  assert.deepEqual(
    await reads.project(partition, { after: cursor, limit: 2 }),
    {
      result: "Found",
      project: {
        partition,
        sequence: 3,
        tickets: [{ ticket: 8, phase: "Pending", sequence: 3 }],
      },
    },
  );
});
