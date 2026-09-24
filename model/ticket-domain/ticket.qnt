module ticket_domain {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "evaluation/evaluation"

  type ReleasedContent = int

  type WorkCause =
    InitialWork
    | EvaluationRework(List[EvaluationReworkEntry])
    | FinalizationRework(int)

  type WorkInput = {
    released: ReleasedContent,
    cause: WorkCause,
    retryEvidence: List[int]
  }

  type WorkExecution = { input: WorkInput, source: int }

  type FinalizationOperation = {
    workCycle: int,
    generation: int,
    input: int,
    source: int
  }

  type EvaluationFailureDisposition =
    ReworkEvaluationFailure
    | EscalateEvaluationFailure

  type EvaluationFailurePolicy = EvaluationInstance => EvaluationFailureDisposition

  type WorkEscalation = {
    resumeInput: WorkInput,
    source: int,
    evidence: int
  }

  type EvaluationFailureEscalation = {
    evidence: List[EvaluationReworkEntry],
    source: int
  }

  type FinalizationEscalation = {
    finalization: FinalizationOperation,
    evidence: int
  }

  type Escalation =
    WorkFailureEscalated(WorkEscalation)
    | WorkExecutionUnavailableEscalated(WorkEscalation)
    | EvaluationFailureEscalated(EvaluationFailureEscalation)
    | EvaluationBlockedEscalated(EvaluationInstance)
    | FinalizationUnavailableEscalated(FinalizationEscalation)

  type ReleasedTicket = {
    id: int,
    content: ReleasedContent,
    dependencies: Set[int],
    workConfiguration: TaskDefinition,
    evaluationPlan: EvaluationPlan,
    finalizationConfiguration: int
  }

  type TicketState =
    Pending
    | Work(WorkExecution)
    | Evaluation(EvaluationInstance)
    | Finalization(FinalizationOperation)
    | Escalated(Escalation)
    | Done
    | Revoked

  type Ticket = {
    definition: ReleasedTicket,
    revision: int,
    workCyclesStarted: int,
    state: TicketState
  }

  type TicketGraph = { tickets: int -> Ticket }

  type FailureKind = ProcessFailure | ExecutionUnavailableFailure

  type TaskTerminalReport =
    WorkResultReport({ ticket: int, result: ValidatedTaskResult, acceptedSourceRef: int })
    | EvaluationResultReport({ ticket: int, result: ValidatedTaskResult, verdict: EvaluationVerdict })
    | TerminalFailureReport({ ticket: int, failure: TaskFailure, kind: FailureKind })

  type FinalizationResult =
    FinalizationSucceeded(int)
    | FinalizationNeedsWork(int)
    | FinalizationResultUnavailable(int)

  type FinalizationResultReport = {
    ticket: int,
    workCycle: int,
    generation: int,
    result: FinalizationResult
  }

  type TicketCommand =
    CreateTicket(ReleasedTicket)
    | UpdateTicket({
        ticket: int,
        expectedRevision: int,
        definition: ReleasedTicket
      })
    | DispatchTicket({ ticket: int, source: int })
    | RevokeTicket(int)
    | ResumeTicket(int)
    | ReportTaskTerminal(TaskTerminalReport)
    | ReportFinalizationResult(FinalizationResultReport)

  type IncompleteDependencies = {
    ticket: int,
    dependencies: Set[int]
  }

  type CurrentTaskRefusal = {
    ticket: int,
    task: TaskIdentity
  }

  type CurrentFinalizationRefusal = {
    ticket: int,
    workCycle: int,
    generation: int
  }

  type StaleRevision = {
    ticket: int,
    expected: int,
    current: int
  }

  type TicketRefusal =
    TicketAlreadyExists(int)
    | DependenciesNotFound(IncompleteDependencies)
    | SelfDependency(int)
    | TicketNotFound(int)
    | TicketNotPending(int)
    | TicketIdentityMismatch(int)
    | TicketRevisionStale(StaleRevision)
    | TicketDependenciesChanged(int)
    | DependenciesIncomplete(IncompleteDependencies)
    | TicketNotRevocable(int)
    | TicketNotResumable(int)
    | TaskNotCurrent(CurrentTaskRefusal)
    | FinalizationNotCurrent(CurrentFinalizationRefusal)

  type TaskTerminalFact = {
    ticket: int,
    report: TaskTerminalReport
  }

  type EvaluationReworkFact = {
    ticket: int,
    report: TaskTerminalReport,
    evidence: List[EvaluationReworkEntry]
  }

  type WorkResultAcceptedEvent = {
    ticket: int,
    result: ValidatedTaskResult,
    acceptedSourceRef: int
  }

  type WorkFailureEvent = {
    ticket: int,
    task: TaskIdentity,
    evidence: int
  }

  type FinalizationFact = {
    ticket: int,
    workCycle: int,
    generation: int,
    evidence: int
  }

  type TicketUpdate = {
    ticket: int,
    revision: int,
    definition: ReleasedTicket
  }

  type TicketEvent =
    TicketCreated(ReleasedTicket)
    | TicketUpdated(TicketUpdate)
    | TicketDispatched({ ticket: int, source: int })
    | TicketRevoked(int)
    | TicketWorkResumed(int)
    | TicketEvaluationResumed(int)
    | TicketFinalizationResumed(int)
    | TicketWorkResultAccepted(WorkResultAcceptedEvent)
    | TicketWorkProcessFailed(WorkFailureEvent)
    | TicketWorkExecutionUnavailable(WorkFailureEvent)
    | TicketEvaluationProgressed(TaskTerminalFact)
    | TicketEvaluationPassed(TaskTerminalFact)
    | TicketEvaluationReworkStarted(EvaluationReworkFact)
    | TicketEvaluationFailureEscalated(EvaluationReworkFact)
    | TicketEvaluationBlocked(TaskTerminalFact)
    | TicketFinalizationSucceeded(FinalizationFact)
    | TicketFinalizationNeedsWork(FinalizationFact)
    | TicketFinalizationUnavailable(FinalizationFact)

  type TicketTaskObligation = {
    ticket: int,
    task: TaskObligation
  }

  type FinalizationObligation = {
    ticket: int,
    finalization: FinalizationOperation,
    configuration: int
  }

  type TaskCancellation = {
    ticket: int,
    task: TaskIdentity
  }

  type Obligation =
    ExecuteTask(TicketTaskObligation)
    | FinalizeTicket(FinalizationObligation)
    | CancelTask(TaskCancellation)

  type SuccessfulTicketDecision = {
    event: TicketEvent,
    obligations: List[Obligation]
  }

  type TicketDecision =
    TicketRefused(TicketRefusal)
    | TicketDecided(SuccessfulTicketDecision)

  pure def refused(reason: TicketRefusal): TicketDecision =
    TicketRefused(reason)

  pure def decided(
    event: TicketEvent,
    obligations: List[Obligation],
  ): TicketDecision = TicketDecided({
    event: event,
    obligations: obligations,
  })

  pure def isTerminal(state: TicketState): bool = match state {
    | Done => true
    | Revoked => true
    | _ => false
  }

  pure def isPending(state: TicketState): bool = match state {
    | Pending => true
    | _ => false
  }

  pure def isEscalated(state: TicketState): bool = match state {
    | Escalated(_) => true
    | _ => false
  }

  pure def releasedTicketValid(definition: ReleasedTicket): bool =
    definition.id > 0
    and releasedContentValid(definition.content)
    and definition.dependencies.forall(dependency => dependency > 0)
    and taskDefinitionValid(definition.workConfiguration)
    and planValid(definition.evaluationPlan)
    and definition.finalizationConfiguration > 0

  pure def finalizationResultValid(result: FinalizationResult): bool =
    match result {
      | FinalizationSucceeded(evidence) => evidence > 0
      | FinalizationNeedsWork(evidence) => evidence > 0
      | FinalizationResultUnavailable(evidence) => evidence > 0
    }

  pure def commandValid(command: TicketCommand): bool = match command {
    | CreateTicket(definition) => releasedTicketValid(definition)
    | UpdateTicket(update) => update.ticket > 0
        and update.expectedRevision > 0
        and releasedTicketValid(update.definition)
    | DispatchTicket(dispatch) => dispatch.ticket > 0 and dispatch.source > 0
    | ReportTaskTerminal(report) => reportValid(report)
    | ReportFinalizationResult(report) => report.ticket > 0
        and report.workCycle > 0
        and report.generation > 0
        and finalizationResultValid(report.result)
    | _ => true
  }

  pure def reportTicket(report: TaskTerminalReport): int = match report {
    | WorkResultReport(work) => work.ticket
    | EvaluationResultReport(evaluation) => evaluation.ticket
    | TerminalFailureReport(failure) => failure.ticket
  }

  pure def reportTask(report: TaskTerminalReport): TaskIdentity = match report {
    | WorkResultReport(work) => work.result.obligation.task
    | EvaluationResultReport(evaluation) => evaluation.result.obligation.task
    | TerminalFailureReport(failure) => failure.failure.task
  }

  pure def reportValid(report: TaskTerminalReport): bool = match report {
    | WorkResultReport(work) => work.ticket > 0 and work.acceptedSourceRef > 0
        and terminalValid(TaskResultProduced(work.result))
    | EvaluationResultReport(evaluation) => evaluation.ticket > 0
        and terminalValid(TaskResultProduced(evaluation.result))
    | TerminalFailureReport(failure) => failure.ticket > 0
        and failure.failure.evidence > 0
        and taskIdentityValid(failure.failure.task)
  }

  pure def applyEvaluationReport(
    evaluation: EvaluationInstance,
    report: TaskTerminalReport,
  ): EvaluationInstance = match report {
    | EvaluationResultReport(produced) => applyProduced(
        evaluation,
        produced.result.obligation.task,
        produced.result,
        produced.verdict,
      )
    | TerminalFailureReport(failure) => applyFailure(
        evaluation,
        failure.failure.task,
        match failure.kind {
          | ProcessFailure => TaskProcessFailed(failure.failure)
          | ExecutionUnavailableFailure => TaskExecutionUnavailable(failure.failure)
        },
      )
    | WorkResultReport(_) => evaluation
  }

  // An evaluation event may only be applied to the evaluation that still owes
  // its reported task; the phase alone does not make the pairing legal.
  pure def reportAdmissible(
    evaluation: EvaluationInstance,
    report: TaskTerminalReport,
  ): bool = taskCurrent(evaluation, reportTask(report))

  pure def workTaskIdentity(ticket: int, cycle: int): TaskIdentity =
    WorkTask({ ticket: ticket, cycle: cycle })

  pure def releasedContentValid(content: ReleasedContent): bool = content > 0

  pure def initialWorkInput(definition: ReleasedTicket): WorkInput = {
    released: definition.content,
    cause: InitialWork,
    retryEvidence: [],
  }

  pure def retryWorkInput(input: WorkInput, evidence: int): WorkInput = {
    ...input,
    retryEvidence: input.retryEvidence.append(evidence),
  }

  pure def nextCycleNumber(ticket: Ticket): int = ticket.workCyclesStarted + 1

  pure def evaluationReworkInput(
    definition: ReleasedTicket,
    entries: List[EvaluationReworkEntry],
  ): WorkInput = {
    released: definition.content,
    cause: EvaluationRework(entries),
    retryEvidence: [],
  }

  pure def finalizationReworkInput(
    definition: ReleasedTicket,
    evidence: int,
  ): WorkInput = {
    released: definition.content,
    cause: FinalizationRework(evidence),
    retryEvidence: [],
  }

  pure def workTaskObligation(
    ticket: Ticket,
    cycleNumber: int,
    source: int,
    input: WorkInput,
  ): TaskObligation = {
    task: workTaskIdentity(ticket.definition.id, cycleNumber),
    definition: ticket.definition.workConfiguration,
    contextRef: cycleNumber,
  }

  pure def executeWork(
    ticket: Ticket,
    cycleNumber: int,
    source: int,
    input: WorkInput,
  ): Obligation = ExecuteTask({
    ticket: ticket.definition.id,
    task: workTaskObligation(ticket, cycleNumber, source, input),
  })

  pure def resumedFinalization(
    operation: FinalizationOperation,
  ): FinalizationOperation = {
    ...operation,
    generation: operation.generation + 1,
  }

  pure def finalizationCurrent(
    operation: FinalizationOperation,
    workCycle: int,
    generation: int,
  ): bool =
    operation.workCycle == workCycle and operation.generation == generation

  pure def executeEvaluationTasks(
    ticket: int,
    evaluation: EvaluationInstance,
  ): List[Obligation] =
    currentTaskObligations(evaluation).foldl([], (obligations, task) =>
      obligations.append(ExecuteTask({ ticket: ticket, task: task })))

  pure def finalize(
    ticket: Ticket,
    operation: FinalizationOperation,
  ): Obligation = FinalizeTicket({
    ticket: ticket.definition.id,
    finalization: operation,
    configuration: ticket.definition.finalizationConfiguration,
  })

  pure def dependencyComplete(graph: TicketGraph, dependency: int): bool =
    graph.tickets.get(dependency).state == Done

  pure def incompleteDependencies(
    graph: TicketGraph,
    ticket: Ticket,
  ): Set[int] = ticket.definition.dependencies.filter(dependency =>
    not(dependencyComplete(graph, dependency)))

  pure def dependenciesComplete(graph: TicketGraph, ticket: Ticket): bool =
    incompleteDependencies(graph, ticket) == Set()

  pure def isReady(graph: TicketGraph, ticket: int): bool =
    graph.tickets.keys().contains(ticket)
    and isPending(graph.tickets.get(ticket).state)
    and dependenciesComplete(graph, graph.tickets.get(ticket))

  pure def revocationAllowed(state: TicketState): bool = match state {
    | Finalization(_) => false
    | Done => false
    | Revoked => false
    | _ => true
  }

  pure def liveTaskList(ticket: Ticket): List[TaskIdentity] =
    match ticket.state {
      | Work(_) => [workTaskIdentity(
          ticket.definition.id,
          ticket.workCyclesStarted,
        )]
      | Evaluation(evaluation) => currentTaskObligations(evaluation)
          .foldl([], (tasks, obligation) => tasks.append(obligation.task))
      | _ => []
    }

  pure def listHasTask(
    tasks: List[TaskIdentity],
    task: TaskIdentity,
  ): bool = tasks.indices().exists(index => tasks[index] == task)

  pure def cancelLiveTasks(ticket: Ticket): List[Obligation] =
    liveTaskList(ticket).foldl([], (obligations, task) =>
      obligations.append(CancelTask({
        ticket: ticket.definition.id,
        task: task,
      })))

  pure def decideCreate(
    graph: TicketGraph,
    definition: ReleasedTicket,
  ): TicketDecision =
    if (graph.tickets.keys().contains(definition.id))
      refused(TicketAlreadyExists(definition.id))
    else if (definition.dependencies.contains(definition.id))
      refused(SelfDependency(definition.id))
    else {
      val missing = definition.dependencies.filter(dependency =>
        not(graph.tickets.keys().contains(dependency)))
      if (missing != Set()) refused(DependenciesNotFound({
        ticket: definition.id,
        dependencies: missing,
      }))
      else decided(TicketCreated(definition), [])
    }

  pure def decideUpdate(
    graph: TicketGraph,
    update: {
      ticket: int,
      expectedRevision: int,
      definition: ReleasedTicket
    },
  ): TicketDecision = {
    val ticketId = update.ticket
    if (not(graph.tickets.keys().contains(ticketId)))
      refused(TicketNotFound(ticketId))
    else {
      val ticket = graph.tickets.get(ticketId)
      if (not(isPending(ticket.state))) refused(TicketNotPending(ticketId))
      else if (update.definition.id != ticketId)
        refused(TicketIdentityMismatch(ticketId))
      else if (update.expectedRevision != ticket.revision)
        refused(TicketRevisionStale({
          ticket: ticketId,
          expected: update.expectedRevision,
          current: ticket.revision,
        }))
      else if (update.definition.dependencies != ticket.definition.dependencies)
        refused(TicketDependenciesChanged(ticketId))
      else decided(TicketUpdated({
        ticket: ticketId,
        revision: ticket.revision + 1,
        definition: update.definition,
      }), [])
    }
  }

  pure def decideDispatch(
    graph: TicketGraph,
    dispatch: { ticket: int, source: int },
  ): TicketDecision = {
    val ticketId = dispatch.ticket
    if (not(graph.tickets.keys().contains(ticketId)))
      refused(TicketNotFound(ticketId))
    else {
      val ticket = graph.tickets.get(ticketId)
      if (not(isPending(ticket.state))) refused(TicketNotPending(ticketId))
      else {
        val incomplete = incompleteDependencies(graph, ticket)
        if (incomplete != Set()) refused(DependenciesIncomplete({
          ticket: ticketId,
          dependencies: incomplete,
        }))
        else {
          decided(
            TicketDispatched(dispatch),
            [executeWork(
              ticket,
              nextCycleNumber(ticket),
              dispatch.source,
              initialWorkInput(ticket.definition),
            )],
          )
        }
      }
    }
  }

  pure def decideRevoke(
    graph: TicketGraph,
    ticketId: int,
  ): TicketDecision =
    if (not(graph.tickets.keys().contains(ticketId)))
      refused(TicketNotFound(ticketId))
    else {
      val ticket = graph.tickets.get(ticketId)
      if (not(revocationAllowed(ticket.state)))
        refused(TicketNotRevocable(ticketId))
      else decided(
        TicketRevoked(ticketId),
        cancelLiveTasks(ticket),
      )
    }

  pure def decideResume(
    graph: TicketGraph,
    ticketId: int,
  ): TicketDecision =
    if (not(graph.tickets.keys().contains(ticketId)))
      refused(TicketNotFound(ticketId))
    else {
      val ticket = graph.tickets.get(ticketId)
      match ticket.state {
        | Escalated(escalation) => match escalation {
            | WorkFailureEscalated(failure) => decided(
                TicketWorkResumed(ticketId),
                [executeWork(
                  ticket,
                  nextCycleNumber(ticket),
                  failure.source,
                  failure.resumeInput,
                )],
              )
            | WorkExecutionUnavailableEscalated(failure) => decided(
                TicketWorkResumed(ticketId),
                [executeWork(
                  ticket,
                  nextCycleNumber(ticket),
                  failure.source,
                  failure.resumeInput,
                )],
              )
            | EvaluationFailureEscalated(failure) => decided(
                TicketWorkResumed(ticketId),
                [executeWork(
                  ticket,
                  nextCycleNumber(ticket),
                  failure.source,
                  evaluationReworkInput(ticket.definition, failure.evidence),
                )],
              )
            | EvaluationBlockedEscalated(saved) => {
                val resumed = resumeBlocked(saved)
                decided(
                  TicketEvaluationResumed(ticketId),
                  executeEvaluationTasks(ticketId, resumed),
                )
              }
            | FinalizationUnavailableEscalated(failure) => decided(
                TicketFinalizationResumed(ticketId),
                [finalize(ticket, resumedFinalization(failure.finalization))],
              )
          }
        | _ => refused(TicketNotResumable(ticketId))
      }
    }

  pure def decideWorkTerminal(
    ticket: Ticket,
    report: TaskTerminalReport,
  ): TicketDecision = match report {
    | WorkResultReport(produced) => {
        val evaluation = begin(ticket.workCyclesStarted, {
          ticket: ticket.definition.id,
          workResult: produced.result.resultRef,
          acceptedSourceRef: produced.acceptedSourceRef,
        }, ticket.definition.evaluationPlan)
        decided(TicketWorkResultAccepted({
          ticket: produced.ticket,
          result: produced.result,
          acceptedSourceRef: produced.acceptedSourceRef,
        }), executeEvaluationTasks(produced.ticket, evaluation))
      }
    | TerminalFailureReport(failure) => match failure.kind {
        | ProcessFailure => decided(TicketWorkProcessFailed({
            ticket: failure.ticket,
            task: failure.failure.task,
            evidence: failure.failure.evidence,
          }), [])
        | ExecutionUnavailableFailure => decided(TicketWorkExecutionUnavailable({
            ticket: failure.ticket,
            task: failure.failure.task,
            evidence: failure.failure.evidence,
          }), [])
      }
    | EvaluationResultReport(evaluation) => refused(TaskNotCurrent({
        ticket: evaluation.ticket,
        task: evaluation.result.obligation.task,
      }))
  }

  pure def runningStageIndex(evaluation: EvaluationInstance): int =
    match evaluation.state {
      | Running(progress) => progress.stage.stageIndex
      | _ => -1
    }

  pure def decideEvaluationTerminal(
    ticket: Ticket,
    evaluation: EvaluationInstance,
    report: TaskTerminalReport,
    failurePolicy: EvaluationFailurePolicy,
  ): TicketDecision = {
    val priorStage = runningStageIndex(evaluation)
    val updated = applyEvaluationReport(evaluation, report)
    match updated.state {
      | Running(progress) => {
          val obligations = if (progress.stage.stageIndex == priorStage) []
            else executeEvaluationTasks(reportTicket(report), updated)
          decided(TicketEvaluationProgressed({
            ticket: reportTicket(report),
            report: report,
          }), obligations)
        }
      | EvaluationPassed(_) => {
          val finalization = {
            workCycle: updated.workCycle,
            generation: 1,
            input: updated.input.workResult,
            source: updated.input.acceptedSourceRef,
          }
          decided(TicketEvaluationPassed({
            ticket: reportTicket(report),
            report: report,
          }), [finalize(ticket, finalization)])
        }
      | EvaluationFailed(completedStages) => {
          val entries = reworkEntries(updated, completedStages)
          match failurePolicy(updated) {
            | ReworkEvaluationFailure => decided(
                TicketEvaluationReworkStarted({
                  ticket: reportTicket(report),
                  report: report,
                  evidence: entries,
                }),
                [executeWork(
                  ticket,
                  nextCycleNumber(ticket),
                  updated.input.acceptedSourceRef,
                  evaluationReworkInput(ticket.definition, entries),
                )],
              )
            | EscalateEvaluationFailure => decided(
                TicketEvaluationFailureEscalated({
                  ticket: reportTicket(report),
                  report: report,
                  evidence: entries,
                }),
                [],
              )
          }
        }
      | EvaluationBlocked(_) => {
          decided(TicketEvaluationBlocked({
            ticket: reportTicket(report),
            report: report,
          }), [])
        }
    }
  }

  pure def decideTaskTerminal(
    graph: TicketGraph,
    report: TaskTerminalReport,
    failurePolicy: EvaluationFailurePolicy,
  ): TicketDecision =
    if (not(graph.tickets.keys().contains(reportTicket(report))))
      refused(TicketNotFound(reportTicket(report)))
    else {
      val ticket = graph.tickets.get(reportTicket(report))
      val task = reportTask(report)
      match ticket.state {
        | Work(work) => if (
            workTaskIdentity(
              ticket.definition.id,
              ticket.workCyclesStarted,
            ) == task
            and match report {
              | WorkResultReport(produced) => produced.result.obligation ==
                  workTaskObligation(ticket, ticket.workCyclesStarted, work.source, work.input)
              | TerminalFailureReport(_) => true
              | EvaluationResultReport(_) => false
            })
            decideWorkTerminal(ticket, report)
          else refused(TaskNotCurrent({
            ticket: reportTicket(report),
            task: task,
          }))
        | Evaluation(evaluation) => if (taskCurrent(evaluation, task)
            and match report {
              | EvaluationResultReport(produced) =>
                  currentTaskObligations(evaluation).select(obligation =>
                    obligation == produced.result.obligation).length() > 0
              | TerminalFailureReport(_) => true
              | WorkResultReport(_) => false
            })
            decideEvaluationTerminal(
              ticket,
              evaluation,
              report,
              failurePolicy,
            )
          else refused(TaskNotCurrent({
            ticket: reportTicket(report),
            task: task,
          }))
        | _ => refused(TaskNotCurrent({
            ticket: reportTicket(report),
            task: task,
          }))
      }
    }

  pure def decideFinalizationResult(
    graph: TicketGraph,
    report: FinalizationResultReport,
  ): TicketDecision =
    if (not(graph.tickets.keys().contains(report.ticket)))
      refused(TicketNotFound(report.ticket))
    else {
      val ticket = graph.tickets.get(report.ticket)
      match ticket.state {
        | Finalization(finalization) =>
            if (not(finalizationCurrent(
                finalization,
                report.workCycle,
                report.generation,
              )))
              refused(FinalizationNotCurrent({
                ticket: report.ticket,
                workCycle: report.workCycle,
                generation: report.generation,
              }))
            else match report.result {
              | FinalizationSucceeded(evidence) => decided(
                  TicketFinalizationSucceeded({
                    ticket: report.ticket,
                    workCycle: report.workCycle,
                    generation: report.generation,
                    evidence: evidence,
                  }),
                  [],
                )
              | FinalizationNeedsWork(evidence) => decided(
                  TicketFinalizationNeedsWork({
                    ticket: report.ticket,
                    workCycle: report.workCycle,
                    generation: report.generation,
                    evidence: evidence,
                  }),
                  [executeWork(
                    ticket,
                    nextCycleNumber(ticket),
                    finalization.source,
                    finalizationReworkInput(ticket.definition, evidence),
                  )],
                )
              | FinalizationResultUnavailable(evidence) => decided(
                  TicketFinalizationUnavailable({
                    ticket: report.ticket,
                    workCycle: report.workCycle,
                    generation: report.generation,
                    evidence: evidence,
                  }),
                  [],
                )
            }
          | _ => refused(FinalizationNotCurrent({
            ticket: report.ticket,
            workCycle: report.workCycle,
            generation: report.generation,
          }))
      }
    }

  pure def decide(
    graph: TicketGraph,
    command: TicketCommand,
    failurePolicy: EvaluationFailurePolicy,
  ): TicketDecision = match command {
    | CreateTicket(definition) => decideCreate(graph, definition)
    | UpdateTicket(update) => decideUpdate(graph, update)
    | DispatchTicket(ticket) => decideDispatch(graph, ticket)
    | RevokeTicket(ticket) => decideRevoke(graph, ticket)
    | ResumeTicket(ticket) => decideResume(graph, ticket)
    | ReportTaskTerminal(report) =>
        decideTaskTerminal(graph, report, failurePolicy)
    | ReportFinalizationResult(report) =>
        decideFinalizationResult(graph, report)
  }

  pure def updateTicket(
    graph: TicketGraph,
    ticketId: int,
    ticket: Ticket,
  ): TicketGraph = {
    ...graph,
    tickets: graph.tickets.set(ticketId, ticket),
  }

  pure def enterWorkCycle(
    graph: TicketGraph,
    ticket: Ticket,
    input: WorkInput,
    source: int,
  ): TicketGraph = updateTicket(graph, ticket.definition.id, {
    ...ticket,
    workCyclesStarted: nextCycleNumber(ticket),
    state: Work({ input: input, source: source }),
  })

  pure def evolve(
    graph: TicketGraph,
    fact: TicketEvent,
  ): TicketGraph = match (fact) {
    | TicketCreated(definition) =>
        if (graph.tickets.keys().contains(definition.id)) graph
        else {
          ...graph,
          tickets: graph.tickets.put(definition.id, {
            definition: definition,
            revision: 1,
            workCyclesStarted: 0,
            state: Pending,
          }),
        }
    | TicketUpdated(update) => {
        val ticketId = update.ticket
        if (not(graph.tickets.keys().contains(ticketId))) graph
        else {
          val ticket = graph.tickets.get(ticketId)
          if (not(isPending(ticket.state))) graph
          else if (update.revision != ticket.revision + 1) graph
          else updateTicket(graph, ticketId, {
            ...ticket,
            definition: update.definition,
            revision: update.revision,
          })
        }
      }
    | TicketDispatched(dispatch) => {
        val ticketId = dispatch.ticket
        val ticket = graph.tickets.get(ticketId)
        match ticket.state {
          | Pending =>
              enterWorkCycle(graph, ticket, initialWorkInput(ticket.definition), dispatch.source)
          | _ => graph
        }
      }
    | TicketRevoked(ticketId) => {
        val ticket = graph.tickets.get(ticketId)
        if (revocationAllowed(ticket.state))
          updateTicket(graph, ticketId, { ...ticket, state: Revoked })
        else graph
      }
    | TicketWorkResumed(ticketId) => {
        val ticket = graph.tickets.get(ticketId)
        match ticket.state {
          | Escalated(escalation) => match escalation {
              | WorkFailureEscalated(failure) =>
                  enterWorkCycle(graph, ticket, failure.resumeInput, failure.source)
              | WorkExecutionUnavailableEscalated(failure) =>
                  enterWorkCycle(graph, ticket, failure.resumeInput, failure.source)
              | EvaluationFailureEscalated(failure) => enterWorkCycle(
                  graph,
                  ticket,
                  evaluationReworkInput(ticket.definition, failure.evidence),
                  failure.source,
                )
              | _ => graph
            }
          | _ => graph
        }
      }
    | TicketEvaluationResumed(ticketId) => {
        val ticket = graph.tickets.get(ticketId)
        match ticket.state {
          | Escalated(escalation) => match escalation {
              | EvaluationBlockedEscalated(saved) =>
                  updateTicket(graph, ticketId, {
                    ...ticket,
                    state: Evaluation(resumeBlocked(saved)),
                  })
              | _ => graph
            }
          | _ => graph
        }
      }
    | TicketFinalizationResumed(ticketId) => {
        val ticket = graph.tickets.get(ticketId)
        match ticket.state {
          | Escalated(escalation) => match escalation {
              | FinalizationUnavailableEscalated(failure) =>
                  updateTicket(graph, ticketId, {
                    ...ticket,
                    state: Finalization(
                      resumedFinalization(failure.finalization),
                    ),
                  })
              | _ => graph
            }
          | _ => graph
        }
      }
    | TicketWorkResultAccepted(accepted) => {
        val ticket = graph.tickets.get(accepted.ticket)
        match ticket.state {
          | Work(work) => if (accepted.result.obligation ==
              workTaskObligation(ticket, ticket.workCyclesStarted, work.source, work.input)) {
              val evaluation = begin(ticket.workCyclesStarted, {
                ticket: accepted.ticket,
                workResult: accepted.result.resultRef,
                acceptedSourceRef: accepted.acceptedSourceRef,
              }, ticket.definition.evaluationPlan)
              updateTicket(graph, accepted.ticket, {
                ...ticket,
                state: Evaluation(evaluation),
              })
            } else graph
          | _ => graph
        }
      }
    | TicketWorkProcessFailed(failure) => {
        val ticket = graph.tickets.get(failure.ticket)
        match ticket.state {
          | Work(work) => updateTicket(graph, failure.ticket, {
              ...ticket,
              state: Escalated(WorkFailureEscalated({
                resumeInput: retryWorkInput(work.input, failure.evidence),
                source: work.source,
                evidence: failure.evidence,
              })),
            })
          | _ => graph
        }
      }
    | TicketWorkExecutionUnavailable(failure) => {
        val ticket = graph.tickets.get(failure.ticket)
        match ticket.state {
          | Work(work) => updateTicket(graph, failure.ticket, {
              ...ticket,
              state: Escalated(WorkExecutionUnavailableEscalated({
                resumeInput: retryWorkInput(work.input, failure.evidence),
                source: work.source,
                evidence: failure.evidence,
              })),
            })
          | _ => graph
        }
      }
    | TicketEvaluationProgressed(progress) => {
        val ticket = graph.tickets.get(progress.ticket)
        match ticket.state {
          | Evaluation(current) =>
              if (not(reportAdmissible(current, progress.report))) graph
              else {
                val evaluation = applyEvaluationReport(current, progress.report)
                match evaluation.state {
                  | Running(_) => updateTicket(graph, progress.ticket, {
                      ...ticket,
                      state: Evaluation(evaluation),
                    })
                  | _ => graph
                }
              }
          | _ => graph
        }
      }
    | TicketEvaluationPassed(progress) => {
        val ticket = graph.tickets.get(progress.ticket)
        match ticket.state {
          | Evaluation(current) =>
              if (not(reportAdmissible(current, progress.report))) graph
              else {
                val evaluation = applyEvaluationReport(current, progress.report)
                match evaluation.state {
                  | EvaluationPassed(_) => updateTicket(graph, progress.ticket, {
                      ...ticket,
                      state: Finalization({
                        workCycle: evaluation.workCycle,
                        generation: 1,
                        input: evaluation.input.workResult,
                        source: evaluation.input.acceptedSourceRef,
                      }),
                    })
                  | _ => graph
                }
              }
          | _ => graph
        }
      }
    | TicketEvaluationReworkStarted(rework) => {
        val ticket = graph.tickets.get(rework.ticket)
        match ticket.state {
          | Evaluation(evaluation) =>
              if (not(reportAdmissible(evaluation, rework.report))) graph
              else match applyEvaluationReport(evaluation, rework.report).state {
                | EvaluationFailed(_) => enterWorkCycle(
                    graph,
                    ticket,
                    evaluationReworkInput(ticket.definition, rework.evidence),
                    evaluation.input.acceptedSourceRef,
                  )
                | _ => graph
              }
          | _ => graph
        }
      }
    | TicketEvaluationFailureEscalated(failure) => {
        val ticket = graph.tickets.get(failure.ticket)
        match ticket.state {
          | Evaluation(evaluation) =>
              if (not(reportAdmissible(evaluation, failure.report))) graph
              else match applyEvaluationReport(evaluation, failure.report).state {
                | EvaluationFailed(_) => updateTicket(graph, failure.ticket, {
                    ...ticket,
                    state: Escalated(EvaluationFailureEscalated({
                      evidence: failure.evidence,
                      source: evaluation.input.acceptedSourceRef,
                    })),
                  })
                | _ => graph
              }
          | _ => graph
        }
      }
    | TicketEvaluationBlocked(unavailable) => {
        val ticket = graph.tickets.get(unavailable.ticket)
        match ticket.state {
          | Evaluation(current) =>
              if (not(reportAdmissible(current, unavailable.report))) graph
              else {
                val evaluation = applyEvaluationReport(current, unavailable.report)
                match evaluation.state {
                  | EvaluationBlocked(_) => updateTicket(graph, unavailable.ticket, {
                      ...ticket,
                      state: Escalated(EvaluationBlockedEscalated(evaluation)),
                    })
                  | _ => graph
                }
              }
          | _ => graph
        }
      }
    | TicketFinalizationSucceeded(result) => {
        val ticket = graph.tickets.get(result.ticket)
        match ticket.state {
          | Finalization(finalization) =>
              if (not(finalizationCurrent(
                finalization,
                result.workCycle,
                result.generation,
              ))) graph
              else updateTicket(graph, result.ticket, { ...ticket, state: Done })
          | _ => graph
        }
      }
    | TicketFinalizationNeedsWork(rework) => {
        val ticket = graph.tickets.get(rework.ticket)
        match ticket.state {
          | Finalization(finalization) =>
              if (not(finalizationCurrent(
                finalization,
                rework.workCycle,
                rework.generation,
              ))) graph
              else enterWorkCycle(
                graph,
                ticket,
                finalizationReworkInput(ticket.definition, rework.evidence),
                finalization.source,
              )
          | _ => graph
        }
      }
    | TicketFinalizationUnavailable(unavailable) => {
        val ticket = graph.tickets.get(unavailable.ticket)
        match ticket.state {
          | Finalization(current) =>
              if (not(finalizationCurrent(
                current,
                unavailable.workCycle,
                unavailable.generation,
              ))) graph
              else updateTicket(graph, unavailable.ticket, {
                ...ticket,
                state: Escalated(FinalizationUnavailableEscalated({
                  finalization: current,
                  evidence: unavailable.evidence,
                })),
              })
          | _ => graph
        }
      }
  }

  pure def applyDecision(
    graph: TicketGraph,
    decision: TicketDecision,
  ): TicketGraph = match decision {
    | TicketRefused(_) => graph
    | TicketDecided(success) => evolve(graph, success.event)
  }

  pure def applyCommand(
    graph: TicketGraph,
    command: TicketCommand,
    failurePolicy: EvaluationFailurePolicy,
  ): TicketGraph = applyDecision(
    graph,
    decide(graph, command, failurePolicy),
  )

  pure def workInputValid(input: WorkInput): bool =
    releasedContentValid(input.released)
    and input.retryEvidence.indices().forall(index =>
      input.retryEvidence[index] > 0)
    and match input.cause {
      | InitialWork => true
      | EvaluationRework(entries) =>
          entries.length() > 0
          and entries.indices().forall(index =>
            entries[index].evaluator > 0
            and entries[index].resultRef > 0)
      | FinalizationRework(evidence) => evidence > 0
    }

  pure def workInputMatchesTicket(
    ticket: Ticket,
    input: WorkInput,
  ): bool =
    workInputValid(input)
    and input.released == ticket.definition.content

  pure def escalationValid(ticket: Ticket, escalation: Escalation): bool =
    match escalation {
      | WorkFailureEscalated(failure) =>
          workInputMatchesTicket(ticket, failure.resumeInput)
          and failure.source > 0
          and failure.evidence > 0
      | WorkExecutionUnavailableEscalated(failure) =>
          workInputMatchesTicket(ticket, failure.resumeInput)
          and failure.source > 0
          and failure.evidence > 0
      | EvaluationFailureEscalated(failure) =>
          workInputMatchesTicket(
            ticket,
            evaluationReworkInput(ticket.definition, failure.evidence),
          )
          and failure.source > 0
      | EvaluationBlockedEscalated(evaluation) =>
          invariant(evaluation)
          and evaluation.input.ticket == ticket.definition.id
          and evaluation.workCycle == ticket.workCyclesStarted
          and match evaluation.state {
            | EvaluationBlocked(_) => true
            | _ => false
          }
      | FinalizationUnavailableEscalated(failure) =>
          failure.finalization.workCycle == ticket.workCyclesStarted
          and failure.finalization.generation > 0
          and failure.finalization.input > 0
          and failure.finalization.source > 0
          and failure.evidence > 0
    }

  pure def ticketInvariant(ticket: Ticket): bool =
    releasedTicketValid(ticket.definition)
    and ticket.revision > 0
    and ticket.workCyclesStarted >= 0
    and match ticket.state {
      | Pending => ticket.workCyclesStarted == 0
      | Work(work) =>
          ticket.workCyclesStarted > 0
          and workInputMatchesTicket(ticket, work.input)
          and work.source > 0
      | Evaluation(evaluation) =>
          invariant(evaluation)
          and evaluation.input.ticket == ticket.definition.id
          and evaluation.workCycle == ticket.workCyclesStarted
          and evaluation.input.acceptedSourceRef > 0
          and match evaluation.state {
            | Running(_) => true
            | _ => false
          }
      | Finalization(finalization) =>
          finalization.workCycle == ticket.workCyclesStarted
          and finalization.generation > 0
          and finalization.input > 0
          and finalization.source > 0
      | Escalated(escalation) => escalationValid(ticket, escalation)
      | Done => true
      | Revoked => true
    }

  pure def expandDependencies(
    graph: TicketGraph,
    reached: Set[int],
  ): Set[int] = reached.fold(reached, (found, ticketId) =>
    found.union(graph.tickets.get(ticketId).definition.dependencies))

  pure def dependencyClosure(
    graph: TicketGraph,
    ticketId: int,
  ): Set[int] =
    range(0, graph.tickets.keys().size()).foldl(graph.tickets.get(ticketId)
      .definition.dependencies, (found, _) => expandDependencies(graph, found))

  pure def dependencyGraphAcyclic(graph: TicketGraph): bool =
    graph.tickets.keys().forall(ticketId =>
      not(dependencyClosure(graph, ticketId).contains(ticketId)))

  pure def graphInvariant(graph: TicketGraph): bool =
    graph.tickets.keys().forall(ticketId => {
      val ticket = graph.tickets.get(ticketId)
      ticket.definition.id == ticketId
      and ticketInvariant(ticket)
      and not(ticket.definition.dependencies.contains(ticketId))
      and ticket.definition.dependencies.subseteq(graph.tickets.keys())
    })
    and dependencyGraphAcyclic(graph)

  pure def obligationValid(obligation: Obligation): bool = match obligation {
    | ExecuteTask(execution) =>
        execution.ticket == taskOwner(execution.task.task)
        and taskObligationValid(execution.task)
    | FinalizeTicket(finalization) =>
        finalization.ticket > 0
        and finalization.finalization.workCycle > 0
        and finalization.finalization.generation > 0
        and finalization.configuration > 0
        and finalization.finalization.input > 0
        and finalization.finalization.source > 0
    | CancelTask(cancellation) =>
        cancellation.ticket == taskOwner(cancellation.task)
        and taskIdentityValid(cancellation.task)
  }

  pure def obligationsUnique(obligations: List[Obligation]): bool =
    obligations.indices().forall(left =>
      obligations.indices().forall(right =>
        left == right or obligations[left] != obligations[right]))

  pure def ticketLiveTasks(
    graph: TicketGraph,
    ticketId: int,
  ): List[TaskIdentity] =
    if (graph.tickets.keys().contains(ticketId))
      liveTaskList(graph.tickets.get(ticketId))
    else []

  pure def obligationAgrees(
    prior: TicketGraph,
    evolved: TicketGraph,
    obligation: Obligation,
  ): bool = match obligation {
    | ExecuteTask(execution) =>
        listHasTask(
          ticketLiveTasks(evolved, execution.ticket),
          execution.task.task,
        )
    | CancelTask(cancellation) =>
        listHasTask(
          ticketLiveTasks(prior, cancellation.ticket),
          cancellation.task,
        )
        and not(listHasTask(
          ticketLiveTasks(evolved, cancellation.ticket),
          cancellation.task,
        ))
    | FinalizeTicket(finalization) =>
        evolved.tickets.keys().contains(finalization.ticket)
        and match evolved.tickets.get(finalization.ticket).state {
          | Finalization(operation) => operation == finalization.finalization
          | _ => false
        }
  }

  pure def decisionValid(
    graph: TicketGraph,
    decision: TicketDecision,
  ): bool = match decision {
    | TicketRefused(_) => applyDecision(graph, decision) == graph
    | TicketDecided(success) => {
        val evolved = evolve(graph, success.event)
        success.obligations.indices().forall(index =>
          obligationValid(success.obligations[index])
          and obligationAgrees(graph, evolved, success.obligations[index]))
        and obligationsUnique(success.obligations)
        and graphInvariant(evolved)
      }
  }
}
