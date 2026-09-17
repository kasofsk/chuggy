module ticket_tests {
  import ticket_domain.* from "ticket"
  import task_contract.* from "../task-contract/task"
  import evaluation_protocol.* from "evaluation/evaluation"

  pure val WORK = {
    workload: 1,
    inputs: 1,
    executionRequirements: { repository: 1, access: PublishRepositoryResult, requiredCapabilities: Set() },
    resultContract: 1,
  }

  pure val EVALUATOR = {
    workload: 2,
    inputs: 2,
    executionRequirements: { repository: 1, access: ReadRepository, requiredCapabilities: Set() },
    resultContract: 2,
  }

  pure val PLAN = {
    stages: [
      {
        key: 10,
        evaluators: [
          { key: 11, task: EVALUATOR },
          { key: 12, task: EVALUATOR },
        ],
      },
      {
        key: 20,
        evaluators: [{ key: 21, task: EVALUATOR }],
      },
    ],
  }

  pure def source(ticket: int, commit: int): WorkspaceSource = {
    repository: 1,
    commit: commit,
  }

  pure def dispatch(ticket: int): TicketCommand =
    DispatchTicket({ ticket: ticket, source: source(ticket, ticket * 1000 + 1) })

  pure def released(
    ticket: int,
    dependencies: Set[int],
  ): ReleasedTicket = {
    id: ticket,
    content: AuthoredReleasedContent({
      title: ticket * 100 + 1,
      instructions: ticket * 100 + 2,
    }),
    inputBindings: ticket * 100 + 3,
    dependencies: dependencies,
    workConfiguration: WORK,
    evaluationPlan: PLAN,
    finalizationConfiguration: 1,
  }

  pure def revised(
    ticket: int,
    dependencies: Set[int],
  ): ReleasedTicket = {
    ...released(ticket, dependencies),
    content: AuthoredReleasedContent({
      title: ticket * 100 + 51,
      instructions: ticket * 100 + 52,
    }),
  }

  pure def updateTo(
    ticket: int,
    expectedRevision: int,
    definition: ReleasedTicket,
  ): TicketCommand = UpdateTicket({
    ticket: ticket,
    expectedRevision: expectedRevision,
    definition: definition,
  })

  var graph: TicketGraph
  var priorGraph: TicketGraph
  var lastDecision: TicketDecision

  pure val noDecision: TicketDecision = TicketRefused(TicketNotFound(0))

  pure def reworkPolicy(
    evaluation: EvaluationInstance,
  ): EvaluationFailureDisposition = ReworkEvaluationFailure

  pure def escalatePolicy(
    evaluation: EvaluationInstance,
  ): EvaluationFailureDisposition = EscalateEvaluationFailure

  action init = all {
    graph' = { tickets: Map() },
    priorGraph' = { tickets: Map() },
    lastDecision' = noDecision,
  }

  action submitWithPolicy(command, failurePolicy) = all {
    commandValid(command),
    priorGraph' = graph,
    lastDecision' = decide(graph, command, failurePolicy),
    graph' = applyCommand(graph, command, failurePolicy),
  }

  action submit(command) =
    submitWithPolicy(command, reworkPolicy)

  action check(condition) = all {
    assert(condition),
    graph' = graph,
    priorGraph' = priorGraph,
    lastDecision' = lastDecision,
  }

  action blocked = all {
    false,
    graph' = graph,
    priorGraph' = priorGraph,
    lastDecision' = lastDecision,
  }

  action reportWorkResultWithOutputs(ticketId, manifest, outputs) = {
    if (not(graph.tickets.keys().contains(ticketId))) blocked
    else {
      val ticket = graph.tickets.get(ticketId)
      match ticket.state {
        | Work(work) => {
            val obligation =
              workTaskObligation(ticket, ticket.workCyclesStarted, work.source, work.input)
            submit(ReportTaskTerminal({
              ticket: ticketId,
              terminal: TaskResultProduced(validatedTaskResult(
                obligation,
                manifest,
                outputs,
                1,
                [],
              )),
            }))
          }
        | _ => blocked
      }
    }
  }

  action reportWorkResult(ticketId, manifest) =
    reportWorkResultWithOutputs(ticketId, manifest, [GitOutput(source(ticketId, manifest))])

  pure def nonPublishingReleased(ticket: int): ReleasedTicket = {
    ...released(ticket, Set()),
    workConfiguration: {
      ...WORK,
      executionRequirements: { repository: 1, access: ReadRepository, requiredCapabilities: Set() },
    },
  }

  run nonPublishingDoneTest = {
    init
      .then(submit(CreateTicket(nonPublishingReleased(1))))
      .then(submit(dispatch(1)))
      .then(reportWorkResultWithOutputs(1, 101, []))
      .then(check(match graph.tickets.get(1).state {
        | Evaluation(evaluation) => evaluation.input.acceptedSource == source(1, 1001)
        | _ => false
      }))
      .then(reportEvaluatorResult(1, 111, 1))
      .then(reportEvaluatorResult(1, 112, 1))
      .then(reportEvaluatorResult(1, 121, 1))
      .then(reportFinalization(1, FinalizationSucceeded(131)))
      .then(check(ticketDone(1)))
  }

  run nonPublishingEscalationTest = {
    init
      .then(submit(CreateTicket(nonPublishingReleased(1))))
      .then(submit(dispatch(1)))
      .then(reportWorkResultWithOutputs(1, 101, []))
      .then(reportEvaluatorResultWithFailureDisposition(1, 111, -1, escalatePolicy))
      .then(reportEvaluatorResultWithFailureDisposition(1, 112, 1, escalatePolicy))
      .then(check(graph.tickets.get(1).workCyclesStarted == 1 and escalatedWith(1, (escalation) => match escalation {
        | EvaluationFailureEscalated(failure) => failure.source == source(1, 1001)
        | _ => false
      })))
  }

  run publishingMissingOutputTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResultWithOutputs(1, 101, []))
      .then(check(lastDecision == TicketRefused(WorkResultMissingExactGitOutput(1))
        and graph == priorGraph))
  }

  action reportWorkTerminal(ticketId, terminal) = {
    if (not(graph.tickets.keys().contains(ticketId))) blocked
    else {
      val ticket = graph.tickets.get(ticketId)
      match ticket.state {
        | Work(work) => {
            val obligation =
              workTaskObligation(ticket, ticket.workCyclesStarted, work.source, work.input)
            submit(ReportTaskTerminal({
              ticket: ticketId,
              terminal: terminal(obligation.task),
            }))
          }
        | _ => blocked
      }
    }
  }

  action reportWorkProcessFailed(ticketId, evidence) =
    reportWorkTerminal(ticketId, (task) =>
      TaskProcessFailed({ task: task, evidence: evidence }))

  action reportWorkExecutionUnavailable(ticketId, evidence) =
    reportWorkTerminal(ticketId, (task) =>
      TaskExecutionUnavailable({ task: task, evidence: evidence }))

  action reportEvaluatorResultWithFindings(
    ticketId,
    manifest,
    value,
    findings,
  ) = {
    if (not(graph.tickets.keys().contains(ticketId))) blocked
    else {
      val ticket = graph.tickets.get(ticketId)
      match ticket.state {
        | Evaluation(evaluation) => {
            val obligation = currentTaskObligations(evaluation)[0]
            submit(ReportTaskTerminal({
              ticket: ticketId,
              terminal: TaskResultProduced(validatedTaskResult(
                obligation,
                manifest,
                [],
                value,
                findings,
              )),
            }))
          }
        | _ => blocked
      }
    }
  }

  action reportEvaluatorResult(
    ticketId,
    manifest,
    value,
  ) = reportEvaluatorResultWithFindings(ticketId, manifest, value, [])

  action reportEvaluatorResultWithFailureDisposition(
    ticketId,
    manifest,
    value,
    failurePolicy,
  ) = {
    if (not(graph.tickets.keys().contains(ticketId))) blocked
    else {
      val ticket = graph.tickets.get(ticketId)
      match ticket.state {
        | Evaluation(evaluation) => {
            val obligation = currentTaskObligations(evaluation)[0]
            submitWithPolicy(ReportTaskTerminal({
              ticket: ticketId,
              terminal: TaskResultProduced(validatedTaskResult(
                obligation,
                manifest,
                [],
                value,
                [],
              )),
            }), failurePolicy)
          }
        | _ => blocked
      }
    }
  }

  action reportEvaluatorUnavailable(ticketId, evidence) = {
    if (not(graph.tickets.keys().contains(ticketId))) blocked
    else {
      val ticket = graph.tickets.get(ticketId)
      match ticket.state {
        | Evaluation(evaluation) => {
            val obligation = currentTaskObligations(evaluation)[0]
            submit(ReportTaskTerminal({
              ticket: ticketId,
              terminal: TaskExecutionUnavailable({
                task: obligation.task,
                evidence: evidence,
              }),
            }))
          }
        | _ => blocked
      }
    }
  }

  action reportEvaluatorProcessFailed(ticketId, evidence) = {
    if (not(graph.tickets.keys().contains(ticketId))) blocked
    else {
      val ticket = graph.tickets.get(ticketId)
      match ticket.state {
        | Evaluation(evaluation) => {
            val obligation = currentTaskObligations(evaluation)[0]
            submit(ReportTaskTerminal({
              ticket: ticketId,
              terminal: TaskProcessFailed({
                task: obligation.task,
                evidence: evidence,
              }),
            }))
          }
        | _ => blocked
      }
    }
  }

  action reportFinalization(
    ticketId,
    result,
  ) = {
    if (not(graph.tickets.keys().contains(ticketId))) blocked
    else {
      val ticket = graph.tickets.get(ticketId)
      match ticket.state {
        | Finalization(finalization) => submit(ReportFinalizationResult({
            ticket: ticketId,
            workCycle: finalization.workCycle,
            generation: finalization.generation,
            result: result,
          }))
        | _ => blocked
      }
    }
  }

  def ticketRevision(ticketId: int, revision: int): bool =
    graph.tickets.get(ticketId).revision == revision

  def ticketDefinition(ticketId: int, definition: ReleasedTicket): bool =
    graph.tickets.get(ticketId).definition == definition

  def decidedWorkContext: List[int] = match lastDecision {
    | TicketDecided(success) => success.obligations.foldl([], (found, obligation) =>
        match obligation {
          | ExecuteTask(execution) => execution.task.context
          | _ => found
        })
    | TicketRefused(_) => []
  }

  def ticketDone(ticketId: int): bool =
    graph.tickets.get(ticketId).state == Done

  def ticketFinalizing(ticketId: int): bool =
    match graph.tickets.get(ticketId).state {
      | Finalization(_) => true
      | _ => false
    }

  def ticketWorkCycle(ticketId: int, cycle: int): bool = {
    val ticket = graph.tickets.get(ticketId)
    match ticket.state {
      | Work(_) => ticket.workCyclesStarted == cycle
      | _ => false
    }
  }

  def workRetryEvidenceHas(ticketId: int, evidence: int): bool =
    match graph.tickets.get(ticketId).state {
      | Work(work) => work.input.retryEvidence.indices().exists(index =>
          work.input.retryEvidence[index] == evidence)
      | _ => false
    }

  def workUsesSource(ticketId: int, expected: WorkspaceSource): bool =
    match graph.tickets.get(ticketId).state {
      | Work(work) => work.source == expected
      | _ => false
    }

  def escalatedWith(
    ticketId: int,
    matcher: Escalation => bool,
  ): bool =
    match graph.tickets.get(ticketId).state {
      | Escalated(escalation) => matcher(escalation)
      | _ => false
    }

  def ticketEvaluationGeneration(
    ticketId: int,
    generation: int,
  ): bool = match graph.tickets.get(ticketId).state {
    | Evaluation(evaluation) => match evaluation.state {
        | Running(progress) => progress.stage.generation == generation
        | _ => false
      }
    | _ => false
  }

  def workReworkFindings(
    ticketId: int,
    evaluator: int,
  ): List[EvaluationFinding] =
    match graph.tickets.get(ticketId).state {
      | Work(work) => match work.input.cause {
          | EvaluationRework(entries) =>
              entries.foldl([], (found, entry) =>
                if (entry.evaluator == evaluator) found.concat(entry.findings)
                else found)
          | _ => []
        }
      | _ => []
    }

  run repositoryContractTest = {
    val wrongEvaluationRepository = {
      stages: [{
        key: 10,
        evaluators: [{
          key: 11,
          task: {
            ...EVALUATOR,
            executionRequirements: {
              repository: 2,
              access: ReadRepository,
              requiredCapabilities: Set(),
            },
          },
        }],
      }],
    }
    init
      .then(check(
        releasedTicketValid(released(1, Set()))
        and not(planUsesRepository(wrongEvaluationRepository, 1))
      ))
      .then(submit(CreateTicket(released(1, Set()))))
      .then(check(decide(
        graph,
        DispatchTicket({ ticket: 1, source: { repository: 2, commit: 1001 } }),
        reworkPolicy,
      ) == TicketRefused(DispatchSourceRepositoryMismatch(1))))
  }

  run workOutputRepositoryContractTest = {
    val obligation = {
      task: workTaskIdentity(1, 1),
      definition: WORK,
      source: source(1, 1001),
      context: [],
    }
    init.then(check(
      hasExactGitOutput(validatedTaskResult(
        obligation,
        101,
        [GitOutput(source(1, 1002))],
        1,
        [],
      ))
      and not(hasExactGitOutput(validatedTaskResult(
        obligation,
        102,
        [GitOutput({ repository: 2, commit: 1002 })],
        1,
        [],
      )))
      and not(hasExactGitOutput(validatedTaskResult(
        obligation,
        103,
        [],
        1,
        [],
      )))
    ))
  }

  run stageKeyContractTest = {
    val zeroStageKeyPlan = {
      stages: [{ key: 0, evaluators: [{ key: 11, task: EVALUATOR }] }],
    }
    init.then(check(
      not(taskIdentityValid(evaluatorTaskIdentity(1, 1, 0, 1, 11)))
      and not(planValid(zeroStageKeyPlan))
      and planValid(PLAN)
    ))
  }

  run happyPathTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(CreateTicket(released(2, Set(1)))))
      .then(submit(dispatch(2)))
      .then(check(graph.tickets.get(2).state == Pending))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 101))
      .then(reportEvaluatorResult(1, 111, 1))
      .then(reportEvaluatorResult(1, 112, 1))
      .then(reportEvaluatorResult(1, 121, 1))
      .then(reportFinalization(1, FinalizationSucceeded(131)))
      .then(check(ticketDone(1) and isReady(graph, 2)))
  }

  def decidedCapabilities: List[Set[str]] = match lastDecision {
    | TicketDecided(success) => success.obligations.foldl([], (found, obligation) =>
        match obligation {
          | ExecuteTask(execution) => found.append(
              execution.task.definition.executionRequirements.requiredCapabilities)
          | _ => found
        })
    | TicketRefused(_) => []
  }

  run requiredCapabilitiesPreservedTest = {
    val work = {
      ...WORK,
      executionRequirements: {
        ...WORK.executionRequirements,
        requiredCapabilities: Set("macos-native", "xcode"),
      },
    }
    val evaluator = {
      ...EVALUATOR,
      executionRequirements: {
        ...EVALUATOR.executionRequirements,
        requiredCapabilities: Set("linux"),
      },
    }
    val definition = {
      ...released(1, Set()),
      workConfiguration: work,
      evaluationPlan: {
        stages: [{
          key: 10,
          evaluators: [{ key: 11, task: evaluator }, { key: 12, task: evaluator }],
        }],
      },
    }
    val invalid = {
      ...work,
      executionRequirements: {
        ...work.executionRequirements,
        requiredCapabilities: Set(""),
      },
    }
    init
      .then(check(taskDefinitionValid(WORK) and not(taskDefinitionValid(invalid))))
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(updateTo(1, 1, definition)))
      .then(submit(dispatch(1)))
      .then(check(decidedCapabilities == [Set("xcode", "macos-native")]))
      .then(submit(updateTo(1, 2, released(1, Set()))))
      .then(check(lastDecision == TicketRefused(TicketNotPending(1))
        and ticketDefinition(1, definition)))
      .then(reportWorkProcessFailed(1, 901))
      .then(submit(ResumeTicket(1)))
      .then(check(decidedCapabilities == [Set("macos-native", "xcode")]))
      .then(reportWorkResult(1, 902))
      .then(check(decidedCapabilities == [Set("linux"), Set("linux")]))
      .then(reportEvaluatorResult(1, 903, -1))
      .then(reportEvaluatorResult(1, 904, 1))
      .then(check(decidedCapabilities == [Set("macos-native", "xcode")]))
      .then(reportWorkResult(1, 905))
      .then(check(decidedCapabilities == [Set("linux"), Set("linux")]))
      .then(reportEvaluatorResult(1, 906, 1))
      .then(reportEvaluatorUnavailable(1, 907))
      .then(submit(ResumeTicket(1)))
      .then(check(decidedCapabilities == [Set("linux")]
        and ticketDefinition(1, definition)))
  }

  run definitionRevisionsTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(check(ticketRevision(1, 1) and ticketDefinition(1, released(1, Set()))))
      .then(submit(updateTo(1, 1, revised(1, Set()))))
      .then(check(ticketRevision(1, 2) and ticketDefinition(1, revised(1, Set()))))
      .then(submit(updateTo(1, 2, revised(1, Set()))))
      .then(check(ticketRevision(1, 3) and ticketDefinition(1, revised(1, Set()))))
      .then(check(graph.tickets.get(1).state == Pending
        and graph.tickets.get(1).workCyclesStarted == 0))
  }

  run updateRefusalLadderTest = {
    init
      .then(submit(updateTo(1, 1, released(1, Set()))))
      .then(check(lastDecision == TicketRefused(TicketNotFound(1))))
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(CreateTicket(released(2, Set(1)))))
      .then(submit(updateTo(2, 9, released(1, Set()))))
      .then(check(lastDecision == TicketRefused(TicketIdentityMismatch(2))))
      .then(submit(updateTo(2, 9, revised(2, Set()))))
      .then(check(lastDecision == TicketRefused(TicketRevisionStale({
        ticket: 2,
        expected: 9,
        current: 1,
      }))))
      .then(submit(updateTo(2, 1, revised(2, Set()))))
      .then(check(lastDecision == TicketRefused(TicketDependenciesChanged(2))))
      .then(check(ticketRevision(2, 1) and ticketDefinition(2, released(2, Set(1)))))
      .then(submit(dispatch(1)))
      .then(submit(updateTo(1, 1, revised(1, Set()))))
      .then(check(lastDecision == TicketRefused(TicketNotPending(1))))
      .then(check(ticketDefinition(1, released(1, Set()))))
  }

  run dispatchUsesTheRevisedDefinitionTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(updateTo(1, 1, revised(1, Set()))))
      .then(submit(dispatch(1)))
      .then(check(decidedWorkContext == [151, 152, 103]))
      .then(check(ticketWorkCycle(1, 1) and ticketDefinition(1, revised(1, Set()))))
  }

  run failedEvaluatorFindingsAreCarriedIntoReworkEntryTest = {
    val detail = {
      reason: SummaryReason(101),
      resultManifest: 102,
      findings: [{ id: 103, description: 104 }],
    }
    assert(failedEntries(11, Produced(EvaluatorFailed(detail))) == [{
      evaluator: 11,
      reason: SummaryReason(101),
      resultManifest: 102,
      findings: [{ id: 103, description: 104 }],
    }])
  }

  run evaluatorFindingsReachTheNextWorkCycleTest = {
    val duplicatedFindingIds = ReportTaskTerminal({
      ticket: 1,
      terminal: TaskResultProduced(validatedTaskResult({
        task: evaluatorTaskIdentity(1, 1, 10, 1, 11),
        definition: EVALUATOR,
        source: source(1, 1301),
        context: [1301],
      }, 1311, [], -1, [
        { id: 7, description: 1312 },
        { id: 7, description: 1313 },
      ])),
    })
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 1301))
      .then(check(not(commandValid(duplicatedFindingIds))))
      .then(reportEvaluatorResultWithFindings(1, 1311, -1, [
        { id: 7, description: 1312 },
        { id: 8, description: 1314 },
      ]))
      .then(reportEvaluatorResult(1, 1315, 1))
      .then(check(ticketWorkCycle(1, 2)))
      .then(check(workReworkFindings(1, 11) == [
        { id: 7, description: 1312 },
        { id: 8, description: 1314 },
      ]))
  }

  run evaluationFailurePolicyTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 201))
      .then(reportEvaluatorResult(1, 211, -1))
      .then(reportEvaluatorResult(1, 212, 1))
      .then(check(ticketWorkCycle(1, 2)))
      .then(reportWorkResult(1, 202))
      .then(reportEvaluatorResult(1, 221, -1))
      .then(reportEvaluatorResultWithFailureDisposition(
        1,
        222,
        1,
        escalatePolicy,
      ))
      .then(check(isEscalated(graph.tickets.get(1).state)))
      .then(submit(ResumeTicket(1)))
      .then(check(ticketWorkCycle(1, 3)))
  }

  run evaluationUnavailableResumeTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 301))
      .then(reportEvaluatorResult(1, 311, 1))
      .then(reportEvaluatorUnavailable(1, 312))
      .then(check(isEscalated(graph.tickets.get(1).state)))
      .then(submit(ResumeTicket(1)))
      .then(check(ticketEvaluationGeneration(1, 2)))
      .then(reportEvaluatorResult(1, 313, 1))
      .then(reportEvaluatorResult(1, 321, 1))
      .then(reportFinalization(1, FinalizationSucceeded(331)))
      .then(check(ticketDone(1)))
  }

  run evaluationFailurePrecedesUnavailabilityTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 601))
      .then(reportEvaluatorResult(1, 611, -1))
      .then(reportEvaluatorUnavailable(1, 612))
      .then(check(ticketWorkCycle(1, 2)))
  }

  run evaluationProcessFailureRecoveryTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 701))
      .then(reportEvaluatorResult(1, 711, 1))
      .then(reportEvaluatorProcessFailed(1, 712))
      .then(check(isEscalated(graph.tickets.get(1).state)))
      .then(submit(ResumeTicket(1)))
      .then(check(match graph.tickets.get(1).state {
        | Evaluation(evaluation) => match evaluation.state {
            | Running(progress) => progress.stage.generation == 2
                and progress.stage.evaluators.keys().filter(evaluator => match
                  progress.stage.evaluators.get(evaluator) {
                    | Produced(result) => match result {
                        | EvaluatorPassed(_) => true
                        | _ => false
                      }
                    | _ => false
                  }).size() == 1
                and progress.stage.evaluators.keys().filter(evaluator =>
                  statusAwaiting(
                    progress.stage.evaluators.get(evaluator))).size() == 1
            | _ => false
          }
        | _ => false
      }))
      .then(check(decide(graph, ReportTaskTerminal({
        ticket: 1,
        terminal: TaskResultProduced(validatedTaskResult({
          task: evaluatorTaskIdentity(1, 1, 10, 1, 12),
          definition: EVALUATOR,
          source: source(1, 701),
          context: [701],
        }, 713, [], 1, [])),
      }), reworkPolicy) == TicketRefused(TaskNotCurrent({
        ticket: 1,
        task: evaluatorTaskIdentity(1, 1, 10, 1, 12),
      }))))
      .then(reportEvaluatorResult(1, 714, 1))
      .then(check(match graph.tickets.get(1).state {
        | Evaluation(evaluation) => match evaluation.state {
            | Running(progress) => progress.stage.stageIndex == 1
                and progress.stage.generation == 1
                and progress.stage.evaluators.keys().filter(evaluator =>
                  statusAwaiting(
                    progress.stage.evaluators.get(evaluator))).size() == 1
            | _ => false
          }
        | _ => false
      }))
  }

  run duplicateEvaluatorTerminalIsRefusedTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 801))
      .then(reportEvaluatorResult(1, 811, 1))
      .then(check(decide(graph, ReportTaskTerminal({
        ticket: 1,
        terminal: TaskResultProduced(validatedTaskResult({
          task: evaluatorTaskIdentity(1, 1, 10, 1, 11),
          definition: EVALUATOR,
          source: source(1, 801),
          context: [801],
        }, 811, [], 1, [])),
      }), reworkPolicy) == TicketRefused(TaskNotCurrent({
        ticket: 1,
        task: evaluatorTaskIdentity(1, 1, 10, 1, 11),
      }))))
  }

  run revocationCancelsOutstandingEvaluationTasksTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 901))
      .then(reportEvaluatorResult(1, 911, 1))
      .then(check(decide(
        graph,
        RevokeTicket(1),
        reworkPolicy,
      ) == TicketDecided({
        event: TicketRevoked(1),
        obligations: [CancelTask({
          ticket: 1,
          task: evaluatorTaskIdentity(1, 1, 10, 1, 12),
        })],
      })))
      .then(submit(RevokeTicket(1)))
      .then(check(graph.tickets.get(1).state == Revoked))
  }

  run finalizationRecoveryTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 401))
      .then(reportEvaluatorResult(1, 411, 1))
      .then(reportEvaluatorResult(1, 412, 1))
      .then(reportEvaluatorResult(1, 421, 1))
      .then(reportFinalization(1, FinalizationNeedsWork(431)))
      .then(check(ticketWorkCycle(1, 2)))
      .then(reportWorkResult(1, 402))
      .then(reportEvaluatorResult(1, 441, 1))
      .then(reportEvaluatorResult(1, 442, 1))
      .then(reportEvaluatorResult(1, 451, 1))
      .then(reportFinalization(1, FinalizationResultUnavailable(461)))
      .then(check(isEscalated(graph.tickets.get(1).state)))
      .then(submit(ResumeTicket(1)))
      .then(reportFinalization(1, FinalizationSucceeded(462)))
      .then(check(ticketDone(1)))
  }

  run revocationLeavesDependentsBlockedTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(CreateTicket(released(2, Set(1)))))
      .then(submit(CreateTicket(released(3, Set(2)))))
      .then(submit(CreateTicket(released(4, Set()))))
      .then(submit(dispatch(1)))
      .then(submit(RevokeTicket(1)))
      .then(check(
        graph.tickets.get(1).state == Revoked
        and graph.tickets.get(2).state == Pending
        and graph.tickets.get(3).state == Pending
        and graph.tickets.get(4).state == Pending
        and not(isReady(graph, 2))
        and not(isReady(graph, 3))
      ))
      .then(submit(RevokeTicket(2)))
      .then(check(
        graph.tickets.get(2).state == Revoked
        and graph.tickets.get(3).state == Pending
        and not(isReady(graph, 3))
      ))
      .then(submit(RevokeTicket(3)))
      .then(check(graph.tickets.get(3).state == Revoked))
  }

  run workFailureEscalationTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(check(workUsesSource(1, source(1, 1001))))
      .then(reportWorkProcessFailed(1, 901))
      .then(check(escalatedWith(1, (escalation) => match escalation {
        | WorkFailureEscalated(_) => true
        | _ => false
      })))
      .then(submit(ResumeTicket(1)))
      .then(check(ticketWorkCycle(1, 2)
        and workRetryEvidenceHas(1, 901)
        and workUsesSource(1, source(1, 1001))))
      .then(reportWorkExecutionUnavailable(1, 902))
      .then(check(escalatedWith(1, (escalation) => match escalation {
        | WorkExecutionUnavailableEscalated(_) => true
        | _ => false
      })))
      .then(submit(ResumeTicket(1)))
      .then(check(
        ticketWorkCycle(1, 3)
        and workRetryEvidenceHas(1, 901)
        and workRetryEvidenceHas(1, 902)
      ))
      .then(reportWorkResult(1, 903))
      .then(check(match graph.tickets.get(1).state {
        | Evaluation(_) => true
        | _ => false
      }))
  }

  run staleFinalizationIsRefusedTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 1001))
      .then(reportEvaluatorResult(1, 1011, 1))
      .then(reportEvaluatorResult(1, 1012, 1))
      .then(reportEvaluatorResult(1, 1021, 1))
      .then(reportFinalization(1, FinalizationResultUnavailable(1031)))
      .then(submit(ResumeTicket(1)))
      .then(check(match graph.tickets.get(1).state {
        | Finalization(operation) =>
            operation.workCycle == 1 and operation.generation == 2
        | _ => false
      }))
      .then(check(decide(graph, ReportFinalizationResult({
        ticket: 1,
        workCycle: 1,
        generation: 1,
        result: FinalizationSucceeded(1041),
      }), reworkPolicy) == TicketRefused(FinalizationNotCurrent({
        ticket: 1,
        workCycle: 1,
        generation: 1,
      }))))
      .then(reportFinalization(1, FinalizationSucceeded(1042)))
      .then(check(ticketDone(1)))
  }

  run finalizationResultContractTest = {
    val absentEvidence = ReportFinalizationResult({
      ticket: 1,
      workCycle: 1,
      generation: 1,
      result: FinalizationNeedsWork(0),
    })
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 1201))
      .then(reportEvaluatorResult(1, 1211, 1))
      .then(reportEvaluatorResult(1, 1212, 1))
      .then(reportEvaluatorResult(1, 1221, 1))
      .then(check(ticketFinalizing(1)))
      .then(check(not(commandValid(absentEvidence))))
      .then(check(
        not(graphInvariant(applyCommand(graph, absentEvidence, reworkPolicy)))
      ))
  }

  run evolveIgnoresImpossiblePairingTest = {
    init
      .then(submit(CreateTicket(released(1, Set()))))
      .then(submit(CreateTicket(released(2, Set()))))
      .then(submit(CreateTicket(released(3, Set()))))
      .then(submit(dispatch(1)))
      .then(reportWorkResult(1, 1101))
      .then(reportEvaluatorResult(1, 1111, 1))
      .then(reportEvaluatorResult(1, 1112, 1))
      .then(reportEvaluatorResult(1, 1121, 1))
      .then(reportFinalization(1, FinalizationSucceeded(1131)))
      .then(submit(RevokeTicket(2)))
      .then(check(ticketDone(1) and graph.tickets.get(2).state == Revoked))
      .then(check(evolve(graph, TicketDispatched({ ticket: 1, source: source(1, 1001) })) == graph))
      .then(check(evolve(graph, TicketDispatched({ ticket: 2, source: source(2, 2001) })) == graph))
      .then(check(evolve(graph, TicketRevoked(1)) == graph))
      .then(check(evolve(graph, TicketCreated(released(1, Set()))) == graph))
      .then(check(evolve(graph, TicketFinalizationSucceeded({
        ticket: 2,
        workCycle: 1,
        generation: 1,
        evidence: 1141,
      })) == graph))
      .then(check(evolve(graph, TicketUpdated({
        ticket: 4,
        revision: 2,
        definition: revised(4, Set()),
      })) == graph))
      .then(check(evolve(graph, TicketUpdated({
        ticket: 1,
        revision: 2,
        definition: revised(1, Set()),
      })) == graph))
      .then(check(evolve(graph, TicketUpdated({
        ticket: 3,
        revision: 3,
        definition: revised(3, Set()),
      })) == graph))
  }

  def decisionInvariant = decisionValid(priorGraph, lastDecision)

  def modelInvariant = graphInvariant(graph) and decisionInvariant

  def someDone = graph.tickets.keys().exists(ticket =>
    graph.tickets.get(ticket).state == Done)

  def someEscalated = graph.tickets.keys().exists(ticket =>
    match graph.tickets.get(ticket).state {
      | Escalated(_) => true
      | _ => false
    })

  action createOne = submit(CreateTicket(released(1, Set())))
  action createTwo = submit(CreateTicket(released(2, Set(1))))

  action updateOne = {
    val expected =
      if (graph.tickets.keys().contains(1)) graph.tickets.get(1).revision else 1
    submit(updateTo(1, expected, revised(1, Set())))
  }

  action dispatchOne = submit(dispatch(1))
  action dispatchTwo = submit(dispatch(2))
  action revokeOne = submit(RevokeTicket(1))
  action resumeOne = submit(ResumeTicket(1))

  action passWorkOne = reportWorkResult(1, 501)
  action failWorkOne = reportWorkProcessFailed(1, 508)
  action unavailableWorkOne = reportWorkExecutionUnavailable(1, 509)
  action passEvaluatorOne = reportEvaluatorResult(1, 502, 1)
  action failEvaluatorOne = reportEvaluatorResult(1, 503, -1)
  action unavailableEvaluatorOne = reportEvaluatorUnavailable(1, 504)
  action completeFinalizationOne =
    reportFinalization(1, FinalizationSucceeded(505))
  action reworkFinalizationOne =
    reportFinalization(1, FinalizationNeedsWork(506))
  action unavailableFinalizationOne =
    reportFinalization(1, FinalizationResultUnavailable(507))

  action step = any {
    createOne,
    createTwo,
    updateOne,
    dispatchOne,
    dispatchTwo,
    revokeOne,
    resumeOne,
    passWorkOne,
    failWorkOne,
    unavailableWorkOne,
    passEvaluatorOne,
    failEvaluatorOne,
    unavailableEvaluatorOne,
    completeFinalizationOne,
    reworkFinalizationOne,
    unavailableFinalizationOne,
  }
}
