/// THE TICKET RECORD — what a ticket IS, the vocabulary every layer speaks
/// about one, and the task plumbing the machine and its tests share.
///
/// Nothing here reads a const: domain.qnt is the machine, refinement.qnt is
/// one runtime shape for it, and both are pure functions of the
/// `TicketGraph` this file declares.
///
/// THE FIRST BLOCK IS THE PACKAGE'S. Everything between the two markers
/// below is the package's `ticket.qnt` at pin 76c95a9, verbatim from its
/// `ReleasedContent` to its `cancelLiveTasks`; domain.qnt holds the rest of
/// that file, from `decideCreate` on, the same way (model/AGENTS.md). Chuggy
/// states no definition of its own under a name the package defines.
///
/// WHAT CHUGGY ADDS BELOW THE BLOCK is what the package's ticket forgets and
/// chuggy still reads: the LEDGER beside each ticket (the instances that have
/// closed, the mint counter, the completion ghost), the resume point the desk
/// offers, the artifact a dependent reads, and the model-scope references the
/// walks draw from. None of it is read by `decide` or moved by `evolve`.
///
/// Sum-type constructors share one namespace per module, which is what the
/// prefixed names below are avoiding.
module chuggy_ticket {
  import task_contract.* from "./task-contract/task"
  import evaluation_protocol.* from "./ticket-domain/evaluation/evaluation"

  // === The package's ticket.qnt, verbatim: ReleasedContent .. cancelLiveTasks
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
  // === End of the package's text ==========================================

  // === The desk and the projection ========================================

  /// Where an operator Retry resumes a parked ticket. DERIVED from the wall
  /// (resumeOf below), never stored: a resume point beside the wall that
  /// implies it is a stored duplicate of a derivable fact (standing rule 3).
  /// NoResume belongs to the unparked ticket, which has nothing to offer the
  /// desk.
  ///
  /// ResumeRework is the evaluation-failure wall's: that wall is reached by a
  /// VERDICT, and a verdict has no re-judge to offer, so the only honest way
  /// on is a new artifact, which is a work cycle. ResumeEvaluation is the
  /// blocked wall's, and it is the one resume that re-asks rather than
  /// re-works.
  type Resume =
    NoResume | ResumeWork | ResumeRework | ResumeEvaluation |
    ResumeFinalization

  /// WHERE EACH WALL RESUMES, total on the state, so every park offers the
  /// desk exactly one way on and every other state offers none. The two work
  /// walls share ResumeWork and the evaluation-failure wall takes
  /// ResumeRework: all three buy a new artifact, and only the names of the
  /// walls they answer differ.
  pure def resumeOf(state: TicketState): Resume = match state {
    | Escalated(escalation) => match escalation {
        | WorkFailureEscalated(_) => ResumeWork
        | WorkExecutionUnavailableEscalated(_) => ResumeWork
        | EvaluationFailureEscalated(_) => ResumeRework
        | EvaluationBlockedEscalated(_) => ResumeEvaluation
        | FinalizationUnavailableEscalated(_) => ResumeFinalization
      }
    | _ => NoResume
  }

  /// Standing rule 3 (derive, don't store): a desk task is open exactly while
  /// the ticket is parked, and Escalated is THE parked state. Revoked is
  /// deliberately not here: revocation is the author's settled choice, and
  /// the desk owes a revoked ticket nothing, exactly like Done.
  pure def hasOpenHumanTask(ticket: Ticket): bool = isEscalated(ticket.state)

  /// WHAT A TICKET PRODUCED (design 002): an opaque identity for the thing
  /// work built, that evaluation judged, and that wrap-up commits. Its only
  /// modelled property is DISTINCTNESS — never content. It exists so a
  /// dependent can NAME what its dependency produced. DERIVED (artifactOf),
  /// never stored.
  type ArtifactMark = NoArtifact | ProducedArtifact(int)

  /// THE MACHINE'S LAST DECISION, as the golden traces record it: none before
  /// the first, and after it the last one taken — an accepted command's
  /// event and obligations, or a refused command's refusal.
  type LastDecision =
    NoDecision
    | Decided(SuccessfulTicketDecision)
    | Refused(TicketRefusal)

  // === The ledger ==========================================================

  /// WHAT THE PACKAGE'S TICKET FORGETS AND CHUGGY STILL READS, one per ticket
  /// beside the graph. `decide` never reads it and `evolve` never moves it:
  /// domain.qnt ledgerStep folds it from the ticket before an event, the
  /// event, and the ledger before, so a replay folds graph and ledger from the
  /// same rows and nothing is derived from a journal at read time.
  ///
  /// It keeps the instances that have CLOSED and not the open one, because
  /// the open one is already on the ticket's state (Evaluation, or the
  /// blocked wall), and a second copy of it here would be a stored duplicate
  /// (standing rule 3). An instance closes when the ticket leaves it: on a
  /// pass, on a failure either way, and on a revoke, and it never changes
  /// again. What reads the closed ones: the rework cap (a failed judgement
  /// that bought a later cycle), the artifact a Done ticket committed, and
  /// the identity accounting.
  ///
  /// `spawned` is THE MINT COUNTER: how many task slots this ticket has ever
  /// claimed. A work spawn claims one; an evaluation spawn claims one per
  /// evaluator the run LISTS, whether this generation asks all of them or
  /// only the ones a resume reopened. It is monotone and never reused, which
  /// is what an implementation mints an external task number from, and it is
  /// held against the instances by the identity-accounting invariant
  /// (domain.qnt idsAccounted).
  ///
  /// `completions` is a GHOST: finalization successes ever applied to this
  /// ticket, the counter the exactly-one-completion invariant reads. Not
  /// implementation state.
  type TicketLedger = {
    closedEvaluations: List[EvaluationInstance],
    spawned: int,
    completions: int
  }

  /// A released ticket's ledger: nothing judged, nothing claimed.
  pure val emptyLedger: TicketLedger =
    { closedEvaluations: [], spawned: 0, completions: 0 }

  /// THE INSTANCE A STATE HOLDS OPEN: the one judging, or the one the
  /// blocked wall saved. At most one; every other state holds none.
  pure def heldInstances(state: TicketState): List[EvaluationInstance] =
    match state {
      | Evaluation(evaluation) => [evaluation]
      | Escalated(escalation) => match escalation {
          | EvaluationBlockedEscalated(saved) => [saved]
          | _ => []
        }
      | _ => []
    }

  /// EVERY INSTANCE THIS TICKET HAS OPENED, in the order its cycles ran: the
  /// closed ones, then the open one if there is one.
  pure def ledgerInstances(
      ticket: Ticket, ledger: TicketLedger): List[EvaluationInstance] =
    ledger.closedEvaluations.concat(heldInstances(ticket.state))

  /// EVERY RUN AN INSTANCE HOLDS, completed and current — the whole of what
  /// it has asked for. A terminal state's list already holds the run that
  /// ended it (evaluation.qnt concludeStage appends before it decides), so
  /// only the two open states add their current run.
  pure def instanceRuns(evaluation: EvaluationInstance): List[StageRun] =
    match evaluation.state {
      | Running(progress) => progress.completedStages.append(progress.stage)
      | EvaluationBlocked(progress) =>
        progress.completedStages.append(progress.stage)
      | EvaluationPassed(completedStages) => completedStages
      | EvaluationFailed(completedStages) => completedStages
    }

  /// EVERY TASK IDENTITY AN INSTANCE HAS NAMED at the generation its runs
  /// now stand at. The generations a resume left behind are deliberately not
  /// named: an event about an earlier generation's task is one nothing owes.
  pure def instanceTasks(evaluation: EvaluationInstance): Set[TaskIdentity] =
    instanceRuns(evaluation).foldl(Set(), (found, progress) =>
      found.union(progress.evaluators.keys().map(evaluator =>
        taskIdentityFor(evaluation, progress, evaluator))))

  /// THE SLOTS A RUN CLAIMED: its roster once per generation it has reached.
  /// A resume re-asks only the evaluators it reopened but claims the roster
  /// again, which is what makes the count a function of the run alone.
  pure def runSpawnTotal(progress: StageRun): int =
    progress.generation * progress.evaluators.keys().size()

  /// THE SLOTS A LIST OF INSTANCES CLAIMED — the evaluation half of the mint
  /// counter, derived from the instances (domain.qnt idsAccounted holds the
  /// two equal).
  pure def evaluationSpawnTotal(instances: List[EvaluationInstance]): int =
    instances.foldl(0, (total, evaluation) =>
      total + instanceRuns(evaluation).foldl(0, (n, progress) =>
        n + runSpawnTotal(progress)))

  /// IS THE INSTANCE PARKED ON A WALL?
  pure def instanceBlocked(evaluation: EvaluationInstance): bool =
    match evaluation.state {
      | EvaluationBlocked(_) => true
      | _ => false
    }

  /// WHAT THIS TICKET PRODUCED, derived: the accepted work result the latest
  /// instance judges, and nothing before any work was accepted. Each
  /// accepted result opens an instance over itself, so a rework's
  /// supersedes the one before it, and a Done ticket's is the one its
  /// finalization committed.
  pure def artifactOf(ticket: Ticket, ledger: TicketLedger): ArtifactMark =
    val instances = ledgerInstances(ticket, ledger)
    if (instances.length() == 0) NoArtifact
    else ProducedArtifact(instances[instances.length() - 1].input.workResult)

  // === Model-scope references and the corpus's constructors ===============

  /// AN OPAQUE POSITIVE REFERENCE derived from a task's own identity, where
  /// the real system has a stored row — a piece of failure evidence. The
  /// machine's only claim on such a reference is that it exists and is
  /// distinct per evaluator within a run.
  pure def taskRefOf(task: TaskIdentity): int =
    match task {
      | WorkTask(work) => work.cycle
      | EvaluationTask(evaluation) => evaluation.evaluator
    }

  /// The band a work result's model-scope reference is drawn in.
  pure val workResultBand: int = 100

  /// WHAT A PRODUCED RESULT'S REFERENCE IS AT MODEL SCOPE, where the real
  /// system folds the digest of the manifest the task attested. A WORK
  /// result takes a band of its own, clear of the cycle that produced it, so
  /// no reader mistakes a derivation for the number that travelled. An
  /// evaluator's is its own key.
  pure def producedResultRef(task: TaskIdentity): int =
    match task {
      | WorkTask(work) => workResultBand * work.ticket + work.cycle
      | EvaluationTask(evaluation) => evaluation.evaluator
    }

  /// WHAT THE FABRIC IS RUNNING FOR THIS TICKET, as the OBLIGATIONS it owes:
  /// the work cycle's one obligation while the ticket is in Work, or the ones
  /// the current run still owes. Empty in every other state. The whole
  /// obligation and not the identity alone, because that is what a produced
  /// report is held against.
  pure def liveObligations(ticket: Ticket): List[TaskObligation] =
    match ticket.state {
      | Work(work) => [workTaskObligation(ticket, ticket.workCyclesStarted,
          work.source, work.input)]
      | Evaluation(evaluation) => currentTaskObligations(evaluation)
      | _ => []
    }

  /// The same identities as a set, which is what the actions draw from.
  pure def liveTasks(ticket: Ticket): Set[TaskIdentity] =
    liveObligations(ticket).foldl(Set(), (found, owed) =>
      found.union(Set(owed.task)))

  /// WHAT A LIVE TASK'S RESULT LOOKS LIKE TO THE MACHINE: the obligation this
  /// ticket owes for it, and the reference producedResultRef derives. This
  /// is the CORPUS's constructor — callers draw the task from liveTasks —
  /// and the only place a result reference is derived at all: every decider
  /// takes the one its report carried.
  pure def producedResult(
      ticket: Ticket, task: TaskIdentity): ValidatedTaskResult =
    { obligation: liveObligations(ticket).select(owed => owed.task == task)[0],
      resultRef: producedResultRef(task) }
}
