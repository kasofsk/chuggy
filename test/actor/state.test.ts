/**
 * The actor's step functions themselves: a refused command is answered and
 * journals nothing, a malformed one is not taken at all, and the carried view
 * honours the carry rule — `(pre, last)` advance only when a decision or a
 * refusal lands, and every other step leaves them exactly in place while
 * memory becomes the genuine replay.
 */

import { aDispatchSource } from "../../src/domain/config.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createTicketCommand,
  dispatchTicketCommand,
} from "../../src/actor/command.ts";
import { decide } from "../../src/domain/deciders.ts";
import { graphEquals } from "../../src/domain/equality.ts";
import { evolve } from "../../src/domain/evolve.ts";
import { genesis, replayGraph } from "../../src/actor/journal.ts";
import {
  actorInit,
  crashRecoverTo,
  effectCrash,
  emitNext,
  journalStep,
  memoryGraph,
} from "../../src/actor/state.ts";
import { acceptedOf, id } from "../domain/fixtures.ts";
import {
  plainDefinitionOf,
  plainPolicy,
  refinementInstance,
} from "./harness.ts";

const config = refinementInstance;
const release = createTicketCommand(plainDefinitionOf(1));
const dispatch = dispatchTicketCommand(id(1), aDispatchSource);

test("the initial state is genesis with no decision, nothing journaled or emitted", () => {
  const state = actorInit();
  assert.ok(graphEquals(memoryGraph(state), genesis));
  assert.equal(state.view.last, "NoDecision");
  assert.ok(graphEquals(state.view.pre, genesis));
  assert.deepEqual(
    [state.journal, state.applied, [...state.worldEffects], state.orphans],
    [[], 0, [], []],
  );
});

test("journalStep journals the decided event, evolves memory by it, and appends the next dense seq", () => {
  const before = actorInit();
  const after = journalStep(config, before, release, plainPolicy);
  const decision = acceptedOf(
    decide(memoryGraph(before), release, plainPolicy),
  );
  assert.equal(after.view.pre, memoryGraph(before));
  assert.deepEqual(after.view.last, { type: "Decided", value: decision });
  assert.ok(
    graphEquals(after.view.post, evolve(memoryGraph(before), decision.event)),
  );
  assert.equal(after.journal.length, 1);
  assert.deepEqual(after.journal[0], { seq: 1, event: decision.event });
  assert.equal(after.applied, 0);
});

test("journalStep answers a refused command, moves nothing and journals nothing", () => {
  const before = actorInit();
  const after = journalStep(config, before, dispatch, plainPolicy);
  assert.deepEqual(after.view, {
    pre: memoryGraph(before),
    last: { type: "Refused", value: { type: "TicketNotFound", value: 1 } },
    post: memoryGraph(before),
  });
  assert.equal(after.journal, before.journal);
  assert.equal(after.applied, before.applied);
});

test("journalStep does not take a command outside the machine's bounds", () => {
  assert.throws(
    () =>
      journalStep(
        config,
        actorInit(),
        dispatchTicketCommand(id(1), 0),
        plainPolicy,
      ),
    /journalStep: DispatchTicket is not a well-formed command/,
  );
});

test("emitNext carries (pre, last) untouched and refuses an exhausted journal", () => {
  const journaled = journalStep(config, actorInit(), release, plainPolicy);
  const emitted = emitNext(journaled);
  assert.equal(emitted.view, journaled.view);
  assert.equal(emitted.applied, 1);
  assert.deepEqual([...emitted.worldEffects], [1]);
  assert.throws(() => emitNext(emitted), /emitNext: every journaled decision/);
});

test("crashRecoverTo installs the genuine replay, carries (pre, last), and regresses only inside the run", () => {
  const emitted = emitNext(
    journalStep(config, actorInit(), release, plainPolicy),
  );
  const recovered = crashRecoverTo(emitted, 0);
  assert.equal(recovered.view.pre, emitted.view.pre);
  assert.equal(recovered.view.last, emitted.view.last);
  assert.ok(graphEquals(recovered.view.post, replayGraph(emitted.journal)));
  assert.equal(recovered.applied, 0);
  assert.deepEqual([...recovered.worldEffects], [1]);
  assert.throws(() => crashRecoverTo(emitted, 2), /not a checkpoint/);
  assert.throws(() => crashRecoverTo(emitted, -1), /not a checkpoint/);
});

test("effectCrash orphans the decided event, reverts memory to the replay, and carries (pre, last)", () => {
  const emitted = emitNext(
    journalStep(config, actorInit(), release, plainPolicy),
  );
  const crashed = effectCrash(config, emitted, dispatch, plainPolicy);
  const lost = acceptedOf(decide(memoryGraph(emitted), dispatch, plainPolicy));
  assert.equal(crashed.view.pre, emitted.view.pre);
  assert.equal(crashed.view.last, emitted.view.last);
  assert.ok(graphEquals(crashed.view.post, replayGraph(emitted.journal)));
  assert.equal(crashed.journal, emitted.journal);
  assert.deepEqual(crashed.orphans, [lost.event]);
  assert.throws(
    () => effectCrash(config, actorInit(), dispatch, plainPolicy),
    /effectCrash: DispatchTicket is refused/,
  );
});
