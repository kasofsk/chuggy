import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { postgresOperationInbox } from "../../src/adapters/postgres/operationInbox.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { idempotencyPayloadDigest } from "../../src/adapters/postgres/keying.ts";
import {
  asOperationCommand,
  asOperationDecisionEvent,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";
import { encodeDecisionEventText } from "../../src/interpreter/wire.ts";
import { dispatchEvent } from "../../src/actor/decisionEvent.ts";
import { id } from "../domain/fixtures.ts";
import {
  postgresHarnessKeying,
  postgresHarnessEntry,
  postgresHarnessOpen,
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

test("acceptance publishes one typed input and an idempotent retry returns it", async () => {
  const partition = await postgresHarnessProject(harness, "accept-idempotent");
  const submission = postgresHarnessSubmission(partition, "accept-idempotent");
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  assert.equal((await harness.inbox.accept(submission)).accepted, "Original");
  assert.deepEqual(
    await harness.query(
      `SELECT ordinal, input_kind, base_priority, state FROM decision_input
      WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [
      {
        ordinal: "1",
        input_kind: "Operation",
        base_priority: "Ordinary",
        state: "Pending",
      },
    ],
  );
});

test("one key with a different typed command conflicts without allocating", async () => {
  const partition = await postgresHarnessProject(harness, "accept-conflict");
  const submission = postgresHarnessSubmission(partition, "accept-conflict");
  await harness.inbox.accept(submission);
  const conflict = await harness.inbox.accept({
    ...submission,
    command: {
      version: 1,
      command: "Decide",
      event: { type: "Revoke", value: 1 },
    },
  });
  assert.equal(conflict.accepted, "IdempotencyConflict");
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::text AS count FROM decision_input WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ count: "1" }],
  );
});

test("a canonical retry recognizes the payload digest stored by I2", async () => {
  const partition = await postgresHarnessProject(
    harness,
    "accept-legacy-payload",
  );
  const submission = postgresHarnessSubmission(
    partition,
    "accept-legacy-payload",
  );
  await harness.inbox.accept(submission);
  assert.equal(submission.command.command, "Decide");
  const keying = postgresHarnessKeying();
  const legacyDigest = idempotencyPayloadDigest(
    keying,
    keying.current,
    { partition, authorityKind: submission.authority.kind },
    asOperationCommand(encodeDecisionEventText(submission.command.event)),
  );
  await harness.query(
    `UPDATE operation SET payload_digest=$4
     WHERE tenant=$1 AND project=$2 AND operation=$3`,
    [partition.tenant, partition.project, submission.operation, legacyDigest],
  );
  assert.equal((await harness.inbox.accept(submission)).accepted, "Original");
});

test("ordinary work receives pre-acceptance backpressure at the soft bound", async () => {
  const partition = await postgresHarnessProject(harness, "accept-pressure");
  const pool = postgresPool(postgresHarnessUrl());
  const inbox = postgresOperationInbox(pool, postgresHarnessKeying(), {
    agingIntervalSeconds: 300,
    ordinarySoftLimit: 1,
    mailboxHardLimit: 2,
    writerDecisionQuantum: 32,
    writerTimeQuantumMilliseconds: 250,
    backpressureRetryAfterSeconds: 2,
  });
  try {
    await inbox.accept(postgresHarnessSubmission(partition, "pressure-one"));
    const second = postgresHarnessSubmission(partition, "pressure-two");
    assert.deepEqual(await inbox.accept(second), {
      accepted: "Backpressure",
      retryAfterSeconds: 2,
    });
    assert.equal(await inbox.operation(partition, second.operation), undefined);
  } finally {
    await pool.end();
  }
});

test("concurrent acceptance gives every operation one distinct ordinal", async () => {
  const partition = await postgresHarnessProject(harness, "accept-concurrent");
  const submissions = Array.from({ length: 8 }, (_, index) =>
    postgresHarnessSubmission(partition, `concurrent-${String(index)}`),
  );
  const outcomes = await Promise.all(
    submissions.map(async (submission) => harness.inbox.accept(submission)),
  );
  const ordinals = outcomes.map((outcome) => {
    assert.equal(outcome.accepted, "Accepted");
    return outcome.accepted === "Accepted" ? outcome.operation.ordinal : 0;
  });
  assert.deepEqual(
    [...ordinals].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
});

test("operation identity remains globally unique", async () => {
  const first = await postgresHarnessProject(harness, "accept-global-one");
  const second = await postgresHarnessProject(harness, "accept-global-two");
  const submission = postgresHarnessSubmission(first, "accept-global");
  await harness.inbox.accept(submission);
  await assert.rejects(
    () =>
      harness.inbox.accept({
        ...postgresHarnessSubmission(second, "accept-global-other"),
        operation: asOperationId(submission.operation),
      }),
    /operation_identity_is_never_reused/,
  );
});

test("native-action resolution is accepted only against its open versioned request", async () => {
  const partition = await postgresHarnessProject(
    harness,
    "accept-native-fence",
  );
  const submission = postgresHarnessSubmission(partition, "native-fence");
  const fenced = {
    ...submission,
    command: {
      version: 1 as const,
      command: "ResolveNativeAction" as const,
      action: "absent-action",
      authorizingSeq: 1,
      resolution: "Resume" as const,
    },
  };
  assert.deepEqual(await harness.inbox.accept(fenced), {
    accepted: "InvalidCommand",
  });
  assert.equal(
    await harness.inbox.operation(partition, fenced.operation),
    undefined,
  );
});

test("a decision carrying a dispatch event is refused and allocates nothing", async () => {
  const partition = await postgresHarnessProject(
    harness,
    "accept-dispatch-decision",
  );
  const submission = postgresHarnessSubmission(partition, "dispatch-decision");
  const dispatchDecision = {
    ...submission,
    command: {
      version: 1 as const,
      command: "Decide" as const,
      event: asOperationDecisionEvent(dispatchEvent(id(1))),
    },
  };
  assert.deepEqual(await harness.inbox.accept(dispatchDecision), {
    accepted: "InvalidCommand",
  });
  assert.equal(
    await harness.inbox.operation(partition, dispatchDecision.operation),
    undefined,
  );
});

test("durable command validation rejects a raw ReleaseTicket", async () => {
  const release = postgresHarnessEntry(0).event;
  assert.deepEqual(
    await harness.query("SELECT ticket_command_is_valid($1::jsonb) AS valid", [
      JSON.stringify({ version: 1, command: "Decide", event: release }),
    ]),
    [{ valid: false }],
  );
});
