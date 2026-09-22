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
  outstandingCount,
  spawnTasks,
  taskIdentityEquals,
  taskIdentityValid,
  taskPositionInSet,
  taskRetirementKey,
  tasksInEvaluatorKeyOrder,
  taskPassed,
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
import { allPassed } from "../../src/domain/program.ts";
import {
  evaluationFailureReworksStarted,
  liveTasks,
  retireLive,
  spawnWork,
  hasOpenHumanTask,
} from "../../src/domain/ticket.ts";
import { judgedInstance } from "./fixtures.ts";
import {
  phaseTags,
  type EvaluationVerdict,
  type Phase,
  type StageDefinition,
  type Task,
  type Ticket,
} from "../../src/domain/generated/modelTypes.ts";

const flat: readonly StageDefinition[] = [{ key: 1, evaluators: [{ key: 1 }] }];

const bare: Ticket = {
  phase: "Pending",
  deps: new Set(),
  artifact: "NoArtifact",
  program: flat,
  tasks: new Set(),
  evaluations: [],
  workCyclesStarted: 0,
  spawned: 0,
  escalation: "NoEscalation",
  completions: 0,
};

test("a spawned set is outstanding under exactly the identities it was named", () => {
  const tasks = spawnTasks([
    evaluationTaskOf(1, 1, 1, 1, 1),
    evaluationTaskOf(1, 1, 1, 1, 2),
  ]);
  assert.deepEqual(
    tasksInEvaluatorKeyOrder(tasks).map((t) => taskRetirementKey(t.identity)),
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
  assert.ok(!taskIdentityValid(workTaskOf(0, 1)));
  assert.ok(taskIdentityValid(evaluationTaskOf(1, 1, 1, 1, 1)));
  assert.ok(!taskIdentityValid(evaluationTaskOf(0, 1, 1, 1, 1)));
  assert.ok(!taskIdentityValid(evaluationTaskOf(1, 0, 1, 1, 1)));
  assert.ok(
    !taskIdentityValid({
      type: "EvaluationTask",
      value: { ticket: 1, workCycle: 1, stage: 0, generation: 1, evaluator: 1 },
    }),
    "the contract's stage is a positive key, not an index",
  );
  assert.ok(!taskIdentityValid(evaluationTaskOf(1, 1, 1, 0, 1)));
  assert.ok(!taskIdentityValid(evaluationTaskOf(1, 1, 1, 1, 0)));
});

test("a task's position in its set counts the set by evaluator key, not by the key itself", () => {
  const tasks = spawnTasks([
    evaluationTaskOf(1, 1, 1, 1, 3),
    evaluationTaskOf(1, 1, 1, 1, 1),
  ]);
  assert.equal(taskPositionInSet(tasks, evaluationTaskOf(1, 1, 1, 1, 1)), 1);
  assert.equal(taskPositionInSet(tasks, evaluationTaskOf(1, 1, 1, 1, 3)), 2);
  assert.throws(
    () => taskPositionInSet(tasks, evaluationTaskOf(1, 1, 1, 1, 2)),
    /not in this set/,
  );
});

test("two identities are the same only on the same arm and the same fields", () => {
  assert.ok(taskIdentityEquals(workTaskOf(2, 3), workTaskOf(2, 3)));
  assert.ok(!taskIdentityEquals(workTaskOf(2, 3), workTaskOf(2, 4)));
  assert.ok(
    !taskIdentityEquals(workTaskOf(2, 3), evaluationTaskOf(2, 3, 1, 1, 1)),
  );
  assert.ok(
    !taskIdentityEquals(
      evaluationTaskOf(2, 1, 1, 1, 1),
      evaluationTaskOf(2, 1, 1, 2, 1),
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
  const resolved = tasksInEvaluatorKeyOrder(twice)[0];
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

test("the eval stage is derived from the live identities and is zero on a work set", () => {
  assert.equal(evalStage(spawnTasks([workTaskOf(1, 1)])), 0);
  assert.equal(
    evalStage(
      spawnTasks([
        evaluationTaskOf(1, 1, 2, 1, 1),
        evaluationTaskOf(1, 1, 2, 1, 2),
      ]),
    ),
    1,
  );
  assert.equal(evalStage(new Set()), 0);
});

test("a work cycle is one task, and each spawn claims exactly one mint slot", () => {
  const first = spawnWork(bare, 1);
  assert.deepEqual(
    [...first.tasks].map((t) => t.identity),
    [workTaskOf(1, 1)],
  );
  assert.equal(first.workCyclesStarted, 1);
  assert.equal(first.spawned, 1);
  const second = spawnWork(retireLive(first), 1);
  assert.deepEqual(
    [...second.tasks].map((t) => t.identity),
    [workTaskOf(1, 2)],
  );
  assert.equal(second.spawned, 2, "the counter is a ghost and never restarts");
});

test("retirement leaves no live task, whether the one it held was outstanding or resolved", () => {
  const outstanding = {
    ...bare,
    phase: "Work" as const,
    tasks: spawnTasks([workTaskOf(1, 1)]),
  };
  assert.deepEqual(liveTasks(outstanding), [workTaskOf(1, 1)]);
  assert.equal(retireLive(outstanding).tasks.size, 0);
  const resolved: ReadonlySet<Task> = new Set([
    { identity: workTaskOf(1, 1), state: tsResolved("Passed") },
  ]);
  assert.equal(retireLive({ ...bare, tasks: resolved }).tasks.size, 0);
  assert.deepEqual(liveTasks({ ...bare, phase: "Work", tasks: resolved }), []);
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

test("a task set passes only when every task in it passed", () => {
  const mixed: ReadonlySet<Task> = new Set([
    { identity: workTaskOf(1, 1), state: tsResolved("Passed") },
    { identity: workTaskOf(1, 2), state: tsResolved("Failed") },
  ]);
  assert.equal(allPassed(mixed), false);
  assert.equal(allPassed(new Set()), true, "vacuously, as forall does");
  assert.equal(
    allPassed(spawnTasks([workTaskOf(1, 1)])),
    false,
    "an outstanding task has not passed",
  );
  assert.equal(tsOutstanding, "Outstanding");
});

test("an identifier outside the exactly representable range is refused, not truncated", () => {
  assert.throws(
    () => asSafeInteger(Number.MAX_SAFE_INTEGER + 2, "probe"),
    /a declared bound is wrong/,
  );
  assert.throws(() => asTicketId(0), /below the first id/);
  assert.throws(() => asTaskId(0), /below the first id/);
});

/** A ticket that judged one cycle per verdict listed, having started `cycles` of them. */
function judgedOver(
  verdicts: readonly EvaluationVerdict[],
  cycles: number,
): Ticket {
  return {
    ...bare,
    workCyclesStarted: cycles,
    evaluations: verdicts.map((verdict, at) =>
      judgedInstance(1, at + 1, 1, flat, () => verdict),
    ),
  };
}

test("a rework is a work cycle a failed judgement bought", () => {
  assert.equal(
    evaluationFailureReworksStarted(bare),
    0,
    "nothing judged has been reworked",
  );
  assert.equal(
    evaluationFailureReworksStarted(judgedOver(["EvaluatorFail"], 1)),
    0,
    "a failure with no cycle above it bought nothing yet",
  );
  assert.equal(
    evaluationFailureReworksStarted(judgedOver(["EvaluatorFail"], 2)),
    1,
    "the cycle above the failure is the first rework",
  );
  assert.equal(
    evaluationFailureReworksStarted(
      judgedOver(["EvaluatorFail", "EvaluatorFail"], 3),
    ),
    2,
    "and the cycle above the second failure is the second",
  );
});

test("the work a passed judgement is followed by is the finalizer's, and is uncapped", () => {
  assert.equal(
    evaluationFailureReworksStarted(judgedOver(["EvaluatorPass"], 2)),
    0,
    "a finalization failure re-enters Work without spending the cap",
  );
  assert.equal(
    evaluationFailureReworksStarted(
      judgedOver(["EvaluatorPass", "EvaluatorFail"], 3),
    ),
    1,
    "and the evaluation failure between them still counts once",
  );
});
