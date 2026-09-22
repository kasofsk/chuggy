import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEvent,
  releaseTicketEvent,
  taskDoneEvent,
  workReduceEvent,
  ticketAt,
} from "../../src/actor/decisionEvent.ts";
import {
  allBlockedReasons,
  type BlockedReason,
} from "../../src/interpreter/executionScheduler.ts";
import { actorInit, journalStep, memoryGraph } from "../../src/actor/state.ts";
import { storedAtCurrentSemantics } from "../../src/actor/journal.ts";
import {
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
import type { TicketCommand } from "../../src/interpreter/ticketCommand.ts";
import { executionSourceObservation } from "../../src/interpreter/executionSourceObservation.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
import type { TicketId } from "../../src/domain/ids.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import {
  plainAuthoring,
  plainDisposition,
  refinementInstance,
} from "../actor/harness.ts";
import {
  id,
  judgedReport,
  producedReport,
  stoppedReport,
} from "../domain/fixtures.ts";

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
  const released = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
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

function operationInput(command: TicketCommand): DecisionInput {
  return {
    partition,
    ordinal: 1,
    priority: classifyCommand(command).priority,
    source: {
      kind: "Operation",
      operation: asOperationId("operation"),
      command,
      resolvedEvent: { type: "Dispatch", value: id(1) },
    },
  };
}

/** The source a test that is not about observation is answered with. */
const readableSources: ExecutionSourceObservationPort = {
  observe: () =>
    Promise.resolve({
      observed: "Source",
      source: {
        repository: asRepositoryId("repository"),
        target: { commit: asGitObjectId("a".repeat(40)) },
        manifests: [],
      },
    }),
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
): Promise<{
  readonly offered: Decision | undefined;
  readonly result: ProjectDecided;
}> {
  let offered: Decision | undefined;
  const decisions: ProjectDecision = {
    decide: (decision) => {
      offered = decision;
      return Promise.resolve({ decided: "Refused" });
    },
  };
  const result = await projectWriterDecide(
    {
      config: refinementInstance,
      rework: testReworkCap,
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
  command: TicketCommand,
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
          repository: request.repository ?? asRepositoryId("repository"),
          target: {
            ref: asGitRefName(request.ref ?? "refs/heads/main"),
            commit: asGitObjectId("a".repeat(40)),
          },
          manifests: [],
        },
      });
    },
  };
}

const manualDispatch: TicketCommand = {
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
  assert.deepEqual(observed, [{ partition, ticket: id(1), kind: "Work" }]);
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
    },
  );
  assert.deepEqual(decision.outcome, {
    outcome: "Refused",
    code: "TicketChanged",
  });
});

test("proposal validity ignores an unrelated journal-head advance", async () => {
  const memory = releasedMemory(40);
  const candidates = deriveDispatchCandidates(
    refinementInstance,
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
      code: "SelectionChanged",
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
      refinementInstance,
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
      code: "SelectionChanged",
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
    state = journalStep(
      refinementInstance,
      state,
      releaseTicketEvent(ticket, plainAuthoring),
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
): TicketCommand {
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
  command: TicketCommand,
): DecisionInput {
  return {
    partition,
    ordinal: 1,
    priority: classifyCommand(command).priority,
    source: {
      kind: "Operation",
      operation: asOperationId(`operation-${String(ticket)}`),
      command,
      resolvedEvent: { type: "Dispatch", value: ticket },
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
    code: "SelectionChanged",
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

const workBase = asGitObjectId("b".repeat(40));
const workCommit = asGitObjectId("c".repeat(40));

/** The state of a ticket whose single work task has passed and awaits its reduce. */
function workPassedState(): ReturnType<typeof journalStep> {
  const config = refinementInstance;
  let state = journalStep(
    config,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  state = journalStep(config, state, dispatchEvent(id(1)));
  return journalStep(
    config,
    state,
    taskDoneEvent(
      id(1),
      workTaskOf(1, 1),
      producedReport(workTaskOf(1, 1)),
      plainDisposition,
    ),
  );
}

/** The memory of a ticket whose single work task has passed and awaits its reduce. */
function workPassedMemory(): ProjectMemory {
  return { ...releasedMemory(), graph: memoryGraph(workPassedState()) };
}

/** The reduce that turns passed work into the evaluation spawn under test. */
function workReduceInput(memory: ProjectMemory): DecisionInput {
  const ticket = ticketAt(memory.graph, id(1));
  return {
    partition,
    ordinal: 1,
    priority: "Continuation",
    source: {
      kind: "Continuation",
      continuation: "continuation",
      reduction: { ticket: id(1) },
      expectedTicketVersion: 1,
      expectedPhase: ticket.phase,
      taskSetGeneration: ticket.spawned,
    },
  };
}

/** The evaluation spawn a work reduce materializes over one work spawn's declarations. */
async function evaluationSpawn(
  declared: readonly ReturnType<typeof asGitObjectId>[],
): Promise<ExecutionRequestPlan | undefined> {
  const memory = workPassedMemory();
  const { offered } = await decidedWith(
    memory,
    workReduceInput(memory),
    executionSourceObservation(
      {
        binding: () => {
          throw new Error("an evaluation must not read the project binding");
        },
      },
      {
        observeTarget: () => {
          throw new Error("mutable Git must not be observed");
        },
      },
      {
        workSource: () =>
          Promise.resolve({
            repository: asRepositoryId("work-repository"),
            base: workBase,
            declared,
            manifests: [asResultManifestId("manifest-one")],
          }),
      },
    ),
  );
  return offered?.outcome.outcome === "Journaled"
    ? offered.outcome.materialization.execution[0]
    : undefined;
}

test("an evaluation spawn pins the commit its work produced, not the base it ran on", async () => {
  const spawn = await evaluationSpawn([workCommit]);
  assert.equal(spawn?.kind, "SpawnEvaluation");
  assert.deepEqual(spawn?.bundle?.source, {
    repository: "work-repository",
    targetCommit: workCommit,
    manifests: ["manifest-one"],
  });
});

test("a fan-out that declared several commits spawns its evaluation at the base", async () => {
  const spawn = await evaluationSpawn([
    workCommit,
    asGitObjectId("d".repeat(40)),
  ]);
  assert.equal(spawn?.kind, "SpawnEvaluation");
  assert.equal(spawn?.bundle?.source?.targetCommit, workBase);
});

/** A ticket dispatched into work, which is the phase a settled block interrupts. */
function dispatchedMemory(): ProjectMemory {
  const config = refinementInstance;
  const state = journalStep(
    config,
    journalStep(config, actorInit(), releaseTicketEvent(id(1), plainAuthoring)),
    dispatchEvent(id(1)),
  );
  return { ...releasedMemory(), graph: memoryGraph(state) };
}

/** The completion as the inbox assembles one, with the wall read off its execution. */
function blockedCompletionInput(blockedBy: BlockedReason): DecisionInput {
  const work = workTaskOf(1, 1);
  const event = {
    type: "TaskDone",
    value: {
      ticket: id(1),
      task: work,
      report: stoppedReport(work, "ExecutionUnavailableFailure"),
    },
  } as const;
  return {
    partition,
    ordinal: 1,
    priority: "Completion",
    source: {
      kind: "Operation",
      operation: asOperationId("completion"),
      command: { version: 1, command: "Decide", event },
      completion: event,
      executionBlockedBy: blockedBy,
    },
  };
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

/** A port that reads no source and says why, which is the whole of what it answers. */
function unreadableSources(
  evidence: GitEvidence,
): ExecutionSourceObservationPort {
  return {
    observe: () => Promise.resolve({ observed: "Unreadable", evidence }),
  };
}

/**
 * Every durable evidence, beside the refusal it earns its client. A
 * continuation has no client to earn a refusal, so it parks its ticket instead
 * and the evidence that named the wall is what the desk row carries.
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
    assert.deepEqual(offered?.outcome, { outcome: "Refused", code });
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
    assert.equal(offered, undefined);
    assert.equal(result.memory, memory);
    assert.deepEqual(result.decided, { decided: "Deferred", evidence });
  }
});

/**
 * The memory of a ticket whose one evaluator is about to fail, which is the
 * completion that spawns: a rework re-enters work off the same decision.
 */
function judgementMemory(): ProjectMemory {
  const state = journalStep(
    refinementInstance,
    workPassedState(),
    workReduceEvent(id(1)),
  );
  return { ...releasedMemory(), graph: memoryGraph(state) };
}

/** The failing judgement as the inbox assembles it, which reworks and so spawns. */
function reworkCompletionInput(): DecisionInput {
  const judge = evaluationTaskOf(1, 1, 1, 1, 1);
  const event = {
    type: "TaskDone",
    value: {
      ticket: id(1),
      task: judge,
      report: judgedReport(judge, "EvaluatorFail"),
    },
  } as const;
  return {
    partition,
    ordinal: 1,
    priority: "Completion",
    source: {
      kind: "Operation",
      operation: asOperationId("completion"),
      command: { version: 1, command: "Decide", event },
      completion: event,
    },
  };
}

/**
 * A refusal here would settle at this boundary a task the journal never heard
 * settle, so the completion waits for a source a later quantum can read.
 */
test("a completion whose spawn has no readable source is deferred, not refused", async () => {
  for (const [evidence] of durableEvidences) {
    const memory = judgementMemory();
    const { offered, result } = await decidedWith(
      memory,
      reworkCompletionInput(),
      unreadableSources(evidence),
    );
    assert.equal(offered, undefined, evidence);
    assert.equal(result.memory, memory);
    assert.deepEqual(result.decided, { decided: "Deferred", evidence });
  }
});

test("a continuation whose source cannot be read is deferred, whatever named the wall", async () => {
  for (const [evidence] of durableEvidences) {
    const memory = workPassedMemory();
    const { offered, result } = await decidedWith(
      memory,
      workReduceInput(memory),
      unreadableSources(evidence),
    );
    assert.equal(offered, undefined, evidence);
    assert.equal(result.memory, memory);
    assert.deepEqual(result.decided, { decided: "Deferred", evidence });
  }
});

test("a continuation meeting a source that may read later is deferred too", async () => {
  for (const evidence of transientEvidences) {
    const memory = workPassedMemory();
    const { offered, result } = await decidedWith(
      memory,
      workReduceInput(memory),
      unreadableSources(evidence),
    );
    assert.equal(offered, undefined);
    assert.equal(result.memory, memory);
    assert.deepEqual(result.decided, { decided: "Deferred", evidence });
  }
});

test("a deferred input ends the run it arrived in without clearing readiness", async () => {
  const journal = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
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
        decide: () =>
          Promise.reject(new Error("a deferred input offers no decision")),
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
