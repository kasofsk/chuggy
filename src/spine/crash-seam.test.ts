/**
 * THE CRASH-SEAM SUITE — `model/tests/chuggy_refinement_test.qnt`'s witness and
 * hazard modules, mirrored run for run, plus the seam sweep the model's
 * evaluator has no room for.
 *
 * THE FOUR MIRRORED RUNS, under the model's names:
 * `crashRecoverContinueDeterministicTest` and
 * `leaseFreeArrivalRecoversAndCompletesDeterministicTest` (the disciplined
 * machine, theorems 1-3), `hazardDoubleSpendDeterministicTest` and
 * `hazardReworkDoubleSpendDeterministicTest` (theorem 4, the expected
 * violations). Every conjunct of every expect is asserted at the step the model
 * asserts it, in the model's order, including the ones about the DOMAIN bundle:
 * the hazard runs' whole content is that the domain machine stays green while
 * this layer's world ledger goes red, so an assertion dropped from a hazard
 * expect deletes the argument rather than shortening the test.
 *
 * THE SWEEPS ARE THIS FILE'S OWN, and they are what "crash at EVERY observable
 * seam" means when a suite can be a loop. The model pins a handful of seams by
 * hand because a Quint run is a written-out chain; nothing here has that
 * budget, so the disciplined sweep crashes at every reachable combination of
 * (rows journaled, rows emitted, cursor recovered) over three walks, and the
 * hazard sweep drops an effect-first crash at every decision of the same walks.
 * The walks between them cover both landing routes — the quiet fast path and
 * the gate — and the lease-free route that reaches no landing at all.
 *
 * WHAT THE DURABLE HALF ADDS. `crashRecoverTo` is the model's crash and it
 * keeps three of the four machine vars by fiat. A process that really died kept
 * nothing, so each sweep also rebuilds the actor from the STORE's rows alone —
 * through the port, through the schema's gate, through the legality fold — and
 * requires the same state. That is the claim the model cannot make and the one
 * a real deployment needs. The hazard sweep rebuilds too, and requires the
 * OPPOSITE: an orphan is in the world, not in the journal, so recovery must
 * carry it and `journalCoversWorld` must still be red on the recovered state.
 * A recovery that dropped the world's ledger would erase the hazard on exactly
 * the path a real process takes.
 *
 * THE SEAM THIS SUITE DOES NOT DRIVE, and it is inherited rather than chosen. A
 * row may carry several effects, so a real executor can die with part of one
 * row's list out. `worldEffects` is keyed per DECISION — the model's set of
 * seqs cannot express "half of seq 8" — so that seam is invisible here exactly
 * as it is in the model (rule 4). `actor.ts`'s `emitNext` states the promise
 * that makes the omission safe and hands it to s6: every effect of a row
 * carries that row's seq, and the cursor advances only once the whole list is
 * out, so a crash mid-list re-emits the whole list and collapses into the
 * re-emission this suite does drive — at every cursor of every seam of every
 * walk below. The same sentence fixes the GRAIN of absorption: one seq per ROW,
 * absorbed as a whole list, never a key per effect VALUE — `actor.ts` states
 * that clause and its qualification together, and this copy carries the
 * cross-reference rather than the qualification, because the second copy of a
 * rule is the one that drifts. A row's effects are not a
 * set — the cascade-park witness in the corpus carries two identical
 * `OpenHumanTask`s for two parked dependents — so per-element keying would
 * collapse them and open one desk task for two tickets.
 *
 * THAT SEAM IS NOW DRIVEN ONE LAYER UP. `src/interp/execute.test.ts` crashes a
 * port part-way through the cascade's list and requires the whole list to
 * re-emit and absorb element for element; `src/interp/end-to-end.test.ts`
 * drives the same collapse across a real recovery from the store. Nothing about
 * this suite changes — the seam is still invisible to a set of seqs — but it is
 * no longer unexercised anywhere.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createInMemoryJournalStore } from "../adapters/in-memory-journal-store.ts";
import {
  actorInit,
  commit,
  crashRecoverTo,
  effectCrash,
  emitNext,
  recoverFrom,
} from "./actor.ts";
import type { Cmd } from "./cmd.ts";
import { invariantsHold } from "./machine.ts";
import {
  journalCoversWorld,
  noDoubleSpentBudget,
  noDuplicateCycle,
  recoveryComplete,
  refinementCore,
  refinementInvariants,
} from "./refinement-invariants.ts";
import {
  arrive,
  arriveLeaseFree,
  cfgRefinement,
  completeAgain,
  dispatch,
  done,
  emitTimes,
  enterGate,
  evalReduce,
  expectSteady,
  journalCompletions,
  journalSpawns,
  journalThenEmit,
  memTicket,
  must,
  quietLand,
  release,
  resolveGate,
  stepEmit,
  workReduce,
  worldCompletions,
  worldSpawns,
} from "./refinement-fixtures.test.ts";

const cfg = cfgRefinement;

// ==========================================================================
// === The mirrored runs ====================================================
// ==========================================================================

test("crashRecoverContinueDeterministicTest: journal-then-effect survives a crash at every seam of one ticket's life", () => {
  const store = createInMemoryJournalStore();
  let s = actorInit(cfg);

  // The Draft arrives and is journaled (entry 1)...
  s = must(commit(cfg, store, s, arrive), "arrive");
  assert.equal(s.journal.length, 1);
  expectSteady(s);

  // ...and the actor dies BEFORE emitting it. Recovery replays: the Draft is in
  // memory again — the decision was durable the instant it journaled.
  s = must(crashRecoverTo(cfg, s, 0), "crash before the first emission");
  assert.equal(memTicket(s, 1).phase, "PDraft");
  assert.equal(s.applied, 0);
  assert.equal(s.journal.length, 1);
  expectSteady(s);

  s = must(emitNext(s), "emit the arrival");
  assert.equal(s.applied, 1);
  expectSteady(s);

  s = stepEmit(store, s, release, "ticket-released");

  // The dispatch charges one gas and journals its Job spawn (entry 3) —
  // nothing has reached the world yet.
  s = must(commit(cfg, store, s, dispatch), "dispatch");
  assert.equal(memTicket(s, 1).gasLeft, 2);
  assert.equal(journalSpawns(s, 1), 1);
  assert.equal(worldSpawns(s, 1), 0);
  expectSteady(s);

  // CRASH at the journal->effect seam: the charge survives — charged exactly
  // once, since recovery re-derives it from the journal rather than re-taking
  // it — and the world still has no Job.
  s = must(crashRecoverTo(cfg, s, 2), "crash at the dispatch seam");
  assert.equal(memTicket(s, 1).gasLeft, 2);
  assert.equal(worldSpawns(s, 1), 0);
  assert.equal(s.applied, 2);
  expectSteady(s);

  // The executor catches up: the Job launches exactly once.
  s = must(emitNext(s), "emit the dispatch");
  assert.equal(worldSpawns(s, 1), 1);
  assert.equal(journalSpawns(s, 1), 1);
  expectSteady(s);

  // The work task resolves; its completion re-delivers with a different verdict
  // (inbound at-least-once) and the actor journals the ABSORPTION (entry 5).
  s = stepEmit(store, s, done(1, "VPass"), "task-done");
  s = stepEmit(store, s, done(1, "VFail"), "task-done-duplicate");
  assert.equal(s.journal.length, 5);
  expectSteady(s);

  // Work passes; the eval task (id 2) fails; THE REWORK charges 1 rework and
  // 1 gas and spawns the new cycle's work set (entry 8).
  s = stepEmit(store, s, workReduce, "work-passed");
  s = stepEmit(store, s, done(2, "VFail"), "task-done");
  s = must(commit(cfg, store, s, evalReduce), "the rework");
  assert.equal(s.mem.lastStep.label, "rework-started eval_failure");
  assert.equal(memTicket(s, 1).gasLeft, 1);
  assert.equal(memTicket(s, 1).reworkLeft, 0);
  assert.equal(journalSpawns(s, 1), 2);
  assert.equal(worldSpawns(s, 1), 1);
  expectSteady(s);

  // CRASH at the rework seam, with TOTAL cursor loss (the durable cursor
  // checkpoint was never written): the rework's charge survives — charged
  // exactly once across the crash — and the world still holds only the first Job.
  s = must(crashRecoverTo(cfg, s, 0), "crash at the rework seam");
  assert.equal(s.applied, 0);
  assert.equal(memTicket(s, 1).gasLeft, 1);
  assert.equal(memTicket(s, 1).reworkLeft, 0);
  assert.equal(worldSpawns(s, 1), 1);
  assert.equal(s.worldEffects.size, 7);
  expectSteady(s);

  // Recovery re-emits from the top: the first re-emission is of a seq the world
  // already holds — ABSORBED, and the set does not grow.
  s = must(emitNext(s), "the first re-emission");
  assert.equal(s.applied, 1);
  assert.equal(s.worldEffects.size, 7);
  assert.equal(worldSpawns(s, 1), 1);
  expectSteady(s);

  // ...the rest of the emitted prefix re-emits the same way...
  s = emitTimes(s, 6);
  assert.equal(s.applied, 7);
  assert.equal(s.worldEffects.size, 7);
  expectSteady(s);

  // ...and the rework's Job then launches for the FIRST time: the world count
  // closes to the book's, never past it.
  s = must(emitNext(s), "the rework's first emission");
  assert.equal(s.applied, 8);
  assert.equal(s.worldEffects.size, 8);
  assert.equal(worldSpawns(s, 1), 2);
  assert.equal(journalSpawns(s, 1), 2);
  expectSteady(s);

  // The rework cycle passes work and eval (the failed evaluator respawns — id
  // 4), and the ticket enqueues for landing.
  s = stepEmit(store, s, done(3, "VPass"), "task-done");
  s = stepEmit(store, s, workReduce, "work-passed");
  s = stepEmit(store, s, done(4, "VPass"), "task-done");
  s = stepEmit(store, s, evalReduce, "eval-passed");

  // The valid-artifact dequeue completes the ticket (entry 13) — journaled, not
  // yet emitted: the merge has NOT happened yet.
  s = must(commit(cfg, store, s, quietLand), "the landing");
  assert.equal(s.mem.lastStep.label, "ticket-done");
  assert.equal(memTicket(s, 1).phase, "PDone");
  assert.equal(journalCompletions(s, 1), 1);
  assert.equal(worldCompletions(s, 1), 0);
  expectSteady(s);

  // CRASH at the landing seam: the landing DECISION is durable, and the world
  // has still merged nothing — and will merge exactly once.
  s = must(crashRecoverTo(cfg, s, 12), "crash at the landing seam");
  assert.equal(memTicket(s, 1).phase, "PDone");
  assert.equal(memTicket(s, 1).completions, 1);
  assert.equal(worldCompletions(s, 1), 0);
  expectSteady(s);

  s = must(emitNext(s), "emit the landing");
  assert.equal(worldCompletions(s, 1), 1);
  expectSteady(s);

  // A stale completion confirmation re-delivers; the domain absorbs it and the
  // actor journals the no-op (entry 14) — the world's count does not move.
  s = stepEmit(store, s, completeAgain, "complete-duplicate");
  assert.equal(worldCompletions(s, 1), 1);
  expectSteady(s);

  // Final full-loss recovery: replay of the complete journal reconstructs the
  // settled fleet exactly — the actor can die at rest and lose nothing.
  s = must(crashRecoverTo(cfg, s, 0), "the crash at rest");
  assert.equal(memTicket(s, 1).phase, "PDone");
  assert.equal(memTicket(s, 1).gasLeft, 1);
  assert.equal(s.journal.length, 14);
  assert.equal(worldCompletions(s, 1), 1);
  assert.equal(worldSpawns(s, 1), 2);
  expectSteady(s);
});

test("leaseFreeArrivalRecoversAndCompletesDeterministicTest: the route that takes no lease carries the same obligations", () => {
  const store = createInMemoryJournalStore();
  let s = actorInit(cfg);

  s = must(commit(cfg, store, s, arriveLeaseFree), "arrive");
  assert.deepEqual(memTicket(s, 1).wrapUp, { tag: "WNone" });
  assert.equal(s.journal.length, 1);
  expectSteady(s);

  s = must(emitNext(s), "emit the arrival");
  assert.equal(s.applied, 1);
  expectSteady(s);

  s = stepEmit(store, s, release, "ticket-released");
  s = stepEmit(store, s, dispatch, "dispatch");
  s = stepEmit(store, s, done(1, "VPass"), "task-done");
  s = stepEmit(store, s, workReduce, "work-passed");
  s = stepEmit(store, s, done(2, "VPass"), "task-done");

  // THE WITNESSED STEP: evaluation passing completes the ticket outright,
  // straight out of PEvaluating. Journaled, not emitted — the world has been
  // told nothing yet.
  s = must(commit(cfg, store, s, evalReduce), "the completing evaluation");
  assert.equal(s.mem.lastStep.label, "ticket-done");
  assert.deepEqual(s.mem.lastStep.transitions, [
    { ticket: 1, from: "PEvaluating", to: "PDone" },
  ]);
  assert.deepEqual(s.mem.lastStep.landing, { tag: "WONone" });
  assert.equal(memTicket(s, 1).phase, "PDone");
  assert.equal(journalCompletions(s, 1), 1);
  assert.equal(worldCompletions(s, 1), 0);
  expectSteady(s);

  // CRASH at the completion seam, with total cursor loss: replay rebuilds the
  // Done ticket — and its lease-free kind — out of the journal alone.
  s = must(crashRecoverTo(cfg, s, 0), "crash at the completion seam");
  assert.equal(memTicket(s, 1).phase, "PDone");
  assert.deepEqual(memTicket(s, 1).wrapUp, { tag: "WNone" });
  assert.equal(memTicket(s, 1).completions, 1);
  assert.equal(s.applied, 0);
  assert.equal(worldCompletions(s, 1), 0);
  expectSteady(s);

  // The executor re-emits the whole journal: the prefix the world already holds
  // is absorbed, and the completion lands exactly once.
  s = emitTimes(s, 7);
  assert.equal(s.applied, 7);
  assert.equal(worldCompletions(s, 1), 1);
  assert.equal(worldSpawns(s, 1), 1);
  // NO WRAP-UP PHASE, over the whole journaled history rather than over the
  // states this run stops at: no row records a transition INTO either one, so
  // the gate was never entered and no lease was ever taken.
  assert.ok(
    s.journal.every((entry) =>
      entry.rec.transitions.every(
        (t) => t.to !== "PWrapUp" && t.to !== "PWrapUpHolding",
      ),
    ),
  );
  expectSteady(s);
});

test("hazardDoubleSpendDeterministicTest: effect-then-journal double-spends the dispatch and lands the same diff twice", () => {
  const store = createInMemoryJournalStore();
  let s = actorInit(cfg);
  s = journalThenEmit(store, s, arrive);
  s = journalThenEmit(store, s, release);
  expectSteady(s);

  // THE SEAM: the actor decides the dispatch, the Job LAUNCHES in the world,
  // and the actor dies before the journal write. Recovery replays a journal
  // that never dispatched: the book shows an unspent Pending ticket while the
  // world runs an un-keyed, unpaid Job. The domain machine sees NOTHING.
  s = must(effectCrash(cfg, s, dispatch), "the dispatch hazard seam");
  assert.equal(s.orphans.length, 1);
  assert.equal(memTicket(s, 1).phase, "PPending");
  assert.equal(memTicket(s, 1).gasLeft, 3);
  assert.equal(worldSpawns(s, 1), 1);
  assert.equal(journalSpawns(s, 1), 0);
  assert.equal(journalCoversWorld(s), false);
  assert.equal(noDoubleSpentBudget(s), false);
  assert.ok(refinementCore(cfg, s), "the journal and the replay are untouched");
  assert.ok(invariantsHold(cfg, s.mem), "the domain machine is blind to this");

  // The recovered actor legitimately re-decides the dispatch — one journaled
  // charge, and now TWO Jobs in the world: the double-spent budget, concrete.
  s = journalThenEmit(store, s, dispatch);
  assert.equal(memTicket(s, 1).gasLeft, 2);
  assert.equal(worldSpawns(s, 1), 2);
  assert.equal(journalSpawns(s, 1), 1);
  assert.equal(noDoubleSpentBudget(s), false);
  assert.ok(refinementCore(cfg, s));
  assert.ok(invariantsHold(cfg, s.mem));

  // Walk the (journaled) cycle to the landing queue.
  s = journalThenEmit(store, s, done(1, "VPass"));
  s = journalThenEmit(store, s, workReduce);
  s = journalThenEmit(store, s, done(2, "VPass"));
  s = journalThenEmit(store, s, evalReduce);
  assert.equal(memTicket(s, 1).phase, "PWrapUp");
  assert.ok(invariantsHold(cfg, s.mem));

  // THE SEAM AT THE LANDING: a valid-artifact dequeue squash-merges IN THE
  // WORLD, the crash eats the journal write — the book still shows the ticket
  // enqueued, completions 0.
  s = must(effectCrash(cfg, s, quietLand), "the landing hazard seam");
  assert.equal(s.orphans.length, 2);
  assert.equal(worldCompletions(s, 1), 1);
  assert.equal(memTicket(s, 1).phase, "PWrapUp");
  assert.equal(memTicket(s, 1).completions, 0);
  assert.ok(refinementCore(cfg, s));
  assert.ok(invariantsHold(cfg, s.mem));

  // The recovered actor re-lands the enqueued ticket: the SAME diff merges a
  // second time — the duplicate cycle — while the journal records exactly one
  // clean completion and the domain's completionExclusive stays green.
  s = journalThenEmit(store, s, quietLand);
  assert.equal(worldCompletions(s, 1), 2);
  assert.equal(journalCompletions(s, 1), 1);
  assert.equal(memTicket(s, 1).completions, 1);
  assert.equal(noDuplicateCycle(s), false);
  assert.ok(refinementCore(cfg, s));
  assert.ok(invariantsHold(cfg, s.mem));
});

test("hazardReworkDoubleSpendDeterministicTest: the rework's charge dies with the crash and the world runs it twice", () => {
  const store = createInMemoryJournalStore();
  let s = actorInit(cfg);
  for (const cmd of [
    arrive,
    release,
    dispatch,
    done(1, "VPass"),
    workReduce,
    done(2, "VFail"),
  ]) {
    s = journalThenEmit(store, s, cmd);
  }
  assert.equal(memTicket(s, 1).gasLeft, 2);
  assert.equal(memTicket(s, 1).reworkLeft, 1);
  expectSteady(s);

  // THE SEAM AT THE REWORK: the rework Job fans out in the world; the crash
  // loses the decision — and with it the charge. The book says the rework never
  // started (accounts untouched), the world runs it anyway.
  s = must(effectCrash(cfg, s, evalReduce), "the rework hazard seam");
  assert.equal(s.orphans.length, 1);
  assert.equal(memTicket(s, 1).phase, "PEvaluating");
  assert.equal(memTicket(s, 1).gasLeft, 2);
  assert.equal(memTicket(s, 1).reworkLeft, 1);
  assert.equal(worldSpawns(s, 1), 2);
  assert.equal(journalSpawns(s, 1), 1);
  assert.equal(noDoubleSpentBudget(s), false);
  assert.ok(refinementCore(cfg, s));
  assert.ok(invariantsHold(cfg, s.mem));

  // The recovered actor re-decides the rework: ONE journaled charge (1 rework
  // and 1 gas), THREE Jobs' worth of spend in the world.
  s = journalThenEmit(store, s, evalReduce);
  assert.equal(s.mem.lastStep.label, "rework-started eval_failure");
  assert.equal(memTicket(s, 1).gasLeft, 1);
  assert.equal(memTicket(s, 1).reworkLeft, 0);
  assert.equal(worldSpawns(s, 1), 3);
  assert.equal(journalSpawns(s, 1), 2);
  assert.equal(noDoubleSpentBudget(s), false);
  assert.ok(refinementCore(cfg, s));
  assert.ok(invariantsHold(cfg, s.mem));
});

// ==========================================================================
// === The sweeps ===========================================================
// ==========================================================================

/**
 * The three walks the sweeps run over: the model's own witness walk (a rework
 * and the quiet fast-path landing), the GATED landing (dequeue to the gate,
 * then the promotion), and the lease-free route that reaches no landing at all.
 *
 * Between them every decision the crash-seam obligations name appears at least
 * once — the paid spawns, both landing routes, both stutters — so a sweep over
 * all three is a sweep over every seam a decision of that kind can sit at.
 */
const walks: readonly (readonly [string, readonly Cmd[]])[] = [
  [
    "the rework walk, quiet landing",
    [
      arrive,
      release,
      dispatch,
      done(1, "VPass"),
      workReduce,
      done(1, "VFail"),
      done(2, "VFail"),
      evalReduce,
      done(3, "VPass"),
      workReduce,
      done(4, "VPass"),
      evalReduce,
      quietLand,
      completeAgain,
    ],
  ],
  [
    "the gated walk",
    [
      arrive,
      release,
      dispatch,
      done(1, "VPass"),
      workReduce,
      done(2, "VPass"),
      evalReduce,
      enterGate,
      resolveGate,
    ],
  ],
  [
    "the lease-free walk",
    [
      arriveLeaseFree,
      release,
      dispatch,
      done(1, "VPass"),
      workReduce,
      done(2, "VPass"),
      evalReduce,
    ],
  ],
];

test("the disciplined sweep: a crash at every seam, at every surviving cursor, recovers completely", () => {
  for (const [name, walk] of walks) {
    const store = createInMemoryJournalStore();
    let journaled = actorInit(cfg);

    for (let k = 0; k <= walk.length; k += 1) {
      const rows = store.readAll();
      assert.equal(rows.length, k, `${name}: the store holds the journal`);

      for (let emitted = 0; emitted <= k; emitted += 1) {
        // The seam: `k` rows decided and durable, `emitted` of them out in the
        // world. `emitted < k` is the post-journal pre-emission seam, and
        // `emitted == k` is the actor at rest.
        const live = emitTimes(journaled, emitted);

        for (let cursor = 0; cursor <= emitted; cursor += 1) {
          // Every cursor the crash could come back with: 0 is "the checkpoint
          // was never written", `emitted` is "it was current", and everything
          // between is a checkpoint that lagged.
          const crashed = must(
            crashRecoverTo(cfg, live, cursor),
            `${name}: crash at ${String(k)}/${String(emitted)}/${String(cursor)}`,
          );
          assert.equal(crashed.applied, cursor);
          assert.ok(recoveryComplete(cfg, crashed));
          // A crash is INVISIBLE at the domain grain: not merely the fleet, but
          // the last record and both step-history ghosts, unmoved.
          assert.deepEqual(crashed.mem, live.mem);
          expectSteady(crashed);

          // Catching up re-emits the lost suffix, and every re-emission is
          // absorbed: the world ends where it was, never past it.
          const caughtUp = emitTimes(crashed, emitted - cursor);
          assert.deepEqual(caughtUp.worldEffects, live.worldEffects);
          expectSteady(caughtUp);
        }

        // THE DURABLE CRASH at the same seam: keep nothing at all, and rebuild
        // from the store's rows through the port, the schema's gate and the
        // legality fold. The harshest cursor (total loss) is the one taken,
        // because it is the one that re-emits the most.
        const rebuilt = must(
          recoverFrom(cfg, rows, 0, {
            worldEffects: live.worldEffects,
            orphans: live.orphans,
          }),
          `${name}: durable rebuild at ${String(k)}/${String(emitted)}`,
        );
        assert.deepEqual(rebuilt.mem, live.mem);
        assert.deepEqual(rebuilt.journal, live.journal);
        expectSteady(rebuilt);
      }

      const next = walk[k];
      if (next !== undefined) {
        journaled = must(
          commit(cfg, store, journaled, next),
          `${name}: commit ${next.tag} at ${String(k)}`,
        );
      }
    }
  }
});

test("the hazard sweep: an effect-first crash at every decision of every walk is invisible to the domain", () => {
  for (const [name, walk] of walks) {
    const store = createInMemoryJournalStore();
    let s = actorInit(cfg);

    for (const [k, cmd] of walk.entries()) {
      const where = `${name}: ${cmd.tag} at ${String(k)}`;
      // The same decision, taken the wrong way round: emitted, then lost.
      const hazard = must(effectCrash(cfg, s, cmd), where);
      assert.equal(hazard.orphans.length, 1, where);
      // The coverage half falls at every seam without exception...
      assert.equal(journalCoversWorld(hazard), false, where);
      assert.equal(refinementInvariants(cfg, hazard), false, where);
      // ...while the journal, the replay and the ledger bridge stay sound, and
      // the domain machine reports nothing at all. That blindness is the
      // argument that this layer, not the domain, owns the obligation.
      assert.ok(refinementCore(cfg, hazard), where);
      assert.ok(invariantsHold(cfg, hazard.mem), where);
      // Memory is the replay of a journal that never saw the decision, so the
      // actor is free to re-decide it — which is how the orphan becomes a
      // second spend rather than a lost one.
      assert.deepEqual(hazard.mem, s.mem, where);

      // THE COMPOSITION, on the path a real process takes. A crashed process
      // does not resume from a state in memory; it comes back through
      // `recoverFrom` with the store's rows and the world's ledger. The hazard
      // must survive that: the orphan is in the WORLD, and no amount of
      // rebuilding from a journal that never recorded it can make it untrue.
      // A recovery that dropped the ledger would report a clean actor over a
      // world that had already been paid for twice — the hazard erased on
      // exactly the path that matters.
      const rebuilt = must(
        recoverFrom(cfg, store.readAll(), hazard.applied, {
          worldEffects: hazard.worldEffects,
          orphans: hazard.orphans,
        }),
        `${where}: durable rebuild`,
      );
      assert.deepEqual(rebuilt.orphans, hazard.orphans, where);
      assert.equal(journalCoversWorld(rebuilt), false, where);
      assert.equal(refinementInvariants(cfg, rebuilt), false, where);
      assert.ok(refinementCore(cfg, rebuilt), where);
      assert.ok(invariantsHold(cfg, rebuilt.mem), where);
      assert.deepEqual(rebuilt.mem, hazard.mem, where);

      s = journalThenEmit(store, s, cmd);
    }
  }
});

test("the hazard sweep: every orphaned PAID decision, re-decided, double-spends", () => {
  // The sweep above is over every decision; this is over the ones the theorems
  // PRICE — the model's own hazard roster, which is the paid spawns and the two
  // landing resolutions. A bookkeeping effect orphans just as readily and
  // `journalCoversWorld` flags it; only these move the arithmetic.
  //
  // AND THE ARITHMETIC MOVES ON THE RE-DECISION, NOT ON THE ORPHAN. One orphan
  // is one spend, which no counter forbids on its own; what the theorems forbid
  // is the world doing it TWICE for one journaled charge, and that second time
  // is the recovered actor legitimately re-deciding from a book that never
  // recorded the first. The model's runs make exactly this shape twice; this
  // makes it at every priced seam, including the gate promotion, which the
  // model's hazard roster names and no model run drives.
  const priced: readonly (readonly [string, readonly Cmd[], Cmd])[] = [
    ["the dispatch", [arrive, release], dispatch],
    [
      "the eval rework",
      [
        arrive,
        release,
        dispatch,
        done(1, "VPass"),
        workReduce,
        done(2, "VFail"),
      ],
      evalReduce,
    ],
    [
      "the quiet landing",
      [
        arrive,
        release,
        dispatch,
        done(1, "VPass"),
        workReduce,
        done(2, "VPass"),
        evalReduce,
      ],
      quietLand,
    ],
    [
      "the gate promotion",
      [
        arrive,
        release,
        dispatch,
        done(1, "VPass"),
        workReduce,
        done(2, "VPass"),
        evalReduce,
        enterGate,
      ],
      resolveGate,
    ],
  ];

  for (const [what, prefix, seam] of priced) {
    const store = createInMemoryJournalStore();
    let s = actorInit(cfg);
    for (const cmd of prefix) {
      s = journalThenEmit(store, s, cmd);
    }
    expectSteady(s);

    const before = {
      spawns: worldSpawns(s, 1),
      completions: worldCompletions(s, 1),
    };
    const orphaned = must(effectCrash(cfg, s, seam), what);
    // The world moved and the book did not.
    assert.ok(
      worldSpawns(orphaned, 1) > before.spawns ||
        worldCompletions(orphaned, 1) > before.completions,
      `${what}: the orphan cost the world nothing`,
    );
    assert.equal(journalCoversWorld(orphaned), false, what);
    assert.ok(
      invariantsHold(cfg, orphaned.mem),
      `${what}: the domain is blind`,
    );

    // The recovered actor re-decides from a book that never recorded the first
    // attempt — and the world does the paid thing a second time.
    const redecided = journalThenEmit(store, orphaned, seam);
    assert.ok(
      worldSpawns(redecided, 1) > journalSpawns(redecided, 1) ||
        worldCompletions(redecided, 1) > 1,
      `${what}: the re-decision did not double-spend`,
    );
    assert.ok(
      !noDoubleSpentBudget(redecided) || !noDuplicateCycle(redecided),
      `${what}: neither theorem priced the double spend`,
    );
    assert.ok(refinementCore(cfg, redecided), `${what}: the journal is sound`);
    assert.ok(
      invariantsHold(cfg, redecided.mem),
      `${what}: the domain is still blind`,
    );
  }
});
