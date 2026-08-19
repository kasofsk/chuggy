/**
 * The effect-then-journal hazard, deterministically: each run drives the one
 * step the disciplined relation forbids and asserts the exact obligation
 * members that fall at each seam — with the whole domain bundle green on the
 * same step, because the domain machine cannot see the hazard, which is the
 * refinement layer's reason to exist.
 *
 * Every `assertStep` here names its expected failures exactly, so the
 * discipline-independent bundle staying green is checked at every seam by the
 * same assertion that pins the world-facing violations — and belt-and-braces,
 * `refinementCore` is asserted whole wherever the model's suite asserts it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  arriveEvent,
  dequeueEvent,
  dispatchEvent,
  evalReduceEvent,
  releaseEvent,
  taskDoneEvent,
  workReduceEvent,
} from "../../src/actor/decisionEvent.ts";
import {
  obligationsHold,
  refinementCore,
} from "../../src/actor/obligations.ts";
import {
  actorInit,
  effectCrash,
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
import { wExclusive } from "../../src/domain/wrapUp.ts";
import { depsOf, id } from "../domain/fixtures.ts";
import {
  assertStep,
  flatProgram,
  refinementInstance,
  stepEmit,
  walkFirstCycle,
} from "./harness.ts";

const config = refinementInstance;

/** The two world-facing members an orphaned spawn keeps red for the rest of a run. */
const spentWorld = ["journalCoversWorld", "noDoubleSpentBudget"];

/** The Job launches, the actor dies before the journal write, and the recovered actor re-decides. */
function phaseDispatchDoubleSpend(): ActorState {
  let state = actorInit();
  state = stepEmit(
    config,
    state,
    arriveEvent(depsOf(), flatProgram, asProjectId(1), wExclusive(1)),
    "ticket-released",
  );
  state = stepEmit(config, state, releaseEvent(id(1)), "ticket-released");
  state = effectCrash(config, state, dispatchEvent(id(1)));
  assert.equal(state.orphans.length, 1);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "Pending");
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 3);
  assert.equal(worldSpawns(state, id(1)), 1);
  assert.equal(journalSpawns(state, id(1)), 0);
  assertStep(
    config,
    state,
    "an un-keyed Job the book never charged",
    spentWorld,
  );
  assert.ok(obligationsHold(config, state, refinementCore));
  state = journalStep(config, state, dispatchEvent(id(1)));
  assertStep(config, state, "the orphan priced against the re-decided charge", [
    "journalCoversWorld",
  ]);
  state = emitNext(state);
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 2);
  assert.equal(worldSpawns(state, id(1)), 2);
  assert.equal(journalSpawns(state, id(1)), 1);
  assertStep(config, state, "two Jobs on one journaled charge", spentWorld);
  assert.ok(obligationsHold(config, state, refinementCore));
  return state;
}

/** The valid-artifact dequeue merges in the world, the crash eats the journal write, and the diff lands twice. */
function phaseDuplicateCycle(state: ActorState): void {
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(1), "Pass"),
    "task-done",
    spentWorld,
  );
  state = stepEmit(
    config,
    state,
    workReduceEvent(id(1)),
    "work-passed",
    spentWorld,
  );
  state = stepEmit(
    config,
    state,
    taskDoneEvent(id(1), asTaskId(2), "Pass"),
    "task-done",
    spentWorld,
  );
  state = stepEmit(
    config,
    state,
    evalReduceEvent(id(1)),
    "eval-passed",
    spentWorld,
  );
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "PWrapUp");
  state = effectCrash(config, state, dequeueEvent(id(1), false));
  assert.equal(state.orphans.length, 2);
  assert.equal(worldCompletions(state, id(1)), 1);
  assert.equal(ticketAt(memoryCore(state), id(1)).phase, "PWrapUp");
  assert.equal(completionsOf(ticketAt(memoryCore(state), id(1))), 0);
  assertStep(
    config,
    state,
    "the merge the book still shows enqueued",
    spentWorld,
  );
  assert.ok(obligationsHold(config, state, refinementCore));
  state = journalStep(config, state, dequeueEvent(id(1), false));
  state = emitNext(state);
  assert.equal(worldCompletions(state, id(1)), 2);
  assert.equal(journalCompletions(state, id(1)), 1);
  assert.equal(completionsOf(ticketAt(memoryCore(state), id(1))), 1);
  assertStep(
    config,
    state,
    "the same diff merged twice on one clean completion",
    [...spentWorld, "noDuplicateCycle"],
  );
  assert.ok(obligationsHold(config, state, refinementCore));
}

test("the dispatch double-spend and the duplicate cycle, one effect-first crash each", () => {
  phaseDuplicateCycle(phaseDispatchDoubleSpend());
});

/** The disciplined walk to the state whose next decision is the rework. */
function walkToEvalFailure(): ActorState {
  let state = actorInit();
  state = stepEmit(
    config,
    state,
    arriveEvent(depsOf(), flatProgram, asProjectId(1), wExclusive(1)),
    "ticket-released",
  );
  state = walkFirstCycle(config, state, "Fail");
  assert.equal(ticketAt(memoryCore(state), id(1)).gasLeft, 2);
  assert.equal(ticketAt(memoryCore(state), id(1)).reworkLeft, 1);
  return state;
}

test("the rework double-spend: the fan-out launches and the charge dies with the crash", () => {
  let state = walkToEvalFailure();
  state = effectCrash(config, state, evalReduceEvent(id(1)));
  assert.equal(state.orphans.length, 1);
  const recovered = ticketAt(memoryCore(state), id(1));
  assert.equal(recovered.phase, "Evaluating");
  assert.equal(recovered.gasLeft, 2);
  assert.equal(recovered.reworkLeft, 1);
  assert.equal(worldSpawns(state, id(1)), 2);
  assert.equal(journalSpawns(state, id(1)), 1);
  assertStep(config, state, "the fan-out the accounts never paid", spentWorld);
  assert.ok(obligationsHold(config, state, refinementCore));
  state = journalStep(config, state, evalReduceEvent(id(1)));
  assert.equal(state.view.rec.label, "rework-started eval_failure");
  state = emitNext(state);
  const charged = ticketAt(memoryCore(state), id(1));
  assert.equal(charged.gasLeft, 1);
  assert.equal(charged.reworkLeft, 0);
  assert.equal(worldSpawns(state, id(1)), 3);
  assert.equal(journalSpawns(state, id(1)), 2);
  assertStep(
    config,
    state,
    "one journaled charge, a world of extra Jobs",
    spentWorld,
  );
  assert.ok(obligationsHold(config, state, refinementCore));
});
