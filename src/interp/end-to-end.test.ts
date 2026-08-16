/**
 * THE WALK: a ticket driven from arrival to landing through the real actor, the
 * real journal store, the real interpreter and the stubbed world — with the
 * duplicates and the stale deliveries an at-least-once fabric is entitled to
 * send, and a crash in the middle.
 *
 * WHAT MAKES IT AN END-TO-END WALK RATHER THAN A LONG UNIT TEST. Nothing here
 * is a double except the world. The decisions are `execCmd`'s, the enablement
 * is `cmdEnabled`'s, the rows go through `hasEntryShape` and the store's append
 * fence, recovery reads the STORE and replays through `journalLegalOn`, and
 * every state is asked both bundles. What the walk adds over the layers below
 * is the composition: that a report from outside becomes a candidate command,
 * that the command becomes a durable row, that the row becomes effects at four
 * ports, and that a crash anywhere in that chain costs the world nothing.
 *
 * BOTH WRAP-UP KINDS ARE WALKED, because they are two different landings. A
 * `WExclusive` ticket queues for its project's lease, holds it while a gate
 * runs, and lands on the gate's verdict; a `WNone` ticket's effect already
 * happened during work, so passing evaluation completes it outright and no
 * gate ever opens. A slice that walked only the first would ship an
 * interpreter whose `EnqueueWrapUp` and `OpenGate` arms are the only ones a
 * completion has ever been seen through.
 *
 * THERE ARE TWO CRASHES, and they are different crashes.
 *
 * THE FIRST is at the gate, the seam that costs the most: the gate row is
 * durable, the landing surface TAKES the gate and then dies before
 * acknowledging it, the executor's cursor never advances — and then the process
 * itself dies, so the actor is rebuilt from the store's rows with the cursor
 * regressed all the way to zero. The re-drain re-emits every row of the walk so
 * far, and the world's ledger does not grow by one entry.
 *
 * THE SECOND IS AFTER THE TICKET HAS LANDED, and it is there for two claims
 * that nothing else in this tree drives.
 *
 *   - THE RE-EMITTED `land`. `ports.ts` calls absorbing a re-delivered landing
 *     "load-bearing rather than tidy", because `noDuplicateCycle` says the
 *     world lands a ticket's diff at most once across crashes at any seam —
 *     and the crash seam it survives is exactly a `land` whose row was
 *     re-emitted. A walk that crashed only BEFORE the landing never drives it.
 *   - ELEMENT-WISE ABSORPTION ACROSS A DURABLE RECOVERY. Every delivery on a
 *     single ticket's route sits at ordinal zero, because `decideRevoke` is the
 *     one decider in the machine whose list is longer than one. So the walk
 *     goes on to arrive three more tickets and revoke the one two of them
 *     depend on, putting a real `["Revoke", "OpenHumanTask", "OpenHumanTask"]`
 *     row in the journal — the corpus's frozen shape — and only THEN crashes
 *     the process. The re-drain re-emits that row through the store, through
 *     the schema's gate and through the legality fold, and the world absorbs it
 *     ordinal by ordinal. In-process re-delivery is `execute.test.ts`'s; this
 *     is the same collapse with a real recovery under it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorldRecord } from "../adapters/recording-world.ts";
import {
  actorInit,
  commit,
  recoverFrom,
  type DurableState,
} from "../spine/actor.ts";
import type { ExternalEvent } from "./events.ts";
import { interpret } from "./execute.ts";
import {
  authored,
  authoredLeaseFree,
  cfgInterp,
  createRig,
  decide,
  dispatch,
  enterGate,
  evalReduce,
  expectRefused,
  expectRigSteady,
  expectWorldSettled,
  must,
  report,
  watching,
  workReduce,
  type Rig,
} from "./harness.test.ts";
import type { Ports } from "./ports.ts";

// === The vocabulary the walks are written in ===============================

const released: ExternalEvent = { tag: "TicketReleased", ticket: 1 };
const landed: ExternalEvent = { tag: "LandingConfirmed", ticket: 1 };
const gatePassed: ExternalEvent = {
  tag: "GateResolved",
  ticket: 1,
  outcome: "WOk",
};

/** The fabric reporting that one of ticket 1's runs has ended, and passed. */
function ended(task: number): ExternalEvent {
  return { tag: "TaskEnded", ticket: 1, task, verdict: "VPass" };
}

/** The authoring surface reporting a ticket that waits on `deps`. */
function authoredWith(deps: ReadonlySet<number>): ExternalEvent {
  return { ...authored, deps };
}

/** Somebody withdrawing a ticket, which cascades over its dependents. */
function revoked(ticket: number): ExternalEvent {
  return { tag: "TicketRevoked", ticket };
}

/** The ordinals the world holds for one decision, in acceptance order. */
function ordinalsAt(rig: Rig, seq: number): readonly number[] {
  return rig.world
    .ledger()
    .filter((entry) => entry.seq === seq)
    .map((entry) => entry.ordinal);
}

/**
 * Arrival through a passing evaluation — the prefix both routes share, and the
 * half of the walk where every duplicate and stale delivery is injected.
 *
 * The four decisions in it that the actor takes for ITSELF go through `decide`:
 * which ready ticket to dispatch is the dispatcher's agency, and the two
 * reduces are the actor reading its own memory. Everything else is a report
 * from outside, and goes through the surface.
 */
function throughEvaluation(rig: Rig, arrival: ExternalEvent): DurableState {
  let s: DurableState = actorInit(cfgInterp);
  s = report(rig, s, arrival, "the ticket is authored");
  s = report(rig, s, released, "the author releases it");
  s = decide(rig, s, dispatch, "the dispatcher picks it up");

  s = report(rig, s, ended(1), "the work task ends");
  // The same report again. At-least-once means the fabric is entitled to send
  // it, the surface has no memory to refuse it with, and the DECIDER absorbs
  // it: first write wins, so this journals a row that moves nothing and asks
  // the world for nothing.
  const beforeDuplicate = rig.world.ledger().length;
  s = report(rig, s, ended(1), "the same work task ends again");
  assert.equal(s.mem.lastStep.label, "task-done-duplicate");
  assert.equal(rig.world.ledger().length, beforeDuplicate);

  s = decide(rig, s, workReduce, "the work set reduces");

  // A STALE delivery: task 1 was retired into the record when the work set
  // reduced, and the ticket is evaluating now. Task ids are unique across the
  // ticket's whole history, so staleness is absorbed by identity through the
  // same arm.
  const beforeStale = rig.world.ledger().length;
  s = report(rig, s, ended(1), "a retired task's completion arrives late");
  assert.equal(s.mem.lastStep.label, "task-done-duplicate");
  assert.equal(rig.world.ledger().length, beforeStale);

  s = report(rig, s, ended(2), "the eval task ends");
  return decide(rig, s, evalReduce, "the eval stage reduces");
}

/** Every world record for a spawning decision, by the seq that asked. */
function spawnSeqs(rig: Rig): readonly number[] {
  return rig.world.recorded("spawn").map((entry: WorldRecord) => entry.seq);
}

/** The journal rows that asked for a task fan-out, by seq. */
function spawningRowSeqs(s: DurableState): readonly number[] {
  return s.journal
    .filter((entry) =>
      entry.rec.effects.some(
        (effect) => effect === "SpawnWorkTasks" || effect === "SpawnEvalTasks",
      ),
    )
    .map((entry) => entry.seq);
}

// === The gated route, with the crash =======================================

test("a WExclusive ticket walks arrival to landing, through a crash at the gate", () => {
  const rig = createRig();
  let s = throughEvaluation(rig, authored);

  // Evaluation passed and the ticket wants its lease. Nothing has run a gate.
  assert.equal(rig.world.recorded("enqueue").length, 1);
  assert.equal(rig.world.recorded("openGate").length, 0);

  // --- The gate row goes durable, and then the world takes it and dies ------

  const journaled = must(
    commit(cfgInterp, rig.store, s, enterGate),
    "commit the dequeue",
  );
  expectRigSteady(rig, journaled);

  let gateFailures = 1;
  const dyingLanding: Ports = {
    ...rig.ports,
    landing: {
      ...rig.ports.landing,
      openGate: (delivery) => {
        // The gate IS opened, and the acknowledgement is what is lost. That is
        // the expensive half of at-least-once: the cheap failure, where nothing
        // happened, needs no idempotence to be safe.
        rig.ports.landing.openGate(delivery);
        if (gateFailures > 0) {
          gateFailures -= 1;
          throw new Error("the landing surface went away");
        }
      },
    },
  };
  assert.throws(() => interpret(cfgInterp, journaled, dyingLanding), {
    message: "the landing surface went away",
  });
  assert.equal(journaled.applied, journaled.journal.length - 1);

  // --- And now the actor dies too ------------------------------------------
  // It comes back holding nothing but the store's rows, a cursor checkpoint of
  // ZERO — the worst regression there is — and the world's ledger, which was
  // never the actor's to lose.

  const askedBeforeRecovery = rig.world.ledger().length;
  const recovered = must(
    recoverFrom(cfgInterp, rig.store, 0, {
      worldEffects: journaled.worldEffects,
      orphans: journaled.orphans,
    }),
    "rebuild the actor from the store",
  );
  expectRigSteady(rig, recovered);
  assert.equal(recovered.applied, 0);

  // Every row of the walk so far is re-emitted, and the world takes NOTHING
  // twice: every delivery arrives under a key it already holds.
  s = interpret(cfgInterp, recovered, rig.ports);
  expectRigSteady(rig, s);
  assert.equal(s.applied, s.journal.length);
  assert.equal(
    rig.world.ledger().length,
    askedBeforeRecovery,
    "a re-emitted row asked the world for something a second time",
  );
  assert.equal(rig.world.recorded("openGate").length, 1);

  // --- The gate resolves, and the ticket lands ------------------------------

  s = report(rig, s, gatePassed, "the gate passes");
  assert.equal(rig.world.recorded("land").length, 1);
  assert.equal(s.mem.core.tickets.get(1)?.phase, "PDone");

  // A re-delivered landing confirmation. Enabled — a landed ticket absorbs one
  // — and answered with a state-identical no-op, so nothing lands twice.
  s = report(rig, s, landed, "the landing is confirmed again");
  assert.equal(s.mem.lastStep.label, "complete-duplicate");
  assert.equal(rig.world.recorded("land").length, 1);
  assert.equal(s.mem.core.tickets.get(1)?.completions, 1);

  // A STALE gate resolution, for a ticket that is no longer holding. This one
  // the machine will not even journal: enablement refuses it at the door, which
  // is the other of the two absorbers.
  expectRefused(rig, s, gatePassed, "a stale gate resolution");

  // --- A cascade, so the journal holds a row wider than one ----------------
  // Three more tickets, two of them depending on the third, and then the
  // revocation that parks both. This is the only shape in the machine that
  // produces a multi-effect row, and the walk needs one before it can crash
  // across it.

  s = report(rig, s, authoredWith(new Set()), "a second ticket is authored");
  s = report(rig, s, authoredWith(new Set([2])), "a dependent is authored");
  s = report(rig, s, authoredWith(new Set([2])), "and another dependent");
  s = report(rig, s, revoked(2), "the second ticket is revoked");

  const cascadeSeq = s.journal.length;
  assert.deepEqual(
    ordinalsAt(rig, cascadeSeq),
    [0, 1, 2],
    "the cascade did not reach the world as a whole list",
  );
  assert.equal(rig.world.recorded("cancel").length, 1);
  assert.equal(rig.world.recorded("openTask").length, 2);

  // --- The process dies again, with a landing and a cascade behind it -------

  const askedBeforeSecond = rig.world.ledger().length;
  const afterCrash = must(
    recoverFrom(cfgInterp, rig.store, 0, {
      worldEffects: s.worldEffects,
      orphans: s.orphans,
    }),
    "rebuild the actor a second time",
  );
  expectRigSteady(rig, afterCrash);
  s = interpret(cfgInterp, afterCrash, rig.ports);
  expectRigSteady(rig, s);
  expectWorldSettled(rig, s);
  assert.equal(s.applied, s.journal.length);

  assert.equal(
    rig.world.ledger().length,
    askedBeforeSecond,
    "the re-drain past a landing and a cascade asked for something twice",
  );
  // The two claims this second crash exists for, named separately so a failure
  // says which one broke.
  assert.equal(
    rig.world.recorded("land").length,
    1,
    "the re-emitted land was not absorbed",
  );
  assert.deepEqual(
    ordinalsAt(rig, cascadeSeq),
    [0, 1, 2],
    "the re-emitted cascade was not absorbed element for element",
  );
  assert.equal(s.mem.core.tickets.get(1)?.completions, 1);

  // --- What the world was asked for, in total ------------------------------

  assert.deepEqual(spawnSeqs(rig), spawningRowSeqs(s));
  assert.equal(spawnSeqs(rig).length, 2, "the work spawn and the eval spawn");
  assert.equal(new Set(spawnSeqs(rig)).size, 2, "one spawn per decision");
  assert.deepEqual(
    countByCall(rig),
    {
      createDraft: 4,
      spawn: 2,
      enqueue: 1,
      openGate: 1,
      land: 1,
      cancel: 1,
      openTask: 2,
    },
    "the world was asked for something it should not have been",
  );
});

// === The ordering promise, and the half of it that is not true =============

test("across drains the landing port is re-sent a route it has already finished", () => {
  // THE EVIDENCE FOR THE SCOPED PROMISE. `ports.ts` says ordering holds within
  // one drain and not across drains, and this is the case that would falsify
  // the unscoped version: the world holds this ticket's `land`, the process
  // dies, and the next drain hands the landing port that same ticket's
  // `enqueue` and `openGate` again — a ticket being queued for a wrap-up it
  // has already completed. Nothing is wrong when it happens; the journal's
  // order never moved, and every one of those deliveries is a redelivery under
  // a key the port already holds.
  const rig = createRig();
  let s = throughEvaluation(rig, authored);
  s = decide(rig, s, enterGate, "the dequeue");
  s = report(rig, s, gatePassed, "the gate passes");
  assert.equal(rig.world.recorded("land").length, 1);
  assert.equal(s.mem.core.tickets.get(1)?.phase, "PDone");

  const seen: string[] = [];
  const recovered = must(
    recoverFrom(cfgInterp, rig.store, 0, {
      worldEffects: s.worldEffects,
      orphans: s.orphans,
    }),
    "rebuild the actor",
  );
  s = interpret(cfgInterp, recovered, watching(rig.ports, seen));

  assert.deepEqual(seen, [
    "authoring.createDraft",
    "fabric.spawn",
    "fabric.spawn",
    "landing.enqueue",
    "landing.openGate",
    "landing.land",
  ]);
  // The list above IS the falsification, and an assertion restating one of its
  // elements would be an assertion-shaped comment: `landing.enqueue` sits in
  // that sequence, and the world already held this ticket's `land` before the
  // drain that produced it began. What is worth asserting separately is that
  // the re-sent route landed nothing a second time.
  assert.equal(rig.world.recorded("land").length, 1);
  expectRigSteady(rig, s);
  expectWorldSettled(rig, s);
});

// === The lease-free route ==================================================

test("a WNone ticket completes on its evaluation, with no gate anywhere", () => {
  const rig = createRig();
  let s = throughEvaluation(rig, authoredLeaseFree);

  // The completion IS the eval reduce: a lease-free ticket's effect already
  // happened during work, so passing evaluation lands it outright.
  assert.equal(s.mem.lastStep.label, "ticket-done");
  assert.equal(s.mem.core.tickets.get(1)?.phase, "PDone");
  assert.equal(rig.world.recorded("land").length, 1);

  s = report(rig, s, landed, "the landing is confirmed again");
  assert.equal(rig.world.recorded("land").length, 1);
  assert.equal(s.mem.core.tickets.get(1)?.completions, 1);

  assert.deepEqual(
    countByCall(rig),
    { createDraft: 1, spawn: 2, land: 1 },
    "the lease-free route asked for a queue or a gate",
  );
  assert.deepEqual(spawnSeqs(rig), spawningRowSeqs(s));
});

/** How many times the world was asked through each method it was asked through. */
function countByCall(rig: Rig): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of rig.world.ledger()) {
    counts[entry.call] = (counts[entry.call] ?? 0) + 1;
  }
  return counts;
}
