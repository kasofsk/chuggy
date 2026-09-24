/**
 * The dispatch table's contract, stated against `model/domain.qnt` rather than
 * against a reading of it.
 *
 * WHAT A REPLAY CANNOT NOTICE IS A MISSING ARM. The corpus routes on the action
 * a trace recorded, so an action the model gains and no committed golden
 * happens to fire costs nothing: every trace still replays, every comparison
 * still holds, and the table quietly covers less of the machine than it claims.
 * That is the failure this file exists for, and it is why the roster is read
 * out of the model at run time instead of being checked by eye.
 *
 * THE ROSTER IS BOUND AT BOTH ENDS. Against the model, so an action added there
 * is a failure here; and against the switch, so a name in the roster with no
 * arm behind it is a failure too — otherwise the constant would drift from the
 * function it describes and each would keep vouching for the other.
 *
 * THE LAST ARM HAS NO DECIDER, and its contract is therefore the only one a
 * comparison against a golden could not state on its own: `settle` decides
 * nothing, so the replay keeps the state and the last decision it was handed.
 */

import type { TicketGraph } from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { declaredActions, directedActions } from "../domain/declared.ts";
import {
  emitterActions,
  replayActions,
  replayStep,
  unknownActionMessage,
  type Picks,
} from "./dispatch.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const emptyGraph: TicketGraph = { tickets: new Map() };

/** A state that records no draw at all, so an arm that needs one refuses by naming it. */
const noPicks: Picks = {
  ticket: undefined,
  dependencies: undefined,
  stages: undefined,
  source: undefined,
  onFailure: undefined,
  report: undefined,
  result: undefined,
  command: undefined,
};

/** Why a call refused, or nothing when it returned. */
function refusal(action: string): string | undefined {
  try {
    replayStep(emptyGraph, action, noPicks);
    return undefined;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

test("the table's roster is the model's own action roster, in its order", () => {
  assert.deepEqual(
    [...replayActions],
    [...declaredActions(ROOT)],
    "the dispatch table and model/domain.qnt's step offer different actions",
  );
});

test("the reader is reading the model rather than agreeing with the table", () => {
  const declared = declaredActions(ROOT);
  assert.ok(
    declared.includes("releaseTicket"),
    "the action roster did not parse",
  );
  assert.ok(
    declared.includes("settle"),
    "the stutter is an action of the machine and belongs in the roster",
  );
});

test("the emitter's own actions are the directed emitter's, in its order", () => {
  assert.deepEqual(
    [...emitterActions],
    [...directedActions(ROOT)],
    "the dispatch table and model/mc/mc_chuggy_directed.qnt's step relations offer different actions",
  );
});

test("every action in the roster reaches an arm, and none falls through", () => {
  for (const action of [...replayActions, ...emitterActions]) {
    const why = refusal(action);
    assert.ok(
      why === undefined || !why.includes(unknownActionMessage),
      `${action} is in the roster and the table has no arm for it`,
    );
  }
});

test("an action outside the roster is refused rather than routed to a neighbour", () => {
  const why = refusal("releaseticket");
  assert.ok(
    why?.includes(unknownActionMessage),
    "a name the machine has no action for was accepted; a near miss must not route",
  );
});

test("the arm with no decider decides nothing", () => {
  assert.equal(
    replayStep(emptyGraph, "settle", noPicks),
    undefined,
    "the stutter took a decision, and the model's settle takes none",
  );
});
