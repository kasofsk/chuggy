import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresDispatchViews } from "../../src/adapters/postgres/dispatchViews.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  postgresSelectorProposalReviews,
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "../../src/adapters/postgres/selector.ts";
import {
  apiRole,
  dispatchAcceptanceFunction,
  selectorClaimFunction,
  selectorControlRole,
  selectorReviewFunction,
  selectorReviewRole,
  selectorServiceRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { projectWriterDecide } from "../../src/interpreter/projectWriter.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";
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

const selectorInteractionContext = {
  workingMemory: {},
  operationalContext: {
    observedAt: "2026-08-20T12:00:00.000Z",
    observedAtEpochMs: 1_777_000_000_000,
    reviewFeedback: [],
    activeWork: [],
    projectCapacity: {
      account: "project",
      allocated: 0,
      limit: 1,
      available: 1,
    },
    clusterCapacity: {
      visibility: "AuthorizedAggregate",
      allocated: 0,
      limit: 1,
      available: 1,
      pressure: "Normal",
    },
    executionBacklog: { queued: 0, ceiling: 10, dispatchAllowed: true },
  },
} as const;

function selectorTestInteraction(partition: Partition, decision: string) {
  return {
    decision,
    partition,
    instructionsVersion: "instructions-1",
    instructions: "choose a dispatchable ticket",
    observedView: [],
    context: selectorInteractionContext,
    toolActivity: [],
    result: { waiting: true },
    implementationRevision: "implementation-1",
    modelRevision: "model-1",
    policyRevision: "policy-1",
    accounting: { tokens: 1, durationMs: 1 },
    startedAt: "2026-08-20T12:00:00.000Z",
    completedAt: "2026-08-20T12:00:01.000Z",
  } as const;
}

function selectorTestProposal(partition: Partition, decision: string) {
  return {
    interaction: selectorTestInteraction(partition, decision),
    operation: asOperationId(`operation-${decision}`),
    deliveryMode: "ApprovalRequired",
    command: {
      version: 1,
      command: "ProposeDispatch",
      ticket: asTicketId(1),
      expectedTicketVersion: 1,
      observedViewToken: {
        ...partition,
        recoveryEpoch: "epoch",
        schemaVersion: 1,
        watermark: 0,
        digest: "a".repeat(64),
      },
      selectorDecisionReference: decision,
    },
  } as const;
}

function postgresRolePool(role: string) {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${role}`);
  return postgresPool(url.toString());
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
  for (const role of [selectorServiceRole, selectorControlRole]) {
    const settingsRefusal = await harness.attemptAs(
      role,
      "UPDATE selector_runtime_settings SET mode='Paused' WHERE singleton=1",
    );
    assert.match(settingsRefusal ?? "", /permission denied/);
    const historyRefusal = await harness.attemptAs(
      role,
      `INSERT INTO selector_runtime_settings_history
       (revision,mode,dispatch_mode,base_prompt,controls)
       VALUES (999,'Running','Automatic','forged','{}')`,
    );
    assert.match(historyRefusal ?? "", /permission denied/);
  }
  for (const sql of [
    "UPDATE selector_proposal_delivery SET state='Pending' WHERE false",
    "DELETE FROM selector_interaction WHERE false",
  ]) {
    const refusal = await harness.attemptAs(selectorServiceRole, sql);
    assert.match(refusal ?? "", /permission denied/);
  }
  const selectorReviewRefusal = await harness.attemptAs(
    selectorServiceRole,
    `SELECT ${selectorReviewFunction}('missing','t','p','Approved','User','reviewer',NULL)`,
  );
  assert.match(selectorReviewRefusal ?? "", /permission denied/);
  const reviewClaimRefusal = await harness.attemptAs(
    selectorReviewRole,
    `SELECT * FROM ${selectorClaimFunction}(1)`,
  );
  assert.match(reviewClaimRefusal ?? "", /permission denied/);
  assert.equal(
    await harness.attemptAs(
      selectorReviewRole,
      `SELECT ${selectorReviewFunction}('missing','t','p','Approved','User','reviewer',NULL)`,
    ),
    undefined,
  );
});

test("selector provenance and its observed cursor roll back together", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-selector-atomic",
  );
  const pool = postgresPool(postgresHarnessUrl());
  const state = postgresSelectorState(pool);
  const decision = `selector-atomic-${crypto.randomUUID()}`;
  const interaction = selectorTestInteraction(partition, decision);
  try {
    await assert.rejects(
      state.recordInteraction(
        interaction,
        {
          partition,
          notificationCursor: 17,
          attention: "Monitoring",
          workingMemory: {},
        },
        "x".repeat(65_537),
      ),
      /selector_planning_intent.*check|violates check constraint/,
    );
    assert.equal(await state.project(partition), undefined);
    assert.deepEqual(await state.history(partition, undefined, 10), []);

    await state.recordInteraction(interaction, {
      partition,
      notificationCursor: 17,
      attention: "Monitoring",
      workingMemory: {},
    });
    assert.equal((await state.project(partition))?.notificationCursor, 17);
    assert.equal((await state.history(partition, undefined, 10)).length, 1);
    await state.recordInteraction(interaction, {
      partition,
      notificationCursor: 99,
      attention: "Attention",
      workingMemory: { conflicting: true },
    });
    assert.equal((await state.project(partition))?.notificationCursor, 17);
    await assert.rejects(
      state.recordInteraction(
        { ...interaction, instructions: "different semantic interaction" },
        {
          partition,
          notificationCursor: 99,
          attention: "Attention",
          workingMemory: { conflicting: true },
        },
      ),
      /identity conflicts/,
    );
    assert.equal((await state.project(partition))?.notificationCursor, 17);
  } finally {
    await pool.end();
  }
});

test("selector controls hot-reload with a revision fence", async () => {
  const pool = postgresRolePool(selectorControlRole);
  const control = postgresSelectorRuntimeControl(pool);
  try {
    const initial = await control.settings();
    const paused = await control.pause(initial.revision);
    assert.equal(paused.updated, true);
    assert.equal(paused.settings.mode, "Paused");

    const stale = await control.updateBasePrompt(
      initial.revision,
      "this update raced with pause",
    );
    assert.equal(stale.updated, false);
    assert.equal(stale.settings.revision, paused.settings.revision);

    const prompted = await control.updateBasePrompt(
      paused.settings.revision,
      "prefer tickets that unblock the largest dependency closure",
    );
    assert.equal(prompted.updated, true);
    assert.equal(
      prompted.settings.basePrompt,
      "prefer tickets that unblock the largest dependency closure",
    );

    const reviewed = await control.setDispatchMode(
      prompted.settings.revision,
      "ApprovalRequired",
    );
    assert.equal(reviewed.updated, true);
    assert.equal(reviewed.settings.dispatchMode, "ApprovalRequired");

    const governed = await control.updatePolicyControls(
      reviewed.settings.revision,
      {
        modelAllowlist: ["selector-model"],
        toolAllowlist: ["project-capacity", "cluster-summary"],
        limits: {
          tokensPerDecision: 4096,
          millisecondsPerDecision: 60_000,
          toolCallsPerDecision: 10,
          concurrentDecisions: 2,
          selectionsPerMinute: 30,
        },
        operationalContextMaxAgeMs: 15_000,
      },
    );
    assert.equal(governed.updated, true);
    assert.deepEqual(governed.settings.modelAllowlist, ["selector-model"]);

    const history = await control.history(initial.revision - 1, 20);
    assert.ok(
      history.some((settings) => settings.revision === initial.revision),
    );
    const restored = await control.rollback(
      governed.settings.revision,
      initial.revision,
    );
    assert.equal(restored.updated, true);
    assert.equal(restored.settings.basePrompt, initial.basePrompt);
    assert.equal(restored.settings.dispatchMode, initial.dispatchMode);

    const running = await control.unpause(restored.settings.revision);
    assert.equal(running.updated, true);
    assert.equal(running.settings.mode, "Running");
    const drain = await control.drainStatus();
    assert.equal(typeof drain.drained, "boolean");
  } finally {
    await pool.end();
  }
});

test("proposal review retains reviewer authority and readable feedback", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-review-audit",
  );
  const pool = postgresPool(postgresHarnessUrl());
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const control = postgresSelectorRuntimeControl(pool);
  const originalSettings = await control.settings();
  const approvalSettings = await control.setDispatchMode(
    originalSettings.revision,
    "ApprovalRequired",
  );
  assert.equal(approvalSettings.updated, true);
  const decision = `review-${crypto.randomUUID()}`;
  try {
    await state.record(selectorTestProposal(partition, decision), {
      partition,
      notificationCursor: 0,
      attention: "Monitoring",
      workingMemory: {},
    });
    const reviewer = {
      kind: asAuthorityKind("User"),
      subject: asAuthoritySubject("admin-reviewer"),
    };
    assert.equal(
      await reviews.approve(
        partition,
        decision,
        reviewer,
        "ship after migration",
      ),
      true,
    );
    const feedback = await reviews.reviewFeedback(partition, undefined, 10);
    assert.deepEqual(feedback[0], {
      selectorDecision: decision,
      outcome: "Approved",
      reviewer,
      feedback: "ship after migration",
      reviewedAt: feedback[0]?.reviewedAt,
    });
  } finally {
    const currentSettings = await control.settings();
    await control.setDispatchMode(
      currentSettings.revision,
      originalSettings.dispatchMode,
    );
    await selectorPool.end();
    await reviewPool.end();
    await pool.end();
  }
});

test("dispatch acceptance refuses every command the wire parser cannot read", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-invalid-dispatch",
  );
  const pool = postgresPool(postgresHarnessUrl());
  const token = {
    ...partition,
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: 0,
    digest: "a".repeat(64),
  };
  const commands = [
    {
      version: 1,
      command: "ManualDispatch",
      ticket: 1,
      expectedTicketVersion: 9_007_199_254_740_992,
    },
    {
      version: 1,
      command: "ProposeDispatch",
      ticket: 1,
      expectedTicketVersion: 1,
      observedViewToken: { ...token, recoveryEpoch: "" },
      selectorDecisionReference: "decision",
    },
    {
      version: 1,
      command: "ProposeDispatch",
      ticket: 1,
      expectedTicketVersion: 1,
      observedViewToken: { ...token, watermark: -1 },
      selectorDecisionReference: "decision",
    },
  ];
  try {
    for (const [index, command] of commands.entries()) {
      const found = await pool.query<{ result: string }>(
        `SELECT result FROM ${dispatchAcceptanceFunction}(
          $1,$2,$3,'User','subject','v1',$4,$5,ARRAY[]::text[],ARRAY[]::text[],$6,10,100)`,
        [
          partition.tenant,
          partition.project,
          `invalid-${String(index)}`,
          `key-${String(index)}`,
          `payload-${String(index)}`,
          JSON.stringify(command),
        ],
      );
      assert.equal(found.rows[0]?.result, "InvalidCommand");
    }
  } finally {
    await pool.end();
  }
});
