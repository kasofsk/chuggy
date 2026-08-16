/**
 * The interpreter: the routing table, the row grain, and the cursor rule.
 *
 * THREE CLAIMS, and the last two are the ones s5 banked and handed forward.
 *
 *   1. THE MAPPING IS TOTAL AND ONTO. Every effect the vocabulary holds reaches
 *      exactly one port method, and between them they reach every port method
 *      there is — so neither an effect that routes nowhere nor a port method
 *      nothing can reach survives.
 *   2. A ROW'S WHOLE LIST GOES OUT UNDER ONE KEY. The cascade's two identical
 *      `OpenHumanTask`s arrive as two deliveries at two ordinals under one seq,
 *      and nothing collapses them.
 *   3. THE CURSOR ADVANCES ONLY ONCE THE WHOLE LIST IS OUT. A port that throws
 *      part-way through a list leaves the cursor where it was, so the whole list
 *      re-emits on the next drain and the elements the world already took are
 *      absorbed by key. That is the seam `actor.ts` says its own suite cannot
 *      drive and this one must.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { effectVocabulary, type Effect } from "../effects/effect.ts";
import type { StepRecord } from "../domain/measure.ts";
import { actorInit, commit, type DurableState } from "../spine/actor.ts";
import type { Cmd } from "../spine/cmd.ts";
import { deliverEffect, interpret } from "./execute.ts";
import {
  cfgInterp,
  createRig,
  decide,
  expectSteady,
  must,
  progFlat,
  wx1,
  type Rig,
} from "./harness.test.ts";
import type { Delivery, Ports } from "./ports.ts";

// === The routing table =====================================================

/** Every port method there is, as the roster the mapping must cover. */
const portMethods: readonly string[] = [
  "fabric.spawn",
  "fabric.cancel",
  "desk.openTask",
  "authoring.createDraft",
  "landing.enqueue",
  "landing.openGate",
  "landing.land",
];

/** Ports that record which method was called and nothing else. */
function spyPorts(calls: string[]): Ports {
  const note =
    (name: string) =>
    (delivery: Delivery): void => {
      calls.push(`${name}(${delivery.effect})`);
    };
  return {
    fabric: { spawn: note("fabric.spawn"), cancel: note("fabric.cancel") },
    desk: { openTask: note("desk.openTask") },
    authoring: { createDraft: note("authoring.createDraft") },
    landing: {
      enqueue: note("landing.enqueue"),
      openGate: note("landing.openGate"),
      land: note("landing.land"),
    },
  };
}

function routeOf(effect: Effect): string {
  const calls: string[] = [];
  deliverEffect(spyPorts(calls), {
    seq: 1,
    ordinal: 0,
    effect,
    rec: recordCarrying([effect]),
  });
  assert.equal(calls.length, 1, `${effect} did not reach exactly one method`);
  const call = calls[0];
  assert.ok(call !== undefined);
  return call;
}

function recordCarrying(effects: readonly Effect[]): StepRecord {
  return {
    label: "a record built for a routing case",
    transitions: [],
    effects: [...effects],
    landing: { tag: "WONone" },
  };
}

test("every effect reaches the port its name says", () => {
  assert.deepEqual(
    effectVocabulary.map(routeOf),
    [
      "authoring.createDraft(CreateDraft)",
      "fabric.cancel(Revoke)",
      "desk.openTask(OpenHumanTask)",
      "fabric.spawn(SpawnWorkTasks)",
      "fabric.spawn(SpawnEvalTasks)",
      "landing.enqueue(EnqueueWrapUp)",
      "landing.openGate(OpenGate)",
      "landing.land(Complete)",
    ],
    "the effect-to-port mapping moved",
  );
});

test("the mapping reaches every port method, so none is unreachable", () => {
  const reached = new Set(
    effectVocabulary.map((effect) => routeOf(effect).split("(")[0]),
  );
  assert.deepEqual([...reached].sort(), [...portMethods].sort());
});

// === The cascade: three tickets, one revoked ===============================

const revoke: Cmd = { tag: "JRevoke", ticket: 1 };

/**
 * A fleet of three where two Drafts depend on the first, drained — so the next
 * decision is the cascade, and everything before it is already out.
 */
function cascadeReady(rig: Rig): DurableState {
  let s = actorInit(cfgInterp);
  s = decide(rig, s, arriveWith(new Set()), "arrive 1");
  s = decide(rig, s, arriveWith(new Set([1])), "arrive 2");
  s = decide(rig, s, arriveWith(new Set([1])), "arrive 3");
  return s;
}

function arriveWith(deps: ReadonlySet<number>): Cmd {
  return { tag: "JArrive", deps, program: progFlat, project: 1, wrapUp: wx1 };
}

test("a row's whole effect list goes out under one key, in the decider's order", () => {
  const rig = createRig();
  const s = decide(rig, cascadeReady(rig), revoke, "revoke 1");

  const cascade = rig.world.ledger().filter((entry) => entry.seq === 4);
  assert.deepEqual(
    cascade.map((entry) => [entry.call, entry.effect, entry.ordinal]),
    [
      ["cancel", "Revoke", 0],
      ["openTask", "OpenHumanTask", 1],
      ["openTask", "OpenHumanTask", 2],
    ],
    "the cascade's list did not arrive whole, in order, under one seq",
  );
  // The two desk tasks are TWO — a world keying by the effect's VALUE would
  // have one here, and one ticket would sit parked with nobody looking at it.
  // Both carry the DECISION's subject, the revoked ticket: an effect has no
  // attribution of its own, and which dependents were parked is in the record
  // that travelled with them, which is where a desk reads it.
  assert.deepEqual(
    rig.world.recorded("openTask").map((entry) => entry.ticket),
    [1, 1],
  );
  assert.deepEqual(
    s.mem.lastStep.transitions
      .filter((transition) => transition.to === "PEscalated")
      .map((transition) => transition.ticket),
    [2, 3],
  );
  assert.equal(s.applied, s.journal.length);
});

// === The cursor rule =======================================================

test("a port that throws part-way through a list leaves the cursor where it was", () => {
  const rig = createRig();
  const before = cascadeReady(rig);

  let deskFailures = 1;
  const failingDesk: Ports = {
    ...rig.ports,
    desk: {
      openTask: (delivery) => {
        // Record FIRST, then fail: an effect that reached the world and lost
        // its acknowledgement is the case idempotence exists for, and the
        // easier ordering would prove less.
        rig.ports.desk.openTask(delivery);
        if (deskFailures > 0) {
          deskFailures -= 1;
          throw new Error("the desk is unreachable");
        }
      },
    },
  };

  const journaled = must(
    // The decision is durable before any of this: the row is committed, and
    // only then is the world asked.
    commitOf(rig, before, revoke),
    "commit the revoke",
  );
  assert.throws(() => interpret(cfgInterp, journaled, failingDesk), {
    message: "the desk is unreachable",
  });

  // The cursor did not move, and the world's ledger holds exactly what got out
  // before the failure: the cancel, and the first of the two desk tasks.
  assert.equal(journaled.applied, 3);
  assert.equal(journaled.worldEffects.has(4), false);
  assert.deepEqual(
    rig.world
      .ledger()
      .filter((entry) => entry.seq === 4)
      .map((entry) => entry.ordinal),
    [0, 1],
  );
  expectSteady(journaled);

  // The next drain re-emits the WHOLE row. The two elements the world already
  // took are absorbed by key; the one it never took arrives.
  const recovered = interpret(cfgInterp, journaled, rig.ports);
  assert.deepEqual(
    rig.world
      .ledger()
      .filter((entry) => entry.seq === 4)
      .map((entry) => [entry.call, entry.ordinal]),
    [
      ["cancel", 0],
      ["openTask", 1],
      ["openTask", 2],
    ],
    "the re-emitted row was not absorbed element for element",
  );
  assert.equal(rig.world.recorded("cancel").length, 1);
  assert.equal(recovered.applied, 4);
  expectSteady(recovered);
});

test("a throw discards the cursor progress of the whole call, and the re-drain absorbs it", () => {
  const rig = createRig();
  let s = actorInit(cfgInterp);
  // Two rows journaled with nothing drained: an arrival, then the revoke that
  // cascades over it. The drain reaches both in one call.
  s = must(commitOf(rig, s, arriveWith(new Set())), "arrive 1");
  s = must(commitOf(rig, s, arriveWith(new Set([1]))), "arrive 2");
  s = must(commitOf(rig, s, revoke), "revoke 1");
  assert.equal(s.applied, 0);

  const failingDesk: Ports = {
    ...rig.ports,
    desk: {
      openTask: () => {
        throw new Error("the desk is unreachable");
      },
    },
  };
  assert.throws(() => interpret(cfgInterp, s, failingDesk));

  // Rows 1 and 2 were fully emitted inside that call and their cursor advance
  // went with the exception. That is a cursor regression, which is exactly what
  // the world's keys absorb.
  assert.equal(s.applied, 0);
  assert.deepEqual(
    rig.world.ledger().map((entry) => [entry.seq, entry.ordinal]),
    [
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  );

  const drained = interpret(cfgInterp, s, rig.ports);
  assert.equal(drained.applied, 3);
  assert.deepEqual(
    rig.world.ledger().map((entry) => [entry.seq, entry.ordinal]),
    [
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 1],
    ],
    "the re-drain recorded a draft or a cancellation twice",
  );
  expectSteady(drained);
});

// === The ordinary shapes ===================================================

test("a row with no effects still advances the cursor", () => {
  const rig = createRig();
  let s = actorInit(cfgInterp);
  s = decide(rig, s, arriveWith(new Set()), "arrive");
  const asked = rig.world.ledger().length;
  s = decide(rig, s, { tag: "JRelease", ticket: 1 }, "release");
  assert.equal(s.applied, 2);
  assert.equal(rig.world.ledger().length, asked, "a release asked for nothing");
});

test("draining a state the cursor has already caught up with does nothing", () => {
  const rig = createRig();
  const s = decide(rig, actorInit(cfgInterp), arriveWith(new Set()), "arrive");
  const asked = rig.world.ledger().length;
  const again = interpret(cfgInterp, s, rig.ports);
  assert.equal(again.applied, s.applied);
  assert.deepEqual(again.worldEffects, s.worldEffects);
  assert.equal(rig.world.ledger().length, asked);
});

test("the executor refuses a row whose list outruns the fleet it was configured for", () => {
  // The mismatched configuration is how a suite reaches an assertion the
  // machine cannot otherwise produce: a legal journal's widest row IS the
  // cascade, so the only way to see the ceiling refuse one is to hand the
  // executor a smaller fleet than the journal was written against.
  const rig = createRig();
  const journaled = must(
    commitOf(rig, cascadeReady(rig), revoke),
    "commit the revoke",
  );
  assert.throws(
    () => interpret({ ...cfgInterp, nTickets: 2 }, journaled, rig.ports),
    {
      name: "AssertionError",
      message: /row 4 carries 3 effects, past the fleet's ceiling of 2/,
    },
  );
});

test("an arrival's effect names no ticket, and every other effect-bearing row does", () => {
  const rig = createRig();
  const s = decide(rig, cascadeReady(rig), revoke, "revoke 1");
  assert.equal(s.applied, s.journal.length);
  for (const entry of rig.world.ledger()) {
    assert.equal(
      entry.ticket === undefined,
      entry.call === "createDraft",
      `${entry.call} at seq ${String(entry.seq)} disagreed about naming a ticket`,
    );
  }
});

// A commit WITHOUT a drain behind it, which `harness.test.ts`'s `decide`
// deliberately does not offer: every walk there drains, because that is what a
// running system does. The cases above need the gap between the two.

function commitOf(
  rig: Rig,
  s: DurableState,
  cmd: Cmd,
): DurableState | undefined {
  return commit(cfgInterp, rig.store, s, cmd);
}
