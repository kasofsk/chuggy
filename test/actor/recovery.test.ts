/**
 * The disciplined machine walked with a crash at every observable seam,
 * mirroring the model's refinement witness suite: one ticket through arrive,
 * dispatch, an eval failure's rework, and the wrap-up, with the domain bundle
 * and every refinement obligation asserted after every single step.
 *
 * The seams are the model's: post-journal pre-emission at the dispatch, the
 * rework and the completion; total cursor loss with every re-emission absorbed
 * by decision identity; and a final full-loss recovery at rest. The lease-free
 * run walks the one route that never enters a wrap-up phase, so the same
 * obligations are carried on a ticket that never takes a lease.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  arriveEvent,
  completeDuplicateEvent,
  dequeueEvent,
  dispatchEvent,
  evalReduceEvent,
  releaseEvent,
  taskDoneEvent,
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
import { asProjectId, asTaskId } from "../../src/domain/ids.ts";
import { completionsOf } from "../../src/domain/ticket.ts";
import { wExclusive, wNone, woNone } from "../../src/domain/wrapUp.ts";
import { depsOf, id } from "../domain/fixtures.ts";
import {
  assertStep,
  flatProgram,
  refinementInstance,
  stepEmit,
  walkFirstCycle,
} from "./harness.ts";

const config = refinementInstance;

/** The Draft is durable the instant it journals, and the dispatch charge survives its seam. */
function phaseDispatchChargeSurvives(): ActorState {
  let state = journalStep(
    config,
    actorInit(),
    arriveEvent(depsOf(), flatProgram, asProjectId(1), wExclusive(1)),
  );
  assert.equal(state.journal.length, 1);
  assertStep(config, state, "arrive (journaled)");
  state = crashRecoverTo(config, state, 0);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "PDraft");
  assert.equal(state.applied, 0);
  assert.equal(state.journal.length, 1);
  assertStep(config, state, "crash before the first emission");
  state = emitNext(state);
  assert.equal(state.applied, 1);
  assertStep(config, state, "arrive (emitted)");
  state = stepEmit(config, state, releaseEvent(id(1)), "ticket-released");
  state = journalStep(config, state, dispatchEvent(id(1)));
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 2);
  assert.equal(journalSpawns(state, id(1)), 1);
  assert.equal(worldSpawns(state, id(1)), 0);
  assertStep(config, state, "dispatch (journaled)");
  state = crashRecoverTo(config, state, 2);
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 2);
  assert.equal(worldSpawns(state, id(1)), 0);
  assert.equal(state.applied, 2);
  assertStep(config, state, "crash at the dispatch seam");
  state = emitNext(state);
  assert.equal(worldSpawns(state, id(1)), 1);
  assert.equal(journalSpawns(state, id(1)), 1);
  assertStep(config, state, "the Job launches exactly once");
  return state;
}

/** The rework's charge survives total cursor loss, and the whole re-emitted prefix absorbs. */
function phaseReworkSurvivesCursorLoss(state: ActorState): ActorState {
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(1), "Pass"),
    "task-done",
  );
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(1), "Fail"),
    "task-done-duplicate",
  );
  assert.equal(state.journal.length, 5);
  state = stepEmit(config, state, workReduceEvent(id(1)), "work-passed");
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(2), "Fail"),
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
  assert.equal(state.worldEffects.size, 7);
  assertStep(config, state, "crash at the rework seam, cursor lost whole");
  state = emitNext(state);
  assert.equal(state.applied, 1);
  assert.equal(state.worldEffects.size, 7);
  assert.equal(worldSpawns(state, id(1)), 1);
  assertStep(config, state, "a re-emission is absorbed by its seq");
  for (let ahead = state.applied; ahead < 7; ahead++) state = emitNext(state);
  assert.equal(state.applied, 7);
  assert.equal(state.worldEffects.size, 7);
  assertStep(config, state, "the whole lost prefix re-emits absorbed");
  state = emitNext(state);
  assert.equal(state.applied, 8);
  assert.equal(state.worldEffects.size, 8);
  assert.equal(worldSpawns(state, id(1)), 2);
  assert.equal(journalSpawns(state, id(1)), 2);
  assertStep(config, state, "the rework's fan-out launches for the first time");
  return state;
}

/** The completion decision is durable before the merge, and the merge lands exactly once. */
function phaseCompletionLandsOnce(state: ActorState): void {
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(3), "Pass"),
    "task-done",
  );
  state = stepEmit(config, state, workReduceEvent(id(1)), "work-passed");
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(4), "Pass"),
    "task-done",
  );
  state = stepEmit(config, state, evalReduceEvent(id(1)), "eval-passed");
  state = journalStep(config, state, dequeueEvent(id(1), false));
  assert.equal(state.view.rec.label, "ticket-done");
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(journalCompletions(state, id(1)), 1);
  assert.equal(worldCompletions(state, id(1)), 0);
  assertStep(config, state, "completion (journaled, unmerged)");
  state = crashRecoverTo(config, state, 12);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(completionsOf(ticketAt(memoryCore(state), id(1))), 1);
  assert.equal(worldCompletions(state, id(1)), 0);
  assertStep(config, state, "crash at the completion seam");
  state = emitNext(state);
  assert.equal(worldCompletions(state, id(1)), 1);
  assertStep(config, state, "the merge lands");
  state = stepEmit(
    config,
    state,
    completeDuplicateEvent(id(1)),
    "complete-duplicate",
  );
  assert.equal(worldCompletions(state, id(1)), 1);
  state = crashRecoverTo(config, state, 0);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 1);
  assert.equal(state.journal.length, 14);
  assert.equal(worldCompletions(state, id(1)), 1);
  assert.equal(worldSpawns(state, id(1)), 2);
  assertStep(config, state, "the actor dies at rest and loses nothing");
}

test("crash, recover, continue: the disciplined machine at every observable seam", () => {
  phaseCompletionLandsOnce(
    phaseReworkSurvivesCursorLoss(phaseDispatchChargeSurvives()),
  );
});

/** The lease-free ticket journaled to the completion its passing evaluation is. */
function walkLeaseFreeToCompletion(): ActorState {
  let state = journalStep(
    config,
    actorInit(),
    arriveEvent(depsOf(), flatProgram, asProjectId(1), wNone),
  );
  assert.equal(ticketAt(memoryCore(state), id(1)).wrapUp.wrapUp, "WNone");
  assert.equal(state.journal.length, 1);
  assertStep(config, state, "lease-free arrive (journaled)");
  state = emitNext(state);
  assert.equal(state.applied, 1);
  assertStep(config, state, "lease-free arrive (emitted)");
  state = walkFirstCycle(config, state, "Pass");
  state = journalStep(config, state, evalReduceEvent(id(1)));
  assert.equal(state.view.rec.label, "ticket-done");
  assert.deepEqual(state.view.rec.transitions, [
    { ticket: id(1), from: "Evaluating", to: "Done" },
  ]);
  assert.deepEqual(state.view.rec.attempt, woNone);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(journalCompletions(state, id(1)), 1);
  assert.equal(worldCompletions(state, id(1)), 0);
  assertStep(config, state, "the evaluation's pass is the completion");
  return state;
}

test("a lease-free ticket recovers at its completion seam and completes exactly once", () => {
  let state = walkLeaseFreeToCompletion();
  state = crashRecoverTo(config, state, 0);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Done");
  assert.equal(ticketAt(memoryCore(state), id(1)).wrapUp.wrapUp, "WNone");
  assert.equal(completionsOf(ticketAt(memoryCore(state), id(1))), 1);
  assert.equal(state.applied, 0);
  assert.equal(worldCompletions(state, id(1)), 0);
  assertStep(config, state, "total loss at the completion seam");
  while (state.applied < state.journal.length) state = emitNext(state);
  assert.equal(state.applied, 7);
  assert.equal(worldCompletions(state, id(1)), 1);
  assert.equal(worldSpawns(state, id(1)), 1);
  const enteredGate = state.journal.some((entry) =>
    entry.rec.transitions.some(
      (transition) =>
        transition.to === "PWrapUp" || transition.to === "PWrapUpHolding",
    ),
  );
  assert.ok(
    !enteredGate,
    "no journaled transition enters a wrap-up phase, so no lease was ever taken",
  );
  assertStep(
    config,
    state,
    "the whole journal re-emitted, completion landed once",
  );
});
