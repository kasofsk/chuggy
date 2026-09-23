/**
 * Each anti-vacuity witness refuted by a step this machine actually takes.
 *
 * A GREEN WITNESS IS A WITNESS THAT PROVED NOTHING. `model/domain.qnt` expects
 * this one violated, and the violation is what makes the invariants beside it
 * mean something: that multi-stage plans really run stage by stage rather
 * than leaving a progress that owes the next stage unreached and the
 * interpreter's advance edge untested.
 *
 * EVERY REFUTATION BELOW COMES OUT OF A DECIDER rather than out of a
 * hand-written record, because a record nobody's machine produced would refute
 * nothing. The last case is the fence: a witness declared with no step that
 * refutes it fails here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluatorOf, type Config } from "../../src/domain/config.ts";

import {
  alwaysPolicy,
  decideRevoke,
  decideTaskTerminal,
} from "../../src/domain/deciders.ts";
import { evolve } from "../../src/domain/evolve.ts";
import { evaluationTaskOf } from "../../src/domain/task.ts";
import type { StepView } from "../../src/domain/invariants.ts";

import { stageAdvanceNever, witnesses } from "../../src/domain/witnesses.ts";
import { modelInstance } from "./configs.ts";
import {
  acceptedOf,
  graphOf,
  depsOf,
  judgedReport,
  runningInstance,
  ticketOn,
} from "./fixtures.ts";
import type {
  TicketGraph,
  StageDefinition,
  TicketDecision,
} from "../../src/domain/generated/modelTypes.ts";

const config = modelInstance;

/** The view a decision produces, which is the shape a witness is read at. */
function stepped(pre: TicketGraph, taken: TicketDecision): StepView {
  const decision = acceptedOf(taken);
  return {
    pre,
    last: { type: "Decided", value: decision },
    post: evolve(pre, decision.event),
  };
}

const twoStage: readonly StageDefinition[] = [
  { key: 1, evaluators: [evaluatorOf(1)] },
  { key: 2, evaluators: [evaluatorOf(1)] },
];

/** A ticket running the lowest of two stages, with its one evaluator still to answer. */
const midProgram = graphOf([
  ticketOn(config, {
    phase: "Evaluation",
    stages: twoStage,
    evaluations: [runningInstance(1, 1, twoStage, new Set())],
    workCyclesStarted: 1,
    spawned: 2,
  }),
]);

/** The answer that concludes that stage, which is the step the witness is read at. */
const judged = evaluationTaskOf(1, 1, 1, 1, 1);

const revoked = ((): StepView => {
  const pre = graphOf([
    ticketOn(config, { phase: "Pending" }),
    ticketOn(config, { phase: "Pending", dependencies: depsOf(1) }),
  ]);
  return stepped(pre, decideRevoke(pre, 1));
})();

const advance = stepped(
  midProgram,
  decideTaskTerminal(
    midProgram,
    judgedReport(judged, "EvaluatorPass"),
    alwaysPolicy("ReworkEvaluationFailure"),
  ),
);

test("an eval stage advances, which is what keeps the stage advance exercised", () => {
  assert.ok(
    advance.last !== "NoDecision" &&
      advance.last.type === "Decided" &&
      advance.last.value.event.type === "TicketEvaluationProgressed" &&
      advance.last.value.obligations.length > 0,
  );
  assert.ok(!stageAdvanceNever(config, advance));
  assert.ok(stageAdvanceNever(config, revoked));
});

test("every witness the domain declares is refuted by a step this machine takes", () => {
  const refutations: Record<string, { config: Config; view: StepView }> = {
    stageAdvanceNever: { config, view: advance },
  };
  for (const { witness, claim } of witnesses) {
    const refutation = refutations[witness];
    assert.ok(
      refutation !== undefined,
      `${witness} is declared with no step that refutes it, so a run reporting it green proves nothing`,
    );
    assert.ok(
      !claim(refutation.config, refutation.view),
      `${witness} is not violated by the step named for it`,
    );
  }
});
