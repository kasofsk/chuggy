import assert from "node:assert/strict";
import { test } from "node:test";

import { releaseTicketEvent } from "../../src/actor/decisionEvent.ts";
import { actorInit, journalStep, memoryCore } from "../../src/actor/state.ts";
import {
  asOperationId,
  classifyCommand,
} from "../../src/interpreter/operationInbox.ts";
import type { DecisionInput } from "../../src/interpreter/projectDiscovery.ts";
import type {
  Decision,
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
} from "../../src/interpreter/finalizer.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
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
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
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

async function planned(
  memory: ProjectMemory,
  command: TicketCommand,
  executionSources?: ExecutionSourceObservationPort,
  ticketBriefs?: TicketBriefPort,
): Promise<Decision> {
  let captured: Decision | undefined;
  const decisions: ProjectDecision = {
    decide: (decision) => {
      captured = decision;
      return Promise.resolve({ decided: "Refused" });
    },
  };
  await projectWriterDecide(
    {
      config: refinementInstance,
      store: {} as ProjectStore,
      decisions,
      ticketBriefs: ticketBriefs ?? {
        brief: () => Promise.resolve(undefined),
      },
      executionSources: executionSources ?? {
        observe: () =>
          Promise.resolve({
            observed: "Source",
            source: {
              repository: asRepositoryId("repository"),
              target: { commit: asGitObjectId("a".repeat(40)) },
              manifests: [],
            },
          }),
      },
    },
    memory,
    operationInput(command),
  );
  assert.ok(captured !== undefined);
  return captured;
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
