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
  expectWorldSettled,
  createRig,
  decide,
  expectRigSteady,
  must,
  progFlat,
  recordThenFailOnce,
  wx1,
  type Rig,
} from "./harness.test.ts";
import type { Delivery, Ports } from "./ports.ts";

// === The routing table =====================================================

/**
 * Every port method there is, qualified by the port it is on — DERIVED from
 * `Ports`, so a method added, removed or renamed is a compile error here.
 *
 * `effect.ts`'s argument for a compiler-maintained copy, applied to the roster
 * this suite checks the mapping's coverage against. A hand-written list would
 * pass happily while a new port method went unreachable, which is the one
 * failure this case exists to catch.
 */
type QualifiedPortCall = {
  [P in keyof Ports]: `${P & string}.${keyof Ports[P] & string}`;
}[keyof Ports];

const everyPortMethod = {
  "fabric.spawn": true,
  "fabric.cancel": true,
  "desk.openTask": true,
  "authoring.createDraft": true,
  "landing.enqueue": true,
  "landing.openGate": true,
  "landing.land": true,
} satisfies Record<QualifiedPortCall, true>;

const portMethods: readonly string[] = Object.keys(everyPortMethod);

/** Ports that record which method was called and nothing else. */
function spyPorts(calls: string[]): Ports {
  const note =
    (name: QualifiedPortCall) =>
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
    attempt: { tag: "WONone" },
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

  const failingDesk: Ports = {
    ...rig.ports,
    desk: { openTask: recordThenFailOnce(rig.ports.desk.openTask, "the desk") },
  };

  const journaled = must(
    // The decision is durable before any of this: the row is committed, and
    // only then is the world asked.
    commitOf(rig, before, revoke),
    "commit the revoke",
  );
  assert.throws(() => interpret(cfgInterp, journaled, failingDesk), {
    message: "the desk went away",
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
  expectRigSteady(rig, journaled);

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
  expectRigSteady(rig, recovered);
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
        throw new Error("the desk went away");
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
  expectRigSteady(rig, drained);
});

// === The failure paths the port docs make the strongest claims about ========

/** One ticket, arrival to the gate — the decisions, without the surfaces. */
const toTheGate: readonly Cmd[] = [
  arriveWith(new Set()),
  { tag: "JRelease", ticket: 1 },
  { tag: "JDispatch", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" },
  { tag: "JWorkReduce", ticket: 1 },
  { tag: "JTaskDone", ticket: 1, tid: 2, verdict: "VPass" },
  { tag: "JEvalReduce", ticket: 1 },
  { tag: "JDequeue", ticket: 1, moved: true },
];

test("a cancel that fails leaves the cursor, and the re-drain absorbs the row", () => {
  // `FabricPort` promises that a failed cancel breaks nothing downstream, and
  // the cancel sits at ordinal 0 of the one row in the machine that is wider
  // than one — so its failure is also the case where the row's LATER effects
  // have not been out at all yet.
  const rig = createRig();
  const journaled = must(
    commitOf(rig, cascadeReady(rig), revoke),
    "commit the revoke",
  );
  const failingFabric: Ports = {
    ...rig.ports,
    fabric: {
      ...rig.ports.fabric,
      cancel: recordThenFailOnce(rig.ports.fabric.cancel, "the fabric"),
    },
  };
  assert.throws(() => interpret(cfgInterp, journaled, failingFabric), {
    message: "the fabric went away",
  });
  assert.equal(journaled.applied, 3);
  assert.deepEqual(
    rig.world
      .ledger()
      .filter((entry) => entry.seq === 4)
      .map((entry) => entry.ordinal),
    [0],
    "the desk tasks behind the failed cancel should not have gone out",
  );

  const recovered = interpret(cfgInterp, journaled, rig.ports);
  assert.equal(rig.world.recorded("cancel").length, 1);
  assert.equal(rig.world.recorded("openTask").length, 2);
  assert.equal(recovered.applied, 4);
  expectRigSteady(rig, recovered);
});

test("a land that fails leaves the cursor, and the re-drain lands nothing twice", () => {
  // The claim `ports.ts` calls load-bearing: `noDuplicateCycle` says the world
  // lands a ticket's diff at most once across crashes at any seam, and a `land`
  // that succeeded and lost its acknowledgement is that seam.
  const rig = createRig();
  let s = actorInit(cfgInterp);
  for (const cmd of toTheGate) {
    s = decide(rig, s, cmd, `to the gate: ${cmd.tag}`);
  }
  const journaled = must(
    commitOf(rig, s, { tag: "JGateResolve", ticket: 1, out: "WOk" }),
    "commit the gate resolution",
  );
  const failingLanding: Ports = {
    ...rig.ports,
    landing: {
      ...rig.ports.landing,
      land: recordThenFailOnce(rig.ports.landing.land, "the landing surface"),
    },
  };
  assert.throws(() => interpret(cfgInterp, journaled, failingLanding), {
    message: "the landing surface went away",
  });
  assert.equal(rig.world.recorded("land").length, 1);
  assert.equal(journaled.applied, journaled.journal.length - 1);

  const recovered = interpret(cfgInterp, journaled, rig.ports);
  assert.equal(
    rig.world.recorded("land").length,
    1,
    "the re-emitted landing was applied a second time",
  );
  assert.equal(recovered.mem.core.tickets.get(1)?.completions, 1);
  expectRigSteady(rig, recovered);
  expectWorldSettled(rig, recovered);
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
