import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEvent,
  releaseTicketEvent,
  taskDoneEvent,
  ticketAt,
  workReduceEvent,
} from "../../src/actor/decisionEvent.ts";
import { actorInit, journalStep, memoryCore } from "../../src/actor/state.ts";
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
  projectWriterDecide,
  type ProjectDecided,
  type ProjectMemory,
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
import { asTaskId } from "../../src/domain/ids.ts";
import {
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
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
    core: memoryCore(released),
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

/** A port that records what it was asked to observe and answers at the ref it was given. */
function recordingSources(
  into: Parameters<ExecutionSourceObservationPort["observe"]>[0][],
): ExecutionSourceObservationPort {
  return {
    observe: (request) => {
      into.push(request);
      return Promise.resolve({
        observed: "Source",
        source: {
          repository: asRepositoryId("repository"),
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
  assert.deepEqual(observed, [
    {
      partition,
      ticket: id(1),
      kind: "Work",
      configurationCanonical: '{"worker":"one"}',
    },
  ]);
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
    memory.core,
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

test("proposal digest and recovery epoch mismatches are SelectionChanged", async () => {
  for (const mismatch of [
    { recoveryEpoch: "old-epoch", digest: "a".repeat(64) },
    { recoveryEpoch: "epoch", digest: "b".repeat(64) },
  ]) {
    const decision = await planned(releasedMemory(), {
      version: 1,
      command: "ProposeDispatch",
      ticket: id(1),
      expectedTicketVersion: 1,
      observedViewToken: {
        ...partition,
        ...mismatch,
        schemaVersion: 1,
        watermark: 1,
      },
      selectorDecisionReference: "selector-decision",
    });
    assert.deepEqual(decision.outcome, {
      outcome: "Refused",
      code: "SelectionChanged",
    });
  }
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

const workBase = asGitObjectId("b".repeat(40));
const workCommit = asGitObjectId("c".repeat(40));

/** The memory of a ticket whose single work task has passed and awaits its reduce. */
function workPassedMemory(): ProjectMemory {
  const config = refinementInstance;
  let state = journalStep(
    config,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  state = journalStep(config, state, dispatchEvent(id(1)));
  state = journalStep(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
  );
  return { ...releasedMemory(), core: memoryCore(state) };
}

/** The reduce that turns passed work into the evaluation spawn under test. */
function workReduceInput(memory: ProjectMemory): DecisionInput {
  const ticket = ticketAt(memory.core, id(1));
  return {
    partition,
    ordinal: 1,
    priority: "Continuation",
    source: {
      kind: "Continuation",
      continuation: "continuation",
      command: workReduceEvent(id(1)),
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

/** A port that reads no source and says why, which is the whole of what it answers. */
function unreadableSources(
  evidence: GitEvidence,
): ExecutionSourceObservationPort {
  return {
    observe: () => Promise.resolve({ observed: "Unreadable", evidence }),
  };
}

/** Every durable evidence, beside the refusal it earns and the wall it parks on. */
const durableEvidences = [
  ["RefUnreadable", "ExecutionSourceUnreadable", "TicketConfigIncompatible"],
  ["ObjectMissing", "ExecutionSourceUnreadable", "TicketConfigIncompatible"],
  [
    "IntegrationFailed",
    "ExecutionSourceUnreadable",
    "TicketConfigIncompatible",
  ],
  ["RemoteDenied", "ExecutionSourceDenied", "ExecutionPolicyDenied"],
] as const;

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

test("a continuation whose source cannot be read parks its ticket on the desk", async () => {
  for (const [evidence, , reason] of durableEvidences) {
    const memory = workPassedMemory();
    const { offered } = await decidedWith(
      memory,
      workReduceInput(memory),
      unreadableSources(evidence),
    );
    assert.equal(offered?.outcome.outcome, "Journaled");
    if (offered?.outcome.outcome !== "Journaled") continue;
    assert.deepEqual(offered.outcome.entry.event, {
      type: "ExecutionBlocked",
      value: { ticket: id(1), reason },
    });
    assert.deepEqual(
      offered.outcome.projection.map((row) => [
        row.ticket,
        row.phase,
        row.reason,
      ]),
      [[id(1), "Escalated", reason]],
    );
    assert.deepEqual(
      offered.outcome.materialization.actions.map((action) => [
        action.kind,
        action.capability,
      ]),
      [["TicketEscalation", "ResolveTicket"]],
    );
  }
});

test("a continuation meeting a source that may read later is deferred, not parked", async () => {
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
      store: {
        load: () => Promise.resolve({ parsed: "Ok", value: journal }),
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
