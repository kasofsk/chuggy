/// Deterministic reachability witnesses for the current released-ticket API.
/// Every driver names the machine's nondeterministic choice and references
/// the same exported guard/draw set used by the corresponding action.

module chuggy_witness_free_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(N_TICKETS=2, N_TASKS=2, REWORK_POLICY=BudgetedRework(1), GAS=2,
    FINALIZATION_PRICING=DeadlineOnly, MAX_STAGES=2).* from "../domain"
  pure val p = [{ fanout: 1, combinator: UnanimousPass }]
  action release(j: int, deps: Set[int], rp: RetryPricing): bool = all {
    releasableIds.contains(j), deps.subseteq(dependableTickets), validPrograms.contains(p),
    apply(decideReleaseTicket(core, j, deps, p, 1, BudgetedRework(1), DeadlineOnly, rp, NoFinalizer)) }
  action doDispatch(j: int): bool = all { dispatchableIn(core,j), apply(decideDispatch(core,j)) }
  action done(j: int, tid: int): bool = all {
    deliverableTaskIds(core,j).contains(tid), apply(decideTaskDone(core,j,tid,Pass)) }
  action reduceWork(j: int): bool = all { reducibleWork.contains(j), apply(decideWorkReduce(core,j)) }
  action blocked(j: int, why: Reason): bool = all { taskPhaseTickets.contains(j),
    apply(decideExecutionBlocked(core,j,why)) }
  action resume(j: int): bool = all { retryableEscalated.contains(j), apply(decideResumeTicket(core,j)) }
  run executionBlockedResumeWitness = init
    .then(release(4, Set(), RetryFree)).expect(and { tickets.get(4).phase == Pending, allInvariants })
    .then(doDispatch(4)).expect(and { tickets.get(4).phase == Working, allInvariants })
    .then(blocked(4, TicketConfigIncompatible)).expect(and {
      tickets.get(4).phase == Escalated, tickets.get(4).reason == TicketConfigIncompatible,
      tickets.get(4).resumeAt == ResumeWorking, tickets.get(4).tasks.size() == 0,
      tickets.get(4).record.foldl(true, (ok,t) => ok and t.state == Resolved(Cancelled)), allInvariants })
    .then(resume(4)).expect(and { tickets.get(4).phase == Working,
      tickets.get(4).reason == NoReason, allInvariants })

  /// This is the required non-vacuity trace for the RetryFree exemption:
  /// an evaluation interruption resumes with a fresh lowest-stage task and
  /// genuinely climbs the measure while preserving every invariant.
  run retryFreeEvaluationClimbWitness = init
    .then(release(4, Set(), RetryFree)).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(done(4, 1)).expect(allInvariants)
    .then(reduceWork(4)).expect(and {
      tickets.get(4).phase == Evaluating, tickets.get(4).tasks.map(t => t.id) == Set(2), allInvariants })
    .then(blocked(4, TicketConfigIncompatible)).expect(and {
      tickets.get(4).resumeAt == ResumeEvaluating,
      tickets.get(4).record.length() == 2,
      tickets.get(4).record[0].id == 1, tickets.get(4).record[1].id == 2,
      allInvariants })
    .then(resume(4)).expect(and {
      tickets.get(4).phase == Evaluating,
      tickets.get(4).tasks.map(t => t.id) == Set(3),
      currentMeasure > prevMeasure,
      not(freeClimbNever), allInvariants })
}

module chuggy_witness_cascade_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(N_TICKETS=3, N_TASKS=1, REWORK_POLICY=BudgetedRework(1), GAS=3,
    FINALIZATION_PRICING=Budgeted(1), MAX_STAGES=1).* from "../domain"
  pure val p = [{ fanout: 1, combinator: UnanimousPass }]
  action release(j: int, deps: Set[int]): bool = all { releasableIds.contains(j),
    deps.subseteq(dependableTickets), apply(decideReleaseTicket(core,j,deps,p,1,
      BudgetedRework(1),Budgeted(1),RetryCharged,NoFinalizer)) }
  action doRevoke(j: int): bool = all { revocableTickets.contains(j), apply(decideRevoke(core,j)) }
  run sparseReverseCascadeWitness = init
    .then(release(5, Set())).expect(allInvariants)
    .then(release(2, Set(5))).expect(and { tickets.get(2).deps == Set(5), allInvariants })
    .then(release(6, Set(2))).expect(allInvariants)
    .then(doRevoke(5)).expect(and {
      lastStep.transitions == [
        { ticket: 5, from: Pending, to: Revoked },
        { ticket: 2, from: Pending, to: Escalated },
        { ticket: 6, from: Pending, to: Escalated }],
      tickets.get(2).reason == DependencyRevoked,
      tickets.get(6).reason == DependencyRevoked, allInvariants })
}

module chuggy_witness_stage_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(N_TICKETS=1, N_TASKS=2, REWORK_POLICY=BudgetedRework(1), GAS=3,
    FINALIZATION_PRICING=Budgeted(1), MAX_STAGES=2).* from "../domain"
  pure val p = [{ fanout: 1, combinator: UnanimousPass }, { fanout: 1, combinator: AnyPass }]
  action release: bool = apply(decideReleaseTicket(core,2,Set(),p,1,BudgetedRework(1),Budgeted(1),RetryCharged,NoFinalizer))
  action doDispatch: bool = all { dispatchableIn(core,2), apply(decideDispatch(core,2)) }
  action done(tid:int): bool = all { deliverableTaskIds(core,2).contains(tid), apply(decideTaskDone(core,2,tid,Pass)) }
  action wr: bool = all { reducibleWork.contains(2), apply(decideWorkReduce(core,2)) }
  action er: bool = all { reducibleEval.contains(2), apply(decideEvalStageReduce(core,2)) }
  run stagedProgramWitness = init.then(release).then(doDispatch).then(done(1)).then(wr)
    .then(done(2)).then(er).expect(and { tickets.get(2).phase == Evaluating,
      lastStep.transitions == [{ticket:2, from:Evaluating, to:Evaluating}], allInvariants })
    .then(done(3)).then(er).expect(and { tickets.get(2).phase == Done, allInvariants })
}

/// Former multiproject slot: now proves policy is immutable ticket-local data.
module chuggy_witness_sparse_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(N_TICKETS=2, N_TASKS=2, REWORK_POLICY=BudgetedRework(9), GAS=3,
    FINALIZATION_PRICING=DeadlineOnly, MAX_STAGES=1).* from "../domain"
  pure val p = [{ fanout: 1, combinator: UnanimousPass }]
  action release(j:int, wf:int, rw:ReworkPolicy, wp:FinalizationPricing, rp:RetryPricing): bool = all {
    releasableIds.contains(j), apply(decideReleaseTicket(core,j,Set(),p,wf,rw,wp,rp,ManagedFinalizer)) }
  run ticketLocalPolicyWitness = init
    .then(release(1,1,BudgetedRework(1),Budgeted(2),RetryCharged))
    .then(release(4,2,BudgetedRework(3),DeadlineOnly,RetryFree))
    .expect(and { tickets.get(1).workFanout == 1, tickets.get(4).workFanout == 2,
      tickets.get(1).reworkLeft == 1, tickets.get(4).reworkLeft == 3,
      tickets.get(1).finalizationLeft == 2, tickets.get(4).finalizationLeft == 0,
      tickets.get(1).resumePricing == RetryCharged,
      tickets.get(4).resumePricing == RetryFree, allInvariants })
}

module chuggy_witness_gate_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(N_TICKETS=2, N_TASKS=1, REWORK_POLICY=BudgetedRework(1), GAS=3,
    FINALIZATION_PRICING=Budgeted(1), MAX_STAGES=1).* from "../domain"
  pure val p=[{fanout:1,combinator:UnanimousPass}]
  action release(j:int):bool=apply(decideReleaseTicket(core,j,Set(),p,1,BudgetedRework(1),Budgeted(1),RetryCharged,ManagedFinalizer))
  action doDispatch(j:int):bool=all{dispatchableIn(core,j),apply(decideDispatch(core,j))}
  action td(j:int,tid:int):bool=all{deliverableTaskIds(core,j).contains(tid),apply(decideTaskDone(core,j,tid,Pass))}
  action wr(j:int):bool=all{reducibleWork.contains(j),apply(decideWorkReduce(core,j))}
  action er(j:int):bool=all{reducibleEval.contains(j),apply(decideEvalStageReduce(core,j))}
  action resolve(j:int,o:FinalizationOutcome):bool=all{tickets.get(j).phase==Finalizing,apply(decideFinalizationResult(core,j,o))}
  action doRevoke(j:int):bool=all{revocableTickets.contains(j),apply(decideRevoke(core,j))}
  run finalizationSuccessWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,1)).then(wr(1)).then(td(1,2)).then(er(1))
    .expect(and{tickets.get(1).phase==Finalizing,lastStep.effects==["RunFinalizer"],
      not(revocableTickets.contains(1)),allInvariants})
    .then(resolve(1,FinalizationSucceeded)).expect(and{tickets.get(1).phase==Done,allInvariants})

  run safeAbortReworkWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,1)).then(wr(1)).then(td(1,2)).then(er(1))
    .then(resolve(1,FinalizationFailed)).expect(and{tickets.get(1).phase==Working,
      lastStep.label=="rework-started finalization_failed",allInvariants})

  run revokeBoundaryWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,1)).then(wr(1)).then(td(1,2)).then(er(1))
    .expect(and{not(revocableTickets.contains(1)),allInvariants})
}

module chuggy_witness_gate_deadline_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(N_TICKETS=1,N_TASKS=1,REWORK_POLICY=BudgetedRework(1),GAS=2,
    FINALIZATION_PRICING=DeadlineOnly, MAX_STAGES=1).* from "../domain"
  pure val p=[{fanout:1,combinator:UnanimousPass}]
  action release=apply(decideReleaseTicket(core,1,Set(),p,1,BudgetedRework(1),DeadlineOnly,RetryCharged,ManagedFinalizer))
  action doDispatch:bool=all{dispatchableIn(core,1),apply(decideDispatch(core,1))}
  action td(tid:int):bool=apply(decideTaskDone(core,1,tid,Pass))
  action wr:bool=apply(decideWorkReduce(core,1))
  action er:bool=apply(decideEvalStageReduce(core,1))
  action finalizationFails:bool=apply(decideFinalizationResult(core,1,FinalizationFailed))
  run finalizationFailureWitness=init.then(release).then(doDispatch).then(td(1)).then(wr).then(td(2)).then(er)
    .then(finalizationFails).expect(and{lastStep.label=="rework-started finalization_failed",
      tickets.get(1).phase==Working,tickets.get(1).gasLeft==0,allInvariants})
}

/// Former release candidate-wait slot: dependency admission requires an already-existing id.
module chuggy_witness_dependency_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(N_TICKETS=2,N_TASKS=1,REWORK_POLICY=BudgetedRework(1),GAS=2,
    FINALIZATION_PRICING=DeadlineOnly, MAX_STAGES=1).* from "../domain"
  pure val p=[{fanout:1,combinator:UnanimousPass}]
  run existingDependencyWitness=init
    .then(apply(decideReleaseTicket(core,4,Set(),p,1,BudgetedRework(1),DeadlineOnly,RetryCharged,NoFinalizer)))
    .then(apply(decideReleaseTicket(core,1,Set(4),p,1,BudgetedRework(1),DeadlineOnly,RetryCharged,NoFinalizer)))
    .expect(and{tickets.keys()==Set(1,4),tickets.get(1).deps==Set(4),isBlocked(1),allInvariants})
}

module chuggy_witness_wrapup_none_test {
  import chuggy_measure.* from "../measure"
  import chuggy_domain(N_TICKETS=1,N_TASKS=1,REWORK_POLICY=BudgetedRework(1),GAS=2,
    FINALIZATION_PRICING=DeadlineOnly, MAX_STAGES=1).* from "../domain"
  pure val p=[{fanout:1,combinator:UnanimousPass}]
  run noFinalizerWitness=init
    .then(apply(decideReleaseTicket(core,2,Set(),p,1,BudgetedRework(1),DeadlineOnly,RetryCharged,NoFinalizer)))
    .then(apply(decideDispatch(core,2))).then(apply(decideTaskDone(core,2,1,Pass)))
    .then(apply(decideWorkReduce(core,2))).then(apply(decideTaskDone(core,2,2,Pass)))
    .then(apply(decideEvalStageReduce(core,2))).expect(and{tickets.get(2).phase==Done,
      allInvariants})
}
