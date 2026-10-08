/**
 * A decision outlives the selector process that began it. Each case starts a
 * quantum on an attempt some other process left in the store, and asserts what
 * the quantum finishes, ends or leaves standing, over in-memory ports whose
 * store holds a decision to its fence and records it once.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { asTicketId } from "../../src/domain/ids.ts";
import type { DispatchCandidate } from "../../src/interpreter/dispatchView.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  resolvedSelectorSettings,
  type JsonValue,
  type SelectorDecisionProposals,
  type SelectorDelivery,
  type SelectorInteraction,
  type SelectorObservation,
  type SelectorPolicyHost,
  type SelectorPolicyRequest,
  type SelectorProjectState,
  type SelectorRuntimeSettings,
  type SelectorStateStore,
  type SelectorTerminationResult,
  type SelectorTurnStanding,
  type SelectorUnfinishedAttempt,
} from "../../src/interpreter/selector.ts";
import {
  selectorRunOnce,
  type SelectorIdentityFactory,
  type SelectorRunResult,
  type SelectorRuntimeSource,
} from "../../src/interpreter/selectorRuntime.ts";
import type { AgenticRefusalWrite } from "../../src/interpreter/agenticRefusal.ts";
import { selectorOperationalContext } from "./selectorFixture.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const token = {
  ...partition,
  recoveryEpoch: "epoch",
  schemaVersion: 1,
  watermark: 3,
  digest: "c".repeat(64),
};

function candidateOf(ticket: number, ticketVersion: number): DispatchCandidate {
  return {
    ticket: asTicketId(ticket),
    ticketVersion,
    dependencies: [],
    program: [{ key: 1, evaluators: [{ key: 1 }] }],
    configurationRevision: "revision",
    configurationDigest: "d".repeat(64),
    configurationCanonical: "canonical",
  };
}

/** The observation the first process stored before it offered its turn. */
const observation: SelectorObservation = {
  token,
  candidates: [candidateOf(35, 4), candidateOf(36, 1)],
  refusals: [],
  notificationCursor: 9,
  changes: [{ ordinal: 9, kind: "Ticket", resource: "35" }],
  operationalContext: selectorOperationalContext,
  handoffNote: { watching: 35 },
  nextCandidateScan: { state: "Exhausted", token },
};

/** The project's state the decision began on, at the revision it is fenced on. */
const begunOn: SelectorProjectState = {
  partition,
  notificationCursor: 4,
  revision: 6,
  attention: "Monitoring",
  handoffNote: { watching: 35 },
  candidateScan: { state: "Unstarted" },
};

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

const decision = "selector-decision-first-process";

/** The turn's answer, which dispatches one ticket, refuses another and lifts a third. */
const answered = {
  result: {
    dispatches: [{ ticket: 35, expectedTicketVersion: 4 }],
    refusals: [{ ticket: 36, ticketVersion: 1, reason: "not yet" }],
    lifts: [{ ticket: 37 }],
    attention: "Attention",
    handoffNote: { next: 35 },
    planningIntent: { tickets: [35] },
  },
  toolActivity: [],
  implementationRevision: "implementation-1",
  modelRevision: "model-1",
  policyRevision: "policy-1",
  accounting: { tokens: 100, durationMs: 1_000 },
  startedAt: "2026-10-08T02:00:00.000Z",
  completedAt: "2026-10-08T02:00:01.000Z",
};

/** The attempt as the store answers it, `Running` on the observation above unless a case says otherwise. */
function unfinished(
  varying: Partial<SelectorUnfinishedAttempt> = {},
): SelectorUnfinishedAttempt {
  return {
    attempt: decision,
    partition,
    state: "Running",
    ageMs: 10_000,
    projectRevision: begunOn.revision,
    observation,
    ...varying,
  };
}

interface RigOptions {
  readonly found?: readonly SelectorUnfinishedAttempt[];
  readonly turns?: Readonly<Record<string, SelectorTurnStanding>>;
  /** What the turn answers, which a case may hold back. */
  readonly answer?: () => Promise<unknown>;
  readonly deadlineFires?: boolean;
  readonly state?: SelectorProjectState;
  readonly projectMode?: SelectorRuntimeSettings["mode"];
  readonly installationMode?: SelectorRuntimeSettings["mode"];
}

/** Everything a quantum did, as the ports saw it. */
interface Rig {
  readonly attempts: Map<string, string>;
  state: SelectorProjectState;
  readonly interactions: SelectorInteraction[];
  readonly proposals: SelectorDecisionProposals[];
  readonly intents: (JsonValue | undefined)[];
  readonly ledger: Parameters<AgenticRefusalWrite["record"]>[0][];
  readonly order: string[];
  readonly terminated: { attempt: string; evidence: string }[];
  readonly withdrawn: string[];
  readonly resumed: SelectorPolicyRequest[];
  readonly deadlines: number[];
  readonly submitted: SelectorDelivery[];
  readonly observed: string[];
  started: number;
  admissions: number;
  allocated: number;
  drawn: number;
}

function rigOf(options: RigOptions): Rig {
  const found = options.found ?? [unfinished()];
  return {
    attempts: new Map(found.map((one) => [one.attempt, one.state])),
    state: options.state ?? begunOn,
    interactions: [],
    proposals: [],
    intents: [],
    ledger: [],
    order: [],
    terminated: [],
    withdrawn: [],
    resumed: [],
    deadlines: [],
    submitted: [],
    observed: [],
    started: 0,
    admissions: 0,
    allocated: 0,
    drawn: 0,
  };
}

/**
 * The store's record: nothing where the attempt already ended, the attempt
 * ended where the project moved off the decision's revision, and otherwise the
 * decision written and the project's revision moved on.
 */
function rigWrite(
  rig: Rig,
  interaction: SelectorInteraction,
  state: SelectorProjectState,
  planningIntent: JsonValue | undefined,
  proposals?: SelectorDecisionProposals,
): boolean {
  const standing = rig.attempts.get(interaction.decision);
  if (standing === "Completed" || standing === "Terminated") return false;
  if (state.revision !== rig.state.revision) {
    rig.attempts.set(interaction.decision, "Terminated");
    rig.terminated.push({
      attempt: interaction.decision,
      evidence: "the project moved",
    });
    return false;
  }
  rig.attempts.set(interaction.decision, "Completed");
  rig.state = { ...state, revision: state.revision + 1 };
  rig.interactions.push(interaction);
  rig.intents.push(planningIntent);
  if (proposals !== undefined) rig.proposals.push(proposals);
  rig.order.push("record");
  return true;
}

/** Every recorded dispatch the quantum has not yet submitted, as the delivery claim answers it. */
function rigPending(rig: Rig): readonly SelectorDelivery[] {
  return rig.proposals.flatMap((proposed) =>
    proposed.dispatches
      .filter(
        (dispatch) =>
          !rig.submitted.some(
            (done) =>
              done.decision === proposed.interaction.decision &&
              done.ticket === dispatch.ticket,
          ),
      )
      .map((dispatch) => ({
        decision: proposed.interaction.decision,
        ticket: dispatch.ticket,
        partition: proposed.interaction.partition,
        operation: dispatch.operation,
        command: dispatch.command,
        attempts: 0,
      })),
  );
}

function rigStore(rig: Rig, found: readonly SelectorUnfinishedAttempt[]) {
  const store: SelectorStateStore = {
    setAutomaticReadiness: () => Promise.resolve(),
    allocateAttempt: () => {
      rig.allocated += 1;
      return Promise.resolve(true);
    },
    runningAttempt: () => Promise.resolve(),
    quarantineAttempt: (attempt) => {
      rig.attempts.set(attempt, "Quarantined");
      return Promise.resolve();
    },
    terminateAttempt: (attempt, evidence) => {
      const standing = rig.attempts.get(attempt);
      if (standing === "Completed" || standing === "Terminated")
        return Promise.reject(new Error("selector attempt cannot end twice"));
      rig.attempts.set(attempt, "Terminated");
      rig.terminated.push({ attempt, evidence });
      return Promise.resolve();
    },
    quarantinedAttempts: () => Promise.resolve([]),
    unfinishedAttempts: () =>
      Promise.resolve(
        found.filter((one) => {
          const standing = rig.attempts.get(one.attempt);
          return standing === "Starting" || standing === "Running";
        }),
      ),
    inventoryCursor: () => Promise.resolve(undefined),
    saveInventoryCursor: () => Promise.resolve(),
    recordInteraction: (interaction, state, _fence, planningIntent) =>
      Promise.resolve(rigWrite(rig, interaction, state, planningIntent)),
    record: (proposals, state) => {
      const written = rigWrite(
        rig,
        proposals.interaction,
        state,
        proposals.planningIntent,
        proposals,
      );
      return Promise.resolve({
        retained: written,
        dispatched: written
          ? proposals.dispatches.map((dispatch) => dispatch.ticket)
          : [],
      });
    },
    recordQuietCycle: () => Promise.resolve(false),
    pending: () => Promise.resolve(rigPending(rig)),
    submittedDeliveries: () => Promise.resolve([]),
    submitted: () => Promise.resolve(),
    terminal: () => Promise.resolve(),
    history: () => Promise.resolve([]),
    tail: () => Promise.resolve([]),
    project: () => Promise.resolve(rig.state),
    planningIntent: () => Promise.resolve(undefined),
    heldAmong: () => Promise.resolve([]),
  };
  return store;
}

const unmoved = (cursor: number) =>
  ({ result: "Events", cursor, events: [] }) as const;

function rigSource(rig: Rig, options: RigOptions): SelectorRuntimeSource {
  return {
    projects: () => Promise.resolve({ projects: [partition] }),
    moved: (scope, after) => {
      rig.observed.push(scope.project);
      return Promise.resolve(unmoved(after));
    },
    notifications: (_scope, cursor) => Promise.resolve(unmoved(cursor.after)),
    dispatchView: () => Promise.reject(new Error("the view was not asked for")),
    operationalContext: () => Promise.resolve(selectorOperationalContext),
    currentTimeEpochMs: () =>
      Promise.resolve(selectorOperationalContext.observedAtEpochMs),
    currentInstant: () => Promise.resolve("2026-10-08T02:10:00.000Z"),
    decisionDeadline: (milliseconds) => {
      rig.deadlines.push(milliseconds);
      return options.deadlineFires === true
        ? Promise.reject(new Error("selector deadline exceeded"))
        : new Promise<never>(() => undefined);
    },
    submit: (delivery) => {
      rig.submitted.push(delivery);
      return Promise.resolve({ accepted: "Accepted" });
    },
    operation: () => Promise.resolve(undefined),
  };
}

function rigPolicy(rig: Rig, options: RigOptions): SelectorPolicyHost {
  const terminated = (attempt: string): SelectorTerminationResult => {
    rig.withdrawn.push(attempt);
    return { status: "Terminated", attempt, proof: `lead turn ${attempt}` };
  };
  return {
    productionReady: true,
    leadAdmission: () => {
      rig.admissions += 1;
      return Promise.resolve("Admitted");
    },
    start: () => {
      rig.started += 1;
      throw new Error("a finished decision offers no turn");
    },
    reconcileQuarantined: () => Promise.resolve({ status: "Unconfirmed" }),
    turnStanding: (attempt) =>
      Promise.resolve(options.turns?.[attempt] ?? "Ended"),
    resume: (request) => {
      rig.resumed.push(request);
      return {
        result: (options.answer ?? (() => Promise.resolve(answered)))(),
        terminate: () => Promise.resolve(terminated(request.attempt)),
      };
    },
    withdraw: (attempt) => Promise.resolve(terminated(attempt)),
  };
}

/** Derives a decision's identity from its reference, as the root derives one from its identifier. */
function rigIdentities(rig: Rig): SelectorIdentityFactory {
  return {
    next: (scope) => {
      rig.drawn += 1;
      return {
        operation: asOperationId(`operation-new-${scope.project}`),
        selectorDecisionReference: `decision-new-${scope.project}`,
      };
    },
    resumed: (reference) => ({
      operation: asOperationId(reference.replace("decision", "operation")),
      selectorDecisionReference: reference,
    }),
  };
}

function rigLedger(rig: Rig): AgenticRefusalWrite {
  return {
    record: (input) => {
      rig.ledger.push(input);
      rig.order.push("refusals");
      return Promise.resolve("Recorded");
    },
    standingAmong: () => Promise.resolve([]),
  };
}

/** One quantum over the rig's ports, the attempt left by a process that is gone. */
function quantum(rig: Rig, options: RigOptions): Promise<SelectorRunResult> {
  const found = options.found ?? [unfinished()];
  return selectorRunOnce(
    rigLedger(rig),
    rigStore(rig, found),
    rigSource(rig, options),
    rigPolicy(rig, options),
    rigIdentities(rig),
    {
      settings: () =>
        Promise.resolve({
          ...runtimeSettings,
          mode: options.installationMode ?? "Running",
        }),
      projectSettings: (of) =>
        Promise.resolve(
          resolvedSelectorSettings(
            of,
            {
              ...runtimeSettings,
              mode: options.installationMode ?? "Running",
            },
            0,
            options.projectMode === undefined
              ? {}
              : { mode: options.projectMode },
          ),
        ),
    },
    { projectsMax: 1, deliveriesMax: 10, reconciliationsMax: 1 },
  );
}

async function run(options: RigOptions = {}) {
  const rig = rigOf(options);
  const result = await quantum(rig, options);
  return { rig, result };
}

/** The failure the recorded interaction carries, or nothing where it decided. */
function failureCode(interaction: SelectorInteraction | undefined): unknown {
  const result = interaction?.result as Record<string, unknown> | undefined;
  return result?.["outcome"] === "Failed" ? result["code"] : undefined;
}

test("an answered turn a predecessor offered is recorded as it would have recorded it", async () => {
  const { rig, result } = await run();
  assert.deepEqual(result.failures, []);
  assert.equal(rig.started, 0, "no turn is offered for a finished decision");
  assert.equal(rig.admissions, 0);
  assert.equal(rig.allocated, 0);
  assert.equal(rig.drawn, 0);
  assert.deepEqual(rig.deadlines, [], "an ended turn waits on no deadline");
  const interaction = rig.interactions[0];
  assert.equal(rig.interactions.length, 1);
  assert.equal(interaction?.decision, decision);
  assert.deepEqual(interaction?.result, answered.result);
  assert.deepEqual(interaction?.observedView, observation.candidates);
  assert.deepEqual(interaction?.observedToken, observation.token);
  assert.deepEqual(interaction?.context, {
    operationalContext: observation.operationalContext,
    handoffNote: observation.handoffNote,
    changes: observation.changes,
  });
  assert.deepEqual(rig.intents, [answered.result.planningIntent]);
  assert.deepEqual(rig.state, {
    partition,
    notificationCursor: observation.notificationCursor,
    revision: begunOn.revision + 1,
    recoveryEpoch: token.recoveryEpoch,
    attention: "Attention",
    handoffNote: { next: 35 },
    candidateScan: { state: "Unstarted" },
  });
  assert.deepEqual(rig.order, ["record", "refusals"]);
  assert.deepEqual(rig.ledger, [
    {
      partition,
      decision,
      refusals: answered.result.refusals,
      lifts: answered.result.lifts,
    },
  ]);
  assert.equal(rig.attempts.get(decision), "Completed");
});

test("a finished decision's dispatch is delivered under the operation its first process named", async () => {
  const { rig, result } = await run();
  assert.equal(result.proposed, 1);
  assert.equal(result.dispatched, 1);
  assert.deepEqual(
    rig.submitted.map((delivery) => [delivery.ticket, delivery.operation]),
    [[35, "selector-operation-first-process-t35"]],
  );
  assert.equal(
    rig.submitted[0]?.command.selectorDecisionReference,
    decision,
    "the dispatch names the decision its first process began",
  );
  assert.deepEqual(
    rig.observed,
    [partition.project],
    "the inventory reaches the project once its decision is finished",
  );
  assert.equal(rig.drawn, 0, "no turn is offered for the changes it consumed");
});

test("a turn still in the mailbox is waited on for the rest of the attempt's deadline, the project unobserved", async () => {
  let release!: () => void;
  const held = new Promise<unknown>((resolve) => {
    release = () => {
      resolve(answered);
    };
  });
  const options: RigOptions = {
    turns: { [decision]: "Pending" },
    answer: () => held,
    found: [unfinished({ ageMs: 45_000 })],
  };
  const rig = rigOf(options);
  const running = quantum(rig, options);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rig.observed, [], "the project waits on its decision");
  assert.equal(rig.interactions.length, 0);
  assert.deepEqual(rig.deadlines, [120_000 - 45_000]);
  release();
  const result = await running;
  assert.deepEqual(result.failures, []);
  assert.equal(rig.admissions, 0, "no admission is asked of a resumed turn");
  assert.equal(rig.started, 0);
  assert.equal(rig.interactions.length, 1);
  assert.deepEqual(rig.interactions[0]?.result, answered.result);
  assert.deepEqual(rig.observed, [partition.project]);
});

test("a turn still in the mailbox past the attempt's deadline is withdrawn and recorded as a deadline failure", async () => {
  const { rig, result } = await run({
    turns: { [decision]: "Pending" },
    answer: () => new Promise(() => undefined),
    found: [unfinished({ ageMs: 120_001 })],
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(rig.deadlines, [], "no time is left to hand the deadline");
  assert.deepEqual(rig.withdrawn, [decision]);
  assert.equal(failureCode(rig.interactions[0]), "DeadlineExceeded");
  assert.equal(rig.state.attention, "Attention");
  assert.equal(rig.attempts.get(decision), "Completed");
});

test("a turn the remaining deadline outlasts is withdrawn and recorded as a deadline failure", async () => {
  const { rig } = await run({
    turns: { [decision]: "Pending" },
    answer: () => new Promise(() => undefined),
    deadlineFires: true,
    found: [unfinished({ ageMs: 100_000 })],
  });
  assert.deepEqual(rig.deadlines, [20_000]);
  assert.deepEqual(rig.withdrawn, [decision]);
  assert.equal(failureCode(rig.interactions[0]), "DeadlineExceeded");
});

test("a turn answered before it was found is recorded however late it is found", async () => {
  const { rig, result } = await run({
    found: [unfinished({ ageMs: 86_400_000 })],
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(rig.withdrawn, []);
  assert.deepEqual(rig.interactions[0]?.result, answered.result);
});

test("a turn's measured duration is held to the bound however it was found", async () => {
  const { rig } = await run({
    answer: () =>
      Promise.resolve({
        ...answered,
        accounting: { tokens: 100, durationMs: 120_001 },
      }),
  });
  assert.equal(failureCode(rig.interactions[0]), "ControlViolation");
});

test("a turn that ended without an answer is a failed cycle, and attention rises", async () => {
  const { rig, result } = await run({
    answer: () =>
      Promise.reject(new Error("the lead turn ended without an answer")),
  });
  assert.deepEqual(result.failures, []);
  assert.equal(rig.interactions.length, 1);
  assert.equal(failureCode(rig.interactions[0]), "PolicyFailed");
  assert.equal(rig.state.attention, "Attention");
  assert.equal(
    rig.state.notificationCursor,
    begunOn.notificationCursor,
    "a failed view is left standing for the next attempt",
  );
  assert.deepEqual(rig.ledger, []);
});

for (const state of ["Starting", "Running"] as const) {
  test(`an attempt in ${state} with no turn is left while young, its project unobserved`, async () => {
    const { rig, result } = await run({
      turns: { [decision]: "Absent" },
      found: [unfinished({ state, ageMs: 30_000 })],
    });
    assert.deepEqual(result.failures, []);
    assert.equal(rig.attempts.get(decision), state);
    assert.deepEqual(rig.terminated, []);
    assert.deepEqual(rig.observed, [], "the project is held from observation");
    assert.deepEqual(result.reached, [partition]);
  });

  test(`an attempt in ${state} with no turn is terminated once older than the bound, recording nothing`, async () => {
    const { rig, result } = await run({
      turns: { [decision]: "Absent" },
      found: [unfinished({ state, ageMs: 30_001 })],
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(rig.terminated, [
      {
        attempt: decision,
        evidence: "the decision offered no turn before its observation expired",
      },
    ]);
    assert.deepEqual(rig.interactions, []);
    assert.equal(rig.state.attention, "Monitoring", "no attention is raised");
    assert.deepEqual(rig.withdrawn, []);
    assert.deepEqual(rig.observed, [partition.project]);
  });
}

const { projectRevision, observation: stored, ...unfenced } = unfinished();

const unfenceable: readonly {
  readonly why: string;
  readonly found: SelectorUnfinishedAttempt;
  readonly state?: SelectorProjectState;
  readonly evidence: string;
}[] = [
  {
    why: "with no stored revision",
    found: { ...unfenced, observation: stored ?? observation },
    evidence:
      "the decision was stored without the project revision it is fenced on",
  },
  {
    why: "whose observation does not read back",
    found: { ...unfenced, projectRevision: projectRevision ?? 0 },
    evidence: "the decision's observation does not read back",
  },
  {
    why: "whose project moved off its revision",
    found: unfinished(),
    state: { ...begunOn, revision: begunOn.revision + 1 },
    evidence: "the project moved off the revision the decision is fenced on",
  },
];

for (const { why, found, state, evidence } of unfenceable)
  test(`a decision ${why} is void: its turn withdrawn, its attempt terminated, nothing recorded`, async () => {
    const { rig, result } = await run({
      turns: { [decision]: "Pending" },
      found: [found],
      ...(state === undefined ? {} : { state }),
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(rig.withdrawn, [decision]);
    assert.deepEqual(rig.terminated, [{ attempt: decision, evidence }]);
    assert.deepEqual(rig.interactions, []);
    assert.deepEqual(rig.resumed, []);
  });

test("a decision whose record meets a moved revision is ended and records nothing", async () => {
  const options: RigOptions = { turns: { [decision]: "Pending" } };
  const rig = rigOf(options);
  const result = await quantum(rig, {
    ...options,
    answer: () => {
      rig.state = { ...rig.state, revision: rig.state.revision + 1 };
      return Promise.resolve(answered);
    },
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(rig.interactions, []);
  assert.equal(rig.attempts.get(decision), "Terminated");
  assert.deepEqual(rig.ledger, [], "a decision not recorded enters no refusal");
  assert.deepEqual(rig.submitted, []);
});

test("of a project's several unfinished decisions the oldest is finished and the rest are void", async () => {
  const younger = "selector-decision-second-process";
  const { rig, result } = await run({
    turns: { [decision]: "Ended", [younger]: "Pending" },
    found: [unfinished(), unfinished({ attempt: younger, ageMs: 1_000 })],
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(
    rig.interactions.map((interaction) => interaction.decision),
    [decision],
  );
  assert.deepEqual(rig.withdrawn, [younger]);
  assert.deepEqual(rig.terminated, [
    {
      attempt: younger,
      evidence: "an older unfinished decision of the project is finished first",
    },
  ]);
});

test("two processes holding one decision record it once, and neither reports a failure", async () => {
  let release!: () => void;
  const held = new Promise<unknown>((resolve) => {
    release = () => {
      resolve(answered);
    };
  });
  const options: RigOptions = {
    turns: { [decision]: "Pending" },
    answer: () => held,
  };
  const rig = rigOf(options);
  const both = Promise.all([quantum(rig, options), quantum(rig, options)]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rig.resumed.length, 2, "both processes are waiting on the turn");
  release();
  const [first, second] = await both;
  assert.deepEqual(first.failures, []);
  assert.deepEqual(second.failures, []);
  assert.equal(rig.interactions.length, 1);
  assert.equal(rig.proposals.length, 1);
  assert.deepEqual(rig.terminated, []);
});

test("a decision the reaper ended while its turn was awaited is recorded by nobody, with no failure", async () => {
  const options: RigOptions = { turns: { [decision]: "Pending" } };
  const rig = rigOf(options);
  const result = await quantum(rig, {
    ...options,
    answer: () => {
      rig.attempts.set(decision, "Terminated");
      return Promise.resolve(answered);
    },
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(rig.interactions, []);
  assert.deepEqual(rig.ledger, []);
});

for (const paused of ["installation", "project"] as const)
  test(`while the ${paused} is paused an unfinished decision is neither finished nor ended`, async () => {
    const { rig, result } = await run({
      found: [unfinished({ ageMs: 86_400_000 })],
      ...(paused === "installation"
        ? { installationMode: "Paused" as const }
        : { projectMode: "Paused" as const }),
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(rig.resumed, []);
    assert.deepEqual(rig.terminated, []);
    assert.deepEqual(rig.withdrawn, []);
    assert.equal(rig.attempts.get(decision), "Running");
    assert.deepEqual(rig.observed, []);
  });

test("a decision whose reference names no operation is void rather than dispatched under another", async () => {
  const options: RigOptions = { turns: { [decision]: "Pending" } };
  const rig = rigOf(options);
  const result = await selectorRunOnce(
    rigLedger(rig),
    rigStore(rig, [unfinished()]),
    rigSource(rig, options),
    rigPolicy(rig, options),
    { ...rigIdentities(rig), resumed: () => undefined },
    {
      settings: () => Promise.resolve(runtimeSettings),
      projectSettings: (of) =>
        Promise.resolve(resolvedSelectorSettings(of, runtimeSettings, 0, {})),
    },
  );
  assert.deepEqual(result.failures, []);
  assert.deepEqual(rig.withdrawn, [decision]);
  assert.deepEqual(rig.terminated, [
    {
      attempt: decision,
      evidence: "the decision's reference names no operation",
    },
  ]);
  assert.deepEqual(rig.interactions, []);
});

test("a resumption that cannot read what is unfinished observes nothing", async () => {
  const rig = rigOf({});
  const result = await selectorRunOnce(
    rigLedger(rig),
    {
      ...rigStore(rig, []),
      unfinishedAttempts: () => Promise.reject(new Error("unavailable")),
    },
    rigSource(rig, {}),
    rigPolicy(rig, {}),
    rigIdentities(rig),
    {
      settings: () => Promise.resolve(runtimeSettings),
      projectSettings: (of) =>
        Promise.resolve(resolvedSelectorSettings(of, runtimeSettings, 0, {})),
    },
  );
  assert.deepEqual(result.failures, [{ phase: "Resumption" }]);
  assert.deepEqual(rig.observed, []);
});
