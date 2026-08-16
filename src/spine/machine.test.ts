/**
 * `model/domain.qnt`'s state-and-actions section: the four vars, `init`,
 * `apply`, the machine step and the `settle` stutter.
 *
 * WHAT NEEDS PINNING HERE is the part a decider suite cannot see: the two
 * step-history GHOSTS read the state being LEFT, not the one being entered. Get
 * that backwards and `stepDescends` compares a measure against itself —
 * always true, never falsifiable — and `recordMonotone` compares a record
 * against itself. Both would stay green forever, which is why the ghosts are
 * pinned here against a state whose measure and records both move.
 *
 * The bundle adapter is pinned in both directions, because it is the hook the
 * replayer evaluates after every step: green on a machine state, and red on a
 * state carrying a defect an invariant names.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../domain/assert.ts";
import { boundsOf, decideDispatch, type Config } from "../domain/domain.ts";
import {
  cfgBudgeted,
  core,
  jDone,
  jDraft,
  jPend,
  solo,
} from "../domain/fixtures.test.ts";
import { sysMeasure, type Core } from "../domain/measure.ts";
import type { Cmd } from "./cmd.ts";
import {
  applyDecision,
  currentMeasure,
  currentRecords,
  initStepRecord,
  initialState,
  invariantsHold,
  quiet,
  settle,
  settledStepRecord,
  stepWith,
} from "./machine.ts";

const cfg: Config = cfgBudgeted;
const ready: Core = solo({ ...jPend, deps: new Set() });

test("initialState: the model's init, var for var", () => {
  const genesis = initialState(cfg);
  assert.deepEqual(genesis.core, { tickets: new Map() });
  assert.deepEqual(genesis.lastStep, initStepRecord);
  assert.equal(genesis.prevMeasure, 0);
  assert.deepEqual(genesis.prevRecords, new Map());
  // The bundle holds at init, which is what makes the replayer's check at
  // state 0 a real one rather than a formality.
  assert.ok(invariantsHold(cfg, genesis));
});

test("initialState: a configuration with no initial state has no machine", () => {
  // The model's init conjuncts are validity conditions: a machine that admits
  // no state is refused rather than answered.
  assert.throws(() => initialState({ ...cfg, gas: 0 }), AssertionError);
});

test("apply: both ghosts snapshot the state being LEFT", () => {
  const before = { ...initialState(cfg), core: ready };
  const decision = decideDispatch(cfg, ready, 1);
  const after = applyDecision(cfg, before, decision);

  assert.deepEqual(after.core, decision.post);
  assert.deepEqual(after.lastStep, decision.rec);
  // The measure of the PRE-state, and it differs from the post-state's: a
  // dispatch spends gas and enters Working, so the two are not interchangeable
  // and this row can tell them apart.
  assert.equal(after.prevMeasure, sysMeasure(boundsOf(cfg), ready.tickets));
  assert.notEqual(after.prevMeasure, currentMeasure(cfg, after.core));
  assert.deepEqual(after.prevRecords, currentRecords(ready));
});

test("currentRecords: the per-ticket retained record, for every live ticket", () => {
  const fleet = core([
    [1, jDraft],
    [2, jDone],
  ]);
  assert.deepEqual(
    currentRecords(fleet),
    new Map([
      [1, jDraft.record],
      [2, jDone.record],
    ]),
  );
});

test("stepWith: an enabled command steps, a refused one answers nothing", () => {
  const before = { ...initialState(cfg), core: ready };
  const dispatch: Cmd = { tag: "JDispatch", ticket: 1 };
  const stepped = stepWith(cfg, before, dispatch);
  assert.ok(stepped !== undefined);
  assert.equal(stepped.lastStep.label, "dispatch");
  // Twice in a row is refused: the ticket is Working now, and a refusal is an
  // answer rather than a throw.
  assert.equal(stepWith(cfg, stepped, dispatch), undefined);
});

test("quiet: fully arrived AND wholly terminal, over both terminals", () => {
  const oneTicket: Config = { ...cfg, nTickets: 1 };
  const revoked = { ...jDraft, phase: "PRevoked" as const };
  // Both terminals settle; every live phase does not.
  assert.ok(quiet(oneTicket, solo(jDone)));
  assert.ok(quiet(oneTicket, solo(revoked)));
  assert.equal(quiet(oneTicket, solo(jDraft)), false);
  // Room for another arrival is not quiet, however settled the fleet is.
  assert.equal(quiet({ ...cfg, nTickets: 2 }, solo(jDone)), false);
  // One live ticket among terminals is enough.
  assert.equal(
    quiet(
      { ...cfg, nTickets: 2 },
      core([
        [1, jDone],
        [2, jDraft],
      ]),
    ),
    false,
  );
});

test("settle: refused unless quiet, and it advances both ghosts", () => {
  const oneTicket: Config = { ...cfg, nTickets: 1 };
  const live = { ...initialState(oneTicket), core: solo(jDraft) };
  assert.equal(settle(oneTicket, live), undefined);

  const done = { ...initialState(oneTicket), core: solo(jDone) };
  const settled = settle(oneTicket, done);
  assert.ok(settled !== undefined);
  assert.equal(settled.core, done.core);
  assert.deepEqual(settled.lastStep, settledStepRecord);
  assert.equal(settled.prevMeasure, currentMeasure(oneTicket, done.core));
  assert.deepEqual(settled.prevRecords, currentRecords(done.core));
});

test("invariantsHold: the bundle, and it is red on a state carrying a defect", () => {
  const oneTicket: Config = { ...cfg, nTickets: 1 };
  const green = { ...initialState(oneTicket), core: solo(jDone) };
  assert.ok(invariantsHold(oneTicket, green));
  // A landed ticket whose completions ghost never moved: `completionExclusive`
  // names exactly this, and the adapter must carry it.
  const red = {
    ...green,
    core: solo({ ...jDone, completions: 0 }),
  };
  assert.equal(invariantsHold(oneTicket, red), false);
});
