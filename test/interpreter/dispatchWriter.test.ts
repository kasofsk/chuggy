import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchTicketCommand,
  reportFinalizationResultCommand,
  createTicketCommand,
  resumeTicketCommand,
  reportTaskTerminalCommand,
  type TicketCommand,
} from "../../src/actor/command.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { finalizationOperationOf } from "../../src/domain/ticket.ts";
import type { Config } from "../../src/domain/config.ts";
import type { EvaluationFailurePolicy } from "../../src/domain/deciders.ts";
import {
  allBlockedReasons,
  type BlockedReason,
} from "../../src/interpreter/executionScheduler.ts";
import {
  actorInit,
  journalStep,
  memoryGraph,
  type ActorState,
} from "../../src/actor/state.ts";
import { storedAtCurrentSemantics } from "../../src/actor/journal.ts";
import {
  asOperationTicketCommand,
  asOperationId,
  classifyCommand,
} from "../../src/interpreter/operationInbox.ts";
import type { DecisionInput } from "../../src/interpreter/projectDiscovery.ts";
import type {
  Decision,
  ExecutionRequestPlan,
  ProjectDecision,
} from "../../src/interpreter/projectDecision.ts";
import type { ProjectStore } from "../../src/interpreter/projectStore.ts";
import {
  asOwnerId,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type GitEvidence,
} from "../../src/interpreter/finalizer.ts";
import {
  projectTicketWriterRun,
  projectionChanges,
  projectWriterDecide,
  type ProjectDecided,
  type ProjectMemory,
  type ProjectTicketWriter,
} from "../../src/interpreter/projectWriter.ts";
import {
  silentTicketServiceMetrics,
  sourceDeferralPassesMax,
  ticketServiceDefaults,
} from "../../src/interpreter/ticketService.ts";
import type { ExecutionSourceObservationPort } from "../../src/interpreter/executionSource.ts";
import {
  asDraftBrief,
  type TicketBriefPort,
} from "../../src/interpreter/ticketBrief.ts";
import {
  deriveDispatchCandidates,
  dispatchViewDigest,
} from "../../src/interpreter/dispatchView.ts";
import type { ProjectCommand } from "../../src/interpreter/projectCommand.ts";
import { executionSourceObservation } from "../../src/interpreter/executionSourceObservation.ts";
import {
  asResultManifestId,
  digestFold,
} from "../../src/interpreter/resultManifest.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import type { TaskIdentity } from "../../src/domain/generated/modelTypes.ts";
import {
  plainDefinitionOf,
  plainPolicy,
  refinementInstance,
} from "../actor/harness.ts";
import {
  aDispatchSource,
  anAcceptedSource,
  evaluatorOf,
  releasedTicketOf,
} from "../../src/domain/config.ts";
import {
  id,
  judgedReport,
  producedReport,
  stoppedReport,
} from "../domain/fixtures.ts";

/** One decision journalled, under the policy the suite is not steering unless it names one. */
function stepped(
  config: Config,
  state: ActorState,
  event: TicketCommand,
  policy: EvaluationFailurePolicy = plainPolicy,
): ActorState {
  return journalStep(config, state, event, policy);
}

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

/** The rework cap these writers hold, which no case here turns on. */
const testReworkCap = { cyclesMax: 2 };
const contracts = new Map([
  [
    id(1),
    {
      configurationRevision: "revision",
      configurationDigest: "digest",
      configurationCanonical: '{"worker":"one"}',
    },
  ],
]);

function releasedMemory(head = 1): ProjectMemory {
  const released = stepped(
    refinementInstance,
    actorInit(),
    createTicketCommand(plainDefinitionOf(1)),
  );
  return {
    lease: {
      partition,
      owner: asOwnerId("owner"),
      fencingEpoch: 1,
      recoveryEpoch: asRecoveryEpoch("epoch"),
      head,
    },
    graph: memoryGraph(released),
    ticketVersions: new Map([[id(1), 1]]),
    dispatchContracts: contracts,
  };
}

function operationInput(command: ProjectCommand): DecisionInput {
  return {
    partition,
    ordinal: 1,
    deferredPasses: 0,
    priority: classifyCommand(command).priority,
    source: {
      kind: "Operation",
      operation: asOperationId("operation"),
      command,
    },
  };
}

/** The commit every source here is read at, and the reference it folds to. */
const observedCommit = asGitObjectId("a".repeat(40));

/** The source a test that is not about observation is answered with. */
const readableSources: ExecutionSourceObservationPort = {
  observe: () =>
    Promise.resolve({
      observed: "Source",
      source: {
        reference: digestFold(observedCommit),
        repository: asRepositoryId("repository"),
        commit: observedCommit,
      },
    }),
  spawnSource: () => Promise.resolve(undefined),
};

/** The brief a test that is not about briefing is answered with. */
const unbriefedTickets: TicketBriefPort = {
  brief: () => Promise.resolve(undefined),
};

/** What one decision left behind: what it offered the authority, and the memory it kept. */
async function decidedWith(
  memory: ProjectMemory,
  input: DecisionInput,
  executionSources: ExecutionSourceObservationPort = readableSources,
  ticketBriefs: TicketBriefPort = unbriefedTickets,
  policy: Partial<Pick<ProjectTicketWriter, "config" | "rework">> = {},
): Promise<{
  readonly offered: Decision | undefined;
  readonly result: ProjectDecided;
}> {
  let offered: Decision | undefined;
  const decisions: ProjectDecision = {
    decide: (decision) => {
      offered = decision;
      return Promise.resolve(
        decision.outcome.outcome === "Deferred"
          ? { decided: "Deferred" }
          : { decided: "Refused" },
      );
    },
  };
  const result = await projectWriterDecide(
    {
      config: refinementInstance,
      rework: testReworkCap,
      ...policy,
      store: {} as ProjectStore,
      decisions,
      ticketBriefs,
      executionSources,
    },
    memory,
    input,
  );
  return { offered, result };
}

async function planned(
  memory: ProjectMemory,
  command: ProjectCommand,
  executionSources?: ExecutionSourceObservationPort,
  ticketBriefs?: TicketBriefPort,
): Promise<Decision> {
  const { offered } = await decidedWith(
    memory,
    operationInput(command),
    executionSources,
    ticketBriefs,
  );
  assert.ok(offered !== undefined);
  return offered;
}

/**
 * A port that records what it was asked to observe and answers at the
 * repository and ref it was given, so a bundle says which of them reached it.
 */
function recordingSources(
  into: Parameters<ExecutionSourceObservationPort["observe"]>[0][],
): ExecutionSourceObservationPort {
  return {
    observe: (request) => {
      into.push(request);
      return Promise.resolve({
        observed: "Source",
        source: {
          reference: digestFold(observedCommit),
          repository: request.repository ?? asRepositoryId("repository"),
          commit: observedCommit,
          ref: asGitRefName(request.ref ?? "refs/heads/main"),
        },
      });
    },
    spawnSource: () => Promise.resolve(undefined),
  };
}

const manualDispatch: ProjectCommand = {
  version: 1,
  command: "ManualDispatch",
  ticket: id(1),
  expectedTicketVersion: 1,
};

test("a source observation is gathered before a spawn bundle is materialized", async () => {
  const observed: Parameters<ExecutionSourceObservationPort["observe"]>[0][] =
    [];
  const decision = await planned(
    releasedMemory(),
    manualDispatch,
    recordingSources(observed),
  );
  assert.deepEqual(observed, [{ partition, ticket: id(1) }]);
  assert.deepEqual(
    decision.outcome.outcome === "Journaled"
      ? decision.outcome.materialization.execution[0]?.bundle?.source
      : undefined,
    {
      repository: "repository",
      targetRef: "refs/heads/main",
      targetCommit: "a".repeat(40),
      manifests: [],
    },
  );
});

test("manual dispatch distinguishes a stale ticket from a disabled ticket", async () => {
  const decision = await planned(
    releasedMemory(),
    {
      version: 1,
      command: "ManualDispatch",
      ticket: id(1),
      expectedTicketVersion: 2,
    },
    {
      observe: () => {
        throw new Error("a stale command must not observe Git");
      },
      spawnSource: () => Promise.resolve(undefined),
    },
  );
  assert.deepEqual(decision.outcome, {
    outcome: "Refused",
    refusal: { type: "TicketChanged" },
  });
});

test("a dispatch over an undone dependency is refused naming it", async () => {
  let state = actorInit();
  for (const definition of [
    plainDefinitionOf(1),
    plainDefinitionOf(2, new Set([1])),
  ])
    state = stepped(refinementInstance, state, createTicketCommand(definition));
  const decision = await planned(
    {
      ...releasedMemory(2),
      graph: memoryGraph(state),
      ticketVersions: new Map([
        [id(1), 1],
        [id(2), 2],
      ]),
      dispatchContracts: twoContracts,
    },
    { ...manualDispatch, ticket: id(2), expectedTicketVersion: 2 },
  );
  assert.deepEqual(decision.outcome, {
    outcome: "Refused",
    refusal: {
      type: "DependenciesIncomplete",
      value: { ticket: 2, dependencies: new Set([1]) },
    },
  });
});

test("proposal validity ignores an unrelated journal-head advance", async () => {
  const memory = releasedMemory(40);
  const candidates = deriveDispatchCandidates(
    memory.graph,
    memory.ticketVersions,
    contracts,
  );
  const decision = await planned(memory, {
    version: 1,
    command: "ProposeDispatch",
    ticket: id(1),
    expectedTicketVersion: 1,
    observedViewToken: {
      ...partition,
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 1,
      digest: dispatchViewDigest(candidates),
    },
    selectorDecisionReference: "selector-decision",
  });
  assert.equal(decision.outcome.outcome, "Journaled");
  if (decision.outcome.outcome === "Journaled")
    assert.equal(decision.outcome.entry.seq, 41);
});

test("a proposal observed against another view identity is SelectionChanged", async () => {
  for (const mismatch of [
    { tenant: asTenantId("other-tenant") },
    { project: asProjectId("other-project") },
    { recoveryEpoch: "old-epoch" },
    { schemaVersion: 2 },
  ]) {
    const decision = await planned(releasedMemory(), {
      version: 1,
      command: "ProposeDispatch",
      ticket: id(1),
      expectedTicketVersion: 1,
      observedViewToken: {
        ...partition,
        recoveryEpoch: "epoch",
        schemaVersion: 1,
        watermark: 1,
        digest: "a".repeat(64),
        ...mismatch,
      },
      selectorDecisionReference: "selector-decision",
    });
    assert.deepEqual(decision.outcome, {
      outcome: "Refused",
      refusal: { type: "SelectionChanged" },
    });
  }
});

test("a proposal whose observed digest no longer describes the view still dispatches", async () => {
  const decision = await planned(releasedMemory(), {
    version: 1,
    command: "ProposeDispatch",
    ticket: id(1),
    expectedTicketVersion: 1,
    observedViewToken: {
      ...partition,
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 1,
      digest: "b".repeat(64),
    },
    selectorDecisionReference: "selector-decision",
  });
  assert.equal(decision.outcome.outcome, "Journaled");
});

/** A candidate whose release landed at a later sequence, so a lower claim is a stale one. */
function releasedAtVersion(version: number): ProjectMemory {
  return {
    ...releasedMemory(version),
    ticketVersions: new Map([[id(1), version]]),
  };
}

/** The digest of the page a memory's own candidates make, so no case is about the digest by accident. */
function currentDigestOf(memory: ProjectMemory): string {
  return dispatchViewDigest(
    deriveDispatchCandidates(
      memory.graph,
      memory.ticketVersions,
      memory.dispatchContracts ?? new Map(),
    ),
  );
}

/**
 * The version fence is an equality, so it is refused from both sides: a claim
 * the candidate has not reached, and one it has already left. Only the second
 * distinguishes equality from `>=`, and only the second is the stale read the
 * fence exists to catch — a page the author read behind the authority.
 */
for (const claim of [
  { name: "has not reached", memory: releasedMemory(), expected: 2 },
  { name: "has already left", memory: releasedAtVersion(5), expected: 1 },
]) {
  test(`a proposal at a version the candidate ${claim.name} is SelectionChanged`, async () => {
    const decision = await planned(claim.memory, {
      version: 1,
      command: "ProposeDispatch",
      ticket: id(1),
      expectedTicketVersion: claim.expected,
      observedViewToken: {
        ...partition,
        recoveryEpoch: "epoch",
        schemaVersion: 1,
        watermark: 1,
        digest: currentDigestOf(claim.memory),
      },
      selectorDecisionReference: "selector-decision",
    });
    assert.deepEqual(decision.outcome, {
      outcome: "Refused",
      refusal: { type: "SelectionChanged" },
    });
  });
}

/** The contract pins two independently dispatchable tickets were released under. */
const twoContracts = new Map(
  [id(1), id(2)].map((ticket) => [
    ticket,
    {
      configurationRevision: "revision",
      configurationDigest: "digest",
      configurationCanonical: '{"worker":"one"}',
    },
  ]),
);

/**
 * Two Ready tickets with no dependency between them: what one decision may
 * dispatch both of. The versions are folded out of the steps the way
 * `projectWriterLoad` folds them, so the fixture cannot drift from the writer.
 */
function twoReleasedMemory(): ProjectMemory {
  const tickets = [id(1), id(2)];
  const ticketVersions = new Map<number, number>();
  let state = actorInit();
  for (const [index, ticket] of tickets.entries()) {
    const before = memoryGraph(state);
    state = stepped(
      refinementInstance,
      state,
      createTicketCommand(plainDefinitionOf(ticket)),
    );
    for (const row of projectionChanges(before, memoryGraph(state)))
      ticketVersions.set(row.ticket, index + 1);
  }
  return {
    lease: {
      partition,
      owner: asOwnerId("owner"),
      fencingEpoch: 1,
      recoveryEpoch: asRecoveryEpoch("epoch"),
      head: tickets.length,
    },
    graph: memoryGraph(state),
    ticketVersions,
    dispatchContracts: twoContracts,
  };
}

/** The one token a decision carries on every proposal it makes: the page it was shown. */
function observedTokenOf(memory: ProjectMemory) {
  return {
    ...partition,
    recoveryEpoch: "epoch",
    schemaVersion: 1,
    watermark: memory.lease.head,
    digest: currentDigestOf(memory),
  };
}

function proposalOf(
  ticket: TicketId,
  expectedTicketVersion: number,
  observedViewToken: ReturnType<typeof observedTokenOf>,
): ProjectCommand {
  return {
    version: 1,
    command: "ProposeDispatch",
    ticket,
    expectedTicketVersion,
    observedViewToken,
    selectorDecisionReference: "one-decision",
  };
}

function proposalInput(
  ticket: TicketId,
  command: ProjectCommand,
): DecisionInput {
  return {
    partition,
    ordinal: 1,
    deferredPasses: 0,
    priority: classifyCommand(command).priority,
    source: {
      kind: "Operation",
      operation: asOperationId(`operation-${String(ticket)}`),
      command,
    },
  };
}

/** A durable authority that commits what it is offered, so a second proposal meets the first's state. */
const committingWriter: ProjectTicketWriter = {
  config: refinementInstance,
  rework: testReworkCap,
  store: {} as ProjectStore,
  decisions: {
    decide: (decision) =>
      Promise.resolve({
        decided: "Committed",
        lease: { ...decision.lease, head: decision.lease.head + 1 },
      }),
  },
  ticketBriefs: unbriefedTickets,
  executionSources: readableSources,
};

test("both dispatches of one decision land, though the first changed the view", async () => {
  const observed = twoReleasedMemory();
  const token = observedTokenOf(observed);
  const first = await projectWriterDecide(
    committingWriter,
    observed,
    proposalInput(id(1), proposalOf(id(1), 1, token)),
  );
  assert.equal(first.decided.decided, "Committed");
  const second = await projectWriterDecide(
    committingWriter,
    first.memory,
    proposalInput(id(2), proposalOf(id(2), 2, token)),
  );
  assert.equal(second.decided.decided, "Committed");
  assert.deepEqual(
    [id(1), id(2)].map((ticket) => ticketAt(second.memory.graph, ticket).phase),
    ["Work", "Work"],
  );
});

test("a proposal for a ticket another author already dispatched is SelectionChanged", async () => {
  const observed = twoReleasedMemory();
  const token = observedTokenOf(observed);
  const dispatched = await projectWriterDecide(
    committingWriter,
    observed,
    proposalInput(id(1), proposalOf(id(1), 1, token)),
  );
  assert.equal(dispatched.decided.decided, "Committed");
  const { offered } = await decidedWith(
    dispatched.memory,
    proposalInput(id(1), proposalOf(id(1), 1, token)),
  );
  assert.deepEqual(offered?.outcome, {
    outcome: "Refused",
    refusal: { type: "SelectionChanged" },
  });
});

test("the branch a ticket was briefed with names the ref its work is observed at", async () => {
  const observed: Parameters<ExecutionSourceObservationPort["observe"]>[0][] =
    [];
  const decision = await planned(
    releasedMemory(),
    manualDispatch,
    recordingSources(observed),
    {
      brief: () =>
        Promise.resolve(
          asDraftBrief({
            intent: "Fix the importer.",
            links: [],
            branch: "refs/heads/rt/ticket-brief",
          }),
        ),
    },
  );
  assert.deepEqual(
    observed.map((request) => request.ref),
    ["refs/heads/rt/ticket-brief"],
  );
  assert.equal(
    decision.outcome.outcome === "Journaled"
      ? decision.outcome.materialization.execution[0]?.bundle?.source?.targetRef
      : undefined,
    "refs/heads/rt/ticket-brief",
  );
});

test("a brief landing elsewhere still has its work observed at the branch it happens on", async () => {
  const observed: Parameters<ExecutionSourceObservationPort["observe"]>[0][] =
    [];
  await planned(releasedMemory(), manualDispatch, recordingSources(observed), {
    brief: () =>
      Promise.resolve(
        asDraftBrief({
          intent: "Fix the importer.",
          links: [],
          branch: "refs/heads/rt/ticket-brief",
          finalization: { mode: "Push", target: "refs/heads/rt/landing" },
        }),
      ),
  });
  assert.deepEqual(
    observed.map((request) => request.ref),
    ["refs/heads/rt/ticket-brief"],
  );
});

/** The commit the ticket's own source row carries, which every later spawn runs at. */
const workCommit = asGitObjectId("c".repeat(40));

/**
 * The real observation over a history that answers one source row, with both
 * remote ports fatal — so a spawn that asked a remote anything would throw
 * rather than assert.
 */
function pinnedSources(sourced: number[]): ExecutionSourceObservationPort {
  return executionSourceObservation(
    {
      binding: () => {
        throw new Error("a spawn reads no repository binding");
      },
    },
    {
      observeTarget: () => {
        throw new Error("a spawn observes no remote");
      },
    },
    {
      workSource: () =>
        Promise.resolve({ manifests: [asResultManifestId("manifest-one")] }),
      ticketSource: (_partition, _ticket, source) => {
        sourced.push(source);
        return Promise.resolve({
          repository: asRepositoryId("work-repository"),
          commit: workCommit,
        });
      },
    },
  );
}

/** The state of a ticket whose single work task was accepted, which opened its judgement. */
function workPassedState(): ReturnType<typeof journalStep> {
  return stepped(refinementInstance, dispatchedState(), workCompletion);
}

/** The work task's result, which is the completion that spawns the evaluation under test. */
const workCompletion = reportTaskTerminalCommand(
  producedReport(workTaskOf(1, 1)),
);

/** A completion as the inbox assembles one: the settled fact, with the wall read off its execution where it had one. */
function completionInput(
  event: TicketCommand,
  blockedBy?: BlockedReason,
): DecisionInput {
  if (event.type !== "ReportTaskTerminal")
    throw new Error("dispatch writer case: that command is not a completion");
  return {
    partition,
    ordinal: 1,
    deferredPasses: 0,
    priority: "Completion",
    source: {
      kind: "Operation",
      operation: asOperationId("completion"),
      command: { version: 1, command: "Decide", ticketCommand: event },
      ticketCommand: event,
      ...(blockedBy === undefined ? {} : { executionBlockedBy: blockedBy }),
    },
  };
}

/** The one request a decision authorized, materialized at the sources it read. */
async function spawnedAt(
  memory: ProjectMemory,
  input: DecisionInput,
  sourced: number[],
): Promise<ExecutionRequestPlan | undefined> {
  const { offered } = await decidedWith(memory, input, pinnedSources(sourced));
  return offered?.outcome.outcome === "Journaled"
    ? offered.outcome.materialization.execution[0]
    : undefined;
}

test("an evaluation spawns at the source its ticket carries and judges the work's manifests", async () => {
  const sourced: number[] = [];
  const spawn = await spawnedAt(
    dispatchedMemory(),
    completionInput(workCompletion),
    sourced,
  );
  assert.equal(spawn?.kind, "SpawnEvaluation");
  assert.deepEqual(sourced, [anAcceptedSource]);
  assert.deepEqual(spawn?.bundle?.source, {
    repository: "work-repository",
    targetCommit: workCommit,
    manifests: ["manifest-one"],
  });
});

/** A ticket dispatched into work, which is the phase a settled block interrupts. */
function dispatchedState(): ActorState {
  const config = refinementInstance;
  return stepped(
    config,
    stepped(config, actorInit(), createTicketCommand(plainDefinitionOf(1))),
    dispatchTicketCommand(id(1), aDispatchSource),
  );
}

function dispatchedMemory(): ProjectMemory {
  return { ...releasedMemory(), graph: memoryGraph(dispatchedState()) };
}

/** The completion of a task that stopped at a wall, with the wall read off its execution. */
function blockedCompletionInput(
  blockedBy: BlockedReason,
  task: TaskIdentity = workTaskOf(1, 1),
): DecisionInput {
  return completionInput(
    reportTaskTerminalCommand(
      stoppedReport(task, "ExecutionUnavailableFailure"),
    ),
    blockedBy,
  );
}

/**
 * The event names the ticket alone, so the wall the boundary recorded reaches
 * the desk only by being read off the execution and written beside the park.
 */
test("a settled block parks its ticket carrying the wall its execution recorded", async () => {
  for (const wall of allBlockedReasons) {
    const { offered } = await decidedWith(
      dispatchedMemory(),
      blockedCompletionInput(wall),
    );
    assert.equal(offered?.outcome.outcome, "Journaled");
    if (offered?.outcome.outcome !== "Journaled") continue;
    assert.deepEqual(
      offered.outcome.projection.map((row) => [
        row.phase,
        row.escalation,
        row.escalationEvidence,
      ]),
      [["Escalated", unreadableWall, wall]],
    );
  }
});

/** A stage of two evaluators, so one can fail while the other hits a wall. */
const pairedConfig = { ...refinementInstance, nTasks: 2 };
const pairedDefinition = releasedTicketOf(1, new Set<number>(), [
  { key: 1, evaluators: [evaluatorOf(1), evaluatorOf(2)] },
]);

/**
 * A judgement one evaluator has already failed and the other has yet to
 * answer, which is the stage a walled sibling concludes.
 */
function failedStageState(): ReturnType<typeof journalStep> {
  const work = workTaskOf(1, 1);
  const failing = evaluationTaskOf(1, 1, 1, 1, 1);
  return [
    dispatchTicketCommand(id(1), aDispatchSource),
    reportTaskTerminalCommand(producedReport(work)),
    reportTaskTerminalCommand(judgedReport(failing, "EvaluatorFail")),
  ].reduce(
    (state, event) => stepped(pairedConfig, state, event),
    stepped(pairedConfig, actorInit(), createTicketCommand(pairedDefinition)),
  );
}

/**
 * The judgement is what parked this ticket, and a judgement is reached by
 * counting answers rather than by meeting a wall — so the wall its last
 * evaluator carried explains nothing the desk is being shown.
 */
test("a stage that failed beside a walled evaluator parks carrying no wall", async () => {
  const { offered } = await decidedWith(
    { ...releasedMemory(), graph: memoryGraph(failedStageState()) },
    blockedCompletionInput(
      "ExecutionProfileUnavailable",
      evaluationTaskOf(1, 1, 1, 1, 2),
    ),
    readableSources,
    unbriefedTickets,
    { config: pairedConfig, rework: { cyclesMax: 0 } },
  );
  assert.equal(offered?.outcome.outcome, "Journaled");
  if (offered?.outcome.outcome !== "Journaled") return;
  assert.deepEqual(
    offered.outcome.projection.map((row) => [
      row.escalation,
      row.escalationEvidence,
    ]),
    [["EvaluationFailureEscalated", undefined]],
  );
});

/** A port that reads no source and says why, which is the whole of what it answers. */
function unreadableSources(
  evidence: GitEvidence,
): ExecutionSourceObservationPort {
  return {
    observe: () => Promise.resolve({ observed: "Unreadable", evidence }),
    spawnSource: () => Promise.resolve(undefined),
  };
}

/**
 * Every durable evidence, beside the refusal it earns its client. An input no
 * client is waiting on earns no refusal, so what it lands as is the subject of
 * the cases below.
 */
const durableEvidences = [
  ["RefUnreadable", "ExecutionSourceUnreadable"],
  ["ObjectMissing", "ExecutionSourceUnreadable"],
  ["IntegrationFailed", "ExecutionSourceUnreadable"],
  ["RemoteDenied", "ExecutionSourceDenied"],
] as const;

/** The one wall a source no dispatch can read parks its ticket on. */
const unreadableWall = "WorkExecutionUnavailableEscalated";

/** Every evidence a later observation may find readable. */
const transientEvidences = ["RemoteUnreachable", "PromotionTimedOut"] as const;

test("a source no dispatch can read is refused under the evidence that named it", async () => {
  for (const [evidence, code] of durableEvidences) {
    const memory = releasedMemory();
    const { offered, result } = await decidedWith(
      memory,
      operationInput(manualDispatch),
      unreadableSources(evidence),
    );
    assert.deepEqual(offered?.outcome, {
      outcome: "Refused",
      refusal: { type: code },
    });
    assert.equal(result.memory, memory);
    assert.equal(result.decided.decided, "Refused");
  }
});

test("a source that may read later defers the input rather than deciding it", async () => {
  for (const evidence of transientEvidences) {
    const memory = releasedMemory();
    const { offered, result } = await decidedWith(
      memory,
      operationInput(manualDispatch),
      unreadableSources(evidence),
    );
    assert.deepEqual(offered?.outcome, { outcome: "Deferred" });
    assert.equal(result.memory, memory);
    assert.deepEqual(result.decided, { decided: "Deferred", evidence });
  }
});

/**
 * The bound is on the passes an input has already been deferred, so the pass
 * that finds them spent answers the client instead of deferring it again.
 */
test("a source still unreadable once its deferrals are spent is refused under its last evidence", async () => {
  for (const evidence of transientEvidences) {
    const spent = {
      ...operationInput(manualDispatch),
      deferredPasses: sourceDeferralPassesMax,
    };
    const { offered, result } = await decidedWith(
      releasedMemory(),
      spent,
      unreadableSources(evidence),
    );
    assert.deepEqual(offered?.outcome, {
      outcome: "Refused",
      refusal: { type: "ExecutionSourceUnreadable" },
    });
    assert.equal(result.decided.decided, "Refused");
    const lastDeferred = await decidedWith(
      releasedMemory(),
      { ...spent, deferredPasses: sourceDeferralPassesMax - 1 },
      unreadableSources(evidence),
    );
    assert.deepEqual(lastDeferred.offered?.outcome, { outcome: "Deferred" });
  }
});

/**
 * The memory of a ticket whose one evaluator is about to fail, which is the
 * completion that spawns: a rework re-enters work off the same decision.
 */
function judgementMemory(): ProjectMemory {
  return { ...releasedMemory(), graph: memoryGraph(workPassedState()) };
}

/** The failing judgement as the inbox assembles it, which reworks and so spawns. */
function reworkCompletionInput(): DecisionInput {
  const judge = evaluationTaskOf(1, 1, 1, 1, 1);
  return completionInput(
    reportTaskTerminalCommand(judgedReport(judge, "EvaluatorFail")),
  );
}

/**
 * A rework re-enters work off the judgement that failed, and what it runs at is
 * the source the ticket already carries — so the decision reads its own row and
 * asks no remote, and the commit that was judged is the commit that is reworked.
 */
test("a rework spawns at the accepted source, asking no remote", async () => {
  const sourced: number[] = [];
  const spawn = await spawnedAt(
    judgementMemory(),
    reworkCompletionInput(),
    sourced,
  );
  assert.equal(spawn?.kind, "SpawnWork");
  assert.deepEqual(sourced, [anAcceptedSource]);
  assert.deepEqual(spawn?.bundle?.source, {
    repository: "work-repository",
    targetCommit: workCommit,
    manifests: [],
  });
});

/** A stage whose second evaluator stopped rather than answering, which is what a resume returns to. */
function stoppedStageMemory(): ProjectMemory {
  const stopping = evaluationTaskOf(1, 1, 1, 1, 2);
  const state = [
    dispatchTicketCommand(id(1), aDispatchSource),
    reportTaskTerminalCommand(producedReport(workTaskOf(1, 1))),
    reportTaskTerminalCommand(
      judgedReport(evaluationTaskOf(1, 1, 1, 1, 1), "EvaluatorPass"),
    ),
    reportTaskTerminalCommand(stoppedReport(stopping, "ProcessFailure")),
  ].reduce(
    (each, event) => stepped(pairedConfig, each, event),
    stepped(pairedConfig, actorInit(), createTicketCommand(pairedDefinition)),
  );
  return { ...releasedMemory(), graph: memoryGraph(state) };
}

/** A resume as a principal offers one, which re-asks the evaluator that stopped. */
const resumeInput: DecisionInput = {
  partition,
  ordinal: 1,
  deferredPasses: 0,
  priority: "Ordinary",
  source: {
    kind: "Operation",
    operation: asOperationId("resume"),
    command: {
      version: 1,
      command: "Decide",
      ticketCommand: asOperationTicketCommand(resumeTicketCommand(id(1))),
    },
    ticketCommand: resumeTicketCommand(id(1)),
  },
};

/** A resume is no dispatch either, so the re-ask runs where the stopped pass ran. */
test("a resume re-asks at the accepted source, asking no remote", async () => {
  const sourced: number[] = [];
  const { offered } = await decidedWith(
    stoppedStageMemory(),
    resumeInput,
    pinnedSources(sourced),
    unbriefedTickets,
    { config: pairedConfig },
  );
  assert.equal(offered?.outcome.outcome, "Journaled");
  if (offered?.outcome.outcome !== "Journaled") return;
  const spawn = offered.outcome.materialization.execution[0];
  assert.equal(spawn?.kind, "SpawnEvaluation");
  assert.deepEqual(sourced, [anAcceptedSource]);
  assert.deepEqual(spawn?.bundle?.source, {
    repository: "work-repository",
    targetCommit: workCommit,
    manifests: ["manifest-one"],
  });
});

/** What a decision journalled and materialized, refusing one that journalled nothing. */
function journaledOf(offered: Decision | undefined) {
  assert.equal(offered?.outcome.outcome, "Journaled");
  if (offered?.outcome.outcome !== "Journaled")
    throw new Error("dispatch writer case: the decision journalled nothing");
  return offered.outcome;
}

/**
 * The cap is the writer's policy and the event is what it picked: one failing
 * stage, decided under a cap with reworks left and under one with none, takes
 * each edge and names it, and replay never has to ask the cap again.
 */
test("a failing stage takes the edge the cap picks, and the event names it", async () => {
  const reworked = journaledOf(
    (
      await decidedWith(
        judgementMemory(),
        reworkCompletionInput(),
        pinnedSources([]),
        unbriefedTickets,
        { rework: { cyclesMax: 2 } },
      )
    ).offered,
  );
  assert.equal(reworked.entry.event.type, "TicketEvaluationReworkStarted");
  assert.deepEqual(
    reworked.materialization.execution.map((request) => [
      request.request,
      request.kind,
    ]),
    [["2:0:ExecuteTask", "SpawnWork"]],
  );
  assert.deepEqual(reworked.materialization.actions, []);

  const escalated = journaledOf(
    (
      await decidedWith(
        judgementMemory(),
        reworkCompletionInput(),
        pinnedSources([]),
        unbriefedTickets,
        { rework: { cyclesMax: 0 } },
      )
    ).offered,
  );
  assert.equal(escalated.entry.event.type, "TicketEvaluationFailureEscalated");
  assert.deepEqual(escalated.materialization.execution, []);
  assert.deepEqual(
    escalated.materialization.actions.map((action) => [
      action.action,
      action.escalation,
    ]),
    [["2:TicketEscalation", "EvaluationFailureEscalated"]],
  );
});

/** A completion for a task the ticket no longer owes is refused naming that task, and nothing is journalled for it. */
test("a stale completion is refused TaskNotCurrent with its task and no journal row", async () => {
  const { offered } = await decidedWith(
    judgementMemory(),
    completionInput(workCompletion),
  );
  assert.deepEqual(offered?.outcome, {
    outcome: "Refused",
    refusal: {
      type: "TaskNotCurrent",
      value: { ticket: 1, task: workTaskOf(1, 1) },
    },
  });
});

/** A ticket parked at its work wall, which a resume returns to work. */
function workWalledMemory(): ProjectMemory {
  const work = workTaskOf(1, 1);
  const state = stepped(
    refinementInstance,
    dispatchedState(),
    reportTaskTerminalCommand(
      stoppedReport(work, "ExecutionUnavailableFailure"),
    ),
  );
  return { ...releasedMemory(), graph: memoryGraph(state) };
}

/** A ticket parked because its finalization reached no result, which a resume finalizes again. */
function finalizationWalledMemory(): ProjectMemory {
  const judge = evaluationTaskOf(1, 1, 1, 1, 1);
  const state = [
    reportTaskTerminalCommand(judgedReport(judge, "EvaluatorPass")),
    reportFinalizationResultCommand(id(1), 1, 1, {
      type: "FinalizationResultUnavailable",
      value: 1,
    }),
  ].reduce(
    (each, event) => stepped(refinementInstance, each, event),
    workPassedState(),
  );
  return { ...releasedMemory(), graph: memoryGraph(state) };
}

/** A result for the attempt a resume replaced is refused naming that attempt, and nothing is journalled for it. */
test("an old-generation finalization result is refused FinalizationNotCurrent with its cycle and generation", async () => {
  const judge = evaluationTaskOf(1, 1, 1, 1, 1);
  const state = [
    reportTaskTerminalCommand(judgedReport(judge, "EvaluatorPass")),
    reportFinalizationResultCommand(id(1), 1, 1, {
      type: "FinalizationResultUnavailable",
      value: 1,
    }),
    resumeTicketCommand(id(1)),
  ].reduce(
    (each, command) => stepped(refinementInstance, each, command),
    workPassedState(),
  );
  const graph = memoryGraph(state);
  const { workCycle, generation } = finalizationOperationOf(
    ticketAt(graph, id(1)),
  );
  assert.deepEqual({ workCycle, generation }, { workCycle: 1, generation: 2 });
  const stale = reportFinalizationResultCommand(id(1), 1, 1, {
    type: "FinalizationSucceeded",
    value: 1,
  });
  const { offered } = await decidedWith(
    { ...releasedMemory(), graph },
    {
      partition,
      ordinal: 1,
      deferredPasses: 0,
      priority: "Completion",
      source: {
        kind: "Operation",
        operation: asOperationId("finalization"),
        command: {
          version: 1,
          command: "SubmitFinalizationResult",
          request: "request",
          attempt: "attempt",
          requestGeneration: 1,
          recoveryEpoch: "epoch",
          outcome: "FinalizationSucceeded",
        },
        ticketCommand: stale,
        finalizationRequest: {
          request: "request",
          requestGeneration: 1,
          open: true,
        },
      },
    },
  );
  assert.deepEqual(offered?.outcome, {
    outcome: "Refused",
    refusal: {
      type: "FinalizationNotCurrent",
      value: { ticket: 1, workCycle: 1, generation: 1 },
    },
  });
});

/**
 * One command resumes every wall, and the event says which of three things it
 * did: work again, the stopped evaluators asked again, or the finalization
 * attempted again — each owing what it names.
 */
test("a resume decides the event its wall implies and owes what that event names", async () => {
  const work = journaledOf(
    (await decidedWith(workWalledMemory(), resumeInput)).offered,
  );
  assert.equal(work.entry.event.type, "TicketWorkResumed");
  assert.deepEqual(
    work.materialization.execution.map((request) => request.kind),
    ["SpawnWork"],
  );

  const evaluation = journaledOf(
    (
      await decidedWith(
        stoppedStageMemory(),
        resumeInput,
        pinnedSources([]),
        unbriefedTickets,
        { config: pairedConfig },
      )
    ).offered,
  );
  assert.equal(evaluation.entry.event.type, "TicketEvaluationResumed");
  assert.deepEqual(
    evaluation.materialization.execution.map((request) => request.kind),
    ["SpawnEvaluation"],
  );

  const finalization = journaledOf(
    (await decidedWith(finalizationWalledMemory(), resumeInput)).offered,
  );
  assert.equal(finalization.entry.event.type, "TicketFinalizationResumed");
  assert.deepEqual(finalization.materialization.execution, []);
  assert.deepEqual(
    finalization.materialization.finalization.map((request) => request.request),
    ["2:0:FinalizeTicket"],
  );
});

test("a deferred input ends the run it arrived in without clearing readiness", async () => {
  const journal = stepped(
    refinementInstance,
    actorInit(),
    createTicketCommand(plainDefinitionOf(1)),
  ).journal;
  const taken: number[] = [];
  let deferred = 0;
  let cleared = 0;
  const memory = await projectTicketWriterRun(
    {
      config: refinementInstance,
      rework: testReworkCap,
      store: {
        load: () =>
          Promise.resolve({
            parsed: "Ok",
            value: storedAtCurrentSemantics(journal),
          }),
      } as unknown as ProjectStore,
      decisions: {
        decide: (decision) =>
          decision.outcome.outcome === "Deferred"
            ? Promise.resolve({ decided: "Deferred" })
            : Promise.reject(new Error("a deferred input journals nothing")),
      },
      ticketBriefs: { brief: () => Promise.resolve(undefined) },
      executionSources: unreadableSources("RemoteUnreachable"),
    },
    {
      ready: () => Promise.resolve([]),
      next: () => {
        taken.push(taken.length);
        return Promise.resolve(operationInput(manualDispatch));
      },
      clearReadiness: () => {
        cleared += 1;
        return Promise.resolve({ cleared: "Cleared" });
      },
    },
    { partition, generation: 1 },
    releasedMemory().lease,
    () => 0,
    ticketServiceDefaults,
    {
      ...silentTicketServiceMetrics,
      executionSourceDeferred: () => {
        deferred += 1;
      },
    },
  );
  assert.deepEqual(taken, [0]);
  assert.equal(deferred, 1);
  assert.equal(cleared, 0);
  assert.equal(memory.lease.head, 1);
});

/** A repository of the project's that is not the one an unbriefed ticket takes. */
const siblingRepository = "https://forge.example/sibling.git";

test("the repository a ticket was briefed with is the one its work is pinned to", async () => {
  const observed: Parameters<ExecutionSourceObservationPort["observe"]>[0][] =
    [];
  const decision = await planned(
    releasedMemory(),
    manualDispatch,
    recordingSources(observed),
    {
      brief: () =>
        Promise.resolve(
          asDraftBrief({
            intent: "Fix the importer.",
            links: [],
            repository: siblingRepository,
          }),
        ),
    },
  );
  assert.deepEqual(
    observed.map((request) => request.repository),
    [siblingRepository],
  );
  assert.equal(
    decision.outcome.outcome === "Journaled"
      ? decision.outcome.materialization.execution[0]?.bundle?.source
          ?.repository
      : undefined,
    siblingRepository,
  );
});
