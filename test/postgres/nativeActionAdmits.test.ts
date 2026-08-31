/**
 * What a park offers the desk, driven through the real writer and read back
 * through the public read.
 *
 * NOTHING IS SEEDED HERE. The park this case asserts about is one a real
 * decision raised at the gas a real trace left it, and the answers come off the
 * `native_action_resolution` rows that decision wrote — so a set that no longer
 * matches the enablement is two live paths disagreeing rather than a fixture
 * disagreeing with a rule.
 *
 * THE TICKET IS DRIVEN PAST AN AFFORDABLE PARK INTO AN UNAFFORDABLE ONE,
 * because a case that only ever saw the second would pass just as well against
 * a plan that offers the revoke and nothing else. The resume answered in
 * between is also the charge that empties the account, and the rework it
 * re-enters is what walls the ticket a second time with nothing left to spend.
 *
 * THE HANDOFF HOLD IS NOT REACHED HERE. A publication request is materialized
 * only for a project whose configuration carries a whole handoff shape, so
 * `HandoffBlocked` needs that slice's fixture rather than this one's — the hold
 * is driven through the real journal by `test/interpreter/i3.test.ts`, and what
 * this tier adds for it is `nativeReads.test.ts` serving a hold that recorded
 * the abandon alone.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { taskDoneEvent } from "../../src/actor/decisionEvent.ts";
import { postgresNativeReads } from "../../src/adapters/postgres/nativeReads.ts";
import { ticketAt } from "../../src/domain/core.ts";
import type { Verdict } from "../../src/domain/generated/modelTypes.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import type { NativeActionResolution } from "../../src/interpreter/ticketCommand.ts";
import { plainResult } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
import {
  postgresHarnessCompletion,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessProject,
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

/** The answers the public read says the ticket's open actions admit, in listed order. */
async function admitsOffered(
  partition: Partition,
): Promise<readonly (readonly NativeActionResolution[])[]> {
  const open = await postgresNativeReads(subject.pool).ticketNativeActions(
    partition,
    id(1),
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

test("a park offers the resume only while the ticket can pay for it", async () => {
  const label = "admits-affordability";
  const partition = await postgresHarnessProject(subject.harness.store, label);
  let memory = await postgresHarnessHistory(
    subject.harness,
    partition,
    label,
    postgresHarnessJournal().length,
  );
  memory = await admitsReport(partition, memory, `${label}-work`, 1, "Pass");
  memory = await admitsReport(partition, memory, `${label}-eval`, 2, "Fail");
  memory = await admitsReport(partition, memory, `${label}-rework`, 3, "Pass");
  memory = await admitsReport(partition, memory, `${label}-park`, 4, "Fail");

  const parked = ticketAt(memory.core, id(1));
  assert.equal(parked.phase, "Escalated");
  assert.equal(parked.reason, "ReworkBudgetExhausted");
  assert.equal(parked.resumeAt, "ResumeReworking");
  assert.ok(parked.gasLeft > 0);
  assert.deepEqual(await admitsOffered(partition), [["Resume", "Revoke"]]);

  memory = await admitsResolve(partition, memory, `${label}-resume`, "Resume");
  memory = await admitsReport(partition, memory, `${label}-again`, 5, "Fail");

  const spent = ticketAt(memory.core, id(1));
  assert.equal(spent.phase, "Escalated");
  assert.equal(spent.reason, "WorkFailed");
  assert.equal(spent.resumeAt, "ResumeWorking");
  assert.equal(spent.gasLeft, 0);
  assert.deepEqual(await admitsOffered(partition), [["Revoke"]]);
});
