import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  commandSubject,
  reportTaskTerminalCommand,
  type TicketCommand,
} from "../../src/actor/command.ts";
import { decide } from "../../src/domain/deciders.ts";
import type { TicketGraph } from "../../src/domain/generated/modelTypes.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import {
  allNativeActionResolutions,
  isApprovalResolution,
  type ApprovalResolution,
  type NativeActionResolution,
} from "../../src/interpreter/projectCommand.ts";
import {
  graphOf,
  producedReport,
  ticketOn,
  workEscalatedState,
} from "../domain/fixtures.ts";
import { plainPolicy, refinementInstance } from "../actor/harness.ts";
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
    reportTaskTerminalCommand(producedReport(workTaskIdentity(1, 1))),
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
 * an answer no point re-enters is not a state the machine has — and this
 * suite seeds the work wall alone, so that is the one payload built.
 */
function parkedGraph(action: SeededAction): TicketGraph {
  assert.equal(action.escalation, "WorkFailureEscalated");
  const released = ticketOn(refinementInstance, { workCyclesStarted: 1 });
  return graphOf([{ ...released, state: workEscalatedState(released) }]);
}

/**
 * The command one answer names, decided by the answer alone. A settle answer
 * revokes the ticket; every other answer resumes it (`model/domain.qnt`).
 */
function answerNames(
  resolution: Exclude<NativeActionResolution, ApprovalResolution>,
): TicketCommand["type"] {
  return resolution === "Revoke" ? "RevokeTicket" : "ResumeTicket";
}

/**
 * What the mapping may not get wrong. The expectation is read off the answer
 * rather than off the command under test, so a settle answer degraded into a
 * resume is compared against the command it should have named, and `decide`
 * stands behind it refusing a command the park does not offer.
 */
function assertAnswerNames(
  resolution: Exclude<NativeActionResolution, ApprovalResolution>,
  action: SeededAction,
  command: TicketCommand,
): void {
  assert.equal(commandSubject(command), action.ticket, resolution);
  assert.equal(command.type, answerNames(resolution), resolution);
  assert.equal(
    decide(parkedGraph(action), command, plainPolicy).type,
    "TicketDecided",
    `${resolution} named ${command.type}, which its park refuses`,
  );
}

/** The command discovery resolved an accepted answer into, from the one consumable item. */
async function resolvedAnswer(
  partition: Parameters<typeof postgresHarnessSubmission>[0],
): Promise<TicketCommand | undefined> {
  const item = await harness.discovery.next(partition, 300);
  if (item === undefined || item.source.kind !== "Operation")
    throw new Error("readiness case: the answer was not discoverable");
  return item.source.ticketCommand;
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
    const command = await resolvedAnswer(partition);
    assert.ok(command !== undefined, resolution);
    assertAnswerNames(resolution, seeded, command);
  }
});

/**
 * A command this machine no longer has. `ReleaseTicket` became
 * `CreateTicket`, and an undecided operation can outlive the rename still
 * naming it, so discovery is where it is caught — refused at decode, under a
 * message naming the operation.
 */
test("an operation carrying a command this machine lost is refused by name", async () => {
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
        ticketCommand: {
          type: "ReleaseTicket",
          value: { ticket: 1, deps: [], prog: [] },
        },
      }),
    ],
  );
  await assert.rejects(
    () => harness.discovery.next(partition, 300),
    new RegExp(`stored operation ${submission.operation} is unreadable`, "u"),
  );
});
