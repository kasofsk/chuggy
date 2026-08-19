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
 * THE THIRTEENTH ARM HAS NO DECIDER, and its contract is therefore the only one
 * a comparison against a golden could not state on its own: `settle` returns
 * the state it was handed, unchanged and identical, under the label the model's
 * own `settle` action writes.
 */

import type { Core } from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { budgetedInstance } from "../domain/configs.ts";
import { declaredActions } from "../domain/declared.ts";
import { decodeVerdict, decodeWrapUpOutcome } from "../itf/vocabulary.ts";
import {
  replayActions,
  replayStep,
  unknownActionMessage,
  type Picks,
} from "./dispatch.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const config = budgetedInstance;
const emptyCore: Core = { tickets: new Map() };

/** A state that records no draw at all, so an arm that needs one refuses by naming it. */
const noPicks: Picks = {
  ticket: undefined,
  deps: undefined,
  program: undefined,
  project: undefined,
  wrapUp: undefined,
  taskId: undefined,
  verdict: undefined,
  moved: undefined,
  outcome: undefined,
  decodeVerdict,
  decodeWrapUpOutcome,
};

/** The label the model's own `settle` action writes, read where it is written. */
function settleLabel(): string {
  const source = readFileSync(join(ROOT, "model", "domain.qnt"), "utf8");
  const start = source.indexOf("\n  action settle = all {");
  const found = /label: "([a-z][a-z0-9_ -]*)"/.exec(source.slice(start));
  if (start < 0 || !found?.[1]) {
    throw new Error("dispatch: model/domain.qnt's settle writes no label here");
  }
  return found[1];
}

/** Why a call refused, or nothing when it returned. */
function refusal(action: string): string | undefined {
  try {
    replayStep(config, emptyCore, action, noPicks);
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
  assert.ok(declared.includes("arrive"), "the action roster did not parse");
  assert.ok(
    declared.includes("settle"),
    "the stutter is an action of the machine and belongs in the roster",
  );
});

test("every action in the roster reaches an arm, and none falls through", () => {
  for (const action of replayActions) {
    const why = refusal(action);
    assert.ok(
      why === undefined || !why.includes(unknownActionMessage),
      `${action} is in the roster and the table has no arm for it`,
    );
  }
});

test("an action outside the roster is refused rather than routed to a neighbour", () => {
  const why = refusal("wrapUpstart");
  assert.ok(
    why?.includes(unknownActionMessage),
    "a name the machine has no action for was accepted; a near miss must not route",
  );
});

test("the arm with no decider returns the state it was handed, under the model's label", () => {
  const decision = replayStep(config, emptyCore, "settle", noPicks);
  assert.equal(
    decision.post,
    emptyCore,
    "the stutter rebuilt the state instead of keeping it",
  );
  assert.equal(decision.rec.label, settleLabel());
  assert.deepEqual(decision.rec.transitions, []);
  assert.deepEqual(decision.rec.effects, []);
  assert.equal(decision.rec.attempt.attempt, "WONone");
});
