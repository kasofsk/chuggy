/**
 * Each anti-vacuity witness refuted by a step this machine actually takes.
 *
 * A GREEN WITNESS IS A WITNESS THAT PROVED NOTHING. `model/domain.qnt` expects
 * every one of these violated, and the violation is what makes the invariants
 * beside them mean something: that a free pipeline resume really climbs the
 * measure and really needs its exemption arm, that the cascade really parks
 * dependents on reachable states rather than leaving `cascadeSafety` vacuous,
 * and that multi-stage programs really run stage by stage rather than leaving
 * the stage digit unexercised.
 *
 * EVERY REFUTATION BELOW COMES OUT OF A DECIDER rather than out of a
 * hand-written record, because a record nobody's machine produced would refute
 * nothing. The last case is the fence: a witness declared with no step that
 * refutes it fails here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { boundsOf, type Config } from "../../src/domain/config.ts";
import type { Core } from "../../src/domain/core.ts";
import {
  decideEvalStageReduce,
  decideOpRetry,
  decideRevoke,
} from "../../src/domain/deciders.ts";
import type { StepView } from "../../src/domain/invariants.ts";
import { sysMeasure } from "../../src/domain/measure.ts";
import type { Stage } from "../../src/domain/program.ts";
import {
  cascadeParkNever,
  freeClimbNever,
  stageAdvanceNever,
  witnesses,
} from "../../src/domain/witnesses.ts";
import { budgetedInstance, retryFreeInstance } from "./configs.ts";
import { coreOf, evalTask, id, ticketOn, workTask } from "./fixtures.ts";

const config = budgetedInstance;
const free = retryFreeInstance;

/** The view a decision produces, which is the shape a witness is read at. */
function stepped(
  pre: Core,
  decided: { rec: StepView["rec"]; post: Core },
): StepView {
  return { pre, rec: decided.rec, post: decided.post };
}

/** A ticket parked behind a pipeline wall, whose resume the metering decides the price of. */
function parkedAtEvaluation(instance: Config, gasLeft: number): Core {
  return coreOf([
    ticketOn(instance, 1, {
      phase: "PEscalated",
      reason: "RsReworkBudgetExhausted",
      resumeAt: "REvaluating",
      reworkLeft: 0,
      gasLeft,
    }),
  ]);
}

const twoStage: readonly Stage[] = [
  { fanout: 1, combinator: "CUnanimousPass" },
  { fanout: 1, combinator: "CUnanimousPass" },
];

/** A ticket whose lowest eval stage has just passed with a later stage still to run. */
const midProgram = coreOf([
  ticketOn(config, 1, {
    phase: "PEvaluating",
    program: twoStage,
    record: [workTask(1, "TPassed"), workTask(2, "TPassed")],
    tasks: [evalTask(3, 0, "TPassed")],
    spawned: 3,
  }),
]);

const freeResume = ((): StepView => {
  const pre = parkedAtEvaluation(free, 0);
  return stepped(pre, decideOpRetry(free, pre, id(1)));
})();

const cascade = ((): StepView => {
  const pre = coreOf([
    ticketOn(config, 1, { phase: "PPending" }),
    ticketOn(config, 1, { phase: "PDraft", deps: [id(1)] }),
  ]);
  return stepped(pre, decideRevoke(pre, id(1)));
})();

const advance = stepped(
  midProgram,
  decideEvalStageReduce(config, midProgram, id(1)),
);

test("a free pipeline resume climbs the measure, which is what the churn arm exempts", () => {
  assert.equal(freeResume.rec.label, "operator-retry");
  assert.ok(
    sysMeasure(boundsOf(free), freeResume.post) >
      sysMeasure(boundsOf(free), freeResume.pre),
  );
  assert.ok(
    !freeClimbNever(free, freeResume),
    "the witness has to be violated here, or the arm it justifies is dead code",
  );
});

test("a charged pipeline resume pays for itself, so the same witness holds", () => {
  const pre = parkedAtEvaluation(config, config.gas);
  const charged = stepped(pre, decideOpRetry(config, pre, id(1)));
  assert.ok(
    sysMeasure(boundsOf(config), charged.post) <
      sysMeasure(boundsOf(config), charged.pre),
  );
  assert.ok(freeClimbNever(config, charged));
});

test("a revoke parks its pre-flight dependents, which is what keeps cascadeSafety from being vacuous", () => {
  assert.equal(cascade.rec.label, "ticket-revoked");
  assert.equal(cascade.rec.transitions.length, 2);
  assert.ok(!cascadeParkNever(config, cascade));
  const lone = coreOf([ticketOn(config, 1, { phase: "PPending" })]);
  assert.ok(
    cascadeParkNever(config, stepped(lone, decideRevoke(lone, id(1)))),
    "a revoke with nothing hanging off it parks nobody",
  );
});

test("an eval stage advances, which is what keeps the stage digit exercised", () => {
  assert.equal(advance.rec.label, "eval-stage-passed");
  assert.ok(!stageAdvanceNever(config, advance));
  assert.ok(stageAdvanceNever(config, cascade));
});

test("every witness the domain declares is refuted by a step this machine takes", () => {
  const refutations: Record<string, { config: Config; view: StepView }> = {
    freeClimbNever: { config: free, view: freeResume },
    cascadeParkNever: { config, view: cascade },
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
