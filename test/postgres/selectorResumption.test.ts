/**
 * A decision outlives the selector process that began it, against a real
 * server: what the store keeps of an unfinished decision reads back whole, a
 * decision is recorded once and never over a project that moved, and one
 * runtime finishes the decision another began and never returned to.
 *
 * THE TWO RUNTIMES SHARE NOTHING BUT THE DATABASE. Each is composed on its own
 * pool, its own source and its own lead host, so what the second records is
 * what the store and the mailbox kept and nothing the first held in memory.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { leadSessionMint } from "../../src/adapters/crypto/leadSessionMint.ts";
import { selectorServiceRole } from "../../src/adapters/postgres/schema.ts";
import {
  postgresSelectorRuntimeControl,
  postgresSelectorState,
} from "../../src/adapters/postgres/selector.ts";
import { postgresSessionRouteReads } from "../../src/adapters/postgres/sessionPlacement.ts";
import { composeSelectorRuntime } from "../../src/compose.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { DispatchViewPage } from "../../src/interpreter/dispatchView.ts";
import {
  leadSelectorPolicy,
  type LeadPolicyClock,
} from "../../src/interpreter/leadPolicyHost.ts";
import { leadSystemPrompt } from "../../src/interpreter/leadTools.ts";
import type { ProjectNotification } from "../../src/interpreter/notifications.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  runObservedSelectorCycle,
  selectorInitialState,
  type SelectorInteraction,
  type SelectorObservation,
  type SelectorOperationalContext,
} from "../../src/interpreter/selector.ts";
import { selectorPolicyHost } from "../../src/interpreter/selectorPolicyHost.ts";
import {
  selectorIdentityFactory,
  type SelectorRuntimeSource,
} from "../../src/interpreter/selectorRuntime.ts";
import {
  postgresHarnessRolePool,
  postgresHarnessSelectorContext,
} from "./harness.ts";
import {
  leadRigClock,
  leadRigObservation,
  leadRigHostedAccess,
  leadRigOpen,
  leadRigPod,
  leadRigProject,
  type LeadRig,
} from "./leadHarness.ts";
import { sessionRigSession } from "./sessionHarness.ts";
import type { SessionId } from "../../src/interpreter/agentSession.ts";

let rig: LeadRig;

before(async () => {
  rig = await leadRigOpen();
});

after(async () => {
  await rig.close();
});

/** The page every runtime here is shown, which is the one a decision case offers its lead. */
function observationOf(partition: Partition): SelectorObservation {
  return leadRigObservation(partition, 12);
}

/** A project whose lead holds the prompt the installation's settings compose, so no runtime replaces it. */
async function leadProject(label: string) {
  const partition = await leadRigProject(rig, label);
  const settings = await postgresSelectorRuntimeControl(
    rig.selectorPool,
  ).projectSettings(partition);
  const session = await sessionRigSession(rig.sessions, partition, label, {
    kind: "Lead",
    systemPrompt: leadSystemPrompt({ basePrompt: settings.basePrompt }),
  });
  return { partition, session };
}

/** What the lead answers in every case here. */
const decided = {
  version: 1,
  dispatches: [{ ticket: 41, expectedTicketVersion: 3 }],
  refusals: [{ ticket: 43, ticketVersion: 1, reason: "its brief is empty" }],
  lifts: [],
  attention: "Attention",
  handoffNote: { next: "41" },
  planningIntent: { tickets: [41] },
};

const changes: readonly ProjectNotification[] = [
  { ordinal: 12, kind: "Ticket", resource: "41" },
];

/** What one runtime's source answered, so a case can say what the decision stood on. */
interface SourceRecord {
  readonly contexts: SelectorOperationalContext[];
  readonly pages: DispatchViewPage[];
}

/**
 * A source over one project that moved to cursor twelve: a page of two
 * candidates and a fresh context. `deadlines` decides whether a decision's
 * deadline ever fires, which a runtime standing in for a process that is gone does not.
 */
function sourceOf(
  partition: Partition,
  record: SourceRecord,
  deadlines: boolean,
): SelectorRuntimeSource {
  const window = (after: number) =>
    after < 12
      ? ({ result: "Events", cursor: 12, events: [...changes] } as const)
      : ({ result: "Events", cursor: after, events: [] } as const);
  return {
    projects: () => Promise.resolve({ projects: [partition] }),
    moved: (_scope, after) => Promise.resolve(window(after)),
    notifications: (_scope, cursor) => Promise.resolve(window(cursor.after)),
    dispatchView: () => {
      const observed = observationOf(partition);
      const page: DispatchViewPage = {
        result: "Page",
        token: observed.token,
        candidates: observed.candidates,
        notificationCursor: 12,
      };
      record.pages.push(page);
      return Promise.resolve(page);
    },
    operationalContext: () => {
      const context = {
        ...postgresHarnessSelectorContext,
        observedAtEpochMs: Date.now(),
        observedAt: new Date().toISOString(),
      };
      record.contexts.push(context);
      return Promise.resolve(context);
    },
    currentTimeEpochMs: () => Promise.resolve(Date.now()),
    currentInstant: () => Promise.resolve(new Date().toISOString()),
    decisionDeadline: (milliseconds) =>
      deadlines
        ? new Promise<never>((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error("selector deadline exceeded"));
            }, milliseconds).unref();
          })
        : new Promise<never>(() => undefined),
    submit: () => Promise.reject(new Error("no delivery is approved here")),
    operation: () => Promise.resolve(undefined),
  };
}

/**
 * A clock whose waits never end, which is a process that offered its turn and
 * was replaced while polling; `polling` settles when it is first asked to wait.
 */
function replacedClock() {
  const polling = Promise.withResolvers<"polled">();
  const clock: LeadPolicyClock = {
    now: () => leadRigClock.now(),
    wait: () => {
      polling.resolve("polled");
      return new Promise(() => undefined);
    },
  };
  return { clock, polling: polling.promise };
}

/** One selector runtime on a pool of its own, as one deployed process composes it. */
function selectorRuntime(
  instance: string,
  source: SelectorRuntimeSource,
  clock: LeadPolicyClock,
) {
  const pool = postgresHarnessRolePool(selectorServiceRole);
  const runtime = composeSelectorRuntime(
    pool,
    source,
    {
      sessions: leadSessionMint(),
      clock,
      deadline: {
        after: (milliseconds) =>
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error("control deadline exceeded"));
            }, milliseconds).unref();
          }),
      },
      policy: {
        pollIntervalMs: 5,
        implementationRevision: instance,
        principal: "principal-selector-resumption",
        credentialSlot: "claude-code",
      },
      controlDeadlineMs: 5_000,
    },
    leadRigHostedAccess,
    selectorIdentityFactory(() => `${instance}-${randomUUID()}`),
  );
  return { pool, runtime };
}

async function attemptsOf(partition: Partition) {
  return rig.sessions.harness.query(
    `SELECT attempt,state,terminal_evidence AS evidence,project_revision::text AS revision
       FROM selector_attempt WHERE tenant=$1 AND project=$2 ORDER BY created_at`,
    [partition.tenant, partition.project],
  );
}

test("an unfinished attempt reads back its observation and revision, aged by the server's clock", async () => {
  const partition = await leadRigProject(rig, "unfinished-read");
  const store = postgresSelectorState(rig.selectorPool);
  const running = `selector-decision-read-running-${randomUUID()}`;
  const starting = `selector-decision-read-starting-${randomUUID()}`;
  const observation = observationOf(partition);
  for (const attempt of [running, starting])
    assert.equal(
      await store.allocateAttempt(attempt, partition, {
        concurrentDecisions: 100,
        selectionsPerMinute: 100_000,
        millisecondsPerDecision: 60_000,
      }),
      true,
    );
  await store.runningAttempt(
    running,
    observation,
    { settingsRevision: 1, projectSettingsRevision: 0 },
    3,
  );
  await rig.sessions.harness.query(
    `UPDATE selector_attempt SET created_at=now()-interval '90 seconds' WHERE attempt=$1`,
    [running],
  );
  const found = (await store.unfinishedAttempts(100)).filter(
    (attempt) => attempt.partition.project === partition.project,
  );
  assert.deepEqual(
    found.map((attempt) => [attempt.attempt, attempt.state]),
    [
      [running, "Running"],
      [starting, "Starting"],
    ],
    "oldest first",
  );
  assert.deepEqual(found[0]?.observation, observation);
  assert.equal(found[0]?.projectRevision, 3);
  assert.ok((found[0]?.ageMs ?? 0) >= 90_000);
  assert.equal(found[1]?.observation, undefined);
  assert.equal(found[1]?.projectRevision, undefined);
  await rig.sessions.harness.query(
    `UPDATE selector_observation SET observation='{"token":"torn"}' WHERE attempt=$1`,
    [running],
  );
  const torn = (await store.unfinishedAttempts(100)).find(
    (attempt) => attempt.attempt === running,
  );
  assert.equal(
    torn?.observation,
    undefined,
    "a torn observation reads as none",
  );
  for (const attempt of [running, starting])
    await store.terminateAttempt(attempt, "test cleanup");
  assert.deepEqual(
    (await store.unfinishedAttempts(100)).filter(
      (attempt) => attempt.partition.project === partition.project,
    ),
    [],
  );
});

function interactionOf(
  partition: Partition,
  decision: string,
  completedAt: string,
): SelectorInteraction {
  return {
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
    result: { dispatches: [] },
    implementationRevision: `implementation-${completedAt}`,
    modelRevision: "model-1",
    policyRevision: "policy-1",
    accounting: { tokens: 1, durationMs: 1 },
    startedAt: "2026-10-08T02:00:00.000Z",
    completedAt,
  };
}

async function runningDecision(partition: Partition, label: string) {
  const store = postgresSelectorState(rig.selectorPool);
  const decision = `selector-decision-${label}-${randomUUID()}`;
  await store.allocateAttempt(decision, partition, {
    concurrentDecisions: 100,
    selectionsPerMinute: 100_000,
    millisecondsPerDecision: 60_000,
  });
  await store.runningAttempt(
    decision,
    observationOf(partition),
    { settingsRevision: 1, projectSettingsRevision: 0 },
    0,
  );
  return { store, decision };
}

const fence = { settingsRevision: 1, projectSettingsRevision: 0 } as const;

test("two records of one decision write it once, however their interactions differ", async () => {
  const partition = await leadRigProject(rig, "once");
  const { store, decision } = await runningDecision(partition, "once");
  const state = selectorInitialState(partition);
  const both = await Promise.all([
    store.recordInteraction(
      interactionOf(partition, decision, "2026-10-08T02:00:01.000Z"),
      state,
      fence,
    ),
    store.recordInteraction(
      interactionOf(partition, decision, "2026-10-08T02:00:02.000Z"),
      state,
      fence,
    ),
  ]);
  assert.deepEqual(
    [...both].sort(),
    [false, true],
    "one records and the other writes nothing, neither raising",
  );
  assert.equal((await store.history(partition, undefined, 10)).length, 1);
  assert.equal((await store.project(partition))?.revision, 1);
});

test("a decision another ended is recorded by nobody, and raises nothing", async () => {
  const partition = await leadRigProject(rig, "reaped");
  const { store, decision } = await runningDecision(partition, "reaped");
  await store.terminateAttempt(decision, "lease expired");
  assert.equal(
    await store.recordInteraction(
      interactionOf(partition, decision, "2026-10-08T02:00:01.000Z"),
      selectorInitialState(partition),
      fence,
    ),
    false,
  );
  assert.deepEqual(await store.history(partition, undefined, 10), []);
  assert.equal((await store.project(partition))?.revision ?? 0, 0);
});

test("a decision one process began and finished over a project that moved is ended, recording nothing", async () => {
  const { partition, session } = await leadProject("moved");
  const { store, decision } = await runningDecision(partition, "moved");
  assert.equal(
    await store.recordQuietCycle({
      ...selectorInitialState(partition),
      notificationCursor: 5,
    }),
    true,
  );
  const settings = await postgresSelectorRuntimeControl(
    rig.selectorPool,
  ).projectSettings(partition);
  const pod = leadRigPod(rig, partition, session, "moved", () => decided);
  const proposal = await runObservedSelectorCycle(
    selectorInitialState(partition),
    observationOf(partition),
    sourceOf(partition, { contexts: [], pages: [] }, true),
    rig.writes,
    store,
    selectorPolicyHost(
      leadSelectorPolicy(
        rig.mailbox,
        store,
        leadSessionMint(),
        leadRigClock,
        leadRigHostedAccess,
        postgresSessionRouteReads(rig.selectorPool),
        {
          pollIntervalMs: 5,
          implementationRevision: "selector-build",
          principal: "principal-selector-resumption",
          credentialSlot: "claude-code",
        },
      ),
      { after: () => new Promise<never>(() => undefined) },
      { controlDeadlineMs: 5_000 },
    ),
    {
      operation: asOperationId(decision.replace("decision", "operation")),
      selectorDecisionReference: decision,
    },
    settings,
  );
  await pod;
  assert.equal(proposal, undefined);
  assert.deepEqual(await attemptsOf(partition), [
    {
      attempt: decision,
      state: "Terminated",
      evidence: "the project moved off the revision the decision is fenced on",
      revision: "0",
    },
  ]);
  assert.deepEqual(await store.history(partition, undefined, 10), []);
  assert.equal((await store.project(partition))?.notificationCursor, 5);
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT count(*)::text AS rows FROM selector_proposal_delivery WHERE selector_decision=$1`,
      [decision],
    ),
    [{ rows: "0" }],
  );
  assert.deepEqual(
    await rig.selectorStanding.standingAmong(partition, [asTicketId(43)]),
    [],
  );
});

/** Starts a runtime that offers its turn and is replaced while polling, and only then answers the turn as its pod. */
async function decisionLeftBehind(partition: Partition, session: SessionId) {
  const first: SourceRecord = { contexts: [], pages: [] };
  const parked = replacedClock();
  const replaced = selectorRuntime(
    "instance-a",
    sourceOf(partition, first, false),
    parked.clock,
  );
  const ended = await Promise.race([
    parked.polling,
    replaced.runtime.runOnce().then(
      () => "returned",
      () => "threw",
    ),
  ]);
  assert.equal(
    ended,
    "polled",
    `the first runtime ${ended} before it ever polled its turn`,
  );
  await leadRigPod(rig, partition, session, "successor", () => decided);
  const [begun] = await attemptsOf(partition);
  assert.equal(begun?.["state"], "Running", "the first runtime never returned");
  return { first, replaced, decision: String(begun?.["attempt"]) };
}

/** The interaction the successor recorded, which is the one the first runtime's observation and the turn's answer make. */
async function assertInteractionLeft(
  partition: Partition,
  decision: string,
  first: SourceRecord,
): Promise<void> {
  const store = postgresSelectorState(rig.selectorPool);
  const interactions = await store.history(partition, undefined, 10);
  assert.equal(interactions.length, 1);
  const interaction = interactions[0];
  assert.equal(interaction?.decision, decision);
  assert.deepEqual(interaction?.result, {
    dispatches: decided.dispatches,
    refusals: decided.refusals,
    lifts: [],
    attention: "Attention",
    handoffNote: decided.handoffNote,
    planningIntent: decided.planningIntent,
  });
  const page = first.pages[0];
  assert.ok(page?.result === "Page");
  assert.deepEqual(interaction?.observedView, page.candidates);
  assert.deepEqual(interaction?.observedToken, page.token);
  assert.deepEqual(interaction?.context, {
    operationalContext: first.contexts[0],
    handoffNote: {},
    changes,
  });
  assert.equal(interaction?.implementationRevision, "instance-b");
}

/** The proposal, intent, project state, ledger and attempt the successor left. */
async function assertRecordLeft(
  partition: Partition,
  decision: string,
): Promise<void> {
  const store = postgresSelectorState(rig.selectorPool);
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT ticket::text AS ticket,operation,state,
              command::jsonb->>'selectorDecisionReference' AS reference
         FROM selector_proposal_delivery WHERE selector_decision=$1`,
      [decision],
    ),
    [
      {
        ticket: "41",
        operation: `${decision.replace("selector-decision-", "selector-operation-")}-t41`,
        state: "AwaitingApproval",
        reference: decision,
      },
    ],
  );
  assert.deepEqual((await store.planningIntent(partition))?.intent, {
    tickets: [41],
  });
  const left = await store.project(partition);
  assert.equal(left?.notificationCursor, 12);
  assert.equal(left?.attention, "Attention");
  assert.deepEqual(left?.handoffNote, decided.handoffNote);
  assert.deepEqual(left?.candidateScan, { state: "Unstarted" });
  assert.deepEqual(
    (await rig.selectorStanding.standingAmong(partition, [asTicketId(43)])).map(
      (refusal) => [refusal.ticket, refusal.decision],
    ),
    [[43, decision]],
  );
  assert.deepEqual(
    (await attemptsOf(partition)).map((attempt) => attempt["state"]),
    ["Completed"],
  );
}

test("a decision one runtime began and a second finished leaves what the first would have", async () => {
  const { partition, session } = await leadProject("successor");
  const { first, replaced, decision } = await decisionLeftBehind(
    partition,
    session,
  );
  const second: SourceRecord = { contexts: [], pages: [] };
  const successor = selectorRuntime(
    "instance-b",
    sourceOf(partition, second, true),
    leadRigClock,
  );
  try {
    const result = await successor.runtime.runOnce();
    assert.deepEqual(result.failures, []);
    assert.equal(result.proposed, 1);
  } finally {
    await successor.pool.end();
    await replaced.pool.end();
  }
  assert.deepEqual(second.pages, [], "the successor observed nothing anew");
  await assertInteractionLeft(partition, decision, first);
  await assertRecordLeft(partition, decision);
  assert.deepEqual(
    await rig.sessions.harness.query(
      `SELECT count(*)::text AS turns FROM session_turn
        WHERE tenant=$1 AND project=$2`,
      [partition.tenant, partition.project],
    ),
    [{ turns: "1" }],
    "no second turn was offered for the changes the decision consumed",
  );
});
