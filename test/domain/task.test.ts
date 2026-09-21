/**
 * The task plumbing, the effect vocabulary and the rank ladder, at the level
 * the golden corpus cannot reach: a boundary condition it never happens to
 * produce is still a boundary condition.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evalStage,
  evaluationTaskOf,
  resolveTask,
  retiredInOrdinalOrder,
  outstandingCount,
  spawnTasks,
  taskIdentityEquals,
  taskIdentityValid,
  taskOrdinal,
  tasksInOrdinalOrder,
  taskPassed,
  evaluationFailureReworksStarted,
  tsResolved,
  tsOutstanding,
  workTaskOf,
} from "../../src/domain/task.ts";
import { asTaskId, asTicketId, asSafeInteger } from "../../src/domain/ids.ts";
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
  type TaskOutcome,
  type Ticket,
} from "../../src/domain/generated/modelTypes.ts";

const bare: Ticket = {
  phase: "Pending",
  deps: new Set(),
  artifact: "NoArtifact",
  program: [],
  tasks: new Set(),
  record: [],
  workCyclesStarted: 0,
  spawned: 0,
  escalation: "NoEscalation",
  completions: 0,
};

test("a spawned set is outstanding under exactly the identities it was named", () => {
  const tasks = spawnTasks([
    evaluationTaskOf(1, 1, 0, 1, 1),
    evaluationTaskOf(1, 1, 0, 1, 2),
  ]);
  assert.deepEqual(
    tasksInOrdinalOrder(tasks).map((t) => taskOrdinal(t.identity)),
    [1, 2],
  );
  assert.equal(outstandingCount(tasks), 2);
});

test("spawning no identities yields no tasks rather than a task", () => {
  assert.equal(spawnTasks([]).size, 0);
});

test("an identity is valid exactly while every counter it carries is positive", () => {
  assert.ok(taskIdentityValid(workTaskOf(1, 1)));
  assert.ok(!taskIdentityValid(workTaskOf(1, 0)));
  assert.ok(taskIdentityValid(evaluationTaskOf(1, 1, 0, 1, 1)));
  assert.ok(!taskIdentityValid(evaluationTaskOf(1, 0, 0, 1, 1)));
});

test("two identities are the same only on the same arm and the same fields", () => {
  assert.ok(taskIdentityEquals(workTaskOf(2, 3), workTaskOf(2, 3)));
  assert.ok(!taskIdentityEquals(workTaskOf(2, 3), workTaskOf(2, 4)));
  assert.ok(
    !taskIdentityEquals(workTaskOf(2, 3), evaluationTaskOf(2, 3, 0, 1, 1)),
  );
  assert.ok(
    !taskIdentityEquals(
      evaluationTaskOf(2, 1, 0, 1, 1),
      evaluationTaskOf(2, 1, 0, 2, 1),
    ),
    "a second run of a stage is not the first",
  );
});

test("first write wins, so a duplicate delivery changes nothing", () => {
  const work = workTaskOf(1, 1);
  const spawned = spawnTasks([work]);
  const once = resolveTask(spawned, work, "Passed");
  const twice = resolveTask(once, work, "Failed");
  assert.deepEqual([...twice], [...once]);
  const resolved = tasksInOrdinalOrder(twice)[0];
  assert.ok(resolved, "the fixture spawned one task");
  assert.ok(taskPassed(resolved));
});

test("resolving an identity that is not there changes nothing", () => {
  const spawned = spawnTasks([workTaskOf(1, 1)]);
  assert.deepEqual(
    [...resolveTask(spawned, workTaskOf(1, 2), "Passed")],
    [...spawned],
  );
});

test("retirement force-closes an outstanding task as cancelled and leaves a resolved one alone", () => {
  const mixed: ReadonlySet<Task> = new Set([
    {
      identity: evaluationTaskOf(1, 1, 0, 1, 2),
      state: tsResolved("Passed"),
    },
    { identity: evaluationTaskOf(1, 1, 0, 1, 1), state: tsOutstanding },
  ]);
  const retired = retiredInOrdinalOrder(mixed);
  assert.deepEqual(
    retired.map((t) => taskOrdinal(t.identity)),
    [1, 2],
    "retirement is in ordinal order, not in the order the set happened to hold",
  );
  assert.deepEqual(retired[0]?.state, tsResolved("Cancelled"));
  assert.deepEqual(retired[1]?.state, tsResolved("Passed"));
});

test("the eval stage is derived from the live identities and is zero on a work set", () => {
  assert.equal(evalStage(spawnTasks([workTaskOf(1, 1)])), 0);
  assert.equal(
    evalStage(
      spawnTasks([
        evaluationTaskOf(1, 1, 1, 1, 1),
        evaluationTaskOf(1, 1, 1, 1, 2),
      ]),
    ),
    1,
  );
  assert.equal(evalStage(new Set()), 0);
});

test("spawnOn refuses a ticket that still holds live tasks", () => {
  const live = spawnOn(bare, [workTaskOf(1, 1)]);
  assert.equal(live.spawned, 1);
  assert.throws(() => spawnOn(live, [workTaskOf(1, 2)]), /must retire first/);
});

test("retiring then spawning keeps the ghost counting rather than restarting it", () => {
  const first = spawnOn(bare, [workTaskOf(1, 1)]);
  const second = spawnOn(retireLive(first), [
    evaluationTaskOf(1, 1, 0, 1, 1),
    evaluationTaskOf(1, 1, 0, 1, 2),
  ]);
  assert.equal(second.spawned, 3, "the ghost counts every task ever spawned");
  assert.equal(
    second.spawned,
    second.record.length + second.tasks.size,
    "which is exactly the equality idsAccounted checks",
  );
});

test("a desk task is open exactly while the ticket is parked", () => {
  const phases: readonly Phase[] = [
    "Pending",
    "Work",
    "Evaluation",
    "Finalization",
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

test("a stage passes only when every task in it passed", () => {
  const mixed: ReadonlySet<Task> = new Set([
    {
      identity: evaluationTaskOf(1, 1, 0, 1, 1),
      state: tsResolved("Passed"),
    },
    {
      identity: evaluationTaskOf(1, 1, 0, 1, 2),
      state: tsResolved("Failed"),
    },
  ]);
  assert.equal(combine(mixed), false);
  assert.equal(combine(new Set()), true, "vacuously, as forall does");
});

test("a cancelled task fails its stage, so a revoked set never passes", () => {
  const cancelled: ReadonlySet<Task> = new Set([
    { identity: workTaskOf(1, 1), state: tsResolved("Cancelled") },
  ]);
  assert.equal(combine(cancelled), false);
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
function reworksOver(history: readonly Task[], live: number): number {
  return evaluationFailureReworksStarted(
    history.slice(0, history.length - live),
    new Set(history.slice(history.length - live)),
  );
}

/** The work task of one cycle of ticket one, as it looks while it runs. */
function working(cycle: number): Task {
  return { identity: workTaskOf(1, cycle), state: tsOutstanding };
}

/** One evaluator of stage zero judging `cycle`, carrying the outcome it resolved to. */
function evaluated(cycle: number, outcome: TaskOutcome, evaluator = 1): Task {
  return {
    identity: evaluationTaskOf(1, cycle, 0, 1, evaluator),
    state: tsResolved(outcome),
  };
}

test("a rework is a work cycle that follows an evaluation run some task failed", () => {
  assert.equal(reworksOver([], 0), 0, "nothing dispatched has been reworked");
  assert.equal(reworksOver([working(1)], 1), 0, "the first cycle is no rework");
  assert.equal(
    reworksOver([working(1), evaluated(1, "Failed")], 0),
    0,
    "evaluating is no rework",
  );
  assert.equal(
    reworksOver([working(1), evaluated(1, "Failed"), working(2)], 1),
    1,
    "the work after the failure is the first rework",
  );
  assert.equal(
    reworksOver(
      [
        working(1),
        evaluated(1, "Failed"),
        working(2),
        evaluated(2, "Failed"),
        working(3),
      ],
      1,
    ),
    2,
    "and the work after the second failure is the second",
  );
});

test("the work a passed evaluation is followed by is the finalizer's, and is uncapped", () => {
  assert.equal(
    reworksOver([working(1), evaluated(1, "Passed"), working(2)], 1),
    0,
    "a finalization failure re-enters Work without spending the cap",
  );
  assert.equal(
    reworksOver(
      [
        working(1),
        evaluated(1, "Passed"),
        working(2),
        evaluated(2, "Failed"),
        working(3),
        evaluated(3, "Passed"),
        working(4),
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
      [
        working(1),
        evaluated(1, "Failed"),
        evaluated(1, "Cancelled", 2),
        working(2),
      ],
      1,
    ),
    1,
    "one failure cancels the rest of the run, and the run is one rework",
  );
  assert.equal(
    reworksOver(
      [
        working(1),
        evaluated(1, "Cancelled"),
        evaluated(1, "Cancelled", 2),
        working(2),
      ],
      1,
    ),
    0,
    "a run nothing failed is no rework",
  );
});

test("the count folds the record and the live set as one history", () => {
  const history = [working(1), evaluated(1, "Failed"), working(2)];
  for (const live of [0, 1, 3])
    assert.equal(reworksOver(history, live), 1, `with ${String(live)} live`);
});
