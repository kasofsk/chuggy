import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import {
  asSessionId,
  type SessionTurnId,
  type SessionTurnMeasured,
  type SessionTurnState,
} from "../../src/interpreter/agentSession.ts";
import type { AgenticRefusalRecord } from "../../src/interpreter/agenticRefusal.ts";
import type {
  LeadMailbox,
  LeadTurnOffered,
  LeadTurnStanding,
  LeadTurnWithdrawn,
} from "../../src/interpreter/leadMailbox.ts";
import {
  leadSelectorPolicy,
  leadTurnInput,
  type LeadDecisionTail,
  type LeadPolicyClock,
} from "../../src/interpreter/leadPolicyHost.ts";
import type {
  LeadObservedRefusal,
  LeadSeeding,
} from "../../src/interpreter/leadTurn.ts";
import { parseLeadObservation } from "../../src/interpreter/leadTurn.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  leadObservationBytesMax,
  leadRefusalsObservedMax,
  type SelectorInteractionRecord,
  type SelectorObservation,
  type SelectorPolicyExecution,
  type SelectorPolicyRequest,
} from "../../src/interpreter/selector.ts";
import { selectorOperationalContext } from "./selectorFixture.ts";
import {
  agenticRefusalReasonCharsMax,
  selectorHandoffNoteBytesMax,
  selectorSettingsTextCharsMax,
} from "../../src/contract/http.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const token = {
  ...partition,
  recoveryEpoch: "epoch",
  schemaVersion: 1,
  watermark: 7,
  digest: "a".repeat(64),
};

const candidate = {
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
} as const;

const operationalContext = selectorOperationalContext;

/** A second candidate, so one decision can dispatch one ticket and refuse another. */
const declined = { ...candidate, ticket: asTicketId(43), ticketVersion: 1 };

const observation: SelectorObservation = {
  token,
  candidates: [candidate, declined],
  notificationCursor: 12,
  changes: [{ ordinal: 12, kind: "Ticket", resource: "41" }],
  operationalContext,
  handoffNote: { watching: "41" },
  nextCandidateScan: { state: "Exhausted", token },
};

const request: SelectorPolicyRequest = {
  attempt: "selector-decision-one",
  observation,
  instructions: { revision: "1.0", content: "prompt", northStar: "north" },
  constraints: {
    models: ["*"],
    tools: ["*"],
    limits: {
      tokensPerDecision: 200_000,
      millisecondsPerDecision: 900_000,
      toolCallsPerDecision: 20,
      dispatchesPerDecision: 1,
      inputBytesPerDecision: 1_048_576,
      candidatePagesPerDecision: 1,
      concurrentDecisions: 4,
      selectionsPerMinute: 60,
    },
  },
};

/** One refusal on a ticket the view still carries, and one on a ticket it does not. */
const standingRefusals: readonly AgenticRefusalRecord[] = [
  {
    ticket: asTicketId(41),
    ticketVersion: 1,
    reason: "the brief named no acceptance",
    decision: "selector-decision-zero",
    recordedAt: "2026-09-01T12:00:00.000Z",
  },
  {
    ticket: asTicketId(42),
    ticketVersion: 2,
    reason: "its dependency is unfinished",
    decision: "selector-decision-zero",
    recordedAt: "2026-09-01T12:00:00.000Z",
  },
];

const measured: SessionTurnMeasured = {
  model: "claude-opus-5",
  tokens: 4_096,
  costMicros: 12_345,
  durationMs: 61_000,
  tools: ["Read", "Grep"],
};

const decisionDocument = JSON.stringify({
  version: 1,
  dispatches: [{ ticket: 41, expectedTicketVersion: 3 }],
  refusals: [{ ticket: 43, ticketVersion: 1, reason: "not yet" }],
  lifts: [{ ticket: 42 }],
  attention: "Attention",
  handoffNote: { next: "41" },
});

const clock = (epochs: readonly number[] = []): LeadPolicyClock => {
  let read = 0;
  return {
    now: () => {
      const epochMs = epochs[read++] ?? 1_788_000_000_000 + read;
      return Promise.resolve({
        instant: new Date(epochMs).toISOString(),
        epochMs,
      });
    },
    wait: () => Promise.resolve(),
  };
};

interface MailboxOptions {
  readonly agentReference?: string;
  readonly state?: "Open" | "Closed";
  readonly absent?: boolean;
  readonly offered?: LeadTurnOffered;
  readonly turnStates?: readonly SessionTurnState[];
  readonly result?: string;
  readonly measured?: SessionTurnMeasured;
  readonly withdrawn?: LeadTurnWithdrawn;
}

interface MailboxDouble {
  readonly mailbox: LeadMailbox;
  readonly offers: { readonly input: string }[];
  readonly reads: () => number;
}

function mailboxDouble(options: MailboxOptions = {}): MailboxDouble {
  const offers: { readonly input: string }[] = [];
  const states = options.turnStates ?? (["Answered"] as const);
  let read = 0;
  return {
    offers,
    reads: () => read,
    mailbox: {
      lead: () =>
        Promise.resolve(
          options.absent === true
            ? undefined
            : {
                session: asSessionId("lead-session"),
                state: options.state ?? "Open",
                ...(options.agentReference === undefined
                  ? {}
                  : { agentReference: options.agentReference }),
              },
        ),
      offer: (input) => {
        offers.push({ input: input.input });
        return Promise.resolve(
          options.offered ?? { offered: "Enqueued", ordinal: offers.length },
        );
      },
      turn: (): Promise<LeadTurnStanding> => {
        const state = states[Math.min(read++, states.length - 1)] ?? "Answered";
        return Promise.resolve({
          state,
          ...(state === "Answered"
            ? { result: options.result ?? decisionDocument }
            : {}),
          ...(state === "Failed" || state === "Abandoned"
            ? { failure: "TurnWithdrawn" as const }
            : {}),
          ...(options.measured === undefined
            ? {}
            : { measured: options.measured }),
        });
      },
      withdraw: () => Promise.resolve(options.withdrawn ?? "Withdrawn"),
    },
  };
}

function refusalRead(
  records: readonly AgenticRefusalRecord[] = standingRefusals,
) {
  return {
    standing: () => Promise.resolve(records),
    ledger: () => Promise.resolve([]),
  };
}

/** The tail port answers newest first, which is what the door it stands for does. */
function decisionTail(
  newestFirst: readonly SelectorInteractionRecord[] = [],
): LeadDecisionTail {
  return { tail: () => Promise.resolve(newestFirst) };
}

function interactionRecord(
  ordinal: number,
  result: SelectorInteractionRecord["result"],
): SelectorInteractionRecord {
  return {
    ordinal,
    decision: `selector-decision-${String(ordinal)}`,
    partition,
    instructionsVersion: "1.0",
    instructions: "prompt",
    observedView: [],
    context: { operationalContext, handoffNote: {} },
    toolActivity: [],
    result,
    implementationRevision: "implementation",
    modelRevision: "model",
    policyRevision: "policy",
    accounting: { tokens: 1, durationMs: 1 },
    startedAt: "2026-09-01T12:00:00.000Z",
    completedAt: "2026-09-01T12:00:01.000Z",
  };
}

function policyOf(double: MailboxDouble) {
  return leadSelectorPolicy(
    double.mailbox,
    refusalRead(),
    decisionTail(),
    clock(),
    { pollIntervalMs: 1, implementationRevision: "selector-build-1" },
  );
}

test("a decision is one turn, and the turn's result is the decision", async () => {
  const double = mailboxDouble({
    agentReference: "agent-session-9",
    measured,
  });
  const execution = (await policyOf(double).execute(
    request,
    new AbortController().signal,
  )) as SelectorPolicyExecution;
  assert.equal(double.offers.length, 1);
  const observed = parseLeadObservation(double.offers[0]?.input ?? "");
  assert.equal(observed.decision, request.attempt);
  assert.deepEqual(observed.changes, observation.changes);
  assert.deepEqual(observed.handoffNote, observation.handoffNote);
  assert.equal(observed.seeding, undefined);
  assert.deepEqual(
    observed.refusals.map((refusal) => [refusal.ticket, refusal.superseded]),
    [
      [41, true],
      [42, false],
    ],
  );
  assert.deepEqual(execution.result.dispatches, [
    { ticket: 41, expectedTicketVersion: 3 },
  ]);
  assert.deepEqual(execution.result.lifts, [{ ticket: 42 }]);
  assert.equal(execution.result.attention, "Attention");
  assert.equal(execution.modelRevision, measured.model);
  assert.equal(execution.policyRevision, "agent-session-9");
  assert.deepEqual(execution.toolActivity, [
    { tool: "Read" },
    { tool: "Grep" },
  ]);
  assert.deepEqual(execution.accounting, {
    tokens: measured.tokens,
    durationMs: measured.durationMs,
    costMicros: measured.costMicros,
  });
  assert.equal(execution.implementationRevision, "selector-build-1");
});

test("a turn that measured nothing spends the host's own wall clock", async () => {
  const double = mailboxDouble({ agentReference: "agent-session-9" });
  const policy = leadSelectorPolicy(
    double.mailbox,
    refusalRead(),
    decisionTail(),
    clock([1_788_000_000_000, 1_788_000_150_000]),
    { pollIntervalMs: 1, implementationRevision: "selector-build-1" },
  );
  const execution = (await policy.execute(
    request,
    new AbortController().signal,
  )) as SelectorPolicyExecution;
  assert.equal(execution.modelRevision, "Unavailable");
  assert.deepEqual(execution.accounting, { tokens: 0, durationMs: 150_000 });
  assert.deepEqual(execution.toolActivity, []);
});

test("a project with no open lead is one no decision is invented for", async () => {
  for (const options of [{ absent: true }, { state: "Closed" as const }]) {
    const double = mailboxDouble(options);
    await assert.rejects(
      policyOf(double).execute(request, new AbortController().signal),
      /no open lead/u,
    );
    assert.equal(double.offers.length, 0);
  }
});

test("a turn that ends without an answer raises with what ended it", async () => {
  for (const state of ["Failed", "Abandoned"] as const) {
    const double = mailboxDouble({ turnStates: [state] });
    await assert.rejects(
      policyOf(double).execute(request, new AbortController().signal),
      (error: unknown) =>
        error instanceof Error &&
        /without an answer/u.test(error.message) &&
        error.cause === "TurnWithdrawn",
    );
  }
});

test("a mailbox that takes no turn refuses the decision rather than waiting", async () => {
  for (const offered of ["NoLead", "Closed", "Backlogged"] as const) {
    const double = mailboxDouble({ offered: { offered } });
    await assert.rejects(
      policyOf(double).execute(request, new AbortController().signal),
      (error: unknown) => error instanceof Error && error.cause === offered,
    );
  }
});

test("the host polls until the turn leaves the mailbox", async () => {
  const double = mailboxDouble({
    turnStates: ["Queued", "Claimed", "Claimed", "Answered"],
  });
  await policyOf(double).execute(request, new AbortController().signal);
  assert.equal(double.reads(), 4);
});

test("a withdrawal is the termination proof, and no turn is unconfirmed", async () => {
  for (const withdrawn of ["Withdrawn", "AlreadyEnded"] as const) {
    const double = mailboxDouble({ withdrawn, turnStates: ["Queued"] });
    const policy = policyOf(double);
    await policy.execute(request, AbortSignal.abort()).catch(() => undefined);
    const termination = await policy.cancel(
      request.attempt,
      new AbortController().signal,
    );
    assert.equal(termination.status, "Terminated");
    assert.equal(
      termination.status === "Terminated" ? termination.attempt : undefined,
      request.attempt,
    );
    assert.match(
      termination.status === "Terminated" ? termination.proof : "",
      new RegExp(withdrawn, "u"),
    );
  }
  const noTurn = mailboxDouble({ withdrawn: "NoTurn", turnStates: ["Queued"] });
  const policy = policyOf(noTurn);
  await policy.execute(request, AbortSignal.abort()).catch(() => undefined);
  assert.deepEqual(
    await policy.inspect(request.attempt, new AbortController().signal),
    { status: "Unconfirmed" },
  );
});

test("a decision this process never offered is still settled from the row", async () => {
  const double = mailboxDouble({ withdrawn: "AlreadyEnded" });
  const termination = await policyOf(double).inspect(
    "selector-decision-from-a-dead-process",
    new AbortController().signal,
  );
  assert.equal(termination.status, "Terminated");
  assert.equal(
    termination.status === "Terminated" ? termination.attempt : undefined,
    "selector-decision-from-a-dead-process",
  );
});

test("the parts a turn never sheds fit its mailbox row at their ceilings", () => {
  const standing = Array.from(
    { length: leadRefusalsObservedMax },
    (_unused, index) => ({
      ticket: asTicketId(index + 1),
      ticketVersion: 1,
      reason: "r".repeat(agenticRefusalReasonCharsMax),
      recordedAt: "2026-09-01T12:00:00.000Z",
      superseded: false,
    }),
  );
  const filled = leadTurnInput(
    {
      ...request,
      instructions: {
        revision: request.instructions.revision,
        content: "b".repeat(selectorSettingsTextCharsMax),
        northStar: "n".repeat(selectorSettingsTextCharsMax),
      },
      observation: {
        ...observation,
        candidates: [],
        changes: [],
        handoffNote: { note: "h".repeat(selectorHandoffNoteBytesMax / 2) },
      },
    },
    partition,
    standing,
    undefined,
  );
  const observed = parseLeadObservation(filled);
  assert.deepEqual(
    observed.refusals.map((refusal) => refusal.ticket),
    standing.map((refusal) => refusal.ticket),
    "every standing refusal survives, because a lead is judged on all of them",
  );
  assert.deepEqual(
    observed.refusals.map((refusal) => refusal.reason.length),
    standing.map((refusal) => refusal.reason.length),
    "a refusal shown with its reason cut is a refusal the lead cannot weigh",
  );
  assert.deepEqual(observed.handoffNote, {
    note: "h".repeat(selectorHandoffNoteBytesMax / 2),
  });
});

test("a lift of a refusal the turn did not show is impossible", () => {
  const standing = Array.from(
    { length: leadRefusalsObservedMax },
    (_unused, index) => ({
      ticket: asTicketId(index + 1),
      ticketVersion: 1,
      reason: "r".repeat(agenticRefusalReasonCharsMax),
      recordedAt: "2026-09-01T12:00:00.000Z",
      superseded: false,
    }),
  );
  const shown = parseLeadObservation(
    leadTurnInput(
      {
        ...request,
        observation: {
          ...observation,
          candidates: [],
          changes: [],
          handoffNote: { note: "h".repeat(selectorHandoffNoteBytesMax / 2) },
        },
      },
      partition,
      standing,
      undefined,
    ),
  ).refusals.map((refusal) => refusal.ticket);
  for (const refusal of standing)
    assert.ok(
      shown.includes(refusal.ticket),
      `${String(refusal.ticket)} is standing, so the lead must be shown it before it can be judged for lifting it`,
    );
});

/** Every standing refusal an observation may carry, each at its own ceiling. */
const standingAtCeiling = Array.from(
  { length: leadRefusalsObservedMax },
  (_unused, index) => ({
    ticket: asTicketId(index + 1),
    ticketVersion: 1,
    reason: "r".repeat(agenticRefusalReasonCharsMax),
    recordedAt: "2026-09-01T12:00:00.000Z",
    superseded: false,
  }),
);

/**
 * A document padded by a part nothing sheds, sized against itself so the
 * standing refusals are exactly what tips it past the ceiling: without them it
 * fits, with them it does not, and the rung under test has nothing left to
 * shed but must not shed them.
 */
function overflowedByItsRefusals(seeding: LeadSeeding | undefined) {
  const padded = (
    account: string,
    shown: readonly LeadObservedRefusal[],
  ): string =>
    leadTurnInput(
      {
        ...request,
        observation: {
          ...observation,
          operationalContext: {
            ...operationalContext,
            capacity: { ...operationalContext.capacity, account },
          },
        },
      },
      partition,
      shown,
      seeding,
    );
  const bare = padded("", []).length;
  const shownBytes = JSON.stringify(standingAtCeiling).length;
  const account = "x".repeat(
    leadObservationBytesMax - bare - Math.floor(shownBytes / 2),
  );
  assert.ok(
    padded(account, []).length <= leadObservationBytesMax,
    "without the refusals this document fits, so shedding them would answer one",
  );
  return () => padded(account, standingAtCeiling);
}

test("an unseeded document overflowed past its refusals is refused, not shed", () => {
  assert.throws(
    overflowedByItsRefusals(undefined),
    (error: unknown) =>
      error instanceof RangeError &&
      /nothing sheddable/u.test(error.message) &&
      /objectives, handoff note, cursor and refusals/u.test(error.message),
    "the steady-state turn carries no seeding, and its refusals are still never shed",
  );
});

test("a seeded document shed to nothing is refused, not shed further", () => {
  assert.throws(
    overflowedByItsRefusals({
      handoffNote: { note: "kept" },
      decisions: [],
      refusals: [],
      notificationCursor: 12,
    }),
    (error: unknown) =>
      error instanceof RangeError &&
      /seeding shed to nothing/u.test(error.message) &&
      /objectives, handoff note, cursor and refusals/u.test(error.message),
  );
});

test("a session with no agent reference is seeded and one with a reference is not", async () => {
  const seeded = mailboxDouble();
  const policy = leadSelectorPolicy(
    seeded.mailbox,
    refusalRead(),
    decisionTail([
      interactionRecord(2, {
        dispatches: [{ ticket: 40 }],
        refusals: [{ ticket: 42, ticketVersion: 2, reason: "no" }],
        lifts: [],
        attention: "Monitoring",
        handoffNote: {},
      }),
      interactionRecord(1, { outcome: "Failed", code: "InvalidResult" }),
    ]),
    clock(),
    { pollIntervalMs: 1, implementationRevision: "selector-build-1" },
  );
  const execution = (await policy.execute(
    request,
    new AbortController().signal,
  )) as SelectorPolicyExecution;
  const observed = parseLeadObservation(seeded.offers[0]?.input ?? "");
  assert.deepEqual(observed.seeding?.handoffNote, observation.handoffNote);
  assert.equal(observed.seeding?.notificationCursor, 12);
  assert.deepEqual(observed.seeding?.decisions, [
    {
      ordinal: 2,
      decision: "selector-decision-2",
      completedAt: "2026-09-01T12:00:01.000Z",
      dispatched: [40],
      refused: [42],
      attention: "Monitoring",
    },
  ]);
  assert.deepEqual(
    observed.seeding?.refusals.map((refusal) => refusal.ticket),
    [41, 42],
  );
  assert.equal(execution.policyRevision, "Unbound");

  const bound = mailboxDouble({ agentReference: "agent-session-9" });
  await policyOf(bound).execute(request, new AbortController().signal);
  assert.equal(
    parseLeadObservation(bound.offers[0]?.input ?? "").seeding,
    undefined,
  );
});

test("a seeding block the mailbox could not hold sheds its oldest decisions", async () => {
  const oversized = 500_000;
  const double = mailboxDouble();
  const policy = leadSelectorPolicy(
    double.mailbox,
    refusalRead(),
    decisionTail(
      Array.from({ length: 40 }, (_unused, index) => ({
        ...interactionRecord(40 - index, {
          dispatches: [],
          refusals: [],
          lifts: [],
          attention: "Monitoring",
          handoffNote: {},
        }),
        decision: `${String(40 - index)}-${"d".repeat(oversized)}`,
      })),
    ),
    clock(),
    { pollIntervalMs: 1, implementationRevision: "selector-build-1" },
  );
  await policy.execute(request, new AbortController().signal);
  const observed = parseLeadObservation(double.offers[0]?.input ?? "");
  const decisions = observed.seeding?.decisions ?? [];
  assert.deepEqual(
    observed.refusals.map((refusal) => refusal.ticket),
    standingRefusals.map((refusal) => refusal.ticket),
    "shedding a seeded tail never sheds the refusals the decision is judged on",
  );
  assert.ok(decisions.length > 0, "the shed stops while something is left");
  assert.ok(decisions.length < 40, "an unholdable tail is shed, not offered");
  assert.equal(
    decisions.at(-1)?.ordinal,
    40,
    "the newest decision is what a successor keeps",
  );
  assert.deepEqual(observed.seeding?.handoffNote, observation.handoffNote);
  assert.equal(observed.seeding?.notificationCursor, 12);
});

test("a truncated decision document is refused rather than half-accepted", async () => {
  const double = mailboxDouble({
    result: decisionDocument.slice(0, decisionDocument.length - 8),
  });
  await assert.rejects(
    policyOf(double).execute(request, new AbortController().signal),
    SyntaxError,
  );
});

test("a decision naming a ticket the observation did not carry is refused", async () => {
  const double = mailboxDouble({
    result: JSON.stringify({
      version: 1,
      dispatches: [{ ticket: 99, expectedTicketVersion: 1 }],
      attention: "Monitoring",
      handoffNote: {},
    }),
  });
  await assert.rejects(
    policyOf(double).execute(request, new AbortController().signal),
    TypeError,
  );
});

test("a retried decision finds the turn it already enqueued", async () => {
  const double = mailboxDouble({
    offered: { offered: "AlreadyEnqueued", ordinal: 1 },
  });
  const policy = policyOf(double);
  await policy.execute(request, new AbortController().signal);
  await policy.execute(request, new AbortController().signal);
  assert.deepEqual(
    double.offers.map((offer) => offer.input),
    [double.offers[0]?.input, double.offers[0]?.input],
  );
});

test("a poll interval that could never fire is refused at construction", () => {
  assert.throws(
    () =>
      leadSelectorPolicy(
        mailboxDouble().mailbox,
        refusalRead(),
        decisionTail(),
        clock(),
        { pollIntervalMs: 0, implementationRevision: "selector-build-1" },
      ),
    RangeError,
  );
});

test("an abandoned run stops polling rather than waiting for an answer", async () => {
  const double = mailboxDouble({ turnStates: ["Queued"] });
  const control = new AbortController();
  const running = policyOf(double).execute(request, control.signal);
  control.abort();
  await assert.rejects(running);
});

/** The turn identity a mailbox is offered is the decision reference itself. */
test("the turn's identity is the decision's", async () => {
  const identities: SessionTurnId[] = [];
  const double = mailboxDouble();
  const policy = leadSelectorPolicy(
    {
      ...double.mailbox,
      offer: (input) => {
        identities.push(input.turn);
        return double.mailbox.offer(input);
      },
    },
    refusalRead(),
    decisionTail(),
    clock(),
    { pollIntervalMs: 1, implementationRevision: "selector-build-1" },
  );
  await policy.execute(request, new AbortController().signal);
  assert.deepEqual(identities, [request.attempt]);
});
