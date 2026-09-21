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
  type TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import {
  allNativeActionResolutions,
  isApprovalResolution,
  type ApprovalResolution,
  type NativeActionResolution,
} from "../../src/interpreter/ticketCommand.ts";
import { graphOf, id, ticketOn } from "../domain/fixtures.ts";
import { plainResult, refinementInstance } from "../actor/harness.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessCompletion,
  postgresHarnessSubmission,
  type PostgresHarness,
} from "./harness.ts";
import { seedOpenAction, type SeededAction } from "./nativeActionFixture.ts";

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
  const tenant = asTenantId(`tenant-sweep-${randomUUID()}`);
  const swept = ["a", "b", "c"].map((suffix) => ({
    tenant,
    project: asProjectId(`project-sweep-${suffix}`),
  }));
  for (const partition of swept) {
    await harness.store.createProject(partition);
    await harness.inbox.accept(postgresHarnessSubmission(partition, "sweep"));
  }
  const head = swept[0];
  assert.ok(head !== undefined);
  const resumed = await harness.discovery.ready(2, head);
  assert.deepEqual(
    resumed.map((item) => item.partition),
    swept.slice(1),
  );
});

/**
 * The park a seeded escalation stands on, as a `TicketGraph`. The wall is the
 * seed's own and the resume follows from it, so a park this suite could offer
 * an answer no point re-enters is not a state the machine has.
 */
function parkedGraph(action: SeededAction): TicketGraph {
  return graphOf([
    ticketOn(refinementInstance, {
      phase: "Escalated",
      escalation: action.escalation,
    }),
  ]);
}

/**
 * The command one answer names, decided by the answer alone. A settle answer
 * has a decider of its own — `decideRevoke` — so its name is one of the
 * machine's event tags; every other answer routes to `decideResumeTicket`
 * (`model/domain.qnt`).
 */
function answerNames(
  resolution: Exclude<NativeActionResolution, ApprovalResolution>,
): DecisionEvent["type"] {
  return decisionEventTags.find((tag) => tag === resolution) ?? "ResumeTicket";
}

/**
 * What the mapping may not get wrong. The expectation is read off the answer
 * rather than off the event under test, so a settle answer degraded into a
 * resume is compared against the command it should have named, and enablement
 * stands behind it refusing a command the park does not offer.
 */
function assertAnswerNames(
  resolution: Exclude<NativeActionResolution, ApprovalResolution>,
  action: SeededAction,
  event: DecisionEvent,
): void {
  assert.equal(decisionEventSubject(event), action.ticket, resolution);
  assert.equal(event.type, answerNames(resolution), resolution);
  assert.ok(
    decisionEventEnabled(refinementInstance, parkedGraph(action), event),
    `${resolution} named ${event.type}, which its park does not enable`,
  );
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
  for (const resolution of answerable) {
    const label = `resolution-${resolution}`;
    const partition = await postgresHarnessProject(harness.store, label);
    const actionId = `${label}-action`;
    const seeded: SeededAction = {
      ticket: 1,
      sequence: 1,
      escalation: "WorkFailureEscalated",
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
  }
});

/**
 * A command whose event this machine no longer has. `ReleaseTicket` became
 * `CreateTicket`, and an undecided operation can outlive the rename still
 * naming it, so discovery is where it is caught — refused at decode, under a
 * message naming the operation.
 */
test("an operation carrying an event this machine lost is refused by name", async () => {
  const partition = await postgresHarnessProject(harness.store, "lost-event");
  const submission = postgresHarnessSubmission(partition, "lost-event");
  assert.equal((await harness.inbox.accept(submission)).accepted, "Accepted");
  await harness.query(
    `UPDATE operation SET command=$4
      WHERE tenant=$1 AND project=$2 AND operation=$3`,
    [
      partition.tenant,
      partition.project,
      submission.operation,
      JSON.stringify({
        version: 1,
        command: "Decide",
        event: {
          type: "ReleaseTicket",
          value: { ticket: 1, deps: [], prog: [], workFanout: 1 },
        },
      }),
    ],
  );
  await assert.rejects(
    () => harness.discovery.next(partition, 300),
    new RegExp(`stored operation ${submission.operation} is unreadable`, "u"),
  );
});
