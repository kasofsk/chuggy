import assert from "node:assert/strict";
import { test } from "node:test";

import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  dryRunSelectorPolicy,
  leadDispatchesMax,
  observeSelectorProject,
  runObservedSelectorCycle,
  runSelectorCycle,
  resolvedSelectorSettings,
  selectorBacklogsAdmitDispatch,
  selectorDispatchOperation,
  type SelectorDecisionProposals,
  type SelectorInteraction,
  type SelectorProjectOverrides,
  type SelectorRuntimeControlStore,
  type SelectorRuntimeSettings,
  type SelectorRuntimeSettingsSource,
  type SelectorPolicyExecution,
  type SelectorPolicyHost,
  type SelectorPolicyRequest,
  type SelectorObservation,
  type SelectorProjectState,
  type JsonValue,
} from "../../src/interpreter/selector.ts";
import {
  deliverSelectorProposal,
  reconcileSelectorProposal,
  type SelectorDelivery,
  type SelectorStateStore,
} from "../../src/interpreter/selector.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { randomOf, subsetFrom } from "../random/random.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asOperationId,
  operationIdentityCharsMax,
} from "../../src/interpreter/operationInbox.ts";
import { selectorRunOnce } from "../../src/interpreter/selectorRuntime.ts";
import type { AgenticRefusalWrite } from "../../src/interpreter/agenticRefusal.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import { selectorProposalReviews } from "../../src/interpreter/selectorReview.ts";
import { selectorRuntimeAdministration } from "../../src/interpreter/selectorAdmin.ts";
import { selectorPlanning } from "../../src/interpreter/selectorPlanning.ts";
import { selectorOperationalContext } from "./selectorFixture.ts";
import { selectorPolicyHost } from "../../src/interpreter/selectorPolicyHost.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const delivery: SelectorDelivery = {
  decision: "decision",
  ticket: asTicketId(1),
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

const operationalContext = selectorOperationalContext;

test("selector backlog admission requires room under both ceilings", () => {
  assert.equal(selectorBacklogsAdmitDispatch(operationalContext.backlog), true);
  assert.equal(
    selectorBacklogsAdmitDispatch({
      ...operationalContext.backlog,
      project: { queued: 100, ceiling: 100 },
    }),
    false,
  );
  assert.equal(
    selectorBacklogsAdmitDispatch({
      ...operationalContext.backlog,
      installation: { queued: 1_000, ceiling: 1_000 },
    }),
    false,
  );
});

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
    dispatchesPerDecision: 1,
    inputBytesPerDecision: 1_048_576,
    candidatePagesPerDecision: 1,
    concurrentDecisions: 4,
    selectionsPerMinute: 60,
  },
  operationalContextMaxAgeMs: 30_000,
};

/** The installation defaults as one project resolves them, overriding nothing. */
function resolved(
  settings: SelectorRuntimeSettings = runtimeSettings,
): ReturnType<typeof resolvedSelectorSettings> {
  return resolvedSelectorSettings(partition, settings, 0, {});
}

/** One project's view, exhausted, which is the shape a policy is handed. */
function exhaustedObservation(): SelectorObservation {
  const token = {
    ...partition,
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: 1,
    digest: "a".repeat(64),
  };
  return {
    token,
    candidates: [],
    notificationCursor: 0,
    changes: [],
    operationalContext,
    handoffNote: {},
    nextCandidateScan: { state: "Exhausted", token },
  };
}

/** A source whose every project resolves the installation defaults it is given. */
function settingsSource(
  read: () => Promise<SelectorRuntimeSettings>,
): SelectorRuntimeSettingsSource {
  return {
    settings: read,
    projectSettings: async (of) =>
      resolvedSelectorSettings(of, await read(), 0, {}),
  };
}

function waitingExecution(
  handoffNote: JsonValue = {},
): SelectorPolicyExecution {
  return {
    result: {
      dispatches: [],
      refusals: [],
      lifts: [],
      attention: "Monitoring",
      handoffNote,
    },
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
  terminate: (
    reason: unknown,
  ) => Promise<
    | { readonly status: "Terminated"; readonly proof: string }
    | { readonly status: "Unconfirmed" }
  > = () =>
    Promise.resolve({ status: "Terminated", proof: "test-host-termination" }),
): SelectorPolicyHost {
  return {
    productionReady: true,
    start: (request) => ({
      result: execute(request),
      terminate: async (reason) => {
        const result = await terminate(reason);
        return result.status === "Terminated"
          ? { ...result, attempt: request.attempt }
          : result;
      },
    }),
    reconcileQuarantined: () => Promise.resolve({ status: "Unconfirmed" }),
  };
}

const movedPage = { result: "Events", cursor: 1, events: [] } as const;

/** A ledger that answers, and records what one decision entered in it. */
function refusalWrites(
  onRecord: (
    input: Parameters<AgenticRefusalWrite["record"]>[0],
  ) => void = () => undefined,
): AgenticRefusalWrite {
  return {
    record: (input) => {
      onRecord(input);
      return Promise.resolve("Recorded");
    },
  };
}

function promptObservationSource() {
  return {
    decisionDeadline: () => new Promise<never>(() => undefined),
    notifications: () => Promise.resolve(movedPage),
    moved: () => Promise.resolve(movedPage),
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

/** One identity per project, so a sweep over several names each decision after its own. */
function perProjectIdentities() {
  return {
    next: (scope: typeof partition) => ({
      operation: asOperationId(`operation-${scope.project}`),
      selectorDecisionReference: `decision-${scope.project}`,
    }),
  };
}

function emptyDispatchPage(scope: typeof partition, digest: string) {
  return {
    result: "Page",
    token: {
      ...scope,
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 1,
      digest,
    },
    candidates: [],
    notificationCursor: 1,
  } as const;
}

function stateStore(
  onTerminal: (outcome: unknown) => void,
): SelectorStateStore {
  return {
    setAutomaticReadiness: () => Promise.resolve(),
    allocateAttempt: () => Promise.resolve(true),
    runningAttempt: () => Promise.resolve(),
    quarantineAttempt: () => Promise.resolve(),
    terminateAttempt: () => Promise.resolve(),
    quarantinedAttempts: () => Promise.resolve([]),
    inventoryCursor: () => Promise.resolve(undefined),
    saveInventoryCursor: () => Promise.resolve(),
    recordInteraction: () => Promise.resolve(true),
    record: () => Promise.resolve(1),
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
      handoffNote: {},
    },
    {
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
    { result: "Reset", cursor: 12 },
  );
  assert.equal(observed?.notificationCursor, 12);
  assert.deepEqual(watermarks, [undefined]);
  assert.deepEqual(observed?.changes, []);
});

test("an observation carries the notification page that triggered it", async () => {
  const events = [
    { ordinal: 4, kind: "Ticket", resource: "3" },
    { ordinal: 5, kind: "Operation", resource: "operation-one" },
  ] as const;
  const observed = await observeSelectorProject(
    {
      partition,
      notificationCursor: 3,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    promptObservationSource(),
    { result: "Events", cursor: 5, events },
  );
  assert.deepEqual(observed?.changes, events);
  assert.equal(observed?.notificationCursor, 5);
});

test("selector observation restarts a continued scan when its view resets", async () => {
  let page = 0;
  const observed = await observeSelectorProject(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
      candidateScan: {
        state: "Continue",
        token: {
          ...partition,
          recoveryEpoch: "old-epoch",
          schemaVersion: 1,
          watermark: 1,
          digest: "b".repeat(64),
        },
        after: asTicketId(1),
      },
    },
    {
      operationalContext: () => Promise.resolve(operationalContext),
      dispatchView: () => {
        page += 1;
        if (page === 1) return Promise.resolve({ result: "Reset" } as const);
        return Promise.resolve({
          result: "Page",
          token: {
            ...partition,
            recoveryEpoch: "epoch",
            schemaVersion: 1,
            watermark: 2,
            digest: "b".repeat(64),
          },
          candidates: [],
          notificationCursor: 0,
        } as const);
      },
    },
    movedPage,
  );
  assert.equal(observed?.token.watermark, 2);
  assert.equal(page, 2);
});

test("an oversized final candidate advances the scan to Exhausted", async () => {
  const candidate = {
    ticket: asTicketId(1),
    ticketVersion: 1,
    dependencies: [],
    workFanout: 1,
    program: [{ fanout: 1, combinator: "UnanimousPass" }],
    reworkPolicy: { type: "BudgetedRework", value: 1 },
    finalizationPricing: "DeadlineOnly",
    resumePricing: "RetryCharged",
    finalizer: "NoFinalizer",
    configurationRevision: "revision",
    configurationDigest: "d".repeat(64),
    configurationCanonical: "x".repeat(1_000),
  } as const;
  const source = {
    ...promptObservationSource(),
    dispatchView: () =>
      Promise.resolve({
        result: "Page",
        token: {
          ...partition,
          recoveryEpoch: "epoch",
          schemaVersion: 1,
          watermark: 9,
          digest: "f".repeat(64),
        },
        candidates: [candidate],
        notificationCursor: 1,
      } as const),
  };
  const observation = await observeSelectorProject(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
      candidateScan: { state: "Unstarted" },
    },
    source,
    movedPage,
    10,
    100,
  );
  assert.equal(observation?.resourceLimit, "CandidateTooLarge");
  assert.deepEqual(observation?.candidates, []);
  assert.equal(observation?.nextCandidateScan.state, "Exhausted");
  assert.equal(
    await observeSelectorProject(
      {
        partition,
        notificationCursor: 1,
        revision: 1,
        attention: "Attention",
        handoffNote: {},
        candidateScan: observation?.nextCandidateScan,
      },
      source,
      { result: "Events", cursor: 2, events: [] },
      10,
      100,
    ),
    undefined,
  );
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
    refusalWrites(),
    store,
    {
      projects: () =>
        Promise.reject(new Error("paused runtime listed projects")),
      notifications: () =>
        Promise.reject(new Error("paused runtime observed a project")),
      moved: () =>
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
    settingsSource(() =>
      Promise.resolve({ ...runtimeSettings, revision: 4, mode: "Paused" }),
    ),
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
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      allocateAttempt: (_attempt, scope) => Promise.resolve(scope !== first),
      saveInventoryCursor: (cursor) => {
        saved = cursor;
        return Promise.resolve();
      },
    },
    {
      projects: () =>
        Promise.resolve({ projects: [first, second], nextAfter: second }),
      notifications: () => Promise.resolve(movedPage),
      moved: () => Promise.resolve(movedPage),
      decisionDeadline: () => new Promise<never>(() => undefined),
      currentTimeEpochMs: () =>
        Promise.resolve(operationalContext.observedAtEpochMs),
      currentInstant: () => Promise.resolve(operationalContext.observedAt),
      dispatchView: (scope) =>
        Promise.resolve(emptyDispatchPage(scope, "d".repeat(64))),
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
    settingsSource(() => Promise.resolve(runtimeSettings)),
    { projectsMax: 2, deliveriesMax: 1, reconciliationsMax: 1 },
  );
  assert.equal(result.observed, 1);
  assert.deepEqual(saved, second);
});

test("one project's pause skips that project and the sweep carries on", async () => {
  const paused = { tenant: partition.tenant, project: asProjectId("paused") };
  const running = { tenant: partition.tenant, project: asProjectId("running") };
  const allocated: string[] = [];
  let installationReads = 0;
  const result = await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      allocateAttempt: (_attempt, scope) => {
        allocated.push(scope.project);
        return Promise.resolve(true);
      },
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [paused, running] }),
      dispatchView: (scope) =>
        Promise.resolve(emptyDispatchPage(scope, "e".repeat(64))),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() => Promise.resolve(waitingExecution())),
    perProjectIdentities(),
    {
      settings: () => {
        installationReads += 1;
        return Promise.resolve(runtimeSettings);
      },
      projectSettings: (of) =>
        Promise.resolve(
          resolvedSelectorSettings(
            of,
            runtimeSettings,
            1,
            of.project === paused.project ? { mode: "Paused" } : {},
          ),
        ),
    },
    { projectsMax: 2, deliveriesMax: 1, reconciliationsMax: 1 },
  );
  assert.deepEqual(allocated, [running.project]);
  assert.equal(result.observed, 1);
  assert.deepEqual(result.failures, []);
  assert.equal(installationReads, 1);
});

/**
 * A sweep over two projects whose settings the case answers per project and per
 * read, so a case can move one project's settings between the read that takes
 * its permit and the re-read that fences its decision.
 */
interface SweptSweep {
  readonly projects: readonly (typeof partition)[];
  readonly overrides?: (
    of: typeof partition,
    read: number,
  ) => SelectorProjectOverrides;
  /** What the installation says when the sweep asks whether to run at all. */
  readonly installation?: SelectorRuntimeSettings;
  /**
   * What a project's settings resolve against on its Nth read, so a case can
   * move the installation between the read that takes a permit and the re-read
   * that fences the decision.
   */
  readonly resolvedAgainst?: (
    of: typeof partition,
    read: number,
  ) => SelectorRuntimeSettings;
  /** The project's own revision on its Nth read, which is half of the fence. */
  readonly projectRevision?: (of: typeof partition, read: number) => number;
  readonly nextAfter?: typeof partition;
}

async function sweptProjects(sweep: SweptSweep) {
  const projects = sweep.projects;
  const resolve = sweep.overrides ?? (() => ({}));
  const installation = sweep.installation ?? runtimeSettings;
  const resolvedAgainst = sweep.resolvedAgainst ?? (() => installation);
  const projectRevision = sweep.projectRevision ?? (() => 1);
  const nextAfter = sweep.nextAfter;
  const reads = new Map<string, number>();
  const terminated: string[] = [];
  const saved: (typeof partition | undefined)[] = [];
  let inventoryReads = 0;
  const result = await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      terminateAttempt: (attempt) => {
        terminated.push(attempt);
        return Promise.resolve();
      },
      saveInventoryCursor: (cursor) => {
        saved.push(cursor);
        return Promise.resolve();
      },
    },
    {
      ...promptObservationSource(),
      projects: () => {
        inventoryReads += 1;
        return Promise.resolve({
          projects: [...projects],
          ...(nextAfter === undefined ? {} : { nextAfter }),
        });
      },
      dispatchView: (scope) =>
        Promise.resolve(emptyDispatchPage(scope, "f".repeat(64))),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() => Promise.resolve(waitingExecution())),
    perProjectIdentities(),
    {
      settings: () => Promise.resolve(installation),
      projectSettings: (of) => {
        const read = (reads.get(of.project) ?? 0) + 1;
        reads.set(of.project, read);
        return Promise.resolve(
          resolvedSelectorSettings(
            of,
            resolvedAgainst(of, read),
            projectRevision(of, read),
            resolve(of, read),
          ),
        );
      },
    },
    {
      projectsMax: Math.max(projects.length, 1),
      deliveriesMax: 1,
      reconciliationsMax: 1,
    },
  );
  return { result, terminated, saved, inventoryReads };
}

test("a project paused mid-decision leaves the rest of the sweep alone", async () => {
  const first = { tenant: partition.tenant, project: asProjectId("first") };
  const second = { tenant: partition.tenant, project: asProjectId("second") };
  const swept = await sweptProjects({
    projects: [first, second],
    overrides: (of, read) =>
      of.project === first.project && read > 1 ? { mode: "Paused" } : {},
  });
  assert.deepEqual(swept.terminated, [`decision-${first.project}`]);
  assert.equal(swept.result.observed, 1);
  assert.deepEqual(swept.result.failures, []);
  assert.deepEqual(swept.saved, [undefined]);
});

test("a project's own fence moving mid-decision does not stop the sweep", async () => {
  const first = { tenant: partition.tenant, project: asProjectId("fenced") };
  const second = {
    tenant: partition.tenant,
    project: asProjectId("untouched"),
  };
  const swept = await sweptProjects({
    projects: [first, second],
    nextAfter: second,
    projectRevision: (of, read) =>
      of.project === first.project && read > 1 ? 2 : 1,
  });
  assert.deepEqual(swept.terminated, [`decision-${first.project}`]);
  assert.equal(swept.result.observed, 1);
  assert.deepEqual(swept.result.failures, []);
  assert.deepEqual(swept.saved, [second]);
});

/** An installation paused after this project's permit was taken, and not before. */
function pausedOnReread(
  _of: typeof partition,
  read: number,
): SelectorRuntimeSettings {
  return read > 1 ? { ...runtimeSettings, mode: "Paused" } : runtimeSettings;
}

test("an installation pause mid-decision stops the sweep where it stood", async () => {
  const first = { tenant: partition.tenant, project: asProjectId("halted") };
  const second = {
    tenant: partition.tenant,
    project: asProjectId("unreached"),
  };
  const swept = await sweptProjects({
    projects: [first, second],
    nextAfter: second,
    resolvedAgainst: pausedOnReread,
  });
  assert.deepEqual(swept.terminated, [`decision-${first.project}`]);
  assert.equal(swept.result.observed, 0);
  assert.deepEqual(swept.saved, []);
});

/**
 * The cursor rule at every index a sweep can stop on, because a rule stated for
 * one index is a rule two of its three branches are unexamined at.
 */
test("the cursor moves over the projects a sweep consumed and no further", async () => {
  const page = ["alpha", "beta", "gamma", "delta"].map((name) => ({
    tenant: partition.tenant,
    project: asProjectId(name),
  }));
  const beyond = { tenant: partition.tenant, project: asProjectId("epsilon") };
  for (const [stopAt, expected] of page.map(
    (_project, index) => [index, page.at(index - 1)] as const,
  )) {
    const swept = await sweptProjects({
      projects: page,
      nextAfter: beyond,
      resolvedAgainst: (of, read) =>
        of.project === page[stopAt]?.project
          ? pausedOnReread(of, read)
          : runtimeSettings,
    });
    assert.equal(swept.result.observed, stopAt, `stopped at ${String(stopAt)}`);
    assert.deepEqual(
      swept.saved,
      stopAt === 0 ? [] : [expected],
      `stopped at ${String(stopAt)}`,
    );
  }
  const whole = await sweptProjects({ projects: page, nextAfter: beyond });
  assert.equal(whole.result.observed, page.length);
  assert.deepEqual(whole.saved, [beyond]);
});

test("a paused installation reads no inventory and moves no cursor", async () => {
  const page = ["kept-one", "kept-two"].map((name) => ({
    tenant: partition.tenant,
    project: asProjectId(name),
  }));
  const beyond = { tenant: partition.tenant, project: asProjectId("unread") };
  const swept = await sweptProjects({
    projects: page,
    nextAfter: beyond,
    installation: { ...runtimeSettings, mode: "Paused" },
  });
  assert.equal(swept.inventoryReads, 0);
  assert.deepEqual(swept.saved, []);
  assert.equal(swept.result.observed, 0);
  assert.deepEqual(swept.result.failures, []);
});

test("an installation pause seen before a permit stops the sweep and moves nothing", async () => {
  const page = ["untried-one", "untried-two"].map((name) => ({
    tenant: partition.tenant,
    project: asProjectId(name),
  }));
  const beyond = { tenant: partition.tenant, project: asProjectId("beyond") };
  const swept = await sweptProjects({
    projects: page,
    nextAfter: beyond,
    resolvedAgainst: () => ({ ...runtimeSettings, mode: "Paused" }),
  });
  assert.equal(swept.inventoryReads, 1);
  assert.deepEqual(swept.terminated, []);
  assert.equal(swept.result.observed, 0);
  assert.deepEqual(swept.saved, []);
});

test("an exhausted inventory wraps rather than standing still", async () => {
  const page = ["only-one", "only-two"].map((name) => ({
    tenant: partition.tenant,
    project: asProjectId(name),
  }));
  const lastPage = await sweptProjects({ projects: page });
  assert.equal(lastPage.result.observed, page.length);
  assert.deepEqual(lastPage.saved, [undefined]);
  const emptyPage = await sweptProjects({ projects: [] });
  assert.deepEqual(emptyPage.saved, [undefined]);
});

test("a pause observed after permit acquisition prevents a new decision", async () => {
  let settingsReads = 0;
  let releases = 0;
  const result = await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      terminateAttempt: () => {
        releases += 1;
        return Promise.resolve();
      },
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [partition] }),
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
      settings: () => Promise.resolve(runtimeSettings),
      projectSettings: (of) => {
        settingsReads += 1;
        return Promise.resolve(
          resolvedSelectorSettings(
            of,
            {
              ...runtimeSettings,
              mode: settingsReads === 2 ? "Paused" : "Running",
            },
            0,
            {},
          ),
        );
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

test("a stale persisted observation releases its permit without starting policy", async () => {
  let releases = 0;
  let started = false;
  const observation = await observeSelectorProject(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    promptObservationSource(),
    movedPage,
  );
  assert.ok(observation !== undefined);
  await runObservedSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    observation,
    {
      ...promptObservationSource(),
      currentTimeEpochMs: () =>
        Promise.resolve(
          operationalContext.observedAtEpochMs +
            runtimeSettings.operationalContextMaxAgeMs +
            1,
        ),
    },
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      terminateAttempt: () => {
        releases += 1;
        return Promise.resolve();
      },
    },
    policyHost(() => {
      started = true;
      return Promise.resolve(waitingExecution());
    }),
    {
      operation: asOperationId("stale-operation"),
      selectorDecisionReference: "stale-decision",
    },
    resolved(),
  );
  assert.equal(started, false);
  assert.equal(releases, 1);
});

test("unconfirmed attempt reconciliation yields to newer attempts", async () => {
  let deferred = 0;
  await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      quarantinedAttempts: () => Promise.resolve(["old-attempt"]),
      quarantineAttempt: () => {
        deferred += 1;
        return Promise.resolve();
      },
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [] }),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() => Promise.resolve(waitingExecution())),
    {
      next: () => ({
        operation: asOperationId("unused"),
        selectorDecisionReference: "unused",
      }),
    },
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.equal(deferred, 1);
});

test("one failed attempt inspection does not starve later quarantines", async () => {
  const inspected: string[] = [];
  const rotated: string[] = [];
  const result = await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      quarantinedAttempts: () => Promise.resolve(["poisoned", "healthy"]),
      quarantineAttempt: (attempt) => {
        rotated.push(attempt);
        return Promise.resolve();
      },
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [] }),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    {
      ...policyHost(() => Promise.resolve(waitingExecution())),
      reconcileQuarantined: (attempt) => {
        inspected.push(attempt);
        return attempt === "poisoned"
          ? Promise.reject(new Error("inspection unavailable"))
          : Promise.resolve({
              status: "Terminated",
              attempt,
              proof: "healthy attempt is absent",
            });
      },
    },
    {
      next: () => ({
        operation: asOperationId("unused"),
        selectorDecisionReference: "unused",
      }),
    },
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.deepEqual(inspected, ["poisoned", "healthy"]);
  assert.deepEqual(rotated, ["poisoned"]);
  assert.deepEqual(result.failures, [{ phase: "AttemptReconciliation" }]);
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
      handoffNote: {},
    },
    promptObservationSource(),
    refusalWrites(),
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
    resolved(settings),
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

test("the runtime deadline confirms capability cancellation before returning", async () => {
  let aborted = false;
  let recordedFailure: JsonValue | undefined;
  const result = await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    {
      ...promptObservationSource(),
      currentInstant: () => Promise.resolve("2026-08-21T12:00:02.000Z"),
      decisionDeadline: () =>
        Promise.reject(new Error("decision deadline exceeded")),
    },
    refusalWrites(),
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
        return Promise.resolve({
          status: "Terminated",
          proof: "test-host-termination",
        });
      },
    ),
    {
      operation: asOperationId("timed-operation"),
      selectorDecisionReference: "timed-decision",
    },
    resolved(),
  );
  assert.equal(result, undefined);
  assert.equal(aborted, true);
  assert.deepEqual(recordedFailure, {
    outcome: "Failed",
    code: "DeadlineExceeded",
  });
});

test("unconfirmed capability cancellation quarantines its durable attempt", async () => {
  let released = 0;
  let quarantined: string | undefined;
  const result = await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      recordInteraction: () => Promise.reject(new Error("audit unavailable")),
      terminateAttempt: () => {
        released += 1;
        return Promise.resolve();
      },
      quarantineAttempt: (attempt) => {
        quarantined = attempt;
        return Promise.resolve();
      },
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [partition] }),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
      decisionDeadline: () => Promise.reject(new Error("deadline")),
    },
    policyHost(
      () => new Promise(() => undefined),
      () => Promise.resolve({ status: "Unconfirmed" }),
    ),
    {
      next: () => ({
        operation: asOperationId("unsafe-operation"),
        selectorDecisionReference: "unsafe-decision",
      }),
    },
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.equal(released, 0);
  assert.equal(quarantined, "unsafe-decision");
  assert.deepEqual(result.failures, [{ phase: "Observation", partition }]);
});

test("an unconfirmed permit release enters reconciliation", async () => {
  let quarantined: string | undefined;
  const result = await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      recordInteraction: () => Promise.reject(new Error("commit unknown")),
      terminateAttempt: () => Promise.reject(new Error("commit unknown")),
      quarantineAttempt: (attempt) => {
        quarantined = attempt;
        return Promise.resolve();
      },
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [partition] }),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() => Promise.resolve(waitingExecution())),
    {
      next: () => ({
        operation: asOperationId("release-operation"),
        selectorDecisionReference: "release-decision",
      }),
    },
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.equal(quarantined, "release-decision");
  assert.deepEqual(result.failures, [
    { phase: "Observation", partition },
    { phase: "PermitRelease", partition },
  ]);
});

test("settings and permit failures remain isolated to their projects", async () => {
  const settingsBroken = {
    tenant: partition.tenant,
    project: asProjectId("settings-broken"),
  };
  const permitBroken = {
    tenant: partition.tenant,
    project: asProjectId("permit-broken"),
  };
  const healthy = {
    tenant: partition.tenant,
    project: asProjectId("healthy-after-boundary-failures"),
  };
  const result = await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      allocateAttempt: (_attempt, scope) =>
        scope === permitBroken
          ? Promise.reject(new Error("permit store unavailable"))
          : Promise.resolve(true),
    },
    {
      ...promptObservationSource(),
      projects: () =>
        Promise.resolve({ projects: [settingsBroken, permitBroken, healthy] }),
      dispatchView: (scope) =>
        Promise.resolve({
          result: "Page",
          token: {
            ...scope,
            recoveryEpoch: "epoch",
            schemaVersion: 1,
            watermark: 1,
            digest: "e".repeat(64),
          },
          candidates: [],
          notificationCursor: 1,
        }),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() => Promise.resolve(waitingExecution())),
    perProjectIdentities(),
    {
      settings: () => Promise.resolve(runtimeSettings),
      projectSettings: (of) =>
        of.project === settingsBroken.project
          ? Promise.reject(new Error("settings unavailable"))
          : Promise.resolve(
              resolvedSelectorSettings(of, runtimeSettings, 0, {}),
            ),
    },
    { projectsMax: 3, deliveriesMax: 1, reconciliationsMax: 1 },
  );
  assert.equal(result.observed, 1);
  assert.deepEqual(result.failures, [
    { phase: "Settings", partition: settingsBroken },
    { phase: "PermitAcquisition", partition: permitBroken },
  ]);
});

test("policy-host constraints and observations are immutable", async () => {
  let mutationRejected = false;
  let observationMutationRejected = false;
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    promptObservationSource(),
    refusalWrites(),
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
    resolved({
      ...runtimeSettings,
      modelAllowlist: ["model-1"],
      toolAllowlist: [],
    }),
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
      handoffNote: {},
    },
    promptObservationSource(),
    refusalWrites(),
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
    resolved({ ...runtimeSettings, modelAllowlist: ["another-model"] }),
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
      handoffNote: {},
    },
    promptObservationSource(),
    refusalWrites(),
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
    resolved(),
  );
  assert.deepEqual(recordedFailure, {
    outcome: "Failed",
    code: "InvalidResult",
  });
});

test("policy timestamps compare chronologically across accepted precisions", async () => {
  let result: JsonValue | undefined;
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    promptObservationSource(),
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      recordInteraction: (interaction) => {
        result = interaction.result;
        return Promise.resolve(true);
      },
    },
    policyHost(() =>
      Promise.resolve({
        ...waitingExecution(),
        startedAt: "2026-08-21T12:00:00Z",
        completedAt: "2026-08-21T12:00:00.001Z",
      }),
    ),
    {
      operation: asOperationId("timestamp-operation"),
      selectorDecisionReference: "timestamp-decision",
    },
    resolved(),
  );
  assert.deepEqual(result, waitingExecution().result);
});

test("unpersistable selector input is rejected before policy execution", async () => {
  let started = false;
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    {
      ...promptObservationSource(),
      operationalContext: () =>
        Promise.resolve({
          ...operationalContext,
          capacity: {
            ...operationalContext.capacity,
            account: "x".repeat(1_100_000),
          },
        }),
    },
    refusalWrites(),
    stateStore(() => undefined),
    policyHost(() => {
      started = true;
      return Promise.resolve(waitingExecution());
    }),
    {
      operation: asOperationId("oversized-operation"),
      selectorDecisionReference: "oversized-decision",
    },
    resolved(),
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
      handoffNote: {},
    },
    promptObservationSource(),
    refusalWrites(),
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
    resolved(),
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
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      pending: () => Promise.resolve([delivery]),
    },
    {
      projects: () => Promise.resolve({ projects: [broken, healthy] }),
      notifications: (scope) =>
        scope === broken
          ? Promise.reject(new Error("broken project feed"))
          : Promise.resolve(movedPage),
      moved: (scope: typeof partition) =>
        scope === broken
          ? Promise.reject(new Error("broken project feed"))
          : Promise.resolve(movedPage),
      decisionDeadline: () => new Promise<never>(() => undefined),
      currentTimeEpochMs: () =>
        Promise.resolve(operationalContext.observedAtEpochMs),
      currentInstant: () => Promise.resolve(operationalContext.observedAt),
      dispatchView: (scope) =>
        Promise.resolve(emptyDispatchPage(scope, "f".repeat(64))),
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
    perProjectIdentities(),
    settingsSource(() => Promise.resolve(runtimeSettings)),
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
    refusalWrites(),
    {
      ...stateStore(() => {
        terminal += 1;
      }),
      submittedDeliveries: () => Promise.resolve([delivery, later]),
    },
    {
      projects: () =>
        Promise.reject(new Error("paused selector listed projects")),
      notifications: () => Promise.reject(new Error("no observation")),
      moved: () => Promise.reject(new Error("no observation")),
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
      projectSettings: (of) =>
        Promise.resolve(
          resolvedSelectorSettings(
            of,
            { ...runtimeSettings, mode: "Paused" },
            0,
            {},
          ),
        ),
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
    projectSettings: () => Promise.resolve(resolved()),
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

test("the selector policy host starts once and bounds cancellation evidence", async () => {
  let executions = 0;
  let aborted = false;
  const host = selectorPolicyHost(
    {
      execute: (_request, signal) => {
        executions += 1;
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => undefined);
      },
      cancel: (attempt) =>
        Promise.resolve({
          status: "Terminated",
          attempt,
          proof: "all capability calls settled",
        }),
      inspect: () => Promise.resolve({ status: "Unconfirmed" }),
    },
    { after: () => new Promise<never>(() => undefined) },
    { controlDeadlineMs: 1_000 },
  );
  const request: SelectorPolicyRequest = {
    attempt: "durable-attempt",
    observation: Object.freeze(exhaustedObservation()),
    instructions: Object.freeze({ revision: "1.0", content: "prompt" }),
    constraints: Object.freeze({
      models: Object.freeze(["model"]),
      tools: Object.freeze([]),
      limits: Object.freeze(runtimeSettings.limits),
    }),
  };
  const first = host.start(request);
  const retry = host.start(request);
  assert.equal(first, retry);
  assert.equal(executions, 1);
  assert.deepEqual(await first.terminate(new Error("deadline")), {
    status: "Terminated",
    attempt: "durable-attempt",
    proof: "all capability calls settled",
  });
  assert.equal(aborted, true);
});

async function policyAnswer(result: unknown) {
  return dryRunSelectorPolicy(
    policyHost(() =>
      Promise.resolve({
        result,
        implementationRevision: "implementation-1",
        modelRevision: "model-1",
        policyRevision: "policy-1",
        toolActivity: [],
        accounting: { tokens: 1, durationMs: 1 },
        startedAt: "2026-09-02T12:00:00.000Z",
        completedAt: "2026-09-02T12:00:01.000Z",
      }),
    ),
    { decisionDeadline: () => new Promise<never>(() => undefined) },
    exhaustedObservation(),
    resolved(),
  );
}

test("the grown result's refusals and lifts reach the runtime intact", async () => {
  const result = await policyAnswer({
    attention: "Attention",
    handoffNote: { watching: "41" },
    dispatches: [{ ticket: 41, expectedTicketVersion: 3 }],
    refusals: [
      { ticket: 42, ticketVersion: 2, reason: "its dependency failed" },
    ],
    lifts: [{ ticket: 40 }],
  });
  assert.deepEqual(result.dispatches, [
    { ticket: asTicketId(41), expectedTicketVersion: 3 },
  ]);
  assert.deepEqual(result.refusals, [
    {
      ticket: asTicketId(42),
      ticketVersion: 2,
      reason: "its dependency failed",
    },
  ]);
  assert.deepEqual(result.lifts, [{ ticket: asTicketId(40) }]);
  assert.equal(result.attention, "Attention");
});

test("a result naming its dispatch two ways is refused rather than half-read", async () => {
  await assert.rejects(() =>
    policyAnswer({
      attention: "Monitoring",
      handoffNote: {},
      selectedTicket: 7,
      dispatches: [{ ticket: 41, expectedTicketVersion: 3 }],
    }),
  );
});

test("a host answering the pre-slice-2 spelling still names one dispatch", async () => {
  const observation = exhaustedObservation();
  const result = await dryRunSelectorPolicy(
    policyHost(() =>
      Promise.resolve({
        result: { selectedTicket: 7, attention: "Monitoring", handoffNote: {} },
        implementationRevision: "implementation-1",
        modelRevision: "model-1",
        policyRevision: "policy-1",
        toolActivity: [],
        accounting: { tokens: 1, durationMs: 1 },
        startedAt: "2026-09-02T12:00:00.000Z",
        completedAt: "2026-09-02T12:00:01.000Z",
      }),
    ),
    { decisionDeadline: () => new Promise<never>(() => undefined) },
    observation,
    resolved(),
  );
  assert.deepEqual(result.dispatches, [{ ticket: asTicketId(7) }]);
  assert.deepEqual(result.refusals, []);
  assert.deepEqual(result.lifts, []);
});

/** A source whose one project moved to the cursor a case names. */
function movedSource(cursor: number) {
  return {
    ...promptObservationSource(),
    projects: () => Promise.resolve({ projects: [partition] }),
    moved: () =>
      Promise.resolve({ result: "Events", cursor, events: [] } as const),
    submit: () => Promise.reject(new Error("no delivery expected")),
    operation: () => Promise.resolve(undefined),
  };
}

/** A state the store already holds, so a sweep's trigger has a cursor to compare. */
function observedState(notificationCursor: number): SelectorProjectState {
  return {
    partition,
    notificationCursor,
    revision: 3,
    attention: "Monitoring",
    handoffNote: {},
    candidateScan: { state: "Unstarted" },
  };
}

test("a project whose change log has not moved takes no turn and spends nothing", async () => {
  const permits: string[] = [];
  let identities = 0;
  let started = 0;
  let saved: unknown = "unwritten";
  const result = await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      project: () => Promise.resolve(observedState(5)),
      allocateAttempt: (attempt) => {
        permits.push(attempt);
        return Promise.resolve(true);
      },
      saveInventoryCursor: (cursor) => {
        saved = cursor;
        return Promise.resolve();
      },
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [partition] }),
      moved: () =>
        Promise.resolve({ result: "Events", cursor: 5, events: [] } as const),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
      dispatchView: () =>
        Promise.reject(new Error("an unmoved project was observed")),
    },
    policyHost(() => {
      started += 1;
      return Promise.reject(new Error("an unmoved project ran its policy"));
    }),
    {
      next: () => {
        identities += 1;
        return {
          operation: asOperationId("unused"),
          selectorDecisionReference: "unused",
        };
      },
    },
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.deepEqual(permits, []);
  assert.equal(identities, 0);
  assert.equal(started, 0);
  assert.deepEqual(result.failures, []);
  assert.equal(result.observed, 0);
  assert.equal(saved, undefined);
});

test("a project that moved takes one turn, and the window is what the lead is shown", async () => {
  const events = [{ ordinal: 6, kind: "Ticket", resource: "3" }] as const;
  const permits: string[] = [];
  const observed: SelectorObservation[] = [];
  let pages = 0;
  const result = await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      project: () => Promise.resolve(observedState(5)),
      allocateAttempt: (attempt) => {
        permits.push(attempt);
        return Promise.resolve(true);
      },
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [partition] }),
      moved: () => {
        pages += 1;
        return Promise.resolve({ result: "Events", cursor: 6, events });
      },
      notifications: () =>
        Promise.reject(new Error("the trigger's page was read twice")),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost((request) => {
      observed.push(request.observation);
      return Promise.resolve(waitingExecution());
    }),
    {
      next: () => ({
        operation: asOperationId("operation-moved"),
        selectorDecisionReference: "decision-moved",
      }),
    },
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.deepEqual(permits, ["decision-moved"]);
  assert.equal(pages, 1);
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0]?.changes, events);
  assert.equal(observed[0]?.notificationCursor, 6);
  assert.equal(result.observed, 1);
});

test("a reset the consumer cannot replay is a turn rather than a skip", async () => {
  let started = 0;
  await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      project: () => Promise.resolve(observedState(5)),
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [partition] }),
      moved: () => Promise.resolve({ result: "Reset", cursor: 5 } as const),
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() => {
      started += 1;
      return Promise.resolve(waitingExecution());
    }),
    perProjectIdentities(),
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.equal(started, 1);
});

test("a turn that spent more than its envelope allows is refused", async () => {
  let recorded: JsonValue | undefined;
  await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      project: () => Promise.resolve(observedState(5)),
      recordInteraction: (interaction) => {
        recorded = interaction.result;
        return Promise.resolve(true);
      },
    },
    movedSource(6),
    policyHost(() =>
      Promise.resolve({
        ...waitingExecution(),
        accounting: {
          tokens: runtimeSettings.limits.tokensPerDecision + 1,
          durationMs: 1_000,
        },
      }),
    ),
    perProjectIdentities(),
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.deepEqual(recorded, {
    outcome: "Failed",
    code: "ControlViolation",
  });
});

test("a decision's refusals are entered after the decision they name", async () => {
  const order: string[] = [];
  let entered: Parameters<AgenticRefusalWrite["record"]>[0] | undefined;
  await selectorRunOnce(
    refusalWrites((input) => {
      order.push("refusals");
      entered = input;
    }),
    {
      ...stateStore(() => undefined),
      project: () => Promise.resolve(observedState(5)),
      record: () => {
        order.push("proposal");
        return Promise.resolve(1);
      },
      recordInteraction: () => {
        order.push("interaction");
        return Promise.resolve(true);
      },
    },
    movedSource(6),
    policyHost(() =>
      Promise.resolve({
        ...waitingExecution(),
        result: {
          ...waitingExecution().result,
          refusals: [{ ticket: 7, ticketVersion: 2, reason: "blocked" }],
          lifts: [{ ticket: 8 }],
        },
      }),
    ),
    perProjectIdentities(),
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.deepEqual(order, ["interaction", "refusals"]);
  assert.equal(entered?.decision, "decision-project");
  assert.deepEqual(
    entered?.refusals.map((refusal) => refusal.ticket),
    [7],
  );
  assert.deepEqual(
    entered?.lifts.map((lift) => lift.ticket),
    [8],
  );
});

test("a decision that neither refused nor lifted enters nothing", async () => {
  let entries = 0;
  await selectorRunOnce(
    refusalWrites(() => {
      entries += 1;
    }),
    {
      ...stateStore(() => undefined),
      project: () => Promise.resolve(observedState(5)),
    },
    movedSource(6),
    policyHost(() => Promise.resolve(waitingExecution())),
    perProjectIdentities(),
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.equal(entries, 0);
});

test("a decision that only lifts still enters the lift", async () => {
  const entered: Parameters<AgenticRefusalWrite["record"]>[0][] = [];
  await selectorRunOnce(
    refusalWrites((input) => entered.push(input)),
    {
      ...stateStore(() => undefined),
      project: () => Promise.resolve(observedState(5)),
    },
    movedSource(6),
    policyHost(() =>
      Promise.resolve({
        ...waitingExecution(),
        result: {
          ...waitingExecution().result,
          refusals: [],
          lifts: [{ ticket: 9 }],
        },
      }),
    ),
    perProjectIdentities(),
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.deepEqual(
    entered.map((input) => input.lifts.map((lift) => lift.ticket)),
    [[9]],
    "a lift is the lead clearing its own refusal, and dropping it leaves the ticket refused forever",
  );
  assert.deepEqual(entered[0]?.refusals, []);
});

/** One candidate a decision can actually choose, so the proposal path is reached. */
const dispatchable = {
  ticket: asTicketId(1),
  ticketVersion: 1,
  dependencies: [],
  workFanout: 1,
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  reworkPolicy: { type: "BudgetedRework", value: 1 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  finalizer: "NoFinalizer",
  configurationRevision: "revision",
  configurationDigest: "d".repeat(64),
  configurationCanonical: "{}",
} as const;

test("a dispatching decision's refusals are entered after its proposal", async () => {
  const order: string[] = [];
  await selectorRunOnce(
    refusalWrites(() => {
      order.push("refusals");
    }),
    {
      ...stateStore(() => undefined),
      project: () => Promise.resolve(observedState(5)),
      record: () => {
        order.push("proposal");
        return Promise.resolve(1);
      },
      recordInteraction: () => {
        order.push("interaction");
        return Promise.resolve(true);
      },
    },
    {
      ...movedSource(6),
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
          candidates: [dispatchable],
          notificationCursor: 6,
        } as const),
    },
    policyHost(() =>
      Promise.resolve({
        ...waitingExecution(),
        result: {
          ...waitingExecution().result,
          dispatches: [{ ticket: 1, expectedTicketVersion: 1 }],
          refusals: [{ ticket: 1, ticketVersion: 1, reason: "blocked" }],
        },
      }),
    ),
    perProjectIdentities(),
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.deepEqual(
    order,
    ["proposal", "refusals"],
    "a refusal naming a decision the log does not carry could never be explained",
  );
});

test("the trigger reads from the cursor the project's last turn stood on", async () => {
  const asked: number[] = [];
  let started = 0;
  await selectorRunOnce(
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      project: () => Promise.resolve(observedState(5)),
    },
    {
      ...promptObservationSource(),
      projects: () => Promise.resolve({ projects: [partition] }),
      /** Moved to 5 and no further, so only a read starting before 5 sees anything. */
      moved: (_scope: typeof partition, after: number) => {
        asked.push(after);
        return Promise.resolve(
          after < 5
            ? ({
                result: "Events",
                cursor: 5,
                events: [{ ordinal: 5, kind: "Ticket", resource: "1" }],
              } as const)
            : ({ result: "Events", cursor: 5, events: [] } as const),
        );
      },
      submit: () => Promise.reject(new Error("no delivery expected")),
      operation: () => Promise.resolve(undefined),
    },
    policyHost(() => {
      started += 1;
      return Promise.resolve(waitingExecution());
    }),
    perProjectIdentities(),
    settingsSource(() => Promise.resolve(runtimeSettings)),
  );
  assert.deepEqual(
    asked,
    [5],
    "a trigger that read from the start would replay every change on every pass",
  );
  assert.equal(started, 0, "nothing moved past that cursor, so nothing ran");
});

/** A source whose one page offers the candidates a case wants chosen among. */
function candidateSource(candidates: readonly (typeof dispatchable)[]) {
  return {
    ...promptObservationSource(),
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
        candidates,
        notificationCursor: 1,
      } as const),
  };
}

const offered = Array.from({ length: 4 }, (_, index) => ({
  ...dispatchable,
  ticket: asTicketId(index + 1),
}));

/** One cycle over the offered view, dispatching the tickets a case names. */
async function cycleDispatching(
  tickets: readonly number[],
  limits: Partial<SelectorRuntimeSettings["limits"]> = {},
  view: readonly (typeof dispatchable)[] = offered,
) {
  let interaction: SelectorInteraction | undefined;
  let recorded: SelectorDecisionProposals | undefined;
  const proposals = await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
    },
    candidateSource(view),
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      recordInteraction: (written) => {
        interaction = written;
        return Promise.resolve(true);
      },
      record: (written) => {
        recorded = written;
        interaction = written.interaction;
        return Promise.resolve(written.dispatches.length);
      },
    },
    policyHost(() =>
      Promise.resolve({
        ...waitingExecution(),
        result: {
          ...waitingExecution().result,
          dispatches: tickets.map((ticket) => ({
            ticket: asTicketId(ticket),
            expectedTicketVersion: 1,
          })),
        },
      }),
    ),
    {
      operation: asOperationId("cycle-operation"),
      selectorDecisionReference: "cycle-decision",
    },
    resolved({
      ...runtimeSettings,
      limits: { ...runtimeSettings.limits, ...limits },
    }),
  );
  return { proposals, recorded, interaction };
}

/**
 * The policy control, judged on the finished turn beside the token and
 * tool-call budgets. The whole decision is refused rather than truncated: a
 * control that reported a bound it had not applied would be worse than none.
 */
test("a decision dispatching past its project's budget is a control violation", async () => {
  const over = await cycleDispatching([1, 2, 3, 4], {
    dispatchesPerDecision: 3,
  });
  assert.equal(over.proposals, undefined);
  assert.equal(over.recorded, undefined, "nothing is dispatched");
  assert.deepEqual(over.interaction?.result, {
    outcome: "Failed",
    code: "ControlViolation",
  });
});

test("the same decision under a wider budget is accepted", async () => {
  const within = await cycleDispatching([1, 2, 3, 4], {
    dispatchesPerDecision: 4,
  });
  assert.deepEqual(
    within.recorded?.dispatches.map((dispatch) => dispatch.ticket),
    [asTicketId(1), asTicketId(2), asTicketId(3), asTicketId(4)],
    "the control is a control and not a constant",
  );
});

test("every dispatch a decision names is proposed under its own operation", async () => {
  const three = await cycleDispatching([3, 1, 2], {
    dispatchesPerDecision: 3,
  });
  assert.deepEqual(
    three.recorded?.dispatches.map((dispatch) => dispatch.operation),
    [3, 1, 2].map((ticket) =>
      selectorDispatchOperation(
        {
          operation: asOperationId("cycle-operation"),
          selectorDecisionReference: "cycle-decision",
        },
        asTicketId(ticket),
      ),
    ),
  );
  assert.deepEqual(
    three.recorded?.dispatches.map((dispatch) => dispatch.command.ticket),
    [asTicketId(3), asTicketId(1), asTicketId(2)],
    "each command names its own candidate, in the order the lead named them",
  );
});

/**
 * Every member is checked, not the first. Before the walk was total a decision
 * naming a carried ticket and an uncarried one dropped the second silently; now
 * the cycle refuses, and the runtime's own catch records the failure.
 */
test("a dispatch of a ticket the view did not carry loses the whole decision", async () => {
  await assert.rejects(
    () => cycleDispatching([1, 99], { dispatchesPerDecision: 3 }),
    /outside its observed view/,
  );
});

test("a derived dispatch operation is one per ticket, and bounded", () => {
  const identity = {
    operation: asOperationId("selector-operation-instance-uuid"),
    selectorDecisionReference: "decision",
  };
  assert.notEqual(
    selectorDispatchOperation(identity, asTicketId(41)),
    selectorDispatchOperation(identity, asTicketId(42)),
  );
  assert.equal(
    selectorDispatchOperation(identity, asTicketId(41)),
    selectorDispatchOperation(identity, asTicketId(41)),
    "a redelivery of one decision's ticket is the same operation",
  );
  assert.throws(
    () =>
      selectorDispatchOperation(
        {
          ...identity,
          operation: asOperationId("o".repeat(operationIdentityCharsMax)),
        },
        asTicketId(41),
      ),
    RangeError,
    "an operation no stored row could hold is refused where it is built",
  );
});

test("a project's dispatch budget resolves from its own row, or inherits", () => {
  assert.equal(
    resolvedSelectorSettings(partition, runtimeSettings, 0, {
      limits: { dispatchesPerDecision: 5 },
    }).limits.dispatchesPerDecision,
    5,
  );
  assert.equal(
    resolvedSelectorSettings(partition, runtimeSettings, 0, {}).limits
      .dispatchesPerDecision,
    runtimeSettings.limits.dispatchesPerDecision,
  );
});

/**
 * The budget and the walk, checked against a model rather than against
 * examples: the count is judged first, on the finished turn, so a decision over
 * its budget is a control violation whatever it named; one within it is refused
 * only where a ticket it names is outside the view, and otherwise proposes
 * exactly what it named, in order. The reference is a count then a set, which
 * is what the two rules are and the order they run in; a run is a pure function
 * of its seed, so a failure names the case that produced it.
 */
test("a decision is proposed exactly when the view holds it and the budget allows it", async () => {
  const random = randomOf(20_260_903);
  for (let run = 0; run < 128; run += 1) {
    const size = random.below(leadDispatchesMax) + 1;
    const view = Array.from({ length: size }, (_, index) => ({
      ...dispatchable,
      ticket: asTicketId(index + 1),
    }));
    const budget = random.below(leadDispatchesMax) + 1;
    const named = subsetFrom(random, view).map((candidate) =>
      Number(candidate.ticket),
    );
    const chosen = random.coin() ? [...named, size + 1] : named;
    const carried = chosen.every((ticket) => ticket <= size);
    const label = `seed run ${String(run)}: view ${String(size)}, budget ${String(budget)}, chosen ${chosen.join(",")}`;

    if (chosen.length > budget) {
      const over = await cycleDispatching(
        chosen,
        { dispatchesPerDecision: budget },
        view,
      );
      assert.equal(over.recorded, undefined, label);
      assert.deepEqual(
        over.interaction?.result,
        { outcome: "Failed", code: "ControlViolation" },
        label,
      );
      continue;
    }
    if (!carried) {
      await assert.rejects(
        () => cycleDispatching(chosen, { dispatchesPerDecision: budget }, view),
        /outside its observed view/,
        label,
      );
      continue;
    }
    const cycle = await cycleDispatching(
      chosen,
      { dispatchesPerDecision: budget },
      view,
    );
    assert.deepEqual(
      cycle.recorded?.dispatches.map((dispatch) => Number(dispatch.ticket)) ??
        [],
      chosen,
      label,
    );
  }
});
