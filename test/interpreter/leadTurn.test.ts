/**
 * What a lead turn's two documents accept and what they refuse.
 *
 * The refusals are the whole point of the module: the pod truncates a long
 * result before it posts it, so every case below is one a lenient parser would
 * have half-accepted.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { agenticRefusalReasonCharsMax } from "../../src/contract/http.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { AgenticRefusalRecord } from "../../src/interpreter/agenticRefusal.ts";
import type { DispatchCandidate } from "../../src/interpreter/dispatchView.ts";
import {
  leadObservationText,
  leadObservedRefusals,
  parseLeadDecision,
  parseLeadObservation,
  type LeadObservationDocument,
} from "../../src/interpreter/leadTurn.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  leadDecisionBytesMax,
  leadDispatchesMax,
  leadObservationBytesMax,
  leadRefusalsPerDecisionMax,
  leadInputBytesMax,
  resolvedSelectorSettings,
  type SelectorObservation,
  type SelectorRuntimeSettings,
} from "../../src/interpreter/selector.ts";

const partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

const candidate: DispatchCandidate = {
  ticket: asTicketId(41),
  ticketVersion: 3,
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
};

const token = {
  ...partition,
  recoveryEpoch: "epoch",
  schemaVersion: 1,
  watermark: 2,
  digest: "a".repeat(64),
};

const operationalContext = {
  version: 2,
  observedAt: "2026-09-02T12:00:00.000Z",
  observedAtEpochMs: 1_788_000_000_000,
  reviewFeedback: [],
  activeWork: { queued: 0, admitted: 0, launching: 0, running: 0 },
  capacity: {
    account: "account",
    accountMaximum: 8,
    accountActive: 1,
    accountReservationDeficit: 0,
    clusterSlotsMax: 8,
    clusterActive: 1,
  },
  backlog: {
    project: { queued: 0, ceiling: 100 },
    installation: { queued: 0, ceiling: 1_000 },
  },
} as const;

const observation: SelectorObservation = {
  token,
  candidates: [candidate],
  notificationCursor: 1_204,
  changes: [{ ordinal: 1_205, kind: "Ticket", resource: "41" }],
  operationalContext,
  handoffNote: { watching: "41" },
  nextCandidateScan: { state: "Exhausted", token },
};

const standing: readonly AgenticRefusalRecord[] = [
  {
    ticket: asTicketId(40),
    ticketVersion: 2,
    reason: "its dependency has not passed",
    decision: "selector-decision-one",
    recordedAt: "2026-09-02T11:00:00.000Z",
  },
];

const document: LeadObservationDocument = {
  version: 1,
  decision: "selector-decision-two",
  partition,
  instructions: { revision: "12.4", content: "select" },
  changes: observation.changes,
  candidates: observation.candidates,
  token,
  operationalContext,
  handoffNote: observation.handoffNote,
  refusals: leadObservedRefusals(standing, observation.candidates),
};

function decision(body: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({
    version: 1,
    attention: "Monitoring",
    handoffNote: {},
    ...body,
  });
}

test("an observation document round-trips through its own text", () => {
  assert.deepEqual(
    parseLeadObservation(leadObservationText(document)),
    document,
  );
});

test("a refusal is superseded where its version is not the candidate's", () => {
  const refused: AgenticRefusalRecord = {
    ticket: candidate.ticket,
    ticketVersion: 2,
    reason: "its dependency has not passed",
    decision: "selector-decision-one",
    recordedAt: "2026-09-02T11:00:00.000Z",
  };
  assert.equal(
    leadObservedRefusals([refused], [candidate])[0]?.superseded,
    true,
  );
  assert.equal(
    leadObservedRefusals([{ ...refused, ticketVersion: 3 }], [candidate])[0]
      ?.superseded,
    false,
  );
});

test("the effective budget is the smaller of the settings and the mailbox", () => {
  const defaults: SelectorRuntimeSettings = {
    revision: 1,
    mode: "Running",
    dispatchMode: "Automatic",
    basePrompt: "select",
    modelAllowlist: ["*"],
    toolAllowlist: ["*"],
    limits: {
      tokensPerDecision: 1,
      millisecondsPerDecision: 1,
      toolCallsPerDecision: 1,
      inputBytesPerDecision: leadObservationBytesMax * 2,
      candidatePagesPerDecision: 1,
      concurrentDecisions: 1,
      selectionsPerMinute: 1,
    },
    operationalContextMaxAgeMs: 1,
  };
  assert.equal(
    leadInputBytesMax(resolvedSelectorSettings(partition, defaults, 0, {})),
    leadObservationBytesMax,
  );
  assert.equal(
    leadInputBytesMax(
      resolvedSelectorSettings(partition, defaults, 0, {
        limits: { inputBytesPerDecision: 1_024 },
      }),
    ),
    1_024,
  );
});

test("a decision names what it chose, refused and lifted", () => {
  const parsed = parseLeadDecision(
    decision({
      dispatches: [{ ticket: 41, expectedTicketVersion: 3 }],
      refusals: [{ ticket: 41, ticketVersion: 3, reason: "not yet" }],
      lifts: [{ ticket: 40 }],
      attention: "Attention",
      handoffNote: { watching: "41" },
    }),
    observation,
    standing,
  );
  assert.deepEqual(parsed.dispatches, [
    { ticket: candidate.ticket, expectedTicketVersion: 3 },
  ]);
  assert.deepEqual(parsed.refusals, [
    { ticket: candidate.ticket, ticketVersion: 3, reason: "not yet" },
  ]);
  assert.deepEqual(parsed.lifts, [{ ticket: asTicketId(40) }]);
  assert.equal(parsed.attention, "Attention");
});

test("a decision that chose nothing is the free one and parses", () => {
  const parsed = parseLeadDecision(decision({}), observation, standing);
  assert.deepEqual(parsed.dispatches, []);
  assert.deepEqual(parsed.refusals, []);
  assert.deepEqual(parsed.lifts, []);
});

test("a decision the pod truncated is refused rather than half-accepted", () => {
  const whole = decision({
    dispatches: [{ ticket: 41, expectedTicketVersion: 3 }],
  });
  assert.throws(() =>
    parseLeadDecision(whole.slice(0, whole.length - 8), observation, standing),
  );
});

test("a decision of another version, or over its bound, is refused", () => {
  assert.throws(
    () =>
      parseLeadDecision(
        JSON.stringify({
          version: 2,
          attention: "Monitoring",
          handoffNote: {},
        }),
        observation,
        standing,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      parseLeadDecision(
        decision({
          handoffNote: { padding: "x".repeat(leadDecisionBytesMax) },
        }),
        observation,
        standing,
      ),
    RangeError,
  );
});

test("a decision naming a ticket or a version the view did not show is refused", () => {
  assert.throws(
    () =>
      parseLeadDecision(
        decision({ dispatches: [{ ticket: 99, expectedTicketVersion: 3 }] }),
        observation,
        standing,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      parseLeadDecision(
        decision({ dispatches: [{ ticket: 41, expectedTicketVersion: 2 }] }),
        observation,
        standing,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      parseLeadDecision(
        decision({
          refusals: [{ ticket: 41, ticketVersion: 9, reason: "not yet" }],
        }),
        observation,
        standing,
      ),
    TypeError,
  );
});

test("a decision naming more choices than its bounds is refused", () => {
  const dispatches = Array.from({ length: leadDispatchesMax + 1 }, () => ({
    ticket: 41,
    expectedTicketVersion: 3,
  }));
  assert.throws(
    () => parseLeadDecision(decision({ dispatches }), observation, standing),
    RangeError,
  );
  const refusals = Array.from(
    { length: leadRefusalsPerDecisionMax + 1 },
    () => ({ ticket: 41, ticketVersion: 3, reason: "not yet" }),
  );
  assert.throws(
    () => parseLeadDecision(decision({ refusals }), observation, standing),
    RangeError,
  );
  const lifts = Array.from({ length: leadRefusalsPerDecisionMax + 1 }, () => ({
    ticket: 40,
  }));
  assert.throws(
    () => parseLeadDecision(decision({ lifts }), observation, standing),
    RangeError,
  );
});

test("a refusal reason longer than its bound, or empty, is refused", () => {
  for (const reason of ["", "x".repeat(agenticRefusalReasonCharsMax + 1)])
    assert.throws(
      () =>
        parseLeadDecision(
          decision({ refusals: [{ ticket: 41, ticketVersion: 3, reason }] }),
          observation,
          standing,
        ),
      TypeError,
    );
});

test("a lift of a refusal that is not standing is refused", () => {
  assert.throws(
    () =>
      parseLeadDecision(
        decision({ lifts: [{ ticket: 39 }] }),
        observation,
        standing,
      ),
    TypeError,
  );
});

test("a decision with no handoff note and no attention is refused", () => {
  assert.throws(
    () =>
      parseLeadDecision(
        JSON.stringify({ version: 1, attention: "Monitoring" }),
        observation,
        standing,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      parseLeadDecision(
        JSON.stringify({ version: 1, handoffNote: {} }),
        observation,
        standing,
      ),
    TypeError,
  );
});

test("an observation over its bound, or missing a collection, is refused", () => {
  assert.throws(
    () =>
      leadObservationText({
        ...document,
        handoffNote: { padding: "x".repeat(leadObservationBytesMax) },
      }),
    RangeError,
  );
  assert.throws(
    () =>
      parseLeadObservation(
        JSON.stringify({ ...document, candidates: undefined }),
      ),
    TypeError,
  );
});
