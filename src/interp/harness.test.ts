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
  must,
  progFlat,
  wx1,
} from "../spine/refinement-fixtures.test.ts";
import {
  refinementCore,
  refinementInvariants,
} from "../spine/refinement-invariants.ts";
import { interpret } from "./execute.ts";
import { submitEvent, type ExternalEvent } from "./events.ts";
import type { Ports } from "./ports.ts";

/**
 * THE INSTANCE: the model's refinement instance, with one const moved.
 *
 * A revoke cascade is only observable when a revoked ticket has dependents to
 * park, and the shape this slice must keep — one seq carrying a `Revoke` and
 * more than one `OpenHumanTask` — needs two of them. Everything else is the
 * refinement instance's unchanged, which is why it arrives by spread: the delta
 * is the whole of what this slice needed, and it is visible as one line.
 */
export const cfgInterp: Config = { ...cfgRefinement, nTickets: 3 };

export { must, progFlat, wx1 };

/** The authoring surface's report, on the gated route. */
export const authored: ExternalEvent = {
  tag: "TicketAuthored",
  deps: new Set(),
  program: progFlat,
  project: 1,
  wrapUp: wx1,
};

/** The same report without a lease: the route whose completion needs no gate. */
export const authoredLeaseFree: ExternalEvent = {
  ...authored,
  wrapUp: { tag: "WNone" },
};

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
 * Both bundles, at one state, asserted separately so a failure says which
 * machine broke.
 *
 * The middle one is the claim this slice is held to by name — the discipline-
 * independent core, green at every step of every walk — and asking it before
 * the full bundle localizes a failure to the journal-and-replay half rather
 * than to the world-facing half.
 */
export function expectSteady(s: ActorState): void {
  assert.ok(invariantsHold(cfgInterp, s.mem), "the domain bundle");
  assert.ok(refinementCore(cfgInterp, s), "the refinement core");
  assert.ok(refinementInvariants(cfgInterp, s), "the refinement bundle");
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
  expectSteady(journaled);
  const out = interpret(cfgInterp, journaled, rig.ports);
  expectSteady(out);
  return out;
}
