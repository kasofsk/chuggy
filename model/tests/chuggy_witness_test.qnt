/// Deterministic reachability witnesses for the current released-ticket API.
/// Every driver names the machine's nondeterministic choice and references
/// the same exported guard/draw set used by the corresponding action.

module chuggy_witness_resume_test {
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2, N_TASKS=2, MAX_STAGES=2).* from "../domain"
  pure val p = [{ fanout: 1 }]
  action release(j: int, deps: Set[int]): bool = all {
    releasableIds.contains(j), deps.subseteq(dependableTickets), validPrograms.contains(p),
    apply(decideReleaseTicket(graph, j, deps, p, 1)) }
  action doDispatch(j: int): bool = all { readyTickets.contains(j), apply(decideDispatch(graph,j)) }
  action done(j: int, tid: int): bool = all {
    deliverableTaskIds(graph,j).contains(tid), apply(decideTaskDone(graph,j,tid,Pass)) }
  action reduceWork(j: int): bool = all { reducibleWork.contains(j), apply(decideWorkReduce(graph,j)) }
  action blocked(j: int): bool = all { taskPhaseTickets.contains(j),
    apply(decideExecutionBlocked(graph,j)) }
  action resume(j: int): bool = all { retryableEscalated.contains(j), apply(decideResumeTicket(graph,j)) }
  run executionBlockedResumeWitness = init
    .then(release(4, Set())).expect(and { tickets.get(4).phase == Pending, allInvariants })
    .then(doDispatch(4)).expect(and { tickets.get(4).phase == Work, allInvariants })
    .then(blocked(4)).expect(and {
      tickets.get(4).phase == Escalated,
      tickets.get(4).escalation == WorkExecutionUnavailableEscalated,
      lastStep.label == "ticket-escalated work_execution_unavailable_escalated",
      resumeOf(tickets.get(4).escalation) == ResumeWork, tickets.get(4).tasks.size() == 0,
      tickets.get(4).record.foldl(true, (ok,t) => ok and t.state == Resolved(Cancelled)), allInvariants })
    .then(resume(4)).expect(and { tickets.get(4).phase == Work,
      tickets.get(4).escalation == NoEscalation, allInvariants })

  /// An interrupted EVALUATION parks at its OWN wall and resumes into
  /// evaluation, not into work: the artifact is intact and the judgement is
  /// still to make, so the resume is a fresh fan-out of the LOWEST stage
  /// with new task ids.
  run evaluationResumeWitness = init
    .then(release(4, Set())).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(done(4, 1)).expect(allInvariants)
    .then(reduceWork(4)).expect(and {
      tickets.get(4).phase == Evaluation, tickets.get(4).tasks.map(t => t.id) == Set(2), allInvariants })
    .then(blocked(4)).expect(and {
      tickets.get(4).escalation == EvaluationBlockedEscalated,
      lastStep.label == "ticket-escalated evaluation_blocked_escalated",
      resumeOf(tickets.get(4).escalation) == ResumeEvaluation,
      tickets.get(4).record.length() == 2,
      tickets.get(4).record[0].id == 1, tickets.get(4).record[1].id == 2,
      allInvariants })
    .then(resume(4)).expect(and {
      tickets.get(4).phase == Evaluation,
      tickets.get(4).tasks.map(t => t.id) == Set(3),
      allInvariants })
}

/// THE TWO EDGES OF AN EVALUATION FAILURE, reached through the machine
/// rather than hand-built: the disposition is what picks between them, and
/// both end in Work — one straight away, one through the desk.
module chuggy_witness_rework_test {
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2, N_TASKS=1, MAX_STAGES=1).* from "../domain"
  pure val p = [{ fanout: 1 }]
  action release(j: int): bool = all {
    releasableIds.contains(j), validPrograms.contains(p),
    apply(decideReleaseTicket(graph, j, Set(), p, 1)) }
  action doDispatch(j: int): bool = all { readyTickets.contains(j), apply(decideDispatch(graph,j)) }
  action done(j: int, tid: int, v: Verdict): bool = all {
    deliverableTaskIds(graph,j).contains(tid), apply(decideTaskDone(graph,j,tid,v)) }
  action reduceWork(j: int): bool = all { reducibleWork.contains(j), apply(decideWorkReduce(graph,j)) }
  action reduceEval(j: int, d: EvaluationFailureDisposition): bool = all {
    reducibleEval.contains(j), dispositionChoices.contains(d),
    apply(decideEvalStageReduce(graph,j,d)) }
  action resume(j: int): bool = all { retryableEscalated.contains(j), apply(decideResumeTicket(graph,j)) }

  /// Rework: the failing stage re-enters Work directly, as a new cycle
  /// with a fresh work task, and the failed eval task stays retired.
  run evaluationReworkWitness = init
    .then(release(4)).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(done(4, 1, Pass)).then(reduceWork(4)).expect(and {
      tickets.get(4).phase == Evaluation, allInvariants })
    .then(done(4, 2, Fail)).then(reduceEval(4, ReworkEvaluationFailure)).expect(and {
      tickets.get(4).phase == Work,
      lastStep.label == "rework-started eval_failure",
      tickets.get(4).tasks.map(t => t.id) == Set(3),
      tickets.get(4).record.length() == 2, allInvariants })

  /// Escalate: the same failure parks the ticket instead, and the desk's
  /// resume re-enters Work — the same continuation, one human later.
  run evaluationEscalateWitness = init
    .then(release(4)).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(done(4, 1, Pass)).then(reduceWork(4)).expect(allInvariants)
    .then(done(4, 2, Fail)).then(reduceEval(4, EscalateEvaluationFailure)).expect(and {
      tickets.get(4).phase == Escalated,
      tickets.get(4).escalation == EvaluationFailureEscalated,
      resumeOf(tickets.get(4).escalation) == ResumeRework,
      retryableEscalated.contains(4), allInvariants })
    .then(resume(4)).expect(and {
      tickets.get(4).phase == Work,
      tickets.get(4).escalation == NoEscalation, allInvariants })
}

module chuggy_witness_stage_test {
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=1, N_TASKS=2, MAX_STAGES=2).* from "../domain"
  pure val p = [{ fanout: 1 }, { fanout: 1 }]
  action release: bool = apply(decideReleaseTicket(graph,2,Set(),p,1))
  action doDispatch: bool = all { readyTickets.contains(2), apply(decideDispatch(graph,2)) }
  action done(tid:int): bool = all { deliverableTaskIds(graph,2).contains(tid), apply(decideTaskDone(graph,2,tid,Pass)) }
  action wr: bool = all { reducibleWork.contains(2), apply(decideWorkReduce(graph,2)) }
  action er: bool = all { reducibleEval.contains(2), apply(decideEvalStageReduce(graph,2,ReworkEvaluationFailure)) }
  run stagedProgramWitness = init.then(release).then(doDispatch).then(done(1)).then(wr)
    .then(done(2)).then(er).expect(and { tickets.get(2).phase == Evaluation,
      lastStep.transitions == [{ticket:2, from:Evaluation, to:Evaluation}], allInvariants })
    .then(done(3)).then(er).expect(and { tickets.get(2).phase == Finalization, allInvariants })
}

/// Authored data is ticket-local and immutable: two tickets released into
/// one fleet keep the fan-out each was authored with.
module chuggy_witness_sparse_test {
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2, N_TASKS=2, MAX_STAGES=1).* from "../domain"
  pure val p = [{ fanout: 1 }]
  action release(j:int, wf:int): bool = all {
    releasableIds.contains(j), workFanoutChoices.contains(wf),
    apply(decideReleaseTicket(graph,j,Set(),p,wf)) }
  run ticketLocalPolicyWitness = init
    .then(release(1,1))
    .then(release(4,2))
    .expect(and { tickets.get(1).workFanout == 1, tickets.get(4).workFanout == 2,
      allInvariants })
}

module chuggy_witness_gate_test {
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2, N_TASKS=1, MAX_STAGES=1).* from "../domain"
  pure val p=[{fanout:1}]
  action release(j:int):bool=apply(decideReleaseTicket(graph,j,Set(),p,1))
  action doDispatch(j:int):bool=all{readyTickets.contains(j),apply(decideDispatch(graph,j))}
  action td(j:int,tid:int):bool=all{deliverableTaskIds(graph,j).contains(tid),apply(decideTaskDone(graph,j,tid,Pass))}
  action wr(j:int):bool=all{reducibleWork.contains(j),apply(decideWorkReduce(graph,j))}
  action er(j:int):bool=all{reducibleEval.contains(j),apply(decideEvalStageReduce(graph,j,ReworkEvaluationFailure))}
  action resolve(j:int,o:FinalizationOutcome):bool=all{tickets.get(j).phase==Finalization,apply(decideFinalizationResult(graph,j,o))}
  run finalizationSuccessWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,1)).then(wr(1)).then(td(1,2)).then(er(1))
    .expect(and{tickets.get(1).phase==Finalization,lastStep.effects==["RunFinalizer"],
      not(revocableTickets.contains(1)),allInvariants})
    .then(resolve(1,FinalizationSucceeded)).expect(and{tickets.get(1).phase==Done,allInvariants})

  /// A finalizer that reports failure sends the ticket back to work, every
  /// time: there is no wall on this edge.
  run safeAbortReworkWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,1)).then(wr(1)).then(td(1,2)).then(er(1))
    .then(resolve(1,FinalizationNeedsWork)).expect(and{tickets.get(1).phase==Work,
      lastStep.label=="rework-started finalization_needs_work",allInvariants})
    .then(td(1,3)).then(wr(1)).then(td(1,4)).then(er(1))
    .then(resolve(1,FinalizationNeedsWork)).expect(and{tickets.get(1).phase==Work,
      lastStep.label=="rework-started finalization_needs_work",allInvariants})

  /// A finalizer that reaches NO result parks the ticket, and the desk's
  /// resume runs the finalizer again — the only resume that re-runs the step
  /// it interrupted, and the only exit a held finalization has: Finalization
  /// is neither revocable nor retryable, so before this wall the ticket sat
  /// there until the environment moved.
  action resume(j:int):bool=all{retryableEscalated.contains(j),apply(decideResumeTicket(graph,j))}
  run finalizationUnavailableWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,1)).then(wr(1)).then(td(1,2)).then(er(1))
    .then(resolve(1,FinalizationResultUnavailable)).expect(and{tickets.get(1).phase==Escalated,
      lastStep.label=="ticket-escalated finalization_unavailable_escalated",
      tickets.get(1).escalation==FinalizationUnavailableEscalated,
      resumeOf(tickets.get(1).escalation)==ResumeFinalization,
      retryableEscalated.contains(1),allInvariants})
    .then(resume(1)).expect(and{tickets.get(1).phase==Finalization,
      lastStep.effects==["RunFinalizer"],tickets.get(1).escalation==NoEscalation,allInvariants})
    .then(resolve(1,FinalizationSucceeded)).expect(and{tickets.get(1).phase==Done,allInvariants})

  run revokeBoundaryWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,1)).then(wr(1)).then(td(1,2)).then(er(1))
    .expect(and{not(revocableTickets.contains(1)),allInvariants})
}

/// Former release candidate-wait slot: dependency admission requires an already-existing id.
module chuggy_witness_dependency_test {
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2,N_TASKS=1,MAX_STAGES=1).* from "../domain"
  pure val p=[{fanout:1}]
  run existingDependencyWitness=init
    .then(apply(decideReleaseTicket(graph,4,Set(),p,1)))
    .then(apply(decideReleaseTicket(graph,1,Set(4),p,1)))
    .expect(and{tickets.keys()==Set(1,4),tickets.get(1).deps==Set(4),isBlocked(1),allInvariants})
}
