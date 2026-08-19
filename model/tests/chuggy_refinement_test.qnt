/// Refinement tests for the journaled actor. These tests deliberately drive
/// DecisionEvent values: replay therefore exercises the same pure deciders as
/// the live actor, including the sparse native ticket id and materialized
/// ticket policy carried by ReleaseTicket.

module chuggy_refinement_unit_test {
  import chuggy_measure.* from "../measure"
  import chuggy_refinement.* from "../refinement"

  pure val progFlat: List[Stage] = [{ fanout: 1, combinator: UnanimousPass }]
  pure val release10: DecisionEvent = ReleaseTicket({
    ticket: 2, deps: Set(), prog: progFlat, workFanout: 1,
    reworkPolicy: BudgetedRework(1), finalizationPricing: Budgeted(1),
    resumePricing: RetryCharged, finalizer: ManagedFinalizer
  })
  pure val d1 = execDecisionEvent(genesis, release10)
  pure val e1: Entry = { seq: 1, event: release10, rec: d1.rec }
  pure val dispatch10: DecisionEvent = Dispatch(2)
  pure val d2 = execDecisionEvent(d1.post, dispatch10)
  pure val e2: Entry = { seq: 2, event: dispatch10, rec: d2.rec }
  pure val goodJ: List[Entry] = [e1, e2]

  run genesisReplayTest = assert(and {
    journalLegalOn([]), replayCore([]) == genesis
  })

  run sparseReleaseReplayTest = assert(and {
    decisionEventEnabled(genesis, release10),
    journalLegalOn(goodJ),
    replayCore(goodJ) == d2.post,
    replayCore(goodJ).tickets.keys() == Set(2),
    replayCore(goodJ).tickets.get(2).phase == Working,
    replayCore(goodJ).tickets.get(2).gasLeft == 2
  })

  run replayAppendAgreesTest = assert(and {
    replayCore(goodJ) == execDecisionEvent(replayCore([e1]), dispatch10).post,
    replayCore([e1]) == d1.post
  })

  run journalRefusesSeqAndRecordTamperingTest = assert(and {
    not(journalLegalOn([{ ...e1, seq: 2 }])),
    not(journalLegalOn([e1, { ...e2, seq: 3 }])),
    not(journalLegalOn([e1, { ...e2, seq: 1 }])),
    not(journalLegalOn([e1, { ...e2,
      rec: { ...e2.rec, label: "ticket-done" } }]))
  })

  run journalRefusesDisabledEventsTest = assert(and {
    not(decisionEventEnabled(genesis, Dispatch(2))),
    not(decisionEventEnabled(genesis, TaskDone({ ticket: 2, tid: 1, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }))),
    not(decisionEventEnabled(genesis, ExecutionBlocked({
      ticket: 2, reason: TicketConfigIncompatible }))),
    not(decisionEventEnabled(genesis, FinalizationResult({ ticket: 2, out: FinalizationSucceeded }))),
    not(decisionEventEnabled(genesis, ResumeTicket(2)))
  })

  run taskResultReferenceRequiredTest = assert(not(decisionEventEnabled(d2.post,
    TaskDone({ ticket: 2, tid: 1, verdict: Pass,
      result: { manifest: 0, digest: 1, schema: 1 } }))))

  run journalRefusesInvalidReleasePayloadTest =
    val badDeps: DecisionEvent = ReleaseTicket({
      ticket: 2, deps: Set(99), prog: progFlat, workFanout: 1,
      reworkPolicy: BudgetedRework(1), finalizationPricing: Budgeted(1),
      resumePricing: RetryCharged, finalizer: ManagedFinalizer
    })
    val badProgram: DecisionEvent = ReleaseTicket({
      ticket: 2, deps: Set(), prog: [], workFanout: 1,
      reworkPolicy: BudgetedRework(1), finalizationPricing: Budgeted(1),
      resumePricing: RetryCharged, finalizer: ManagedFinalizer
    })
    assert(and {
      not(decisionEventEnabled(genesis, badDeps)),
      not(decisionEventEnabled(genesis, badProgram))
    })

  run worldArithmeticTest = assert(and {
    journalSpawnsOn(goodJ, 2) == 1,
    worldSpawnsOn(goodJ, Set(), [], 2) == 0,
    worldSpawnsOn(goodJ, Set(1, 2), [], 2) == 1,
    worldSpawnsOn(goodJ, Set(1, 2), [d2.rec], 2) == 2,
    journalCompletionsOn(goodJ, 2) == 0
  })

  run taskCompletionDecisionReplaysTest =
    val realEvent = TaskDone({ ticket: 2, tid: 1, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } })
    val otherRef = TaskDone({ ticket: 2, tid: 1, verdict: Pass,
      result: { manifest: 2, digest: 2, schema: 1 } })
    val real = execDecisionEvent(d2.post, realEvent)
    assert(and {
      decisionEventEnabled(d2.post, realEvent),
      realEvent != otherRef,
      execDecisionEvent(d2.post, realEvent) == execDecisionEvent(d2.post, otherRef),
      real.rec.label == "task-done",
      real.post.tickets.get(2).tasks.forall(t => t.state == Resolved(Passed))
    })
}

module chuggy_refinement_witness_test {
  import chuggy_measure.* from "../measure"
  import chuggy_refinement.* from "../refinement"

  pure val progFlat: List[Stage] = [{ fanout: 1, combinator: UnanimousPass }]
  pure def release(ticket: int, finalizer: Finalizer): DecisionEvent = ReleaseTicket({
    ticket: ticket, deps: Set(), prog: progFlat, workFanout: 1,
    reworkPolicy: BudgetedRework(1), finalizationPricing: Budgeted(1),
    resumePricing: RetryCharged, finalizer: finalizer
  })

  action stepEmit(event: DecisionEvent, lbl: str): bool =
    journalStep(event)
      .expect(and { obs.label == lbl, allDomainInvariants, refinementInvariants })
      .then(emitNext)
      .expect(and { allDomainInvariants, refinementInvariants })

  /// A blocked execution retires its outstanding work, survives recovery,
  /// and resumes by spawning a fresh task under the ticket's pinned policy.
  run executionBlockedResumeRecoversTest =
    rinit
      .then(stepEmit(release(2, ManagedFinalizer), "ticket-released"))
      .then(stepEmit(Dispatch(2), "dispatch"))
      .then(journalStep(ExecutionBlocked({
        ticket: 2, reason: TicketConfigIncompatible })))
      .expect(and {
        memCore.tickets.get(2).phase == Escalated,
        memCore.tickets.get(2).reason == TicketConfigIncompatible,
        memCore.tickets.get(2).tasks.forall(t => t.state != Outstanding),
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(2))
      .expect(and {
        memCore.tickets.get(2).phase == Escalated,
        worldSpawns(2) == 1,
        allDomainInvariants, refinementInvariants
      })
      .then(emitNext)
      .then(stepEmit(ResumeTicket(2), "ticket-resumed"))
      .expect(and {
        memCore.tickets.get(2).phase == Working,
        memCore.tickets.get(2).reason == NoReason,
        journalSpawns(2) == 2,
        worldSpawns(2) == 2,
        allDomainInvariants, refinementInvariants
      })

  /// Preparation, approval, and commit are separately durable. A cursor
  /// reset re-emits their effects by journal identity and cannot duplicate
  /// the irreversible completion.
  run approvalCommitCrashRecoveryTest =
    rinit
      .then(stepEmit(release(2, ManagedFinalizer), "ticket-released"))
      .then(stepEmit(Dispatch(2), "dispatch"))
      .then(stepEmit(TaskDone({ ticket: 2, tid: 1, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }), "task-done"))
      .then(stepEmit(WorkReduce(2), "work-passed"))
      .then(stepEmit(TaskDone({ ticket: 2, tid: 2, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }), "task-done"))
      .then(stepEmit(EvalReduce(2), "eval-passed"))
      .then(stepEmit(FinalizationResult({ ticket: 2, out: FinalizationSucceeded }), "wrapup-preparation-started"))
      .then(stepEmit(FinalizationResult({ ticket: 2, out: FinalizationSucceeded }),
        "wrapup-awaiting-approval"))
      .then(stepEmit(FinalizationResult({ ticket: 2, out: FinalizationSucceeded }),
        "wrapup-commit-permitted"))
      .then(journalStep(FinalizationResult({ ticket: 2, out: FinalizationSucceeded })))
      .expect(and {
        memCore.tickets.get(2).phase == Done,
        journalCompletions(2) == 1,
        worldCompletions(2) == 0,
        not(decisionEventEnabled(memCore,
          FinalizationResult({ ticket: 2, out: FinalizationSucceeded }))),
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(0))
      .expect(and {
        memCore.tickets.get(2).phase == Done,
        memCore.tickets.get(2).completions == 1,
        worldCompletions(2) == 0,
        allDomainInvariants, refinementInvariants
      })
      .then(10.reps(_ => emitNext))
      .expect(and {
        worldCompletions(2) == 1,
        journalCompletions(2) == 1,
        allDomainInvariants, refinementInvariants
      })

  run preparationFailureRemainsReplayableTest =
    rinit
      .then(stepEmit(release(2, ManagedFinalizer), "ticket-released"))
      .then(stepEmit(Dispatch(2), "dispatch"))
      .then(stepEmit(TaskDone({ ticket: 2, tid: 1, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }), "task-done"))
      .then(stepEmit(WorkReduce(2), "work-passed"))
      .then(stepEmit(TaskDone({ ticket: 2, tid: 2, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }), "task-done"))
      .then(stepEmit(EvalReduce(2), "eval-passed"))
      .then(stepEmit(FinalizationResult({ ticket: 2, out: FinalizationSucceeded }), "wrapup-preparation-started"))
      .then(stepEmit(FinalizationResult({ ticket: 2, out: FinalizationFailed }),
        "rework-started wrapup_preparation_failure"))
      .expect(and {
        memCore.tickets.get(2).phase == Working,
        memCore.tickets.get(2).finalizationLeft == 0,
        allDomainInvariants, refinementInvariants
      })

  run conclusiveAbortReturnsToWorkTest =
    rinit
      .then(stepEmit(release(2, ManagedFinalizer), "ticket-released"))
      .then(stepEmit(Dispatch(2), "dispatch"))
      .then(stepEmit(TaskDone({ ticket: 2, tid: 1, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }), "task-done"))
      .then(stepEmit(WorkReduce(2), "work-passed"))
      .then(stepEmit(TaskDone({ ticket: 2, tid: 2, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }), "task-done"))
      .then(stepEmit(EvalReduce(2), "eval-passed"))
      .then(stepEmit(FinalizationResult({ ticket: 2, out: FinalizationSucceeded }), "wrapup-preparation-started"))
      .then(stepEmit(FinalizationResult({ ticket: 2, out: FinalizationSucceeded }),
        "wrapup-commit-permitted"))
      .then(stepEmit(FinalizationResult({ ticket: 2, out: FinalizationFailed }),
        "rework-started wrapup_aborted"))
      .expect(and {
        memCore.tickets.get(2).phase == Working,
        memCore.tickets.get(2).completions == 0,
        allDomainInvariants, refinementInvariants
      })

  run noFinalizerCompletionRecoversTest =
    rinit
      .then(stepEmit(release(4, NoFinalizer), "ticket-released"))
      .then(stepEmit(Dispatch(4), "dispatch"))
      .then(stepEmit(TaskDone({ ticket: 4, tid: 1, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }), "task-done"))
      .then(stepEmit(WorkReduce(4), "work-passed"))
      .then(stepEmit(TaskDone({ ticket: 4, tid: 2, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }), "task-done"))
      .then(journalStep(EvalReduce(4)))
      .expect(and {
        obs.label == "ticket-done",
        memCore.tickets.get(4).phase == Done,
        journalCompletions(4) == 1,
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(0))
      .expect(and {
        memCore.tickets.get(4).phase == Done,
        memCore.tickets.get(4).finalizer == NoFinalizer,
        allDomainInvariants, refinementInvariants
      })
}

module chuggy_refinement_hazard_test {
  import chuggy_measure.* from "../measure"
  import chuggy_refinement.* from "../refinement"

  pure val progFlat: List[Stage] = [{ fanout: 1, combinator: UnanimousPass }]
  pure val release10: DecisionEvent = ReleaseTicket({
    ticket: 2, deps: Set(), prog: progFlat, workFanout: 1,
    reworkPolicy: BudgetedRework(1), finalizationPricing: Budgeted(1),
    resumePricing: RetryCharged, finalizer: ManagedFinalizer
  })

  run dispatchEffectFirstDoubleSpendTest =
    rinit
      .then(journalStep(release10)).then(emitNext)
      .then(effectCrash(Dispatch(2)))
      .expect(and {
        memCore.tickets.get(2).phase == Pending,
        worldSpawns(2) == 1, journalSpawns(2) == 0,
        not(journalCoversWorld), not(noDoubleSpentBudget),
        journalLegal, recoveryComplete, allDomainInvariants
      })
      .then(journalStep(Dispatch(2))).then(emitNext)
      .expect(and {
        worldSpawns(2) == 2, journalSpawns(2) == 1,
        not(noDoubleSpentBudget), refinementCore, allDomainInvariants
      })

  /// Losing the commit decision after its effect makes the recovered actor
  /// commit again. The domain history remains legal while the world observes
  /// two completions, pinning why commit must be journal-before-effect.
  run commitEffectFirstDuplicatesIrreversibleCompletionTest =
    rinit
      .then(journalStep(release10)).then(emitNext)
      .then(journalStep(Dispatch(2))).then(emitNext)
      .then(journalStep(TaskDone({ ticket: 2, tid: 1, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }))).then(emitNext)
      .then(journalStep(WorkReduce(2))).then(emitNext)
      .then(journalStep(TaskDone({ ticket: 2, tid: 2, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }))).then(emitNext)
      .then(journalStep(EvalReduce(2))).then(emitNext)
      .then(journalStep(FinalizationResult({ ticket: 2, out: FinalizationSucceeded }))).then(emitNext)
      .then(journalStep(FinalizationResult({ ticket: 2, out: FinalizationSucceeded }))).then(emitNext)
      .then(effectCrash(FinalizationResult({ ticket: 2, out: FinalizationSucceeded })))
      .expect(and {
        memCore.tickets.get(2).phase == Finalizing,
        worldCompletions(2) == 1, journalCompletions(2) == 0,
        journalLegal, recoveryComplete, allDomainInvariants
      })
      .then(journalStep(FinalizationResult({ ticket: 2, out: FinalizationSucceeded })))
      .then(emitNext)
      .expect(and {
        memCore.tickets.get(2).phase == Done,
        worldCompletions(2) == 2, journalCompletions(2) == 1,
        not(noDuplicateCycle), refinementCore, allDomainInvariants
      })

  run reworkEffectFirstDoubleSpendTest =
    rinit
      .then(journalStep(release10)).then(emitNext)
      .then(journalStep(Dispatch(2))).then(emitNext)
      .then(journalStep(TaskDone({ ticket: 2, tid: 1, verdict: Pass, result: { manifest: 1, digest: 1, schema: 1 } }))).then(emitNext)
      .then(journalStep(WorkReduce(2))).then(emitNext)
      .then(journalStep(TaskDone({ ticket: 2, tid: 2, verdict: Fail, result: { manifest: 1, digest: 1, schema: 1 } }))).then(emitNext)
      .then(effectCrash(EvalReduce(2)))
      .expect(and {
        memCore.tickets.get(2).phase == Evaluating,
        worldSpawns(2) == 2, journalSpawns(2) == 1,
        not(noDoubleSpentBudget), journalLegal, recoveryComplete,
        allDomainInvariants
      })
      .then(journalStep(EvalReduce(2))).then(emitNext)
      .expect(and {
        worldSpawns(2) == 3, journalSpawns(2) == 2,
        not(noDoubleSpentBudget), refinementCore, allDomainInvariants
      })
}
