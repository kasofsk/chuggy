/**
 * The task plumbing, the effect vocabulary and the rank ladder, at the level
 * the golden corpus cannot reach: a boundary condition it never happens to
 * produce is still a boundary condition.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evalStage,
  nextTaskId,
  resolveTask,
  retiredInIdOrder,
  outstandingCount,
  spawnTasks,
  tasksInIdOrder,
  taskPassed,
  evaluationFailureReworksStarted,
  tkEval,
  tkWork,
  tsResolved,
  tsOutstanding,
} from "../../src/domain/task.ts";
import {
  asTaskId,
  asTicketId,
  asSafeInteger,
  firstTaskId,
} from "../../src/domain/ids.ts";
import {
  allEffects,
  effectFromLabel,
  effectLabel,
} from "../../src/domain/effect.ts";
import { isSettled } from "../../src/domain/phase.ts";
import { combine } from "../../src/domain/program.ts";
import {
  spawnOn,
  retireLive,
  hasOpenHumanTask,
} from "../../src/domain/ticket.ts";
import {
  phaseTags,
  type Phase,
  type Task,
  type TaskKind,
  type TaskOutcome,
  type TaskState,
  type Ticket,
} from "../../src/domain/generated/modelTypes.ts";

const bare: Ticket = {
  phase: "Pending",
  deps: new Set(),
  finalizer: "NoFinalizer",
  artifact: "NoArtifact",
  workFanout: 1,
  program: [],
  tasks: new Set(),
  record: [],
  spawned: 0,
  resumeAt: "NoResume",
  reason: "NoReason",
  completions: 0,
};

test("a spawned set is outstanding, contiguous and starts where it was told", () => {
  const tasks = spawnTasks(tkWork, asTaskId(3), 2);
  assert.deepEqual(
    tasksInIdOrder(tasks).map((t) => t.id),
    [3, 4],
  );
  assert.equal(outstandingCount(tasks), 2);
});

test("spawning zero tasks yields no tasks rather than a task", () => {
  assert.equal(spawnTasks(tkWork, firstTaskId, 0).size, 0);
});

test("the next id counts every id ever issued, retired or live", () => {
  assert.equal(nextTaskId(0, 0), firstTaskId);
  assert.equal(nextTaskId(3, 2), 6);
});

test("first write wins, so a duplicate delivery changes nothing", () => {
  const spawned = spawnTasks(tkWork, firstTaskId, 1);
  const once = resolveTask(spawned, firstTaskId, "Passed");
  const twice = resolveTask(once, firstTaskId, "Failed");
  assert.deepEqual([...twice], [...once]);
  const resolved = tasksInIdOrder(twice)[0];
  assert.ok(resolved, "the fixture spawned one task");
  assert.ok(taskPassed(resolved));
});

test("resolving an id that is not there changes nothing", () => {
  const spawned = spawnTasks(tkWork, firstTaskId, 1);
  assert.deepEqual(
    [...resolveTask(spawned, asTaskId(99), "Passed")],
    [...spawned],
  );
});

test("retirement force-closes an outstanding task as cancelled and leaves a resolved one alone", () => {
  const mixed: ReadonlySet<Task> = new Set([
    { id: asTaskId(2), kind: tkWork, state: tsResolved("Passed") },
    { id: asTaskId(1), kind: tkWork, state: tsOutstanding },
  ]);
  const retired = retiredInIdOrder(mixed);
  assert.deepEqual(
    retired.map((t) => t.id),
    [1, 2],
    "retirement is in id order, not in the order the set happened to hold",
  );
  assert.deepEqual(retired[0]?.state, tsResolved("Cancelled"));
  assert.deepEqual(retired[1]?.state, tsResolved("Passed"));
});

test("the eval stage is derived from the kind marks and is zero on a work set", () => {
  assert.equal(evalStage(spawnTasks(tkWork, firstTaskId, 2)), 0);
  assert.equal(evalStage(spawnTasks(tkEval(1), firstTaskId, 2)), 1);
  assert.equal(evalStage(new Set()), 0);
});

test("spawnOn refuses a ticket that still holds live tasks", () => {
  const live = spawnOn(bare, tkWork, 2);
  assert.equal(live.spawned, 2);
  assert.throws(() => spawnOn(live, tkWork, 1), /must retire first/);
});

test("retiring then spawning continues the id sequence rather than restarting it", () => {
  const first = spawnOn(bare, tkWork, 2);
  const second = spawnOn(retireLive(first), tkEval(0), 2);
  assert.deepEqual(
    tasksInIdOrder(second.tasks).map((t) => t.id),
    [3, 4],
  );
  assert.equal(second.spawned, 4, "the ghost counts every task ever spawned");
  assert.equal(
    second.spawned,
    second.record.length + second.tasks.size,
    "which is exactly the equality idsAccounted checks",
  );
});

test("a desk task is open exactly while the ticket is parked", () => {
  const phases: readonly Phase[] = [
    "Pending",
    "Working",
    "Evaluating",
    "Finalizing",
    "Done",
    "Escalated",
    "Revoked",
  ];
  for (const phase of phases) {
    assert.equal(
      hasOpenHumanTask({ ...bare, phase }),
      phase === "Escalated",
      phase,
    );
  }
});

test("the settled tier is the phases no work follows from", () => {
  for (const phase of phaseTags) {
    assert.equal(
      isSettled(phase),
      phase === "Done" || phase === "Escalated" || phase === "Revoked",
      phase,
    );
  }
});

test("every effect renders to a label and reads back to itself", () => {
  assert.equal(
    allEffects.length,
    new Set(allEffects).size,
    "the roster repeats a constructor",
  );
  for (const effect of allEffects) {
    assert.equal(effectFromLabel(effectLabel(effect)), effect);
  }
});

test("a string that is not one of this machine's effects is refused", () => {
  assert.throws(
    () => effectFromLabel("LaunchMissiles"),
    /not one of this machine's effects/,
  );
});

test("the combinators are what the model says they are", () => {
  const passed: ReadonlySet<Task> = new Set([
    { id: asTaskId(1), kind: tkWork, state: tsResolved("Passed") },
    { id: asTaskId(2), kind: tkWork, state: tsResolved("Failed") },
  ]);
  assert.equal(combine("UnanimousPass", passed), false);
  assert.equal(combine("AnyPass", passed), true);
  assert.equal(
    combine("UnanimousPass", new Set()),
    true,
    "vacuously, as forall does",
  );
  assert.equal(combine("AnyPass", new Set()), false);
});

test("a cancelled task fails both combinators, so a revoked set never passes", () => {
  const cancelled: ReadonlySet<Task> = new Set([
    { id: asTaskId(1), kind: tkWork, state: tsResolved("Cancelled") },
  ]);
  assert.equal(combine("UnanimousPass", cancelled), false);
  assert.equal(combine("AnyPass", cancelled), false);
});

test("an identifier outside the exactly representable range is refused, not truncated", () => {
  assert.throws(
    () => asSafeInteger(Number.MAX_SAFE_INTEGER + 2, "probe"),
    /a declared bound is wrong/,
  );
  assert.throws(() => asTicketId(0), /below the first id/);
  assert.throws(() => asTaskId(0), /below the first id/);
});

/** A ticket's history as the rework count reads it: the record, then what is still live. */
function reworksOver(
  history: readonly (readonly [TaskKind, TaskState])[],
  live: number,
): number {
  const tasks = history.map(([kind, state], at) => ({
    id: asTaskId(at + 1),
    kind,
    state,
  }));
  return evaluationFailureReworksStarted(
    tasks.slice(0, tasks.length - live),
    new Set(tasks.slice(tasks.length - live)),
  );
}

const working: readonly [TaskKind, TaskState] = [tkWork, tsOutstanding];

/** An evaluation task of stage zero carrying the outcome it resolved to. */
function evaluated(outcome: TaskOutcome): readonly [TaskKind, TaskState] {
  return [tkEval(0), tsResolved(outcome)];
}

test("a rework is a work run that follows an evaluation run some task failed", () => {
  const failed = evaluated("Failed");
  assert.equal(reworksOver([], 0), 0, "nothing dispatched has been reworked");
  assert.equal(reworksOver([working], 1), 0, "the first fan-out is no rework");
  assert.equal(
    reworksOver([working, working], 2),
    0,
    "a fan-out is one run, not two",
  );
  assert.equal(reworksOver([working, failed], 0), 0, "evaluating is no rework");
  assert.equal(
    reworksOver([working, failed, working], 1),
    1,
    "the work after the failure is the first rework",
  );
  assert.equal(
    reworksOver([working, failed, working, working], 2),
    1,
    "a fan-out of two is still one rework",
  );
  assert.equal(
    reworksOver([working, failed, working, failed, working], 1),
    2,
    "and the work after the second failure is the second",
  );
});

test("the work a passed evaluation is followed by is the finalizer's, and is uncapped", () => {
  assert.equal(
    reworksOver([working, evaluated("Passed"), working], 1),
    0,
    "a finalization failure re-enters Working without spending the cap",
  );
  assert.equal(
    reworksOver(
      [
        working,
        evaluated("Passed"),
        working,
        evaluated("Failed"),
        working,
        evaluated("Passed"),
        working,
      ],
      1,
    ),
    1,
    "and the evaluation failure between them still counts once",
  );
});

test("an evaluation run counts once however many of its tasks resolved", () => {
  assert.equal(
    reworksOver(
      [working, evaluated("Failed"), evaluated("Cancelled"), working],
      1,
    ),
    1,
    "one failure cancels the rest of the run, and the run is one rework",
  );
  assert.equal(
    reworksOver(
      [working, evaluated("Cancelled"), evaluated("Cancelled"), working],
      1,
    ),
    0,
    "a run nothing failed is no rework",
  );
});

test("the count folds the record and the live set as one history", () => {
  const history = [working, evaluated("Failed"), working];
  for (const live of [0, 1, 3])
    assert.equal(reworksOver(history, live), 1, `with ${String(live)} live`);
});
