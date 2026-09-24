/// Deterministic reachability witnesses for the current released-ticket API.
/// Every driver names the machine's nondeterministic choice and references
/// the same exported guard/draw set used by the corresponding action.

/// WHAT THE WITNESSES READ OFF A TICKET'S STATE, by name: the state's own
/// constructor, the wall a parked ticket names, and the instance it holds
/// open.
module chuggy_witness_fixture {
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"

  pure def stateName(jb: Ticket): str = match jb.state {
    | Pending => "Pending"
    | Work(_) => "Work"
    | Evaluation(_) => "Evaluation"
    | Finalization(_) => "Finalization"
    | Escalated(_) => "Escalated"
    | Done => "Done"
    | Revoked => "Revoked"
  }
  /// "" for a ticket that is not parked.
  pure def wallName(jb: Ticket): str = match jb.state {
    | Escalated(escalation) => match escalation {
        | WorkFailureEscalated(_) => "WorkFailureEscalated"
        | WorkExecutionUnavailableEscalated(_) =>
          "WorkExecutionUnavailableEscalated"
        | EvaluationFailureEscalated(_) => "EvaluationFailureEscalated"
        | EvaluationBlockedEscalated(_) => "EvaluationBlockedEscalated"
        | FinalizationUnavailableEscalated(_) =>
          "FinalizationUnavailableEscalated"
      }
    | _ => ""
  }
  /// Read only where the state holds one (ticket.qnt heldInstances).
  pure def openInstance(jb: Ticket): EvaluationInstance =
    heldInstances(jb.state)[0]
}

module chuggy_witness_resume_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_witness_fixture.*
  import chuggy_domain(N_TICKETS=2, N_TASKS=2, MAX_STAGES=2).* from "../domain"
  /// ONE stage listing evaluator 2 ALONE. A roster is a set of authored
  /// keys rather than a width, so the spawn, the retirement and the
  /// generation count all have to read the key the stage names instead of
  /// counting from one — which this witness's second run is what exercises.
  pure val p = [{ key: 1, evaluators: [evaluatorOf(2)] }]
  /// And the same stage with BOTH evaluators, for the partial resume: one
  /// judges, the other is stopped, and only the stopped one comes back.
  pure val pWide = [{ key: 1, evaluators: [evaluatorOf(1), evaluatorOf(2)] }]

  /// A PRODUCED REPORT, at the obligation the ticket owes the task right
  /// now: the state is what says which obligation that is, so the builder
  /// reads it rather than take it.
  def judged(j: int, task: TaskIdentity, v: EvaluationVerdict): TaskTerminalReport =
    EvaluationResultReport({ ticket: j,
      result: producedResult(tickets.get(j), task), verdict: v })
  pure def walled(task: TaskIdentity): TaskTerminalReport =
    TerminalFailureReport({ ticket: taskOwner(task),
      failure: { task: task, evidence: taskRefOf(task) },
      kind: ExecutionUnavailableFailure })
  pure def statusOf(jb: Ticket, evaluator: int): EvaluatorStatus =
    match openInstance(jb).state {
      | Running(progress) => progress.stage.evaluators.get(evaluator)
      | EvaluationBlocked(progress) => progress.stage.evaluators.get(evaluator)
      | EvaluationPassed(stages) =>
        stages[stages.length() - 1].evaluators.get(evaluator)
      | EvaluationFailed(stages) =>
        stages[stages.length() - 1].evaluators.get(evaluator)
    }

  action release(j: int, dependencies: Set[int], stages: List[StageDefinition]): bool = all {
    releasableIds.contains(j), dependencies.subseteq(dependableTickets),
    validPlans.contains(stages),
    take(CreateTicket(releasedTicketOf(j, dependencies, stages)),
      unaskedDisposition) }
  action doDispatch(j: int): bool =
    nondet source = dispatchSources.oneOf()
    all { readyTickets.contains(j),
      take(DispatchTicket({ ticket: j, source: source }), unaskedDisposition) }
  action done(j: int, task: TaskIdentity, report: TaskTerminalReport): bool = all {
    completableTickets.contains(j), liveTasks(tickets.get(j)).contains(task),
    reportChoices(tickets.get(j), task).contains(report),
    take(ReportTaskTerminal(report), ReworkEvaluationFailure) }
  /// A WORK COMPLETION: the source the application accepted the result at
  /// is the environment's, so the driver draws it where the machine does.
  action doneProduced(j: int, task: TaskIdentity): bool =
    nondet accepted = acceptedSources.oneOf()
    done(j, task, WorkResultReport({ ticket: j,
      result: producedResult(tickets.get(j), task), acceptedSourceRef: accepted }))
  action resume(j: int): bool = all { retryableEscalated.contains(j),
    take(ResumeTicket(j), unaskedDisposition) }

  /// A WORK TASK'S WALL parks the ticket in the completion itself: a work
  /// cycle is one task, so nothing is left to wait for. Its resume buys a
  /// new cycle.
  run executionBlockedResumeWitness = init
    .then(release(4, Set(), p)).expect(and { isPending(tickets.get(4).state), allInvariants })
    .then(doDispatch(4)).expect(and { stateName(tickets.get(4)) == "Work", allInvariants })
    .then(done(4, workTaskIdentity(4, 1), walled(workTaskIdentity(4, 1)))).expect(and {
      wallName(tickets.get(4)) == "WorkExecutionUnavailableEscalated",
      lastEvent == "TicketWorkExecutionUnavailable",
      resumeOf(tickets.get(4).state) == ResumeWork,
      liveTasks(tickets.get(4)) == Set(),
      // no judgement was reached, so there is no instance to keep
      ledgerInstances(tickets.get(4), ledgers.get(4)) == [], allInvariants })
    .then(resume(4)).expect(and { stateName(tickets.get(4)) == "Work",
      lastEvent == "TicketWorkResumed",
      liveTasks(tickets.get(4)) == Set(workTaskIdentity(4, 2)),
      allInvariants })

  /// An interrupted EVALUATION parks at its OWN wall and resumes into
  /// evaluation, not into work: the artifact is intact and the judgement is
  /// still to make, so the resume re-asks the stopped evaluators of the
  /// SAME stage at the NEXT generation.
  run evaluationResumeWitness = init
    .then(release(4, Set(), p)).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(doneProduced(4, workTaskIdentity(4, 1))).expect(and {
      stateName(tickets.get(4)) == "Evaluation",
      lastEvent == "TicketWorkResultAccepted",
      liveTasks(tickets.get(4)) == Set(evaluatorTaskIdentity(4, 1, 1, 1, 2)),
      allInvariants })
    .then(done(4, evaluatorTaskIdentity(4, 1, 1, 1, 2),
        walled(evaluatorTaskIdentity(4, 1, 1, 1, 2)))).expect(and {
      wallName(tickets.get(4)) == "EvaluationBlockedEscalated",
      lastEvent == "TicketEvaluationBlocked",
      resumeOf(tickets.get(4).state) == ResumeEvaluation,
      // the wall holds the instance the resume re-asks from, still open
      ledgers.get(4).closedEvaluations == [],
      ledgerInstances(tickets.get(4), ledgers.get(4)).length() == 1,
      openInstance(tickets.get(4)).workCycle == 1,
      instanceBlocked(openInstance(tickets.get(4))),
      liveTasks(tickets.get(4)) == Set(),
      allInvariants })
    .then(resume(4)).expect(and {
      stateName(tickets.get(4)) == "Evaluation",
      lastEvent == "TicketEvaluationResumed",
      liveTasks(tickets.get(4)) == Set(evaluatorTaskIdentity(4, 1, 1, 2, 2)),
      allInvariants })

  /// THE PARTIAL RESUME, through the machine: a stage of two, one judging
  /// and one stopped. The stage concludes blocked, and generation 2 owes
  /// ONLY the stopped evaluator while the one that answered keeps what it
  /// said — which is why the re-ask cannot be a fresh fan-out of the stage.
  run partialEvaluationResumeWitness = init
    .then(release(4, Set(), pWide)).expect(allInvariants)
    .then(doDispatch(4))
    .then(doneProduced(4, workTaskIdentity(4, 1))).expect(and {
      liveTasks(tickets.get(4)) ==
        Set(evaluatorTaskIdentity(4, 1, 1, 1, 1), evaluatorTaskIdentity(4, 1, 1, 1, 2)),
      allInvariants })
    .then(done(4, evaluatorTaskIdentity(4, 1, 1, 1, 1),
        judged(4, evaluatorTaskIdentity(4, 1, 1, 1, 1), EvaluatorPass))).expect(and {
      // one answer does not conclude the stage
      stateName(tickets.get(4)) == "Evaluation",
      lastEvent == "TicketEvaluationProgressed", lastObligations == [],
      liveTasks(tickets.get(4)) == Set(evaluatorTaskIdentity(4, 1, 1, 1, 2)),
      allInvariants })
    .then(done(4, evaluatorTaskIdentity(4, 1, 1, 1, 2),
        walled(evaluatorTaskIdentity(4, 1, 1, 1, 2)))).expect(and {
      wallName(tickets.get(4)) == "EvaluationBlockedEscalated", allInvariants })
    .then(resume(4)).expect(and {
      liveTasks(tickets.get(4)) == Set(evaluatorTaskIdentity(4, 1, 1, 2, 2)),
      statusOf(tickets.get(4), 1) == Produced(EvaluatorPassed(1)),
      statusOf(tickets.get(4), 2) == Awaiting,
      allInvariants })
    .then(done(4, evaluatorTaskIdentity(4, 1, 1, 2, 2),
        judged(4, evaluatorTaskIdentity(4, 1, 1, 2, 2), EvaluatorPass))).expect(and {
      stateName(tickets.get(4)) == "Finalization",
      lastEvent == "TicketEvaluationPassed", allInvariants })
}

/// THE TWO EDGES OF AN EVALUATION FAILURE, reached through the machine
/// rather than hand-built: the disposition is what picks between them, and
/// both end in Work — one straight away, one through the desk. The
/// disposition rides on the completion that CONCLUDES the failing stage,
/// which is why each run names it there and nowhere else.
module chuggy_witness_rework_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_witness_fixture.*
  import chuggy_domain(N_TICKETS=2, N_TASKS=1, MAX_STAGES=1).* from "../domain"
  pure val p = [{ key: 1, evaluators: [evaluatorOf(1)] }]
  action release(j: int): bool = all {
    releasableIds.contains(j), validPlans.contains(p),
    take(CreateTicket(releasedTicketOf(j, Set(), p)), unaskedDisposition) }
  action doDispatch(j: int): bool =
    nondet source = dispatchSources.oneOf()
    all { readyTickets.contains(j),
      take(DispatchTicket({ ticket: j, source: source }), unaskedDisposition) }
  action doneWork(j: int, task: TaskIdentity): bool =
    nondet accepted = acceptedSources.oneOf()
    all {
      completableTickets.contains(j), liveTasks(tickets.get(j)).contains(task),
      take(ReportTaskTerminal(WorkResultReport({ ticket: j,
          result: producedResult(tickets.get(j), task),
          acceptedSourceRef: accepted })),
        ReworkEvaluationFailure) }
  action judge(j: int, task: TaskIdentity, v: EvaluationVerdict,
      d: EvaluationFailureDisposition): bool = all {
    completableTickets.contains(j), liveTasks(tickets.get(j)).contains(task),
    dispositionChoices.contains(d),
    take(ReportTaskTerminal(EvaluationResultReport({ ticket: j,
      result: producedResult(tickets.get(j), task), verdict: v })), d) }
  action resume(j: int): bool = all { retryableEscalated.contains(j),
    take(ResumeTicket(j), unaskedDisposition) }

  /// Rework: the failing stage re-enters Work directly, as a new cycle
  /// with a fresh work task, and the instance that failed is kept.
  run evaluationReworkWitness = init
    .then(release(4)).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(doneWork(4, workTaskIdentity(4, 1))).expect(and {
      stateName(tickets.get(4)) == "Evaluation", allInvariants })
    .then(judge(4, evaluatorTaskIdentity(4, 1, 1, 1, 1), EvaluatorFail,
        ReworkEvaluationFailure)).expect(and {
      stateName(tickets.get(4)) == "Work",
      lastEvent == "TicketEvaluationReworkStarted",
      lastObligations.length() == 1,
      ledgers.get(4).closedEvaluations.length() == 1,
      liveTasks(tickets.get(4)) == Set(workTaskIdentity(4, 2)), allInvariants })

  /// Escalate: the same failure parks the ticket instead, and the desk's
  /// resume re-enters Work — the same rework, one human later.
  run evaluationEscalateWitness = init
    .then(release(4)).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(doneWork(4, workTaskIdentity(4, 1))).expect(allInvariants)
    .then(judge(4, evaluatorTaskIdentity(4, 1, 1, 1, 1), EvaluatorFail,
        EscalateEvaluationFailure)).expect(and {
      wallName(tickets.get(4)) == "EvaluationFailureEscalated",
      resumeOf(tickets.get(4).state) == ResumeRework,
      retryableEscalated.contains(4), allInvariants })
    .then(resume(4)).expect(and {
      stateName(tickets.get(4)) == "Work", allInvariants })
}

module chuggy_witness_stage_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_witness_fixture.*
  import chuggy_domain(N_TICKETS=1, N_TASKS=2, MAX_STAGES=2).* from "../domain"
  pure val p = [{ key: 1, evaluators: [evaluatorOf(1)] },
                { key: 2, evaluators: [evaluatorOf(1)] }]
  action release: bool =
    take(CreateTicket(releasedTicketOf(2, Set(), p)), unaskedDisposition)
  action doDispatch: bool =
    nondet source = dispatchSources.oneOf()
    all { readyTickets.contains(2),
      take(DispatchTicket({ ticket: 2, source: source }), unaskedDisposition) }
  action doneWork(task: TaskIdentity): bool =
    nondet accepted = acceptedSources.oneOf()
    all {
      liveTasks(tickets.get(2)).contains(task),
      take(ReportTaskTerminal(WorkResultReport({ ticket: 2,
        result: producedResult(tickets.get(2), task),
        acceptedSourceRef: accepted })), ReworkEvaluationFailure) }
  action pass(task: TaskIdentity): bool = all {
    liveTasks(tickets.get(2)).contains(task),
    take(ReportTaskTerminal(EvaluationResultReport({ ticket: 2,
      result: producedResult(tickets.get(2), task),
      verdict: EvaluatorPass })), ReworkEvaluationFailure) }
  run stagedPlanWitness = init.then(release).then(doDispatch)
    .then(doneWork(workTaskIdentity(2, 1)))
    .then(pass(evaluatorTaskIdentity(2, 1, 1, 1, 1)))
    .expect(and { stateName(tickets.get(2)) == "Evaluation",
      lastEvent == "TicketEvaluationProgressed",
      lastObligations.length() == 1, not(stageAdvanceNever),
      liveTasks(tickets.get(2)) == Set(evaluatorTaskIdentity(2, 1, 2, 1, 1)),
      allInvariants })
    .then(pass(evaluatorTaskIdentity(2, 1, 2, 1, 1)))
    .expect(and { stateName(tickets.get(2)) == "Finalization", allInvariants })
}

/// Authored data is ticket-local and immutable: two tickets released into
/// one fleet keep the evaluation plan each was authored with.
module chuggy_witness_sparse_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2, N_TASKS=2, MAX_STAGES=1).* from "../domain"
  pure val pNarrow = [{ key: 1, evaluators: [evaluatorOf(1)] }]
  pure val pWide = [{ key: 1, evaluators: [evaluatorOf(1), evaluatorOf(2)] }]
  action release(j:int, stages: List[StageDefinition]): bool = all {
    releasableIds.contains(j), validPlans.contains(stages),
    take(CreateTicket(releasedTicketOf(j, Set(), stages)), unaskedDisposition) }
  run ticketLocalPolicyWitness = init
    .then(release(1,pNarrow))
    .then(release(4,pWide))
    .expect(and { tickets.get(1).definition.evaluationPlan.stages == pNarrow,
      tickets.get(4).definition.evaluationPlan.stages == pWide,
      allInvariants })
}

module chuggy_witness_gate_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_witness_fixture.*
  import chuggy_domain(N_TICKETS=2, N_TASKS=1, MAX_STAGES=1).* from "../domain"
  pure val p=[{key:1,evaluators:[evaluatorOf(1)]}]
  action releaseOn(j:int,dependencies:Set[int]):bool=all{releasableIds.contains(j),
    dependencies.subseteq(dependableTickets),
    take(CreateTicket(releasedTicketOf(j, dependencies, p)), unaskedDisposition)}
  action release(j:int):bool=releaseOn(j, Set())
  action update(j:int,stages:List[StageDefinition]):bool=all{
    revisableTickets.contains(j), validPlans.contains(stages),
    take(updateOf(tickets.get(j), stages), unaskedDisposition)}
  action doDispatch(j:int):bool=
    nondet source = dispatchSources.oneOf()
    all{readyTickets.contains(j),
      take(DispatchTicket({ticket: j, source: source}), unaskedDisposition)}
  action td(j:int,task:TaskIdentity):bool=
    nondet accepted = acceptedSources.oneOf()
    all{liveTasks(tickets.get(j)).contains(task),
      take(ReportTaskTerminal(WorkResultReport({ticket: j,
          result: producedResult(tickets.get(j), task),
          acceptedSourceRef: accepted})),
        ReworkEvaluationFailure)}
  action pass(j:int,task:TaskIdentity):bool=all{liveTasks(tickets.get(j)).contains(task),
    take(ReportTaskTerminal(EvaluationResultReport({ticket: j,
        result: producedResult(tickets.get(j), task),
        verdict: EvaluatorPass})),
      ReworkEvaluationFailure)}
  /// The finalizer's result for the attempt the ticket is on.
  action resolve(j:int,o:int => FinalizationResult):bool=all{
    finalizerTickets.contains(j),
    take(ReportFinalizationResult({ticket: j,
        workCycle: tickets.get(j).workCyclesStarted,
        generation: attemptGeneration(tickets.get(j)),
        result: o(aFinalizationEvidence)}),
      unaskedDisposition)}
  /// A command out of turn, drawn where the machine's `refuse` draws it:
  /// the machine answers it with the refusal and moves nothing.
  action refuseWith(command:TicketCommand):bool=all{
    refusedCommands.contains(command),
    take(command, unaskedDisposition)}
  /// The step refused with exactly this, and left the tickets standing.
  def refusedWith(reason:TicketRefusal):bool=and{
    lastStep==Refused(reason), tickets==prevTickets, allInvariants}
  /// The pass owes the finalizer the operation the ticket now runs.
  run finalizationSuccessWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,workTaskIdentity(1,1))).then(pass(1,evaluatorTaskIdentity(1,1,1,1,1)))
    .expect(and{lastEvent=="TicketEvaluationPassed",
      match tickets.get(1).state {
        | Finalization(op) => lastObligations==[finalize(tickets.get(1),op)]
        | _ => false
      },
      not(revocableTickets.contains(1)),allInvariants})
    .then(resolve(1,e => FinalizationSucceeded(e))).expect(and{tickets.get(1).state==Done,allInvariants})

  /// A finalizer that reports failure sends the ticket back to work, every
  /// time: there is no wall on this edge. The second cycle's judgement is a
  /// SECOND instance, which is what makes the history a list.
  run safeAbortReworkWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,workTaskIdentity(1,1))).then(pass(1,evaluatorTaskIdentity(1,1,1,1,1)))
    .then(resolve(1,e => FinalizationNeedsWork(e))).expect(and{stateName(tickets.get(1))=="Work",
      lastEvent=="TicketFinalizationNeedsWork",allInvariants})
    // A failure for the cycle the rework replaced names no task the ticket
    // owes.
    .then(refuseWith(ReportTaskTerminal(failureReportOf(1,workTaskIdentity(1,1)))))
    .expect(refusedWith(TaskNotCurrent({ticket:1,task:workTaskIdentity(1,1)})))
    .then(td(1,workTaskIdentity(1,2))).then(pass(1,evaluatorTaskIdentity(1,2,1,1,1)))
    .expect(and{ledgers.get(1).closedEvaluations.length()==2,allInvariants})
    // A result for the first cycle's attempt is fenced by the cycle.
    .then(refuseWith(finalizationReportOf(1,1,1)))
    .expect(refusedWith(FinalizationNotCurrent({ticket:1,workCycle:1,generation:1})))
    .then(resolve(1,e => FinalizationNeedsWork(e))).expect(and{stateName(tickets.get(1))=="Work",
      lastEvent=="TicketFinalizationNeedsWork",allInvariants})

  /// A finalizer that reaches NO result parks the ticket, and the desk's
  /// resume runs the finalizer again — the only resume that re-runs the step
  /// it interrupted, and the only exit a held finalization has: Finalization
  /// is neither revocable nor retryable, so before this wall the ticket sat
  /// there until the environment moved.
  action resume(j:int):bool=all{retryableEscalated.contains(j),
    take(ResumeTicket(j), unaskedDisposition)}
  run finalizationUnavailableWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,workTaskIdentity(1,1))).then(pass(1,evaluatorTaskIdentity(1,1,1,1,1)))
    .then(resolve(1,e => FinalizationResultUnavailable(e))).expect(and{
      lastEvent=="TicketFinalizationUnavailable",
      wallName(tickets.get(1))=="FinalizationUnavailableEscalated",
      resumeOf(tickets.get(1).state)==ResumeFinalization,
      retryableEscalated.contains(1),allInvariants})
    .then(resume(1)).expect(and{stateName(tickets.get(1))=="Finalization",
      lastEvent=="TicketFinalizationResumed",attemptGeneration(tickets.get(1))==2,
      allInvariants})
    // A result for the attempt the resume superseded is fenced by the
    // generation.
    .then(refuseWith(finalizationReportOf(1,1,1)))
    .expect(refusedWith(FinalizationNotCurrent({ticket:1,workCycle:1,generation:1})))
    .then(resolve(1,e => FinalizationSucceeded(e))).expect(and{tickets.get(1).state==Done,allInvariants})

  run revokeBoundaryWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,workTaskIdentity(1,1))).then(pass(1,evaluatorTaskIdentity(1,1,1,1,1)))
    .expect(and{not(revocableTickets.contains(1)),allInvariants})
    .then(refuseWith(RevokeTicket(1)))
    .expect(refusedWith(TicketNotRevocable(1)))

  /// AN UPDATED TICKET RUNS WHAT IT WAS UPDATED TO: the update owes
  /// nothing, and the dispatch after it owes the work the second revision
  /// pinned.
  run updateThenDispatchWitness=init.then(release(1)).then(update(1,p))
    .expect(and{lastEvent=="TicketUpdated",lastObligations==[],
      tickets.get(1).revision==2,
      tickets.get(1).definition==revisedTicketOf(1,2,Set(),p),allInvariants})
    .then(doDispatch(1))
    .expect(and{lastObligations==[ExecuteTask({ticket:1,task:{task:workTaskIdentity(1,1),
        definition:revisedTicketOf(1,2,Set(),p).workConfiguration,contextRef:1}})],
      allInvariants})

  /// EVERY REFUSAL THIS INSTANCE CAN REACH, each drawn where `refuse` draws
  /// it (commandProbesIn), each answered with its own payload and nothing
  /// moved.
  run refusalsWitness=init.then(release(1))
    .then(refuseWith(UpdateTicket({ticket:2,expectedRevision:1,
      definition:releasedTicketOf(2,Set(),defaultPlan)})))
    .expect(refusedWith(TicketNotFound(2)))
    .then(update(1,p))
    .then(refuseWith(UpdateTicket({ticket:1,expectedRevision:1,
      definition:revisedTicketOf(1,3,Set(),defaultPlan)})))
    .expect(refusedWith(TicketRevisionStale({ticket:1,expected:1,current:2})))
    .then(refuseWith(UpdateTicket({ticket:1,expectedRevision:2,
      definition:revisedTicketOf(2,3,Set(),defaultPlan)})))
    .expect(refusedWith(TicketIdentityMismatch(1)))
    .then(refuseWith(UpdateTicket({ticket:1,expectedRevision:2,
      definition:revisedTicketOf(1,3,Set(2),defaultPlan)})))
    .expect(refusedWith(TicketDependenciesChanged(1)))
    .then(refuseWith(CreateTicket(releasedTicketOf(1,Set(),defaultPlan))))
    .expect(refusedWith(TicketAlreadyExists(1)))
    .then(refuseWith(CreateTicket(releasedTicketOf(2,Set(2),defaultPlan))))
    .expect(refusedWith(SelfDependency(2)))
    .then(refuseWith(CreateTicket(releasedTicketOf(2,Set(3,4),defaultPlan))))
    .expect(refusedWith(DependenciesNotFound({ticket:2,dependencies:Set(3,4)})))
    .then(refuseWith(RevokeTicket(3)))
    .expect(refusedWith(TicketNotFound(3)))
    .then(refuseWith(ResumeTicket(1)))
    .expect(refusedWith(TicketNotResumable(1)))
    .then(releaseOn(2,Set(1)))
    .then(refuseWith(DispatchTicket({ticket:2,source:aDispatchSource})))
    .expect(refusedWith(DependenciesIncomplete({ticket:2,dependencies:Set(1)})))
    .then(doDispatch(1))
    .then(refuseWith(DispatchTicket({ticket:1,source:aDispatchSource})))
    .expect(refusedWith(TicketNotPending(1)))
    .then(refuseWith(UpdateTicket({ticket:1,expectedRevision:1,
      definition:revisedTicketOf(1,3,Set(),defaultPlan)})))
    .expect(refusedWith(TicketNotPending(1)))
    .then(td(1,workTaskIdentity(1,1)))
    .then(refuseWith(ReportTaskTerminal(failureReportOf(1,workTaskIdentity(1,1)))))
    .expect(refusedWith(TaskNotCurrent({ticket:1,task:workTaskIdentity(1,1)})))
    .then(refuseWith(finalizationReportOf(1,1,1)))
    .expect(refusedWith(FinalizationNotCurrent({ticket:1,workCycle:1,generation:1})))
}

/// Former release candidate-wait slot: dependency admission requires an already-existing id.
module chuggy_witness_dependency_test {
  import task_contract.* from "../task-contract/task"
  import ticket_domain.* from "../ticket-domain/ticket"
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2,N_TASKS=1,MAX_STAGES=1).* from "../domain"
  pure val p=[{key:1,evaluators:[evaluatorOf(1)]}]
  run existingDependencyWitness=init
    .then(take(CreateTicket(releasedTicketOf(4, Set(), p)), unaskedDisposition))
    .then(take(CreateTicket(releasedTicketOf(1, Set(4), p)), unaskedDisposition))
    .expect(and{tickets.keys()==Set(1,4),tickets.get(1).definition.dependencies==Set(4),isBlocked(1),allInvariants})
}
