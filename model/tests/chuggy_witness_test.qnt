/// Deterministic reachability witnesses for the current released-ticket API.
/// Every driver names the machine's nondeterministic choice and references
/// the same exported guard/draw set used by the corresponding action.

module chuggy_witness_resume_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "../ticket"
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
    EvaluationResultReport({ result: producedResult(tickets.get(j), task),
      verdict: v })
  pure def walled(task: TaskIdentity): TaskTerminalReport =
    TerminalFailureReport({ failure: { task: task, evidence: taskRefOf(task) },
      kind: ExecutionUnavailableFailure })
  pure def statusOf(jb: Ticket, evaluator: int): EvaluatorStatus =
    match currentInstance(jb).state {
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
    apply(decideReleaseTicket(graph, releasedTicketOf(j, dependencies, stages))) }
  action doDispatch(j: int): bool =
    nondet source = dispatchSources.oneOf()
    all { readyTickets.contains(j), apply(decideDispatch(graph, j, source)) }
  action done(j: int, task: TaskIdentity, report: TaskTerminalReport): bool = all {
    completableTickets.contains(j), liveTasks(tickets.get(j)).contains(task),
    reportChoices(tickets.get(j), task).contains(report),
    apply(decideTaskDone(graph,j,task,report,_ => ReworkEvaluationFailure)) }
  /// A WORK COMPLETION: the source the application accepted the result at
  /// is the environment's, so the driver draws it where the machine does.
  action doneProduced(j: int, task: TaskIdentity): bool =
    nondet accepted = acceptedSources.oneOf()
    done(j, task, WorkResultReport({
      result: producedResult(tickets.get(j), task), acceptedSourceRef: accepted }))
  action resume(j: int): bool = all { retryableEscalated.contains(j), apply(decideResumeTicket(graph,j)) }

  /// A WORK TASK'S WALL parks the ticket in the completion itself: a work
  /// cycle is one task, so nothing is left to wait for. Its resume buys a
  /// new cycle.
  run executionBlockedResumeWitness = init
    .then(release(4, Set(), p)).expect(and { tickets.get(4).phase == Pending, allInvariants })
    .then(doDispatch(4)).expect(and { tickets.get(4).phase == Work, allInvariants })
    .then(done(4, workTaskOf(4, 1), walled(workTaskOf(4, 1)))).expect(and {
      tickets.get(4).phase == Escalated,
      tickets.get(4).escalation == WorkExecutionUnavailableEscalated,
      lastEvent == "TicketWorkExecutionUnavailable",
      resumeOf(tickets.get(4).escalation) == ResumeWork,
      liveTasks(tickets.get(4)) == Set(),
      // no judgement was reached, so there is no instance to keep
      tickets.get(4).evaluations == [], allInvariants })
    .then(resume(4)).expect(and { tickets.get(4).phase == Work,
      tickets.get(4).escalation == NoEscalation,
      lastEvent == "TicketWorkResumed",
      liveTasks(tickets.get(4)) == Set(workTaskOf(4, 2)),
      allInvariants })

  /// An interrupted EVALUATION parks at its OWN wall and resumes into
  /// evaluation, not into work: the artifact is intact and the judgement is
  /// still to make, so the resume re-asks the stopped evaluators of the
  /// SAME stage at the NEXT generation.
  run evaluationResumeWitness = init
    .then(release(4, Set(), p)).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(doneProduced(4, workTaskOf(4, 1))).expect(and {
      tickets.get(4).phase == Evaluation,
      lastEvent == "TicketWorkResultAccepted",
      liveTasks(tickets.get(4)) == Set(evaluatorTaskIdentity(4, 1, 1, 1, 2)),
      allInvariants })
    .then(done(4, evaluatorTaskIdentity(4, 1, 1, 1, 2),
        walled(evaluatorTaskIdentity(4, 1, 1, 1, 2)))).expect(and {
      tickets.get(4).escalation == EvaluationBlockedEscalated,
      lastEvent == "TicketEvaluationBlocked",
      resumeOf(tickets.get(4).escalation) == ResumeEvaluation,
      // the instance is the provenance the resume re-asks from
      tickets.get(4).evaluations.length() == 1,
      currentInstance(tickets.get(4)).workCycle == 1,
      instanceBlocked(currentInstance(tickets.get(4))),
      liveTasks(tickets.get(4)) == Set(),
      allInvariants })
    .then(resume(4)).expect(and {
      tickets.get(4).phase == Evaluation,
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
    .then(doneProduced(4, workTaskOf(4, 1))).expect(and {
      liveTasks(tickets.get(4)) ==
        Set(evaluatorTaskIdentity(4, 1, 1, 1, 1), evaluatorTaskIdentity(4, 1, 1, 1, 2)),
      allInvariants })
    .then(done(4, evaluatorTaskIdentity(4, 1, 1, 1, 1),
        judged(4, evaluatorTaskIdentity(4, 1, 1, 1, 1), EvaluatorPass))).expect(and {
      // one answer does not conclude the stage
      tickets.get(4).phase == Evaluation,
      lastEvent == "TicketEvaluationProgressed", lastObligations == [],
      liveTasks(tickets.get(4)) == Set(evaluatorTaskIdentity(4, 1, 1, 1, 2)),
      allInvariants })
    .then(done(4, evaluatorTaskIdentity(4, 1, 1, 1, 2),
        walled(evaluatorTaskIdentity(4, 1, 1, 1, 2)))).expect(and {
      tickets.get(4).escalation == EvaluationBlockedEscalated, allInvariants })
    .then(resume(4)).expect(and {
      liveTasks(tickets.get(4)) == Set(evaluatorTaskIdentity(4, 1, 1, 2, 2)),
      statusOf(tickets.get(4), 1) == Produced(EvaluatorPassed(1)),
      statusOf(tickets.get(4), 2) == Awaiting,
      allInvariants })
    .then(done(4, evaluatorTaskIdentity(4, 1, 1, 2, 2),
        judged(4, evaluatorTaskIdentity(4, 1, 1, 2, 2), EvaluatorPass))).expect(and {
      tickets.get(4).phase == Finalization,
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
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2, N_TASKS=1, MAX_STAGES=1).* from "../domain"
  pure val p = [{ key: 1, evaluators: [evaluatorOf(1)] }]
  action release(j: int): bool = all {
    releasableIds.contains(j), validPlans.contains(p),
    apply(decideReleaseTicket(graph, releasedTicketOf(j, Set(), p))) }
  action doDispatch(j: int): bool =
    nondet source = dispatchSources.oneOf()
    all { readyTickets.contains(j), apply(decideDispatch(graph, j, source)) }
  action doneWork(j: int, task: TaskIdentity): bool =
    nondet accepted = acceptedSources.oneOf()
    all {
      completableTickets.contains(j), liveTasks(tickets.get(j)).contains(task),
      apply(decideTaskDone(graph, j, task,
        WorkResultReport({ result: producedResult(tickets.get(j), task),
          acceptedSourceRef: accepted }),
        _ => ReworkEvaluationFailure)) }
  action judge(j: int, task: TaskIdentity, v: EvaluationVerdict,
      d: EvaluationFailureDisposition): bool = all {
    completableTickets.contains(j), liveTasks(tickets.get(j)).contains(task),
    dispositionChoices.contains(d),
    apply(decideTaskDone(graph, j, task,
      EvaluationResultReport({ result: producedResult(tickets.get(j), task),
        verdict: v }), _ => d)) }
  action resume(j: int): bool = all { retryableEscalated.contains(j), apply(decideResumeTicket(graph,j)) }

  /// Rework: the failing stage re-enters Work directly, as a new cycle
  /// with a fresh work task, and the instance that failed is kept.
  run evaluationReworkWitness = init
    .then(release(4)).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(doneWork(4, workTaskOf(4, 1))).expect(and {
      tickets.get(4).phase == Evaluation, allInvariants })
    .then(judge(4, evaluatorTaskIdentity(4, 1, 1, 1, 1), EvaluatorFail,
        ReworkEvaluationFailure)).expect(and {
      tickets.get(4).phase == Work,
      lastEvent == "TicketEvaluationReworkStarted",
      lastObligations.length() == 1,
      tickets.get(4).evaluations.length() == 1,
      liveTasks(tickets.get(4)) == Set(workTaskOf(4, 2)), allInvariants })

  /// Escalate: the same failure parks the ticket instead, and the desk's
  /// resume re-enters Work — the same rework, one human later.
  run evaluationEscalateWitness = init
    .then(release(4)).expect(allInvariants)
    .then(doDispatch(4)).expect(allInvariants)
    .then(doneWork(4, workTaskOf(4, 1))).expect(allInvariants)
    .then(judge(4, evaluatorTaskIdentity(4, 1, 1, 1, 1), EvaluatorFail,
        EscalateEvaluationFailure)).expect(and {
      tickets.get(4).phase == Escalated,
      tickets.get(4).escalation == EvaluationFailureEscalated,
      resumeOf(tickets.get(4).escalation) == ResumeRework,
      retryableEscalated.contains(4), allInvariants })
    .then(resume(4)).expect(and {
      tickets.get(4).phase == Work,
      tickets.get(4).escalation == NoEscalation, allInvariants })
}

module chuggy_witness_stage_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=1, N_TASKS=2, MAX_STAGES=2).* from "../domain"
  pure val p = [{ key: 1, evaluators: [evaluatorOf(1)] },
                { key: 2, evaluators: [evaluatorOf(1)] }]
  action release: bool = apply(decideReleaseTicket(graph, releasedTicketOf(2, Set(), p)))
  action doDispatch: bool =
    nondet source = dispatchSources.oneOf()
    all { readyTickets.contains(2), apply(decideDispatch(graph, 2, source)) }
  action doneWork(task: TaskIdentity): bool =
    nondet accepted = acceptedSources.oneOf()
    all {
      liveTasks(tickets.get(2)).contains(task),
      apply(decideTaskDone(graph, 2, task,
        WorkResultReport({ result: producedResult(tickets.get(2), task),
          acceptedSourceRef: accepted }), _ => ReworkEvaluationFailure)) }
  action pass(task: TaskIdentity): bool = all {
    liveTasks(tickets.get(2)).contains(task),
    apply(decideTaskDone(graph, 2, task,
      EvaluationResultReport({ result: producedResult(tickets.get(2), task),
        verdict: EvaluatorPass }),
      _ => ReworkEvaluationFailure)) }
  run stagedPlanWitness = init.then(release).then(doDispatch)
    .then(doneWork(workTaskOf(2, 1)))
    .then(pass(evaluatorTaskIdentity(2, 1, 1, 1, 1)))
    .expect(and { tickets.get(2).phase == Evaluation,
      lastEvent == "TicketEvaluationProgressed",
      lastObligations.length() == 1, not(stageAdvanceNever),
      liveTasks(tickets.get(2)) == Set(evaluatorTaskIdentity(2, 1, 2, 1, 1)),
      allInvariants })
    .then(pass(evaluatorTaskIdentity(2, 1, 2, 1, 1)))
    .expect(and { tickets.get(2).phase == Finalization, allInvariants })
}

/// Authored data is ticket-local and immutable: two tickets released into
/// one fleet keep the evaluation plan each was authored with.
module chuggy_witness_sparse_test {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "../ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2, N_TASKS=2, MAX_STAGES=1).* from "../domain"
  pure val pNarrow = [{ key: 1, evaluators: [evaluatorOf(1)] }]
  pure val pWide = [{ key: 1, evaluators: [evaluatorOf(1), evaluatorOf(2)] }]
  action release(j:int, stages: List[StageDefinition]): bool = all {
    releasableIds.contains(j), validPlans.contains(stages),
    apply(decideReleaseTicket(graph, releasedTicketOf(j, Set(), stages))) }
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
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2, N_TASKS=1, MAX_STAGES=1).* from "../domain"
  pure val p=[{key:1,evaluators:[evaluatorOf(1)]}]
  action release(j:int):bool=apply(decideReleaseTicket(graph, releasedTicketOf(j, Set(), p)))
  action doDispatch(j:int):bool=
    nondet source = dispatchSources.oneOf()
    all{readyTickets.contains(j),apply(decideDispatch(graph, j, source))}
  action td(j:int,task:TaskIdentity):bool=
    nondet accepted = acceptedSources.oneOf()
    all{liveTasks(tickets.get(j)).contains(task),
      apply(decideTaskDone(graph,j,task,
        WorkResultReport({result: producedResult(tickets.get(j), task),
          acceptedSourceRef: accepted}),
        _ => ReworkEvaluationFailure))}
  action pass(j:int,task:TaskIdentity):bool=all{liveTasks(tickets.get(j)).contains(task),
    apply(decideTaskDone(graph,j,task,
      EvaluationResultReport({result: producedResult(tickets.get(j), task),
        verdict: EvaluatorPass}),
      _ => ReworkEvaluationFailure))}
  action resolve(j:int,o:FinalizationOutcome):bool=all{tickets.get(j).phase==Finalization,apply(decideFinalizationResult(graph,j,o,aFinalizationEvidence))}
  run finalizationSuccessWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,workTaskOf(1,1))).then(pass(1,evaluatorTaskIdentity(1,1,1,1,1)))
    .expect(and{tickets.get(1).phase==Finalization,lastEvent=="TicketEvaluationPassed",
      lastObligations==[finalize(tickets.get(1),finalizationOperationOf(tickets.get(1)))],
      not(revocableTickets.contains(1)),allInvariants})
    .then(resolve(1,FinalizationSucceeded)).expect(and{tickets.get(1).phase==Done,allInvariants})

  /// A finalizer that reports failure sends the ticket back to work, every
  /// time: there is no wall on this edge. The second cycle's judgement is a
  /// SECOND instance, which is what makes the history a list.
  run safeAbortReworkWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,workTaskOf(1,1))).then(pass(1,evaluatorTaskIdentity(1,1,1,1,1)))
    .then(resolve(1,FinalizationNeedsWork)).expect(and{tickets.get(1).phase==Work,
      lastEvent=="TicketFinalizationNeedsWork",allInvariants})
    .then(td(1,workTaskOf(1,2))).then(pass(1,evaluatorTaskIdentity(1,2,1,1,1)))
    .expect(and{tickets.get(1).evaluations.length()==2,allInvariants})
    .then(resolve(1,FinalizationNeedsWork)).expect(and{tickets.get(1).phase==Work,
      lastEvent=="TicketFinalizationNeedsWork",allInvariants})

  /// A finalizer that reaches NO result parks the ticket, and the desk's
  /// resume runs the finalizer again — the only resume that re-runs the step
  /// it interrupted, and the only exit a held finalization has: Finalization
  /// is neither revocable nor retryable, so before this wall the ticket sat
  /// there until the environment moved.
  action resume(j:int):bool=all{retryableEscalated.contains(j),apply(decideResumeTicket(graph,j))}
  run finalizationUnavailableWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,workTaskOf(1,1))).then(pass(1,evaluatorTaskIdentity(1,1,1,1,1)))
    .then(resolve(1,FinalizationResultUnavailable)).expect(and{tickets.get(1).phase==Escalated,
      lastEvent=="TicketFinalizationUnavailable",
      tickets.get(1).escalation==FinalizationUnavailableEscalated,
      resumeOf(tickets.get(1).escalation)==ResumeFinalization,
      retryableEscalated.contains(1),allInvariants})
    .then(resume(1)).expect(and{tickets.get(1).phase==Finalization,
      lastEvent=="TicketFinalizationResumed",tickets.get(1).finalizationGeneration==2,
      tickets.get(1).escalation==NoEscalation,allInvariants})
    .then(resolve(1,FinalizationSucceeded)).expect(and{tickets.get(1).phase==Done,allInvariants})

  run revokeBoundaryWitness=init.then(release(1)).then(doDispatch(1)).then(td(1,workTaskOf(1,1))).then(pass(1,evaluatorTaskIdentity(1,1,1,1,1)))
    .expect(and{not(revocableTickets.contains(1)),allInvariants})
}

/// Former release candidate-wait slot: dependency admission requires an already-existing id.
module chuggy_witness_dependency_test {
  import task_contract.* from "../task-contract/task"
  import chuggy_ticket.* from "../ticket"
  import chuggy_domain(N_TICKETS=2,N_TASKS=1,MAX_STAGES=1).* from "../domain"
  pure val p=[{key:1,evaluators:[evaluatorOf(1)]}]
  run existingDependencyWitness=init
    .then(apply(decideReleaseTicket(graph, releasedTicketOf(4, Set(), p))))
    .then(apply(decideReleaseTicket(graph, releasedTicketOf(1, Set(4), p))))
    .expect(and{tickets.keys()==Set(1,4),tickets.get(1).definition.dependencies==Set(4),isBlocked(1),allInvariants})
}
