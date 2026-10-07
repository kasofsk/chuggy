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
import { leadSystemPrompt } from "../../src/interpreter/leadTools.ts";
import type {
  LeadClosed,
  LeadMailbox,
  LeadOpening,
  LeadSessionMint,
  LeadSessionStanding,
  LeadTurnOffered,
  LeadTurnStanding,
  LeadTurnWithdrawn,
} from "../../src/interpreter/leadMailbox.ts";
import {
  leadSelectorPolicy,
  leadStandingReplaced,
  leadTurnInput,
  type LeadDecisionTail,
  type LeadPolicyClock,
} from "../../src/interpreter/leadPolicyHost.ts";
import type {
  LeadObservedRefusal,
  LeadSeeding,
} from "../../src/interpreter/leadTurn.ts";
import { parseLeadObservation } from "../../src/interpreter/leadTurn.ts";
import type { Principal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  ProjectAccessUnavailable,
  type ProjectAccess,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  leadObservationBytesMax,
  leadRefusalsObservedMax,
  type SelectorInteractionRecord,
  type SelectorObservation,
  type SelectorPolicyExecution,
  type SelectorPolicyRequest,
} from "../../src/interpreter/selector.ts";
import type { SessionRouteReads } from "../../src/interpreter/sessionPlacement.ts";
import { selectorOperationalContext } from "./selectorFixture.ts";
import {
  sessionRoutesAt,
  sessionRoutesFlipping,
} from "./sessionRoutesFixture.ts";
import {
  agenticRefusalReasonCharsMax,
  leadTurnTokensMax,
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
  program: [{ key: 1, evaluators: [{ key: 1 }] }],
  configurationRevision: "revision",
  configurationDigest: "d".repeat(64),
  configurationCanonical: "{}",
} as const;

const operationalContext = selectorOperationalContext;

/** A second candidate, so one decision can dispatch one ticket and refuse another. */
const declined = { ...candidate, ticket: asTicketId(43), ticketVersion: 1 };

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

const observation: SelectorObservation = {
  token,
  candidates: [candidate, declined],
  refusals: standingRefusals,
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

/** The system prompt `request` composes, which a lead opened for it holds. */
const composedPrompt = leadSystemPrompt({
  basePrompt: request.instructions.content,
  ...(request.instructions.northStar === undefined
    ? {}
    : { northStar: request.instructions.northStar }),
});

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
  /** A door that answers and leaves no open lead, which is what the host refuses to decide on. */
  readonly openLeavesNothing?: boolean;
  /** The lead's stored system prompt, the composed one unless a case says otherwise; null is none. */
  readonly systemPrompt?: string | null;
  readonly decisionTurnTokens?: number;
  /** What the closing door answers, which closes the lead only where it is `Closed`. */
  readonly closed?: LeadClosed;
}

interface MailboxDouble {
  readonly mailbox: LeadMailbox;
  readonly offers: { readonly input: string }[];
  readonly openings: LeadOpening[];
  readonly closings: string[];
  readonly reads: () => number;
}

/** The lead the double's mailbox answers before anything moves it. */
function mailboxStanding(
  options: MailboxOptions,
): LeadSessionStanding | undefined {
  if (options.absent === true) return undefined;
  const systemPrompt =
    options.systemPrompt === undefined ? composedPrompt : options.systemPrompt;
  return {
    session: asSessionId("lead-session"),
    state: options.state ?? "Open",
    ...(options.agentReference === undefined
      ? {}
      : { agentReference: options.agentReference }),
    ...(systemPrompt === null ? {} : { systemPrompt }),
    ...(options.decisionTurnTokens === undefined
      ? {}
      : { decisionTurnTokens: options.decisionTurnTokens }),
  };
}

function mailboxDouble(options: MailboxOptions = {}): MailboxDouble {
  const offers: { readonly input: string }[] = [];
  const openings: LeadOpening[] = [];
  const closings: string[] = [];
  const states = options.turnStates ?? (["Answered"] as const);
  let read = 0;
  let standing = mailboxStanding(options);
  return {
    offers,
    openings,
    closings,
    reads: () => read,
    mailbox: {
      lead: () => Promise.resolve(standing),
      openLead: (opening) => {
        openings.push(opening);
        if (options.openLeavesNothing !== true)
          standing = {
            session: opening.session,
            state: "Open",
            systemPrompt: opening.systemPrompt,
          };
        return Promise.resolve({
          opened: "Opened" as const,
          session: opening.session,
        });
      },
      closeLead: (_partition, session) => {
        closings.push(session);
        const closed = options.closed ?? "Closed";
        if (closed === "Closed" && standing !== undefined)
          standing = { ...standing, state: "Closed" };
        return Promise.resolve(closed);
      },
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
    deliveries: [],
    result,
    implementationRevision: "implementation",
    modelRevision: "model",
    policyRevision: "policy",
    accounting: { tokens: 1, durationMs: 1 },
    startedAt: "2026-09-01T12:00:00.000Z",
    completedAt: "2026-09-01T12:00:01.000Z",
  };
}

/** The identity a successor is opened as, which the host takes from its own configuration. */
const leadPrincipal = "18:https://auth.exampleselector";
const leadCredentialSlot = "claude-code";

/** One successor identity per draw, so a case can tell an opening from a re-read. */
function sessionMint(): LeadSessionMint {
  let drawn = 0;
  return {
    session: () => {
      drawn += 1;
      return asSessionId(`lead-successor-${String(drawn)}`);
    },
  };
}

const leadPolicyConfig = {
  pollIntervalMs: 1,
  implementationRevision: "selector-build-1",
  principal: leadPrincipal,
  credentialSlot: leadCredentialSlot,
} as const;

/** An authority granting every question, for the cases about a decision rather than the grant. */
const hostedEverywhere: ProjectAccess = {
  authorize: (principal) => Promise.resolve(memberAuthority(principal)),
  authorizeTenant: (principal) => Promise.resolve(memberAuthority(principal)),
};

function policyOf(double: MailboxDouble) {
  return leadSelectorPolicy(
    double.mailbox,
    decisionTail(),
    sessionMint(),
    clock(),
    hostedEverywhere,
    sessionRoutesAt(),
    leadPolicyConfig,
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
  assert.equal(
    observed.instructions,
    undefined,
    "a lead's instructions are its system prompt and nothing else",
  );
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
    decisionTail(),
    sessionMint(),
    clock([1_788_000_000_000, 1_788_000_150_000]),
    hostedEverywhere,
    sessionRoutesAt(),
    leadPolicyConfig,
  );
  const execution = (await policy.execute(
    request,
    new AbortController().signal,
  )) as SelectorPolicyExecution;
  assert.equal(execution.modelRevision, "Unavailable");
  assert.deepEqual(execution.accounting, { tokens: 0, durationMs: 150_000 });
  assert.deepEqual(execution.toolActivity, []);
});

test("a project with no open lead gets a successor, and decides through it", async () => {
  for (const options of [{ absent: true }, { state: "Closed" as const }]) {
    const double = mailboxDouble(options);
    const execution = (await policyOf(double).execute(
      request,
      new AbortController().signal,
    )) as SelectorPolicyExecution;
    assert.deepEqual(
      double.openings.map((opening) => [
        opening.session,
        opening.principal,
        opening.credentialSlot,
      ]),
      [["lead-successor-1", leadPrincipal, leadCredentialSlot]],
      "one successor, opened as the selector's own principal",
    );
    assert.equal(
      double.openings[0]?.systemPrompt,
      leadSystemPrompt({
        basePrompt: request.instructions.content,
        ...(request.instructions.northStar === undefined
          ? {}
          : { northStar: request.instructions.northStar }),
      }),
      "and told what the turn would have told it",
    );
    assert.equal(double.offers.length, 1);
    const observed = parseLeadObservation(double.offers[0]?.input ?? "");
    assert.ok(
      observed.seeding !== undefined,
      "a successor with no bound reference is seeded from the record",
    );
    assert.equal(execution.policyRevision, "Unbound");
  }
});

test("a lead already open is decided through rather than replaced", async () => {
  const double = mailboxDouble({ agentReference: "agent-session-9" });
  await policyOf(double).execute(request, new AbortController().signal);
  assert.deepEqual(double.openings, []);
});

test("a lead is replaced where it is spent or its prompt is not the composed one, and only there", () => {
  const open = { session: asSessionId("lead-session"), state: "Open" } as const;
  const cases: readonly (readonly [string, LeadSessionStanding, boolean])[] = [
    ["composed, unmeasured", { ...open, systemPrompt: composedPrompt }, false],
    [
      "composed, at the bound",
      {
        ...open,
        systemPrompt: composedPrompt,
        decisionTurnTokens: leadTurnTokensMax,
      },
      false,
    ],
    [
      "composed, over the bound",
      {
        ...open,
        systemPrompt: composedPrompt,
        decisionTurnTokens: leadTurnTokensMax + 1,
      },
      true,
    ],
    ["another prompt", { ...open, systemPrompt: "an older prompt" }, true],
    ["no prompt", open, true],
  ];
  for (const [label, standing, replaced] of cases)
    assert.equal(
      leadStandingReplaced(standing, composedPrompt),
      replaced,
      label,
    );
});

test("a spent lead is closed before the decision, and a seeded successor takes it", async () => {
  const double = mailboxDouble({
    agentReference: "agent-session-9",
    decisionTurnTokens: leadTurnTokensMax + 1,
  });
  const execution = (await policyOf(double).execute(
    request,
    new AbortController().signal,
  )) as SelectorPolicyExecution;
  assert.deepEqual(double.closings, ["lead-session"]);
  assert.deepEqual(
    double.openings.map((opening) => [opening.session, opening.systemPrompt]),
    [["lead-successor-1", composedPrompt]],
  );
  assert.ok(
    parseLeadObservation(double.offers[0]?.input ?? "").seeding !== undefined,
    "the successor's first turn is told the record",
  );
  assert.equal(execution.policyRevision, "Unbound");
});

test("a lead at the bound, or with nothing measured, takes the decision itself", async () => {
  for (const decisionTurnTokens of [leadTurnTokensMax, undefined]) {
    const double = mailboxDouble({
      agentReference: "agent-session-9",
      ...(decisionTurnTokens === undefined ? {} : { decisionTurnTokens }),
    });
    await policyOf(double).execute(request, new AbortController().signal);
    assert.deepEqual([double.closings, double.openings], [[], []]);
    assert.equal(
      parseLeadObservation(double.offers[0]?.input ?? "").seeding,
      undefined,
    );
  }
});

test("a lead holding another prompt, or none, is replaced by one holding the composed prompt", async () => {
  for (const systemPrompt of ["an older prompt", null]) {
    const double = mailboxDouble({
      agentReference: "agent-session-9",
      systemPrompt,
    });
    await policyOf(double).execute(request, new AbortController().signal);
    assert.deepEqual(double.closings, ["lead-session"]);
    assert.deepEqual(
      double.openings.map((opening) => opening.systemPrompt),
      [composedPrompt],
    );
  }
});

test("a lead the door will not close takes the decision itself, under the prompt it holds", async () => {
  for (const closed of ["TurnInFlight", "InquiryOpen"] as const) {
    const double = mailboxDouble({
      agentReference: "agent-session-9",
      decisionTurnTokens: leadTurnTokensMax + 1,
      closed,
    });
    const execution = (await policyOf(double).execute(
      request,
      new AbortController().signal,
    )) as SelectorPolicyExecution;
    assert.deepEqual(double.closings, ["lead-session"], closed);
    assert.deepEqual(double.openings, [], "no successor is opened");
    assert.equal(execution.policyRevision, "agent-session-9");
    assert.equal(
      parseLeadObservation(double.offers[0]?.input ?? "").seeding,
      undefined,
    );
  }
});

test("a lead another process already closed is succeeded, and one that is no lead raises", async () => {
  const already = mailboxDouble({
    systemPrompt: null,
    closed: "AlreadyClosed",
  });
  await policyOf(already).execute(request, new AbortController().signal);
  assert.equal(already.openings.length, 1);

  const stray = mailboxDouble({ systemPrompt: null, closed: "NotLead" });
  await assert.rejects(
    policyOf(stray).execute(request, new AbortController().signal),
    /not the project's lead/u,
  );
  assert.deepEqual([stray.openings, stray.offers], [[], []]);
});

test("a successor that does not come back open is not decided on", async () => {
  const double = mailboxDouble({ absent: true, openLeavesNothing: true });
  await assert.rejects(
    policyOf(double).execute(request, new AbortController().signal),
    /no open lead/u,
  );
  assert.equal(double.offers.length, 0);
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
      /: handoff note, cursor and refusals alone/u.test(error.message),
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
      /: handoff note, cursor and refusals alone/u.test(error.message),
  );
});

test("a session with no agent reference is seeded and one with a reference is not", async () => {
  const seeded = mailboxDouble();
  const policy = leadSelectorPolicy(
    seeded.mailbox,
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
    sessionMint(),
    clock(),
    hostedEverywhere,
    sessionRoutesAt(),
    leadPolicyConfig,
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
  const oversized = Math.ceil(leadObservationBytesMax / 20);
  const double = mailboxDouble();
  const policy = leadSelectorPolicy(
    double.mailbox,
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
    sessionMint(),
    clock(),
    hostedEverywhere,
    sessionRoutesAt(),
    leadPolicyConfig,
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
        decisionTail(),
        sessionMint(),
        clock(),
        hostedEverywhere,
        sessionRoutesAt(),
        { ...leadPolicyConfig, pollIntervalMs: 0 },
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
    decisionTail(),
    sessionMint(),
    clock(),
    hostedEverywhere,
    sessionRoutesAt(),
    leadPolicyConfig,
  );
  await policy.execute(request, new AbortController().signal);
  assert.deepEqual(identities, [request.attempt]);
});

/** One tenant question as the authority was asked it. */
interface HostedQuestion {
  readonly principal: Principal;
  readonly tenant: TenantId;
  readonly kind: TenantAccessKind;
}

/** An authority answering every tenant question one way and keeping each question it was asked. */
function hostedAuthority(answer: "Granted" | "Refused" | "Unavailable"): {
  readonly access: ProjectAccess;
  readonly asked: HostedQuestion[];
} {
  const asked: HostedQuestion[] = [];
  return {
    asked,
    access: {
      authorize: () =>
        Promise.reject(new Error("a lead's grant is its tenant's to answer")),
      authorizeTenant: (principal, tenant, kind) => {
        asked.push({ principal, tenant, kind });
        if (answer === "Unavailable")
          return Promise.reject(
            new ProjectAccessUnavailable("the authority did not answer"),
          );
        return Promise.resolve(
          answer === "Granted" ? memberAuthority(principal) : undefined,
        );
      },
    },
  };
}

function hostedPolicyOf(
  double: MailboxDouble,
  access: ProjectAccess,
  routes: SessionRouteReads = sessionRoutesAt(),
) {
  return leadSelectorPolicy(
    double.mailbox,
    decisionTail(),
    sessionMint(),
    clock(),
    access,
    routes,
    leadPolicyConfig,
  );
}

test("the hosted grant asked is the tenant's, for the principal a lead is opened as", async () => {
  for (const [answer, admission] of [
    ["Granted", "Admitted"],
    ["Refused", "HostedRunsNotGranted"],
  ] as const) {
    const authority = hostedAuthority(answer);
    const double = mailboxDouble({ absent: true });
    const policy = hostedPolicyOf(double, authority.access);
    assert.equal(await policy.leadAdmission(partition), admission);
    assert.deepEqual(authority.asked, [
      {
        principal: leadPrincipal,
        tenant: partition.tenant,
        kind: "ExecuteHosted",
      },
    ]);
    assert.deepEqual(double.openings, [], "asking opens no lead");
    assert.deepEqual(double.offers, [], "and offers no turn");
  }
});

test("the principal whose grant is asked is the one a successor is opened as", async () => {
  const authority = hostedAuthority("Granted");
  const double = mailboxDouble({ absent: true });
  const policy = hostedPolicyOf(double, authority.access);
  assert.equal(await policy.leadAdmission(partition), "Admitted");
  await policy.execute(request, new AbortController().signal);
  assert.equal(double.openings.length, 1);
  assert.equal(authority.asked[0]?.principal, double.openings[0]?.principal);
});

test("an authority that cannot say whether the lead is hosted raises rather than refusing", async () => {
  const policy = hostedPolicyOf(
    mailboxDouble(),
    hostedAuthority("Unavailable").access,
  );
  await assert.rejects(
    policy.leadAdmission(partition),
    ProjectAccessUnavailable,
  );
});

test("a lead routed to the project's runners is admitted by a live one and asks no grant", async () => {
  for (const [project, admission] of [
    ["Live", "Admitted"],
    ["Offline", "RunnerOffline"],
    ["Unregistered", "RunnerOffline"],
  ] as const) {
    const authority = hostedAuthority("Refused");
    const policy = hostedPolicyOf(
      mailboxDouble({ absent: true }),
      authority.access,
      sessionRoutesAt({ Lead: "Pool" }, { mine: "Unregistered", project }),
    );
    assert.equal(await policy.leadAdmission(partition), admission);
    assert.deepEqual(authority.asked, [], "a runner route spends no grant");
  }
});

/** A mailbox double that also keeps the route each turn was offered on. */
function routedMailbox(double: MailboxDouble): {
  readonly double: MailboxDouble;
  readonly routes: string[];
} {
  const routes: string[] = [];
  return {
    routes,
    double: {
      ...double,
      mailbox: {
        ...double.mailbox,
        offer: (input) => {
          routes.push(input.route);
          return double.mailbox.offer(input);
        },
      },
    },
  };
}

test("a turn is offered on the route its lead was admitted on", async () => {
  for (const [lead, project] of [
    ["InCluster", "Unregistered"],
    ["Pool", "Live"],
  ] as const) {
    const routed = routedMailbox(mailboxDouble());
    await hostedPolicyOf(
      routed.double,
      hostedAuthority("Granted").access,
      sessionRoutesAt({ Lead: lead }, { mine: "Unregistered", project }),
    ).execute(request, new AbortController().signal);
    assert.deepEqual(routed.routes, [lead]);
  }
});

test("a turn is stamped with the route its admission was asked of, however the route reads after", async () => {
  const routed = routedMailbox(mailboxDouble());
  await hostedPolicyOf(
    routed.double,
    hostedAuthority("Refused").access,
    sessionRoutesFlipping("Pool", { mine: "Unregistered", project: "Live" }),
  ).execute(request, new AbortController().signal);
  assert.deepEqual(routed.routes, ["Pool"]);
});

/** The runtime asks before it takes a permit, and the grant or the runner can go before the offer. */
test("a lead no longer admitted when its turn is offered offers none", async () => {
  for (const [answer, lead] of [
    ["Refused", "InCluster"],
    ["Granted", "Pool"],
  ] as const) {
    const double = mailboxDouble();
    await assert.rejects(
      hostedPolicyOf(
        double,
        hostedAuthority(answer).access,
        sessionRoutesAt({ Lead: lead }),
      ).execute(request, new AbortController().signal),
      /may not take a turn/u,
    );
    assert.deepEqual(double.offers, []);
  }
});
