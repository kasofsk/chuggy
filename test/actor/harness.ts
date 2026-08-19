/**
 * The refinement instance and the per-step gate the crash-seam suites walk
 * under.
 *
 * The instance transcribes `model/refinement.qnt`'s embedded domain instance
 * whole, the way `test/domain/configs.ts` transcribes the corpus instances: a
 * reader checks it against the model by reading down it. It is fixed tiny at
 * the smallest constants that exercise a rework, because the rework is the
 * re-entry that charges — where a double-spend bites.
 *
 * `assertStep` is the model tests' per-step gate: the whole domain bundle on
 * the carried view, and the named refinement obligations against an exact
 * expected-failure list. The exact list is the point — the crash-seam
 * demonstration is which members fall at which seam, and an inclusion check
 * would let an unexpected member fall in silence.
 */

import assert from "node:assert/strict";

import {
  dispatchEvent,
  releaseTicketEvent,
  taskDoneEvent,
  workReduceEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import {
  failedObligations,
  refinementInvariants,
} from "../../src/actor/obligations.ts";
import {
  emitNext,
  journalStep,
  type ActorState,
} from "../../src/actor/state.ts";
import type { Config } from "../../src/domain/config.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import { budgeted, reworkBudgetOf } from "../../src/domain/pricing.ts";
import type { Stage, Verdict } from "../../src/domain/generated/modelTypes.ts";
import { bundleHolds, evaluateBundle } from "../conformance/evaluate.ts";
import { id } from "../domain/fixtures.ts";

/** The embedded domain instance of `model/refinement.qnt`, field for field. */
export const refinementInstance: Config = {
  nTickets: 2,
  nTasks: 1,
  reworkPolicy: reworkBudgetOf(1),
  gas: 3,
  finalizationPricing: budgeted(1),
  maxStages: 1,
};

/** What a release freezes when a suite does not care which values it froze. */
export const plainAuthoring = {
  deps: new Set<number>(),
  prog: [{ fanout: 1, combinator: "UnanimousPass" }] as readonly Stage[],
  workFanout: 1,
  reworkPolicy: reworkBudgetOf(1),
  finalizationPricing: budgeted(1),
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
} as const;

/** The manifest a task reports when a suite does not care what it reported. */
export const plainResult = { manifest: 1, digest: 1, schema: 1 } as const;

/** The single-stage unanimous program every refinement-model run authors. */
export const flatProgram: readonly Stage[] = [
  { fanout: 1, combinator: "UnanimousPass" },
];

/**
 * The per-step gate: the domain bundle green on the carried view, and the
 * refinement obligations' failures exactly `failed` — empty on a disciplined
 * step, the expected violations at a hazard seam.
 */
export function assertStep(
  config: Config,
  state: ActorState,
  at: string,
  failed: readonly string[] = [],
): void {
  const verdict = evaluateBundle(config, state.view);
  assert.ok(
    bundleHolds(verdict),
    `${at}: the domain bundle went red: ${[...verdict.failed, ...verdict.refused].join(", ")}`,
  );
  assert.deepEqual(
    failedObligations(config, state, refinementInvariants),
    failed,
    `${at}: the refinement obligations disagree with the expected seam`,
  );
}

/**
 * The routine decision-and-emission pair with the gate at both intermediate
 * states and the produced label pinned, exactly the model tests' `stepEmit`.
 * `failed` carries through a hazard trace's tail, where an earlier orphan
 * keeps the expected violations standing.
 */
export function stepEmit(
  config: Config,
  state: ActorState,
  event: DecisionEvent,
  label: string,
  failed: readonly string[] = [],
): ActorState {
  const journaled = journalStep(config, state, event);
  assert.equal(journaled.view.rec.label, label);
  assertStep(config, journaled, `${label} (journaled)`, failed);
  const emitted = emitNext(journaled);
  assertStep(config, emitted, `${label} (emitted)`, failed);
  return emitted;
}

/**
 * The disciplined first cycle every witness run walks after its arrival:
 * release, dispatch, the work set passing, and the eval task resolved with the
 * caller's verdict — the draw that routes the run toward its own seam.
 */
export function walkFirstCycle(
  config: Config,
  state: ActorState,
  evalVerdict: Verdict,
): ActorState {
  state = stepEmit(
    config,
    state,
    releaseTicketEvent(id(1), plainAuthoring),
    "ticket-released",
  );
  state = stepEmit(config, state, dispatchEvent(id(1)), "dispatch");
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
    "task-done",
  );
  state = stepEmit(config, state, workReduceEvent(id(1)), "work-passed");
  return stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(2), evalVerdict, plainResult),
    "task-done",
  );
}
