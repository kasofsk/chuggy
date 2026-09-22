/**
 * The disciplined machine walked with a crash at every observable seam,
 * mirroring the model's refinement witness suite: one ticket through release,
 * dispatch, an eval failure's rework and the finalizer's report, with the
 * domain bundle and every refinement obligation asserted after every single
 * step.
 *
 * The seams are the model's: post-journal pre-emission at the dispatch, the
 * rework and the completion; total cursor loss with every re-emission absorbed
 * by decision identity; and a final full-loss recovery at rest.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { aDispatchSource } from "../../src/domain/config.ts";
import {
  decisionEventEnabled,
  dispatchEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  taskDoneEvent,
  workReduceEvent,
} from "../../src/actor/decisionEvent.ts";
import {
  actorInit,
  crashRecoverTo,
  emitNext,
  journalStep,
  memoryGraph,
  type ActorState,
} from "../../src/actor/state.ts";
import {
  journalCompletions,
  journalSpawns,
  worldCompletions,
  worldSpawns,
} from "../../src/actor/world.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import { id, judgedReport, producedReport } from "../domain/fixtures.ts";
import {
  assertStep,
  plainDefinitionOf,
  plainDisposition,
  refinementInstance,
  stepEmit,
} from "./harness.ts";

const config = refinementInstance;

/** The release is durable the instant it journals, and the dispatch survives its seam. */
function phaseDispatchSurvives(): ActorState {
  let state = journalStep(
    config,
    actorInit(),
    releaseTicketEvent(plainDefinitionOf(1)),
  );
  assert.equal(state.journal.length, 1);
  assertStep(config, state, "release (journaled)");
  state = crashRecoverTo(state, 0);
  assert.equal(ticketAt(memoryGraph(state), id(1)).phase, "Pending");
  assert.equal(state.applied, 0);
  assert.equal(state.journal.length, 1);
  assertStep(config, state, "crash before the first emission");
  state = emitNext(state);
  assert.equal(state.applied, 1);
  assertStep(config, state, "release (emitted)");
  state = journalStep(config, state, dispatchEvent(id(1), aDispatchSource));
  assert.equal(journalSpawns(state, id(1)), 1);
  assert.equal(worldSpawns(state, id(1)), 0);
  assertStep(config, state, "dispatch (journaled)");
  state = crashRecoverTo(state, 1);
  assert.equal(worldSpawns(state, id(1)), 0);
  assert.equal(state.applied, 1);
  assertStep(config, state, "crash at the dispatch seam");
  state = emitNext(state);
  assert.equal(worldSpawns(state, id(1)), 1);
  assert.equal(journalSpawns(state, id(1)), 1);
  assertStep(config, state, "the work set launches exactly once");
  return state;
}

/** The rework survives total cursor loss, and the whole re-emitted prefix absorbs. */
function phaseReworkSurvivesCursorLoss(state: ActorState): ActorState {
  const work = workTaskOf(1, 1);
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), work, producedReport(work), plainDisposition),
    "task-done",
  );
  assert.throws(
    () =>
      journalStep(
        config,
        state,
        taskDoneEvent(id(1), work, producedReport(work), plainDisposition),
      ),
    /TaskDone is refused/,
    "a task already resolved is no longer outstanding, so a second report is refused",
  );
  assert.equal(state.journal.length, 3);
  state = stepEmit(config, state, workReduceEvent(id(1)), "work-passed");
  const dissenter = evaluationTaskOf(1, 1, 1, 1, 1);
  state = journalStep(
    config,
    state,
    taskDoneEvent(
      id(1),
      dissenter,
      judgedReport(dissenter, "EvaluatorFail"),
      "ReworkEvaluationFailure",
    ),
  );
  assert.equal(state.view.rec.label, "rework-started eval_failure");
  assert.equal(journalSpawns(state, id(1)), 2);
  assert.equal(worldSpawns(state, id(1)), 1);
  assertStep(config, state, "rework (journaled)");
  state = crashRecoverTo(state, 0);
  assert.equal(state.applied, 0);
  assert.equal(worldSpawns(state, id(1)), 1);
  assert.equal(state.worldEffects.size, 4);
  assertStep(config, state, "crash at the rework seam, cursor lost whole");
  state = emitNext(state);
  assert.equal(state.applied, 1);
  assert.equal(state.worldEffects.size, 4);
  assert.equal(worldSpawns(state, id(1)), 1);
  assertStep(config, state, "a re-emission is absorbed by its seq");
  for (let ahead = state.applied; ahead < 4; ahead++) state = emitNext(state);
  assert.equal(state.applied, 4);
  assert.equal(state.worldEffects.size, 4);
  assertStep(config, state, "the whole lost prefix re-emits absorbed");
  state = emitNext(state);
  assert.equal(state.applied, 5);
  assert.equal(state.worldEffects.size, 5);
  assert.equal(worldSpawns(state, id(1)), 2);
  assert.equal(journalSpawns(state, id(1)), 2);
  assertStep(config, state, "the rework's fan-out launches for the first time");
  return state;
}

/** The completion decision is durable before it is told, and the ticket lands exactly once. */
function phaseCompletionLandsOnce(state: ActorState): void {
  const rework = workTaskOf(1, 2);
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), rework, producedReport(rework), plainDisposition),
    "task-done",
  );
  state = stepEmit(config, state, workReduceEvent(id(1)), "work-passed");
  const judge = evaluationTaskOf(1, 2, 1, 1, 1);
  state = stepEmit(
    config,
    state,
    taskDoneEvent(
      id(1),
      judge,
      judgedReport(judge, "EvaluatorPass"),
      plainDisposition,
    ),
    "eval-passed",
  );
  const succeeded = finalizationResultEvent(id(1), "FinalizationSucceeded");
  state = journalStep(config, state, succeeded);
  assert.equal(state.view.rec.label, "ticket-done");
  assert.deepEqual(state.view.rec.effects, []);
  assert.equal(ticketAt(memoryGraph(state), id(1)).phase, "Done");
  assert.equal(journalCompletions(state, id(1)), 1);
  assert.equal(worldCompletions(state, id(1)), 0);
  assert.ok(!decisionEventEnabled(config, memoryGraph(state), succeeded));
  assertStep(config, state, "completion (journaled, untold)");
  state = crashRecoverTo(state, 8);
  assert.equal(ticketAt(memoryGraph(state), id(1)).phase, "Done");
  assert.equal(ticketAt(memoryGraph(state), id(1)).completions, 1);
  assert.equal(worldCompletions(state, id(1)), 0);
  assertStep(config, state, "crash at the completion seam");
  state = emitNext(state);
  assert.equal(worldCompletions(state, id(1)), 1);
  assertStep(config, state, "the completion reaches the world");
  state = crashRecoverTo(state, 0);
  assert.equal(ticketAt(memoryGraph(state), id(1)).phase, "Done");
  assert.equal(state.journal.length, 9);
  while (state.applied < state.journal.length) state = emitNext(state);
  assert.equal(worldCompletions(state, id(1)), 1);
  assert.equal(worldSpawns(state, id(1)), 2);
  assertStep(config, state, "the actor dies at rest and loses nothing");
}

test("crash, recover, continue: the disciplined machine at every observable seam", () => {
  phaseCompletionLandsOnce(
    phaseReworkSurvivesCursorLoss(phaseDispatchSurvives()),
  );
});
