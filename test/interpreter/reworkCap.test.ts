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
  dispatchEvent,
  evalReduceEvent,
  execDecisionEvent,
  releaseTicketEvent,
  taskDoneEvent,
  workReduceEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { genesis } from "../../src/actor/journal.ts";
import { ticketAt } from "../../src/domain/core.ts";
import type { Core } from "../../src/domain/generated/modelTypes.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import {
  checkedReworkCap,
  reworkDisposition,
} from "../../src/interpreter/reworkCap.ts";
import {
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

const config = refinementInstance;

/** The one outstanding task of a single-width ticket, which is what a completion names. */
function outstanding(core: Core): number {
  const task = [...ticketAt(core, id(1)).tasks].find(
    (candidate) => candidate.state === "Outstanding",
  );
  if (task === undefined)
    throw new Error("rework cap case: the ticket has no outstanding task");
  return task.id;
}

/**
 * The dispositions the cap picks, one per failing evaluation, until it parks
 * the ticket. Every step is the decider's, and the failure it feeds the cap is
 * the one the cap's own previous answer produced.
 */
function dispositionsUnder(cyclesMax: number): readonly string[] {
  let core: Core = genesis;
  const step = (event: DecisionEvent) => {
    core = execDecisionEvent(config, core, event).post;
  };
  step(releaseTicketEvent(id(1), plainAuthoring));
  step(dispatchEvent(id(1)));
  const picked: string[] = [];
  for (let round = 0; round <= cyclesMax + 1; round++) {
    step(
      taskDoneEvent(id(1), asTaskId(outstanding(core)), "Pass", plainResult),
    );
    step(workReduceEvent(id(1)));
    step(
      taskDoneEvent(id(1), asTaskId(outstanding(core)), "Fail", plainResult),
    );
    const disposition = reworkDisposition(ticketAt(core, id(1)), cyclesMax);
    picked.push(disposition);
    step(evalReduceEvent(id(1), disposition));
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

test("a cap that is not a whole count of cycles is refused where it is configured", () => {
  assert.deepEqual(checkedReworkCap({ cyclesMax: 0 }), { cyclesMax: 0 });
  for (const cyclesMax of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(
      () => checkedReworkCap({ cyclesMax }),
      /non-negative whole number of cycles/u,
      String(cyclesMax),
    );
});
