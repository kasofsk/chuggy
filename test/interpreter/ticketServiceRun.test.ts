import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTicketCommand,
  dispatchTicketCommand,
  reportFinalizationResultCommand,
  reportTaskTerminalCommand,
  updateTicketCommand,
  type TicketCommand,
} from "../../src/actor/command.ts";
import { storedAtCurrentSemantics } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import {
  aDispatchSource,
  anAcceptedSource,
  revisedTicketOf,
} from "../../src/domain/config.ts";
import { evaluationTaskOf, workTaskIdentity } from "../../src/domain/task.ts";
import type {
  TaskDefinition,
  TaskTerminalReport,
} from "../../src/domain/generated/modelTypes.ts";
import type {
  Decision,
  ProjectDecision,
} from "../../src/interpreter/projectDecision.ts";
import type {
  DecisionInput,
  ProjectDiscovery,
  Readiness,
} from "../../src/interpreter/projectDiscovery.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import type { StoredProjectCommand } from "../../src/interpreter/projectCommand.ts";
import {
  plainDefinitionOf,
  plainPolicy,
  refinementInstance,
} from "../actor/harness.ts";
import {
  id,
  judgedReport,
  obligationFor,
  producedReport,
  resultFor,
} from "../domain/fixtures.ts";
import {
  asOwnerId,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Lease,
  type Partition,
  type ProjectStore,
} from "../../src/interpreter/projectStore.ts";
import {
  silentTicketServiceMetrics,
  type TicketServiceMetrics,
} from "../../src/interpreter/ticketService.ts";
import {
  ticketServiceRunOnce,
  type TicketServiceRuntimeService,
} from "../../src/interpreter/ticketServiceRun.ts";
import { modelInstance } from "../domain/configs.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const poisoned = {
  tenant: asTenantId("tenant"),
  project: asProjectId("poisoned"),
};
const healthy = {
  tenant: asTenantId("tenant"),
  project: asProjectId("healthy"),
};
const owner = asOwnerId("writer");
const recoveryEpoch = asRecoveryEpoch("epoch");
const lease: Lease = {
  partition,
  owner,
  recoveryEpoch,
  fencingEpoch: 1,
  head: 0,
};

function unreachablePromise<Result>(): Promise<Result> {
  return Promise.reject(new Error("unreachable test port"));
}

const executionSources = {
  observe: () =>
    Promise.resolve({
      observed: "Unreadable" as const,
      evidence: "RefUnreadable" as const,
    }),
  spawnSource: () => unreachablePromise<undefined>(),
};

/** The pass's service around the two ports every case here is actually about. */
function passService(
  projects: ProjectStore,
  discovery: ProjectDiscovery,
  metrics?: TicketServiceMetrics,
): TicketServiceRuntimeService {
  return {
    domain: modelInstance,
    rework: { cyclesMax: 2 },
    discovery,
    decisions: { decide: () => unreachablePromise() },
    projects,
    executionSources,
    ticketBriefs: { brief: () => Promise.resolve(undefined) },
    owner,
    monotonicNow: () => 0,
    ...(metrics === undefined ? {} : { metrics }),
  };
}

/** A per-partition fault a port raises, absent for the partitions it spares. */
type FleetFault = (partition: Partition) => Error | undefined;

/**
 * The two-project fleet the containment cases draw, recording every call it is
 * asked so a case can say which ports a failing project did and did not reach.
 */
function recordingFleet(
  calls: string[],
  faults: { readonly acquire?: FleetFault; readonly load?: FleetFault },
): { projects: ProjectStore; discovery: ProjectDiscovery } {
  const projects = {
    acquire: (held: Partition) => {
      calls.push(`acquire:${held.project}`);
      const fault = faults.acquire?.(held);
      return fault === undefined
        ? Promise.resolve({
            acquired: "Granted",
            lease: { ...lease, partition: held },
          })
        : Promise.reject(fault);
    },
    release: (held: Lease) => {
      calls.push(`release:${held.partition.project}`);
      return Promise.resolve();
    },
    load: (held: Lease) => {
      const fault = faults.load?.(held.partition);
      return fault === undefined
        ? Promise.resolve({ parsed: "Ok", value: [] })
        : Promise.reject(fault);
    },
  } as unknown as ProjectStore;
  const discovery = {
    ready: () =>
      Promise.resolve([
        { partition: poisoned, generation: 1 },
        { partition: healthy, generation: 1 },
      ]),
    next: () => Promise.resolve(undefined),
    clearReadiness: (readiness: Readiness) => {
      calls.push(`clear:${readiness.partition.project}`);
      return Promise.resolve({ cleared: "Cleared" });
    },
  } as unknown as ProjectDiscovery;
  return { projects, discovery };
}

/** The fault that poisons one partition and spares every other. */
function poisonedBy(message: string): FleetFault {
  return (candidate) =>
    candidate.project === poisoned.project ? new Error(message) : undefined;
}

test("one pass leases each discovered project and releases it after idle", async () => {
  const calls: string[] = [];
  const projects: ProjectStore = {
    currentRecoveryEpoch: () => Promise.resolve(recoveryEpoch),
    establishRecoveryEpoch: () => Promise.resolve(recoveryEpoch),
    createProject: () => unreachablePromise(),
    standing: () => unreachablePromise(),
    acquire: (_partition, _owner, seconds) => {
      calls.push(`acquire:${String(seconds)}`);
      return Promise.resolve({ acquired: "Granted", lease });
    },
    renew: () => unreachablePromise(),
    release: () => {
      calls.push("release");
      return Promise.resolve();
    },
    load: () => Promise.resolve({ parsed: "Ok", value: [] }),
    fence: () => unreachablePromise(),
  };
  const discovery: ProjectDiscovery = {
    ready: (maximum) => {
      calls.push(`ready:${String(maximum)}`);
      return Promise.resolve([{ partition, generation: 1 }]);
    },
    next: () => Promise.resolve(undefined),
    clearReadiness: () => {
      calls.push("clear");
      return Promise.resolve({ cleared: "Cleared" });
    },
  };

  assert.deepEqual(
    await ticketServiceRunOnce(passService(projects, discovery), {
      projectsPerPassMax: 4,
      projectLeaseSeconds: 10,
    }),
    { discovered: 1, activated: 1, failed: 0, failures: [] },
  );
  assert.deepEqual(calls, ["ready:4", "acquire:10", "clear", "release"]);
});

test("a project held by another writer is discovered but not activated", async () => {
  const projects = {
    acquire: () => Promise.resolve({ acquired: "HeldByAnother", owner }),
  } as unknown as ProjectStore;
  const discovery = {
    ready: () => Promise.resolve([{ partition, generation: 1 }]),
  } as unknown as ProjectDiscovery;

  assert.deepEqual(
    await ticketServiceRunOnce(passService(projects, discovery), {
      projectsPerPassMax: 1,
      projectLeaseSeconds: 10,
    }),
    {
      discovered: 1,
      activated: 0,
      failed: 0,
      failures: [],
      resumeAfter: partition,
    },
  );
});

test("a project whose journal cannot be loaded is counted failed and the next is still activated", async () => {
  const calls: string[] = [];
  const fleet = recordingFleet(calls, {
    load: poisonedBy("journal is illegal to replay"),
  });

  assert.deepEqual(
    await ticketServiceRunOnce(passService(fleet.projects, fleet.discovery), {
      projectsPerPassMax: 4,
      projectLeaseSeconds: 10,
    }),
    {
      discovered: 2,
      activated: 1,
      failed: 1,
      failures: [
        {
          partition: poisoned,
          reason: "ActivationFailed",
          message: "journal is illegal to replay",
        },
      ],
    },
  );
  assert.deepEqual(calls, [
    "acquire:poisoned",
    "release:poisoned",
    "acquire:healthy",
    "clear:healthy",
    "release:healthy",
  ]);
});

test("a project whose lease cannot be acquired is counted failed and never released", async () => {
  const calls: string[] = [];
  const fleet = recordingFleet(calls, {
    acquire: poisonedBy("lease table is unreachable"),
  });

  assert.deepEqual(
    await ticketServiceRunOnce(passService(fleet.projects, fleet.discovery), {
      projectsPerPassMax: 4,
      projectLeaseSeconds: 10,
    }),
    {
      discovered: 2,
      activated: 1,
      failed: 1,
      failures: [
        {
          partition: poisoned,
          reason: "AcquisitionFailed",
          message: "lease table is unreachable",
        },
      ],
    },
  );
  assert.deepEqual(calls, [
    "acquire:poisoned",
    "acquire:healthy",
    "clear:healthy",
    "release:healthy",
  ]);
});

test("a contained failure reaches the metrics sink as a closed reason", async () => {
  const reasons: string[] = [];
  const metrics: TicketServiceMetrics = {
    ...silentTicketServiceMetrics,
    projectFailed: (reason) => {
      reasons.push(reason);
    },
  };
  const projects = {
    acquire: () => Promise.resolve({ acquired: "Granted", lease }),
    release: () => Promise.resolve(),
    load: () => Promise.reject(new Error("journal is illegal to replay")),
  } as unknown as ProjectStore;
  const discovery = {
    ready: () => Promise.resolve([{ partition, generation: 1 }]),
  } as unknown as ProjectDiscovery;

  const report = await ticketServiceRunOnce(
    passService(projects, discovery, metrics),
    { projectsPerPassMax: 4, projectLeaseSeconds: 10 },
  );

  assert.deepEqual(reasons, ["ActivationFailed"]);
  assert.equal(report.failed, 1);
  assert.deepEqual(report.failures, [
    {
      partition,
      reason: "ActivationFailed",
      message: "journal is illegal to replay",
    },
  ]);
});

test("a lease the pass cannot release is reported without unsaying the activation", async () => {
  const projects = {
    acquire: () => Promise.resolve({ acquired: "Granted", lease }),
    release: () => Promise.reject(new Error("lease row is gone")),
    load: () => Promise.resolve({ parsed: "Ok", value: [] }),
  } as unknown as ProjectStore;
  const discovery = {
    ready: () => Promise.resolve([{ partition, generation: 1 }]),
    next: () => Promise.resolve(undefined),
    clearReadiness: () => Promise.resolve({ cleared: "Cleared" }),
  } as unknown as ProjectDiscovery;

  assert.deepEqual(
    await ticketServiceRunOnce(passService(projects, discovery), {
      projectsPerPassMax: 4,
      projectLeaseSeconds: 10,
    }),
    {
      discovered: 1,
      activated: 1,
      failed: 0,
      failures: [
        { partition, reason: "ReleaseFailed", message: "lease row is gone" },
      ],
    },
  );
});

test("a turn that fails and then cannot release reports both, neither masking the other", async () => {
  const projects = {
    acquire: () => Promise.resolve({ acquired: "Granted", lease }),
    release: () => Promise.reject(new Error("lease row is gone")),
    load: () => Promise.reject(new Error("journal is illegal to replay")),
  } as unknown as ProjectStore;
  const discovery = {
    ready: () => Promise.resolve([{ partition, generation: 1 }]),
  } as unknown as ProjectDiscovery;

  assert.deepEqual(
    await ticketServiceRunOnce(passService(projects, discovery), {
      projectsPerPassMax: 4,
      projectLeaseSeconds: 10,
    }),
    {
      discovered: 1,
      activated: 0,
      failed: 1,
      failures: [
        {
          partition,
          reason: "ActivationFailed",
          message: "journal is illegal to replay",
        },
        { partition, reason: "ReleaseFailed", message: "lease row is gone" },
      ],
    },
  );
});

test("projects that fail every pass cannot hold the discovery window against a healthy one", async () => {
  const fleet = [
    { tenant: asTenantId("tenant"), project: asProjectId("a-poisoned") },
    { tenant: asTenantId("tenant"), project: asProjectId("b-poisoned") },
    { tenant: asTenantId("tenant"), project: asProjectId("c-healthy") },
  ];
  const activated: string[] = [];
  const projects = {
    acquire: (held: Partition) =>
      Promise.resolve({
        acquired: "Granted",
        lease: { ...lease, partition: held },
      }),
    release: () => Promise.resolve(),
    load: (held: Lease) =>
      held.partition.project.endsWith("poisoned")
        ? Promise.reject(new Error("journal is illegal to replay"))
        : Promise.resolve({ parsed: "Ok", value: [] }),
  } as unknown as ProjectStore;
  const discovery = {
    ready: (partitionsMax: number, after?: Partition) =>
      Promise.resolve(
        fleet
          .filter((one) => after === undefined || one.project > after.project)
          .slice(0, partitionsMax)
          .map((one) => ({ partition: one, generation: 1 })),
      ),
    next: () => Promise.resolve(undefined),
    clearReadiness: (readiness: Readiness) => {
      activated.push(readiness.partition.project);
      return Promise.resolve({ cleared: "Cleared" });
    },
  } as unknown as ProjectDiscovery;
  const service = passService(projects, discovery);
  const runtimeConfig = { projectsPerPassMax: 2, projectLeaseSeconds: 10 };

  const first = await ticketServiceRunOnce(service, runtimeConfig);
  assert.deepEqual(
    { activated: first.activated, failed: first.failed },
    { activated: 0, failed: 2 },
  );
  assert.deepEqual(activated, []);

  const second = await ticketServiceRunOnce(
    service,
    runtimeConfig,
    first.resumeAfter,
  );
  assert.deepEqual(
    { activated: second.activated, failed: second.failed },
    { activated: 1, failed: 0 },
  );
  assert.deepEqual(activated, ["c-healthy"]);
  assert.equal(second.resumeAfter, undefined);
});

/** An input as the inbox hands one over: the envelope, and the command the map built from it. */
function arriving(
  ordinal: number,
  ticketCommand: TicketCommand,
  command: StoredProjectCommand,
): DecisionInput {
  return {
    partition,
    ordinal,
    deferredPasses: 0,
    priority: "Completion",
    source: {
      kind: "Operation",
      operation: asOperationId(`operation-${String(ordinal)}`),
      command,
      ticketCommand,
      ...(command.command === "SubmitFinalizationResult"
        ? {
            finalizationRequest: {
              request: command.request,
              requestGeneration: command.requestGeneration,
              open: true,
            },
          }
        : {}),
    },
  };
}

/** A scheduler completion, whose envelope carries the report it builds. */
function completing(
  ordinal: number,
  report: TaskTerminalReport,
): DecisionInput {
  const ticketCommand = { type: "ReportTaskTerminal", value: report } as const;
  return arriving(ordinal, reportTaskTerminalCommand(report), {
    version: 1,
    command: "Decide",
    ticketCommand,
  });
}

/** One project whose journal holds what `commands` journal, and whose inbox hands over `inbox` in order. */
function projectHolding(
  commands: Parameters<typeof journalStep>[2][],
  inbox: DecisionInput[],
): { projects: ProjectStore; discovery: ProjectDiscovery } {
  const journaled = commands.reduce(
    (state, command) =>
      journalStep(refinementInstance, state, command, plainPolicy),
    actorInit(),
  );
  const loaded = { ...lease, head: journaled.journal.length };
  const projects = {
    acquire: () => Promise.resolve({ acquired: "Granted", lease: loaded }),
    release: () => Promise.resolve(),
    load: () =>
      Promise.resolve({
        parsed: "Ok",
        value: storedAtCurrentSemantics(journaled.journal),
      }),
  } as unknown as ProjectStore;
  const discovery = {
    ready: () => Promise.resolve([{ partition, generation: 1 }]),
    next: () => Promise.resolve(inbox.shift()),
    clearReadiness: () => Promise.resolve({ cleared: "Cleared" }),
  } as unknown as ProjectDiscovery;
  return { projects, discovery };
}

/** One project whose journal holds a dispatched ticket, and whose inbox hands over `inbox` in order. */
function dispatchedProject(inbox: DecisionInput[]): {
  projects: ProjectStore;
  discovery: ProjectDiscovery;
} {
  return projectHolding(
    [
      createTicketCommand(plainDefinitionOf(1)),
      dispatchTicketCommand(id(1), aDispatchSource),
    ],
    inbox,
  );
}

/**
 * One pass carries a dispatched ticket through Work and Evaluation to Done:
 * every input the inbox hands over is decided and committed, and each commit
 * moves the ticket to the next phase.
 */
test("one pass carries a dispatched ticket from Work through Evaluation to Done", async () => {
  const { projects, discovery } = dispatchedProject([
    completing(1, producedReport(workTaskIdentity(1, 1))),
    completing(
      2,
      judgedReport(evaluationTaskOf(1, 1, 1, 1, 1), "EvaluatorPass"),
    ),
    arriving(
      3,
      reportFinalizationResultCommand(id(1), 1, 1, {
        type: "FinalizationSucceeded",
        value: 1,
      }),
      {
        version: 1,
        command: "SubmitFinalizationResult",
        request: "request",
        attempt: "attempt",
        requestGeneration: 1,
        recoveryEpoch: "epoch",
        outcome: "FinalizationSucceeded",
      },
    ),
  ]);
  const committed: Decision[] = [];
  const decisions: ProjectDecision = {
    decide: (decision) => {
      committed.push(decision);
      return Promise.resolve({
        decided: "Committed",
        lease: { ...decision.lease, head: decision.lease.head + 1 },
      });
    },
  };
  assert.deepEqual(
    await ticketServiceRunOnce(
      {
        ...passService(projects, discovery),
        domain: refinementInstance,
        decisions,
        executionSources: {
          ...executionSources,
          spawnSource: () => Promise.resolve(undefined),
        },
      },
      { projectsPerPassMax: 4, projectLeaseSeconds: 10 },
    ),
    { discovered: 1, activated: 1, failed: 0, failures: [] },
  );
  assert.deepEqual(
    committed.map((decision) =>
      decision.outcome.outcome === "Journaled"
        ? decision.outcome.projection.map((row) => row.phase)
        : decision.outcome.outcome,
    ),
    [["Evaluation"], ["Finalization"], ["Done"]],
  );
});

/** One project whose journal holds `ticket` released and Pending, and whose inbox hands over `inbox` in order. */
function releasedProject(inbox: DecisionInput[]): {
  projects: ProjectStore;
  discovery: ProjectDiscovery;
} {
  return projectHolding([createTicketCommand(plainDefinitionOf(1))], inbox);
}

/** The ticket's second revision, which is what an update of it resolves. */
const updated = revisedTicketOf(
  1,
  2,
  plainDefinitionOf(1).dependencies,
  plainDefinitionOf(1).evaluationPlan.stages,
);

/** An update of ticket 1 from its first revision to `updated`, through the fence its draft reopened at. */
function updating(ordinal: number): DecisionInput {
  const input = arriving(ordinal, updateTicketCommand(id(1), 1, updated), {
    version: 1,
    command: "UpdateTicket",
    ticket: id(1),
    expectedRevision: 1,
    authoringVersion: 2,
    configurationRevision: "revision-updated",
  });
  return {
    ...input,
    source: {
      ...input.source,
      draftRelease: {
        release: "Update",
        ticket: 1,
        authoringVersion: 2,
        configurationRevision: "revision-updated",
        configurationDigest: "digest-updated",
        configurationCanonical: "{}",
      },
    },
  };
}

/** A work result carried at the task definition `definition` rather than the one the fixture releases. */
function workedAt(definition: TaskDefinition): TaskTerminalReport {
  const task = workTaskIdentity(1, 1);
  return {
    type: "WorkResultReport",
    value: {
      ticket: 1,
      result: {
        ...resultFor(task),
        obligation: { ...obligationFor(task), definition },
      },
      acceptedSourceRef: anAcceptedSource,
    },
  };
}

/** A store that commits what journals and refuses what does not, recording each decision it is handed. */
function recordedDecisions(committed: Decision[]): ProjectDecision {
  return {
    decide: (decision) => {
      committed.push(decision);
      return Promise.resolve(
        decision.outcome.outcome === "Journaled"
          ? {
              decided: "Committed",
              lease: { ...decision.lease, head: decision.lease.head + 1 },
            }
          : { decided: "Refused" },
      );
    },
  };
}

/**
 * An update then a dispatch runs what the update released: the ticket moves to
 * its next revision under the configuration the update pinned, and the work it
 * is dispatched to is owed at the updated definition, so a result carried at
 * the one it was first released with is not the work it owes.
 */
test("an update then a dispatch runs the updated definition", async () => {
  const { projects, discovery } = releasedProject([
    updating(1),
    arriving(2, dispatchTicketCommand(id(1), aDispatchSource), {
      version: 1,
      command: "ManualDispatch",
      ticket: id(1),
      expectedTicketVersion: 2,
    }),
    completing(3, producedReport(workTaskIdentity(1, 1))),
    completing(4, workedAt(updated.workConfiguration)),
  ]);
  const committed: Decision[] = [];
  assert.deepEqual(
    await ticketServiceRunOnce(
      {
        ...passService(projects, discovery),
        domain: refinementInstance,
        decisions: recordedDecisions(committed),
        executionSources: {
          observe: () =>
            Promise.resolve({
              observed: "Source",
              source: { reference: aDispatchSource },
            }),
          spawnSource: () => Promise.resolve(undefined),
        },
      },
      { projectsPerPassMax: 4, projectLeaseSeconds: 10 },
    ),
    { discovered: 1, activated: 1, failed: 0, failures: [] },
  );
  assert.deepEqual(
    committed.map((decision) =>
      decision.outcome.outcome === "Journaled"
        ? [
            decision.outcome.entry.event.type,
            decision.outcome.projection.map(
              (row) => `${row.phase}@${String(row.revision)}`,
            ),
          ]
        : decision.outcome.outcome,
    ),
    [
      ["TicketUpdated", ["Pending@2"]],
      ["TicketDispatched", ["Work@2"]],
      "Refused",
      ["TicketWorkResultAccepted", ["Evaluation@2"]],
    ],
  );
  const [update] = committed;
  assert.deepEqual(
    update?.outcome.outcome === "Journaled"
      ? update.outcome.dispatchView?.candidates.map(
          (candidate) => candidate.configurationRevision,
        )
      : undefined,
    ["revision-updated"],
    "the update re-pins the configuration its next dispatch runs at",
  );
});
