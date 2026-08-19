/**
 * The actor's step functions themselves: each guard refuses what the model's
 * action guards refuse, and the carried view honours the carry rule — `(pre,
 * rec)` advance only when a decision lands, and every other step leaves them
 * exactly in place while memory becomes the genuine replay.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dispatchEvent,
  execDecisionEvent,
  releaseTicketEvent,
} from "../../src/actor/decisionEvent.ts";
import { coreEquals } from "../../src/actor/equality.ts";
import { genesis, replayCore } from "../../src/actor/journal.ts";
import {
  actorInit,
  crashRecoverTo,
  effectCrash,
  emitNext,
  journalStep,
  memoryCore,
} from "../../src/actor/state.ts";
import { initRecord } from "../../src/domain/core.ts";
import { id } from "../domain/fixtures.ts";
import { plainAuthoring, refinementInstance } from "./harness.ts";

const config = refinementInstance;
const release = releaseTicketEvent(id(1), plainAuthoring);
const dispatch = dispatchEvent(id(1));

test("the initial state is genesis under the init record, with nothing journaled or emitted", () => {
  const state = actorInit();
  assert.ok(coreEquals(memoryCore(state), genesis));
  assert.deepEqual(state.view.rec, initRecord);
  assert.ok(coreEquals(state.view.pre, genesis));
  assert.deepEqual(
    [state.journal, state.applied, [...state.worldEffects], state.orphans],
    [[], 0, [], []],
  );
});

test("journalStep advances the carried view and appends the next dense seq", () => {
  const before = actorInit();
  const after = journalStep(config, before, release);
  const decision = execDecisionEvent(config, memoryCore(before), release);
  assert.equal(after.view.pre, memoryCore(before));
  assert.deepEqual(after.view.rec, decision.rec);
  assert.ok(coreEquals(after.view.post, decision.post));
  assert.equal(after.journal.length, 1);
  assert.deepEqual(after.journal[0]?.seq, 1);
  assert.deepEqual(after.journal[0]?.event, release);
  assert.equal(after.applied, 0);
});

test("journalStep refuses a decision the machine would not take", () => {
  assert.throws(
    () => journalStep(config, actorInit(), dispatch),
    /journalStep: Dispatch is refused/,
  );
});

test("emitNext carries (pre, rec) untouched and refuses an exhausted journal", () => {
  const journaled = journalStep(config, actorInit(), release);
  const emitted = emitNext(journaled);
  assert.equal(emitted.view, journaled.view);
  assert.equal(emitted.applied, 1);
  assert.deepEqual([...emitted.worldEffects], [1]);
  assert.throws(() => emitNext(emitted), /emitNext: every journaled decision/);
});

test("crashRecoverTo installs the genuine replay, carries (pre, rec), and regresses only inside the run", () => {
  const emitted = emitNext(journalStep(config, actorInit(), release));
  const recovered = crashRecoverTo(config, emitted, 0);
  assert.equal(recovered.view.pre, emitted.view.pre);
  assert.equal(recovered.view.rec, emitted.view.rec);
  assert.ok(
    coreEquals(recovered.view.post, replayCore(config, emitted.journal)),
  );
  assert.equal(recovered.applied, 0);
  assert.deepEqual([...recovered.worldEffects], [1]);
  assert.throws(() => crashRecoverTo(config, emitted, 2), /not a checkpoint/);
  assert.throws(() => crashRecoverTo(config, emitted, -1), /not a checkpoint/);
});

test("effectCrash orphans the decision, reverts memory to the replay, and carries (pre, rec)", () => {
  const emitted = emitNext(journalStep(config, actorInit(), release));
  const crashed = effectCrash(config, emitted, dispatch);
  const lost = execDecisionEvent(config, memoryCore(emitted), dispatch);
  assert.equal(crashed.view.pre, emitted.view.pre);
  assert.equal(crashed.view.rec, emitted.view.rec);
  assert.ok(coreEquals(crashed.view.post, replayCore(config, emitted.journal)));
  assert.equal(crashed.journal, emitted.journal);
  assert.deepEqual(crashed.orphans, [lost.rec]);
  assert.throws(
    () => effectCrash(config, actorInit(), dispatch),
    /effectCrash: Dispatch is refused/,
  );
});
