/**
 * THE HARNESS the interpreter's suites drive: one configuration, one rig
 * (a store and a world), and the two steps a system built out of this slice
 * actually takes — a decision the actor makes for itself, and a report the
 * outside hands it.
 *
 * WHY IT IS ITS OWN FILE. Four suites in this slice drive the same rig, and
 * `.chug/tasks/check-duplication.sh` is at threshold 0 with tests deliberately
 * in scope. Its rule is the line this file sits on: a test's SCENARIO may
 * repeat, its HARNESS is extracted.
 *
 * AND WHY IT EXTENDS `src/spine/refinement-fixtures.test.ts` RATHER THAN
 * RESTATING IT. That module already holds the model's refinement instance and
 * the flat program every run authors, so the consts, the program and the lease
 * arrive from there and this file adds the one delta it needs. Written out
 * again they were a second copy of an instance whose whole point is to be the
 * model's, and the duplication gate said so before a reader had to.
 *
 * THE HARNESS IS THE ONLY THING HERE THAT DELIVERS A COMPLETION, which is the
 * fabric port's defining promise read from the other side: the stub records and
 * decides nothing, so every inbound event in every suite is chosen HERE, by a
 * test, including the duplicates and the stale ones. Nothing in `src/` produces
 * one.
 */

import assert from "node:assert/strict";

import { createInMemoryJournalStore } from "../adapters/in-memory-journal-store.ts";
import {
  createRecordingWorld,
  type RecordingWorld,
} from "../adapters/recording-world.ts";
import type { Config } from "../domain/domain.ts";
import { commit, type ActorState, type DurableState } from "../spine/actor.ts";
import type { Cmd } from "../spine/cmd.ts";
import type { JournalStore } from "../spine/journal-store.ts";
import { invariantsHold } from "../spine/machine.ts";
import {
  cfgRefinement,
  dispatch,
  enterGate,
  evalReduce,
  must,
  progFlat,
  workReduce,
  wx1,
} from "../spine/refinement-fixtures.test.ts";
import {
  refinementCore,
  refinementInvariants,
} from "../spine/refinement-invariants.ts";
import { interpret } from "./execute.ts";
import { submitEvent, type ExternalEvent } from "./events.ts";
import type { Delivery, Ports } from "./ports.ts";

/**
 * THE INSTANCE: the model's refinement instance, with one const moved.
 *
 * A walk that both lands a ticket and cascades a revoke over two parked
 * dependents needs four ticket slots — one for the ticket that lands, three for
 * the cascade — and the cascade is the shape this slice must keep: one seq
 * carrying a `Revoke` and more than one `OpenHumanTask`. Everything else is the
 * refinement instance's unchanged, which is why it arrives by spread: the delta
 * is the whole of what this slice needed, and it is visible as one line.
 *
 * WHAT THIS INSTANCE CANNOT REACH, stated rather than left to be discovered.
 * `N_TASKS` is one and `progFlat`'s fan-out is one, so a ticket never holds two
 * live tasks at once — and therefore no walk here can deliver two completions
 * for one ticket OUT OF ORDER, which is a shape the fabric port's contract
 * explicitly permits. That is not a gap in the contract's coverage, it is a gap
 * in THIS layer's: concurrency inside a task set is a domain question, and it
 * is covered where the domain is covered, at the model's own mc instances
 * (`N_TASKS = 2`) — `src/spine/randomized.test.ts` walks them with the whole
 * invariant bundle after every step, and `check-conformance.sh` replays the
 * corpus emitted from them. Widening the instance here would re-cover that
 * ground with a worse tool and would cost every walk in the slice its
 * legibility.
 */
export const cfgInterp: Config = { ...cfgRefinement, nTickets: 4 };

// RE-EXPORTED RATHER THAN RE-DECLARED, on `cfgInterp`'s argument one line
// up: the decision vocabulary this slice's walks are written in is the
// refinement slice's, and a second declaration of `JDispatch on ticket 1`
// is a second place for the ticket id to move.
export { dispatch, enterGate, evalReduce, must, progFlat, workReduce, wx1 };

/**
 * The authoring surface's report, on the gated route.
 *
 * Typed at its own ARM of the event union rather than at the union, so a walk
 * can spread it — `{ ...authored, deps }` — and still have an arrival. Widening
 * it to `ExternalEvent` makes the spread a union of every constructor with a
 * `deps` field bolted on, which is not a report anything can send.
 */
export type TicketAuthored = Extract<
  ExternalEvent,
  { readonly tag: "TicketAuthored" }
>;

export const authored: TicketAuthored = {
  tag: "TicketAuthored",
  deps: new Set(),
  program: progFlat,
  project: 1,
  wrapUp: wx1,
};

/** The same report without a lease: the route whose completion needs no gate. */
export const authoredLeaseFree: TicketAuthored = {
  ...authored,
  wrapUp: { tag: "WNone" },
};

/**
 * Wrap a port method so it RECORDS AND THEN FAILS, once — the lost
 * acknowledgement, which is the expensive half of at-least-once.
 *
 * The order is the point. A port that failed before doing anything needs no
 * idempotence to be safe: nothing happened, and the re-emission is a first
 * delivery. A port that did the thing and then lost its answer is the case the
 * key exists for, and it is the one a real medium produces.
 *
 * It is here rather than inline in three suites because the duplication gate is
 * at threshold 0 and because the ORDER is the claim: three copies would be
 * three chances to write the cheap failure by mistake.
 */
export function recordThenFailOnce(
  inner: (delivery: Delivery) => void,
  what: string,
): (delivery: Delivery) => void {
  let failuresLeft = 1;
  return (delivery) => {
    inner(delivery);
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error(`${what} went away`);
    }
  };
}

/**
 * Ports that note every delivery they are handed, qualified by the method, and
 * then pass it on.
 *
 * It watches what the EXECUTOR sends rather than what the world keeps, which is
 * the difference the ordering promise is about: an absorbed redelivery leaves
 * no ledger entry, so a ledger cannot evidence what order a port was called in.
 */
export function watching(ports: Ports, seen: string[]): Ports {
  const note =
    (name: string, inner: (delivery: Delivery) => void) =>
    (delivery: Delivery): void => {
      seen.push(name);
      inner(delivery);
    };
  return {
    fabric: {
      spawn: note("fabric.spawn", ports.fabric.spawn),
      cancel: note("fabric.cancel", ports.fabric.cancel),
    },
    desk: { openTask: note("desk.openTask", ports.desk.openTask) },
    authoring: {
      createDraft: note("authoring.createDraft", ports.authoring.createDraft),
    },
    landing: {
      enqueue: note("landing.enqueue", ports.landing.enqueue),
      openGate: note("landing.openGate", ports.landing.openGate),
      land: note("landing.land", ports.landing.land),
    },
  };
}

/** A store, a world, and the ports that world implements. */
export type Rig = {
  readonly store: JournalStore;
  readonly world: RecordingWorld;
  readonly ports: Ports;
};

/** A fresh rig: an empty journal and a world that has been asked for nothing. */
export function createRig(): Rig {
  const world = createRecordingWorld();
  return { store: createInMemoryJournalStore(), world, ports: world.ports };
}

/**
 * Both bundles and the projection claim, at one state, asserted separately so a
 * failure says which machine broke.
 *
 * The middle bundle is the claim this slice is held to by name — the
 * discipline-independent core, green at every step of every walk — and asking
 * it before the full bundle localizes a failure to the journal-and-replay half
 * rather than to the world-facing half.
 *
 * THE PROJECTION IS THE PART THAT IS THIS SLICE'S OWN. `ports.ts` argues that
 * the world's `(seq, ordinal)` key is `model/refinement.qnt`'s
 * `worldEffects: Set[int]` REFINED rather than replaced, and an argument in a
 * header is not a checked fact.
 *
 * IT IS NOT QUITE `worldEffects`, AND THE GAP IS EXACT. `emitNext` adds a row's
 * seq to `worldEffects` whether or not the row asked the world for anything, so
 * a release, a `task-done` and every absorbed duplicate are in that set with no
 * ledger entry to their name — the model counts DECISIONS EMITTED, and the
 * world records THINGS IT WAS ASKED TO DO. The projection is therefore
 * `worldEffects` narrowed to the rows that carry an effect, and writing it as a
 * bare equality is the first thing this assertion caught.
 *
 * What is asserted at EVERY state, mid-crash included, is the half that
 * survives an effect being out with the cursor not yet advanced:
 *
 *   - THE KEY SPACE. Every seq the world's ledger holds is a seq the journal
 *     holds. A ledger entry outside `1..journal.length` is a key that projects
 *     to nothing, and the projection claim would be empty.
 *   - THE DIRECTION THAT CANNOT LAG. Every effect-bearing row the actor
 *     believes it emitted is one the world was asked about. The converse lags
 *     by design — between a port call and its `emitNext` the ledger runs ahead,
 *     which is the whole mid-list seam — so requiring it everywhere would make
 *     the honest failure mode a test failure.
 *
 * The equality itself is `expectWorldSettled`, asked at drain boundaries, where
 * it is the actual claim rather than a bound on it.
 */
export function expectRigSteady(rig: Rig, s: ActorState): void {
  assert.ok(invariantsHold(cfgInterp, s.mem), "the domain bundle");
  assert.ok(refinementCore(cfgInterp, s), "the refinement core");
  assert.ok(refinementInvariants(cfgInterp, s), "the refinement bundle");

  const inTheWorld = ledgerSeqs(rig);
  for (const seq of inTheWorld) {
    assert.ok(
      seq >= 1 && seq <= s.journal.length,
      `the world holds seq ${String(seq)}, which is outside a journal of ${String(s.journal.length)}`,
    );
  }
  for (const seq of emittedAndAsking(s)) {
    assert.ok(
      inTheWorld.has(seq),
      `the actor believes it emitted seq ${String(seq)}, which asks the world for something, and the world was never asked`,
    );
  }
}

/**
 * The projection, as an equality — asked where it is one.
 *
 * At a drain boundary no effect is in flight, so the set of seqs the world's
 * ledger holds IS `worldEffects`: the ordinal projected away, exactly as
 * `ports.ts` claims. Between a port call and the `emitNext` behind it the two
 * differ by design, which is why this is a separate question and not a stronger
 * `expectRigSteady`.
 */
export function expectWorldSettled(rig: Rig, s: ActorState): void {
  assert.deepEqual(
    ascending(ledgerSeqs(rig)),
    ascending(emittedAndAsking(s)),
    "the world's ledger and the actor's belief about it disagree at a drain boundary",
  );
}

/** The world's ledger with the ordinal projected away — the model's set of seqs. */
function ledgerSeqs(rig: Rig): ReadonlySet<number> {
  return new Set(rig.world.ledger().map((entry) => entry.seq));
}

/**
 * The seqs the executor has emitted whose rows actually ask the world for
 * something — `worldEffects` narrowed to the effect-bearing rows.
 *
 * The narrowing reads the journal rather than a second record of it, so a row
 * that stops carrying effects moves this set with no edit here.
 */
function emittedAndAsking(s: ActorState): ReadonlySet<number> {
  const asking = new Set<number>();
  for (const entry of s.journal) {
    if (s.worldEffects.has(entry.seq) && entry.rec.effects.length > 0) {
      asking.add(entry.seq);
    }
  }
  return asking;
}

function ascending(seqs: ReadonlySet<number>): readonly number[] {
  return [...seqs].sort((a, b) => a - b);
}

/**
 * THE ACTOR'S STEP AND THE EXECUTOR'S, in that order and with both bundles
 * asserted at each: journal the decision durably, then drain what the cursor has
 * not reached.
 *
 * The intermediate state is asserted deliberately. Between the two there is a
 * durable decision the world has not heard about, which is the state
 * journal-before-effect exists to make ordinary, and a walk that only looked at
 * the ends would never visit it.
 */
export function decide(
  rig: Rig,
  s: DurableState,
  cmd: Cmd,
  what: string,
): DurableState {
  return drained(rig, must(commit(cfgInterp, rig.store, s, cmd), what));
}

/**
 * The same pair, driven by a report from outside: translate, hand to the single
 * writer, drain.
 *
 * It goes through `submitEvent` rather than through `commandFor` and `commit`
 * spelled apart, because the surface is what this slice ships and a suite that
 * bypassed it would be testing the translation and the actor while leaving the
 * thing that joins them uncovered.
 */
export function report(
  rig: Rig,
  s: DurableState,
  event: ExternalEvent,
  what: string,
): DurableState {
  return drained(rig, must(submitEvent(cfgInterp, rig.store, s, event), what));
}

/** A report the machine will not have: nothing is journaled and nothing emitted. */
export function expectRefused(
  rig: Rig,
  s: DurableState,
  event: ExternalEvent,
  what: string,
): void {
  const before = rig.store.length();
  assert.equal(
    submitEvent(cfgInterp, rig.store, s, event),
    undefined,
    `${what}: the machine accepted a report it should have refused`,
  );
  assert.equal(rig.store.length(), before, `${what}: a refusal wrote a row`);
}

function drained(rig: Rig, journaled: DurableState): DurableState {
  expectRigSteady(rig, journaled);
  expectWorldSettled(rig, journaled);
  const out = interpret(cfgInterp, journaled, rig.ports);
  expectRigSteady(rig, out);
  expectWorldSettled(rig, out);
  return out;
}
