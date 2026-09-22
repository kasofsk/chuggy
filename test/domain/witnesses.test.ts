/**
 * Each anti-vacuity witness refuted by a step this machine actually takes.
 *
 * A GREEN WITNESS IS A WITNESS THAT PROVED NOTHING. `model/domain.qnt` expects
 * this one violated, and the violation is what makes the invariants beside it
 * mean something: that multi-stage programs really run stage by stage rather
 * than leaving `eval-stage-passed` unfired and the interpreter's advance edge
 * untested.
 *
 * EVERY REFUTATION BELOW COMES OUT OF A DECIDER rather than out of a
 * hand-written record, because a record nobody's machine produced would refute
 * nothing. The last case is the fence: a witness declared with no step that
 * refutes it fails here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { Config } from "../../src/domain/config.ts";

import { decideRevoke, decideTaskDone } from "../../src/domain/deciders.ts";
import { evaluationTaskOf } from "../../src/domain/task.ts";
import type { StepView } from "../../src/domain/invariants.ts";

import { stageAdvanceNever, witnesses } from "../../src/domain/witnesses.ts";
import { modelInstance } from "./configs.ts";
import {
  graphOf,
  depsOf,
  id,
  judgedReport,
  runningInstance,
  ticketOn,
} from "./fixtures.ts";
import type {
  TicketGraph,
  StageDefinition,
} from "../../src/domain/generated/modelTypes.ts";

const config = modelInstance;

/** The view a decision produces, which is the shape a witness is read at. */
function stepped(
  pre: TicketGraph,
  decided: { rec: StepView["rec"]; post: TicketGraph },
): StepView {
  return { pre, rec: decided.rec, post: decided.post };
}

const twoStage: readonly StageDefinition[] = [
  { key: 1, evaluators: [{ key: 1 }] },
  { key: 2, evaluators: [{ key: 1 }] },
];

/** A ticket running the lowest of two stages, with its one evaluator still to answer. */
const midProgram = graphOf([
  ticketOn(config, {
    phase: "Evaluation",
    program: twoStage,
    evaluations: [runningInstance(1, 1, 1, twoStage, new Set())],
    workCyclesStarted: 1,
    spawned: 2,
  }),
]);

/** The answer that concludes that stage, which is the step the witness is read at. */
const judged = evaluationTaskOf(1, 1, 1, 1, 1);

const revoked = ((): StepView => {
  const pre = graphOf([
    ticketOn(config, { phase: "Pending" }),
    ticketOn(config, { phase: "Pending", deps: depsOf(1) }),
  ]);
  return stepped(pre, decideRevoke(pre, id(1)));
})();

const advance = stepped(
  midProgram,
  decideTaskDone(
    midProgram,
    id(1),
    judged,
    judgedReport(judged, "EvaluatorPass"),
    "ReworkEvaluationFailure",
  ),
);

test("an eval stage advances, which is what keeps eval-stage-passed exercised", () => {
  assert.equal(advance.rec.label, "eval-stage-passed");
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
