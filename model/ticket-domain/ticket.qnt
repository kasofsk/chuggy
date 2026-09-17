module ticket_domain {
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "evaluation/evaluation"

  type ReleasedContent =
    AuthoredReleasedContent({ title: int, instructions: int })
    | LegacyReleasedContent(int)

  type ReleasedWorkInput = {
    content: ReleasedContent,
    inputBindings: int
  }

  type WorkCause =
    InitialWork
    | EvaluationRework(List[EvaluationReworkEntry])
    | FinalizationRework(int)

  type WorkInput = {
    released: ReleasedWorkInput,
    cause: WorkCause,
    retryEvidence: List[int]
  }

  type WorkExecution = { input: WorkInput, source: WorkspaceSource }

  type FinalizationOperation = {
    workCycle: int,
    generation: int,
    input: int,
    source: WorkspaceSource
  }

  type EvaluationFailureDisposition =
    ReworkEvaluationFailure
    | EscalateEvaluationFailure

  type EvaluationFailurePolicy = EvaluationInstance => EvaluationFailureDisposition

  type WorkEscalation = {
    resumeInput: WorkInput,
    source: WorkspaceSource,
    evidence: int
  }

  type EvaluationFailureEscalation = {
    evidence: List[EvaluationReworkEntry],
    source: WorkspaceSource
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
    inputBindings: int,
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

  type TaskTerminalReport = {
    ticket: int,
    terminal: TaskTerminal
  }

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
    | DispatchTicket({ ticket: int, source: WorkspaceSource })
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
    | DispatchSourceRepositoryMismatch(int)
    | DependenciesIncomplete(IncompleteDependencies)
    | TicketNotRevocable(int)
    | TicketNotResumable(int)
    | TaskNotCurrent(CurrentTaskRefusal)
    | WorkResultMissingExactGitOutput(int)
    | FinalizationNotCurrent(CurrentFinalizationRefusal)

  type TaskTerminalFact = {
    ticket: int,
    terminal: TaskTerminal
  }

  type EvaluationReworkFact = {
    ticket: int,
    terminal: TaskTerminal,
    evidence: List[EvaluationReworkEntry]
  }

  type WorkResultAcceptedEvent = {
    ticket: int,
    result: ValidatedTaskResult
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
    | TicketDispatched({ ticket: int, source: WorkspaceSource })
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
    and definition.inputBindings > 0
    and definition.dependencies.forall(dependency => dependency > 0)
    and taskDefinitionValid(definition.workConfiguration)
    and planValid(definition.evaluationPlan)
    and planUsesRepository(
      definition.evaluationPlan,
      definition.workConfiguration.executionRequirements.repository,
    )
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
    | DispatchTicket(dispatch) => dispatch.ticket > 0
        and dispatch.source.repository > 0
        and dispatch.source.commit > 0
    | ReportTaskTerminal(report) => terminalValid(report.terminal)
    | ReportFinalizationResult(report) => report.ticket > 0
        and report.workCycle > 0
        and report.generation > 0
        and finalizationResultValid(report.result)
    | _ => true
  }

  pure def workTaskIdentity(ticket: int, cycle: int): TaskIdentity =
    WorkTask({ ticket: ticket, cycle: cycle })

  pure def releasedWorkInput(definition: ReleasedTicket): ReleasedWorkInput = {
    content: definition.content,
    inputBindings: definition.inputBindings,
  }

  pure def releasedContentValid(content: ReleasedContent): bool = match content {
    | AuthoredReleasedContent(authored) =>
        authored.title > 0 and authored.instructions > 0
    | LegacyReleasedContent(legacy) => legacy > 0
  }

  pure def initialWorkInput(definition: ReleasedTicket): WorkInput = {
    released: releasedWorkInput(definition),
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
    released: releasedWorkInput(definition),
    cause: EvaluationRework(entries),
    retryEvidence: [],
  }

  pure def finalizationReworkInput(
    definition: ReleasedTicket,
    evidence: int,
  ): WorkInput = {
    released: releasedWorkInput(definition),
    cause: FinalizationRework(evidence),
    retryEvidence: [],
  }

  pure def workContext(input: WorkInput): List[int] =
    (match input.released.content {
      | AuthoredReleasedContent(authored) => [authored.title, authored.instructions]
      | LegacyReleasedContent(legacy) => [legacy]
    })
      .append(input.released.inputBindings)
      .concat(match input.cause {
        | InitialWork => []
        | EvaluationRework(entries) =>
            entries.foldl([], (manifests, entry) =>
              manifests.append(entry.resultManifest))
        | FinalizationRework(evidence) => [evidence]
      })
      .concat(input.retryEvidence)

  pure def workTaskObligation(
    ticket: Ticket,
    cycleNumber: int,
    source: WorkspaceSource,
    input: WorkInput,
  ): TaskObligation = {
    task: workTaskIdentity(ticket.definition.id, cycleNumber),
    definition: ticket.definition.workConfiguration,
    source: source,
    context: workContext(input),
  }

  pure def executeWork(
    ticket: Ticket,
    cycleNumber: int,
    source: WorkspaceSource,
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
    dispatch: { ticket: int, source: WorkspaceSource },
  ): TicketDecision = {
    val ticketId = dispatch.ticket
    if (not(graph.tickets.keys().contains(ticketId)))
      refused(TicketNotFound(ticketId))
    else {
      val ticket = graph.tickets.get(ticketId)
      if (not(isPending(ticket.state))) refused(TicketNotPending(ticketId))
      else if (dispatch.source.repository
        != ticket.definition.workConfiguration.executionRequirements.repository)
        refused(DispatchSourceRepositoryMismatch(ticketId))
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
    work: WorkExecution,
  ): TicketDecision = match report.terminal {
    | TaskResultProduced(result) => {
        val publishes = publishesRepositoryResult(
          ticket.definition.workConfiguration, work.source.repository)
        if (publishes and not(hasExactGitOutput(result)))
          refused(WorkResultMissingExactGitOutput(report.ticket))
        else {
        val evaluation = begin(ticket.workCyclesStarted, {
          ticket: ticket.definition.id,
          workResult: result.manifest,
          acceptedSource: if (publishes) exactGitOutput(result) else work.source,
        }, ticket.definition.evaluationPlan)
        decided(TicketWorkResultAccepted({
          ticket: report.ticket,
          result: result,
        }), executeEvaluationTasks(report.ticket, evaluation))
        }
      }
    | TaskProcessFailed(failure) => {
        decided(TicketWorkProcessFailed({
          ticket: report.ticket,
          task: failure.task,
          evidence: failure.evidence,
        }), [])
      }
    | TaskExecutionUnavailable(failure) => {
        decided(TicketWorkExecutionUnavailable({
          ticket: report.ticket,
          task: failure.task,
          evidence: failure.evidence,
        }), [])
      }
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
    val task = terminalTask(report.terminal)
    val priorStage = runningStageIndex(evaluation)
    val updated = applyTerminal(evaluation, task, report.terminal)
    match updated.state {
      | Running(progress) => {
          val obligations = if (progress.stage.stageIndex == priorStage) []
            else executeEvaluationTasks(report.ticket, updated)
          decided(TicketEvaluationProgressed({
            ticket: report.ticket,
            terminal: report.terminal,
          }), obligations)
        }
      | EvaluationPassed(_) => {
          val finalization = {
            workCycle: updated.workCycle,
            generation: 1,
            input: updated.input.workResult,
            source: updated.input.acceptedSource,
          }
          decided(TicketEvaluationPassed({
            ticket: report.ticket,
            terminal: report.terminal,
          }), [finalize(ticket, finalization)])
        }
      | EvaluationFailed(completedStages) => {
          val entries = reworkEntries(updated, completedStages)
          match failurePolicy(updated) {
            | ReworkEvaluationFailure => decided(
                TicketEvaluationReworkStarted({
                  ticket: report.ticket,
                  terminal: report.terminal,
                  evidence: entries,
                }),
                [executeWork(
                  ticket,
                  nextCycleNumber(ticket),
                  updated.input.acceptedSource,
                  evaluationReworkInput(ticket.definition, entries),
                )],
              )
            | EscalateEvaluationFailure => decided(
                TicketEvaluationFailureEscalated({
                  ticket: report.ticket,
                  terminal: report.terminal,
                  evidence: entries,
                }),
                [],
              )
          }
        }
      | EvaluationBlocked(_) => {
          decided(TicketEvaluationBlocked({
            ticket: report.ticket,
            terminal: report.terminal,
          }), [])
        }
    }
  }

  pure def decideTaskTerminal(
    graph: TicketGraph,
    report: TaskTerminalReport,
    failurePolicy: EvaluationFailurePolicy,
  ): TicketDecision =
    if (not(graph.tickets.keys().contains(report.ticket)))
      refused(TicketNotFound(report.ticket))
    else {
      val ticket = graph.tickets.get(report.ticket)
      val task = terminalTask(report.terminal)
      match ticket.state {
        | Work(work) => if (
            workTaskIdentity(
              ticket.definition.id,
              ticket.workCyclesStarted,
            ) == task)
            decideWorkTerminal(ticket, report, work)
          else refused(TaskNotCurrent({
            ticket: report.ticket,
            task: task,
          }))
        | Evaluation(evaluation) => if (taskCurrent(evaluation, task))
            decideEvaluationTerminal(
              ticket,
              evaluation,
              report,
              failurePolicy,
            )
          else refused(TaskNotCurrent({
            ticket: report.ticket,
            task: task,
          }))
        | _ => refused(TaskNotCurrent({
            ticket: report.ticket,
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
            if (finalization.workCycle != report.workCycle
              or finalization.generation != report.generation)
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
    source: WorkspaceSource,
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
          | Work(work) => {
              val evaluation = begin(ticket.workCyclesStarted, {
                ticket: accepted.ticket,
                workResult: accepted.result.manifest,
                acceptedSource: if (publishesRepositoryResult(
                  ticket.definition.workConfiguration, work.source.repository))
                  exactGitOutput(accepted.result) else work.source,
              }, ticket.definition.evaluationPlan)
              updateTicket(graph, accepted.ticket, {
                ...ticket,
                state: Evaluation(evaluation),
              })
            }
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
          | Evaluation(current) => updateTicket(graph, progress.ticket, {
              ...ticket,
              state: Evaluation(applyTerminal(
                current,
                terminalTask(progress.terminal),
                progress.terminal,
              )),
            })
          | _ => graph
        }
      }
    | TicketEvaluationPassed(progress) => {
        val ticket = graph.tickets.get(progress.ticket)
        match ticket.state {
          | Evaluation(current) => {
              val evaluation = applyTerminal(
                current,
                terminalTask(progress.terminal),
                progress.terminal,
              )
              updateTicket(graph, progress.ticket, {
                ...ticket,
                state: Finalization({
                  workCycle: evaluation.workCycle,
                  generation: 1,
                  input: evaluation.input.workResult,
                  source: evaluation.input.acceptedSource,
                }),
              })
            }
          | _ => graph
        }
      }
    | TicketEvaluationReworkStarted(rework) => {
        val ticket = graph.tickets.get(rework.ticket)
        match ticket.state {
          | Evaluation(evaluation) => enterWorkCycle(
              graph,
              ticket,
              evaluationReworkInput(ticket.definition, rework.evidence),
              evaluation.input.acceptedSource,
            )
          | _ => graph
        }
      }
    | TicketEvaluationFailureEscalated(failure) => {
        val ticket = graph.tickets.get(failure.ticket)
        match ticket.state {
          | Evaluation(evaluation) => updateTicket(graph, failure.ticket, {
              ...ticket,
              state: Escalated(EvaluationFailureEscalated({
                evidence: failure.evidence,
                source: evaluation.input.acceptedSource,
              })),
            })
          | _ => graph
        }
      }
    | TicketEvaluationBlocked(unavailable) => {
        val ticket = graph.tickets.get(unavailable.ticket)
        match ticket.state {
          | Evaluation(current) => updateTicket(graph, unavailable.ticket, {
              ...ticket,
              state: Escalated(EvaluationBlockedEscalated(
                applyTerminal(
                  current,
                  terminalTask(unavailable.terminal),
                  unavailable.terminal,
                ),
              )),
            })
          | _ => graph
        }
      }
    | TicketFinalizationSucceeded(result) => {
        val ticket = graph.tickets.get(result.ticket)
        match ticket.state {
          | Finalization(_) =>
              updateTicket(graph, result.ticket, { ...ticket, state: Done })
          | _ => graph
        }
      }
    | TicketFinalizationNeedsWork(rework) => {
        val ticket = graph.tickets.get(rework.ticket)
        match ticket.state {
          | Finalization(finalization) => enterWorkCycle(
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
          | Finalization(current) => updateTicket(graph, unavailable.ticket, {
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
    releasedContentValid(input.released.content)
    and input.released.inputBindings > 0
    and input.retryEvidence.indices().forall(index =>
      input.retryEvidence[index] > 0)
    and match input.cause {
      | InitialWork => true
      | EvaluationRework(entries) =>
          entries.length() > 0
          and entries.indices().forall(index =>
            entries[index].evaluator > 0
            and entries[index].resultManifest > 0)
      | FinalizationRework(evidence) => evidence > 0
    }

  pure def workInputMatchesTicket(
    ticket: Ticket,
    input: WorkInput,
  ): bool =
    workInputValid(input)
    and input.released == releasedWorkInput(ticket.definition)

  pure def escalationValid(ticket: Ticket, escalation: Escalation): bool =
    match escalation {
      | WorkFailureEscalated(failure) =>
          workInputMatchesTicket(ticket, failure.resumeInput)
          and failure.source.repository
            == ticket.definition.workConfiguration.executionRequirements.repository
          and failure.source.commit > 0
          and failure.evidence > 0
      | WorkExecutionUnavailableEscalated(failure) =>
          workInputMatchesTicket(ticket, failure.resumeInput)
          and failure.source.repository
            == ticket.definition.workConfiguration.executionRequirements.repository
          and failure.source.commit > 0
          and failure.evidence > 0
      | EvaluationFailureEscalated(failure) =>
          workInputMatchesTicket(
            ticket,
            evaluationReworkInput(ticket.definition, failure.evidence),
          )
          and failure.source.repository
            == ticket.definition.workConfiguration.executionRequirements.repository
          and failure.source.commit > 0
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
          and failure.finalization.source.repository
            == ticket.definition.workConfiguration.executionRequirements.repository
          and failure.finalization.source.commit > 0
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
          and work.source.repository
            == ticket.definition.workConfiguration.executionRequirements.repository
          and work.source.commit > 0
      | Evaluation(evaluation) =>
          invariant(evaluation)
          and evaluation.input.ticket == ticket.definition.id
          and evaluation.workCycle == ticket.workCyclesStarted
          and evaluation.input.acceptedSource.repository
            == ticket.definition.workConfiguration.executionRequirements.repository
      | Finalization(finalization) =>
          finalization.workCycle == ticket.workCyclesStarted
          and finalization.generation > 0
          and finalization.input > 0
          and finalization.source.repository
            == ticket.definition.workConfiguration.executionRequirements.repository
          and finalization.source.commit > 0
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
        and finalization.finalization.source.repository > 0
        and finalization.finalization.source.commit > 0
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
