/// REFINEMENT-LAYER TESTS (roadmap PR 6 — model/refinement.qnt;
/// design, theorems, and the seam model at that file's header). Three
/// modules, run by check.sh Stage 10 and `just chuggy`:
///
///   - chuggy_refinement_unit_test — PURE: journals built by hand,
///     replay/legality/world-count arithmetic pinned as functions
///     (including the tampered-journal refusals and the
///     replay-append agreement that is theorem 3's mechanism).
///   - chuggy_refinement_witness_test — the DISCIPLINED machine trace:
///     one ticket walked arrive -> dispatch -> eval-fail -> REWORK ->
///     eval-pass -> quiet landing, with crash/recover injected at every
///     observable seam (post-journal pre-emission at the dispatch, the
///     rework, and the landing; total cursor loss with re-emission
///     absorbed; final full-journal recovery), asserting
///     `allDomainInvariants and refinementInvariants` after EVERY step —
///     the crash-recover-continue gate run.
///   - chuggy_refinement_hazard_test — the EXPECTED-VIOLATION traces
///     (theorem 4): the effect-then-journal seam double-spending on
///     recovery — the dispatch double-spend, the duplicate landing, and
///     the REWORK double-spend (the §4 flows-analysis scenario named by
///     the charter: "the service must journal decisions or
///     double-spend") — each violated conjunct asserted at the exact
///     step it falls, WITH allDomainInvariants still green on the same
///     step: the domain machine cannot see the hazard, which is the
///     refinement layer's reason to exist.
///
/// DRIVER DISCIPLINE (the witness-harness rule, inherited): these runs
/// drive chuggy_refinement's OWN actions — journalStep(cmd) is the
/// machine's actor step with its nondet picks named (it conjoins
/// cmdEnabled, the same guard the replay checker re-checks, so a
/// refused pick fails the run), emitNext / crashRecoverTo(a) /
/// effectCrash(cmd) are the executor/crash actions themselves — so
/// every accepted trace is a trace of rstep (resp. rstepHazard).
/// Nothing here copies a guard.
///
/// Quint 0.32: `quint test` executes only runs whose names match
/// "test" — every run below ends in Test. Imports are not re-exported,
/// so domain-instance facts are asserted through chuggy_refinement's
/// wrapper vals (allDomainInvariants, memCore, obs).

module chuggy_refinement_unit_test {
  import chuggy_measure.* from "../measure"
  import chuggy_refinement.* from "../refinement"

  pure val progFlat: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  // A three-decision history built BY the deciders (arrive, release,
  // dispatch), entry records taken from the decisions themselves — the
  // journal an honest actor would write.
  pure val cmd1: Cmd = JArrive({ deps: Set(), prog: progFlat, repo: 1, wrapUp: WExclusive(1) })
  pure val d1: Decision = execCmd(genesis, cmd1)
  pure val e1: Entry = { seq: 1, cmd: cmd1, rec: d1.rec }
  pure val cmd2: Cmd = JRelease(1)
  pure val d2: Decision = execCmd(d1.post, cmd2)
  pure val e2: Entry = { seq: 2, cmd: cmd2, rec: d2.rec }
  pure val cmd3: Cmd = JDispatch(1)
  pure val d3: Decision = execCmd(d2.post, cmd3)
  pure val e3: Entry = { seq: 3, cmd: cmd3, rec: d3.rec }
  pure val goodJ: List[Entry] = [e1, e2, e3]

  /// The empty journal is legal and replays to genesis (the base case
  /// every prefix argument stands on).
  run genesisReplayTest = assert(and {
    journalLegalOn([]),
    replayCore([]) == genesis
  })

  /// An honest history is legal, and replay reconstructs exactly the
  /// state the deciders built (theorem 1 + 3 on concrete data).
  run journalLegalAcceptsHistoryTest = assert(and {
    journalLegalOn(goodJ),
    replayCore(goodJ) == d3.post,
    replayCore(goodJ).tickets.get(1).phase == PWorking,
    replayCore(goodJ).tickets.get(1).gasLeft == 2
  })

  /// THEOREM 3's mechanism — incremental/batch agreement: replaying
  /// n+1 entries equals stepping the n-entry replay once (the deciders
  /// are pure, so the fold and the live actor cannot disagree).
  run replayAppendAgreesTest = assert(and {
    replayCore(goodJ) == execCmd(replayCore([e1, e2]), cmd3).post,
    replayCore([e1, e2]) == execCmd(replayCore([e1]), cmd2).post
  })

  /// Tamper 1 — a sequence gap: the monotone dense seq order is part of
  /// legality (the journal never gains an out-of-order or duplicate
  /// row).
  run journalRefusesSeqGapTest = assert(and {
    not(journalLegalOn([{ ...e1, seq: 2 }])),
    not(journalLegalOn([e1, { ...e2, seq: 3 }])),
    not(journalLegalOn([e1, { ...e2, seq: 1 }]))
  })

  /// Tamper 2 — a decision that was never enabled: release at genesis
  /// (no ticket exists). Enablement is re-checked at every replayed
  /// prefix with the domain's own guards — the actor cannot journal a
  /// decision the machine would refuse — and the check is TOTAL: a cmd
  /// naming a ticket the state does not hold refuses cleanly (the
  /// set-membership conjuncts guard the per-ticket lookups), so a
  /// tampered journal is rejected, never crashed on.
  run journalRefusesDisabledTest = assert(and {
    not(cmdEnabled(genesis, cmd2)),
    not(journalLegalOn([{ ...e2, seq: 1 }])),
    not(cmdEnabled(genesis, JTaskDone({ ticket: 1, tid: 1, verdict: VPass }))),
    not(cmdEnabled(genesis, JDispatch(1))),
    not(cmdEnabled(genesis, JGateResolve({ ticket: 1, out: WOk }))),
    not(cmdEnabled(genesis, JOpRetry(1)))
  })

  /// Tamper 3 — a forged record: the entry's rec must be EXACTLY what
  /// the domain decider produces at the replayed state (a journal
  /// claiming a landing that the deciders would not have decided is
  /// illegal — the refinement claim at row grain).
  run journalRefusesForgedRecordTest = assert(and {
    not(journalLegalOn([e1, { ...e2, rec: { ...e2.rec, label: "ticket-done" } }])),
    not(journalLegalOn([e1, { ...e2, rec: { ...e2.rec, effects: ["WOk"] } }]))
  })

  /// The world/journal arithmetic of theorem 2, on concrete data: an
  /// unemitted spawn counts on the book only; emission closes the gap
  /// to equality; an ORPHAN (the same decision's record with no seq)
  /// pushes the world PAST the book — the double-spend, as arithmetic.
  run worldArithmeticTest = assert(and {
    journalSpawnsOn(goodJ, 1) == 1,
    worldSpawnsOn(goodJ, Set(), [], 1) == 0,
    worldSpawnsOn(goodJ, Set(1, 2, 3), [], 1) == 1,
    worldSpawnsOn(goodJ, Set(1, 2, 3), [d3.rec], 1) == 2,
    worldSpawnsOn(goodJ, Set(1, 2, 3), [d3.rec], 1) > journalSpawnsOn(goodJ, 1),
    journalLandingsOn(goodJ, 1) == 0
  })

  /// No-op decisions journal like any others and replay through: a
  /// duplicate task-completion delivery absorbs in the domain
  /// (state-identical decision) and its journal row is legal — the
  /// inbound at-least-once composed through the journal (the header's
  /// composition argument, inbound half).
  run journalNoopRowsReplayTest =
    val dReal = execCmd(d3.post, JTaskDone({ ticket: 1, tid: 1, verdict: VPass }))
    val dDup = execCmd(dReal.post, JTaskDone({ ticket: 1, tid: 1, verdict: VFail }))
    val e4: Entry = { seq: 4, cmd: JTaskDone({ ticket: 1, tid: 1, verdict: VPass }), rec: dReal.rec }
    val e5: Entry = { seq: 5, cmd: JTaskDone({ ticket: 1, tid: 1, verdict: VFail }), rec: dDup.rec }
    assert(and {
      dDup.rec.label == "task-done-duplicate",
      dDup.post == dReal.post,
      journalLegalOn([e1, e2, e3, e4, e5]),
      replayCore([e1, e2, e3, e4, e5]) == dReal.post
    })
}

/// THE DISCIPLINED WITNESS — journal-then-effect survives crash/recover
/// at every seam (theorems 1-3 on a machine trace, the PR-gate run).
/// The walk includes a REWORK (rework-started eval_failure: the
/// re-entry that charges — where a double-spend would bite if the
/// discipline were broken) and both classes of recovery: cursor-intact
/// (the decision journaled but unemitted survives, its charge is not
/// re-taken) and total cursor loss (the whole emitted prefix re-emits
/// and every re-emission is absorbed by decision identity).
module chuggy_refinement_witness_test {
  import chuggy_measure.* from "../measure"
  import chuggy_refinement.* from "../refinement"

  pure val progFlat: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  /// The routine decision+emission pair, invariants asserted at BOTH
  /// intermediate states (post-journal with the produced label pinned,
  /// and post-emission) — the "allInvariants + refinement invariants at
  /// every step" gate, packaged so the run's chain stays inside the
  /// evaluator's expression-depth budget (Quint 0.32's rust evaluator
  /// rejects run chains much past ~50 links — measured; composing the
  /// pair inside an action nests locally instead of lengthening the
  /// spine). Steps that crash, absorb, or pin counts stay unpacked in
  /// the run.
  action stepEmit(cmd: Cmd, lbl: str): bool =
    journalStep(cmd)
      .expect(and { obs.label == lbl, allDomainInvariants, refinementInvariants })
      .then(emitNext)
      .expect(and { allDomainInvariants, refinementInvariants })

  run crashRecoverContinueDeterministicTest =
    rinit
      // The Draft arrives and is journaled (entry 1)...
      .then(journalStep(JArrive({ deps: Set(), prog: progFlat, repo: 1, wrapUp: WExclusive(1) })))
      .expect(and { journal.length() == 1, allDomainInvariants, refinementInvariants })
      // ...and the actor dies BEFORE emitting it. Recovery replays: the
      // Draft is in memory again — the decision was durable the instant
      // it journaled.
      .then(crashRecoverTo(0))
      .expect(and {
        memCore.tickets.get(1).phase == PDraft,
        applied == 0,
        journal.length() == 1,
        allDomainInvariants, refinementInvariants
      })
      .then(emitNext)
      .expect(and { applied == 1, allDomainInvariants, refinementInvariants })
      .then(stepEmit(JRelease(1), "ticket-released"))
      // The dispatch charges one gas and journals its Job spawn
      // (entry 3) — nothing has reached the world yet.
      .then(journalStep(JDispatch(1)))
      .expect(and {
        memCore.tickets.get(1).gasLeft == 2,
        journalSpawns(1) == 1,
        worldSpawns(1) == 0,
        allDomainInvariants, refinementInvariants
      })
      // CRASH at the journal->effect seam: the charge survives (charged
      // exactly once — recovery re-derives it from the journal, it does
      // not re-take it), the world still has no Job.
      .then(crashRecoverTo(2))
      .expect(and {
        memCore.tickets.get(1).gasLeft == 2,
        worldSpawns(1) == 0,
        applied == 2,
        allDomainInvariants, refinementInvariants
      })
      // The executor catches up: the Job launches exactly once.
      .then(emitNext)
      .expect(and {
        worldSpawns(1) == 1,
        journalSpawns(1) == 1,
        allDomainInvariants, refinementInvariants
      })
      // The work task resolves; its completion re-delivers with a
      // different verdict (inbound at-least-once) and the actor
      // journals the ABSORPTION — a no-op row (entry 5).
      .then(stepEmit(JTaskDone({ ticket: 1, tid: 1, verdict: VPass }), "task-done"))
      .then(stepEmit(JTaskDone({ ticket: 1, tid: 1, verdict: VFail }), "task-done-duplicate"))
      .expect(and { journal.length() == 5, allDomainInvariants, refinementInvariants })
      // Work passes; the eval task (id 2) fails; THE REWORK charges
      // 1 rework + 1 gas and spawns the new cycle's work set (entry 8).
      .then(stepEmit(JWorkReduce(1), "work-passed"))
      .then(stepEmit(JTaskDone({ ticket: 1, tid: 2, verdict: VFail }), "task-done"))
      .then(journalStep(JEvalReduce(1)))
      .expect(and {
        obs.label == "rework-started eval_failure",
        memCore.tickets.get(1).gasLeft == 1,
        memCore.tickets.get(1).reworkLeft == 0,
        journalSpawns(1) == 2,
        worldSpawns(1) == 1,
        allDomainInvariants, refinementInvariants
      })
      // CRASH at the rework seam, with TOTAL cursor loss (the durable
      // cursor checkpoint was never written): the rework's charge
      // survives — charged exactly once across the crash — and the
      // world still holds only the first Job.
      .then(crashRecoverTo(0))
      .expect(and {
        applied == 0,
        memCore.tickets.get(1).gasLeft == 1,
        memCore.tickets.get(1).reworkLeft == 0,
        worldSpawns(1) == 1,
        worldEffects.size() == 7,
        allDomainInvariants, refinementInvariants
      })
      // Recovery re-emits from the top: the first re-emission is of a
      // seq the world already holds — ABSORBED (at-least-once toward
      // the world, keyed by decision identity; the set does not grow).
      .then(emitNext)
      .expect(and {
        applied == 1,
        worldEffects.size() == 7,
        worldSpawns(1) == 1,
        allDomainInvariants, refinementInvariants
      })
      // ...the rest of the emitted prefix re-emits the same way...
      .then(6.reps(_ => emitNext))
      .expect(and { applied == 7, worldEffects.size() == 7, allDomainInvariants, refinementInvariants })
      // ...and the rework's Job then launches for the FIRST time: the
      // world count closes to the book's, never past it.
      .then(emitNext)
      .expect(and {
        applied == 8,
        worldEffects.size() == 8,
        worldSpawns(1) == 2,
        journalSpawns(1) == 2,
        allDomainInvariants, refinementInvariants
      })
      // The rework cycle passes work and eval (the failed evaluator
      // respawns — id 4), and the ticket enqueues for landing.
      .then(stepEmit(JTaskDone({ ticket: 1, tid: 3, verdict: VPass }), "task-done"))
      .then(stepEmit(JWorkReduce(1), "work-passed"))
      .then(stepEmit(JTaskDone({ ticket: 1, tid: 4, verdict: VPass }), "task-done"))
      .then(stepEmit(JEvalReduce(1), "eval-passed"))
      // The valid-artifact dequeue lands the ticket (entry 13, WOk) —
      // journaled, not yet emitted: the merge has NOT happened yet.
      .then(journalStep(JDequeue({ ticket: 1, moved: false })))
      .expect(and {
        obs.label == "ticket-done",
        memCore.tickets.get(1).phase == PDone,
        journalLandings(1) == 1,
        worldLandings(1) == 0,
        allDomainInvariants, refinementInvariants
      })
      // CRASH at the landing seam: the landing DECISION is durable
      // (recovery rebuilds Done from the journal); the world has still
      // merged nothing — and will merge exactly once.
      .then(crashRecoverTo(12))
      .expect(and {
        memCore.tickets.get(1).phase == PDone,
        memCore.tickets.get(1).completions == 1,
        worldLandings(1) == 0,
        allDomainInvariants, refinementInvariants
      })
      .then(emitNext)
      .expect(and {
        worldLandings(1) == 1,
        allDomainInvariants, refinementInvariants
      })
      // A stale landing confirmation re-delivers; the domain absorbs it
      // and the actor journals the no-op (entry 14) — the world's
      // landing count does not move.
      .then(stepEmit(JLandDuplicate(1), "complete-duplicate"))
      .expect(and { worldLandings(1) == 1, allDomainInvariants, refinementInvariants })
      // Final full-loss recovery: replay of the complete journal
      // reconstructs the settled fleet exactly — the actor can die at
      // rest and lose nothing.
      .then(crashRecoverTo(0))
      .expect(and {
        memCore.tickets.get(1).phase == PDone,
        memCore.tickets.get(1).gasLeft == 1,
        journal.length() == 14,
        worldLandings(1) == 1,
        worldSpawns(1) == 2,
        allDomainInvariants, refinementInvariants
      })
}

/// THE HAZARD WITNESS (theorem 4, expected violations) — effect-then-
/// journal double-spends on recovery, deterministically. Each run
/// asserts the violated conjunct AT the step it falls AND
/// allDomainInvariants green ON THE SAME STEP: the journaled history
/// stays a perfectly legal domain trace while the world diverges — the
/// hazard is invisible at the domain grain, visible only to this
/// layer's world ledger. (The house pattern: the hazard is kept
/// reproducible by configuration — here the rstepHazard step relation,
/// whose one delta over rstep is exactly this seam.)
module chuggy_refinement_hazard_test {
  import chuggy_measure.* from "../measure"
  import chuggy_refinement.* from "../refinement"

  pure val progFlat: List[Stage] = [{ fanout: 1, combinator: CUnanimousPass }]

  /// The dispatch double-spend and the duplicate landing, one trace:
  /// the two shapes the roadmap gate names ("no double-spent budget, no
  /// duplicate cycle"), each produced by one effect-first crash.
  run hazardDoubleSpendDeterministicTest =
    rinit
      .then(journalStep(JArrive({ deps: Set(), prog: progFlat, repo: 1, wrapUp: WExclusive(1) })))
      .then(emitNext)
      .then(journalStep(JRelease(1)))
      .then(emitNext)
      .expect(and { allDomainInvariants, refinementInvariants })
      // THE SEAM: the actor decides dispatch, the Job LAUNCHES in the
      // world, and the actor dies before the journal write. Recovery
      // replays a journal that never dispatched: the book shows an
      // unspent Pending ticket — while the world runs an un-keyed,
      // unpaid Job. The domain machine sees NOTHING (every invariant
      // green); only the world ledger knows.
      .then(effectCrash(JDispatch(1)))
      .expect(and {
        orphans.length() == 1,
        memCore.tickets.get(1).phase == PPending,
        memCore.tickets.get(1).gasLeft == 3,
        worldSpawns(1) == 1,
        journalSpawns(1) == 0,
        not(journalCoversWorld),
        not(noDoubleSpentBudget),
        journalLegal,
        recoveryComplete,
        allDomainInvariants
      })
      // The recovered actor legitimately re-decides the dispatch — one
      // journaled charge, and now TWO Jobs in the world: the
      // double-spent budget, concrete.
      .then(journalStep(JDispatch(1)))
      .then(emitNext)
      .expect(and {
        memCore.tickets.get(1).gasLeft == 2,
        worldSpawns(1) == 2,
        journalSpawns(1) == 1,
        not(noDoubleSpentBudget),
        refinementCore,
        allDomainInvariants
      })
      // Walk the (journaled) cycle to the landing queue.
      .then(journalStep(JTaskDone({ ticket: 1, tid: 1, verdict: VPass })))
      .then(emitNext)
      .then(journalStep(JWorkReduce(1)))
      .then(emitNext)
      .then(journalStep(JTaskDone({ ticket: 1, tid: 2, verdict: VPass })))
      .then(emitNext)
      .then(journalStep(JEvalReduce(1)))
      .then(emitNext)
      .expect(and {
        memCore.tickets.get(1).phase == PWrapUp,
        allDomainInvariants
      })
      // THE SEAM AT THE LANDING: a valid-artifact dequeue squash-merges IN THE
      // WORLD, the crash eats the journal write — the book still shows
      // the ticket enqueued, completions 0.
      .then(effectCrash(JDequeue({ ticket: 1, moved: false })))
      .expect(and {
        orphans.length() == 2,
        worldLandings(1) == 1,
        memCore.tickets.get(1).phase == PWrapUp,
        memCore.tickets.get(1).completions == 0,
        journalLegal,
        recoveryComplete,
        allDomainInvariants
      })
      // The recovered actor re-lands the enqueued ticket: the SAME
      // diff merges a second time — the duplicate cycle — while the
      // journal records exactly one clean landing and the domain's
      // completionExclusive stays green throughout.
      .then(journalStep(JDequeue({ ticket: 1, moved: false })))
      .then(emitNext)
      .expect(and {
        worldLandings(1) == 2,
        journalLandings(1) == 1,
        memCore.tickets.get(1).completions == 1,
        not(noDuplicateCycle),
        refinementCore,
        allDomainInvariants
      })

  /// THE REWORK DOUBLE-SPEND — the flows-analysis scenario, verbatim
  /// shape: the rework decision's Job launches, the crash eats both the
  /// journal write AND the charge (recovery finds the accounts full),
  /// and the re-decided rework charges once for two Jobs in the world.
  run hazardReworkDoubleSpendDeterministicTest =
    rinit
      .then(journalStep(JArrive({ deps: Set(), prog: progFlat, repo: 1, wrapUp: WExclusive(1) })))
      .then(emitNext)
      .then(journalStep(JRelease(1)))
      .then(emitNext)
      .then(journalStep(JDispatch(1)))
      .then(emitNext)
      .then(journalStep(JTaskDone({ ticket: 1, tid: 1, verdict: VPass })))
      .then(emitNext)
      .then(journalStep(JWorkReduce(1)))
      .then(emitNext)
      .then(journalStep(JTaskDone({ ticket: 1, tid: 2, verdict: VFail })))
      .then(emitNext)
      .expect(and {
        memCore.tickets.get(1).gasLeft == 2,
        memCore.tickets.get(1).reworkLeft == 1,
        allDomainInvariants, refinementInvariants
      })
      // THE SEAM AT THE REWORK: the rework Job fans out in the world;
      // the crash loses the decision — and with it the charge. The book
      // says the rework never started (accounts untouched), the world
      // runs it anyway.
      .then(effectCrash(JEvalReduce(1)))
      .expect(and {
        orphans.length() == 1,
        memCore.tickets.get(1).phase == PEvaluating,
        memCore.tickets.get(1).gasLeft == 2,
        memCore.tickets.get(1).reworkLeft == 1,
        worldSpawns(1) == 2,
        journalSpawns(1) == 1,
        not(noDoubleSpentBudget),
        journalLegal,
        recoveryComplete,
        allDomainInvariants
      })
      // The recovered actor re-decides the rework: ONE journaled charge
      // (1 rework + 1 gas), THREE Jobs' worth of spend in the world.
      .then(journalStep(JEvalReduce(1)))
      .then(emitNext)
      .expect(and {
        obs.label == "rework-started eval_failure",
        memCore.tickets.get(1).gasLeft == 1,
        memCore.tickets.get(1).reworkLeft == 0,
        worldSpawns(1) == 3,
        journalSpawns(1) == 2,
        not(noDoubleSpentBudget),
        refinementCore,
        allDomainInvariants
      })
}
