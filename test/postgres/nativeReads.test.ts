import assert from "node:assert/strict";
import { test } from "node:test";

import {
  postgresNativeReads,
  publicOperation,
} from "../../src/adapters/postgres/nativeReads.ts";
import {
  postgresHarnessProject,
  postgresHarnessSubmission,
} from "./harness.ts";
import { postgresReadHarness } from "./readHarness.ts";
import { id } from "../domain/fixtures.ts";

const subject = postgresReadHarness();

async function filterProject() {
  return postgresHarnessProject(subject.harness.store, "native-filter");
}

/** One ticket of each terminal shape, and one parked with the wall it hit. */
async function seedFilterProjection(partition: {
  tenant: string;
  project: string;
}) {
  await subject.harness.query(
    "UPDATE project SET head=4 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  for (const [ticket, phase, reason] of [
    [1, "Done", "NoReason"],
    [2, "Pending", "NoReason"],
    [3, "Revoked", "NoReason"],
    [4, "Escalated", "GasExhausted"],
  ] as const) {
    await subject.harness.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq,reason)
       VALUES ($1,$2,$3,$4,$3,$5)`,
      [partition.tenant, partition.project, ticket, phase, reason],
    );
  }
}

test("public operations omit commands, authority, and storage coordination", () => {
  const resource = publicOperation({
    operation: "operation",
    accepted_at: "2026-01-01 00:00:00.123456+00",
    state: "Journaled",
    decided_seq: "7",
    outcome_code: null,
    refused_head: null,
    refused_lifecycle_generation: null,
  });
  assert.deepEqual(resource, {
    operation: "operation",
    acceptedAt: "2026-01-01T00:00:00.123456+00:00",
    state: "Succeeded",
    decidedSequence: 7,
  });
  assert.equal("command" in resource, false);
  assert.equal("authority" in resource, false);
  assert.equal("fencingEpoch" in resource, false);
});

test("public operations expose an authoring-fence refusal", () => {
  assert.deepEqual(
    publicOperation({
      operation: "release-race",
      accepted_at: "2026-01-01 00:00:00+00",
      state: "Refused",
      decided_seq: null,
      outcome_code: "AuthoringChanged",
      refused_head: "3",
      refused_lifecycle_generation: "2",
    }),
    {
      operation: "release-race",
      acceptedAt: "2026-01-01T00:00:00+00:00",
      state: "Refused",
      code: "AuthoringChanged",
      refusedHead: 3,
      refusedLifecycleGeneration: 2,
    },
  );
});

test("operation polling reads the durable public state", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-poll",
  );
  const submission = postgresHarnessSubmission(partition, "native-poll");
  await subject.harness.inbox.accept(submission);
  const resource = await postgresNativeReads(subject.pool).operation(
    partition,
    submission.operation,
  );
  assert.equal(resource?.operation, submission.operation);
  assert.equal(resource?.state, "Pending");
  assert.match(resource?.acceptedAt ?? "", /^\d{4}-\d{2}-\d{2}/);
});

test("project reads page by ticket identity and enforce a minimum sequence", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-page",
  );
  await subject.harness.query(
    "UPDATE project SET head=3 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  for (const [index, ticket] of [1, 3, 8].entries()) {
    await subject.harness.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
       VALUES ($1,$2,$3,'Pending',$4)`,
      [partition.tenant, partition.project, ticket, index + 1],
    );
  }
  const reads = postgresNativeReads(subject.pool);
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

test("project reads page newest activity with a stable identity tie-breaker", async () => {
  const partition = await postgresHarnessProject(
    subject.harness.store,
    "native-recent",
  );
  await subject.harness.query(
    "UPDATE project SET head=9 WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
  for (const [ticket, sequence] of [
    [1, 4],
    [2, 9],
    [3, 9],
    [4, 2],
  ] as const) {
    await subject.harness.query(
      `INSERT INTO ticket_projection (tenant,project,ticket,phase,seq)
       VALUES ($1,$2,$3,'Pending',$4)`,
      [partition.tenant, partition.project, ticket, sequence],
    );
  }
  const reads = postgresNativeReads(subject.pool);
  const first = await reads.project(partition, {
    limit: 2,
    order: "RecentActivity",
  });
  assert.equal(first.result, "Found");
  if (first.result !== "Found") return;
  assert.deepEqual(
    first.project.tickets.map(({ ticket }) => ticket),
    [3, 2],
  );
  assert.deepEqual(first.project.nextRecentActivityAfter, {
    sequence: 9,
    ticket: 2,
  });
  const second = await reads.project(partition, {
    limit: 2,
    order: "RecentActivity",
    recentActivityAfter: first.project.nextRecentActivityAfter,
  });
  assert.equal(second.result, "Found");
  if (second.result !== "Found") return;
  assert.deepEqual(
    second.project.tickets.map(({ ticket }) => ticket),
    [1, 4],
  );
});

test("project reads filter before paging and expose one ticket detail", async () => {
  const partition = await filterProject();
  await seedFilterProjection(partition);
  const reads = postgresNativeReads(subject.pool);
  const nonTerminal = await reads.project(partition, {
    limit: 1,
    phaseFilter: { selection: "NonTerminal" },
  });
  assert.equal(nonTerminal.result, "Found");
  if (nonTerminal.result !== "Found") return;
  assert.deepEqual(nonTerminal.project.tickets, [
    { ticket: 2, phase: "Pending", sequence: 2 },
  ]);
  assert.equal(nonTerminal.project.nextAfter, 2);
  assert.deepEqual(
    await reads.project(partition, {
      after: nonTerminal.project.nextAfter,
      limit: 2,
      phaseFilter: { selection: "NonTerminal" },
    }),
    {
      result: "Found",
      project: {
        partition,
        sequence: 4,
        tickets: [
          {
            ticket: 4,
            phase: "Escalated",
            sequence: 4,
            reason: "GasExhausted",
          },
        ],
      },
    },
  );
  assert.deepEqual(
    await reads.project(partition, {
      limit: 10,
      phaseFilter: { selection: "Selected", phases: ["Done", "Revoked"] },
    }),
    {
      result: "Found",
      project: {
        partition,
        sequence: 4,
        tickets: [
          { ticket: 1, phase: "Done", sequence: 1 },
          { ticket: 3, phase: "Revoked", sequence: 3 },
        ],
      },
    },
  );
  assert.deepEqual(await reads.ticket(partition, id(4)), {
    ticket: 4,
    phase: "Escalated",
    sequence: 4,
    reason: "GasExhausted",
  });
  assert.equal(await reads.ticket(partition, id(9)), undefined);
});
