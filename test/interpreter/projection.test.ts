/**
 * The projection as a derivation: that folding what each decision changed
 * reaches the same table as reading the whole replayed state.
 *
 * THIS IS THE CLAIM THAT MAKES IT A PROJECTION. 006 says the projections are
 * rebuildable from the journal and are not a second semantic authority, and
 * the two halves of that are one function here: a decision writes only the
 * rows it moved, and a rebuild writes them all. If the two ever disagree the
 * stored table is a second authority, whatever it is called.
 *
 * IT IS PURE, SO IT IS TESTED HERE. `test/postgres/decision.test.ts` asserts
 * that the stored rows equal the rebuild, which is the storage half; whether
 * the delta is the right delta needs no server at all.
 *
 * THE DELTA IS NOT THE RECORD'S TRANSITIONS, and the last case is why. A
 * release transitions nothing — it creates a ticket that had no prior phase to
 * leave — so a projection driven off `StepRecord` would never file the row it
 * created.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEvent,
  execDecisionEvent,
  releaseTicketEvent,
  taskDoneEvent,
  type DecisionEvent,
} from "../../src/actor/decisionEvent.ts";
import { genesis, replayCore, type Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";
import type { Core } from "../../src/domain/generated/modelTypes.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import {
  projectionChanges,
  projectionOf,
} from "../../src/interpreter/projectWriter.ts";
import {
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";

/** A history long enough to release a ticket, move it, and then decide something that moves nothing. */
const history: readonly DecisionEvent[] = [
  releaseTicketEvent(id(1), plainAuthoring),
  dispatchEvent(id(1)),
  taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
];

/** The journal that history writes, which is what a rebuild reads. */
function journalOf(): readonly Entry[] {
  return history.reduce(
    (state, event) => journalStep(refinementInstance, state, event),
    actorInit(),
  ).journal;
}

/** The table the per-decision changes build, applied one decision at a time. */
function folded(): ReadonlyMap<number, string> {
  const table = new Map<number, string>();
  let core: Core = genesis;
  for (const event of history) {
    const post = execDecisionEvent(refinementInstance, core, event).post;
    for (const row of projectionChanges(core, post)) {
      table.set(row.ticket, row.phase);
    }
    core = post;
  }
  return table;
}

test("folding what each decision changed reaches the table a rebuild reads", () => {
  const rebuilt = new Map(
    projectionOf(replayCore(refinementInstance, journalOf())).map((row) => [
      row.ticket,
      row.phase,
    ]),
  );
  assert.deepEqual(folded(), rebuilt);
  assert.equal(rebuilt.get(id(1)), "Working");
});

test("a decision reports only the tickets whose phase it moved", () => {
  const released = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  const dispatched = journalStep(
    refinementInstance,
    released,
    dispatchEvent(id(1)),
  );
  assert.deepEqual(
    projectionChanges(released.view.post, dispatched.view.post),
    [{ ticket: id(1), phase: "Working" }],
  );
  assert.deepEqual(
    projectionChanges(dispatched.view.post, dispatched.view.post),
    [],
  );
});

test("a release is a change although it transitions nothing", () => {
  const released = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  assert.deepEqual(released.journal.at(-1)?.rec.transitions, []);
  assert.deepEqual(projectionChanges(genesis, released.view.post), [
    { ticket: id(1), phase: "Pending" },
  ]);
});
