/// Refinement tests for the journaled actor. These tests deliberately drive
/// DecisionEvent values: replay therefore exercises the same pure deciders as
/// the live actor, including the sparse native ticket id and materialized
/// ticket policy carried by CreateTicket.

/// THE RELEASED RECORD these suites drive with, at the scale the refinement
/// instance is bound to: one stage listing one evaluator, and a distinct
/// small positive reference per slot so a reader can see which one travelled.
/// Stated here rather than drawn from domain.qnt's release action, because
/// these suites drive the journal directly and the domain instance they
/// check is the refinement module's own.
module chuggy_refinement_fixture {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "../ticket"

  pure def defOf(slot: int): TaskDefinition = {
    workload: 4 * slot - 3, inputs: 4 * slot - 2,
    executionRequirements: 4 * slot - 1, resultContract: 4 * slot }
  pure val planFlat: List[StageDefinition] =
    [{ key: 1, evaluators: [{ key: 1, task: defOf(1) }] }]
  pure def released(id: int): ReleasedTicket = {
    id: id, content: 1, dependencies: Set(),
    workConfiguration: defOf(2), evaluationPlan: { stages: planFlat },
    finalizationConfiguration: 2 }

  /// One member of each of domain.qnt's two source draw sets. Which one an
  /// environment observes is no suite's subject; that they come from
  /// disjoint sets is what makes a dispatch's source tell itself from an
  /// acceptance's in a journal.
  pure val aDispatchSource: int = 1
  pure val anAcceptedSource: int = 3
}

module chuggy_refinement_unit_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "../ticket"
  import chuggy_refinement.* from "../refinement"
  import chuggy_refinement_fixture.*

  pure val release10: DecisionEvent = CreateTicket(released(2))
  pure val d1 = execDecisionEvent(genesis, release10)
  pure val e1: Entry = { seq: 1, event: release10, rec: d1.rec }
  pure val dispatch10: DecisionEvent =
    Dispatch({ ticket: 2, source: aDispatchSource })
  pure val d2 = execDecisionEvent(d1.post, dispatch10)
  pure val e2: Entry = { seq: 2, event: dispatch10, rec: d2.rec }
  pure val goodJ: List[Entry] = [e1, e2]

  /// A completion event at the obligation the graph says the ticket owes
  /// the task, with the disposition a passing report never consults.
  pure def workDone(c: TicketGraph, ticket: int,
      task: TaskIdentity): DecisionEvent =
    TaskDone({ ticket: ticket, task: task,
      report: WorkResultReport({
        result: producedResult(c.tickets.get(ticket), task),
        acceptedSourceRef: anAcceptedSource }),
      onFailure: ReworkEvaluationFailure })
  pure def wallDone(ticket: int, task: TaskIdentity): DecisionEvent =
    TaskDone({ ticket: ticket, task: task,
      report: TerminalFailureReport({ evidence: taskRefOf(task),
        kind: ExecutionUnavailableFailure }),
      onFailure: ReworkEvaluationFailure })

  run genesisReplayTest = assert(and {
    journalLegalOn([]), replayGraph([]) == genesis
  })

  run sparseReleaseReplayTest = assert(and {
    decisionEventEnabled(genesis, release10),
    journalLegalOn(goodJ),
    replayGraph(goodJ) == d2.post,
    replayGraph(goodJ).tickets.keys() == Set(2),
    replayGraph(goodJ).tickets.get(2).phase == Work,
    replayGraph(goodJ).tickets.get(2).tasks ==
      Set({ identity: workTaskOf(2, 1), state: Outstanding })
  })

  run replayAppendAgreesTest = assert(and {
    replayGraph(goodJ) == execDecisionEvent(replayGraph([e1]), dispatch10).post,
    replayGraph([e1]) == d1.post
  })

  run journalRefusesSeqAndRecordTamperingTest = assert(and {
    not(journalLegalOn([{ ...e1, seq: 2 }])),
    not(journalLegalOn([e1, { ...e2, seq: 3 }])),
    not(journalLegalOn([e1, { ...e2, seq: 1 }])),
    not(journalLegalOn([e1, { ...e2,
      rec: { ...e2.rec, label: "ticket-done" } }]))
  })

  run journalRefusesDisabledEventsTest = assert(and {
    not(decisionEventEnabled(genesis, dispatch10)),
    not(decisionEventEnabled(genesis, workDone(d2.post, 2, workTaskOf(2, 1)))),
    not(decisionEventEnabled(genesis, wallDone(2, workTaskOf(2, 1)))),
    not(decisionEventEnabled(genesis, FinalizationResult({ ticket: 2, out: FinalizationSucceeded }))),
    not(decisionEventEnabled(genesis, ResumeTicket(2)))
  })

  /// A REPORT IS REFUSED UNLESS IT FITS ITS TASK, and each way to be unfit
  /// is checked in the enablement and none is reachable from a fabric that
  /// plays by the rules: a reference at zero (the wire integers are
  /// positive, so zero is a hole where a result should be), a verdict
  /// carried by a WORK task, which judges nothing, and — the exact-
  /// obligation rule — a result whose obligation is not the one this
  /// ticket owes for the task, which is a result for a spawn it never made.
  /// That last refusal is the only place it can be shown: a refused report
  /// never reaches a golden trace.
  pure val owed2 = producedResult(d2.post.tickets.get(2), workTaskOf(2, 1))
  run reportAdmissibilityRequiredTest = assert(and {
    not(decisionEventEnabled(d2.post, TaskDone({ ticket: 2,
      task: workTaskOf(2, 1),
      report: WorkResultReport({ result: { ...owed2, resultRef: 0 },
        acceptedSourceRef: anAcceptedSource }),
      onFailure: ReworkEvaluationFailure }))),
    not(decisionEventEnabled(d2.post, TaskDone({ ticket: 2,
      task: workTaskOf(2, 1),
      report: EvaluationResultReport({ result: owed2, verdict: EvaluatorPass }),
      onFailure: ReworkEvaluationFailure }))),
    not(decisionEventEnabled(d2.post, TaskDone({ ticket: 2,
      task: workTaskOf(2, 1),
      report: TerminalFailureReport({ evidence: 0, kind: ProcessFailure }),
      onFailure: ReworkEvaluationFailure }))),
    not(decisionEventEnabled(d2.post, TaskDone({ ticket: 2,
      task: workTaskOf(2, 1),
      report: WorkResultReport({
        result: { ...owed2, obligation: { ...owed2.obligation,
          contextRef: owed2.obligation.contextRef + 1 } },
        acceptedSourceRef: anAcceptedSource }),
      onFailure: ReworkEvaluationFailure }))),
    decisionEventEnabled(d2.post, workDone(d2.post, 2, workTaskOf(2, 1)))
  })

  run journalRefusesInvalidReleasePayloadTest =
    val badDeps: DecisionEvent =
      CreateTicket({ ...released(2), dependencies: Set(99) })
    val badPlan: DecisionEvent =
      CreateTicket({ ...released(2), evaluationPlan: { stages: [] } })
    assert(and {
      not(decisionEventEnabled(genesis, badDeps)),
      not(decisionEventEnabled(genesis, badPlan))
    })

  run worldArithmeticTest = assert(and {
    journalSpawnsOn(goodJ, 2) == 1,
    worldSpawnsOn(goodJ, Set(), [], 2) == 0,
    worldSpawnsOn(goodJ, Set(1, 2), [], 2) == 1,
    worldSpawnsOn(goodJ, Set(1, 2), [d2.rec], 2) == 2,
    journalCompletionsOn(goodJ, 2) == 0
  })

  /// THE DECISION IS THE EVENT'S, NOT THE PAYLOAD'S — up to the payload the
  /// machine actually reads. Two completions differing only in their result
  /// reference are different events that replay to the same state, because
  /// the reference is carried and never compared. That is what lets the
  /// journal be the authority on what happened without the machine having
  /// to model what a result IS. The obligation and the accepted source on
  /// the same report are held equal here because those the machine does
  /// read — one to admit the report, one to pin on the ticket.
  run taskCompletionDecisionReplaysTest =
    val realEvent = workDone(d2.post, 2, workTaskOf(2, 1))
    val otherRef = TaskDone({ ticket: 2, task: workTaskOf(2, 1),
      report: WorkResultReport({ result: { ...owed2, resultRef: 99 },
        acceptedSourceRef: anAcceptedSource }),
      onFailure: ReworkEvaluationFailure })
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
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "../ticket"
  import chuggy_refinement.* from "../refinement"
  import chuggy_refinement_fixture.*

  pure def release(ticket: int): DecisionEvent = CreateTicket(released(ticket))
  pure val dispatch2: DecisionEvent =
    Dispatch({ ticket: 2, source: aDispatchSource })

  /// The produced reports, at the obligation the actor's memory says the
  /// ticket owes: a report carrying any other is one the enablement refuses.
  def workDone(ticket: int, task: TaskIdentity): DecisionEvent =
    TaskDone({ ticket: ticket, task: task,
      report: WorkResultReport({
        result: producedResult(memGraph.tickets.get(ticket), task),
        acceptedSourceRef: anAcceptedSource }),
      onFailure: ReworkEvaluationFailure })
  /// Every judgement below walks a PASSING stage, where the disposition is
  /// not consulted; it is named once here so the walks stay about recovery.
  def judged(ticket: int, task: TaskIdentity,
      v: EvaluationVerdict): DecisionEvent =
    TaskDone({ ticket: ticket, task: task,
      report: EvaluationResultReport({
        result: producedResult(memGraph.tickets.get(ticket), task),
        verdict: v }),
      onFailure: ReworkEvaluationFailure })
  pure def walled(ticket: int, task: TaskIdentity): DecisionEvent =
    TaskDone({ ticket: ticket, task: task,
      report: TerminalFailureReport({ evidence: taskRefOf(task),
        kind: ExecutionUnavailableFailure }),
      onFailure: ReworkEvaluationFailure })
  pure def evalTask(ticket: int, cycle: int, generation: int): TaskIdentity =
    evaluatorTaskIdentity(ticket, cycle, 1, generation, 1)

  action stepEmit(event: DecisionEvent, lbl: str): bool =
    journalStep(event)
      .expect(and { obs.label == lbl, allDomainInvariants, refinementInvariants })
      .then(emitNext)
      .expect(and { allDomainInvariants, refinementInvariants })

  /// A wall against WORK retires the cycle's task, survives recovery, and
  /// resumes by spawning a fresh one under the ticket's pinned policy.
  run executionBlockedResumeRecoversTest =
    rinit
      .then(stepEmit(release(2), "ticket-released"))
      .then(stepEmit(dispatch2, "dispatch"))
      .then(journalStep(walled(2, workTaskOf(2, 1))))
      .expect(and {
        memGraph.tickets.get(2).phase == Escalated,
        memGraph.tickets.get(2).escalation == WorkExecutionUnavailableEscalated,
        memGraph.tickets.get(2).tasks == Set(),
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(2))
      .expect(and {
        memGraph.tickets.get(2).phase == Escalated,
        worldSpawns(2) == 1,
        allDomainInvariants, refinementInvariants
      })
      .then(emitNext)
      .then(stepEmit(ResumeTicket(2), "ticket-resumed"))
      .expect(and {
        memGraph.tickets.get(2).phase == Work,
        memGraph.tickets.get(2).escalation == NoEscalation,
        journalSpawns(2) == 2,
        worldSpawns(2) == 2,
        allDomainInvariants, refinementInvariants
      })

  /// A WALL AGAINST AN EVALUATOR SURVIVES RECOVERY AS A PARTLY-ANSWERED
  /// STAGE, and its resume re-asks that evaluator at the next generation.
  /// The instance is the only place that state lives, so a recovery that
  /// replayed the events without rebuilding it would come back owing the
  /// wrong task — or none.
  run evaluationBlockedResumeRecoversTest =
    rinit
      .then(stepEmit(release(2), "ticket-released"))
      .then(stepEmit(dispatch2, "dispatch"))
      .then(stepEmit(workDone(2, workTaskOf(2, 1)), "task-done"))
      .then(stepEmit(WorkReduce(2), "work-passed"))
      .then(journalStep(walled(2, evalTask(2, 1, 1))))
      .expect(and {
        memGraph.tickets.get(2).escalation == EvaluationBlockedEscalated,
        instanceBlocked(currentInstance(memGraph.tickets.get(2))),
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(0))
      .expect(and {
        memGraph.tickets.get(2).escalation == EvaluationBlockedEscalated,
        memGraph.tickets.get(2).evaluations.length() == 1,
        instanceBlocked(currentInstance(memGraph.tickets.get(2))),
        allDomainInvariants, refinementInvariants
      })
      .then(5.reps(_ => emitNext))
      .then(stepEmit(ResumeTicket(2), "ticket-resumed"))
      .expect(and {
        memGraph.tickets.get(2).phase == Evaluation,
        liveTasks(memGraph.tickets.get(2)) == Set(evalTask(2, 1, 2)),
        allDomainInvariants, refinementInvariants
      })
      .then(stepEmit(judged(2, evalTask(2, 1, 2), EvaluatorPass), "eval-passed"))
      .expect(and {
        memGraph.tickets.get(2).phase == Finalization,
        allDomainInvariants, refinementInvariants
      })

  /// The finalization completion is one durable decision. A cursor reset
  /// re-emits effects by journal identity and cannot duplicate the
  /// completion.
  run finalizationCompletionCrashRecoveryTest =
    rinit
      .then(stepEmit(release(2), "ticket-released"))
      .then(stepEmit(dispatch2, "dispatch"))
      .then(stepEmit(workDone(2, workTaskOf(2, 1)), "task-done"))
      .then(stepEmit(WorkReduce(2), "work-passed"))
      .then(stepEmit(judged(2, evalTask(2, 1, 1), EvaluatorPass), "eval-passed"))
      .then(journalStep(FinalizationResult({ ticket: 2, out: FinalizationSucceeded })))
      .expect(and {
        memGraph.tickets.get(2).phase == Done,
        journalCompletions(2) == 1,
        worldCompletions(2) == 0,
        not(decisionEventEnabled(memGraph,
          FinalizationResult({ ticket: 2, out: FinalizationSucceeded }))),
        allDomainInvariants, refinementInvariants
      })
      .then(crashRecoverTo(0))
      .expect(and {
        memGraph.tickets.get(2).phase == Done,
        memGraph.tickets.get(2).completions == 1,
        worldCompletions(2) == 0,
        allDomainInvariants, refinementInvariants
      })
      .then(6.reps(_ => emitNext))
      .expect(and {
        worldCompletions(2) == 1,
        journalCompletions(2) == 1,
        allDomainInvariants, refinementInvariants
      })

  run finalizationFailureEntersReworkTest =
    rinit
      .then(stepEmit(release(2), "ticket-released"))
      .then(stepEmit(dispatch2, "dispatch"))
      .then(stepEmit(workDone(2, workTaskOf(2, 1)), "task-done"))
      .then(stepEmit(WorkReduce(2), "work-passed"))
      .then(stepEmit(judged(2, evalTask(2, 1, 1), EvaluatorPass), "eval-passed"))
      .then(stepEmit(FinalizationResult({ ticket: 2, out: FinalizationNeedsWork }),
        "rework-started finalization_needs_work"))
      .expect(and {
        memGraph.tickets.get(2).phase == Work,
        memGraph.tickets.get(2).tasks.size() == 1,
        memGraph.tickets.get(2).completions == 0,
        allDomainInvariants, refinementInvariants
      })
}

module chuggy_refinement_hazard_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "../ticket"
  import chuggy_refinement.* from "../refinement"
  import chuggy_refinement_fixture.*

  pure val release10: DecisionEvent = CreateTicket(released(2))
  pure val dispatch2: DecisionEvent =
    Dispatch({ ticket: 2, source: aDispatchSource })

  def workDone(ticket: int, task: TaskIdentity): DecisionEvent =
    TaskDone({ ticket: ticket, task: task,
      report: WorkResultReport({
        result: producedResult(memGraph.tickets.get(ticket), task),
        acceptedSourceRef: anAcceptedSource }),
      onFailure: ReworkEvaluationFailure })
  /// The hazard walks reach a judgement on a PASSING stage once and on a
  /// FAILING one once; the failing walk asks for rework, which is the
  /// disposition that spawns — and a spawn is what a double spend is made of.
  def judged(ticket: int, task: TaskIdentity,
      v: EvaluationVerdict): DecisionEvent =
    TaskDone({ ticket: ticket, task: task,
      report: EvaluationResultReport({
        result: producedResult(memGraph.tickets.get(ticket), task),
        verdict: v }),
      onFailure: ReworkEvaluationFailure })
  pure def evalTask(ticket: int, cycle: int): TaskIdentity =
    evaluatorTaskIdentity(ticket, cycle, 1, 1, 1)

  run dispatchEffectFirstDoubleSpendTest =
    rinit
      .then(journalStep(release10)).then(emitNext)
      .then(effectCrash(dispatch2))
      .expect(and {
        memGraph.tickets.get(2).phase == Pending,
        worldSpawns(2) == 1, journalSpawns(2) == 0,
        not(journalCoversWorld), not(noDoubleSpentWork),
        journalLegal, recoveryComplete, allDomainInvariants
      })
      .then(journalStep(dispatch2)).then(emitNext)
      .expect(and {
        worldSpawns(2) == 2, journalSpawns(2) == 1,
        not(noDoubleSpentWork), refinementCore, allDomainInvariants
      })

  /// Losing the finalization decision after its effect makes the recovered
  /// actor complete again. The domain history remains legal while the world
  /// observes two completions, pinning why completion must be
  /// journal-before-effect.
  run finalizationEffectFirstDuplicatesIrreversibleCompletionTest =
    rinit
      .then(journalStep(release10)).then(emitNext)
      .then(journalStep(dispatch2)).then(emitNext)
      .then(journalStep(workDone(2, workTaskOf(2, 1)))).then(emitNext)
      .then(journalStep(WorkReduce(2))).then(emitNext)
      .then(journalStep(judged(2, evalTask(2, 1), EvaluatorPass))).then(emitNext)
      .then(effectCrash(FinalizationResult({ ticket: 2, out: FinalizationSucceeded })))
      .expect(and {
        memGraph.tickets.get(2).phase == Finalization,
        worldCompletions(2) == 1, journalCompletions(2) == 0,
        journalLegal, recoveryComplete, allDomainInvariants
      })
      .then(journalStep(FinalizationResult({ ticket: 2, out: FinalizationSucceeded })))
      .then(emitNext)
      .expect(and {
        memGraph.tickets.get(2).phase == Done,
        worldCompletions(2) == 2, journalCompletions(2) == 1,
        not(noDuplicateCycle), refinementCore, allDomainInvariants
      })

  /// A FAILING JUDGEMENT IS NOW THE SPAWNING DECISION: the completion that
  /// concludes the stage is what re-enters Work, so the effect-first crash
  /// that double-spends a rework happens on a TaskDone. Losing it after the
  /// effect leaves the world holding a work task the journal never bought.
  run reworkEffectFirstDoubleSpendTest =
    rinit
      .then(journalStep(release10)).then(emitNext)
      .then(journalStep(dispatch2)).then(emitNext)
      .then(journalStep(workDone(2, workTaskOf(2, 1)))).then(emitNext)
      .then(journalStep(WorkReduce(2))).then(emitNext)
      .then(effectCrash(judged(2, evalTask(2, 1), EvaluatorFail)))
      .expect(and {
        memGraph.tickets.get(2).phase == Evaluation,
        worldSpawns(2) == 2, journalSpawns(2) == 1,
        not(noDoubleSpentWork), journalLegal, recoveryComplete,
        allDomainInvariants
      })
      .then(journalStep(judged(2, evalTask(2, 1), EvaluatorFail))).then(emitNext)
      .expect(and {
        worldSpawns(2) == 3, journalSpawns(2) == 2,
        not(noDoubleSpentWork), refinementCore, allDomainInvariants
      })
}
