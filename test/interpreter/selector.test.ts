import assert from "node:assert/strict";
import { test } from "node:test";

import { leadDispatchesPerDecision } from "../../src/adapters/postgres/schema/migrations/baseline/seed.ts";
import {
  agenticRefusalReasonCharsMax,
  configurationCanonicalCharsMax,
  nativeHttpDraftEvaluatorsMax,
  nativeHttpDraftStagesMax,
  selectorFailedDecisionsPerViewMax,
  selectorSettingsTextCharsMax,
} from "../../src/contract/http.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  dryRunSelectorPolicy,
  leadDispatchesMax,
  leadInputBytesMax,
  observeSelectorProject,
  runObservedSelectorCycle,
  runSelectorCycle,
  resolvedSelectorSettings,
  selectorBacklogsAdmitDispatch,
  selectorDispatchHasRoom,
  selectorDispatchOperation,
  selectorLastDecision,
  type SelectorDecisionProposals,
  type SelectorInteraction,
  type SelectorRuntimeSettings,
  type SelectorPolicyExecution,
  type SelectorPolicyHost,
  type SelectorPolicyRequest,
  type SelectorObservation,
  type SelectorOperationalContext,
  type SelectorStandingRefusal,
  type SelectorInteractionRecord,
  type SelectorProjectState,
  selectorNotificationPageLimit,
  type JsonValue,
} from "../../src/interpreter/selector.ts";
import {
  deliverSelectorProposal,
  reconcileSelectorProposal,
  type SelectorDelivery,
  type SelectorRecordedDecision,
  type SelectorStateStore,
  unwrittenDispatches,
} from "../../src/interpreter/selector.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type {
  DispatchCandidate,
  DispatchViewQuery,
} from "../../src/interpreter/dispatchView.ts";
import {
  pickFrom,
  randomOf,
  subsetFrom,
  type Random,
} from "../random/random.ts";
import {
  asAuthorityKind,
  asOperationId,
  operationIdentityCharsMax,
} from "../../src/interpreter/operationInbox.ts";
import type { AgenticRefusalWrite } from "../../src/interpreter/agenticRefusal.ts";
import {
  selectorOperationalContext,
  selectorSettingsFixture,
} from "./selectorFixture.ts";
import type { SubsidizedLeadProfile } from "../../src/interpreter/sessionPlacement.ts";

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

/**
 * The two dispatch bounds are written in different files — the ceiling here,
 * the installation default in the migration that gives an installation its
 * controls — and only one of them is a parse refusal. An installation seeded
 * above the ceiling would hand a project a budget the document parser refuses
 * before reading any of the decision that spent it: a control reporting a
 * number it does not apply, which nothing else in either file can notice.
 */
test("the installation's dispatch default sits under the ceiling that parses it", () => {
  assert.ok(leadDispatchesPerDecision <= leadDispatchesMax);
});

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

/** The installation defaults as one project resolves them, overriding nothing. */
function resolved(
  settings: SelectorRuntimeSettings = selectorSettingsFixture,
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
    refusals: [],
    notificationCursor: 0,
    changes: [],
    operationalContext,
    handoffNote: {},
    nextCandidateScan: { state: "Exhausted", token },
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
    leadAdmission: () => Promise.resolve("Admitted"),
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
    turnStanding: () => Promise.resolve("Absent"),
    resume: () => ({
      result: Promise.reject(new Error("no decision was resumed")),
      terminate: () => Promise.resolve({ status: "Unconfirmed" }),
    }),
    withdraw: () => Promise.resolve({ status: "Unconfirmed" }),
  };
}

const movedPage = { result: "Events", cursor: 1, events: [] } as const;

/** A ledger standing on the refusals it is given, recording what a decision enters. */
function refusalWrites(
  onRecord: (
    input: Parameters<AgenticRefusalWrite["record"]>[0],
  ) => void = () => undefined,
  standing: readonly SelectorStandingRefusal[] = [],
): AgenticRefusalWrite {
  return {
    record: (input) => {
      onRecord(input);
      return Promise.resolve("Recorded");
    },
    standingAmong: (_partition, tickets) =>
      Promise.resolve(
        standing.filter((refusal) => tickets.includes(refusal.ticket)),
      ),
  };
}

/** A project no decision is held in. */
const noneHeld: Pick<SelectorStateStore, "heldAmong"> = {
  heldAmong: () => Promise.resolve([]),
};

/** One standing refusal of the ticket and version named, as the ledger answers it. */
function standingRefusalOf(
  ticket: DispatchCandidate["ticket"],
  ticketVersion: number,
): SelectorStandingRefusal {
  return {
    ticket,
    ticketVersion,
    reason: "its dependency has not passed",
    decision: "selector-decision-refusing",
    recordedAt: "2026-09-02T11:00:00.000Z",
  };
}

/** One released ticket as the dispatch view carries it. */
const viewCandidate: DispatchCandidate = {
  ticket: asTicketId(35),
  ticketVersion: 4,
  dependencies: [],
  program: [{ key: 1, evaluators: [{ key: 1 }] }],
  configurationRevision: "revision",
  configurationDigest: "d".repeat(64),
  configurationCanonical: "canonical",
};

/** A moved project whose view holds one candidate, which is a turn for its lead. */
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
        candidates: [viewCandidate],
        notificationCursor: 1,
      } as const),
  };
}

/** One project's page holding one candidate, which is a turn for its lead. */
function candidateDispatchPage(scope: typeof partition, digest: string) {
  return {
    result: "Page",
    token: {
      ...scope,
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 1,
      digest,
    },
    candidates: [viewCandidate],
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
    unfinishedAttempts: () => Promise.resolve([]),
    inventoryCursor: () => Promise.resolve(undefined),
    saveInventoryCursor: () => Promise.resolve(),
    recordInteraction: () => Promise.resolve(true),
    recordQuietCycle: () => Promise.resolve(true),
    recordLeadRefusal: () => Promise.resolve(),
    clearLeadRefusal: () => Promise.resolve(),
    record: (proposals) =>
      Promise.resolve({
        retained: true,
        dispatched: proposals.dispatches.map((dispatch) => dispatch.ticket),
      }),
    pending: () => Promise.resolve([]),
    submittedDeliveries: () => Promise.resolve([]),
    submitted: () => Promise.resolve(),
    terminal: (_decision, _ticket, outcome) => {
      onTerminal(outcome);
      return Promise.resolve();
    },
    history: () => Promise.resolve([]),
    tail: () => Promise.resolve([]),
    project: () => Promise.resolve(undefined),
    planningIntent: () => Promise.resolve(undefined),
    heldAmong: () => Promise.resolve([]),
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
    refusalWrites(),
    noneHeld,
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
    refusalWrites(),
    noneHeld,
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
    refusalWrites(),
    noneHeld,
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
    program: [{ key: 1, evaluators: [{ key: 1 }] }],
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
    refusalWrites(),
    noneHeld,
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
      refusalWrites(),
      noneHeld,
      { result: "Events", cursor: 2, events: [] },
      10,
      100,
    ),
    undefined,
  );
});

/**
 * A configuration at its longest, every character three bytes, on a candidate
 * whose program is as wide as authoring allows, weighs more than the page
 * budget a default lead runs under. A turn holds it without its canonical, so
 * it is a candidate the lead is shown rather than one too large to show, and
 * the observation stored still carries the canonical whole.
 */
test("a candidate whose configuration is at its longest is observed, not too large", async () => {
  const candidate: DispatchCandidate = {
    ...viewCandidate,
    program: Array.from({ length: nativeHttpDraftStagesMax }, () => ({
      key: Number.MAX_SAFE_INTEGER,
      evaluators: Array.from({ length: nativeHttpDraftEvaluatorsMax }, () => ({
        key: Number.MAX_SAFE_INTEGER,
      })),
    })),
    configurationCanonical: "€".repeat(configurationCanonicalCharsMax),
  };
  const bytesMax = Math.floor(leadInputBytesMax(resolved()) / 2);
  assert.ok(
    new TextEncoder().encode(JSON.stringify([candidate])).length > bytesMax,
  );
  const observation = await observeSelectorProject(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
      candidateScan: { state: "Unstarted" },
    },
    {
      ...promptObservationSource(),
      dispatchView: () =>
        Promise.resolve({
          ...candidateDispatchPage(partition, "b".repeat(64)),
          candidates: [candidate],
        }),
    },
    refusalWrites(),
    noneHeld,
    movedPage,
    selectorNotificationPageLimit,
    bytesMax,
  );
  assert.equal(observation?.resourceLimit, undefined);
  assert.deepEqual(observation?.candidates, [candidate]);
});

/** A source paging the candidates given as the view would, recording the limit of each page asked for. */
function pagedCandidateSource(
  candidates: readonly DispatchCandidate[],
  limits: number[] = [],
) {
  return {
    ...promptObservationSource(),
    dispatchView: (_scope: unknown, query: DispatchViewQuery) => {
      limits.push(query.limit);
      const page = candidates.slice(0, query.limit);
      const last = page.at(-1);
      return Promise.resolve({
        ...candidateDispatchPage(partition, "c".repeat(64)),
        candidates: page,
        ...(page.length < candidates.length && last !== undefined
          ? { nextAfter: last.ticket }
          : {}),
      });
    },
  };
}

/** A hundred ready tickets on one configuration at its longest, every character three bytes. */
const hundredOnOneConfiguration: readonly DispatchCandidate[] = Array.from(
  { length: 100 },
  (_, index) => ({
    ...viewCandidate,
    ticket: asTicketId(index + 1),
    ticketVersion: 1,
    configurationCanonical: "€".repeat(configurationCanonicalCharsMax),
  }),
);

/**
 * A page is weighed as it is stored, each configuration once: a hundred
 * candidates on one configuration at its longest are one page under the
 * default budget, where weighing the canonical per candidate halved them to six.
 */
test("a hundred candidates on one configuration at its longest are one page", async () => {
  const limits: number[] = [];
  const observation = await observeSelectorProject(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
      candidateScan: { state: "Unstarted" },
    },
    pagedCandidateSource(hundredOnOneConfiguration, limits),
    refusalWrites(),
    noneHeld,
    movedPage,
    selectorNotificationPageLimit,
    Math.floor(leadInputBytesMax(resolved()) / 2),
  );
  assert.deepEqual(limits, [100]);
  assert.deepEqual(observation?.candidates, hundredOnOneConfiguration);
  assert.equal(observation?.nextCandidateScan.state, "Exhausted");
});

test("a decision dispatching the hundredth of them is accepted and delivered with that configuration", async () => {
  const { recorded, interaction } = await cycleDispatching(
    [100],
    {},
    hundredOnOneConfiguration,
  );
  const dispatch = recorded?.dispatches[0];
  assert.equal(dispatch?.ticket, asTicketId(100));
  assert.equal(recorded?.dispatches.length, 1);
  assert.deepEqual(
    interaction?.observedView.find(
      (candidate) => candidate.ticket === asTicketId(100),
    ),
    hundredOnOneConfiguration[99],
    "the decision is recorded against the configuration the view pinned",
  );
  let submitted: SelectorDelivery | undefined;
  const delivered = await deliverSelectorProposal(
    stateStore(() => undefined),
    {
      submit: (delivery) => {
        submitted = delivery;
        return Promise.resolve({ accepted: "Accepted" });
      },
    },
    {
      decision: "cycle-decision",
      ticket: dispatch.ticket,
      partition,
      operation: dispatch.operation,
      command: dispatch.command,
      attempts: 0,
    },
  );
  assert.equal(delivered.result, "Delivered");
  assert.equal(submitted?.command.ticket, asTicketId(100));
  assert.equal(submitted.command.expectedTicketVersion, 1);
});

/**
 * Configurations counted once still count: eight candidates on four
 * configurations outweigh the budget and halve, and the first four, on two of
 * them, fit — which weighing each candidate's canonical would have halved again.
 */
test("a page on several distinct configurations still halves when they outweigh the budget", async () => {
  const candidates = Array.from({ length: 8 }, (_, index) => {
    const configuration = "abcd"[Math.floor(index / 2)] ?? "a";
    return {
      ...viewCandidate,
      ticket: asTicketId(index + 1),
      configurationRevision: `revision-${configuration}`,
      configurationDigest: configuration.repeat(64),
      configurationCanonical: configuration.repeat(1_000),
    };
  });
  const limits: number[] = [];
  const observation = await observeSelectorProject(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
      candidateScan: { state: "Unstarted" },
    },
    pagedCandidateSource(candidates, limits),
    refusalWrites(),
    noneHeld,
    movedPage,
    8,
    3_500,
  );
  assert.deepEqual(limits, [8, 4]);
  assert.deepEqual(observation?.candidates, candidates.slice(0, 4));
  assert.deepEqual(observation?.nextCandidateScan, {
    state: "Continue",
    token: observation?.token,
    after: asTicketId(4),
  });
});

/** One observation of a page holding the one candidate, against the ledger given. */
function observeAgainstRefusals(
  refusals: AgenticRefusalWrite,
): Promise<SelectorObservation | undefined> {
  return observeSelectorProject(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Monitoring",
      handoffNote: {},
      candidateScan: { state: "Unstarted" },
    },
    {
      ...promptObservationSource(),
      dispatchView: () =>
        Promise.resolve({
          result: "Page",
          token: {
            ...partition,
            recoveryEpoch: "epoch",
            schemaVersion: 1,
            watermark: 11,
            digest: "c".repeat(64),
          },
          candidates: [viewCandidate],
          notificationCursor: 1,
        } as const),
    },
    refusals,
    noneHeld,
    movedPage,
  );
}

/**
 * A refusal is a standing answer about one version of one ticket, so a
 * candidate still at that version is a question the lead already answered and
 * presenting it again spends a decision on saying nothing has changed. A
 * version the standing refusal does not name is a new question, and a lift
 * leaves no answer standing at all.
 */
test("an observation drops a candidate refused at the version it shows", async () => {
  const observe = (standing: readonly SelectorStandingRefusal[]) =>
    observeAgainstRefusals(refusalWrites(() => undefined, standing));
  assert.deepEqual(
    (await observe([standingRefusalOf(viewCandidate.ticket, 4)]))?.candidates,
    [],
  );
  assert.deepEqual(
    (await observe([standingRefusalOf(viewCandidate.ticket, 3)]))?.candidates,
    [viewCandidate],
  );
  assert.deepEqual((await observe([]))?.candidates, [viewCandidate]);
});

/**
 * The exclusion and the refusals the observation carries are one read, so a
 * candidate removed from the page is one the lead is still shown and may lift
 * (kasofsk/chuggy#574).
 */
test("an observation carries the refusals it excluded its candidates against", async () => {
  const refused = standingRefusalOf(viewCandidate.ticket, 4);
  const observed = await observeAgainstRefusals(
    refusalWrites(() => undefined, [refused]),
  );
  assert.deepEqual(observed?.candidates, []);
  assert.deepEqual(observed?.refusals, [refused]);
});

test("an observation asks the ledger only about the tickets its page held", async () => {
  const asked: (readonly DispatchCandidate["ticket"][])[] = [];
  await observeAgainstRefusals({
    record: () => Promise.resolve("Recorded"),
    standingAmong: (_partition, tickets) => {
      asked.push(tickets);
      return Promise.resolve([]);
    },
  });
  assert.deepEqual(asked, [[viewCandidate.ticket]]);
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

/** The fixture context with the account and the project's queue as named. */
function roomContext(
  accountActive: number,
  accountMaximum: number,
  queued = 0,
): SelectorOperationalContext {
  return {
    ...operationalContext,
    activeWork: { ...operationalContext.activeWork, queued },
    capacity: { ...operationalContext.capacity, accountActive, accountMaximum },
  };
}

test("a dispatch has room only under the account maximum and with nothing queued", () => {
  assert.equal(selectorDispatchHasRoom(roomContext(3, 4)), true);
  assert.equal(selectorDispatchHasRoom(roomContext(4, 4)), false);
  assert.equal(selectorDispatchHasRoom(roomContext(5, 4)), false);
  assert.equal(selectorDispatchHasRoom(roomContext(0, 4, 1)), false);
  assert.equal(
    selectorDispatchHasRoom({
      ...roomContext(0, 4),
      capacity: { ...roomContext(0, 4).capacity, clusterActive: 10 },
    }),
    true,
    "cluster slots are shared and are not this project's room",
  );
});

test("a decision's end is read as the instant it names", () => {
  for (const instant of [
    "1970-01-01T00:00:00.000Z",
    "2000-02-29T23:59:59.999Z",
    "2026-10-29T12:34:56.789Z",
    "2100-03-01T00:00:00.001Z",
  ]) {
    const record = {
      ...failedRecordOn(candidateViewToken, 1),
      completedAt: instant,
    };
    assert.equal(
      selectorLastDecision([record])?.completedAtEpochMs,
      Date.parse(instant),
      instant,
    );
  }
  assert.equal(selectorLastDecision([]), undefined);
});

test("a failure is retrying until its view's run of failures is spent", () => {
  const other = { ...candidateViewToken, digest: "f".repeat(64) };
  const run = (tokens: readonly (typeof other)[]) =>
    selectorLastDecision(
      tokens.map((token, index) =>
        failedRecordOn(token, tokens.length - index),
      ),
    )?.retrying;
  assert.equal(run([candidateViewToken]), true);
  assert.equal(
    run(Array.from({ length: selectorFailedDecisionsPerViewMax }, () => other)),
    false,
  );
  assert.equal(
    run([
      ...Array.from(
        { length: selectorFailedDecisionsPerViewMax - 1 },
        () => candidateViewToken,
      ),
      other,
    ]),
    true,
    "a failure on another view starts its own run",
  );
  assert.equal(
    selectorLastDecision([
      {
        ...failedRecordOn(candidateViewToken, 1),
        result: { outcome: "Waiting" },
      },
    ])?.retrying,
    false,
  );
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
    refusalWrites(),
    noneHeld,
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
            selectorSettingsFixture.operationalContextMaxAgeMs +
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

test("a selector decision uses and records one hot-loaded prompt revision", async () => {
  const settings: SelectorRuntimeSettings = {
    ...selectorSettingsFixture,
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
      ...selectorSettingsFixture,
      modelAllowlist: ["model-1"],
      toolAllowlist: [],
    }),
  );
  assert.equal(mutationRejected, true);
  assert.equal(observationMutationRejected, true);
  assert.deepEqual(selectorSettingsFixture.modelAllowlist, ["*"]);
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
    resolved({ ...selectorSettingsFixture, modelAllowlist: ["another-model"] }),
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
  assert.deepEqual(
    interaction?.observedToken,
    {
      ...partition,
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 1,
      digest: "c".repeat(64),
    },
    "a failed record names the view it failed on, which is what a later failure is counted against",
  );
});

/** What one cycle records of a decision measured on `model`, for a project allowing only `claude-opus-5-5` and leading as `subsidized` where given. */
async function measuredModelRecorded(
  model: string,
  subsidized?: SubsidizedLeadProfile,
): Promise<JsonValue | undefined> {
  let recorded: JsonValue | undefined;
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
        recorded = interaction.result;
        return Promise.resolve(true);
      },
    },
    policyHost(() =>
      Promise.resolve({ ...waitingExecution(), modelRevision: model }),
    ),
    {
      operation: asOperationId(`measured-${model}`),
      selectorDecisionReference: `measured-${model}`,
    },
    resolvedSelectorSettings(
      partition,
      selectorSettingsFixture,
      0,
      { modelAllowlist: ["claude-opus-5-5"] },
      subsidized,
    ),
  );
  return recorded;
}

test("a subsidized lead's turn measuring the profile's model passes the model check its project's allowlist would fail, and another model does not", async () => {
  const profile: SubsidizedLeadProfile = {
    credentialSlot: "anthropic-api",
    model: "claude-haiku-5-5",
    effort: "medium",
    autoCompactWindow: 100_000,
    inputBytesPerDecision: 262_144,
    turnTokensMax: 120_000,
  };
  const violation = { outcome: "Failed", code: "ControlViolation" };
  assert.deepEqual(
    await measuredModelRecorded("claude-haiku-5-5"),
    violation,
    "an own lead is held to its project's allowlist",
  );
  assert.notDeepEqual(
    await measuredModelRecorded("claude-haiku-5-5", profile),
    violation,
  );
  assert.deepEqual(
    await measuredModelRecorded("claude-opus-5-5", profile),
    violation,
    "a subsidized lead on any other model fails, its project's included",
  );
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

/** A dry run under a project's own limits, so a refusal names the arm it took. */
async function policyRefusing(
  result: unknown,
  limits: Partial<SelectorRuntimeSettings["limits"]>,
) {
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
    resolved({
      ...selectorSettingsFixture,
      limits: { ...selectorSettingsFixture.limits, ...limits },
    }),
  );
}

async function policyAnswer(result: unknown) {
  return policyRefusing(result, {});
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

test("the refusal reason's bound counts code points, matching the schema in front of it", async () => {
  const atBound = "😀".repeat(agenticRefusalReasonCharsMax);
  const result = await policyAnswer({
    attention: "Attention",
    handoffNote: {},
    dispatches: [],
    refusals: [{ ticket: 42, ticketVersion: 2, reason: atBound }],
    lifts: [],
  });
  assert.deepEqual(result.refusals, [
    { ticket: asTicketId(42), ticketVersion: 2, reason: atBound },
  ]);
  await assert.rejects(() =>
    policyAnswer({
      attention: "Attention",
      handoffNote: {},
      dispatches: [],
      refusals: [{ ticket: 42, ticketVersion: 2, reason: atBound + "😀" }],
      lifts: [],
    }),
  );
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

test("the base prompt's bound counts code points, matching the schema in front of it", async () => {
  const atBound = "😀".repeat(selectorSettingsTextCharsMax);
  const source = {
    decisionDeadline: () => new Promise<never>(() => undefined),
  };

  const result = await dryRunSelectorPolicy(
    policyHost(() => Promise.resolve(waitingExecution())),
    source,
    exhaustedObservation(),
    resolved({ ...selectorSettingsFixture, basePrompt: atBound }),
  );
  assert.deepEqual(result, waitingExecution().result);

  await assert.rejects(
    () =>
      dryRunSelectorPolicy(
        policyHost(() => Promise.resolve(waitingExecution())),
        source,
        exhaustedObservation(),
        resolved({ ...selectorSettingsFixture, basePrompt: `${atBound}😀` }),
      ),
    /selector input exceeds its byte budget/u,
  );
});

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

/** One candidate a decision can actually choose, so the proposal path is reached. */
const dispatchable = {
  ticket: asTicketId(1),
  ticketVersion: 1,
  dependencies: [],
  program: [{ key: 1, evaluators: [{ key: 1 }] }],
  configurationRevision: "revision",
  configurationDigest: "d".repeat(64),
  configurationCanonical: "{}",
} as const;

/** A source whose one page offers the candidates a case wants chosen among. */
function candidateSource(candidates: readonly DispatchCandidate[]) {
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
  view: readonly DispatchCandidate[] = offered,
  rowsWritten: (
    proposals: SelectorDecisionProposals,
  ) => SelectorRecordedDecision = (written) => ({
    retained: true,
    dispatched: written.dispatches.map((dispatch) => dispatch.ticket),
  }),
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
        return Promise.resolve(rowsWritten(written));
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
      ...selectorSettingsFixture,
      limits: { ...selectorSettingsFixture.limits, ...limits },
    }),
  );
  return { proposals, recorded, interaction };
}

test("a decision's request and record carry the project's standing attention", async () => {
  let asked: SelectorPolicyRequest | undefined;
  let interaction: SelectorInteraction | undefined;
  await runSelectorCycle(
    {
      partition,
      notificationCursor: 0,
      revision: 0,
      attention: "Attention",
      handoffNote: {},
    },
    candidateSource(offered),
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      recordInteraction: (written) => {
        interaction = written;
        return Promise.resolve(true);
      },
      record: (written) => {
        interaction = written.interaction;
        return Promise.resolve({ retained: true, dispatched: [] });
      },
    },
    policyHost((request) => {
      asked = request;
      return Promise.resolve(waitingExecution());
    }),
    {
      operation: asOperationId("cycle-operation"),
      selectorDecisionReference: "cycle-decision",
    },
    resolved(),
  );
  assert.equal(asked?.observation.attention, "Attention", "the request");
  assert.equal(interaction?.context.attention, "Attention", "the record");
});

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

/**
 * A decision names each ticket once. Two entries for one ticket would be two
 * `Dispatch` events at their own prefixes, the second refused by enablement for
 * a ticket the first left in `Work` — and they would carry one derived operation
 * id between them, so the second could never be delivered under a relation
 * keyed by it.
 */
test("a decision naming one ticket twice is refused however wide its budget", async () => {
  const twice = await cycleDispatching([1, 1], { dispatchesPerDecision: 2 });
  assert.equal(twice.recorded, undefined, "nothing is proposed");
  assert.deepEqual(twice.interaction?.result, {
    outcome: "Failed",
    code: "ControlViolation",
  });
  const distinct = await cycleDispatching([1, 2], {
    dispatchesPerDecision: 2,
  });
  assert.deepEqual(
    distinct.recorded?.dispatches.map((dispatch) => dispatch.ticket),
    [asTicketId(1), asTicketId(2)],
    "two tickets under a budget of two is what the same budget admits",
  );
});

/**
 * The reason a refused turn carries, which is the only thing separating the two
 * arms: the budget counts ENTRIES and runs first, so one ticket named twice
 * under a budget of one is over budget rather than repeated, and a budget
 * counting distinct tickets would name the repeat instead.
 */
test("a repeat over budget is refused as a budget, and within it as a repeat", async () => {
  const refusal = async (budget: number) => {
    try {
      await policyRefusing(
        {
          attention: "Monitoring",
          handoffNote: {},
          dispatches: [
            { ticket: 1, expectedTicketVersion: 1 },
            { ticket: 1, expectedTicketVersion: 1 },
          ],
        },
        { dispatchesPerDecision: budget },
      );
    } catch (error) {
      const rejection = (error as { readonly rejection?: unknown }).rejection;
      return rejection instanceof Error ? rejection.message : undefined;
    }
    return undefined;
  };
  assert.match(
    (await refusal(1)) ?? "",
    /dispatched more tickets than its budget/,
  );
  assert.match((await refusal(2)) ?? "", /dispatched one ticket twice/);
});

/**
 * What `record` answers is the point of the widened return type: a decision
 * whose rows were not all written claims the ones that were, because those rows
 * are in the relation and will be delivered, and names the rest for the runtime
 * to report. A decision the relation never retained claims nothing at all.
 */
test("a decision whose delivery rows were not all written claims what landed", async () => {
  const short = await cycleDispatching(
    [1, 2],
    { dispatchesPerDecision: 2 },
    offered,
    () => ({ retained: true, dispatched: [asTicketId(1)] }),
  );
  assert.deepEqual(
    short.proposals?.dispatched,
    [asTicketId(1)],
    "one row of two is one row, and the other is the loss to report",
  );
  assert.deepEqual(
    short.proposals === undefined ? [] : unwrittenDispatches(short.proposals),
    [asTicketId(2)],
  );
  assert.equal(
    short.recorded?.dispatches.length,
    2,
    "the store was still offered both",
  );
  const replayed = await cycleDispatching(
    [1, 2],
    { dispatchesPerDecision: 2 },
    offered,
    () => ({ retained: false, dispatched: [] }),
  );
  assert.equal(replayed.proposals, undefined);
  const whole = await cycleDispatching([1, 2], { dispatchesPerDecision: 2 });
  assert.equal(whole.proposals?.dispatched.length, 2);
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

/**
 * The parse ceiling is the control layer's own bound, refused before a member
 * is read. A budget wide enough to admit the count and a view carrying every
 * ticket leave it as the only thing that can refuse.
 */
test("a decision past the parse ceiling is refused before its budget judges", async () => {
  const wide = Array.from({ length: leadDispatchesMax + 1 }, (_, index) => ({
    ...dispatchable,
    ticket: asTicketId(index + 1),
  }));
  const past = await cycleDispatching(
    wide.map((candidate) => Number(candidate.ticket)),
    { dispatchesPerDecision: wide.length },
    wide,
  );
  assert.equal(past.recorded, undefined, "nothing is dispatched");
  assert.deepEqual(past.interaction?.result, {
    outcome: "Failed",
    code: "InvalidResult",
  });
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

/**
 * Each command is fenced on its own candidate. Taking the first candidate's
 * version for every command would fence three tickets on one ticket's history,
 * so a stale sibling would be admitted and a current one refused.
 */
test("each dispatch carries the version of the ticket it names", async () => {
  const versioned = [3, 5, 9].map((version, index) => ({
    ...dispatchable,
    ticket: asTicketId(index + 1),
    ticketVersion: version,
  }));
  const three = await cycleDispatching(
    [1, 2, 3],
    { dispatchesPerDecision: 3 },
    versioned,
  );
  assert.deepEqual(
    three.recorded?.dispatches.map((dispatch) => [
      Number(dispatch.command.ticket),
      dispatch.command.expectedTicketVersion,
    ]),
    [
      [1, 3],
      [2, 5],
      [3, 9],
    ],
  );
});

test("a project's dispatch budget resolves from its own row, or inherits", () => {
  assert.equal(
    resolvedSelectorSettings(partition, selectorSettingsFixture, 0, {
      limits: { dispatchesPerDecision: 5 },
    }).limits.dispatchesPerDecision,
    5,
  );
  assert.equal(
    resolvedSelectorSettings(partition, selectorSettingsFixture, 0, {}).limits
      .dispatchesPerDecision,
    selectorSettingsFixture.limits.dispatchesPerDecision,
  );
});

/** One drawn decision: the view offered, the budget set, and the entries named. */
function drawnDecision(random: Random, run: number) {
  const size = random.below(leadDispatchesMax) + 1;
  const view = Array.from({ length: size }, (_, index) => ({
    ...dispatchable,
    ticket: asTicketId(index + 1),
  }));
  /** Sometimes the whole view, so a repeat or a stranger can push one past the ceiling. */
  const named = (random.coin() ? view : subsetFrom(random, view)).map(
    (candidate) => Number(candidate.ticket),
  );
  /** A repeat, so entries and distinct tickets differ; then a ticket the view lacks. */
  const repeated =
    random.coin() && named.length > 0
      ? [...named, pickFrom(random, named)]
      : named;
  const chosen = random.coin() ? [...repeated, size + 1] : repeated;
  return {
    view,
    chosen,
    budget: random.below(leadDispatchesMax) + 1,
    size,
    label: `seed run ${String(run)}: view ${String(size)}, chosen ${chosen.join(",")}`,
  };
}

/** Which rule answers a draw, sorted, so the roster is what the tally compares to. */
const decisionArms = [
  "InvalidResult",
  "OutsideView",
  "OverBudget",
  "Proposed",
  "Repeated",
] as const;

type DecisionArm = (typeof decisionArms)[number];

/**
 * The reference: the parse ceiling refuses before the budget judges, the budget
 * counts ENTRIES so a repeat spends two, a repeat still inside the budget is a
 * violation of its own, and only what clears all three is checked against the
 * view. It is written as one total function because that is what the four rules
 * and their order are.
 */
function expectedDecision(
  drawn: ReturnType<typeof drawnDecision>,
): DecisionArm {
  if (drawn.chosen.length > leadDispatchesMax) return "InvalidResult";
  if (drawn.chosen.length > drawn.budget) return "OverBudget";
  if (new Set(drawn.chosen).size !== drawn.chosen.length) return "Repeated";
  return drawn.chosen.every((ticket) => ticket <= drawn.size)
    ? "Proposed"
    : "OutsideView";
}

/**
 * The bounds and the walk, checked against that model rather than against
 * examples, with a tally that fails when the draw stops reaching a rule. The
 * draw set carries whole views, repeats and out-of-view tickets, because a
 * model counting entries and one counting distinct tickets agree on every other
 * input; a run is a pure function of its seed, so a failure names the case that
 * produced it.
 */
test("a decision is proposed exactly when the model says it is", async () => {
  const random = randomOf(20_260_903);
  const reached = new Set<DecisionArm>();
  for (let run = 0; run < 128; run += 1) {
    const drawn = drawnDecision(random, run);
    const limits = { dispatchesPerDecision: drawn.budget };
    const expected = expectedDecision(drawn);
    reached.add(expected);
    if (expected === "OutsideView") {
      await assert.rejects(
        () => cycleDispatching(drawn.chosen, limits, drawn.view),
        /outside its observed view/,
        drawn.label,
      );
      continue;
    }
    const cycle = await cycleDispatching(drawn.chosen, limits, drawn.view);
    if (expected === "Proposed") {
      assert.deepEqual(
        cycle.recorded?.dispatches.map((dispatch) => Number(dispatch.ticket)) ??
          [],
        drawn.chosen,
        drawn.label,
      );
      continue;
    }
    assert.equal(cycle.recorded, undefined, drawn.label);
    assert.deepEqual(
      cycle.interaction?.result,
      {
        outcome: "Failed",
        code:
          expected === "InvalidResult" ? "InvalidResult" : "ControlViolation",
      },
      drawn.label,
    );
  }
  assert.deepEqual(
    [...reached].sort(),
    [...decisionArms],
    "a rule no run reaches is a rule this case asserts nothing about",
  );
});

/**
 * A delivery settles on its own ticket. The store keys a delivery by its
 * decision and its ticket, so a settlement carrying the decision alone — or
 * another of its tickets — would move a sibling row and leave this one where it
 * was, which is the one thing per-ticket rows exist to prevent.
 */
test("a delivery is settled on the decision and the ticket it names", async () => {
  const settled: unknown[] = [];
  const sibling: SelectorDelivery = {
    ...delivery,
    ticket: asTicketId(7),
    command: { ...delivery.command, ticket: asTicketId(7) },
  };
  const store = {
    ...stateStore(() => undefined),
    submitted: (decision: string, ticket: number) => {
      settled.push(["submitted", decision, ticket]);
      return Promise.resolve();
    },
    terminal: (decision: string, ticket: number, outcome: unknown) => {
      settled.push(["terminal", decision, ticket, outcome]);
      return Promise.resolve();
    },
  };
  const delivered = await deliverSelectorProposal(
    store,
    { submit: () => Promise.resolve({ accepted: "Accepted" as const }) },
    sibling,
  );
  assert.equal(delivered.result, "Delivered");
  assert.equal(
    await reconcileSelectorProposal(
      store,
      {
        operation: () =>
          Promise.resolve({ state: "Refused", code: "SelectionChanged" }),
      },
      sibling,
    ),
    true,
  );
  assert.deepEqual(settled, [
    ["submitted", "decision", asTicketId(7)],
    [
      "terminal",
      "decision",
      asTicketId(7),
      { state: "Refused", code: "SelectionChanged" },
    ],
  ]);
});

/**
 * The relation keys one row per ticket, so one ticket named twice is one row's
 * worth of ask and one thing to report lost; counting entries would report a
 * loss that did not happen. The control layer refuses a decision that repeats a
 * ticket, so no sweep can carry this input to the runtime and the function that
 * would have to survive it is driven directly.
 */
test("a ticket a decision named twice is one dispatch, written or lost", async () => {
  const cycle = await cycleDispatching([1], { dispatchesPerDecision: 1 });
  const proposals = cycle.proposals?.proposals;
  const dispatch = proposals?.dispatches[0];
  if (proposals === undefined || dispatch === undefined)
    throw new Error("the cycle proposed nothing to name twice");
  const twice = { ...proposals, dispatches: [dispatch, dispatch] };
  assert.deepEqual(unwrittenDispatches({ proposals: twice, dispatched: [] }), [
    asTicketId(1),
  ]);
  assert.deepEqual(
    unwrittenDispatches({ proposals: twice, dispatched: [asTicketId(1)] }),
    [],
  );
});

/** The token the candidate source stamps on every page it answers. */
const candidateViewToken = {
  ...partition,
  recoveryEpoch: "epoch",
  schemaVersion: 1,
  watermark: 1,
  digest: "c".repeat(64),
} as const;

/** One recorded decision that failed while standing on the token given. */
function failedRecordOn(
  token: SelectorInteractionRecord["observedToken"],
  ordinal: number,
): SelectorInteractionRecord {
  return {
    ordinal,
    deliveries: [],
    decision: `failed-decision-${String(ordinal)}`,
    partition,
    instructionsVersion: "1.0",
    instructions: "choose one",
    observedView: [],
    ...(token === undefined ? {} : { observedToken: token }),
    context: { operationalContext, handoffNote: {} },
    toolActivity: [],
    result: { outcome: "Failed", code: "PolicyFailed" },
    implementationRevision: "Unavailable",
    modelRevision: "Unavailable",
    policyRevision: "Unavailable",
    accounting: { tokens: 0, durationMs: 0 },
    startedAt: "2026-09-06T02:17:15.773Z",
    completedAt: "2026-09-06T02:17:15.773Z",
  };
}

/** One cycle whose policy fails, answering the state the store was asked to keep. */
async function failedCycleState(
  state: SelectorProjectState,
  tail: readonly SelectorInteractionRecord[],
): Promise<SelectorProjectState | undefined> {
  let kept: SelectorProjectState | undefined;
  const result = await runSelectorCycle(
    state,
    candidateSource([dispatchable]),
    refusalWrites(),
    {
      ...stateStore(() => undefined),
      tail: () => Promise.resolve(tail),
      recordInteraction: (_interaction, next) => {
        kept = next;
        return Promise.resolve(true);
      },
    },
    policyHost(() =>
      Promise.reject(new Error("the lead turn ended without an answer")),
    ),
    {
      operation: asOperationId("failing-operation"),
      selectorDecisionReference: "failing-decision",
    },
    resolved(),
  );
  assert.equal(result, undefined);
  return kept;
}

test("a failed decision leaves its view standing, and the next cycle is offered the same candidates", async () => {
  const state = observedState(0);
  const kept = await failedCycleState(state, []);
  assert.deepEqual(kept, { ...state, attention: "Attention" });
  assert.notEqual(kept, undefined);
  let offered: readonly DispatchCandidate[] = [];
  await runSelectorCycle(
    kept ?? state,
    candidateSource([dispatchable]),
    refusalWrites(),
    stateStore(() => undefined),
    policyHost((request) => {
      offered = request.observation.candidates;
      return Promise.resolve(waitingExecution());
    }),
    {
      operation: asOperationId("retried-operation"),
      selectorDecisionReference: "retried-decision",
    },
    resolved(),
  );
  assert.deepEqual(offered, [dispatchable]);
});

test("the last failure a view is allowed consumes it as a completed decision would", async () => {
  const state = observedState(0);
  const earlier = Array.from(
    { length: selectorFailedDecisionsPerViewMax - 1 },
    (_, index) => failedRecordOn(candidateViewToken, 10 - index),
  );
  const kept = await failedCycleState(state, earlier);
  assert.deepEqual(kept, {
    partition,
    notificationCursor: 1,
    revision: state.revision,
    recoveryEpoch: "epoch",
    attention: "Attention",
    handoffNote: {},
    candidateScan: { state: "Exhausted", token: candidateViewToken },
  });
});

test("failures on another view, or a decision that did not fail, do not count against this one", async () => {
  const state = observedState(0);
  const moved = { ...candidateViewToken, digest: "e".repeat(64) };
  const earlier = Array.from(
    { length: selectorFailedDecisionsPerViewMax - 1 },
    (_, index) => failedRecordOn(moved, 10 - index),
  );
  assert.deepEqual(await failedCycleState(state, earlier), {
    ...state,
    attention: "Attention",
  });
  const interrupted = [
    ...earlier.slice(0, -1).map((record) => ({
      ...record,
      observedToken: candidateViewToken,
    })),
    {
      ...failedRecordOn(candidateViewToken, 1),
      result: { dispatches: [], refusals: [], lifts: [] },
    },
  ];
  assert.deepEqual(await failedCycleState(state, interrupted), {
    ...state,
    attention: "Attention",
  });
});
