/**
 * The refinement instance and the per-step gate the crash-seam suites walk
 * under.
 *
 * The instance transcribes `model/refinement.qnt`'s embedded domain instance
 * whole, the way `test/domain/configs.ts` transcribes the corpus instances: a
 * reader checks it against the model by reading down it. It is fixed tiny at
 * the smallest constants that exercise a rework, because the rework is the
 * re-entry a crash can double.
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
import {
  aDispatchSource,
  evaluatorOf,
  releasedTicketOf,
  type Config,
} from "../../src/domain/config.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import type {
  EvaluationFailureDisposition,
  EvaluationVerdict,
  ReleasedTicket,
  StageDefinition,
} from "../../src/domain/generated/modelTypes.ts";
import type { ReleaseAuthoring } from "../../src/interpreter/authoring.ts";
import { bundleHolds, evaluateBundle } from "../conformance/evaluate.ts";
import { id, judgedReport, producedReport } from "../domain/fixtures.ts";

/** The embedded domain instance of `model/refinement.qnt`, field for field. */
export const refinementInstance: Config = {
  nTickets: 2,
  nTasks: 1,
  maxStages: 1,
};

/** The single-stage plan every refinement-model run is released with. */
export const flatPlan: readonly StageDefinition[] = [
  { key: 1, evaluators: [evaluatorOf(1)] },
];

/** What a release freezes when a suite cares only which id it took and which ids it waits on. */
export function plainDefinitionOf(
  ticket: number,
  dependencies: ReadonlySet<number> = new Set<number>(),
): ReleasedTicket {
  return releasedTicketOf(ticket, dependencies, flatPlan);
}

/** What a release freezes when a suite does not care which values it froze. */
export const plainDefinition: ReleasedTicket = plainDefinitionOf(1);

/**
 * What an author chose when a suite cares only that a draft has semantics. The
 * definition above is what a release resolves from it; a draft holds neither
 * the definition nor a way to resolve one.
 */
export const plainAuthoring: ReleaseAuthoring = {
  deps: new Set<number>(),
  prog: [{ key: 1, evaluators: [{ key: 1 }] }],
};

/** The disposition a completion rides when the suite is not steering a failure. */
export const plainDisposition = "ReworkEvaluationFailure" as const;

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
 * The disciplined walk to the state whose next decision is the first stage's
 * one evaluator answering: release, dispatch, the work task producing, and the
 * reduce that opens the judgement.
 */
export function walkToFirstJudgement(
  config: Config,
  state: ActorState,
): ActorState {
  state = stepEmit(
    config,
    state,
    releaseTicketEvent(plainDefinition),
    "ticket-released",
  );
  state = stepEmit(
    config,
    state,
    dispatchEvent(id(1), aDispatchSource),
    "dispatch",
  );
  const work = workTaskOf(1, 1);
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), work, producedReport(work), plainDisposition),
    "task-done",
  );
  return stepEmit(config, state, workReduceEvent(id(1)), "work-passed");
}

/** That stage's one evaluator answering with `verdict`, which is the step that concludes it. */
export function firstJudgement(
  verdict: EvaluationVerdict,
  onFailure: EvaluationFailureDisposition = plainDisposition,
): DecisionEvent {
  const judge = evaluationTaskOf(1, 1, 1, 1, 1);
  return taskDoneEvent(id(1), judge, judgedReport(judge, verdict), onFailure);
}
