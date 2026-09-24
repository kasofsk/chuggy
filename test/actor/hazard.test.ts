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
  aDispatchSource,
  aFinalizationEvidence,
} from "../../src/domain/config.ts";
import {
  dispatchTicketCommand,
  reportFinalizationResultCommand,
  createTicketCommand,
  reportTaskTerminalCommand,
} from "../../src/actor/command.ts";
import {
  obligationsHold,
  refinementCore,
} from "../../src/actor/obligations.ts";
import {
  actorInit,
  effectCrash,
  emitNext,
  journalStep,
  memoryGraph,
  memoryLedgers,
  type ActorState,
} from "../../src/actor/state.ts";
import {
  journalCompletions,
  journalSpawns,
  worldCompletions,
  worldSpawns,
} from "../../src/actor/world.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import { phaseOf } from "../../src/domain/phase.ts";
import { ledgerAt } from "../../src/domain/ledger.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import { id, producedReport } from "../domain/fixtures.ts";
import {
  assertStep,
  firstJudgement,
  lastEventOf,
  plainDefinitionOf,
  plainPolicy,
  refinementInstance,
  stepEmit,
  walkToFirstJudgement,
} from "./harness.ts";

const config = refinementInstance;

/** The two world-facing members an orphaned spawn keeps red for the rest of a run. */
const spentWorld = ["journalCoversWorld", "noDoubleSpentWork"];

/** The work set launches, the actor dies before the journal write, and the recovered actor re-decides. */
function phaseDispatchDoubleSpend(): ActorState {
  let state = actorInit();
  state = stepEmit(
    config,
    state,
    createTicketCommand(plainDefinitionOf(1)),
    "TicketCreated",
  );
  state = effectCrash(
    config,
    state,
    dispatchTicketCommand(id(1), aDispatchSource),
    plainPolicy,
  );
  assert.equal(state.orphans.length, 1);
  assert.equal(phaseOf(ticketAt(memoryGraph(state), id(1)).state), "Pending");
  assert.equal(worldSpawns(state, id(1)), 1);
  assert.equal(journalSpawns(state, id(1)), 0);
  assertStep(config, state, "a work set the journal never decided", spentWorld);
  assert.ok(obligationsHold(config, state, refinementCore));
  state = journalStep(
    config,
    state,
    dispatchTicketCommand(id(1), aDispatchSource),
    plainPolicy,
  );
  assertStep(config, state, "the orphan against the re-decided step", [
    "journalCoversWorld",
  ]);
  state = emitNext(state);
  assert.equal(worldSpawns(state, id(1)), 2);
  assert.equal(journalSpawns(state, id(1)), 1);
  assertStep(
    config,
    state,
    "two work sets on one journaled decision",
    spentWorld,
  );
  assert.ok(obligationsHold(config, state, refinementCore));
  return state;
}

/**
 * The finalization result lands in the world, the crash eats the journal write,
 * and the recovered actor completes a second time — the one duplication the
 * point of no return cannot take back.
 */
function phaseDuplicateCycle(state: ActorState): void {
  state = stepEmit(
    config,
    state,
    reportTaskTerminalCommand(producedReport(workTaskIdentity(1, 1))),
    "TicketWorkResultAccepted",
    spentWorld,
  );
  state = stepEmit(
    config,
    state,
    firstJudgement("EvaluatorPass"),
    "TicketEvaluationPassed",
    spentWorld,
  );
  assert.equal(
    phaseOf(ticketAt(memoryGraph(state), id(1)).state),
    "Finalization",
  );
  const succeeded = reportFinalizationResultCommand(id(1), 1, 1, {
    type: "FinalizationSucceeded",
    value: aFinalizationEvidence,
  });
  state = effectCrash(config, state, succeeded, plainPolicy);
  assert.equal(state.orphans.length, 2);
  assert.equal(worldCompletions(state, id(1)), 1);
  assert.equal(journalCompletions(state, id(1)), 0);
  assert.equal(
    phaseOf(ticketAt(memoryGraph(state), id(1)).state),
    "Finalization",
  );
  assert.equal(ledgerAt(memoryLedgers(state), 1).completions, 0);
  assertStep(
    config,
    state,
    "the completion the book still shows running",
    spentWorld,
  );
  assert.ok(obligationsHold(config, state, refinementCore));
  state = journalStep(config, state, succeeded, plainPolicy);
  state = emitNext(state);
  assert.equal(phaseOf(ticketAt(memoryGraph(state), id(1)).state), "Done");
  assert.equal(worldCompletions(state, id(1)), 2);
  assert.equal(journalCompletions(state, id(1)), 1);
  assert.equal(ledgerAt(memoryLedgers(state), 1).completions, 1);
  assertStep(config, state, "one ticket landed twice on one clean completion", [
    ...spentWorld,
    "noDuplicateCycle",
  ]);
  assert.ok(obligationsHold(config, state, refinementCore));
}

test("the duplicate dispatch and the duplicate completion, one effect-first crash each", () => {
  phaseDuplicateCycle(phaseDispatchDoubleSpend());
});

test("the rework crash: the fan-out launches and the step dies with the crash", () => {
  let state = walkToFirstJudgement(config, actorInit());
  const dissenting = firstJudgement("EvaluatorFail");
  state = effectCrash(config, state, dissenting, plainPolicy);
  assert.equal(state.orphans.length, 1);
  const recovered = ticketAt(memoryGraph(state), id(1));
  assert.equal(phaseOf(recovered.state), "Evaluation");
  assert.equal(worldSpawns(state, id(1)), 2);
  assert.equal(journalSpawns(state, id(1)), 1);
  assertStep(
    config,
    state,
    "the fan-out the journal never decided",
    spentWorld,
  );
  assert.ok(obligationsHold(config, state, refinementCore));
  state = journalStep(config, state, dissenting, plainPolicy);
  assert.equal(lastEventOf(state), "TicketEvaluationReworkStarted");
  state = emitNext(state);
  assert.equal(worldSpawns(state, id(1)), 3);
  assert.equal(journalSpawns(state, id(1)), 2);
  assertStep(
    config,
    state,
    "one journaled decision, a world of extra work sets",
    spentWorld,
  );
  assert.ok(obligationsHold(config, state, refinementCore));
});
