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
  workTaskIdentity,
} from "../../src/domain/task.ts";
import { asTaskId, asTicketId, asSafeInteger } from "../../src/domain/ids.ts";
import { isSettled, phaseTags } from "../../src/domain/phase.ts";
import { alwaysPolicy, decideTaskTerminal } from "../../src/domain/deciders.ts";
import {
  attemptGeneration,
  evaluationFailureReworksStarted,
  liveTasks,
  owesTask,
  hasOpenHumanTask,
} from "../../src/domain/ticket.ts";
import { ledgerStep, ticketAfter } from "../../src/domain/ledger.ts";
import { anAcceptedSource, evaluatorOf } from "../../src/domain/config.ts";
import { modelInstance } from "./configs.ts";
import {
  carriedAt,
  evaluationState,
  finalizationState,
  judgedInstance,
  judgedReport,
  ledgerFor,
  obligationFor,
  producedReport,
  runningInstance,
  stoppedReport,
  ticketOn,
  workEscalatedState,
  workState,
} from "./fixtures.ts";
import type {
  EvaluationVerdict,
  StageDefinition,
  TaskTerminalReport,
  Ticket,
  TicketEvent,
  TicketState,
} from "../../src/domain/generated/modelTypes.ts";

const flat: readonly StageDefinition[] = [
  { key: 1, evaluators: [evaluatorOf(1)] },
];

const bare: Ticket = ticketOn(modelInstance, { stages: flat });

/** The ticket running its first cycle, as a dispatch leaves it. */
const working: Ticket = {
  ...bare,
  workCyclesStarted: 1,
  state: workState(bare),
};

test("an identity is valid exactly while every counter it carries is positive", () => {
  assert.ok(taskIdentityValid(workTaskIdentity(1, 1)));
  assert.ok(!taskIdentityValid(workTaskIdentity(1, 0)));
  assert.ok(!taskIdentityValid(workTaskIdentity(0, 1)));
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
  assert.ok(taskIdentityEquals(workTaskIdentity(2, 3), workTaskIdentity(2, 3)));
  assert.ok(
    !taskIdentityEquals(workTaskIdentity(2, 3), workTaskIdentity(2, 4)),
  );
  assert.ok(
    !taskIdentityEquals(
      workTaskIdentity(2, 3),
      evaluationTaskOf(2, 3, 1, 1, 1),
    ),
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
  const events: readonly TicketEvent[] = [
    {
      type: "TicketDispatched",
      value: { ticket: 1, source: anAcceptedSource },
    },
    {
      type: "TicketWorkProcessFailed",
      value: { ticket: 1, task: workTaskIdentity(1, 1), evidence: 1 },
    },
    { type: "TicketWorkResumed", value: 1 },
  ];
  let ticket = bare;
  let ledger = ledgerFor(bare);
  const seen: { tasks: unknown; cycles: number; spawned: number }[] = [];
  for (const event of events) {
    ledger = ledgerStep(ticket, event, ledger);
    ticket = ticketAfter(ticket, event);
    seen.push({
      tasks: liveTasks(ticket),
      cycles: ticket.workCyclesStarted,
      spawned: ledger.spawned,
    });
  }
  assert.deepEqual(seen, [
    { tasks: [workTaskIdentity(1, 1)], cycles: 1, spawned: 1 },
    { tasks: [], cycles: 1, spawned: 1 },
    { tasks: [workTaskIdentity(1, 2)], cycles: 2, spawned: 2 },
  ]);
});

test("a work spawn leaves behind the finalization generation the last cycle reached", () => {
  const finalizing: Ticket = {
    ...working,
    state: finalizationState(judgedInstance(1, 1, flat), 2),
  };
  assert.equal(attemptGeneration(finalizing), 2);
  const reworked = ticketAfter(finalizing, {
    type: "TicketFinalizationNeedsWork",
    value: { ticket: 1, workCycle: 1, generation: 2, evidence: 1 },
  });
  assert.equal(reworked.workCyclesStarted, 2);
  assert.equal(attemptGeneration(reworked), 0);
});

test("the live task is derived from the state, so leaving Work stops owing it", () => {
  assert.deepEqual(liveTasks(working), [workTaskIdentity(1, 1)]);
  const elsewhere: readonly TicketState[] = [
    workEscalatedState(working),
    "Revoked",
    "Pending",
  ];
  for (const state of elsewhere) {
    assert.deepEqual(
      liveTasks({ ...working, state }),
      [],
      typeof state === "string" ? state : state.type,
    );
  }
});

test("a desk task is open exactly while the ticket is parked", () => {
  const judged = judgedInstance(1, 1, flat);
  const states: readonly TicketState[] = [
    "Pending",
    workState(bare),
    evaluationState(runningInstance(1, 1, flat, new Set())),
    finalizationState(judged),
    "Done",
    workEscalatedState(bare),
    "Revoked",
  ];
  for (const state of states) {
    const phase = typeof state === "string" ? state : state.type;
    assert.equal(
      hasOpenHumanTask({ ...bare, state }),
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

/**
 * The reworks of a ticket that closed one judgement per verdict listed, having
 * started `cycles` cycles.
 */
function judgedOver(
  verdicts: readonly EvaluationVerdict[],
  cycles: number,
): number {
  const ticket: Ticket = { ...bare, workCyclesStarted: cycles };
  return evaluationFailureReworksStarted(
    ticket,
    ledgerFor(ticket, {
      closedEvaluations: verdicts.map((verdict, at) =>
        judgedInstance(1, at + 1, flat, () => verdict),
      ),
    }),
  );
}

test("a rework is a work cycle a failed judgement bought", () => {
  assert.equal(
    evaluationFailureReworksStarted(bare, ledgerFor(bare)),
    0,
    "nothing judged has been reworked",
  );
  assert.equal(
    judgedOver(["EvaluatorFail"], 1),
    0,
    "a failure with no cycle above it bought nothing yet",
  );
  assert.equal(
    judgedOver(["EvaluatorFail"], 2),
    1,
    "the cycle above the failure is the first rework",
  );
  assert.equal(
    judgedOver(["EvaluatorFail", "EvaluatorFail"], 3),
    2,
    "and the cycle above the second failure is the second",
  );
});

test("the work a passed judgement is followed by is the finalizer's, and is uncapped", () => {
  assert.equal(
    judgedOver(["EvaluatorPass"], 2),
    0,
    "a finalization failure re-enters Work without spending the cap",
  );
  assert.equal(
    judgedOver(["EvaluatorPass", "EvaluatorFail"], 3),
    1,
    "and the evaluation failure between them still counts once",
  );
});

/** Whether ticket one, standing alone, accepts the report rather than refusing it. */
function reportCurrent(ticket: Ticket, report: TaskTerminalReport): boolean {
  const graph = { tickets: new Map([[asTicketId(1), ticket]]) };
  return (
    decideTaskTerminal(graph, report, alwaysPolicy("ReworkEvaluationFailure"))
      .type === "TicketDecided"
  );
}

test("a report is matched to the obligation the ticket owes the task", () => {
  const work = workTaskIdentity(1, 1);
  const judge = evaluationTaskOf(1, 1, 1, 1, 1);
  assert.ok(reportCurrent(working, producedReport(work)));
  assert.ok(!reportCurrent(working, judgedReport(judge, "EvaluatorPass")));
  assert.ok(
    reportCurrent(working, stoppedReport(work, "ProcessFailure")),
    "a failure is matched by the task it names, there being no result to hold",
  );
  assert.ok(
    !reportCurrent(working, stoppedReport(judge, "ProcessFailure")),
    "a failure naming a task the ticket does not owe is refused",
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
    state: evaluationState(runningInstance(1, 1, flat, new Set())),
    workCyclesStarted: 1,
  };
  const pairs = [
    [working, workTaskIdentity(1, 1)],
    [judging, evaluationTaskOf(1, 1, 1, 1, 1)],
  ] as const;
  for (const [ticket, task] of pairs) {
    const owed = obligationFor(task);
    assert.ok(
      reportCurrent(ticket, carriedAt(task, owed)),
      `${task.type} at the obligation it was spawned under`,
    );
    assert.ok(
      !reportCurrent(
        ticket,
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
      !reportCurrent(
        ticket,
        carriedAt(task, { ...owed, contextRef: owed.contextRef + 1 }),
      ),
      `${task.type} for another context than that one`,
    );
  }
});

test("a ticket owes exactly the tasks it holds live", () => {
  assert.ok(owesTask(working, workTaskIdentity(1, 1)));
  assert.ok(!owesTask(working, workTaskIdentity(1, 2)));
  assert.ok(!owesTask(working, evaluationTaskOf(1, 1, 1, 1, 1)));
  assert.ok(!owesTask(bare, workTaskIdentity(1, 1)));
  assert.ok(
    !owesTask(
      { ...working, state: workEscalatedState(working) },
      workTaskIdentity(1, 1),
    ),
    "a parked ticket owes the fabric nothing",
  );
});
