import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresDispatchViews } from "../../src/adapters/postgres/dispatchViews.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresSelectorState } from "../../src/adapters/postgres/selector.ts";
import {
  apiRole,
  dispatchAcceptanceFunction,
  selectorServiceRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { projectWriterDecide } from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessHistory,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessSubmission,
  postgresHarnessUrl,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

test("a release atomically materializes a digest-fenced current dispatch view", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-view");
  const memory = await postgresHarnessHistory(harness, partition, "i5-view", 1);
  const pool = postgresPool(postgresHarnessUrl());
  try {
    const page = await postgresDispatchViews(pool).read(partition, {
      limit: 10,
    });
    assert.equal(page.result, "Page");
    assert.ok(page.result === "Page");
    assert.equal(page.token.watermark, memory.lease.head);
    assert.equal(page.candidates.length, 1);
    assert.equal(page.candidates[0]?.ticketVersion, memory.lease.head);
    assert.match(page.token.digest, /^[0-9a-f]{64}$/);
    await pool.query(
      "UPDATE dispatch_view SET digest=$3 WHERE tenant=$1 AND project=$2",
      [partition.tenant, partition.project, "f".repeat(64)],
    );
    assert.deepEqual(
      await postgresDispatchViews(pool).read(partition, {
        limit: 10,
        token: page.token,
      }),
      { result: "Reset" },
    );
  } finally {
    await pool.end();
  }
});

test("the SQL dispatch constructor rejects incomplete and overflowing proposals", async () => {
  const pool = postgresPool(postgresHarnessUrl());
  const invalid = [
    {
      version: 1,
      command: "ProposeDispatch",
      ticket: 1,
      expectedTicketVersion: 1,
    },
    {
      version: 1,
      command: "ProposeDispatch",
      ticket: 1,
      expectedTicketVersion: "9".repeat(40),
      observedViewToken: {
        tenant: "tenant",
        project: "project",
        recoveryEpoch: "epoch",
        schemaVersion: 1,
        watermark: 0,
        digest: "a".repeat(64),
      },
      selectorDecisionReference: "decision",
    },
  ];
  try {
    for (const command of invalid) {
      const result = await pool.query<{ result: string }>(
        `SELECT result FROM ${dispatchAcceptanceFunction}(
          $1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::text[],$11,$12,$13)`,
        [
          "tenant",
          "project",
          crypto.randomUUID(),
          "Selector",
          "selector",
          "key-version",
          "key-digest",
          "payload-digest",
          [],
          [],
          JSON.stringify(command),
          10,
          20,
        ],
      );
      assert.equal(result.rows[0]?.result, "InvalidCommand");
    }
  } finally {
    await pool.end();
  }
});

test("a proposal carrying the current strict view dispatches", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-proposal");
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "i5-proposal",
    1,
  );
  const pool = postgresPool(postgresHarnessUrl());
  try {
    const page = await postgresDispatchViews(pool).read(partition, {
      limit: 10,
    });
    assert.ok(page.result === "Page");
    const candidate = page.candidates[0];
    assert.ok(candidate !== undefined);
    const base = postgresHarnessSubmission(partition, "i5-proposal");
    const accepted = await harness.inbox.accept({
      ...base,
      command: {
        version: 1,
        command: "ProposeDispatch",
        ticket: candidate.ticket,
        expectedTicketVersion: candidate.ticketVersion,
        observedViewToken: page.token,
        selectorDecisionReference: "selector-decision",
      },
    });
    assert.equal(accepted.accepted, "Accepted");
    const input = await harness.discovery.next(partition);
    assert.ok(input !== undefined);
    const result = await projectWriterDecide(
      postgresHarnessWriter(harness),
      memory,
      input,
    );
    assert.equal(result.decided.decided, "Committed");
  } finally {
    await pool.end();
  }
});

test("manual and agentic dispatch race by ordinary journal order", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-dispatch-race",
  );
  let memory = await postgresHarnessHistory(
    harness,
    partition,
    "i5-dispatch-race",
    1,
  );
  const pool = postgresPool(postgresHarnessUrl());
  try {
    const page = await postgresDispatchViews(pool).read(partition, {
      limit: 10,
    });
    assert.ok(page.result === "Page");
    const candidate = page.candidates[0];
    assert.ok(candidate !== undefined);
    const manual = postgresHarnessSubmission(partition, "i5-race-manual");
    const proposal = postgresHarnessSubmission(partition, "i5-race-proposal");
    assert.equal(
      (
        await harness.inbox.accept({
          ...manual,
          command: {
            version: 1,
            command: "ManualDispatch",
            ticket: candidate.ticket,
            expectedTicketVersion: candidate.ticketVersion,
          },
        })
      ).accepted,
      "Accepted",
    );
    assert.equal(
      (
        await harness.inbox.accept({
          ...proposal,
          command: {
            version: 1,
            command: "ProposeDispatch",
            ticket: candidate.ticket,
            expectedTicketVersion: candidate.ticketVersion,
            observedViewToken: page.token,
            selectorDecisionReference: "selector-racing-manual",
          },
        })
      ).accepted,
      "Accepted",
    );
    const writer = postgresHarnessWriter(harness);
    const first = await harness.discovery.next(partition);
    assert.ok(first !== undefined);
    const dispatched = await projectWriterDecide(writer, memory, first);
    assert.equal(dispatched.decided.decided, "Committed");
    memory = dispatched.memory;
    const dispatchedHead = memory.lease.head;

    const second = await harness.discovery.next(partition);
    assert.ok(second !== undefined);
    const staleChoice = await projectWriterDecide(writer, memory, second);
    assert.equal(staleChoice.decided.decided, "Refused");
    assert.equal(staleChoice.memory.lease.head, dispatchedHead);
  } finally {
    await pool.end();
  }
});

test("runtime roles cannot cross the selector and ticket-service storage boundary", async () => {
  for (const role of [apiRole, ticketServiceRole]) {
    const refusal = await harness.attemptAs(
      role,
      "INSERT INTO selector_project_state (tenant,project) VALUES ('t','p')",
    );
    assert.match(refusal ?? "", /permission denied/);
  }
  const ticketRefusal = await harness.attemptAs(
    selectorServiceRole,
    "SELECT * FROM journal_entry LIMIT 1",
  );
  assert.match(ticketRefusal ?? "", /permission denied/);
});

test("selector provenance and its observed cursor roll back together", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-selector-atomic",
  );
  const pool = postgresPool(postgresHarnessUrl());
  const state = postgresSelectorState(pool);
  const decision = `selector-atomic-${crypto.randomUUID()}`;
  const interaction = {
    decision,
    partition,
    instructionsVersion: "instructions-1",
    instructions: "choose a dispatchable ticket",
    observedView: [],
    context: {},
    toolActivity: [],
    result: { waiting: true },
    implementationRevision: "implementation-1",
    modelRevision: "model-1",
    policyRevision: "policy-1",
    accounting: {},
    startedAt: "2026-08-20T12:00:00.000Z",
    completedAt: "2026-08-20T12:00:01.000Z",
  } as const;
  try {
    await assert.rejects(
      state.recordInteraction(
        interaction,
        { partition, notificationCursor: 0, attention: "Monitoring" },
        { partition, notificationCursor: 17, attention: "Monitoring" },
        "x".repeat(65_537),
      ),
      /selector_planning_intent.*check|violates check constraint/,
    );
    assert.equal(await state.project(partition), undefined);
    assert.deepEqual(await state.history(partition, undefined, 10), []);

    await state.recordInteraction(
      interaction,
      { partition, notificationCursor: 0, attention: "Monitoring" },
      { partition, notificationCursor: 17, attention: "Monitoring" },
    );
    assert.equal((await state.project(partition))?.notificationCursor, 17);
    assert.equal((await state.history(partition, undefined, 10)).length, 1);

    await assert.rejects(
      state.recordInteraction(
        { ...interaction, result: { waiting: false } },
        { partition, notificationCursor: 17, attention: "Monitoring" },
        { partition, notificationCursor: 18, attention: "Monitoring" },
      ),
      /contradicts retained provenance/,
    );
    assert.equal((await state.project(partition))?.notificationCursor, 17);

    const stale = await state.recordInteraction(
      { ...interaction, decision: `${decision}-stale` },
      { partition, notificationCursor: 0, attention: "Monitoring" },
      { partition, notificationCursor: 99, attention: "Monitoring" },
    );
    assert.equal(stale, false);
    assert.equal((await state.project(partition))?.notificationCursor, 17);
  } finally {
    await pool.end();
  }
});

test("selector history pages by durable insertion order, not opaque identity", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-selector-history",
  );
  const pool = postgresPool(postgresHarnessUrl());
  const state = postgresSelectorState(pool);
  const interaction = (decision: string) =>
    ({
      decision,
      partition,
      instructionsVersion: "instructions-1",
      instructions: "wait",
      observedView: [],
      context: {},
      toolActivity: [],
      result: { waiting: true },
      implementationRevision: "implementation-1",
      modelRevision: "model-1",
      policyRevision: "policy-1",
      accounting: {},
      startedAt: "2026-08-20T12:00:00.000Z",
      completedAt: "2026-08-20T12:00:01.000Z",
    }) as const;
  try {
    assert.equal(
      await state.recordInteraction(
        interaction(`z-${crypto.randomUUID()}`),
        { partition, notificationCursor: 0, attention: "Monitoring" },
        { partition, notificationCursor: 1, attention: "Monitoring" },
      ),
      true,
    );
    const first = await state.history(partition, undefined, 1);
    assert.equal(first.length, 1);
    assert.equal(
      await state.recordInteraction(
        interaction(`a-${crypto.randomUUID()}`),
        { partition, notificationCursor: 1, attention: "Monitoring" },
        { partition, notificationCursor: 2, attention: "Monitoring" },
      ),
      true,
    );
    const second = await state.history(partition, first[0]?.ordinal, 1);
    assert.equal(second.length, 1);
    assert.match(second[0]?.decision ?? "", /^a-/);
  } finally {
    await pool.end();
  }
});
