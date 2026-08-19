/**
 * The positional-subject rule, and the two shapes that decide whether it was
 * written as a rule or as a shortcut.
 *
 * The revoke is the case that separates them: it records the revocation and
 * every cascade park in one decision, effect for transition, so
 * `transitions[0].ticket` would attribute the dependent's desk task to the
 * revoked ticket. The arrival is the other: one effect, no transition, and a
 * subject that exists only in the post-state.
 *
 * The routing is walked constructor by constructor over `allEffects` rather
 * than over a list written here, so an effect added without a port lands as a
 * failing case instead of as a silent arm.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { arriveEvent, revokeEvent } from "../../src/actor/decisionEvent.ts";
import type { Entry } from "../../src/actor/journal.ts";
import {
  actorInit,
  journalStep,
  type ActorState,
} from "../../src/actor/state.ts";
import { deskStub } from "../../src/adapters/deskStub.ts";
import { fabricStub } from "../../src/adapters/fabricStub.ts";

import { allEffects, type Effect } from "../../src/domain/effect.ts";
import { asProjectId, type TicketId } from "../../src/domain/ids.ts";
import { wNone } from "../../src/domain/wrapUp.ts";
import {
  arrivalLabel,
  emissionsOf,
  perform,
} from "../../src/interpreter/interpret.ts";
import type { Emission } from "../../src/interpreter/ports.ts";
import { flatProgram, refinementInstance } from "../actor/harness.ts";
import { depsOf, id } from "../domain/fixtures.ts";
import type { Core } from "../../src/domain/generated/modelTypes.ts";

const config = refinementInstance;

/** The last entry of a state's journal, with its post-state, which is the interpreter's whole argument. */
function lastOf(state: ActorState): { entry: Entry; post: Core } {
  const entry = state.journal.at(-1);
  assert.ok(entry !== undefined, "the state carries no journaled entry");
  return { entry, post: state.view.post };
}

/** An arrival at the default draws, which is every walk's first decision. */
function arriveOn(state: ActorState, deps: ReadonlySet<TicketId>): ActorState {
  return journalStep(
    config,
    state,
    arriveEvent(deps, flatProgram, asProjectId(1), wNone),
  );
}

test("the arrival's subject is the id it appended, and it has no transition to read", () => {
  const state = arriveOn(actorInit(), depsOf());
  const { entry, post } = lastOf(state);
  assert.equal(entry.rec.label, arrivalLabel);
  assert.deepEqual(entry.rec.transitions, []);

  const planned = emissionsOf(entry, post);
  assert.equal(planned.length, 1);
  assert.deepEqual(planned[0]?.effect, "CreateDraft");
  assert.equal(planned[0]?.emission.ticket, id(1));
});

test("a second arrival's subject is the second id, so the exception reads the post-state and not a constant", () => {
  const state = arriveOn(arriveOn(actorInit(), depsOf()), depsOf());
  const { entry, post } = lastOf(state);
  const planned = emissionsOf(entry, post);
  assert.equal(planned[0]?.emission.ticket, id(2));
});

test("a revoke attributes each effect to its own transition, not to the head one", () => {
  let state = arriveOn(actorInit(), depsOf());
  state = arriveOn(state, depsOf(1));
  state = journalStep(config, state, revokeEvent(id(1)));
  const { entry, post } = lastOf(state);

  assert.deepEqual(
    entry.rec.effects,
    ["Revoke", "OpenHumanTask"],
    "the cascade is what makes this decision multi-effect",
  );
  const planned = emissionsOf(entry, post);
  assert.deepEqual(
    planned.map((one) => [one.effect, one.emission.ticket]),
    [
      ["Revoke", id(1)],
      ["OpenHumanTask", id(2)],
    ],
  );
  assert.notEqual(
    planned[1]?.emission.ticket,
    entry.rec.transitions[0]?.ticket,
    "transitions[0].ticket would open the revoked ticket's desk task for its dependent",
  );
});

test("the effect index is the position in the record, so one decision's emissions have distinct keys", () => {
  let state = arriveOn(actorInit(), depsOf());
  state = arriveOn(state, depsOf(1));
  state = journalStep(config, state, revokeEvent(id(1)));
  const { entry, post } = lastOf(state);
  assert.deepEqual(
    emissionsOf(entry, post).map((one) => one.emission.effectIndex),
    [0, 1],
  );
});

test("an effect with no transition of its own is refused rather than attributed to a neighbour", () => {
  const forged: Entry = {
    seq: 1,
    event: revokeEvent(id(1)),
    rec: {
      label: "ticket-revoked",
      transitions: [{ ticket: id(1), from: "PDraft", to: "Revoked" }],
      effects: ["Revoke", "OpenHumanTask"],
      attempt: { attempt: "WONone" },
    },
  };
  assert.throws(
    () => emissionsOf(forged, { tickets: new Map() }),
    /against no transition of its own/,
  );
});

test("an arrival-labelled record of the wrong shape is refused rather than read positionally", () => {
  const forged: Entry = {
    seq: 1,
    event: revokeEvent(id(1)),
    rec: {
      label: arrivalLabel,
      transitions: [{ ticket: id(1), from: "PDraft", to: "Revoked" }],
      effects: ["CreateDraft"],
      attempt: { attempt: "WONone" },
    },
  };
  assert.throws(
    () => emissionsOf(forged, { tickets: new Map() }),
    /one-effect no-transition shape/,
  );
});

test("every effect this machine declares routes to exactly one port method", async () => {
  const emission: Emission = { seq: 1, effectIndex: 0, ticket: id(1) };
  const routed: Record<Effect, string> = {} as Record<Effect, string>;
  for (const effect of allEffects) {
    const desk = deskStub();
    const fabric = fabricStub();
    await perform({ desk, fabric }, { effect, emission });
    const reached = desk.deliveries.length + fabric.requests.length;
    assert.equal(reached, 1, `${effect} reached ${String(reached)} port calls`);
    routed[effect] = desk.deliveries.length === 1 ? "desk" : "fabric";
  }
  assert.deepEqual(routed, {
    CreateDraft: "desk",
    Revoke: "desk",
    OpenHumanTask: "desk",
    SpawnWorkTasks: "fabric",
    SpawnEvalTasks: "fabric",
    EnqueueWrapUp: "desk",
    OpenGate: "desk",
    Complete: "desk",
  });
});
