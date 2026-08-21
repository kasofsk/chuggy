import assert from "node:assert/strict";
import { test } from "node:test";

import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  observeSelectorProject,
  runSelectorCycle,
  type SelectorRuntimeControlStore,
  type SelectorRuntimeSettings,
} from "../../src/interpreter/selector.ts";
import {
  deliverSelectorProposal,
  reconcileSelectorProposal,
  type SelectorDelivery,
  type SelectorStateStore,
} from "../../src/interpreter/selector.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";
import { selectorRunOnce } from "../../src/interpreter/selectorRuntime.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import { selectorProposalReviews } from "../../src/interpreter/selectorReview.ts";
import { selectorRuntimeAdministration } from "../../src/interpreter/selectorAdmin.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const delivery: SelectorDelivery = {
  decision: "decision",
  partition,
  operation: asOperationId("operation"),
  attempts: 0,
  command: {
    version: 1,
    command: "ProposeDispatch",
    ticket: asTicketId(1),
    expectedTicketVersion: 1,
    observedViewToken: {
      ...partition,
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 1,
      digest: "a".repeat(64),
    },
    selectorDecisionReference: "decision",
  },
};

const operationalContext = {
  observedAt: "2026-08-21T12:00:00.000Z",
  observedAtEpochMs: 1_777_000_000_000,
  reviewFeedback: [],
  activeWork: [],
  projectCapacity: {
    account: "project",
    allocated: 0,
    limit: 4,
    available: 4,
  },
  clusterCapacity: {
    visibility: "AuthorizedAggregate",
    allocated: 2,
    limit: 10,
    available: 8,
    pressure: "Normal",
  },
  executionBacklog: { queued: 0, ceiling: 100, dispatchAllowed: true },
} as const;

const runtimeSettings: SelectorRuntimeSettings = {
  revision: 1,
  mode: "Running",
  dispatchMode: "Automatic",
  basePrompt: "prompt",
  modelAllowlist: ["*"],
  toolAllowlist: ["*"],
  limits: {
    tokensPerDecision: 8192,
    millisecondsPerDecision: 120_000,
    toolCallsPerDecision: 20,
    concurrentDecisions: 4,
    selectionsPerMinute: 60,
  },
  operationalContextMaxAgeMs: 30_000,
};

function promptObservationSource() {
  return {
    decisionDeadline: () => new Promise<never>(() => undefined),
    notifications: () =>
      Promise.resolve({ result: "Events", cursor: 1, events: [] } as const),
    currentTimeEpochMs: () =>
      Promise.resolve(operationalContext.observedAtEpochMs),
    operationalContext: () => Promise.resolve(operationalContext),
    dispatchView: () =>
      Promise.resolve({
        result: "Page",
        token: {
          ...partition,
          recoveryEpoch: "epoch",
          schemaVersion: 1,
          watermark: 1,
          digest: "c".repeat(64),
        },
        candidates: [],
        notificationCursor: 1,
      } as const),
  };
}

function stateStore(
  onTerminal: (outcome: unknown) => void,
): SelectorStateStore {
  return {
    inventoryCursor: () => Promise.resolve(undefined),
    saveInventoryCursor: () => Promise.resolve(),
    recordInteraction: () => Promise.resolve(),
    record: () => Promise.resolve(),
    pending: () => Promise.resolve([]),
    submittedDeliveries: () => Promise.resolve([]),
    submitted: () => Promise.resolve(),
    terminal: (_decision, outcome) => {
      onTerminal(outcome);
      return Promise.resolve();
    },
    history: () => Promise.resolve([]),
    project: () => Promise.resolve(undefined),
    awaitingApproval: () => Promise.resolve([]),
    approve: () => Promise.resolve(false),
    reject: () => Promise.resolve(false),
    reviewFeedback: () => Promise.resolve([]),
  };
}

test("selector observation resumes from a reset cursor and pins every view page", async () => {
  const watermarks: (number | undefined)[] = [];
  const observed = await observeSelectorProject(
    {
      partition,
      notificationCursor: 3,
      attention: "Monitoring",
      workingMemory: {},
    },
    {
      notifications: () => Promise.resolve({ result: "Reset", cursor: 12 }),
      decisionDeadline: () => new Promise<never>(() => undefined),
      currentTimeEpochMs: () =>
        Promise.resolve(operationalContext.observedAtEpochMs),
      operationalContext: () => Promise.resolve(operationalContext),
      dispatchView: (_partition, query) => {
        watermarks.push(query.watermark);
        return Promise.resolve({
          result: "Page",
          token: {
            ...partition,
            recoveryEpoch: "epoch",
            schemaVersion: 1,
            watermark: 20,
            digest: "a".repeat(64),
          },
          candidates: [],
          notificationCursor: 12,
        } as const);
      },
    },
  );
  assert.equal(observed?.notificationCursor, 12);
  assert.deepEqual(watermarks, [undefined]);
});

test("selector observation discards a view when a later page resets", async () => {
  let page = 0;
  const observed = await observeSelectorProject(
    {
      partition,
      notificationCursor: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    {
      notifications: () =>
        Promise.resolve({ result: "Events", cursor: 0, events: [] } as const),
      decisionDeadline: () => new Promise<never>(() => undefined),
      currentTimeEpochMs: () =>
        Promise.resolve(operationalContext.observedAtEpochMs),
      operationalContext: () => Promise.resolve(operationalContext),
      dispatchView: () => {
        page += 1;
        if (page === 2) return Promise.resolve({ result: "Reset" } as const);
        return Promise.resolve({
          result: "Page",
          token: {
            ...partition,
            recoveryEpoch: "epoch",
            schemaVersion: 1,
            watermark: 1,
            digest: "b".repeat(64),
          },
          candidates: [],
          nextAfter: asTicketId(1),
          notificationCursor: 0,
        } as const);
      },
    },
  );
  assert.equal(observed, undefined);
});

test("ambiguous proposal delivery retries through ordinary operation idempotency", async () => {
  let submitted = 0;
  const store = {
    ...stateStore(() => undefined),
    submitted: () => {
      submitted += 1;
      return Promise.resolve();
    },
  };
  const ambiguous = await deliverSelectorProposal(
    store,
    {
      submit: () => Promise.reject(new Error("connection lost")),
    },
    delivery,
  );
  assert.equal(ambiguous.result, "Retry");
  const retried = await deliverSelectorProposal(
    store,
    {
      submit: () =>
        Promise.resolve({
          accepted: "Original",
          operation: {
            partition,
            operation: delivery.operation,
            ordinal: 1,
            state: "Pending",
            authorityKind: asAuthorityKind("Selector"),
            admission: "Ordinary",
            lifecycleGeneration: 1,
          },
        }),
    },
    delivery,
  );
  assert.equal(retried.result, "Delivered");
  assert.equal(submitted, 1);
});

test("accepted selector delivery reconciles its terminal operation outcome", async () => {
  let terminal: unknown;
  const reconciled = await reconcileSelectorProposal(
    stateStore((outcome) => {
      terminal = outcome;
    }),
    {
      operation: () =>
        Promise.resolve({ state: "Refused", code: "SelectionChanged" }),
    },
    delivery,
  );
  assert.equal(reconciled, true);
  assert.deepEqual(terminal, { state: "Refused", code: "SelectionChanged" });
});

test("a paused runtime creates no new observations but still drains durable work", async () => {
  let pendingReads = 0;
  const store = {
    ...stateStore(() => undefined),
    pending: () => {
      pendingReads += 1;
      return Promise.resolve([]);
    },
  };
  const result = await selectorRunOnce(
    store,
    {
      projects: () =>
        Promise.reject(new Error("paused runtime listed projects")),
      acquireDecisionPermit: () =>
        Promise.reject(new Error("paused runtime acquired a permit")),
      releaseDecisionPermit: () =>
        Promise.reject(new Error("paused runtime released a permit")),
      notifications: () =>
        Promise.reject(new Error("paused runtime observed a project")),
      decisionDeadline: () =>
        Promise.reject(new Error("paused runtime created a deadline")),
      currentTimeEpochMs: () =>
        Promise.reject(new Error("paused runtime read the clock")),
      dispatchView: () =>
        Promise.reject(new Error("paused runtime read a view")),
      operationalContext: () =>
        Promise.reject(new Error("paused runtime read operational context")),
      submit: () => Promise.reject(new Error("there was no pending delivery")),
      operation: () =>
        Promise.reject(new Error("there was no submitted delivery")),
    },
    {
      decide: () =>
        Promise.reject(new Error("paused runtime invoked its policy")),
    },
    {
      next: () => ({
        operation: asOperationId("unused"),
        selectorDecisionReference: "unused",
      }),
    },
    {
      settings: () =>
        Promise.resolve({ ...runtimeSettings, revision: 4, mode: "Paused" }),
    },
  );
  assert.deepEqual(result, {
    observed: 0,
    proposed: 0,
    delivered: 0,
    reconciled: 0,
  });
  assert.equal(pendingReads, 1);
});

test("a selector decision uses and records one hot-loaded prompt revision", async () => {
  const settings: SelectorRuntimeSettings = {
    ...runtimeSettings,
    revision: 7,
    basePrompt: "prioritize tickets that unblock dependants",
  };
  let recorded = "";
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    promptObservationSource(),
    {
      ...stateStore(() => undefined),
      recordInteraction: (interaction) => {
        recorded = interaction.instructions;
        return Promise.resolve();
      },
    },
    {
      decide: (observation, current) =>
        Promise.resolve({
          interaction: {
            decision: "prompt-decision",
            partition,
            instructionsVersion: String(current.revision),
            instructions: current.basePrompt,
            observedView: observation.candidates,
            observedToken: observation.token,
            context: {
              operationalContext: observation.operationalContext,
              workingMemory: observation.workingMemory,
            },
            toolActivity: [],
            result: { waiting: true },
            implementationRevision: "implementation-1",
            modelRevision: "model-1",
            policyRevision: "policy-1",
            accounting: { tokens: 100, durationMs: 1_000 },
            startedAt: "2026-08-21T12:00:00.000Z",
            completedAt: "2026-08-21T12:00:01.000Z",
          },
          attention: "Monitoring",
          workingMemory: { note: "watch the dependency closure" },
        }),
    },
    {
      operation: asOperationId("prompt-operation"),
      selectorDecisionReference: "prompt-decision",
    },
    settings,
  );
  assert.equal(recorded, settings.basePrompt);
});

test("the runtime deadline ends a policy call that never returns", async () => {
  await assert.rejects(
    runSelectorCycle(
      {
        partition,
        notificationCursor: 0,
        attention: "Monitoring",
        workingMemory: {},
      },
      {
        ...promptObservationSource(),
        decisionDeadline: () =>
          Promise.reject(new Error("decision deadline exceeded")),
      },
      stateStore(() => undefined),
      { decide: () => new Promise(() => undefined) },
      {
        operation: asOperationId("timed-operation"),
        selectorDecisionReference: "timed-decision",
      },
      runtimeSettings,
    ),
    /deadline exceeded/,
  );
});

test("proposal review requires dispatch authority and preserves feedback", async () => {
  let approvedFeedback: string | undefined;
  const reviews = selectorProposalReviews(
    {
      authorize: (_principal, _partition, access) =>
        Promise.resolve(
          access === "DispatchTicket"
            ? {
                kind: asAuthorityKind("User"),
                subject: asAuthoritySubject("reviewer"),
              }
            : undefined,
        ),
    },
    {
      ...stateStore(() => undefined),
      awaitingApproval: () => Promise.resolve([delivery]),
      approve: (_partition, _decision, _reviewer, feedback) => {
        approvedFeedback = feedback;
        return Promise.resolve(true);
      },
    },
  );
  const listed = await reviews.pending(asPrincipal("reviewer"), partition, 10);
  assert.equal(listed.result, "Found");
  const approved = await reviews.approve(
    asPrincipal("reviewer"),
    partition,
    delivery.decision,
    "start this after the database migration",
  );
  assert.deepEqual(approved, { result: "Changed" });
  assert.equal(approvedFeedback, "start this after the database migration");
});

test("selector configuration changes require platform administration", async () => {
  let mutations = 0;
  const unchanged = Promise.resolve({
    updated: true,
    settings: runtimeSettings,
  } as const);
  const store: SelectorRuntimeControlStore = {
    settings: () => Promise.resolve(runtimeSettings),
    pause: () => {
      mutations += 1;
      return unchanged;
    },
    unpause: () => unchanged,
    setDispatchMode: () => unchanged,
    updateBasePrompt: () => unchanged,
    updatePolicyControls: () => unchanged,
    history: () => Promise.resolve([runtimeSettings]),
    rollback: () => unchanged,
    drainStatus: () =>
      Promise.resolve({
        mode: "Running",
        awaitingApproval: 0,
        pendingDeliveries: 0,
        submittedDeliveries: 0,
        drained: true,
      }),
  };
  const administration = selectorRuntimeAdministration(
    {
      authorize: (principal) =>
        Promise.resolve(principal === asPrincipal("admin")),
    },
    store,
  );
  await assert.rejects(
    administration.pause(asPrincipal("member"), runtimeSettings.revision),
    /forbidden/,
  );
  assert.equal(mutations, 0);
  await administration.pause(asPrincipal("admin"), runtimeSettings.revision);
  assert.equal(mutations, 1);
});
