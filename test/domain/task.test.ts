/**
 * The task plumbing and what a ticket owes, at the level the golden corpus
 * cannot reach: a boundary condition it never happens to produce is still a
 * boundary condition.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluationTaskOf,
  taskIdentityEquals,
  taskIdentityValid,
  workTaskOf,
} from "../../src/domain/task.ts";
import { asTaskId, asTicketId, asSafeInteger } from "../../src/domain/ids.ts";
import { isSettled } from "../../src/domain/phase.ts";
import { freshTicket } from "../../src/domain/deciders.ts";
import {
  evaluationFailureReworksStarted,
  liveTasks,
  owesTask,
  reportMatchesTask,
  spawnWork,
  hasOpenHumanTask,
} from "../../src/domain/ticket.ts";
import { evaluatorOf, releasedTicketOf } from "../../src/domain/config.ts";
import {
  carriedAt,
  judgedInstance,
  judgedReport,
  obligationFor,
  producedReport,
  runningInstance,
  stoppedReport,
} from "./fixtures.ts";
import {
  phaseTags,
  type EvaluationVerdict,
  type Phase,
  type StageDefinition,
  type Ticket,
} from "../../src/domain/generated/modelTypes.ts";

const flat: readonly StageDefinition[] = [
  { key: 1, evaluators: [evaluatorOf(1)] },
];

const bare: Ticket = freshTicket(releasedTicketOf(1, new Set(), flat));

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

test("a work cycle is one task, and each spawn claims exactly one mint slot", () => {
  const first: Ticket = { ...spawnWork(bare), phase: "Work" };
  assert.deepEqual(liveTasks(first), [workTaskOf(1, 1)]);
  assert.equal(first.workCyclesStarted, 1);
  assert.equal(first.spawned, 1);
  const second: Ticket = { ...spawnWork(first), phase: "Work" };
  assert.deepEqual(liveTasks(second), [workTaskOf(1, 2)]);
  assert.equal(second.spawned, 2, "the counter is a ghost and never restarts");
});

test("a work spawn clears the finalization generation the last cycle reached", () => {
  assert.equal(
    spawnWork({ ...bare, finalizationGeneration: 2 }).finalizationGeneration,
    0,
  );
});

test("the live task is derived from the phase, so leaving Work stops owing it", () => {
  const working: Ticket = { ...spawnWork(bare), phase: "Work" };
  assert.deepEqual(liveTasks(working), [workTaskOf(1, 1)]);
  for (const phase of ["Escalated", "Revoked", "Pending"] as const) {
    assert.deepEqual(liveTasks({ ...working, phase }), [], phase);
  }
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
      judgedInstance(1, at + 1, flat, () => verdict),
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

test("a report is matched to the obligation the ticket owes the task", () => {
  const working = spawnWork({ ...bare, phase: "Work" });
  const work = workTaskOf(1, 1);
  const judge = evaluationTaskOf(1, 1, 1, 1, 1);
  assert.ok(reportMatchesTask(working, work, producedReport(work)));
  assert.ok(!reportMatchesTask(working, judge, producedReport(work)));
  assert.ok(
    !reportMatchesTask(working, work, judgedReport(judge, "EvaluatorPass")),
  );
  const failed = stoppedReport(work, "ProcessFailure");
  assert.ok(
    reportMatchesTask(working, work, failed),
    "a failure is matched by the task it names, there being no result to hold",
  );
  assert.ok(
    !reportMatchesTask(working, judge, failed),
    "a failure naming another task than the completion is refused",
  );
});

/**
 * THE OBLIGATION AND NOT THE IDENTITY. A report naming an owed task under
 * another definition or another context is a result for a spawn that was never
 * made, and nothing else varies the halves that say so: every other case here
 * moves the identity, which a comparison cut back to identities would still
 * refuse.
 */
test("a report naming an owed task at another obligation is refused", () => {
  const judging: Ticket = {
    ...bare,
    phase: "Evaluation",
    evaluations: [runningInstance(1, 1, flat, new Set())],
    workCyclesStarted: 1,
  };
  const pairs = [
    [spawnWork({ ...bare, phase: "Work" }), workTaskOf(1, 1)],
    [judging, evaluationTaskOf(1, 1, 1, 1, 1)],
  ] as const;
  for (const [ticket, task] of pairs) {
    const owed = obligationFor(task);
    assert.ok(
      reportMatchesTask(ticket, task, carriedAt(task, owed)),
      `${task.type} at the obligation it was spawned under`,
    );
    assert.ok(
      !reportMatchesTask(
        ticket,
        task,
        carriedAt(task, {
          ...owed,
          definition: {
            ...owed.definition,
            inputs: owed.definition.inputs + 1,
          },
        }),
      ),
      `${task.type} under another definition than that one`,
    );
    assert.ok(
      !reportMatchesTask(
        ticket,
        task,
        carriedAt(task, { ...owed, contextRef: owed.contextRef + 1 }),
      ),
      `${task.type} for another context than that one`,
    );
  }
});

test("a ticket owes exactly the tasks it holds live", () => {
  const working = spawnWork({ ...bare, phase: "Work" });
  assert.ok(owesTask(working, workTaskOf(1, 1)));
  assert.ok(!owesTask(working, workTaskOf(1, 2)));
  assert.ok(!owesTask(working, evaluationTaskOf(1, 1, 1, 1, 1)));
  assert.ok(!owesTask(bare, workTaskOf(1, 1)));
  assert.ok(
    !owesTask({ ...working, phase: "Escalated" }, workTaskOf(1, 1)),
    "a parked ticket owes the fabric nothing",
  );
});
