/**
 * The obligation bundles' membership held against `model/refinement.qnt`
 * itself, and each discipline-independent member shown red on a state carrying
 * its defect.
 *
 * The membership check is `test/domain/bundle.test.ts`'s argument at the
 * refinement layer: an obligation added to the model with no counterpart here
 * would otherwise cost nothing. The red demonstrations are the anti-vacuity
 * half — the world-facing members get theirs in `hazard.test.ts`, where the
 * machine itself produces the violation; the core members can only be broken
 * by hand-forged states, because the disciplined machine never reaches one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  decisionEventTags,
  releaseTicketEvent,
} from "../../src/actor/decisionEvent.ts";
import {
  failedObligations,
  obligationsHold,
  refinementCore,
  refinementInvariants,
} from "../../src/actor/obligations.ts";
import {
  actorInit,
  journalStep,
  memoryCore,
  type ActorState,
} from "../../src/actor/state.ts";
import { ticketAt, withTicket } from "../../src/domain/core.ts";
import { id } from "../domain/fixtures.ts";
import {
  declaredDecisionEventConstructors,
  declaredRefinementBundle,
  declaredRefinementCore,
  declaredRefinementObligations,
} from "./declared.ts";
import { plainAuthoring, refinementInstance } from "./harness.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const config = refinementInstance;

/** A state one honest decision in, which every forgery below starts from. */
function journaledRelease(): ActorState {
  return journalStep(
    config,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
}

test("the core bundle is the model's refinementCore, member for member in order", () => {
  assert.deepEqual(
    refinementCore.map((member) => member.obligation),
    [...declaredRefinementCore(ROOT)],
  );
});

test("the full bundle is the model's refinementInvariants with the nested core expanded", () => {
  assert.deepEqual(
    refinementInvariants.map((member) => member.obligation),
    [...declaredRefinementObligations(ROOT)],
  );
});

test("the reader is reading the model rather than agreeing with itself", () => {
  const raw = declaredRefinementBundle(ROOT);
  assert.ok(raw.includes("refinementCore"), "the nesting did not parse");
  assert.ok(
    !raw.includes("journalLegal"),
    "the model's bundle names the core bundle, not its members",
  );
  assert.ok(
    refinementInvariants.length > raw.length,
    "expanding the nested bundle must widen the roster",
  );
});

test("the decision-event vocabulary is the model's DecisionEvent, constructor for constructor in order", () => {
  assert.deepEqual(
    [...decisionEventTags],
    [...declaredDecisionEventConstructors(ROOT)],
  );
});

test("every obligation is green on the initial state, so no red below is a member that always fails", () => {
  assert.deepEqual(
    failedObligations(config, actorInit(), refinementInvariants),
    [],
  );
  assert.ok(obligationsHold(config, actorInit(), refinementCore));
});

test("a tampered journal fails journalLegal, and journalLegal alone", () => {
  const state = journaledRelease();
  const entry = state.journal[0];
  assert.ok(entry !== undefined);
  const tampered = { ...state, journal: [{ ...entry, seq: 2 }] };
  assert.deepEqual(failedObligations(config, tampered, refinementInvariants), [
    "journalLegal",
  ]);
});

test("memory the journal cannot rebuild fails recoveryComplete", () => {
  const state = journaledRelease();
  const amnesiac = { ...state, journal: [] };
  assert.deepEqual(failedObligations(config, amnesiac, refinementInvariants), [
    "recoveryComplete",
  ]);
});

test("a cursor outside the journal, or a gapped received set, fails executorSound", () => {
  const state = journaledRelease();
  const overran = { ...state, applied: 2 };
  assert.deepEqual(failedObligations(config, overran, refinementInvariants), [
    "executorSound",
  ]);
  const gapped = { ...state, applied: 1, worldEffects: new Set([2]) };
  assert.deepEqual(failedObligations(config, gapped, refinementInvariants), [
    "executorSound",
  ]);
});

test("a Done ticket the journal never completed fails the ledger bridge, with the recovery it also broke", () => {
  const state = journaledRelease();
  const ticket = ticketAt(memoryCore(state), id(1));
  const forged = withTicket(memoryCore(state), id(1), {
    ...ticket,
    phase: "Done",
    completions: 1,
  });
  const disagreeing = { ...state, view: { ...state.view, post: forged } };
  assert.deepEqual(
    failedObligations(config, disagreeing, refinementInvariants),
    ["recoveryComplete", "journalCompletionsMatchLedger"],
  );
});
