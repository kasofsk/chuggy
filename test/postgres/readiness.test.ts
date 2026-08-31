import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  decisionEventEnabled,
  decisionEventSubject,
  taskDoneEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import {
  decisionEventTags,
  type Core,
} from "../../src/domain/generated/modelTypes.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import {
  allNativeActionResolutions,
  isApprovalResolution,
  nativeActionResolutions,
  type ApprovalResolution,
  type NativeActionResolution,
} from "../../src/interpreter/ticketCommand.ts";
import { coreOf, id, ticketOn } from "../domain/fixtures.ts";
import { plainResult, refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessCompletion,
  postgresHarnessSubmission,
  type PostgresHarness,
} from "./harness.ts";
import {
  seedOpenAction,
  seededPhase,
  type SeededAction,
} from "./nativeActionFixture.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

/** One settled task, written the way its boundary writes it rather than offered. */
async function completion(
  partition: Parameters<typeof postgresHarnessSubmission>[0],
  label: string,
): Promise<string> {
  const operation = `operation-${label}`;
  await postgresHarnessCompletion(
    harness,
    partition,
    operation,
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
  );
  return operation;
}

test("the bounded class-head query chooses completion before ordinary", async () => {
  const partition = await postgresHarnessProject(harness.store, "priority");
  const ordinary = postgresHarnessSubmission(partition, "priority-ordinary");
  await harness.inbox.accept(ordinary);
  const done = await completion(partition, "priority-completion");
  const next = await harness.discovery.next(partition, 300);
  assert.equal(next?.source.kind, "Operation");
  assert.equal(
    next?.source.kind === "Operation" ? next.source.operation : undefined,
    done,
  );
});

test("database-time aging eventually puts old ordinary work ahead", async () => {
  const partition = await postgresHarnessProject(harness.store, "aging");
  const ordinary = postgresHarnessSubmission(partition, "aging-ordinary");
  await harness.inbox.accept(ordinary);
  await completion(partition, "aging-completion");
  await harness.query(
    `UPDATE decision_input SET created_at=created_at-interval '20 minutes'
      WHERE tenant=$1 AND project=$2 AND input_id=$3`,
    [partition.tenant, partition.project, ordinary.operation],
  );
  const next = await harness.discovery.next(partition, 300);
  assert.equal(
    next?.source.kind === "Operation" ? next.source.operation : undefined,
    ordinary.operation,
  );
});

test("readiness clears only when no pending input remains", async () => {
  const partition = await postgresHarnessProject(harness.store, "ready-clear");
  const submission = postgresHarnessSubmission(partition, "ready-clear");
  await harness.inbox.accept(submission);
  const readiness = (await harness.discovery.ready(100)).find(
    (item) => item.partition.project === partition.project,
  );
  assert.ok(readiness !== undefined);
  assert.deepEqual(await harness.discovery.clearReadiness(readiness), {
    cleared: "WorkRemains",
  });
});

test("ready breaks the cursor on the project when one tenant holds both", async () => {
  const tenant = asTenantId(`tenant-shared-${randomUUID()}`);
  const first = { tenant, project: asProjectId("project-shared-a") };
  const second = { tenant, project: asProjectId("project-shared-b") };
  for (const partition of [first, second]) {
    await harness.store.createProject(partition);
    await harness.inbox.accept(postgresHarnessSubmission(partition, "shared"));
  }
  const resumed = (await harness.discovery.ready(100, first)).map(
    (item) => item.partition.project,
  );
  assert.ok(!resumed.includes(first.project));
  assert.ok(resumed.includes(second.project));
});

test("ready resumes strictly after the cursor it is given", async () => {
  for (const label of ["sweep-one", "sweep-two"]) {
    const partition = await postgresHarnessProject(harness.store, label);
    await harness.inbox.accept(postgresHarnessSubmission(partition, label));
  }
  const swept = await harness.discovery.ready(100);
  assert.ok(swept.length >= 2);
  const head = swept[0];
  assert.ok(head !== undefined);
  const resumed = await harness.discovery.ready(100, head.partition);
  assert.deepEqual(
    resumed.map((item) => item.partition.project),
    swept.slice(1).map((item) => item.partition.project),
  );
});

/**
 * The park a seeded desk task stands on, as a `Core`, at the gas a case hands
 * it. The phase and the wall are the seed's own; the resume point and its
 * pricing are this suite's, because the projection carries neither, and they
 * are what the two resume answers below turn on.
 */
function parkedCore(action: SeededAction, gasLeft: number): Core {
  return coreOf([
    ticketOn(refinementInstance, "ManagedFinalizer", {
      phase: seededPhase(action.kind),
      reason: action.reason,
      resumeAt:
        action.kind === "HandoffBlock"
          ? "ResumePublishingHandoff"
          : "ResumeWorking",
      resumePricing: "RetryCharged",
      gasLeft,
    }),
  ]);
}

/**
 * The command one answer names, decided by the answer alone. A settle answer
 * has a decider of its own — `decideRevoke`, `decideAbandonHandoff` — so its
 * name is one of the machine's event tags; every other answer routes to
 * `decideResumeTicket` (`model/domain.qnt`).
 */
function answerNames(
  resolution: Exclude<NativeActionResolution, ApprovalResolution>,
): DecisionEvent["type"] {
  return decisionEventTags.find((tag) => tag === resolution) ?? "ResumeTicket";
}

/**
 * What the mapping may not get wrong. The expectation is read off the answer
 * rather than off the event under test, so a settle answer degraded into a
 * resume is compared against the command it should have named; the two
 * enablement questions stand behind it, refusing a command the park does not
 * offer and a resume the gas does not gate.
 */
function assertAnswerNames(
  resolution: Exclude<NativeActionResolution, ApprovalResolution>,
  action: SeededAction,
  event: DecisionEvent,
): void {
  const named = answerNames(resolution);
  assert.equal(decisionEventSubject(event), action.ticket, resolution);
  assert.equal(event.type, named, resolution);
  assert.ok(
    decisionEventEnabled(refinementInstance, parkedCore(action, 1), event),
    `${resolution} named ${event.type}, which its park does not enable`,
  );
  assert.equal(
    decisionEventEnabled(refinementInstance, parkedCore(action, 0), event),
    named !== "ResumeTicket",
    `${resolution} answered a spent park with ${event.type}`,
  );
}

/** Which desk task asks for one answer, read off the contract's own pairing. */
function resolutionKind(
  resolution: NativeActionResolution,
): SeededAction["kind"] {
  const asking = (["TicketEscalation", "HandoffBlock"] as const).find((kind) =>
    nativeActionResolutions[kind].some((each) => each === resolution),
  );
  if (asking === undefined)
    throw new Error(`readiness case: no desk task asks for ${resolution}`);
  return asking;
}

/** The event discovery resolved an accepted answer into, from the one consumable item. */
async function resolvedAnswer(
  partition: Parameters<typeof postgresHarnessSubmission>[0],
): Promise<DecisionEvent | undefined> {
  const item = await harness.discovery.next(partition, 300);
  if (item === undefined || item.source.kind !== "Operation")
    throw new Error("readiness case: the answer was not discoverable");
  return item.source.resolvedEvent;
}

test("every answer a desk task admits becomes the domain command it names", async () => {
  const answerable = allNativeActionResolutions.filter(
    (
      resolution,
    ): resolution is Exclude<NativeActionResolution, ApprovalResolution> =>
      !isApprovalResolution(resolution),
  );
  const asked = new Set<string>();
  for (const resolution of answerable) {
    const label = `resolution-${resolution}`;
    const partition = await postgresHarnessProject(harness.store, label);
    const actionId = `${label}-action`;
    const kind = resolutionKind(resolution);
    const seeded: SeededAction = {
      ticket: 1,
      sequence: 1,
      kind,
      reason: kind === "HandoffBlock" ? "NoReason" : "WorkFailed",
      offers: [resolution],
    };
    await seedOpenAction(harness, partition, actionId, seeded);
    const accepted = await harness.inbox.accept({
      ...postgresHarnessSubmission(partition, label),
      command: {
        version: 1,
        command: "ResolveNativeAction",
        action: actionId,
        authorizingSeq: seeded.sequence,
        resolution,
      },
    });
    assert.equal(accepted.accepted, "Accepted", resolution);
    const event = await resolvedAnswer(partition);
    assert.ok(event !== undefined, resolution);
    assertAnswerNames(resolution, seeded, event);
    asked.add(kind);
  }
  assert.deepEqual(
    [...asked].sort(),
    ["HandoffBlock", "TicketEscalation"],
    "the answers this case drove did not reach both parked desk tasks",
  );
});
