/**
 * `model/tests/chuggy_refinement_test.qnt`'s UNIT MODULE, mirrored run for run:
 * journals built by hand, and the replay, legality and world-count arithmetic
 * pinned as functions.
 *
 * THE NINE RUNS, in the model's order and under the model's names:
 * `genesisReplayTest`, `journalLegalAcceptsHistoryTest`,
 * `replayAppendAgreesTest`, the four tampers (`journalRefusesSeqGapTest`,
 * `journalRefusesDisabledTest`, `journalRefusesForgedRecordTest`,
 * `journalRefusesOutOfUniversePayloadTest`), `worldArithmeticTest` and
 * `journalNoopRowsReplayTest`. Each test below carries its model run's name so
 * the two files can be diffed by eye, and every conjunct of every run is
 * asserted — not a summary of it.
 *
 * FIVE CLAIMS ARE THIS FILE'S OWN, because they are about the TypeScript and
 * the model has no counterpart to make:
 *
 *   - `genesis` is `initialState`'s fleet. The model gets this for free by
 *     writing `init`'s empty map twice in one module; here they are two
 *     functions in two files, so their agreement is pinned rather than assumed.
 *   - `replayMachine` agrees with `replayCore` on the fleet, and rebuilds the
 *     step history a real crash would have lost.
 *   - `replayCore` THROWS on a journal `journalLegalOn` refuses. That is the
 *     enablement-first ordering's whole payoff, and it is only visible from
 *     both sides: the checker answers, the fold does not, which is exactly why
 *     the checker runs first.
 *   - A SEQ EMITTED TWICE IS COUNTED ONCE. The model gets this for free from
 *     `Set[int]` — a Quint set cannot be handed the same element twice — so its
 *     own run cannot show the half that matters here, where a `Set` is a
 *     mutable object something could `add` to again.
 *   - A RECORD WITH NO HEAD TRANSITION IS CHARGED TO NOBODY, rather than to
 *     ticket 0. `stepsTicket` reads `transitions[0]` and TypeScript answers
 *     `undefined` where Quint's own indexing would not be reached at all, so
 *     the empty case is this language's to get right.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { AssertionError } from "../domain/assert.ts";
import type { Core, StepRecord } from "../domain/measure.ts";
import { cmdEnabled, execCmd, type Cmd } from "./cmd.ts";
import type { Entry } from "./entry.ts";
import {
  genesis,
  journalCompletionsOn,
  journalLegalOn,
  journalSpawnsOn,
  replayCore,
  replayMachine,
  worldCompletionsOn,
  worldSpawnsOn,
} from "./journal.ts";
import { applyDecision, initialState } from "./machine.ts";
import {
  cfgRefinement,
  dispatch,
  release,
  d3,
  e1,
  e2,
  e3,
  goodJ,
  progFlat,
} from "./refinement-fixtures.test.ts";

const cfg = cfgRefinement;

/** The one ticket of a replayed fleet. */
function ticketOf(c: Core, j: number) {
  const jb = c.tickets.get(j);
  assert.ok(jb !== undefined, `no ticket ${String(j)}`);
  return jb;
}

test("genesisReplayTest: the empty journal is legal and replays to genesis", () => {
  assert.equal(journalLegalOn(cfg, []), true);
  assert.deepEqual(replayCore(cfg, []), genesis);
});

test("genesis IS the machine's init fleet", () => {
  // Two files, one fact. The model states it in a comment because both
  // spellings sit in one module; here it is a check.
  assert.deepEqual(initialState(cfg).core, genesis);
});

test("journalLegalAcceptsHistoryTest: an honest history is legal, and replay reconstructs it", () => {
  assert.equal(journalLegalOn(cfg, goodJ), true);
  assert.deepEqual(replayCore(cfg, goodJ), d3.post);
  assert.equal(ticketOf(replayCore(cfg, goodJ), 1).phase, "PWorking");
  assert.equal(ticketOf(replayCore(cfg, goodJ), 1).gasLeft, 2);
});

test("replayAppendAgreesTest: replaying n+1 rows is stepping the n-row replay once", () => {
  assert.deepEqual(
    replayCore(cfg, goodJ),
    execCmd(cfg, replayCore(cfg, [e1, e2]), dispatch).post,
  );
  assert.deepEqual(
    replayCore(cfg, [e1, e2]),
    execCmd(cfg, replayCore(cfg, [e1]), release).post,
  );
});

test("replayMachine: the fleet is replayCore's, and the step history is rebuilt too", () => {
  const rebuilt = replayMachine(cfg, goodJ);
  assert.deepEqual(rebuilt.core, replayCore(cfg, goodJ));

  // What a process that actually crashed lost, and what the model's crash
  // action keeps by fiat: the last record and both ghosts. Rebuilt here by
  // folding the same rows through `apply`, which is where they came from.
  assert.deepEqual(rebuilt.lastStep, d3.rec);
  const twoRows = replayMachine(cfg, [e1, e2]);
  assert.deepEqual(
    rebuilt.prevMeasure,
    applyDecision(cfg, twoRows, d3).prevMeasure,
  );
  assert.deepEqual(rebuilt.prevRecords, twoRows.prevRecords);

  // An empty log rebuilds init exactly — the base case every prefix argument
  // stands on, on the side the model does not state.
  assert.deepEqual(replayMachine(cfg, []), initialState(cfg));
});

test("journalRefusesSeqGapTest: the dense monotone order is part of legality", () => {
  assert.equal(journalLegalOn(cfg, [{ ...e1, seq: 2 }]), false);
  assert.equal(journalLegalOn(cfg, [e1, { ...e2, seq: 3 }]), false);
  assert.equal(journalLegalOn(cfg, [e1, { ...e2, seq: 1 }]), false);
});

test("journalRefusesDisabledTest: a decision that was never enabled is refused", () => {
  assert.equal(cmdEnabled(cfg, genesis, release), false);
  assert.equal(journalLegalOn(cfg, [{ ...e2, seq: 1 }]), false);
  // Every one of these names a ticket the empty fleet does not hold, so the
  // membership conjunct guards the per-ticket lookup and the check REFUSES
  // rather than crashing — which is what makes the fold total.
  const absent: readonly Cmd[] = [
    { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" },
    { tag: "JDispatch", ticket: 1 },
    { tag: "JGateResolve", ticket: 1, out: "WOk" },
    { tag: "JOpRetry", ticket: 1 },
  ];
  for (const cmd of absent) {
    assert.equal(cmdEnabled(cfg, genesis, cmd), false, cmd.tag);
  }
});

test("journalRefusesForgedRecordTest: the row's record must be the decider's, exactly", () => {
  const forgedLabel: Entry = {
    ...e2,
    rec: { ...e2.rec, label: "ticket-done" },
  };
  const forgedEffects: Entry = { ...e2, rec: { ...e2.rec, effects: ["WOk"] } };
  assert.equal(journalLegalOn(cfg, [e1, forgedLabel]), false);
  assert.equal(journalLegalOn(cfg, [e1, forgedEffects]), false);
});

test("journalRefusesOutOfUniversePayloadTest: an arrival's lease comes from the universe", () => {
  const phantom: Cmd = {
    tag: "JArrive",
    deps: new Set(),
    program: progFlat,
    project: 1,
    wrapUp: { tag: "WExclusive", resource: 99 },
  };
  // The row is otherwise impeccable — dense seq, and a record a real arrival
  // produced — so only the draw-set conjunct can refuse it, and the refusal is
  // an ANSWER: the enablement check short-circuits before any decider runs.
  //
  // WHERE THE MODEL'S RUN AND THIS ONE PART, AND WHY THE MODEL IS STILL THE
  // SPEC. The model builds this row's `rec` by calling `decideArrive` on the
  // phantom, because its decider assumes the caller drew from `wrapUpChoices`
  // and will happily mint the phantom ticket. The RECORD is obtainable here too
  // and is byte-identical to the model's — `decideArrive`'s body is the same
  // function of the same arguments — but not by that CALL ROUTE: the shipped
  // decider asserts the precondition its caller is supposed to have met (the
  // bar's assert-liberally rule, `domain.ts`'s choice), so the route the model
  // takes throws, which is the assertion below. The row asserted on is
  // therefore the model's row, and `journalLegalOn` refuses it at the same
  // conjunct for the same reason. One consequence is worth stating: a missing
  // draw-set conjunct in `cmdEnabled` would turn this refusal into a CRASH
  // rather than into the model's materialized phantom ticket. Refused either
  // way, and loudly either way.
  const ePhantom: Entry = { seq: 1, cmd: phantom, rec: e1.rec };
  // And that the row IS the model's row is demonstrated rather than claimed: an
  // arrival's record does not read the lease, so two arrivals differing only in
  // it produce the same record, and the record here is the same bytes as the
  // one the model's call route returns.
  assert.deepEqual(
    execCmd(cfg, genesis, { ...phantom, wrapUp: { tag: "WNone" } }).rec,
    e1.rec,
  );
  assert.equal(cmdEnabled(cfg, genesis, phantom), false);
  assert.equal(journalLegalOn(cfg, [ePhantom]), false);
  assert.throws(() => execCmd(cfg, genesis, phantom), AssertionError);
  // nProjects is 1 here, so the refusal is membership rather than a range
  // sniff: the neighbouring resource is out of universe too.
  assert.equal(
    cmdEnabled(cfg, genesis, {
      ...phantom,
      wrapUp: { tag: "WExclusive", resource: 2 },
    }),
    false,
  );
});

test("worldArithmeticTest: the world may lag the book, and an orphan pushes it past", () => {
  const all = new Set([1, 2, 3]);
  assert.equal(journalSpawnsOn(goodJ, 1), 1);
  assert.equal(worldSpawnsOn(goodJ, new Set(), [], 1), 0);
  assert.equal(worldSpawnsOn(goodJ, all, [], 1), 1);
  assert.equal(worldSpawnsOn(goodJ, all, [d3.rec], 1), 2);
  assert.ok(worldSpawnsOn(goodJ, all, [d3.rec], 1) > journalSpawnsOn(goodJ, 1));
  assert.equal(journalCompletionsOn(goodJ, 1), 0);
});

test("worldArithmetic: emission of a seq is counted once however often it arrives", () => {
  // The set IS the absorption, so this is the arithmetic of "at-least-once
  // toward the world, keyed by decision identity" — and it is the half of the
  // model's `Set[int]` choice that its own unit run cannot show, since a Quint
  // set cannot be handed the same element twice.
  const emittedTwice = new Set([1, 2, 3]);
  emittedTwice.add(3);
  assert.equal(worldSpawnsOn(goodJ, emittedTwice, [], 1), 1);
  // ...and an emission the journal never recorded is counted by nobody: the
  // world's count is over ROWS, indexed by seq, not over the set.
  assert.equal(worldSpawnsOn(goodJ, new Set([1, 2, 3, 9]), [], 1), 1);
  // Attribution is the head transition's ticket, so another ticket's spawn is
  // not this one's.
  assert.equal(worldSpawnsOn(goodJ, emittedTwice, [], 2), 0);
  assert.equal(worldCompletionsOn(goodJ, emittedTwice, [], 1), 0);
});

test("journalNoopRowsReplayTest: an absorbed duplicate journals and replays like any row", () => {
  const real: Cmd = { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VPass" };
  const dup: Cmd = { tag: "JTaskDone", ticket: 1, tid: 1, verdict: "VFail" };
  const dReal = execCmd(cfg, d3.post, real);
  const dDup = execCmd(cfg, dReal.post, dup);
  const e4: Entry = { seq: 4, cmd: real, rec: dReal.rec };
  const e5: Entry = { seq: 5, cmd: dup, rec: dDup.rec };

  assert.equal(dDup.rec.label, "task-done-duplicate");
  assert.deepEqual(dDup.post, dReal.post);
  assert.equal(journalLegalOn(cfg, [e1, e2, e3, e4, e5]), true);
  assert.deepEqual(replayCore(cfg, [e1, e2, e3, e4, e5]), dReal.post);
});

test("replayCore assumes what journalLegalOn checks: the checker answers, the fold does not", () => {
  // The model's fold has the same shape and the same exposure — it would hit a
  // lookup error on a row the state refuses. That asymmetry is the reason
  // `journalLegalOn` asks enablement BEFORE running the decider, and the reason
  // `recoverFrom` runs the checker before the fold: a tampered journal must be
  // refused, and only a journal the checker accepted is ever replayed.
  const disabled: readonly Entry[] = [{ ...e2, seq: 1 }];
  assert.equal(journalLegalOn(cfg, disabled), false);
  assert.throws(() => replayCore(cfg, disabled), AssertionError);
});

test("the world's counters read the record, and a record with no transitions attributes to nobody", () => {
  const bodiless: StepRecord = {
    label: "ticket-done",
    transitions: [],
    effects: ["SpawnWorkTasks"],
    attempt: { tag: "WONone" },
  };
  // `stepsTicket` is the model's `transitions.length() >= 1 and
  // transitions[0].ticket == j`, and both halves matter: a record with no head
  // transition is charged to no ticket at all rather than to ticket 0.
  assert.equal(worldSpawnsOn(goodJ, new Set([1, 2, 3]), [bodiless], 1), 1);
  assert.equal(worldCompletionsOn(goodJ, new Set(), [bodiless], 1), 0);
});
