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
import type { Partition } from "../../src/interpreter/projectStore.ts";
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

function invalidDispatchCommands(): readonly unknown[] {
  return [
    {
      version: "1",
      command: "ManualDispatch",
      ticket: 1,
      expectedTicketVersion: 1,
    },
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
    {
      version: 1,
      command: "ProposeDispatch",
      ticket: 1,
      expectedTicketVersion: 1,
      observedViewToken: {
        tenant: "tenant",
        project: "project",
        recoveryEpoch: 7,
        schemaVersion: 1,
        watermark: 0,
        digest: "a".repeat(64),
      },
      selectorDecisionReference: 7,
    },
  ];
}

function selectorInteraction(partition: Partition, decision: string) {
  return {
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
  } as const;
}

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
  try {
    for (const command of invalidDispatchCommands()) {
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
        { partition, notificationCursor: 0, attention: "Monitoring" },
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

test("selector terminal outcomes are exactly idempotent", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-terminal");
  const pool = postgresPool(postgresHarnessUrl());
  const state = postgresSelectorState(pool);
  const decision = `terminal-${crypto.randomUUID()}`;
  try {
    await state.recordInteraction(
      selectorInteraction(partition, decision),
      { partition, notificationCursor: 0, attention: "Monitoring" },
      { partition, notificationCursor: 1, attention: "Monitoring" },
    );
    await pool.query(
      `INSERT INTO selector_proposal_delivery
       (selector_decision,tenant,project,operation,command)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        decision,
        partition.tenant,
        partition.project,
        crypto.randomUUID(),
        "{}",
      ],
    );
    await state.terminal(decision, { accepted: "InvalidCommand" });
    await state.terminal(decision, { accepted: "InvalidCommand" });
    await assert.rejects(
      state.terminal(decision, { accepted: "IdempotencyConflict" }),
      /contradicts retained state/,
    );
  } finally {
    await pool.end();
  }
});

test("selector delivery retry leases use the configured bounded delay", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-retry");
  const pool = postgresPool(postgresHarnessUrl());
  const state = postgresSelectorState(pool, {
    baseDelayMilliseconds: 5_000,
    maximumDelayMilliseconds: 5_000,
  });
  const decision = `retry-${crypto.randomUUID()}`;
  try {
    await state.recordInteraction(
      selectorInteraction(partition, decision),
      { partition, notificationCursor: 0, attention: "Monitoring" },
      { partition, notificationCursor: 1, attention: "Monitoring" },
    );
    await pool.query(
      `INSERT INTO selector_proposal_delivery
       (selector_decision,tenant,project,operation,command)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        decision,
        partition.tenant,
        partition.project,
        crypto.randomUUID(),
        JSON.stringify({
          version: 1,
          command: "ProposeDispatch",
          ticket: 1,
          expectedTicketVersion: 1,
          observedViewToken: {
            ...partition,
            recoveryEpoch: "epoch",
            schemaVersion: 1,
            watermark: 1,
            digest: "a".repeat(64),
          },
          selectorDecisionReference: decision,
        }),
      ],
    );
    assert.equal((await state.pending(1)).length, 1);
    const lease = await pool.query<{ remaining: number }>(
      `SELECT extract(epoch FROM retry_at-clock_timestamp())::float8 AS remaining
         FROM selector_proposal_delivery WHERE selector_decision=$1`,
      [decision],
    );
    assert.ok((lease.rows[0]?.remaining ?? 0) > 3);
    assert.ok((lease.rows[0]?.remaining ?? 99) <= 5);
  } finally {
    await pool.end();
  }
});

test("selector inventory advancement rejects a stale runner", async () => {
  const pool = postgresPool(postgresHarnessUrl());
  const state = postgresSelectorState(pool);
  const first = {
    tenant: (await postgresHarnessProject(harness.store, "i5-cursor-first"))
      .tenant,
    project: (await postgresHarnessProject(harness.store, "i5-cursor-value"))
      .project,
  };
  const second = {
    ...first,
    project: `${first.project}-second` as typeof first.project,
  };
  try {
    assert.equal(await state.advanceInventoryCursor(undefined, first), true);
    assert.equal(await state.advanceInventoryCursor(undefined, second), false);
    assert.deepEqual(await state.inventoryCursor(), first);
    assert.equal(await state.advanceInventoryCursor(first, undefined), true);
  } finally {
    await pool.end();
  }
});

test("submitted reconciliation leases rotate through the bounded batch", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-reconciliation-fairness",
  );
  const pool = postgresPool(postgresHarnessUrl());
  const state = postgresSelectorState(pool, {
    baseDelayMilliseconds: 5_000,
    maximumDelayMilliseconds: 5_000,
  });
  const decisions = [
    `reconcile-a-${crypto.randomUUID()}`,
    `reconcile-b-${crypto.randomUUID()}`,
  ];
  try {
    let cursor = 0;
    for (const decision of decisions) {
      await state.recordInteraction(
        selectorInteraction(partition, decision),
        { partition, notificationCursor: cursor, attention: "Monitoring" },
        {
          partition,
          notificationCursor: cursor + 1,
          attention: "Monitoring",
        },
      );
      cursor += 1;
      await pool.query(
        `INSERT INTO selector_proposal_delivery
         (selector_decision,tenant,project,operation,command)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          decision,
          partition.tenant,
          partition.project,
          crypto.randomUUID(),
          JSON.stringify({
            version: 1,
            command: "ProposeDispatch",
            ticket: 1,
            expectedTicketVersion: 1,
            observedViewToken: {
              ...partition,
              recoveryEpoch: "epoch",
              schemaVersion: 1,
              watermark: 1,
              digest: "a".repeat(64),
            },
            selectorDecisionReference: decision,
          }),
        ],
      );
      await state.submitted(decision);
    }
    const first = await state.submittedDeliveries(1);
    const second = await state.submittedDeliveries(1);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(first[0]?.decision, second[0]?.decision);
  } finally {
    await pool.end();
  }
});

test("selector cursors reject malformed and inexact counters", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-counters");
  const pool = postgresPool(postgresHarnessUrl());
  const state = postgresSelectorState(pool);
  try {
    await assert.rejects(
      state.history(partition, Number.NaN, 10),
      /cursor must be a non-negative safe integer/,
    );
    await pool.query(
      `INSERT INTO selector_project_state (tenant,project,notification_cursor)
       VALUES ($1,$2,9007199254740992)`,
      [partition.tenant, partition.project],
    );
    await assert.rejects(
      state.project(partition),
      /selector notification cursor.*exactly representable/,
    );
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
  try {
    assert.equal(
      await state.recordInteraction(
        selectorInteraction(partition, `z-${crypto.randomUUID()}`),
        { partition, notificationCursor: 0, attention: "Monitoring" },
        { partition, notificationCursor: 1, attention: "Monitoring" },
      ),
      true,
    );
    const first = await state.history(partition, undefined, 1);
    assert.equal(first.length, 1);
    assert.equal(
      await state.recordInteraction(
        selectorInteraction(partition, `a-${crypto.randomUUID()}`),
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

test("concurrent first selector observations have exactly one CAS winner", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-selector-first-race",
  );
  const pool = postgresPool(postgresHarnessUrl());
  const state = postgresSelectorState(pool);
  try {
    const previous = {
      partition,
      notificationCursor: 0,
      attention: "Monitoring",
    } as const;
    const results = await Promise.all([
      state.recordInteraction(
        selectorInteraction(partition, `first-${crypto.randomUUID()}`),
        previous,
        {
          ...previous,
          notificationCursor: 1,
        },
      ),
      state.recordInteraction(
        selectorInteraction(partition, `second-${crypto.randomUUID()}`),
        previous,
        {
          ...previous,
          notificationCursor: 2,
        },
      ),
    ]);
    assert.deepEqual([...results].sort(), [false, true]);
    assert.ok(
      [1, 2].includes(
        (await state.project(partition))?.notificationCursor ?? 0,
      ),
    );
    assert.equal((await state.history(partition, undefined, 10)).length, 1);
  } finally {
    await pool.end();
  }
});
