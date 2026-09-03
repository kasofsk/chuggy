import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type pg from "pg";

import { postgresDispatchViews } from "../../src/adapters/postgres/dispatchViews.ts";
import { postgresNotifications } from "../../src/adapters/postgres/notifications.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  postgresSelectorProjectSettings,
  postgresSelectorProposalReviews,
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "../../src/adapters/postgres/selector.ts";
import {
  apiRole,
  boundaryOwnerRole,
  dispatchAcceptanceFunction,
  selectorClaimFunction,
  selectorControlRole,
  selectorDeliveryFunction,
  selectorProjectDispatchModeFunction,
  selectorProjectSettingsFunction,
  selectorInteractionsReadFunction,
  selectorReconcileClaimFunction,
  selectorReviewFunction,
  selectorReviewRole,
  selectorServiceRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { interactionsReadSignature } from "../../src/adapters/postgres/schema/migrations/059-lead-decisions.ts";
import { decisionSemanticsVersionCurrent } from "../../src/actor/decisionSemantics.ts";
import { ticketAt } from "../../src/domain/core.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { notificationPageLimitMax } from "../../src/interpreter/notifications.ts";
import type {
  SelectorDecisionProposals,
  SelectorDelivery,
  SelectorRecordedDecision,
} from "../../src/interpreter/selector.ts";
import type { DecisionInput } from "../../src/interpreter/projectDiscovery.ts";
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
  postgresHarnessReleaseSubmission,
  postgresHarnessSelectorContext,
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
  handoffNote: {},
  operationalContext: postgresHarnessSelectorContext,
} as const;

const selectorAdministrator = {
  kind: asAuthorityKind("Administrator"),
  subject: asAuthoritySubject("selector-admin"),
};

const governedSelectorControls = {
  modelAllowlist: ["selector-model"],
  toolAllowlist: ["project-capacity", "cluster-summary"],
  limits: {
    tokensPerDecision: 4096,
    millisecondsPerDecision: 60_000,
    toolCallsPerDecision: 10,
    dispatchesPerDecision: 1,
    inputBytesPerDecision: 1_048_576,
    candidatePagesPerDecision: 1,
    concurrentDecisions: 2,
    selectionsPerMinute: 30,
  },
  operationalContextMaxAgeMs: 15_000,
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

/** The revisions a case's decision ran under, which no case here is about. */
const selectorTestFence = {
  settingsRevision: 1,
  projectSettingsRevision: 0,
} as const;

/** How many delivery rows one record wrote, which is what a case counting them means. */
async function wrote(
  written: Promise<SelectorRecordedDecision>,
): Promise<number> {
  return (await written).dispatched.length;
}

function selectorTestProposal(
  partition: Partition,
  decision: string,
  tickets: readonly number[] = [1],
): SelectorDecisionProposals {
  return {
    interaction: selectorTestInteraction(partition, decision),
    fence: selectorTestFence,
    deliveryMode: "ApprovalRequired",
    dispatches: tickets.map((ticket) => ({
      ticket: asTicketId(ticket),
      operation: asOperationId(`operation-${decision}-t${String(ticket)}`),
      command: {
        version: 1,
        command: "ProposeDispatch",
        ticket: asTicketId(ticket),
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
    })),
  };
}

function selectorTestState(
  partition: Partition,
  revision: number,
  notificationCursor = revision,
) {
  return {
    partition,
    notificationCursor,
    revision,
    attention: "Monitoring",
    handoffNote: {},
  } as const;
}

function postgresRolePool(role: string) {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${role}`);
  return postgresPool(url.toString());
}

/**
 * One delivery row offered to the relation directly, past the adapter that
 * keys them: a case about a constraint has to reach the constraint, and the
 * adapter is what a well-formed row goes through.
 */
async function i5OfferDelivery(
  partition: Partition,
  decision: string,
  ticket: number,
  operation: string,
): Promise<void> {
  await harness.query(
    `INSERT INTO selector_proposal_delivery
       (selector_decision,ticket,tenant,project,operation,command,state)
     VALUES ($1,$2,$3,$4,$5,$6,'AwaitingApproval')`,
    [
      decision,
      ticket,
      partition.tenant,
      partition.project,
      operation,
      JSON.stringify({
        version: 1,
        command: "ProposeDispatch",
        ticket,
        expectedTicketVersion: 1,
        observedViewToken: {
          ...partition,
          recoveryEpoch: "epoch",
          schemaVersion: 1,
          watermark: 0,
          digest: "a".repeat(64),
        },
        selectorDecisionReference: decision,
      }),
    ],
  );
}

/** One decision's rows as the relation holds them, in the order its key gives. */
async function i5DeliveryRows(
  decision: string,
): Promise<readonly Record<string, unknown>[]> {
  return harness.query(
    `SELECT ticket::text AS ticket,state,outcome,attempts::text AS attempts
       FROM selector_proposal_delivery
      WHERE selector_decision=$1 ORDER BY ticket`,
    [decision],
  );
}

/**
 * Every delivery this database already holds in one claimable state, claimed
 * and so deferred: a claim is installation-wide, so a case about which rows it
 * picks has to start from a relation offering only its own.
 */
async function i5Drain(
  claim: (limit: number) => Promise<readonly SelectorDelivery[]>,
): Promise<void> {
  for (let sweep = 0; sweep < 10; sweep += 1)
    if ((await claim(100)).length === 0) return;
  throw new Error("i5: claimable deliveries would not drain");
}

/** The installation's dispatch mode for the length of one case, and the way to put it back. */
async function i5HeldDispatchMode(
  mode: "Automatic" | "ApprovalRequired",
): Promise<() => Promise<void>> {
  const pool = postgresRolePool(selectorControlRole);
  const control = postgresSelectorRuntimeControl(pool);
  const original = await control.settings();
  const held = await control.setDispatchMode(
    original.revision,
    mode,
    selectorAdministrator,
  );
  assert.equal(held.updated, true);
  return async () => {
    const current = await control.settings();
    await control.setDispatchMode(
      current.revision,
      original.dispatchMode,
      selectorAdministrator,
    );
    await pool.end();
  };
}

test("the API role reads a released ticket from the current dispatch view", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-view");
  const memory = await postgresHarnessHistory(harness, partition, "i5-view", 1);
  const pool = postgresRolePool(apiRole);
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

/** A dispatch proposal fenced on a version its ticket does not stand at, accepted and awaiting the writer. */
async function i5StaleProposal(
  partition: Partition,
  page: Extract<
    Awaited<ReturnType<ReturnType<typeof postgresDispatchViews>["read"]>>,
    { result: "Page" }
  >,
  candidate: { readonly ticket: number; readonly ticketVersion: number },
): Promise<DecisionInput> {
  const accepted = await harness.inbox.accept({
    ...postgresHarnessSubmission(partition, "i5-refused-moves"),
    command: {
      version: 1,
      command: "ProposeDispatch",
      ticket: asTicketId(candidate.ticket),
      expectedTicketVersion: candidate.ticketVersion + 1,
      observedViewToken: page.token,
      selectorDecisionReference: "i5-refused-moves-decision",
    },
  });
  assert.equal(accepted.accepted, "Accepted");
  const input = await harness.discovery.next(partition, 300);
  if (input === undefined)
    throw new Error("i5: the accepted proposal reached no writer");
  return input;
}

/**
 * The change-driven runtime gives a project a turn only where its notification
 * log moved past the cursor its last turn stood on, so a decision whose every
 * dispatch the writer refuses must leave a row there or the lead is never asked
 * again. It does, because a refused operation is settled and published in the
 * deciding transaction exactly as a journaled one is.
 */
test("a refused proposal moves the project its lead's next turn waits on", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-refused-moves",
  );
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    "i5-refused-moves",
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
    const notifications = postgresNotifications(pool);
    const standing = await notifications.read(partition, {
      after: 0,
      limit: notificationPageLimitMax,
    });
    assert.ok(standing.result === "Events");
    const input = await i5StaleProposal(partition, page, candidate);
    const decided = await projectWriterDecide(
      postgresHarnessWriter(harness),
      memory,
      input,
    );
    assert.equal(
      decided.decided.decided,
      "Refused",
      "a version the ticket does not stand at is what the fence refuses",
    );
    const moved = await notifications.read(partition, {
      after: standing.cursor,
      limit: notificationPageLimitMax,
    });
    assert.ok(moved.result === "Events");
    assert.deepEqual(
      moved.events.map((event) => event.kind),
      ["Operation"],
      "the refusal is what the lead's next turn is triggered by",
    );
    assert.equal(
      moved.events[0]?.resource,
      input.source.kind === "Operation" ? input.source.operation : undefined,
      "and it names the operation the proposal was submitted under",
    );
    assert.equal(
      ticketAt(decided.memory.core, candidate.ticket).phase,
      "Pending",
      "a refused dispatch leaves its ticket where the lead will see it again",
    );
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

/** Releases a second independent ticket, so one observed page carries two candidates. */
async function i5TwoReleased(
  partition: Partition,
  label: string,
): Promise<ProjectMemory> {
  const writer = postgresHarnessWriter(harness);
  const memory = await postgresHarnessHistory(harness, partition, label, 1);
  const second = await postgresHarnessReleaseSubmission(
    harness,
    partition,
    `${label}-second`,
  );
  assert.equal((await harness.inbox.accept(second)).accepted, "Accepted");
  const release = await harness.discovery.next(partition, 300);
  assert.ok(release !== undefined);
  const released = await projectWriterDecide(writer, memory, release);
  assert.equal(released.decided.decided, "Committed");
  return released.memory;
}

test("one decision's proposals over the same observed page each dispatch", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-several");
  const writer = postgresHarnessWriter(harness);
  let memory = await i5TwoReleased(partition, "i5-several");
  const pool = postgresPool(postgresHarnessUrl());
  try {
    const page = await postgresDispatchViews(pool).read(partition, {
      limit: 10,
    });
    assert.ok(page.result === "Page");
    assert.equal(page.candidates.length, 2);
    for (const candidate of page.candidates) {
      const accepted = await harness.inbox.accept({
        ...postgresHarnessSubmission(
          partition,
          `i5-several-${String(candidate.ticket)}`,
        ),
        command: {
          version: 1,
          command: "ProposeDispatch",
          ticket: candidate.ticket,
          expectedTicketVersion: candidate.ticketVersion,
          observedViewToken: page.token,
          selectorDecisionReference: "i5-several-decision",
        },
      });
      assert.equal(accepted.accepted, "Accepted");
    }
    const journaled: number[] = [];
    for (let delivered = 0; delivered < page.candidates.length; delivered++) {
      const input = await harness.discovery.next(partition, 300);
      assert.ok(input !== undefined);
      const step = await projectWriterDecide(writer, memory, input);
      assert.equal(step.decided.decided, "Committed");
      memory = step.memory;
      journaled.push(memory.lease.head);
    }
    assert.deepEqual(
      page.candidates.map(
        (candidate) => ticketAt(memory.core, candidate.ticket).phase,
      ),
      ["Working", "Working"],
    );
    const rows = await harness.query(
      `SELECT seq, decision_semantics_version
         FROM journal_entry
        WHERE tenant = $1 AND project = $2 AND seq = ANY($3::bigint[])
        ORDER BY seq`,
      [partition.tenant, partition.project, journaled],
    );
    assert.deepEqual(
      rows.map((row) => row["decision_semantics_version"]),
      journaled.map(() => decisionSemanticsVersionCurrent),
    );
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
    const first = selectorTestState(partition, 0, 17);
    const later = {
      ...selectorTestState(partition, 1, 99),
      attention: "Attention",
      handoffNote: { conflicting: true },
    } as const;
    await assert.rejects(
      state.recordInteraction(
        interaction,
        first,
        selectorTestFence,
        "x".repeat(65_537),
      ),
      /selector_planning_intent.*check|violates check constraint/,
    );
    assert.equal(await state.project(partition), undefined);
    assert.deepEqual(await state.history(partition, undefined, 10), []);

    await state.recordInteraction(interaction, first, selectorTestFence);
    assert.equal((await state.project(partition))?.notificationCursor, 17);
    assert.equal((await state.history(partition, undefined, 10)).length, 1);
    await state.recordInteraction(interaction, later, selectorTestFence);
    assert.equal((await state.project(partition))?.notificationCursor, 17);
    await assert.rejects(
      state.recordInteraction(
        { ...interaction, instructions: "different semantic interaction" },
        later,
        selectorTestFence,
      ),
      /identity conflicts/,
    );
    assert.equal((await state.project(partition))?.notificationCursor, 17);
  } finally {
    await pool.end();
  }
});

test("selector provenance round-trips resources larger than one audit column", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-selector-chunked-provenance",
  );
  const pool = postgresRolePool(selectorServiceRole);
  const state = postgresSelectorState(pool);
  const largeEvidence = "e".repeat(180_000);
  const interaction = {
    ...selectorTestInteraction(partition, `chunked-${crypto.randomUUID()}`),
    context: {
      ...selectorInteractionContext,
      handoffNote: { evidence: largeEvidence },
    },
    toolActivity: [{ evidence: largeEvidence }],
  };
  try {
    assert.equal(
      await state.recordInteraction(
        interaction,
        selectorTestState(partition, 0),
        selectorTestFence,
      ),
      true,
    );
    const recorded = (await state.history(partition, undefined, 1))[0];
    assert.deepEqual(recorded?.context, interaction.context);
    assert.deepEqual(recorded?.toolActivity, interaction.toolActivity);
  } finally {
    await pool.end();
  }
});

test("selector state fencing and audit ordinals survive out-of-order identities", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-selector-ordering",
  );
  const pool = postgresRolePool(selectorServiceRole);
  const state = postgresSelectorState(pool);
  const laterSorting = selectorTestInteraction(
    partition,
    `z-${crypto.randomUUID()}`,
  );
  const earlierSorting = selectorTestInteraction(
    partition,
    `a-${crypto.randomUUID()}`,
  );
  try {
    assert.equal(
      await state.recordInteraction(
        laterSorting,
        selectorTestState(partition, 0),
        selectorTestFence,
      ),
      true,
    );
    assert.equal(
      await state.recordInteraction(
        earlierSorting,
        selectorTestState(partition, 1),
        selectorTestFence,
      ),
      true,
    );
    assert.equal(
      await state.recordInteraction(
        selectorTestInteraction(partition, `stale-${crypto.randomUUID()}`),
        selectorTestState(partition, 1, 99),
        selectorTestFence,
      ),
      false,
    );
    const first = await state.history(partition, undefined, 1);
    const second = await state.history(partition, first[0]?.ordinal, 1);
    assert.equal(first[0]?.decision, laterSorting.decision);
    assert.equal(second[0]?.decision, earlierSorting.decision);
    assert.equal((await state.project(partition))?.notificationCursor, 1);
  } finally {
    await pool.end();
  }
});

test("a database-linearized pause suppresses proposal creation", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-pause-fence",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const controlPool = postgresRolePool(selectorControlRole);
  const state = postgresSelectorState(selectorPool);
  const control = postgresSelectorRuntimeControl(controlPool);
  const initial = await control.settings();
  const paused = await control.pause(initial.revision, selectorAdministrator);
  assert.equal(paused.updated, true);
  const decision = `paused-${crypto.randomUUID()}`;
  try {
    assert.deepEqual(
      await state.record(
        selectorTestProposal(partition, decision),
        selectorTestState(partition, 0),
      ),
      { retained: true, dispatched: [] },
      "the interaction is retained and its trigger drops every delivery row",
    );
    assert.equal((await state.history(partition, undefined, 10)).length, 1);
    assert.deepEqual(await state.pending(10), []);
  } finally {
    const current = await control.settings();
    await control.unpause(current.revision, selectorAdministrator);
    await selectorPool.end();
    await controlPool.end();
  }
});

test("selector controls hot-reload with a revision fence", async () => {
  const pool = postgresRolePool(selectorControlRole);
  const control = postgresSelectorRuntimeControl(pool);
  try {
    const initial = await control.settings();
    const paused = await control.pause(initial.revision, selectorAdministrator);
    assert.equal(paused.updated, true);
    assert.equal(paused.settings.mode, "Paused");

    const stale = await control.updateBasePrompt(
      initial.revision,
      "this update raced with pause",
      selectorAdministrator,
    );
    assert.equal(stale.updated, false);
    assert.equal(stale.settings.revision, paused.settings.revision);

    const prompted = await control.updateBasePrompt(
      paused.settings.revision,
      "prefer tickets that unblock the largest dependency closure",
      selectorAdministrator,
    );
    assert.equal(prompted.updated, true);
    assert.equal(
      prompted.settings.basePrompt,
      "prefer tickets that unblock the largest dependency closure",
    );

    const reviewed = await control.setDispatchMode(
      prompted.settings.revision,
      "ApprovalRequired",
      selectorAdministrator,
    );
    assert.equal(reviewed.updated, true);
    assert.equal(reviewed.settings.dispatchMode, "ApprovalRequired");

    const governed = await control.updatePolicyControls(
      reviewed.settings.revision,
      governedSelectorControls,
      selectorAdministrator,
    );
    assert.equal(governed.updated, true);
    assert.deepEqual(governed.settings.modelAllowlist, ["selector-model"]);

    const history = await control.history(initial.revision - 1, 20);
    const promptedRevision = history.find(
      (revision) => revision.settings.revision === prompted.settings.revision,
    );
    assert.deepEqual(promptedRevision?.administrator, selectorAdministrator);
    assert.equal(
      Number.isFinite(Date.parse(promptedRevision?.recordedAt ?? "")),
      true,
    );
    const restored = await control.rollback(
      governed.settings.revision,
      initial.revision,
      selectorAdministrator,
    );
    assert.equal(restored.updated, true);
    assert.equal(restored.settings.basePrompt, initial.basePrompt);
    assert.equal(restored.settings.dispatchMode, initial.dispatchMode);

    const running = await control.unpause(
      restored.settings.revision,
      selectorAdministrator,
    );
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
    selectorAdministrator,
  );
  assert.equal(approvalSettings.updated, true);
  const decision = `review-${crypto.randomUUID()}`;
  try {
    await state.record(selectorTestProposal(partition, decision), {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
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
      ordinal: feedback[0]?.ordinal,
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
      selectorAdministrator,
    );
    await selectorPool.end();
    await reviewPool.end();
    await pool.end();
  }
});

test("review feedback cursors follow review order rather than proposal order", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-review-order",
  );
  const pool = postgresPool(postgresHarnessUrl());
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const control = postgresSelectorRuntimeControl(pool);
  const original = await control.settings();
  const approval = await control.setDispatchMode(
    original.revision,
    "ApprovalRequired",
    selectorAdministrator,
  );
  assert.equal(approval.updated, true);
  const earlier = `review-earlier-${crypto.randomUUID()}`;
  const later = `review-later-${crypto.randomUUID()}`;
  const reviewer = {
    kind: asAuthorityKind("User"),
    subject: asAuthoritySubject("ordered-reviewer"),
  };
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, earlier),
          selectorTestState(partition, 0),
        ),
      ),
      1,
    );
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, later),
          selectorTestState(partition, 1),
        ),
      ),
      1,
    );
    assert.equal(await reviews.approve(partition, later, reviewer), true);
    const first = await reviews.reviewFeedback(partition, undefined, 1);
    assert.equal(first[0]?.selectorDecision, later);
    assert.equal(await reviews.reject(partition, earlier, reviewer), true);
    const second = await reviews.reviewFeedback(
      partition,
      first[0]?.ordinal,
      1,
    );
    assert.equal(second[0]?.selectorDecision, earlier);
  } finally {
    const current = await control.settings();
    await control.setDispatchMode(
      current.revision,
      original.dispatchMode,
      selectorAdministrator,
    );
    await selectorPool.end();
    await reviewPool.end();
    await pool.end();
  }
});

test("submitted proposal reconciliation claims do not starve later work", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-reconcile-fairness",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const firstDecision = `reconcile-a-${crypto.randomUUID()}`;
  const secondDecision = `reconcile-b-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, firstDecision),
          selectorTestState(partition, 0),
        ),
      ),
      1,
    );
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, secondDecision),
          selectorTestState(partition, 1),
        ),
      ),
      1,
    );
    assert.equal(
      await reviews.approve(
        partition,
        firstDecision,
        selectorAdministrator,
        "reconciliation fairness fixture",
      ),
      true,
    );
    assert.equal(
      await reviews.approve(
        partition,
        secondDecision,
        selectorAdministrator,
        "reconciliation fairness fixture",
      ),
      true,
    );
    await state.submitted(firstDecision, asTicketId(1));
    await state.submitted(secondDecision, asTicketId(1));
    const firstClaim = await state.submittedDeliveries(1);
    const secondClaim = await state.submittedDeliveries(1);
    assert.equal(firstClaim.length, 1);
    assert.equal(secondClaim.length, 1);
    assert.notEqual(firstClaim[0]?.decision, secondClaim[0]?.decision);
  } finally {
    await reviewPool.end();
    await selectorPool.end();
  }
});

test("attempt reconciliation cannot claim another runtime's active attempt", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-active-attempt-isolation",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const state = postgresSelectorState(selectorPool);
  const attempt = `active-${crypto.randomUUID()}`;
  const token = {
    ...partition,
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: 0,
    digest: "b".repeat(64),
  } as const;
  try {
    assert.equal(
      await state.allocateAttempt(attempt, partition, {
        concurrentDecisions: 100,
        selectionsPerMinute: 100_000,
        millisecondsPerDecision: 60_000,
      }),
      true,
    );
    assert.deepEqual(await state.quarantinedAttempts(100), []);
    await state.runningAttempt(
      attempt,
      {
        token,
        candidates: [],
        notificationCursor: 0,
        changes: [],
        operationalContext: selectorInteractionContext.operationalContext,
        handoffNote: {},
        nextCandidateScan: { state: "Exhausted", token },
      },
      { settingsRevision: 1, projectSettingsRevision: 0 },
    );
    assert.deepEqual(await state.quarantinedAttempts(100), []);
    const administration = postgresPool(postgresHarnessUrl());
    await administration.query(
      `UPDATE selector_attempt SET lease_expires_at=now()-interval '1 second'
         WHERE attempt=$1`,
      [attempt],
    );
    await administration.end();
    assert.deepEqual(await state.quarantinedAttempts(100), [attempt]);
  } finally {
    await state
      .terminateAttempt(attempt, "test cleanup")
      .catch(() => undefined);
    await selectorPool.end();
  }
});

test("a selector interaction atomically replaces or clears current planning", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-planning-current",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const state = postgresSelectorState(selectorPool);
  try {
    const planned = `planning-set-${crypto.randomUUID()}`;
    assert.equal(
      await state.recordInteraction(
        selectorTestInteraction(partition, planned),
        selectorTestState(partition, 0),
        selectorTestFence,
        { tickets: [2, 4] },
      ),
      true,
    );
    assert.deepEqual((await state.planningIntent(partition))?.intent, {
      tickets: [2, 4],
    });
    assert.equal(
      await state.recordInteraction(
        selectorTestInteraction(
          partition,
          `planning-clear-${crypto.randomUUID()}`,
        ),
        selectorTestState(partition, 1),
        selectorTestFence,
      ),
      true,
    );
    assert.equal(await state.planningIntent(partition), undefined);
  } finally {
    await selectorPool.end();
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
          $1,$2,$3,'User','subject','v1',$4,$5,ARRAY[]::text[],ARRAY[]::text[],$6,10,100,NULL)`,
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

/**
 * What the delivery relation can hold, said by the relation rather than assumed
 * by its caller: keyed on the decision alone it holds exactly
 * `dispatchesPerDecisionUnstated` rows, which is why that constant is the
 * budget a controls row without one resolves to. Raising the constant past what
 * the relation holds reds the first half here rather than shipping a budget no
 * decision could spend; the rekey on `(decision, ticket)` is what lifts both.
 */
/**
 * The delivery a read answers names its own ticket, taken from the command the
 * row stores — which is the column the rekeying backfills from, so the reader
 * is right before and after it — and the operation is the one derived for that
 * ticket rather than the decision's bare identity.
 */
test("a stored delivery names the ticket its command dispatches", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-delivery-ticket",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const controlPool = postgresRolePool(selectorControlRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const control = postgresSelectorRuntimeControl(controlPool);
  const original = await control.settings();
  const held = await control.setDispatchMode(
    original.revision,
    "ApprovalRequired",
    selectorAdministrator,
  );
  assert.equal(held.updated, true);
  const decision = `ticketed-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [7]),
          selectorTestState(partition, 0),
        ),
      ),
      1,
    );
    assert.deepEqual(
      (await reviews.awaitingApproval(partition, 10)).map((delivery) => [
        delivery.ticket,
        delivery.operation,
      ]),
      [[asTicketId(7), asOperationId(`operation-${decision}-t7`)]],
    );
  } finally {
    const current = await control.settings();
    await control.setDispatchMode(
      current.revision,
      original.dispatchMode,
      selectorAdministrator,
    );
    await selectorPool.end();
    await reviewPool.end();
    await controlPool.end();
  }
});

/**
 * The rekey's first claim: a decision holds one row per ticket. The key refuses
 * a second row for a ticket the decision already dispatches, and `operation`
 * keeps its own uniqueness, which is what lets one operation outcome settle one
 * row.
 */
test("a decision's dispatches are one row each, and neither key admits a second", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-rekeyed");
  const selectorPool = postgresRolePool(selectorServiceRole);
  const state = postgresSelectorState(selectorPool);
  const decision = `pair-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [4, 9]),
          selectorTestState(partition, 0),
        ),
      ),
      2,
    );
    assert.deepEqual(
      (await i5DeliveryRows(decision)).map((row) => row["ticket"]),
      ["4", "9"],
    );
    await assert.rejects(
      () => i5OfferDelivery(partition, decision, 4, `${decision}-again`),
      /selector_proposal_delivery_pkey/,
    );
    await assert.rejects(
      () =>
        i5OfferDelivery(partition, decision, 11, `operation-${decision}-t4`),
      /selector_proposal_delivery_operation_key/,
    );
  } finally {
    await selectorPool.end();
  }
});

/**
 * A decision is written once. The interaction is what a replay conflicts on, so
 * a re-sent decision reaches the relation with rows it already holds and adds
 * none of them — and it says it retained nothing, which a paused installation's
 * empty answer does not.
 */
test("a decision re-sent writes its rows once and none of them twice", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-replayed");
  const selectorPool = postgresRolePool(selectorServiceRole);
  const state = postgresSelectorState(selectorPool);
  const decision = `replayed-${crypto.randomUUID()}`;
  const proposals = () => selectorTestProposal(partition, decision, [5, 6]);
  try {
    assert.deepEqual(
      await state.record(proposals(), selectorTestState(partition, 0)),
      { retained: true, dispatched: [asTicketId(5), asTicketId(6)] },
    );
    assert.deepEqual(
      await state.record(proposals(), selectorTestState(partition, 1)),
      { retained: false, dispatched: [] },
      "the decision was already recorded, so nothing here was lost",
    );
    assert.deepEqual(
      (await i5DeliveryRows(decision)).map((row) => row["ticket"]),
      ["5", "6"],
    );
    assert.equal((await state.history(partition, undefined, 10)).length, 1);
  } finally {
    await selectorPool.end();
  }
});

/** A ticket identifier is one the journal could carry, which starts at one. */
test("a delivery of a ticket no journal could name is refused by the relation", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-ticket-floor",
  );
  const decision = `floor-${crypto.randomUUID()}`;
  const selectorPool = postgresRolePool(selectorServiceRole);
  const state = postgresSelectorState(selectorPool);
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [1]),
          selectorTestState(partition, 0),
        ),
      ),
      1,
    );
    for (const ticket of [0, -1]) {
      await assert.rejects(
        () =>
          i5OfferDelivery(
            partition,
            decision,
            ticket,
            `${decision}-t${String(ticket)}`,
          ),
        /selector_proposal_ticket_is_positive/,
        `ticket ${String(ticket)}`,
      );
    }
  } finally {
    await selectorPool.end();
  }
});

/**
 * A claim names the whole key. Selecting rows by decision alone would charge an
 * attempt to and defer every sibling of the one row that was claimable.
 */
test("a decision's two deliveries are claimed as two rows", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-claim-rows",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const restore = await i5HeldDispatchMode("ApprovalRequired");
  const decision = `claimed-${crypto.randomUUID()}`;
  try {
    await i5Drain((limit) => state.pending(limit));
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [3, 8]),
          selectorTestState(partition, 0),
        ),
      ),
      2,
    );
    assert.equal(
      await reviews.approve(partition, decision, selectorAdministrator),
      true,
    );
    const first = await state.pending(1);
    const second = await state.pending(1);
    assert.deepEqual(
      [first.length, second.length],
      [1, 1],
      "a claim of one takes one row and not one decision",
    );
    assert.deepEqual(
      [...first, ...second].map((delivery) => [
        delivery.decision,
        delivery.ticket,
        delivery.attempts,
      ]),
      [
        [decision, asTicketId(3), 1],
        [decision, asTicketId(8), 1],
      ],
    );
  } finally {
    await restore();
    await reviewPool.end();
    await selectorPool.end();
  }
});

/**
 * Two rows written under one `retry_at` are ordered by the key rather than by
 * where the relation happens to hold them, so a page taken under contention is
 * the same page every runtime would take. The rows are written in descending
 * ticket order for that reason: an order that fell back to the relation's own
 * would agree with the key by accident if they were written ascending.
 */
test("the delivery claim's order is total over the whole key", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-claim-order",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const restore = await i5HeldDispatchMode("ApprovalRequired");
  const decisions = [
    `order-a-${crypto.randomUUID()}`,
    `order-b-${crypto.randomUUID()}`,
  ];
  try {
    await i5Drain((limit) => state.pending(limit));
    let revision = 0;
    for (const decision of decisions) {
      assert.equal(
        await wrote(
          state.record(
            selectorTestProposal(partition, decision, [12, 5]),
            selectorTestState(partition, revision),
          ),
        ),
        2,
      );
      revision += 1;
      assert.equal(
        await reviews.approve(partition, decision, selectorAdministrator),
        true,
      );
    }
    const claimed: [string, number][] = [];
    for (let taken = 0; taken < 4; taken += 1)
      for (const delivery of await state.pending(1))
        claimed.push([delivery.decision, delivery.ticket]);
    assert.deepEqual(
      claimed,
      [...claimed].sort((left, right) =>
        left[0] === right[0] ? left[1] - right[1] : left[0] < right[0] ? -1 : 1,
      ),
    );
    assert.equal(claimed.length, 4);
  } finally {
    await restore();
    await reviewPool.end();
    await selectorPool.end();
  }
});

/**
 * The partial-failure primitive: one of a decision's dispatches settles and the
 * others stand where they were. A settlement that carried only the decision
 * would move every row on one row's answer, which is the whole thing per-ticket
 * rows exist to prevent.
 */
test("one delivery of a decision settles and its sibling is left alone", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-partial");
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const restore = await i5HeldDispatchMode("ApprovalRequired");
  const decision = `partial-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [2, 6]),
          selectorTestState(partition, 0),
        ),
      ),
      2,
    );
    assert.equal(
      await reviews.approve(partition, decision, selectorAdministrator),
      true,
    );
    await state.submitted(decision, asTicketId(2));
    assert.deepEqual(
      (await i5DeliveryRows(decision)).map((row) => [
        row["ticket"],
        row["state"],
      ]),
      [
        ["2", "Submitted"],
        ["6", "Pending"],
      ],
      "a submission moves the row it names and no sibling of it",
    );
    await state.terminal(decision, asTicketId(6), {
      state: "Refused",
      code: "SelectionChanged",
    });
    assert.deepEqual(
      (await i5DeliveryRows(decision)).map((row) => [
        row["ticket"],
        row["state"],
        typeof row["outcome"] === "string"
          ? (JSON.parse(row["outcome"]) as unknown)
          : row["outcome"],
      ]),
      [
        ["2", "Submitted", null],
        ["6", "Terminal", { state: "Refused", code: "SelectionChanged" }],
      ],
    );
  } finally {
    await restore();
    await reviewPool.end();
    await selectorPool.end();
  }
});

/**
 * A review is of the decision. Both arms move every one of its rows and write
 * one review row, because the feedback a reviewer gives is fed back to the lead
 * as one item per decision and a reviewer who wants two of three tickets is
 * telling the lead something a per-row toggle could not carry.
 */
test("approving a decision moves all of its rows and records one review", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-approve-all",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const restore = await i5HeldDispatchMode("ApprovalRequired");
  const decision = `approved-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [9, 5, 1]),
          selectorTestState(partition, 0),
        ),
      ),
      3,
    );
    assert.deepEqual(
      (await reviews.awaitingApproval(partition, 10)).map(
        (delivery) => delivery.ticket,
      ),
      [asTicketId(1), asTicketId(5), asTicketId(9)],
      "a reviewer reads a decision's rows in the order its key gives",
    );
    assert.equal(
      await reviews.approve(
        partition,
        decision,
        selectorAdministrator,
        "all three",
      ),
      true,
    );
    assert.deepEqual(
      (await i5DeliveryRows(decision)).map((row) => row["state"]),
      ["Pending", "Pending", "Pending"],
    );
    assert.deepEqual(
      await harness.query(
        `SELECT count(*)::text AS reviews FROM selector_proposal_review
          WHERE selector_decision=$1`,
        [decision],
      ),
      [{ reviews: "1" }],
    );
  } finally {
    await restore();
    await reviewPool.end();
    await selectorPool.end();
  }
});

/** Rejecting a decision terminates every row of it under the reviewer's one answer. */
test("rejecting a decision terminates all of its rows under one outcome", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-reject-all",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const restore = await i5HeldDispatchMode("ApprovalRequired");
  const decision = `rejected-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [2, 3]),
          selectorTestState(partition, 0),
        ),
      ),
      2,
    );
    assert.equal(
      await reviews.reject(
        partition,
        decision,
        selectorAdministrator,
        "not yet",
      ),
      true,
    );
    assert.deepEqual(
      (await i5DeliveryRows(decision)).map((row) => [
        row["state"],
        typeof row["outcome"] === "string"
          ? (JSON.parse(row["outcome"]) as unknown)
          : row["outcome"],
      ]),
      [
        ["Terminal", { state: "RejectedByUser", feedback: "not yet" }],
        ["Terminal", { state: "RejectedByUser", feedback: "not yet" }],
      ],
    );
  } finally {
    await restore();
    await reviewPool.end();
    await selectorPool.end();
  }
});

/**
 * Every row of a decision is stamped from one settings read, so a decision is
 * never half awaiting a reviewer and half on its way.
 */
test("every row of a decision is stamped from one dispatch mode", async () => {
  const partition = await postgresHarnessProject(harness.store, "i5-stamped");
  const selectorPool = postgresRolePool(selectorServiceRole);
  const state = postgresSelectorState(selectorPool);
  await state.setAutomaticReadiness(true);
  const stamped: Record<string, unknown>[] = [];
  let revision = 0;
  try {
    for (const mode of ["Automatic", "ApprovalRequired"] as const) {
      const restore = await i5HeldDispatchMode(mode);
      const decision = `stamped-${mode}-${crypto.randomUUID()}`;
      try {
        assert.equal(
          await wrote(
            state.record(
              selectorTestProposal(partition, decision, [1, 2]),
              selectorTestState(partition, revision),
            ),
          ),
          2,
        );
        revision += 1;
        stamped.push(...(await i5DeliveryRows(decision)));
      } finally {
        await restore();
      }
    }
    assert.deepEqual(
      stamped.map((row) => row["state"]),
      ["Pending", "Pending", "AwaitingApproval", "AwaitingApproval"],
    );
  } finally {
    await selectorPool.end();
  }
});

/**
 * Every pairing of a project's own dispatch mode with the installation default,
 * and the state each stamps a delivery with. The writer names the opposite mode
 * in every row, so a trigger that stopped stamping would be read here rather
 * than agreed with.
 */
const i5DispatchModePairings: readonly (readonly [
  "Automatic" | "ApprovalRequired" | undefined,
  "Automatic" | "ApprovalRequired",
  "Pending" | "AwaitingApproval",
])[] = [
  ["Automatic", "ApprovalRequired", "Pending"],
  ["ApprovalRequired", "Automatic", "AwaitingApproval"],
  [undefined, "Automatic", "Pending"],
  [undefined, "ApprovalRequired", "AwaitingApproval"],
];

/**
 * Sets one project's whole override set from revision zero, which is where a
 * project this suite made stands. The write is the API role's, as the settings
 * door makes it.
 */
async function i5HeldProjectDispatchMode(
  partition: Partition,
  mode: "Automatic" | "ApprovalRequired",
): Promise<void> {
  const pool = postgresRolePool(apiRole);
  try {
    const written = await postgresSelectorProjectSettings(pool).write(
      partition,
      0,
      { dispatchMode: mode },
      selectorAdministrator,
    );
    assert.equal(written.written, "Settings");
  } finally {
    await pool.end();
  }
}

/**
 * The project's mode is what a delivery is stamped from, and the installation's
 * is what a project without one falls back to. The reverse pairing is the one
 * that costs: a project asking for approval under an automatic installation was
 * delivered without ever being offered to a reviewer.
 */
test("a delivery is stamped from its own project's dispatch mode", async () => {
  const selectorPool = postgresRolePool(selectorServiceRole);
  const state = postgresSelectorState(selectorPool);
  await state.setAutomaticReadiness(true);
  const stamped: (string | undefined)[] = [];
  try {
    for (const [project, installation, expected] of i5DispatchModePairings) {
      const partition = await postgresHarnessProject(
        harness.store,
        `i5-mode-${String(project)}-${installation}`,
      );
      if (project !== undefined)
        await i5HeldProjectDispatchMode(partition, project);
      const restore = await i5HeldDispatchMode(installation);
      const decision = `project-mode-${crypto.randomUUID()}`;
      try {
        assert.equal(
          await wrote(
            state.record(
              {
                ...selectorTestProposal(partition, decision),
                deliveryMode:
                  expected === "Pending" ? "ApprovalRequired" : "Automatic",
              },
              selectorTestState(partition, 0),
            ),
          ),
          1,
        );
        for (const row of await i5DeliveryRows(decision))
          stamped.push(row["state"] as string);
      } finally {
        await restore();
      }
    }
    assert.deepEqual(
      stamped,
      i5DispatchModePairings.map(([, , expected]) => expected),
    );
  } finally {
    await selectorPool.end();
  }
});

/**
 * The durable resolution and the interpreter's are one rule with two
 * enforcers, and nothing but a case keeps them from drifting apart. Each
 * pairing is read from both sides and the answers are required equal.
 */
test("the durable dispatch-mode resolution answers what the interpreter resolves", async () => {
  const selectorPool = postgresRolePool(selectorServiceRole);
  const apiPool = postgresRolePool(apiRole);
  const state = postgresSelectorState(selectorPool);
  await state.setAutomaticReadiness(true);
  const durable: (string | undefined)[] = [];
  const resolved: string[] = [];
  try {
    for (const [project, installation] of i5DispatchModePairings) {
      const partition = await postgresHarnessProject(
        harness.store,
        `i5-resolve-${String(project)}-${installation}`,
      );
      if (project !== undefined)
        await i5HeldProjectDispatchMode(partition, project);
      const restore = await i5HeldDispatchMode(installation);
      try {
        for (const row of await harness.query(
          `SELECT ${selectorProjectDispatchModeFunction}($1,$2) AS mode`,
          [partition.tenant, partition.project],
        ))
          durable.push(row["mode"] as string);
        resolved.push(
          (await postgresSelectorProjectSettings(apiPool).read(partition))
            .effective.dispatchMode,
        );
      } finally {
        await restore();
      }
    }
    assert.deepEqual(durable, resolved);
    assert.deepEqual(
      resolved,
      i5DispatchModePairings.map(
        ([project, installation]) => project ?? installation,
      ),
    );
  } finally {
    await apiPool.end();
    await selectorPool.end();
  }
});

/**
 * The resolution is a definer like every other here: owned, `search_path`
 * pinned and revoked from the world. It is granted to no role of its own,
 * because its only caller is the trigger and that runs as the owner.
 */
test("the dispatch-mode resolution is owned, pinned and world-revoked", async () => {
  const identity = `${selectorProjectDispatchModeFunction}(text,text)`;
  assert.deepEqual(
    await harness.query(
      `SELECT prosecdef AS definer,pg_get_userbyid(proowner) AS owner,
              array_to_string(proconfig,',') AS settings,
              EXISTS(SELECT 1 FROM aclexplode(proacl) entry
                      WHERE entry.grantee=0) AS world
         FROM pg_proc WHERE oid=$1::regprocedure`,
      [identity],
    ),
    [
      {
        definer: true,
        owner: boundaryOwnerRole,
        settings: "search_path=pg_catalog, public, pg_temp",
        world: false,
      },
    ],
  );
  for (const role of i5SelectorRoles)
    assert.deepEqual(
      await harness.query(
        `SELECT has_function_privilege($1,$2::regprocedure,'EXECUTE') AS held`,
        [role, identity],
      ),
      [{ held: false }],
      `${identity} to ${role}`,
    );
});

/** A paused installation refuses each of a decision's rows, not merely its first. */
test("a paused installation admits none of a decision's deliveries", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-paused-multi",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const controlPool = postgresRolePool(selectorControlRole);
  const state = postgresSelectorState(selectorPool);
  const control = postgresSelectorRuntimeControl(controlPool);
  const initial = await control.settings();
  const paused = await control.pause(initial.revision, selectorAdministrator);
  assert.equal(paused.updated, true);
  const decision = `paused-multi-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [1, 2, 3]),
          selectorTestState(partition, 0),
        ),
      ),
      0,
    );
    assert.deepEqual(await i5DeliveryRows(decision), []);
    assert.equal((await state.history(partition, undefined, 10)).length, 1);
  } finally {
    const current = await control.settings();
    await control.unpause(current.revision, selectorAdministrator);
    await selectorPool.end();
    await controlPool.end();
  }
});

/**
 * The row's key and the command it stores name one ticket between them. A row
 * where they disagree is not read as either: submitting it under the command's
 * ticket would settle the row keyed by that ticket, which is a sibling of the
 * row the value came from.
 */
test("a delivery keyed by a ticket its command does not dispatch is unreadable", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-key-payload",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const restore = await i5HeldDispatchMode("ApprovalRequired");
  const decision = `disagreeing-${crypto.randomUUID()}`;
  try {
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [5]),
          selectorTestState(partition, 0),
        ),
      ),
      1,
    );
    await harness.query(
      `UPDATE selector_proposal_delivery SET ticket=6
        WHERE selector_decision=$1`,
      [decision],
    );
    await assert.rejects(
      () => reviews.awaitingApproval(partition, 10),
      /keyed by a ticket its command does not dispatch/,
    );
  } finally {
    await restore();
    await reviewPool.end();
    await selectorPool.end();
  }
});

/**
 * Every definer this slice dropped and re-created, with the roles it answers
 * to: a drop takes the owner, the `search_path` pin, the revoke and the grants
 * with it, and a re-create that loses one of them is world-executable or is
 * resolved under the caller's path. The pin is the arm no functional case can
 * find, because an unpinned definer answers an ordinary caller exactly as a
 * pinned one does and differs only for one that has shadowed a relation in
 * `pg_temp`.
 */
const i5SliceDefiners: readonly (readonly [
  string,
  string,
  readonly string[],
])[] = [
  [selectorClaimFunction, "integer", [selectorServiceRole]],
  [selectorReconcileClaimFunction, "integer", [selectorServiceRole]],
  [selectorDeliveryFunction, "text,bigint,text,text", [selectorServiceRole]],
  [
    selectorProjectSettingsFunction,
    "text,text,bigint,text,text,text,text,text,text,bigint,bigint,bigint,bigint,bigint,bigint,bigint,text,text",
    [apiRole, selectorControlRole],
  ],
  [
    selectorInteractionsReadFunction,
    interactionsReadSignature,
    [apiRole, selectorServiceRole],
  ],
];

const i5SelectorRoles = [
  apiRole,
  selectorServiceRole,
  selectorControlRole,
  selectorReviewRole,
  ticketServiceRole,
];

test("each definer this slice re-created is owned, pinned, world-revoked and granted where it was", async () => {
  for (const [name, signature, granted] of i5SliceDefiners) {
    const identity = `${name}(${signature})`;
    assert.deepEqual(
      await harness.query(
        `SELECT prosecdef AS definer,pg_get_userbyid(proowner) AS owner,
                array_to_string(proconfig,',') AS settings,
                EXISTS(SELECT 1 FROM aclexplode(proacl) entry
                        WHERE entry.grantee=0) AS world
           FROM pg_proc WHERE oid=$1::regprocedure`,
        [identity],
      ),
      [
        {
          definer: true,
          owner: boundaryOwnerRole,
          settings: "search_path=pg_catalog, public, pg_temp",
          world: false,
        },
      ],
      identity,
    );
    for (const role of i5SelectorRoles)
      assert.deepEqual(
        await harness.query(
          `SELECT has_function_privilege($1,$2::regprocedure,'EXECUTE') AS held`,
          [role, identity],
        ),
        [{ held: granted.includes(role) }],
        `${identity} to ${role}`,
      );
  }
});

/**
 * The reconciliation claim names the whole key too, and orders by it: a
 * decision with two submitted rows has two operation outcomes to read, and one
 * of them settles one row. The two are given one `reconcile_at` so the order
 * has to fall through to the key, and written descending so an order that read
 * the relation's own would disagree with it.
 */
test("a decision's submitted deliveries are reconciled one row at a time", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-reconcile-key",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const restore = await i5HeldDispatchMode("ApprovalRequired");
  const decision = `reconciled-${crypto.randomUUID()}`;
  try {
    await i5Drain((limit) => state.submittedDeliveries(limit));
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [40, 30, 20, 10]),
          selectorTestState(partition, 0),
        ),
      ),
      4,
    );
    assert.equal(
      await reviews.approve(partition, decision, selectorAdministrator),
      true,
    );
    for (const ticket of [40, 30, 20, 10])
      await state.submitted(decision, asTicketId(ticket));
    await harness.query(
      `UPDATE selector_proposal_delivery SET reconcile_at=now()
        WHERE selector_decision=$1`,
      [decision],
    );
    const claimed: [number, number][] = [];
    for (let taken = 0; taken < 4; taken += 1) {
      const page = await state.submittedDeliveries(1);
      assert.equal(page.length, 1, "a claim of one takes one row");
      for (const delivery of page)
        claimed.push([delivery.ticket, delivery.attempts]);
    }
    assert.deepEqual(claimed, [
      [asTicketId(10), 1],
      [asTicketId(20), 1],
      [asTicketId(30), 1],
      [asTicketId(40), 1],
    ]);
  } finally {
    await restore();
    await reviewPool.end();
    await selectorPool.end();
  }
});

/**
 * How long a rival claimer waits before waiting is the answer. It is well
 * under the pool's own statement timeout, so a claim that blocks fails the
 * case as a claim that blocked rather than as a suite that hung.
 */
const i5RivalClaimTimeout = "2s";

/**
 * Two claimers of one relation, the first still holding what it took: a claim
 * hands out disjoint pages, so the rival comes away with a row the holder did
 * not take. A claim that held its rows without skipping the held ones would
 * leave the rival waiting on the holder's transaction — with claimable rows
 * sitting beside the one it waited on — until its statement timeout answered
 * for it.
 */
async function i5RivalClaims(
  claim: string,
): Promise<readonly (readonly string[])[]> {
  const pool = postgresRolePool(selectorServiceRole);
  const holder = await pool.connect();
  const rival = await pool.connect();
  const taken = async (client: pg.PoolClient): Promise<readonly string[]> =>
    (
      await client.query<{ ticket: string }>(
        `SELECT ticket::text AS ticket FROM ${claim}(1)`,
      )
    ).rows.map((row) => row.ticket);
  try {
    await holder.query("BEGIN");
    const held = await taken(holder);
    await rival.query("BEGIN");
    await rival.query(`SET LOCAL statement_timeout='${i5RivalClaimTimeout}'`);
    const beside = await taken(rival);
    await rival.query("ROLLBACK");
    await holder.query("ROLLBACK");
    return [held, beside];
  } finally {
    holder.release(true);
    rival.release(true);
    await pool.end();
  }
}

test("a second claimer of a decision's deliveries takes the row the first did not", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-claim-rival",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const restore = await i5HeldDispatchMode("ApprovalRequired");
  const decision = `rival-claim-${crypto.randomUUID()}`;
  try {
    await i5Drain((limit) => state.pending(limit));
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [6, 7]),
          selectorTestState(partition, 0),
        ),
      ),
      2,
    );
    assert.equal(
      await reviews.approve(partition, decision, selectorAdministrator),
      true,
    );
    assert.deepEqual(await i5RivalClaims(selectorClaimFunction), [
      ["6"],
      ["7"],
    ]);
  } finally {
    await restore();
    await reviewPool.end();
    await selectorPool.end();
  }
});

test("a second claimer of a decision's reconciliations takes the row the first did not", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "i5-reconcile-rival",
  );
  const selectorPool = postgresRolePool(selectorServiceRole);
  const reviewPool = postgresRolePool(selectorReviewRole);
  const state = postgresSelectorState(selectorPool);
  const reviews = postgresSelectorProposalReviews(reviewPool);
  const restore = await i5HeldDispatchMode("ApprovalRequired");
  const decision = `rival-reconcile-${crypto.randomUUID()}`;
  try {
    await i5Drain((limit) => state.submittedDeliveries(limit));
    assert.equal(
      await wrote(
        state.record(
          selectorTestProposal(partition, decision, [6, 7]),
          selectorTestState(partition, 0),
        ),
      ),
      2,
    );
    assert.equal(
      await reviews.approve(partition, decision, selectorAdministrator),
      true,
    );
    for (const ticket of [6, 7])
      await state.submitted(decision, asTicketId(ticket));
    await harness.query(
      `UPDATE selector_proposal_delivery SET reconcile_at=now()
        WHERE selector_decision=$1`,
      [decision],
    );
    assert.deepEqual(await i5RivalClaims(selectorReconcileClaimFunction), [
      ["6"],
      ["7"],
    ]);
  } finally {
    await restore();
    await reviewPool.end();
    await selectorPool.end();
  }
});
