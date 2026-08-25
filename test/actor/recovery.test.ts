/**
 * The disciplined machine walked with a crash at every observable seam,
 * mirroring the model's refinement witness suite: one ticket through release,
 * dispatch, an eval failure's rework and the finalizer's report, with the
 * domain bundle and every refinement obligation asserted after every single
 * step.
 *
 * The seams are the model's: post-journal pre-emission at the dispatch, the
 * rework and the completion; total cursor loss with every re-emission absorbed
 * by decision identity; and a final full-loss recovery at rest. The
 * finalizer-free run walks the one route that never enters Finalizing, so the
 * same obligations are carried on a ticket whose evaluation is its completion.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  abandonHandoffEvent,
  decisionEventEnabled,
  dispatchEvent,
  evalReduceEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  taskDoneEvent,
  resumeTicketEvent,
  workReduceEvent,
} from "../../src/actor/decisionEvent.ts";
import {
  actorInit,
  crashRecoverTo,
  emitNext,
  journalStep,
  memoryCore,
  type ActorState,
} from "../../src/actor/state.ts";
import {
  journalCompletions,
  journalSpawns,
  worldCompletions,
  worldSpawns,
} from "../../src/actor/world.ts";
import { ticketAt } from "../../src/domain/core.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import { id } from "../domain/fixtures.ts";
import {
  assertStep,
  plainAuthoring,
  plainResult,
  refinementInstance,
  stepEmit,
} from "./harness.ts";

const config = refinementInstance;

/** The release is durable the instant it journals, and the dispatch charge survives its seam. */
function phaseDispatchChargeSurvives(): ActorState {
  let state = journalStep(
    config,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  assert.equal(state.journal.length, 1);
  assertStep(config, state, "release (journaled)");
  state = crashRecoverTo(config, state, 0);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Pending");
  assert.equal(state.applied, 0);
  assert.equal(state.journal.length, 1);
  assertStep(config, state, "crash before the first emission");
  state = emitNext(state);
  assert.equal(state.applied, 1);
  assertStep(config, state, "release (emitted)");
  state = journalStep(config, state, dispatchEvent(id(1)));
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 2);
  assert.equal(journalSpawns(state, id(1)), 1);
  assert.equal(worldSpawns(state, id(1)), 0);
  assertStep(config, state, "dispatch (journaled)");
  state = crashRecoverTo(config, state, 1);
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 2);
  assert.equal(worldSpawns(state, id(1)), 0);
  assert.equal(state.applied, 1);
  assertStep(config, state, "crash at the dispatch seam");
  state = emitNext(state);
  assert.equal(worldSpawns(state, id(1)), 1);
  assert.equal(journalSpawns(state, id(1)), 1);
  assertStep(config, state, "the work set launches exactly once");
  return state;
}

/** The rework's charge survives total cursor loss, and the whole re-emitted prefix absorbs. */
function phaseReworkSurvivesCursorLoss(state: ActorState): ActorState {
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
    "task-done",
  );
  assert.throws(
    () =>
      journalStep(
        config,
        state,
        taskDoneEvent(id(1), asTaskId(1), "Fail", plainResult),
      ),
    /TaskDone is refused/,
    "a task already resolved is no longer outstanding, so a second report is refused",
  );
  assert.equal(state.journal.length, 3);
  state = stepEmit(config, state, workReduceEvent(id(1)), "work-passed");
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(2), "Fail", plainResult),
    "task-done",
  );
  state = journalStep(config, state, evalReduceEvent(id(1)));
  assert.equal(state.view.rec.label, "rework-started eval_failure");
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 1);
  assert.equal(ticketAt(memoryCore(state), id(1)).reworkLeft, 0);
  assert.equal(journalSpawns(state, id(1)), 2);
  assert.equal(worldSpawns(state, id(1)), 1);
  assertStep(config, state, "rework (journaled)");
  state = crashRecoverTo(config, state, 0);
  assert.equal(state.applied, 0);
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 1);
  assert.equal(ticketAt(memoryCore(state), id(1)).reworkLeft, 0);
  assert.equal(worldSpawns(state, id(1)), 1);
  assert.equal(state.worldEffects.size, 5);
  assertStep(config, state, "crash at the rework seam, cursor lost whole");
  state = emitNext(state);
  assert.equal(state.applied, 1);
  assert.equal(state.worldEffects.size, 5);
  assert.equal(worldSpawns(state, id(1)), 1);
  assertStep(config, state, "a re-emission is absorbed by its seq");
  for (let ahead = state.applied; ahead < 5; ahead++) state = emitNext(state);
  assert.equal(state.applied, 5);
  assert.equal(state.worldEffects.size, 5);
  assertStep(config, state, "the whole lost prefix re-emits absorbed");
  state = emitNext(state);
  assert.equal(state.applied, 6);
  assert.equal(state.worldEffects.size, 6);
  assert.equal(worldSpawns(state, id(1)), 2);
  assert.equal(journalSpawns(state, id(1)), 2);
  assertStep(config, state, "the rework's fan-out launches for the first time");
  return state;
}

/** The completion decision is durable before it is told, and the ticket lands exactly once. */
function phaseCompletionLandsOnce(state: ActorState): void {
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(3), "Pass", plainResult),
    "task-done",
  );
  state = stepEmit(config, state, workReduceEvent(id(1)), "work-passed");
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(4), "Pass", plainResult),
    "task-done",
  );
  state = stepEmit(config, state, evalReduceEvent(id(1)), "eval-passed");
  const succeeded = finalizationResultEvent(id(1), "FinalizationSucceeded");
  state = journalStep(config, state, succeeded);
  assert.equal(state.view.rec.label, "ticket-done");
  assert.deepEqual(state.view.rec.effects, []);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(journalCompletions(state, id(1)), 1);
  assert.equal(worldCompletions(state, id(1)), 0);
  assert.ok(!decisionEventEnabled(config, memoryCore(state), succeeded));
  assertStep(config, state, "completion (journaled, untold)");
  state = crashRecoverTo(config, state, 10);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(ticketAt(memoryCore(state), id(1)).completions, 1);
  assert.equal(worldCompletions(state, id(1)), 0);
  assertStep(config, state, "crash at the completion seam");
  state = emitNext(state);
  assert.equal(worldCompletions(state, id(1)), 1);
  assertStep(config, state, "the completion reaches the world");
  state = crashRecoverTo(config, state, 0);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 1);
  assert.equal(state.journal.length, 11);
  while (state.applied < state.journal.length) state = emitNext(state);
  assert.equal(worldCompletions(state, id(1)), 1);
  assert.equal(worldSpawns(state, id(1)), 2);
  assertStep(config, state, "the actor dies at rest and loses nothing");
}

test("crash, recover, continue: the disciplined machine at every observable seam", () => {
  phaseCompletionLandsOnce(
    phaseReworkSurvivesCursorLoss(phaseDispatchChargeSurvives()),
  );
});

function passWorkAndEvaluationTasks(state: ActorState): ActorState {
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
    taskDoneEvent(id(1), asTaskId(2), "Pass", plainResult),
    "task-done",
  );
}

test("post-promotion publication recovers without returning to promotion", () => {
  let state = passWorkAndEvaluationTasks(phaseDispatchChargeSurvives());
  state = stepEmit(config, state, evalReduceEvent(id(1)), "eval-passed");
  state = stepEmit(
    config,
    state,
    finalizationResultEvent(id(1), "PromotionAccepted"),
    "promotion-accepted",
  );
  state = journalStep(
    config,
    state,
    finalizationResultEvent(id(1), "HandoffPublicationUnproven"),
  );
  const blocked = crashRecoverTo(config, state, state.applied);
  assert.equal(ticketAt(memoryCore(blocked), id(1)).phase, "HandoffBlocked");

  let retried = stepEmit(
    config,
    blocked,
    resumeTicketEvent(id(1)),
    "ticket-resumed",
  );
  assert.equal(
    retried.journal.filter((entry) => entry.rec.label === "promotion-accepted")
      .length,
    1,
  );
  retried = journalStep(
    config,
    retried,
    finalizationResultEvent(id(1), "FinalizationSucceeded"),
  );
  assert.equal(ticketAt(memoryCore(retried), id(1)).phase, "Done");

  const abandoned = journalStep(config, blocked, abandonHandoffEvent(id(1)));
  assert.equal(ticketAt(memoryCore(abandoned), id(1)).phase, "Abandoned");
  assert.equal(ticketAt(memoryCore(abandoned), id(1)).completions, 0);
});

/** The finalizer-free ticket journaled to the completion its passing evaluation is. */
function walkFinalizerFreeToCompletion(): ActorState {
  let state = stepEmit(
    config,
    actorInit(),
    releaseTicketEvent(id(1), { ...plainAuthoring, finalizer: "NoFinalizer" }),
    "ticket-released",
  );
  assert.equal(ticketAt(memoryCore(state), id(1)).finalizer, "NoFinalizer");
  state = stepEmit(config, state, dispatchEvent(id(1)), "dispatch");
  state = passWorkAndEvaluationTasks(state);
  state = journalStep(config, state, evalReduceEvent(id(1)));
  assert.equal(state.view.rec.label, "ticket-done");
  assert.deepEqual(state.view.rec.transitions, [
    { ticket: id(1), from: "Evaluating", to: "Done" },
  ]);
  assert.deepEqual(state.view.rec.effects, []);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(journalCompletions(state, id(1)), 1);
  assert.equal(worldCompletions(state, id(1)), 0);
  assertStep(config, state, "the evaluation's pass is the completion");
  return state;
}

test("a finalizer-free ticket recovers at its completion seam and completes exactly once", () => {
  let state = walkFinalizerFreeToCompletion();
  state = crashRecoverTo(config, state, 0);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(ticketAt(memoryCore(state), id(1)).finalizer, "NoFinalizer");
  assert.equal(ticketAt(memoryCore(state), id(1)).completions, 1);
  assert.equal(state.applied, 0);
  assert.equal(worldCompletions(state, id(1)), 0);
  assertStep(config, state, "total loss at the completion seam");
  while (state.applied < state.journal.length) state = emitNext(state);
  assert.equal(state.applied, 6);
  assert.equal(worldCompletions(state, id(1)), 1);
  assert.equal(worldSpawns(state, id(1)), 1);
  const ranFinalizer = state.journal.some(
    (entry) =>
      entry.rec.effects.includes("RunFinalizer") ||
      entry.rec.transitions.some(
        (transition) => transition.to === "Finalizing",
      ),
  );
  assert.ok(
    !ranFinalizer,
    "no journaled decision runs a finalizer, so the pass alone completed the ticket",
  );
  assertStep(
    config,
    state,
    "the whole journal re-emitted, the completion landed once",
  );
});
