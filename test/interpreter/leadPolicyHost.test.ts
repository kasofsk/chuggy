import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import {
  asSessionId,
  type SessionTurnId,
  type SessionTurnState,
} from "../../src/interpreter/agentSession.ts";
import type { AgenticRefusalRecord } from "../../src/interpreter/agenticRefusal.ts";
import type {
  LeadMailbox,
  LeadTurnMeasured,
  LeadTurnOffered,
  LeadTurnStanding,
  LeadTurnWithdrawn,
} from "../../src/interpreter/leadMailbox.ts";
import {
  leadSelectorPolicy,
  type LeadDecisionTail,
  type LeadPolicyClock,
} from "../../src/interpreter/leadPolicyHost.ts";
import { parseLeadObservation } from "../../src/interpreter/leadTurn.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type {
  SelectorInteractionRecord,
  SelectorObservation,
  SelectorPolicyExecution,
  SelectorPolicyRequest,
} from "../../src/interpreter/selector.ts";

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

const operationalContext = {
  version: 2,
  observedAt: "2026-09-02T12:00:00.000Z",
  observedAtEpochMs: 1_788_000_000_000,
  reviewFeedback: [],
  activeWork: { queued: 0, admitted: 0, launching: 0, running: 0 },
  capacity: {
    account: "project",
    accountMaximum: 4,
    accountActive: 0,
    accountReservationDeficit: 0,
    clusterSlotsMax: 10,
    clusterActive: 2,
  },
  backlog: {
    project: { queued: 0, ceiling: 100 },
    installation: { queued: 0, ceiling: 1_000 },
  },
} as const;

const observation: SelectorObservation = {
  token,
  candidates: [candidate],
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

const measured: LeadTurnMeasured = {
  model: "claude-opus-5",
  tokens: 4_096,
  costMicros: 12_345,
  durationMs: 61_000,
  tools: ["Read", "Grep"],
};

const decisionDocument = JSON.stringify({
  version: 1,
  dispatches: [{ ticket: 41, expectedTicketVersion: 3 }],
  refusals: [{ ticket: 41, ticketVersion: 3, reason: "not yet" }],
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
  readonly measured?: LeadTurnMeasured;
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

function decisionTail(
  records: readonly SelectorInteractionRecord[] = [],
): LeadDecisionTail {
  return { tail: () => Promise.resolve(records) };
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

test("a decision this process never offered is unconfirmed, not invented", async () => {
  const double = mailboxDouble();
  assert.deepEqual(
    await policyOf(double).inspect(
      "selector-decision-from-a-dead-process",
      new AbortController().signal,
    ),
    { status: "Unconfirmed" },
  );
});

test("a session with no agent reference is seeded and one with a reference is not", async () => {
  const seeded = mailboxDouble();
  const policy = leadSelectorPolicy(
    seeded.mailbox,
    refusalRead(),
    decisionTail([
      interactionRecord(1, { outcome: "Failed", code: "InvalidResult" }),
      interactionRecord(2, {
        dispatches: [{ ticket: 40 }],
        refusals: [{ ticket: 42, ticketVersion: 2, reason: "no" }],
        lifts: [],
        attention: "Monitoring",
        handoffNote: {},
      }),
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
  const filler = "x".repeat(2_048);
  const double = mailboxDouble();
  const policy = leadSelectorPolicy(
    double.mailbox,
    refusalRead(),
    decisionTail(
      Array.from({ length: 64 }, (_unused, index) =>
        interactionRecord(index + 1, {
          dispatches: [],
          refusals: [],
          lifts: [],
          attention: "Monitoring",
          handoffNote: {},
        }),
      ),
    ),
    clock(),
    { pollIntervalMs: 1, implementationRevision: "selector-build-1" },
  );
  await policy.execute(
    {
      ...request,
      instructions: { ...request.instructions, content: filler },
    },
    new AbortController().signal,
  );
  const observed = parseLeadObservation(double.offers[0]?.input ?? "");
  const decisions = observed.seeding?.decisions ?? [];
  assert.ok(decisions.length > 0);
  assert.equal(decisions.at(-1)?.ordinal, 64);
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
