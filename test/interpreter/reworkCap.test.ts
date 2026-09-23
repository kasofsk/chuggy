/**
 * The cap as the writer applies it: how many failing evaluations a ticket is
 * reworked through before one of them parks it.
 *
 * THE TICKETS ARE DRIVEN, NOT DESCRIBED. The count is read off the task
 * history, so a fixture that set a task set by hand would be asserting its own
 * arithmetic; these are the states the deciders leave after each reported
 * verdict, with the disposition this module picked fed back into the next one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decide,
  dispatchEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  taskDoneEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { genesis } from "../../src/actor/journal.ts";
import { alwaysPolicy } from "../../src/domain/deciders.ts";
import { evolve } from "../../src/domain/evolve.ts";
import { currentTaskObligations } from "../../src/domain/evaluation.ts";
import { currentInstance } from "../../src/domain/ticket.ts";
import { workTaskOf } from "../../src/domain/task.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import type { TicketGraph } from "../../src/domain/generated/modelTypes.ts";
import type { TaskIdentity } from "../../src/domain/generated/modelTypes.ts";
import {
  checkedReworkCap,
  reworkDisposition,
} from "../../src/interpreter/reworkCap.ts";
import { plainDefinitionOf, plainPolicy } from "../actor/harness.ts";
import { aDispatchSource } from "../../src/domain/config.ts";
import { id, judgedReport, producedReport } from "../domain/fixtures.ts";

/** The one task a single-width ticket owes, which is what a completion names. */
function owed(graph: TicketGraph): TaskIdentity {
  const ticket = ticketAt(graph, id(1));
  if (ticket.phase === "Work") return workTaskOf(1, ticket.workCyclesStarted);
  const [obligation] = currentTaskObligations(currentInstance(ticket));
  if (obligation === undefined)
    throw new Error("rework cap case: the ticket owes no task");
  return obligation.task;
}

/**
 * The dispositions the cap picks, one per failing evaluation, until it parks
 * the ticket — after `finalizationFailures` rounds its finalization failed
 * instead. Every step is the decider's, the pick is made over the ticket as it
 * stands before the completion that concludes the stage, and the failure it
 * feeds the cap is the one the cap's own previous answer produced.
 */
function dispositionsUnder(
  cyclesMax: number,
  finalizationFailures = 0,
): readonly string[] {
  let graph: TicketGraph = genesis;
  const step = (event: DecisionEvent, policy = plainPolicy) => {
    graph = evolve(graph, decide(graph, event, policy).event);
  };
  const evaluated = (verdict: "EvaluatorPass" | "EvaluatorFail") => {
    const work = owed(graph);
    step(taskDoneEvent(id(1), work, producedReport(work)));
    const judge = owed(graph);
    const disposition = reworkDisposition(ticketAt(graph, id(1)), cyclesMax);
    step(
      taskDoneEvent(id(1), judge, judgedReport(judge, verdict)),
      alwaysPolicy(disposition),
    );
    return disposition;
  };
  step(releaseTicketEvent(plainDefinitionOf(1)));
  step(dispatchEvent(id(1), aDispatchSource));
  for (let failure = 0; failure < finalizationFailures; failure++) {
    evaluated("EvaluatorPass");
    step(finalizationResultEvent(id(1), "FinalizationNeedsWork", 1));
  }
  const picked: string[] = [];
  for (let round = 0; round <= cyclesMax + 1; round++) {
    const disposition = evaluated("EvaluatorFail");
    picked.push(disposition);
    if (disposition === "EscalateEvaluationFailure") return picked;
  }
  throw new Error("rework cap case: the cap never parked the ticket");
}

test("a cap of two reworks the first two failures and parks the third", () => {
  assert.deepEqual(dispositionsUnder(2), [
    "ReworkEvaluationFailure",
    "ReworkEvaluationFailure",
    "EscalateEvaluationFailure",
  ]);
});

test("a cap of one reworks once, and a cap of none parks the first failure", () => {
  assert.deepEqual(dispositionsUnder(1), [
    "ReworkEvaluationFailure",
    "EscalateEvaluationFailure",
  ]);
  assert.deepEqual(dispositionsUnder(0), ["EscalateEvaluationFailure"]);
});

test("a finalizer that failed twice leaves the ticket every rework the cap allows", () => {
  assert.deepEqual(dispositionsUnder(2, 2), [
    "ReworkEvaluationFailure",
    "ReworkEvaluationFailure",
    "EscalateEvaluationFailure",
  ]);
});

test("a cap that is not a whole count of cycles is refused where it is configured", () => {
  assert.deepEqual(checkedReworkCap({ cyclesMax: 0 }), { cyclesMax: 0 });
  for (const cyclesMax of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(
      () => checkedReworkCap({ cyclesMax }),
      /non-negative whole number of cycles/u,
      String(cyclesMax),
    );
});
