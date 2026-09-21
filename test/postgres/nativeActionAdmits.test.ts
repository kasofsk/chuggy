/**
 * What a park offers the desk, driven through the real writer and read back
 * through the public read.
 *
 * NOTHING IS SEEDED HERE. The parks these cases assert about are ones real
 * decisions raised, and the answers come off the `native_action_resolution`
 * rows those decisions wrote — so a set that no longer matches the enablement
 * is two live paths disagreeing rather than a fixture disagreeing with a rule.
 *
 * ONE PARK THAT PUTS A QUESTION TO THE DESK AND ONE TICKET THAT IS ASKED
 * NOTHING, because a case that only ever saw the first would pass just as well
 * against a plan that opened an action for every ticket. The first is the
 * rework wall, which the writer's configured cap reaches on the third failed
 * evaluation; the second is the dependent of the ticket that answer revokes,
 * which simply stays Pending and waits on a dependency nothing will complete.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { taskDoneEvent } from "../../src/actor/decisionEvent.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import type { Verdict } from "../../src/domain/generated/modelTypes.ts";
import { asTaskId, type TicketId } from "../../src/domain/ids.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import type { NativeActionResolution } from "../../src/interpreter/ticketCommand.ts";
import { plainAuthoring, plainResult } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
import {
  postgresHarnessCompletion,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessProject,
  postgresHarnessReleaseSubmission,
  postgresHarnessSubmission,
  postgresHarnessWriter,
} from "./harness.ts";
import { postgresReadHarness } from "./readHarness.ts";

const subject = postgresReadHarness();

/** The most decisions one reported task can enqueue, which bounds every drain below. */
const admitsDecisionsMax = 8;

/** Decides everything the project's queue holds, which is how a continuation reaches its writer. */
async function admitsDrain(
  partition: Partition,
  memory: ProjectMemory,
): Promise<ProjectMemory> {
  const writer = postgresHarnessWriter(subject.harness);
  let carried = memory;
  for (let drained = 0; drained < admitsDecisionsMax; drained++) {
    const input = await subject.harness.discovery.next(partition, 300);
    if (input === undefined) return carried;
    const step = await projectWriterDecide(writer, carried, input);
    if (step.decided.decided !== "Committed") {
      throw new Error(
        `native admits case: a decision was ${step.decided.decided}`,
      );
    }
    carried = step.memory;
  }
  throw new Error("native admits case: the project queue did not drain");
}

/** Reports one task the way the scheduler does, and decides everything it enqueues. */
async function admitsReport(
  partition: Partition,
  memory: ProjectMemory,
  label: string,
  task: number,
  verdict: Verdict,
): Promise<ProjectMemory> {
  await postgresHarnessCompletion(
    subject.harness,
    partition,
    `operation-${label}-${randomUUID()}`,
    taskDoneEvent(id(1), asTaskId(task), verdict, plainResult),
  );
  return admitsDrain(partition, memory);
}

/** The answers the public read says a ticket's open actions admit, in listed order. */
async function admitsOffered(
  partition: Partition,
  ticket: TicketId,
): Promise<readonly (readonly NativeActionResolution[])[]> {
  const open = await postgresNativeReads(subject.pool).ticketNativeActions(
    partition,
    ticket,
  );
  if (open === undefined)
    throw new Error("native admits case: the ticket has no projection");
  return open.map((action) => action.admits);
}

/** Answers the ticket's one open action at the fence the read named. */
async function admitsResolve(
  partition: Partition,
  memory: ProjectMemory,
  label: string,
  resolution: NativeActionResolution,
): Promise<ProjectMemory> {
  const open = (
    await postgresNativeReads(subject.pool).ticketNativeActions(
      partition,
      id(1),
    )
  )?.[0];
  if (open === undefined)
    throw new Error("native admits case: the ticket has no open action");
  const accepted = await subject.harness.inbox.accept({
    ...postgresHarnessSubmission(partition, label),
    command: {
      version: 1,
      command: "ResolveNativeAction",
      action: open.action,
      authorizingSeq: open.authorizingSequence,
      resolution,
    },
  });
  if (accepted.accepted !== "Accepted")
    throw new Error(`native admits case: the answer was ${accepted.accepted}`);
  return admitsDrain(partition, memory);
}

/** Releases a second ticket waiting on the first, which the first's revoke strands. */
async function admitsDependent(
  partition: Partition,
  memory: ProjectMemory,
  label: string,
): Promise<ProjectMemory> {
  const accepted = await subject.harness.inbox.accept(
    await postgresHarnessReleaseSubmission(subject.harness, partition, label, {
      ...plainAuthoring,
      deps: new Set<number>([1]),
    }),
  );
  if (accepted.accepted !== "Accepted")
    throw new Error(`native admits case: the release was ${accepted.accepted}`);
  return admitsDrain(partition, memory);
}

test("a park offers the desk its answers and a waiting ticket is asked none", async () => {
  const label = "admits-resumability";
  const partition = await postgresHarnessProject(subject.harness.store, label);
  let memory = await postgresHarnessHistory(
    subject.harness,
    partition,
    label,
    postgresHarnessJournal().length,
  );
  for (const [task, verdict] of [
    [1, "Pass"],
    [2, "Fail"],
    [3, "Pass"],
    [4, "Fail"],
    [5, "Pass"],
    [6, "Fail"],
  ] as const) {
    memory = await admitsReport(
      partition,
      memory,
      `${label}-${String(task)}`,
      task,
      verdict,
    );
  }

  const walled = ticketAt(memory.graph, id(1));
  assert.equal(walled.phase, "Escalated");
  assert.equal(walled.escalation, "EvaluationFailureEscalated");
  assert.deepEqual(await admitsOffered(partition, id(1)), [
    ["Resume", "Revoke"],
  ]);

  memory = await admitsDependent(partition, memory, `${label}-dependent`);
  memory = await admitsResolve(partition, memory, `${label}-revoke`, "Revoke");

  const stranded = ticketAt(memory.graph, id(2));
  assert.equal(stranded.phase, "Pending");
  assert.equal(stranded.escalation, "NoEscalation");
  assert.deepEqual(await admitsOffered(partition, id(2)), []);
});
