import assert from "node:assert/strict";
import { test } from "node:test";

import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  observeSelectorProject,
  runSelectorCycle,
  type SelectorRuntimeControlStore,
  type SelectorRuntimeSettings,
  type SelectorPolicyExecution,
  type SelectorPolicyHost,
  type SelectorPolicyRequest,
  type JsonValue,
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
import { selectorPlanning } from "../../src/interpreter/selectorPlanning.ts";

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

function waitingExecution(
  workingMemory: JsonValue = {},
): SelectorPolicyExecution {
  return {
    result: { attention: "Monitoring", workingMemory },
    toolActivity: [],
    implementationRevision: "implementation-1",
    modelRevision: "model-1",
    policyRevision: "policy-1",
    accounting: { tokens: 100, durationMs: 1_000 },
    startedAt: "2026-08-21T12:00:00.000Z",
    completedAt: "2026-08-21T12:00:01.000Z",
  };
}

function policyHost(
  execute: (request: SelectorPolicyRequest) => Promise<unknown>,
  terminate: (reason: unknown) => Promise<void> = () => Promise.resolve(),
): SelectorPolicyHost {
  return {
    start: (request) => ({ result: execute(request), terminate }),
  };
}

function promptObservationSource() {
  return {
    decisionDeadline: () => new Promise<never>(() => undefined),
    notifications: () =>
      Promise.resolve({ result: "Events", cursor: 1, events: [] } as const),
    currentTimeEpochMs: () =>
      Promise.resolve(operationalContext.observedAtEpochMs),
    currentInstant: () => Promise.resolve(operationalContext.observedAt),
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
    recordInteraction: () => Promise.resolve(true),
    record: () => Promise.resolve(true),
    pending: () => Promise.resolve([]),
    submittedDeliveries: () => Promise.resolve([]),
    submitted: () => Promise.resolve(),
    terminal: (_decision, outcome) => {
      onTerminal(outcome);
      return Promise.resolve();
    },
    history: () => Promise.resolve([]),
    project: () => Promise.resolve(undefined),
    planningIntent: () => Promise.resolve(undefined),
  };
}

test("selector observation resumes from a reset cursor and pins every view page", async () => {
  const watermarks: (number | undefined)[] = [];
  const observed = await observeSelectorProject(
    {
      partition,
      notificationCursor: 3,
      revision: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    {
      notifications: () => Promise.resolve({ result: "Reset", cursor: 12 }),
      decisionDeadline: () => new Promise<never>(() => undefined),
      currentTimeEpochMs: () =>
        Promise.resolve(operationalContext.observedAtEpochMs),
      currentInstant: () => Promise.resolve(operationalContext.observedAt),
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
      revision: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    {
      notifications: () =>
        Promise.resolve({ result: "Events", cursor: 0, events: [] } as const),
      decisionDeadline: () => new Promise<never>(() => undefined),
      currentTimeEpochMs: () =>
        Promise.resolve(operationalContext.observedAtEpochMs),
      currentInstant: () => Promise.resolve(operationalContext.observedAt),
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
      currentInstant: () =>
        Promise.reject(new Error("paused runtime read the instant")),
      dispatchView: () =>
        Promise.reject(new Error("paused runtime read a view")),
      operationalContext: () =>
        Promise.reject(new Error("paused runtime read operational context")),
      submit: () => Promise.reject(new Error("there was no pending delivery")),
      operation: () =>
        Promise.reject(new Error("there was no submitted delivery")),
    },
    policyHost(() =>
      Promise.reject(new Error("paused runtime invoked its policy")),
    ),
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
    failures: [],
  });
  assert.equal(pendingReads, 1);
});

test("inventory progress follows scanned projects when a permit is unavailable", async () => {
  const first = { tenant: partition.tenant, project: asProjectId("first") };
  const second = { tenant: partition.tenant, project: asProjectId("second") };
  let saved: typeof partition | undefined;
  const result = await selectorRunOnce(
    {
      ...stateStore(() => undefined),
      saveInventoryCursor: (cursor) => {
        saved = cursor;
        return Promise.resolve();
      },
    },
    {
      projects: () =>
        Promise.resolve({ projects: [first, second], nextAfter: second }),
      acquireDecisionPermit: (scope) =>
        Promise.resolve(scope === first ? undefined : "permit"),
      releaseDecisionPermit: () => Promise.resolve(),
      notifications: () =>
        Promise.resolve({ result: "Events", cursor: 1, events: [] } as const),
      decisionDeadline: () => new Promise<never>(() => undefined),
      currentTimeEpochMs: () =>
        Promise.resolve(operationalContext.observedAtEpochMs),
      currentInstant: () => Promise.resolve(operationalContext.observedAt),
      dispatchView: (scope) =>
        Promise.resolve({
          result: "Page",
          token: {
            ...scope,
            recoveryEpoch: "epoch",
            schemaVersion: 1,
            watermark: 1,
            digest: "d".repeat(64),
          },
          candidates: [],
          notificationCursor: 1,
        } as const),
      operationalContext: () => Promise.resolve(operationalContext),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() => Promise.resolve(waitingExecution())),
    {
      next: () => ({
        operation: asOperationId("inventory-operation"),
        selectorDecisionReference: "inventory-decision",
      }),
    },
    { settings: () => Promise.resolve(runtimeSettings) },
    { projectsMax: 2, deliveriesMax: 1, reconciliationsMax: 1 },
  );
  assert.equal(result.observed, 1);
  assert.deepEqual(saved, second);
});

test("a pause observed after permit acquisition prevents a new decision", async () => {
  let settingsReads = 0;
  let releases = 0;
  const result = await selectorRunOnce(
    stateStore(() => undefined),
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [partition] }),
      acquireDecisionPermit: () => Promise.resolve("permit"),
      releaseDecisionPermit: () => {
        releases += 1;
        return Promise.resolve();
      },
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() =>
      Promise.reject(new Error("paused runtime invoked its policy")),
    ),
    {
      next: () => ({
        operation: asOperationId("pause-race-operation"),
        selectorDecisionReference: "pause-race-decision",
      }),
    },
    {
      settings: () => {
        settingsReads += 1;
        return Promise.resolve({
          ...runtimeSettings,
          mode: settingsReads === 3 ? "Paused" : "Running",
        });
      },
    },
  );
  assert.deepEqual(result, {
    observed: 0,
    proposed: 0,
    delivered: 0,
    reconciled: 0,
    failures: [],
  });
  assert.equal(releases, 1);
});

test("a selector decision uses and records one hot-loaded prompt revision", async () => {
  const settings: SelectorRuntimeSettings = {
    ...runtimeSettings,
    revision: 7,
    basePrompt: "prioritize tickets that unblock dependants",
  };
  let recorded = "";
  let constrainedPrompt = "";
  let allowedModels: readonly string[] = [];
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    promptObservationSource(),
    {
      ...stateStore(() => undefined),
      recordInteraction: (interaction) => {
        recorded = interaction.instructions;
        return Promise.resolve(true);
      },
    },
    policyHost((request) => {
      constrainedPrompt = request.instructions.content;
      allowedModels = request.constraints.models;
      return Promise.resolve(
        waitingExecution({ note: "watch the dependency closure" }),
      );
    }),
    {
      operation: asOperationId("prompt-operation"),
      selectorDecisionReference: "prompt-decision",
    },
    settings,
  );
  assert.equal(recorded, settings.basePrompt);
  assert.equal(constrainedPrompt, settings.basePrompt);
  assert.deepEqual(allowedModels, settings.modelAllowlist);
});

test("current selector planning is project-authorized and cursor-free", async () => {
  const plan = {
    selectorDecision: "planned-decision",
    intent: { tickets: [3, 5] },
    updatedAt: "2026-08-21T12:00:00.000Z",
  };
  const planning = selectorPlanning(
    {
      authorize: (principal) =>
        Promise.resolve(
          principal === asPrincipal("reader")
            ? {
                kind: asAuthorityKind("User"),
                subject: asAuthoritySubject("reader"),
              }
            : undefined,
        ),
    },
    { planningIntent: () => Promise.resolve(plan) },
  );
  assert.deepEqual(await planning.current(asPrincipal("reader"), partition), {
    result: "Found",
    planningIntent: plan,
  });
  assert.deepEqual(await planning.current(asPrincipal("outsider"), partition), {
    result: "NotFound",
  });
});

test("the runtime deadline hard-terminates its sandbox before returning", async () => {
  let aborted = false;
  let recordedFailure: JsonValue | undefined;
  const result = await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    {
      ...promptObservationSource(),
      currentInstant: () => Promise.resolve("2026-08-21T12:00:02.000Z"),
      decisionDeadline: () =>
        Promise.reject(new Error("decision deadline exceeded")),
    },
    {
      ...stateStore(() => undefined),
      recordInteraction: (interaction) => {
        recordedFailure = interaction.result;
        return Promise.resolve(true);
      },
    },
    policyHost(
      () => new Promise(() => undefined),
      () => {
        aborted = true;
        return Promise.resolve();
      },
    ),
    {
      operation: asOperationId("timed-operation"),
      selectorDecisionReference: "timed-decision",
    },
    runtimeSettings,
  );
  assert.equal(result, undefined);
  assert.equal(aborted, true);
  assert.deepEqual(recordedFailure, {
    outcome: "Failed",
    code: "DeadlineExceeded",
  });
});

test("sandbox constraints and observations are immutable", async () => {
  let mutationRejected = false;
  let observationMutationRejected = false;
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    promptObservationSource(),
    stateStore(() => undefined),
    policyHost((request) => {
      try {
        (request.constraints.models as string[]).push("forbidden");
      } catch {
        mutationRejected = true;
      }
      try {
        (request.observation.candidates as unknown[]).push({});
      } catch {
        observationMutationRejected = true;
      }
      return Promise.resolve(waitingExecution());
    }),
    {
      operation: asOperationId("enforcement-operation"),
      selectorDecisionReference: "enforcement-decision",
    },
    { ...runtimeSettings, modelAllowlist: ["model-1"], toolAllowlist: [] },
  );
  assert.equal(mutationRejected, true);
  assert.equal(observationMutationRejected, true);
  assert.deepEqual(runtimeSettings.modelAllowlist, ["*"]);
});

test("a rejected measured execution retains its available provenance", async () => {
  let interaction:
    Parameters<SelectorStateStore["recordInteraction"]>[0] | undefined;
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    promptObservationSource(),
    {
      ...stateStore(() => undefined),
      recordInteraction: (recorded) => {
        interaction = recorded;
        return Promise.resolve(true);
      },
    },
    policyHost(() => Promise.resolve(waitingExecution())),
    {
      operation: asOperationId("rejected-operation"),
      selectorDecisionReference: "rejected-decision",
    },
    { ...runtimeSettings, modelAllowlist: ["another-model"] },
  );
  assert.deepEqual(interaction?.result, {
    outcome: "Failed",
    code: "ControlViolation",
  });
  assert.equal(interaction?.modelRevision, "model-1");
  assert.deepEqual(interaction?.accounting, {
    tokens: 100,
    durationMs: 1_000,
  });
  assert.equal(interaction?.startedAt, "2026-08-21T12:00:00.000Z");
  assert.equal(interaction?.completedAt, "2026-08-21T12:00:01.000Z");
});

test("structurally invalid JSON is audited instead of reaching persistence", async () => {
  let recordedFailure: JsonValue | undefined;
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    promptObservationSource(),
    {
      ...stateStore(() => undefined),
      recordInteraction: (recorded) => {
        recordedFailure = recorded.result;
        return Promise.resolve(true);
      },
    },
    policyHost(() => Promise.resolve({ ...waitingExecution(), result: null })),
    {
      operation: asOperationId("malformed-operation"),
      selectorDecisionReference: "malformed-decision",
    },
    runtimeSettings,
  );
  assert.deepEqual(recordedFailure, {
    outcome: "Failed",
    code: "InvalidResult",
  });
});

test("unpersistable selector input is rejected before sandbox execution", async () => {
  let started = false;
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    {
      ...promptObservationSource(),
      operationalContext: () =>
        Promise.resolve({
          ...operationalContext,
          projectCapacity: {
            ...operationalContext.projectCapacity,
            account: "x".repeat(70_000),
          },
        }),
    },
    stateStore(() => undefined),
    policyHost(() => {
      started = true;
      return Promise.resolve(waitingExecution());
    }),
    {
      operation: asOperationId("oversized-operation"),
      selectorDecisionReference: "oversized-decision",
    },
    runtimeSettings,
  ).catch(() => undefined);
  assert.equal(started, false);
});

test("invalid policy JSON is recorded as a bounded failed interaction", async () => {
  let recordedFailure: JsonValue | undefined;
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      workingMemory: {},
    },
    promptObservationSource(),
    {
      ...stateStore(() => undefined),
      recordInteraction: (interaction) => {
        recordedFailure = interaction.result;
        return Promise.resolve(true);
      },
    },
    policyHost(() =>
      Promise.resolve(
        waitingExecution({ invalid: BigInt(1) } as unknown as JsonValue),
      ),
    ),
    {
      operation: asOperationId("invalid-json-operation"),
      selectorDecisionReference: "invalid-json-decision",
    },
    runtimeSettings,
  );
  assert.deepEqual(recordedFailure, {
    outcome: "Failed",
    code: "InvalidResult",
  });
});

test("one project failure does not block later projects or durable delivery", async () => {
  const broken = { tenant: partition.tenant, project: asProjectId("broken") };
  const healthy = { tenant: partition.tenant, project: asProjectId("healthy") };
  const result = await selectorRunOnce(
    {
      ...stateStore(() => undefined),
      pending: () => Promise.resolve([delivery]),
    },
    {
      projects: () => Promise.resolve({ projects: [broken, healthy] }),
      acquireDecisionPermit: (scope) => Promise.resolve(scope.project),
      releaseDecisionPermit: () => Promise.resolve(),
      notifications: (scope) =>
        scope === broken
          ? Promise.reject(new Error("broken project feed"))
          : Promise.resolve({ result: "Events", cursor: 1, events: [] }),
      decisionDeadline: () => new Promise<never>(() => undefined),
      currentTimeEpochMs: () =>
        Promise.resolve(operationalContext.observedAtEpochMs),
      currentInstant: () => Promise.resolve(operationalContext.observedAt),
      dispatchView: (scope) =>
        Promise.resolve({
          result: "Page",
          token: {
            ...scope,
            recoveryEpoch: "epoch",
            schemaVersion: 1,
            watermark: 1,
            digest: "f".repeat(64),
          },
          candidates: [],
          notificationCursor: 1,
        }),
      operationalContext: () => Promise.resolve(operationalContext),
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
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() => Promise.resolve(waitingExecution())),
    {
      next: (scope) => ({
        operation: asOperationId(`operation-${scope.project}`),
        selectorDecisionReference: `decision-${scope.project}`,
      }),
    },
    { settings: () => Promise.resolve(runtimeSettings) },
    { projectsMax: 2, deliveriesMax: 1, reconciliationsMax: 1 },
  );
  assert.equal(result.observed, 1);
  assert.equal(result.delivered, 1);
  assert.deepEqual(result.failures, [
    { phase: "Observation", partition: broken },
  ]);
});

test("one reconciliation failure does not abandon the rest of its claim", async () => {
  const later = {
    ...delivery,
    decision: "later-decision",
    operation: asOperationId("later-operation"),
  };
  let terminal = 0;
  const result = await selectorRunOnce(
    {
      ...stateStore(() => {
        terminal += 1;
      }),
      submittedDeliveries: () => Promise.resolve([delivery, later]),
    },
    {
      projects: () =>
        Promise.reject(new Error("paused selector listed projects")),
      acquireDecisionPermit: () => Promise.resolve(undefined),
      releaseDecisionPermit: () => Promise.resolve(),
      notifications: () => Promise.reject(new Error("no observation")),
      decisionDeadline: () => new Promise<never>(() => undefined),
      currentTimeEpochMs: () => Promise.resolve(0),
      currentInstant: () => Promise.resolve(operationalContext.observedAt),
      dispatchView: () => Promise.resolve({ result: "Reset" }),
      operationalContext: () => Promise.resolve(operationalContext),
      submit: () => Promise.reject(new Error("no pending delivery")),
      operation: (_scope, operation) =>
        operation === delivery.operation
          ? Promise.reject(new Error("temporary operation read failure"))
          : Promise.resolve({ state: "Succeeded" }),
    },
    policyHost(() => Promise.resolve(waitingExecution())),
    {
      next: () => ({
        operation: asOperationId("unused"),
        selectorDecisionReference: "unused",
      }),
    },
    {
      settings: () => Promise.resolve({ ...runtimeSettings, mode: "Paused" }),
    },
    { projectsMax: 1, deliveriesMax: 1, reconciliationsMax: 2 },
  );
  assert.equal(result.reconciled, 1);
  assert.equal(terminal, 1);
  assert.deepEqual(result.failures, [
    {
      phase: "Reconciliation",
      partition,
      decision: delivery.decision,
    },
  ]);
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
      awaitingApproval: () => Promise.resolve([delivery]),
      approve: (_partition, _decision, _reviewer, feedback) => {
        approvedFeedback = feedback;
        return Promise.resolve(true);
      },
      reject: () => Promise.resolve(false),
      reviewFeedback: () => Promise.resolve([]),
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
    history: () =>
      Promise.resolve([
        {
          settings: runtimeSettings,
          administrator: {
            kind: asAuthorityKind("System"),
            subject: asAuthoritySubject("test"),
          },
          recordedAt: "2026-08-21T12:00:00.000Z",
        },
      ]),
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
        Promise.resolve(
          principal === asPrincipal("admin")
            ? {
                kind: asAuthorityKind("Administrator"),
                subject: asAuthoritySubject("admin"),
              }
            : undefined,
        ),
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
