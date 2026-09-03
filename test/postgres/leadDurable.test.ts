/**
 * The lead's mailbox door and the reads over it, against a real server: what
 * the selector may offer, read and withdraw, what a withdrawn turn does to the
 * pod holding it, and what the API sees of a lead and its decisions.
 *
 * THE POD IS DRIVEN THROUGH THE WORKER PLANE'S OWN ROLE. A withdrawal is only
 * a proof if the answer that follows it is refused at the door the pod
 * actually uses, so the cases here claim and answer through the session plane
 * rather than by writing the turn row.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import {
  leadTurnsAnsweredMax,
  agenticRefusalReasonCharsMax,
  agenticRefusalsAnsweredMax,
  dispatchViewPageLimitMax,
  leadObservedCandidateCharsMax,
  leadObservationFixedCharsMax,
  leadObservedChangeCharsMax,
  artifactDigestChars,
  configurationCanonicalCharsMax,
  leadObservedCandidateFixedCharsMax,
  nativeHttpDraftDependenciesMax,
  nativeHttpDraftStagesMax,
  repositoryConfigurationNameCharsMax,
  leadSeededDecisionCharsMax,
  leadSeedingDecisionsMax,
  nativeHttpPathSegmentCharsMax,
  nativeHttpPathSegmentCharsMax as partitionIdentityCharsMax,
  notificationPageLimitMax,
  projectChangeResourceCharsMax,
  selectorHandoffNoteBytesMax,
  sessionSystemPromptCharsMax,
  sessionTurnInputCharsMax,
  selectorHistoryLimitMax,
  sessionStorePageBatchesMax,
  sessionStoreStreamsAnswered,
  sessionTurnModelCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "../../src/contract/http.ts";
import {
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
  sessionIdentityCharsMax,
  type SessionId,
  type SessionStoreStream,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  projectChangeDataSchemas,
  sessionChangeResourceSchema,
} from "../../src/contract/events.ts";
import {
  evaluationCombinators,
  finalizers,
  resumePricings,
} from "../../src/contract/rosters.ts";
import { postgresProjectChangeLog } from "../../src/adapters/postgres/projectChangeLog.ts";
import type { ProjectChangeLog } from "../../src/interpreter/projectStream.ts";
import {
  selectorControlRole,
  selectorServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { SelectorDecisionProposals } from "../../src/interpreter/selector.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import {
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "../../src/adapters/postgres/selector.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";
import { selectorDecisionSummary } from "../../src/interpreter/selectorHistory.ts";
import { postgresHarnessSelectorContext } from "./harness.ts";
import { leadRigDecision, leadRigOpen, leadRigProject } from "./leadHarness.ts";
import type { LeadRig } from "./leadHarness.ts";
import {
  sessionRigAttempt,
  sessionRigSession,
  sessionRigTurn,
  sessionRigTurnId,
  sessionRigTurnState,
} from "./sessionHarness.ts";

let rig: LeadRig;
before(async () => {
  rig = await leadRigOpen();
});
after(async () => {
  await rig.close();
});

/** What one turn's observation says when the case is not about the document. */
const anObservation = '{"version":1}';

/** A lead session and the project holding it, which most cases open together. */
async function leadProject(
  label: string,
): Promise<{ partition: Partition; session: SessionId }> {
  const partition = await leadRigProject(rig, label);
  const session = await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
  });
  return { partition, session };
}

/** One live attempt, which is what a pod holds when it claims a turn. */
function leadPod(partition: Partition, session: SessionId, label: string) {
  return sessionRigAttempt(rig.sessions, partition, session, label);
}

test("the mailbox answers the project's lead and nothing else", async () => {
  const { partition, session } = await leadProject("standing");
  const standing = await rig.mailbox.lead(partition);
  assert.equal(standing?.session, session);
  assert.equal(standing?.state, "Open");
  assert.equal(
    standing?.agentReference,
    undefined,
    "a session that has taken no turn has bound no runtime session",
  );

  const bare = await leadRigProject(rig, "standing-none");
  assert.equal(await rig.mailbox.lead(bare), undefined);
});

test("a project whose only session is a thread has no lead to offer a turn to", async () => {
  const partition = await leadRigProject(rig, "thread-only");
  await sessionRigSession(rig.sessions, partition, "thread-only", {
    kind: "Thread",
    principal: "member-thread-only",
  });
  assert.equal(await rig.mailbox.lead(partition), undefined);
  assert.deepEqual(
    await rig.mailbox.offer({
      partition,
      turn: sessionRigTurnId("thread-only"),
      input: anObservation,
    }),
    { offered: "NoLead" },
    "the selector may reach one session per project and a thread is not it",
  );
});

test("one decision offers one turn however often it is retried", async () => {
  const { partition, session } = await leadProject("idempotent");
  const turn = sessionRigTurnId("idempotent");
  const first = await rig.mailbox.offer({
    partition,
    turn,
    input: anObservation,
  });
  assert.equal(first.offered, "Enqueued");
  const again = await rig.mailbox.offer({
    partition,
    turn,
    input: anObservation,
  });
  assert.deepEqual(again, {
    offered: "AlreadyEnqueued",
    ordinal: first.offered === "Enqueued" ? first.ordinal : 0,
  });

  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT input_kind FROM session_turn
        WHERE tenant=$1 AND project=$2 AND session=$3`,
      [partition.tenant, partition.project, session],
    ),
    [{ input_kind: "Observation" }],
    "the door writes one input kind, so the selector cannot spell a thread's",
  );
});

test("a closed lead takes no more turns", async () => {
  const { partition, session } = await leadProject("closed");
  assert.equal(await rig.sessions.sessions.close(partition, session), true);
  assert.deepEqual(
    await rig.mailbox.offer({
      partition,
      turn: sessionRigTurnId("closed"),
      input: anObservation,
    }),
    { offered: "Closed" },
  );
});

test("an answered turn reports what the pod measured of it", async () => {
  const { partition, session } = await leadProject("measured");
  const turn = sessionRigTurnId("measured");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "measured");
  const claimed = await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.equal(claimed?.turn, turn);
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: '{"version":1,"dispatches":[]}',
      measured: {
        model: "claude-model",
        tokens: 41_234,
        costMicros: 182_000,
        durationMs: 74_210,
        tools: ["Read", "Grep"],
      },
    }),
    "Answered",
  );

  assert.deepEqual(await rig.mailbox.turn(turn), {
    state: "Answered",
    result: '{"version":1,"dispatches":[]}',
    measured: {
      model: "claude-model",
      tokens: 41_234,
      costMicros: 182_000,
      durationMs: 74_210,
      tools: ["Read", "Grep"],
    },
  });
});

test("a turn answered without a measurement carries none", async () => {
  const { partition, session } = await leadProject("unmeasured");
  const turn = sessionRigTurnId("unmeasured");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "unmeasured");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: "{}",
    }),
    "Answered",
  );
  const standing = await rig.mailbox.turn(turn);
  assert.equal(standing?.state, "Answered");
  assert.equal(
    standing?.measured,
    undefined,
    "a turn with no measurement is a decision with no provenance",
  );
});

test("a half-written measurement is refused by the constraint", async () => {
  const { partition, session } = await leadProject("half-measured");
  const turn = sessionRigTurnId("half-measured");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "half-measured");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  await assert.rejects(
    rig.sessions.harness.query(
      `SELECT answer_session_turn($1,$2,$3,$4,NULL,NULL,$5,$6,NULL,$7,$8)`,
      [
        attempt.digest,
        attempt.attempt.generation,
        turn,
        "{}",
        "claude-model",
        1,
        1,
        ["Read"],
      ],
    ),
    /session_turn_measure_is_whole/u,
  );
});

test("more tool names than a turn may report is refused by the constraint", async () => {
  const { partition, session } = await leadProject("tool-bound");
  const turn = sessionRigTurnId("tool-bound");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "tool-bound");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  await assert.rejects(
    rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: "{}",
      measured: {
        model: "claude-model",
        tokens: 1,
        costMicros: 1,
        durationMs: 1,
        tools: Array.from(
          { length: sessionTurnToolsMax + 1 },
          (_unused, index) => `tool-${String(index)}`,
        ),
      },
    }),
    /session_turn_measure_is_bounded/u,
  );
});

test("a withdrawn turn is abandoned and the pod holding it is refused", async () => {
  const { partition, session } = await leadProject("withdraw");
  const turn = sessionRigTurnId("withdraw");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "withdraw");
  assert.equal(
    (
      await rig.sessions.plane.claim({
        secret: attempt.secret,
        generation: attempt.attempt.generation,
      })
    )?.turn,
    turn,
  );

  assert.equal(await rig.mailbox.withdraw(turn), "Withdrawn");
  assert.deepEqual(
    await sessionRigTurnState(rig.sessions, partition, session, turn),
    {
      state: "Abandoned",
      attempt: null,
      claim_generation: null,
      attempts_spent: "0",
      result: null,
      failure: "TurnWithdrawn",
      batch_first: null,
      batch_last: null,
    },
  );
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: "{}",
    }),
    "Conflict",
    "a withdrawn turn can never be answered, which is what makes it a proof",
  );
  assert.equal(await rig.mailbox.withdraw(turn), "AlreadyEnded");
  assert.equal(
    await rig.mailbox.withdraw(sessionRigTurnId("never-offered")),
    "NoTurn",
  );
});

test("the API reads the lead, its mailbox tail and the streams beneath it", async () => {
  const { partition, session } = await leadProject("api-read");
  const turn = sessionRigTurnId("api-read");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "api-read");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  assert.equal(
    await rig.sessions.plane.record({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream,
      batch: 1,
      digest: "b".repeat(64),
      bytes: 12,
      events: 2,
    }),
    "Stored",
  );
  await rig.sessions.plane.answer({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    turn,
    result: "{}",
    batchFirst: 1,
    batchLast: 1,
    measured: {
      model: "claude-model",
      tokens: 10,
      costMicros: 20,
      durationMs: 30,
      tools: [],
    },
  });

  const lead = await rig.apiLead.standing(partition, leadTurnsAnsweredMax);
  assert.equal(lead?.session, session);
  assert.equal(lead?.state, "Open");
  assert.equal(lead?.attention, "Monitoring");
  assert.deepEqual(lead?.handoffNote, {});
  assert.deepEqual(
    lead?.turns.map((each) => [each.turn, each.state, each.inputKind]),
    [[turn, "Answered", "Observation"]],
  );
  assert.deepEqual(lead?.turns[0]?.measured, {
    model: "claude-model",
    tokens: 10,
    costMicros: 20,
    durationMs: 30,
    tools: [],
  });
  assert.equal(lead?.turns[0]?.batchFirst, 1);

  assert.deepEqual(
    await rig.apiLead.streams(partition, session, sessionStoreStreamsAnswered),
    [{ stream, batches: 1 }],
  );
  assert.deepEqual(
    await rig.apiLead.batches({
      partition,
      session,
      stream,
      after: 0,
      limit: sessionStorePageBatchesMax,
    }),
    [{ batch: 1, digest: "b".repeat(64), bytes: 12 }],
  );
});

test("a lead that has taken no turn still reads", async () => {
  const { partition, session } = await leadProject("api-read-empty");
  const lead = await rig.apiLead.standing(partition, leadTurnsAnsweredMax);
  assert.equal(lead?.session, session);
  assert.deepEqual(lead?.turns, []);
  assert.equal(lead?.notificationCursor, 0);
});

test("the API reads the decision log and the intent one decision left", async () => {
  const partition = await leadRigProject(rig, "api-history");
  const first = await leadRigDecision(rig, partition, "api-history-one", {
    notificationCursor: 5,
  });
  const second = await leadRigDecision(rig, partition, "api-history-two", {
    notificationCursor: 9,
  });

  const page = await rig.apiLead.history(partition, {
    limit: selectorHistoryLimitMax,
    order: "oldest",
  });
  assert.deepEqual(
    page.map((decision) => decision.decision),
    [first, second],
  );
  assert.deepEqual(page[0]?.observedView, []);
  assert.deepEqual(page[0]?.context.handoffNote, {});
  assert.equal(page[0]?.instructions, "choose a dispatchable ticket");
  assert.equal(page[0]?.modelRevision, "model-1");

  const after = await rig.apiLead.history(partition, {
    ...(page[0] === undefined ? {} : { after: page[0].ordinal }),
    limit: selectorHistoryLimitMax,
    order: "oldest",
  });
  assert.deepEqual(
    after.map((decision) => decision.decision),
    [second],
  );
  assert.equal(await rig.apiLead.planningIntent(partition), undefined);
});

/** One decision's dispatch of a ticket, fenced on the version the case gives it. */
function landingProposal(
  partition: Partition,
  decision: string,
  tickets: readonly number[],
  deliveryMode: SelectorDecisionProposals["deliveryMode"] = "Automatic",
): SelectorDecisionProposals {
  return {
    interaction: {
      decision,
      partition,
      instructionsVersion: "1.0",
      instructions: "choose a dispatchable ticket",
      observedView: [],
      context: {
        operationalContext: postgresHarnessSelectorContext,
        handoffNote: {},
      },
      toolActivity: [],
      result: { dispatches: tickets.map((ticket) => ({ ticket })) },
      implementationRevision: "implementation-1",
      modelRevision: "model-1",
      policyRevision: "policy-1",
      accounting: { tokens: 1, durationMs: 1 },
      startedAt: "2026-09-03T12:00:00.000Z",
      completedAt: "2026-09-03T12:00:01.000Z",
    },
    fence: { settingsRevision: 1, projectSettingsRevision: 0 },
    deliveryMode,
    dispatches: tickets.map((ticket) => ({
      ticket: asTicketId(ticket),
      operation: asOperationId(`${decision}-t${String(ticket)}`),
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

/** The installation's dispatch mode, held for one case and put back after it. */
async function leadRigHeldDispatchMode(
  mode: "Automatic" | "ApprovalRequired",
): Promise<() => Promise<void>> {
  const pool = postgresHarnessRolePool(selectorControlRole);
  const control = postgresSelectorRuntimeControl(pool);
  const administrator = {
    kind: asAuthorityKind("Administrator"),
    subject: asAuthoritySubject("landings"),
  };
  const original = await control.settings();
  assert.equal(
    (await control.setDispatchMode(original.revision, mode, administrator))
      .updated,
    true,
  );
  return async () => {
    const current = await control.settings();
    await control.setDispatchMode(
      current.revision,
      original.dispatchMode,
      administrator,
    );
    await pool.end();
  };
}

/**
 * The log says which of a decision's dispatches landed, because the record it
 * is read from is the delivery relation and not the retained result. A decision
 * that dispatched nothing answers an empty list, which is what a pre-slice-6
 * row with no delivery row of its own also answers.
 */
test("the decision log answers each dispatch's landing under one decision", async () => {
  const partition = await leadRigProject(rig, "api-landings");
  const quiet = await leadRigDecision(rig, partition, "api-landings-quiet", {
    notificationCursor: 3,
  });
  const decision = `selector-decision-api-landings-${randomUUID()}`;
  const state = postgresSelectorState(rig.selectorPool);
  await state.setAutomaticReadiness(true);
  const restore = await leadRigHeldDispatchMode("Automatic");
  try {
    const written = await state.record(
      landingProposal(partition, decision, [41, 42, 43]),
      {
        partition,
        notificationCursor: 7,
        revision: (await state.project(partition))?.revision ?? 0,
        attention: "Monitoring",
        handoffNote: {},
      },
    );
    assert.deepEqual(written.dispatched.map(Number), [41, 42, 43]);
    await state.submitted(decision, asTicketId(42));
    await state.submitted(decision, asTicketId(43));
    await state.terminal(decision, asTicketId(43), {
      state: "Refused",
      code: "SelectionChanged",
    });
  } finally {
    await restore();
  }

  const drawn = (
    await rig.apiLead.history(partition, {
      limit: selectorHistoryLimitMax,
      order: "oldest",
    })
  ).map(selectorDecisionSummary);
  assert.deepEqual(
    drawn.map((summary) => [summary.decision, summary.dispatches]),
    [
      [quiet, []],
      [
        decision,
        [
          { ticket: 41, state: "Pending" },
          { ticket: 42, state: "Submitted" },
          { ticket: 43, state: "Terminal", outcome: "SelectionChanged" },
        ],
      ],
    ],
  );
  assert.deepEqual(
    (await state.history(partition, undefined, selectorHistoryLimitMax))
      .map(selectorDecisionSummary)
      .map((summary) => summary.dispatches.length),
    [0, 3],
    "the selector's own read of the log carries the same landings",
  );
});

/**
 * `AwaitingApproval` is a landing like the other three, and the only one no
 * reviewer has to act for it to be reached: under an `ApprovalRequired`
 * installation the trigger stamps every row of every decision with it. A log
 * that drew nothing there would say a decision dispatched nothing in the one
 * installation where every fresh decision is held — to the console, and to the
 * lead's own decision-log tool, which would then re-dispatch a ticket it is
 * already queued for.
 */
test("a dispatch a reviewer has not released is a landing the log draws", async () => {
  const partition = await leadRigProject(rig, "api-landings-held");
  const decision = `selector-decision-api-held-${randomUUID()}`;
  const state = postgresSelectorState(rig.selectorPool);
  await state.setAutomaticReadiness(true);
  const restore = await leadRigHeldDispatchMode("ApprovalRequired");
  try {
    assert.deepEqual(
      (
        await state.record(
          landingProposal(partition, decision, [41, 42], "ApprovalRequired"),
          {
            partition,
            notificationCursor: 7,
            revision: (await state.project(partition))?.revision ?? 0,
            attention: "Monitoring",
            handoffNote: {},
          },
        )
      ).dispatched.map(Number),
      [41, 42],
    );
  } finally {
    await restore();
  }

  const held = [
    { ticket: 41, state: "AwaitingApproval" },
    { ticket: 42, state: "AwaitingApproval" },
  ];
  assert.deepEqual(
    (
      await rig.apiLead.history(partition, {
        limit: selectorHistoryLimitMax,
        order: "oldest",
      })
    )
      .map(selectorDecisionSummary)
      .map((summary) => [summary.decision, summary.dispatches]),
    [[decision, held]],
  );
  assert.deepEqual(
    (await state.history(partition, undefined, selectorHistoryLimitMax))
      .map(selectorDecisionSummary)
      .map((summary) => summary.dispatches),
    [held],
    "the selector's own read of the log holds them too",
  );
});

test("the API reassembles a decision whose resources outgrew one audit column", async () => {
  const partition = await leadRigProject(rig, "api-history-chunked");
  const evidence = "e".repeat(180_000);
  const decision = await leadRigDecision(
    rig,
    partition,
    "api-history-chunked",
    {
      handoffNote: { evidence },
      toolActivity: [{ evidence }],
      planningIntent: { next: "wait for the importer" },
    },
  );

  const page = await rig.apiLead.history(partition, {
    limit: selectorHistoryLimitMax,
    order: "oldest",
  });
  assert.deepEqual(
    page.map((each) => each.decision),
    [decision],
  );
  assert.deepEqual(page[0]?.context.handoffNote, { evidence });
  assert.deepEqual(page[0]?.toolActivity, [{ evidence }]);
  const intent = await rig.apiLead.planningIntent(partition);
  assert.equal(intent?.selectorDecision, decision);
  assert.deepEqual(intent?.intent, { next: "wait for the importer" });
});

test("a pod cannot name the withdrawal as its own failure", async () => {
  const { partition, session } = await leadProject("forged-withdrawal");
  const turn = sessionRigTurnId("forged-withdrawal");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "forged-withdrawal");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.equal(
    await rig.sessions.plane.fail({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      failure: "TurnWithdrawn",
    }),
    "Conflict",
    "a withdrawal is the platform moving a turn out, and its proof is not a pod's to mint",
  );
  assert.equal(
    await rig.sessions.plane.fail({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      failure: "AgentFailed",
    }),
    "Failed",
    "every failure a pod is about is still its own to name",
  );
});

test("a restarted process withdraws a turn it holds no partition for", async () => {
  const { partition, session } = await leadProject("restart");
  const turn = sessionRigTurnId("restart");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "restart");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });

  const restarted = postgresHarnessRolePool(selectorServiceRole);
  try {
    assert.equal(
      (
        await restarted.query<{ withdrawn: string }>(
          "SELECT withdraw_lead_turn($1)::text AS withdrawn",
          [turn],
        )
      ).rows[0]?.withdrawn,
      "Withdrawn",
      "reconciliation holds the decision reference and no partition beside it",
    );
  } finally {
    await restarted.end();
  }
  assert.equal((await rig.mailbox.turn(turn))?.failure, "TurnWithdrawn");
});

test("the seeding read answers the newest decisions first", async () => {
  const partition = await leadRigProject(rig, "api-tail");
  const decisions = [];
  for (const label of ["one", "two", "three"])
    decisions.push(
      await leadRigDecision(rig, partition, `api-tail-${label}`, {
        notificationCursor: decisions.length,
      }),
    );

  assert.deepEqual(
    (await rig.apiLead.tail(partition, 2)).map((each) => each.decision),
    [decisions[2], decisions[1]],
    "a fresh lead is seeded with the last decisions, not the first",
  );
  assert.deepEqual(
    (
      await rig.apiLead.history(partition, {
        limit: selectorHistoryLimitMax,
        order: "oldest",
      })
    ).map((each) => each.decision),
    decisions,
  );
});

/**
 * One claimed pod and one batch recorded beneath it, with the log's sequence
 * read immediately before the record so a case sees only what the record made.
 */
async function recordedBatch(
  partition: Partition,
  session: SessionId,
  label: string,
  log: ProjectChangeLog,
): Promise<{
  readonly attempt: Awaited<ReturnType<typeof leadPod>>;
  readonly stream: SessionStoreStream;
  readonly before: number;
}> {
  const attempt = await leadPod(partition, session, label);
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  const before = await log.latest();
  assert.equal(
    await rig.sessions.plane.record({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream,
      batch: 1,
      digest: "c".repeat(64),
      bytes: 4,
      events: 1,
    }),
    "Stored",
  );
  return { attempt, stream, before };
}

test("a turn answer and a batch record each append one session change", async () => {
  const { partition, session } = await leadProject("session-change");
  const log = postgresProjectChangeLog(rig.sessions.harness.pool);
  const turn = sessionRigTurnId("session-change");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const {
    attempt,
    stream,
    before: beforeBatch,
  } = await recordedBatch(partition, session, "session-change", log);
  assert.deepEqual(
    (await log.after(partition, beforeBatch, 10)).map((row) => [
      row.kind,
      JSON.parse(row.resource) as unknown,
    ]),
    [["Session", { session, kind: "Lead", stream, batch: 1 }]],
    "one batch is one session change naming the stream and batch that moved",
  );

  const beforeAnswer = await log.latest();
  await rig.sessions.plane.answer({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    turn,
    result: "{}",
  });
  assert.deepEqual(
    (await log.after(partition, beforeAnswer, 10)).map((row) => [
      row.kind,
      JSON.parse(row.resource) as unknown,
    ]),
    [["Session", { session, kind: "Lead", turn }]],
    "one state move is one session change naming the turn that moved",
  );
});

test("a thread's session changes are keyed to its own session", async () => {
  const partition = await leadRigProject(rig, "thread-change");
  const thread = await sessionRigSession(
    rig.sessions,
    partition,
    "thread-change",
    { kind: "Thread", principal: "member-thread-change" },
  );
  const log = postgresProjectChangeLog(rig.sessions.harness.pool);
  const before = await log.latest();
  const turn = await sessionRigTurn(
    rig.sessions,
    partition,
    thread,
    "thread-change",
  );
  assert.deepEqual(
    (await log.after(partition, before, 10)).map((row) => [
      row.kind,
      JSON.parse(row.resource) as unknown,
    ]),
    [["Session", { session: thread, kind: "Thread", turn }]],
    "a console filters a session's own changes on the session it names first",
  );
});

test("neither mailbox door reaches a turn that is not a lead's", async () => {
  const partition = await leadRigProject(rig, "thread-fence");
  const thread = await sessionRigSession(
    rig.sessions,
    partition,
    "thread-fence",
    { kind: "Thread", principal: "member-thread-fence" },
  );
  const turn = await sessionRigTurn(
    rig.sessions,
    partition,
    thread,
    "thread-fence",
  );

  assert.equal(
    await rig.mailbox.turn(turn),
    undefined,
    "the selector may not read a member's own conversation",
  );
  assert.equal(
    await rig.mailbox.withdraw(turn),
    "NoTurn",
    "the selector may not abandon a member's in-flight chat turn",
  );
  assert.deepEqual(
    await sessionRigTurnState(rig.sessions, partition, thread, turn),
    {
      state: "Queued",
      attempt: null,
      claim_generation: null,
      attempts_spent: "0",
      result: null,
      failure: null,
      batch_first: null,
      batch_last: null,
    },
    "the refused withdrawal left the thread's turn exactly as it was",
  );
});

test("an answer retried with a re-derived measurement is the same answer", async () => {
  const { partition, session } = await leadProject("answer-retry");
  const turn = sessionRigTurnId("answer-retry");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "answer-retry");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  const answering = {
    secret: attempt.secret,
    generation: attempt.attempt.generation,
    turn,
    result: '{"version":1,"dispatches":[]}',
  } as const;
  const measured = {
    model: "claude-model",
    tokens: 10,
    costMicros: 20,
    durationMs: 30,
    tools: ["Read"],
  } as const;
  assert.equal(
    await rig.sessions.plane.answer({ ...answering, measured }),
    "Answered",
  );

  assert.equal(
    await rig.sessions.plane.answer({
      ...answering,
      measured: { ...measured, durationMs: measured.durationMs + 41 },
    }),
    "AlreadyAnswered",
    "a duration is wall clock and is re-derived on every retry by construction",
  );
  assert.equal(
    await rig.sessions.plane.answer(answering),
    "AlreadyAnswered",
    "a pod that lost its meter across a restart still holds a committed answer",
  );
  assert.equal(
    await rig.sessions.plane.answer({ ...answering, result: "{}" }),
    "Conflict",
    "the result is the identity, and a different one is a different answer",
  );
  assert.deepEqual((await rig.mailbox.turn(turn))?.measured, measured);
});

test("a tool name longer than one may be reported is refused at the door", async () => {
  const { partition, session } = await leadProject("tool-name");
  const turn = sessionRigTurnId("tool-name");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "tool-name");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: "{}",
      measured: {
        model: "claude-model",
        tokens: 1,
        costMicros: 1,
        durationMs: 1,
        tools: ["n".repeat(sessionTurnToolNameCharsMax + 1)],
      },
    }),
    "Conflict",
    "a name the response schema refuses is a row no reader could serialize",
  );
});

test("a session at its identity bound still makes a frame the stream can build", async () => {
  const partition = await leadRigProject(rig, "long-identity");
  const session = asSessionId(
    `s-${randomUUID()}`.padEnd(sessionIdentityCharsMax, "s"),
  );
  assert.equal(
    await rig.sessions.sessions.open({
      partition,
      session,
      kind: "Lead",
      principal: asPrincipal("principal-long-identity"),
      capabilities: [],
      credentialSlot: "claude-code",
    }),
    "Opened",
  );
  const turn = asSessionTurnId(
    `t-${randomUUID()}`.padEnd(sessionIdentityCharsMax, "t"),
  );
  const log = postgresProjectChangeLog(rig.sessions.harness.pool);
  const before = await log.latest();
  assert.equal(
    (await rig.mailbox.offer({ partition, turn, input: anObservation }))
      .offered,
    "Enqueued",
  );

  const rows = await log.after(partition, before, 10);
  const change = rows[0];
  assert.ok(change !== undefined, "the trigger appended nothing");
  assert.equal(change.kind, "Session");
  assert.deepEqual(JSON.parse(change.resource) as unknown, {
    session,
    kind: "Lead",
    turn,
  });
  assert.doesNotThrow(
    () =>
      projectChangeDataSchemas.Session.parse({
        version: 1,
        resource: change.resource,
        representation: null,
      }),
    "a resource the durable log holds is one the stream frame must carry",
  );
});

test("a tools array holding nothing where a name should be is refused", async () => {
  const { partition, session } = await leadProject("tool-null");
  const turn = sessionRigTurnId("tool-null");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "tool-null");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });

  const plane = postgresHarnessRolePool(workerPlaneRole);
  try {
    assert.equal(
      (
        await plane.query<{ answered: string }>(
          `SELECT answer_session_turn($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8,$9)::text
             AS answered`,
          [
            attempt.digest,
            attempt.attempt.generation,
            turn,
            "{}",
            "claude-model",
            1,
            1,
            1,
            ["Read", null],
          ],
        )
      ).rows[0]?.answered,
      "Conflict",
      "a name-shaped hole is a row no reader could serialize",
    );
  } finally {
    await plane.end();
  }
  assert.equal((await rig.mailbox.turn(turn))?.state, "Claimed");
});

/** A character JSON may not carry as itself, which is what widens a resource. */
const escapedCharacter = "\u0001";

/** What that character weighs escaped, which is the widest any character is. */
const jsonEscapedCharCharsMax = 6;

test("the widest session change a legal identity can make is a frame that parses", async () => {
  const partition = await leadRigProject(rig, "widest");
  const session = asSessionId(escapedCharacter.repeat(sessionIdentityCharsMax));
  await rig.sessions.sessions.open({
    partition,
    session,
    kind: "Lead",
    principal: asPrincipal("principal-widest"),
    capabilities: [],
    credentialSlot: "claude-code",
  });
  const turn = asSessionTurnId(
    escapedCharacter.repeat(sessionIdentityCharsMax),
  );
  const log = postgresProjectChangeLog(rig.sessions.harness.pool);
  const before = await log.latest();
  assert.equal(
    (await rig.mailbox.offer({ partition, turn, input: anObservation }))
      .offered,
    "Enqueued",
  );

  const change = (await log.after(partition, before, 10))[0];
  assert.ok(change !== undefined, "the trigger appended nothing");
  assert.ok(
    change.resource.length <= projectChangeResourceCharsMax,
    `the widest legal resource is ${String(change.resource.length)} characters`,
  );
  assert.ok(
    change.resource.length >=
      sessionIdentityCharsMax * jsonEscapedCharCharsMax * 2,
    "two whole identities are escaped character by character in this one",
  );
  assert.doesNotThrow(() =>
    projectChangeDataSchemas.Session.parse({
      version: 1,
      resource: change.resource,
      representation: null,
    }),
  );
});

/**
 * One refusal row written straight at the relation, so the constraint under
 * test is what refuses it rather than the door that normally would.
 */
async function refusalRow(
  partition: Partition,
  decision: string,
  columns: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const written = {
    tenant: partition.tenant,
    project: partition.project,
    ticket: 1,
    event: "Refused",
    ticket_version: 1,
    reason: "a reason",
    selector_decision: decision,
    ...columns,
  };
  const names = Object.keys(written);
  await rig.sessions.harness.query(
    `INSERT INTO selector_agentic_refusal (${names.join(",")})
       VALUES (${names.map((_unused, at) => `$${String(at + 1)}`).join(",")})`,
    Object.values(written),
  );
}

test("one decision refuses one ticket once, whatever writes the row", async () => {
  const partition = await leadRigProject(rig, "refusal-unique");
  const decision = await leadRigDecision(rig, partition, "refusal-unique");
  await refusalRow(partition, decision);
  await assert.rejects(
    refusalRow(partition, decision, { event: "Lifted" }),
    /selector_refusal_is_one_per_decision/u,
    "a decision that said two things about one ticket said one of them twice",
  );
});

test("a refusal names a decision the log actually holds", async () => {
  const partition = await leadRigProject(rig, "refusal-fk");
  await assert.rejects(
    refusalRow(partition, "selector-decision-nobody-recorded"),
    /selector_refusal_has_its_decision/u,
    "a reason with no decision behind it is a reason nobody gave",
  );
  const elsewhere = await leadRigProject(rig, "refusal-fk-elsewhere");
  const decision = await leadRigDecision(rig, elsewhere, "refusal-fk");
  await assert.rejects(
    refusalRow(partition, decision),
    /selector_refusal_has_its_decision/u,
    "a refusal may not borrow another project's decision",
  );
});

test("the relation refuses what no door of it would have written", async () => {
  const partition = await leadRigProject(rig, "refusal-columns");
  const decision = await leadRigDecision(rig, partition, "refusal-columns");
  for (const [columns, constraint] of [
    [{ event: "Reconsidered" }, "selector_refusal_event_is_known"],
    [{ ticket: 0 }, "selector_refusal_counters_are_positive"],
    [{ ticket_version: 0 }, "selector_refusal_counters_are_positive"],
    [{ reason: "" }, "selector_refusal_reason_is_bounded"],
    [
      { tenant: "t".repeat(partitionIdentityCharsMax + 1) },
      "selector_refusal_identity_is_bounded",
    ],
    [
      { project: "p".repeat(partitionIdentityCharsMax + 1) },
      "selector_refusal_identity_is_bounded",
    ],
  ] as const)
    await assert.rejects(
      refusalRow(partition, decision, columns),
      new RegExp(constraint, "u"),
      `${constraint} is what refuses it`,
    );
});

test("a turn identity past what a stored row holds is refused", async () => {
  const { partition } = await leadProject("turn-identity");
  await assert.rejects(
    rig.mailbox.offer({
      partition,
      turn: `t-${randomUUID()}`.padEnd(
        sessionIdentityCharsMax + 1,
        "t",
      ) as SessionTurnId,
      input: anObservation,
    }),
    /session_turn_identity_is_bounded/u,
    "a turn nothing can read back is a lead page poisoned by one row",
  );
});

test("a model name past what the measure column holds is refused", async () => {
  const { partition, session } = await leadProject("model-bound");
  const turn = sessionRigTurnId("model-bound");
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const attempt = await leadPod(partition, session, "model-bound");
  await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  await assert.rejects(
    rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn,
      result: "{}",
      measured: {
        model: "m".repeat(sessionTurnModelCharsMax + 1),
        tokens: 1,
        costMicros: 1,
        durationMs: 1,
        tools: [],
      },
    }),
    /session_turn_measure_is_bounded/u,
  );
});

/** The member of a roster that weighs the most, which is what a ceiling is for. */
function widestOf(roster: readonly string[]): string {
  return [...roster].sort((one, other) => other.length - one.length)[0] ?? "";
}

/**
 * One candidate at its ceiling: every field at the bound its own constant
 * gives it — the two authored pages full, the identities at the identity bound
 * with every character escaped, and a canonical configuration of the length 007
 * bounds whose every character is a quote the embedding must escape.
 */
function maximalCandidate(ticket: number): Record<string, unknown> {
  return {
    ticket,
    ticketVersion: Number.MAX_SAFE_INTEGER,
    workFanout: Number.MAX_SAFE_INTEGER,
    dependencies: Array.from(
      { length: nativeHttpDraftDependenciesMax },
      (_unused, at) => Number.MAX_SAFE_INTEGER - at,
    ),
    program: Array.from({ length: nativeHttpDraftStagesMax }, () => ({
      fanout: Number.MAX_SAFE_INTEGER,
      combinator: widestOf(evaluationCombinators),
    })),
    reworkPolicy: { type: "BudgetedRework", value: Number.MAX_SAFE_INTEGER },
    finalizationPricing: { type: "Budgeted", value: Number.MAX_SAFE_INTEGER },
    resumePricing: widestOf(resumePricings),
    finalizer: widestOf(finalizers),
    configurationVersion: {
      name: escapedText(repositoryConfigurationNameCharsMax),
      number: Number.MAX_SAFE_INTEGER,
    },
    configurationRevision: escapedText(nativeHttpPathSegmentCharsMax),
    configurationDigest: "c".repeat(artifactDigestChars),
    configurationCanonical: '"'.repeat(configurationCanonicalCharsMax),
  };
}

/** A text of that many characters, every one of which JSON must escape. */
function escapedText(chars: number): string {
  return escapedCharacter.repeat(chars);
}

/**
 * The widest observation the parts' own bounds admit, built from each of them
 * at its ceiling. It is what the mailbox row must hold, so a derivation that
 * drops a part is a document the runtime composes and the database refuses.
 */
function widestObservation(partition: Partition, decision: string): string {
  const refusals = Array.from(
    { length: agenticRefusalsAnsweredMax },
    (_unused, at) => ({
      ticket: at + 1,
      ticketVersion: 1,
      reason: escapedText(agenticRefusalReasonCharsMax),
      recordedAt: "2026-09-02T12:00:00.000Z",
      superseded: false,
    }),
  );
  const parts = {
    version: 1,
    decision,
    partition,
    instructions: {
      revision: escapedText(nativeHttpPathSegmentCharsMax),
      content: escapedText(sessionSystemPromptCharsMax),
    },
    seeding: {
      handoffNote: escapedText(selectorHandoffNoteBytesMax / 6),
      decisions: Array.from({ length: leadSeedingDecisionsMax }, () =>
        escapedText(leadSeededDecisionCharsMax / 6),
      ),
      refusals,
      notificationCursor: Number.MAX_SAFE_INTEGER,
    },
    changes: Array.from({ length: notificationPageLimitMax }, () =>
      escapedText(leadObservedChangeCharsMax / 6),
    ),
    candidates: Array.from(
      { length: dispatchViewPageLimitMax },
      (_unused, at) => maximalCandidate(at + 1),
    ),
    handoffNote: escapedText(selectorHandoffNoteBytesMax / 6),
    refusals,
    operationalContext: { version: 2 },
  };
  const measured = JSON.stringify({ ...parts, token: "" }).length;
  return JSON.stringify({
    ...parts,
    token: escapedText(
      Math.min(
        Math.floor(
          (sessionTurnInputCharsMax - measured) / jsonEscapedCharCharsMax,
        ),
        Math.floor(leadObservationFixedCharsMax / jsonEscapedCharCharsMax),
      ),
    ),
  });
}

test("the widest observation the parts admit is one the mailbox row holds", async () => {
  const { partition } = await leadProject("widest-observation");
  const turn = sessionRigTurnId("widest-observation");
  const input = widestObservation(partition, turn);
  assert.ok(
    input.length > sessionTurnInputCharsMax / 2,
    `the widest observation is ${String(input.length)} characters, against a bound of ${String(sessionTurnInputCharsMax)}`,
  );
  assert.deepEqual(
    await rig.mailbox.offer({ partition, turn, input }),
    { offered: "Enqueued", ordinal: 1 },
    "a document every bound admits is one the column must hold",
  );
  const held = (
    await rig.sessions.harness.query(
      "SELECT input FROM session_turn WHERE turn=$1",
      [turn],
    )
  )[0]?.["input"];
  assert.equal(held, input, "the row claims back what was offered, whole");
  const parsed = JSON.parse(String(held)) as { candidates: unknown[] };
  assert.equal(parsed.candidates.length, dispatchViewPageLimitMax);
});

test("one candidate at its ceiling is one the derivation makes room for", () => {
  const one = maximalCandidate(1);
  const whole = JSON.stringify(one).length;
  const fixed =
    JSON.stringify({ ...one, configurationCanonical: "" }).length - 2;
  assert.ok(
    fixed > nativeHttpDraftStagesMax,
    "the widest candidate carries both authored pages full",
  );
  assert.ok(
    fixed <= leadObservedCandidateFixedCharsMax,
    `a candidate's own fields weigh ${String(fixed)} against ${String(leadObservedCandidateFixedCharsMax)}`,
  );
  assert.ok(
    whole > configurationCanonicalCharsMax,
    "a candidate embeds the canonical text rather than a reference to it",
  );
  assert.ok(
    whole <= leadObservedCandidateCharsMax,
    `one candidate weighs ${String(whole)} against ${String(leadObservedCandidateCharsMax)}`,
  );
});

test("both resources the session triggers write parse as the shape the wire exports", async () => {
  const { partition, session } = await leadProject("resource-shape");
  const log = postgresProjectChangeLog(rig.sessions.harness.pool);
  const turn = sessionRigTurnId("resource-shape");
  const beforeTurn = await log.latest();
  await rig.mailbox.offer({ partition, turn, input: anObservation });
  const turnChange = (await log.after(partition, beforeTurn, 10))[0];
  assert.ok(turnChange !== undefined, "the turn trigger appended nothing");
  assert.deepEqual(
    sessionChangeResourceSchema.parse(
      JSON.parse(turnChange.resource) as unknown,
    ),
    { session, kind: "Lead", turn },
  );

  const { stream, before: beforeBatch } = await recordedBatch(
    partition,
    session,
    "resource-shape",
    log,
  );
  const batchChange = (await log.after(partition, beforeBatch, 10))[0];
  assert.ok(batchChange !== undefined, "the store trigger appended nothing");
  assert.deepEqual(
    sessionChangeResourceSchema.parse(
      JSON.parse(batchChange.resource) as unknown,
    ),
    { session, kind: "Lead", stream, batch: 1 },
  );
});
