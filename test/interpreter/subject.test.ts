/**
 * The positional-subject rule, and the shape that decides whether it was
 * written as a rule or as a shortcut.
 *
 * The revoke is that shape: it records the revocation and every cascade park in
 * one decision, effect for transition, so `transitions[0].ticket` would
 * attribute the dependent's desk task to the revoked ticket. Every other
 * decision carries one transition and agrees with the shortcut, which is why a
 * suite without a cascade proves nothing about the rule.
 *
 * The routing is walked constructor by constructor over `allEffects` rather
 * than over a list written here, so an effect added without a port lands as a
 * failing case instead of as a silent arm.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEvent,
  releaseTicketEvent,
  revokeEvent,
} from "../../src/actor/decisionEvent.ts";
import type { Entry } from "../../src/actor/journal.ts";
import {
  actorInit,
  journalStep,
  type ActorState,
} from "../../src/actor/state.ts";
import { deskStub } from "../../src/adapters/deskStub.ts";
import { fabricStub } from "../../src/adapters/fabricStub.ts";
import { finalizerStub } from "../../src/adapters/finalizerStub.ts";
import { allEffects, type Effect } from "../../src/domain/effect.ts";
import { emissionsOf, perform } from "../../src/interpreter/interpret.ts";
import type { Emission } from "../../src/interpreter/ports.ts";
import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

const config = refinementInstance;

/** The last entry of a state's journal, which is the interpreter's whole argument. */
function lastOf(state: ActorState): Entry {
  const entry = state.journal.at(-1);
  assert.ok(entry !== undefined, "the state carries no journaled entry");
  return entry;
}

/** A release at the default authoring, which is every walk's first decision. */
function releaseOn(state: ActorState, ticket: number, deps: number[]) {
  return journalStep(
    config,
    state,
    releaseTicketEvent(id(ticket), { ...plainAuthoring, deps: new Set(deps) }),
  );
}

/** The revoke of a ticket a second, dependent ticket is waiting on. */
function revokedWithDependent(): ActorState {
  let state = releaseOn(actorInit(), 1, []);
  state = releaseOn(state, 2, [1]);
  return journalStep(config, state, revokeEvent(id(1)));
}

test("a decision with no effect asks the world for nothing", () => {
  const entry = lastOf(releaseOn(actorInit(), 1, []));
  assert.deepEqual(entry.rec.effects, []);
  assert.deepEqual(emissionsOf(entry), []);
});

test("a single-transition decision attributes its effect to the ticket it stepped", () => {
  const state = journalStep(
    config,
    releaseOn(actorInit(), 1, []),
    dispatchEvent(id(1)),
  );
  const entry = lastOf(state);
  const planned = emissionsOf(entry);
  assert.equal(planned.length, 1);
  assert.deepEqual(planned[0]?.effect, "SpawnWorkTasks");
  assert.equal(planned[0]?.emission.ticket, id(1));
  assert.equal(planned[0]?.emission.seq, entry.seq);
});

test("a revoke attributes each effect to its own transition, not to the head one", () => {
  const entry = lastOf(revokedWithDependent());
  assert.deepEqual(
    entry.rec.effects,
    ["CancelTicketWork", "OpenHumanTask"],
    "the cascade is what makes this decision multi-effect",
  );
  const planned = emissionsOf(entry);
  assert.deepEqual(
    planned.map((one) => [one.effect, one.emission.ticket]),
    [
      ["CancelTicketWork", id(1)],
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
  assert.deepEqual(
    emissionsOf(lastOf(revokedWithDependent())).map(
      (one) => one.emission.effectIndex,
    ),
    [0, 1],
  );
});

test("an effect with no transition of its own is refused rather than attributed to a neighbour", () => {
  const forged: Entry = {
    seq: 1,
    event: revokeEvent(id(1)),
    rec: {
      label: "ticket-revoked",
      transitions: [{ ticket: id(1), from: "Pending", to: "Revoked" }],
      effects: ["CancelTicketWork", "OpenHumanTask"],
    },
  };
  assert.throws(() => emissionsOf(forged), /against no transition of its own/);
});

/** The vocabulary the wire deliberately does not know, refused where an emission is planned. */
test("an effect string outside this machine's vocabulary is refused", () => {
  const forged: Entry = {
    seq: 1,
    event: revokeEvent(id(1)),
    rec: {
      label: "ticket-revoked",
      transitions: [{ ticket: id(1), from: "Pending", to: "Revoked" }],
      effects: ["Deploy"],
    },
  };
  assert.throws(() => emissionsOf(forged), /not one of this machine's effects/);
});

test("every effect this machine declares routes to exactly one port method", async () => {
  const emission: Emission = { seq: 1, effectIndex: 0, ticket: id(1) };
  const routed: Partial<Record<Effect, string>> = {};
  for (const effect of allEffects) {
    const desk = deskStub();
    const fabric = fabricStub();
    const finalizer = finalizerStub();
    await perform({ desk, fabric, finalizer }, { effect, emission });
    const reached =
      desk.deliveries.length +
      fabric.requests.length +
      finalizer.requests.length;
    assert.equal(reached, 1, `${effect} reached ${String(reached)} port calls`);
    routed[effect] =
      desk.deliveries.length === 1
        ? "desk"
        : fabric.requests.length === 1
          ? "fabric"
          : "finalizer";
  }
  assert.deepEqual(routed, {
    SpawnWorkTasks: "fabric",
    SpawnEvalTasks: "fabric",
    CancelTicketWork: "fabric",
    RunFinalizer: "finalizer",
    OpenHumanTask: "desk",
  });
});
