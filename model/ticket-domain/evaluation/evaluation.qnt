module evaluation_protocol {
  import task_contract.* from "../../task-contract/task"

  type EvaluatorDefinition = {
    key: int,
    task: TaskDefinition
  }

  type StageDefinition = {
    key: int,
    evaluators: List[EvaluatorDefinition]
  }

  type EvaluationPlan = {
    stages: List[StageDefinition]
  }

  type EvaluationInput = {
    ticket: int,
    workResult: int,
    acceptedSource: WorkspaceSource
  }

  type EvaluationReason = SummaryReason(int) | ExitCodeReason(int)

  type EvaluationResultDetail = {
    reason: EvaluationReason,
    resultManifest: int
  }

  type EvaluationFailureDetail = {
    reason: EvaluationReason,
    resultManifest: int,
    findings: List[EvaluationFinding]
  }

  type EvaluatorResult =
    EvaluatorPassed(EvaluationResultDetail)
    | EvaluatorFailed(EvaluationFailureDetail)

  type EvaluatorStatus =
    Awaiting
    | Produced(EvaluatorResult)
    | EvaluatorProcessFailed(int)
    | EvaluatorExecutionUnavailable(int)

  type EvaluationReworkEntry = {
    evaluator: int,
    reason: EvaluationReason,
    resultManifest: int,
    findings: List[EvaluationFinding]
  }

  type EvaluationFinding = {
    id: int,
    description: int
  }

  type StageRun = {
    stageIndex: int,
    generation: int,
    evaluators: int -> EvaluatorStatus
  }

  type EvaluationProgress = {
    completedStages: List[StageRun],
    stage: StageRun
  }

  type EvaluationState =
    Running(EvaluationProgress)
    | EvaluationPassed(List[StageRun])
    | EvaluationFailed(List[StageRun])
    | EvaluationBlocked(EvaluationProgress)

  type EvaluationInstance = {
    workCycle: int,
    input: EvaluationInput,
    plan: EvaluationPlan,
    state: EvaluationState
  }

  pure def evaluatorTaskIdentity(
    ticket: int,
    workCycle: int,
    stage: int,
    generation: int,
    evaluator: int,
  ): TaskIdentity = EvaluationTask({
      ticket: ticket,
      workCycle: workCycle,
      stage: stage,
      generation: generation,
      evaluator: evaluator,
    })

  pure def taskIdentityFor(
    current: EvaluationInstance,
    progress: StageRun,
    evaluator: int,
  ): TaskIdentity =
    evaluatorTaskIdentity(
      current.input.ticket,
      current.workCycle,
      current.plan.stages[progress.stageIndex].key,
      progress.generation,
      evaluator,
    )

  pure def evaluatorKeys(stage: StageDefinition): Set[int] =
    stage.evaluators.foldl(Set(), (found, entry) =>
      found.union(Set(entry.key)))

  pure def evaluatorKeyForTask(
    current: EvaluationInstance,
    progress: StageRun,
    task: TaskIdentity,
  ): int =
    current.plan.stages[progress.stageIndex].evaluators
      .select(entry => taskIdentityFor(current, progress, entry.key) == task)[0]
      .key

  pure def initialStageRun(
    ticket: int,
    workCycle: int,
    stage: StageDefinition,
    stageIndex: int,
  ): StageRun = {
    stageIndex: stageIndex,
    generation: 1,
    evaluators: stage.evaluators.foldl(Map(), (found, entry) =>
      found.put(entry.key, Awaiting)),
  }

  pure def statusAwaiting(status: EvaluatorStatus): bool = match status {
    | Awaiting => true
    | _ => false
  }

  pure def statusFailed(status: EvaluatorStatus): bool = match status {
    | Produced(result) => match result {
        | EvaluatorFailed(_) => true
        | EvaluatorPassed(_) => false
      }
    | _ => false
  }

  pure def statusBlocked(status: EvaluatorStatus): bool = match status {
    | EvaluatorProcessFailed(_) => true
    | EvaluatorExecutionUnavailable(_) => true
    | _ => false
  }

  pure def stageHasAwaiting(progress: StageRun): bool =
    progress.evaluators.keys().exists(evaluator =>
      statusAwaiting(progress.evaluators.get(evaluator)))

  pure def stageHasFailed(progress: StageRun): bool =
    progress.evaluators.keys().exists(evaluator =>
      statusFailed(progress.evaluators.get(evaluator)))

  pure def stageHasBlocked(progress: StageRun): bool =
    progress.evaluators.keys().exists(evaluator =>
      statusBlocked(progress.evaluators.get(evaluator)))

  pure def stateStageComplete(candidate: EvaluationState): bool = match candidate {
    | Running(progress) => not(stageHasAwaiting(progress.stage))
    | _ => false
  }

  pure def isCurrentStageComplete(value: EvaluationInstance): bool =
    stateStageComplete(value.state)

  pure def taskCurrent(
    current: EvaluationInstance,
    task: TaskIdentity,
  ): bool = match current.state {
    | Running(progress) => progress.stage.evaluators.keys().exists(evaluator =>
        progress.stage.evaluators.get(evaluator) == Awaiting
        and taskIdentityFor(current, progress.stage, evaluator) == task)
    | _ => false
  }

  pure def reportProduced(
    current: EvaluationInstance,
    task: TaskIdentity,
    result: EvaluatorResult,
  ): EvaluationInstance = match current.state {
    | Running(running) => if (taskCurrent(current, task)) {
        val progress = running.stage
        val evaluator = evaluatorKeyForTask(current, progress, task)
        match result {
          | EvaluatorPassed(_) => {
              ...current,
              state: Running({
                ...running,
                stage: {
                  ...progress,
                  evaluators: progress.evaluators.set(evaluator, Produced(result)),
                },
              }),
            }
          | EvaluatorFailed(_) => {
              ...current,
              state: Running({
                ...running,
                stage: {
                  ...progress,
                  evaluators: progress.evaluators.set(evaluator, Produced(result)),
                },
              }),
            }
        }
      } else current
    | _ => current
  }

  pure def reportWithoutResult(
    current: EvaluationInstance,
    task: TaskIdentity,
    terminal: TaskTerminal,
  ): EvaluationInstance = match current.state {
    | Running(running) => if (taskCurrent(current, task)) {
        val progress = running.stage
        val evaluator = evaluatorKeyForTask(current, progress, task)
        match terminal {
          | TaskProcessFailed(failure) => {
              ...current,
              state: Running({
                ...running,
                stage: {
                  ...progress,
                  evaluators: progress.evaluators.set(
                    evaluator,
                    EvaluatorProcessFailed(failure.evidence)
                  ),
                },
              }),
            }
          | TaskExecutionUnavailable(failure) => {
              ...current,
              state: Running({
                ...running,
                stage: {
                  ...progress,
                  evaluators: progress.evaluators.set(
                    evaluator,
                    EvaluatorExecutionUnavailable(failure.evidence)
                  ),
                },
              }),
            }
          | TaskResultProduced(_) => current
        }
      } else current
    | _ => current
  }

  pure def concludeStage(
    current: EvaluationInstance,
  ): EvaluationInstance = match current.state {
    | Running(running) => {
      val progress = running.stage
      val completed = running.completedStages.append(progress)
      if (stageHasAwaiting(progress)) current
      else if (stageHasFailed(progress)) {
        ...current,
        state: EvaluationFailed(completed),
      } else if (stageHasBlocked(progress)) {
        ...current,
        state: EvaluationBlocked(running),
      } else if (progress.stageIndex + 1 == current.plan.stages.length()) {
        ...current,
        state: EvaluationPassed(completed),
      } else {
        val nextIndex = progress.stageIndex + 1
        val nextStage = current.plan.stages[nextIndex]
        {
          ...current,
          state: Running({
            completedStages: completed,
            stage: initialStageRun(
              current.input.ticket,
              current.workCycle,
              nextStage,
              nextIndex,
            ),
          }),
        }
      }
    }
    | _ => current
  }

  pure def decodeEvaluatorResult(result: ValidatedTaskResult): EvaluatorResult = {
    val detail = {
      reason: SummaryReason(result.value),
      resultManifest: result.manifest,
    }
    if (result.value > 0) EvaluatorPassed(detail)
    else EvaluatorFailed({
      reason: detail.reason,
      resultManifest: detail.resultManifest,
      findings: result.findings.foldl([], (entries, finding) =>
        entries.append({ id: finding.id, description: finding.description })),
    })
  }

  pure def applyTerminal(
    current: EvaluationInstance,
    task: TaskIdentity,
    terminal: TaskTerminal,
  ): EvaluationInstance = {
    val recorded = match terminal {
      | TaskResultProduced(result) =>
          reportProduced(current, task, decodeEvaluatorResult(result))
      | _ => reportWithoutResult(current, task, terminal)
    }
    concludeStage(recorded)
  }

  pure def resumeBlocked(
    current: EvaluationInstance,
  ): EvaluationInstance = match current.state {
    | EvaluationBlocked(unavailable) => {
        val progress = unavailable.stage
        val generation = progress.generation + 1
        {
          ...current,
          state: Running({
            ...unavailable,
            stage: {
              ...progress,
              generation: generation,
              evaluators: progress.evaluators.keys().fold(
                progress.evaluators,
                (updated, evaluator) => {
                  val status = progress.evaluators.get(evaluator)
                  if (statusBlocked(status)) updated.set(
                    evaluator,
                    Awaiting
                  ) else updated
                }
              ),
            },
          }),
        }
      }
    | _ => current
  }

  pure def currentTaskObligations(
    current: EvaluationInstance,
  ): List[TaskObligation] = match current.state {
    | Running(running) => current.plan.stages[running.stage.stageIndex].evaluators
        .select(entry => statusAwaiting(
          running.stage.evaluators.get(entry.key)))
        .foldl([], (tasks, entry) => tasks.append({
          task: taskIdentityFor(current, running.stage, entry.key),
          definition: entry.task,
          source: current.input.acceptedSource,
          context: [current.input.workResult],
        }))
    | _ => []
  }

  pure def failedEntries(
    evaluator: int,
    status: EvaluatorStatus,
  ): List[EvaluationReworkEntry] = match status {
    | Produced(result) => match result {
        | EvaluatorFailed(detail) => [{
            evaluator: evaluator,
            reason: detail.reason,
            resultManifest: detail.resultManifest,
            findings: detail.findings,
          }]
        | EvaluatorPassed(_) => []
      }
    | _ => []
  }

  pure def findingValid(finding: EvaluationFinding): bool =
    finding.id > 0 and finding.description > 0

  pure def findingsValid(findings: List[EvaluationFinding]): bool =
    findings.length() <= 32
    and findings.indices().forall(index => findingValid(findings[index]))
    and findings.indices().forall(left =>
      findings.indices().forall(right =>
        left == right or findings[left].id != findings[right].id))

  pure def reworkEntries(
    current: EvaluationInstance,
    completedStages: List[StageRun],
  ): List[EvaluationReworkEntry] = {
    val completed = completedStages[completedStages.length() - 1]
    current.plan.stages[completed.stageIndex].evaluators
      .foldl([], (entries, entry) => entries.concat(
        failedEntries(entry.key, completed.evaluators.get(entry.key))))
  }

  pure def stageRunInvariant(
    current: EvaluationInstance,
    progress: StageRun,
  ): bool = {
    val stage = current.plan.stages[progress.stageIndex]
    val defined = evaluatorKeys(stage)
    progress.stageIndex >= 0
    and progress.stageIndex < current.plan.stages.length()
    and progress.generation > 0
    and progress.evaluators.keys() == defined
    and defined.forall(evaluator => {
      val status = progress.evaluators.get(evaluator)
      match status {
        | Awaiting => true
        | Produced(result) => match result {
            | EvaluatorPassed(detail) =>
                detail.resultManifest > 0
            | EvaluatorFailed(detail) =>
                detail.resultManifest > 0 and findingsValid(detail.findings)
          }
        | EvaluatorProcessFailed(evidence) => evidence > 0
        | EvaluatorExecutionUnavailable(evidence) => evidence > 0
      }
    })
  }

  pure def stagePassed(record: StageRun): bool =
    not(stageHasAwaiting(record))
    and not(stageHasFailed(record))
    and not(stageHasBlocked(record))

  pure def completedHistoryInvariant(
    current: EvaluationInstance,
    completedStages: List[StageRun],
  ): bool = completedStages.indices().forall(index => {
      val record = completedStages[index]
      record.stageIndex == index
      and stageRunInvariant(current, record)
      and not(stageHasAwaiting(record))
      and (index + 1 == completedStages.length() or stagePassed(record))
    })

  pure def stateHistoryInvariant(current: EvaluationInstance): bool =
    match current.state {
      | Running(progress) =>
          completedHistoryInvariant(current, progress.completedStages)
          and stageRunInvariant(current, progress.stage)
          and progress.completedStages.length() == progress.stage.stageIndex
          and stageHasAwaiting(progress.stage)
      | EvaluationPassed(completedStages) =>
          completedHistoryInvariant(current, completedStages)
          and completedStages.length() == current.plan.stages.length()
          and completedStages.indices().forall(index =>
            stagePassed(completedStages[index]))
      | EvaluationFailed(completedStages) =>
          completedHistoryInvariant(current, completedStages)
          and completedStages.length() > 0
          and stageHasFailed(completedStages[completedStages.length() - 1])
      | EvaluationBlocked(progress) =>
          completedHistoryInvariant(current, progress.completedStages)
          and stageRunInvariant(current, progress.stage)
          and not(stageHasAwaiting(progress.stage))
          and not(stageHasFailed(progress.stage))
          and stageHasBlocked(progress.stage)
          and progress.completedStages.length() == progress.stage.stageIndex
    }

  pure def begin(
    workCycle: int,
    input: EvaluationInput,
    plan: EvaluationPlan,
  ): EvaluationInstance = {
    val first = plan.stages[0]
    {
      workCycle: workCycle,
      input: input,
      plan: plan,
      state: Running({
        completedStages: [],
        stage: initialStageRun(input.ticket, workCycle, first, 0),
      }),
    }
  }

  pure def stageKeysUnique(plan: EvaluationPlan): bool =
    plan.stages.indices().forall(left =>
      plan.stages.indices().forall(right =>
        left == right or plan.stages[left].key != plan.stages[right].key))

  pure def evaluatorKeysUnique(stage: StageDefinition): bool =
    stage.evaluators.indices().forall(left =>
      stage.evaluators.indices().forall(right =>
        left == right
        or stage.evaluators[left].key != stage.evaluators[right].key))

  pure def planValid(plan: EvaluationPlan): bool =
    plan.stages.length() > 0
    and stageKeysUnique(plan)
    and plan.stages.indices().forall(index => {
      val stage = plan.stages[index]
      stage.key > 0
      and stage.evaluators.length() > 0
      and evaluatorKeysUnique(stage)
      and stage.evaluators.indices().forall(evaluatorIndex => {
        val entry = stage.evaluators[evaluatorIndex]
        entry.key > 0 and taskDefinitionValid(entry.task)
      })
    })

  pure def planUsesRepository(plan: EvaluationPlan, repository: int): bool =
    plan.stages.indices().forall(stageIndex =>
      plan.stages[stageIndex].evaluators.indices().forall(evaluatorIndex =>
        plan.stages[stageIndex].evaluators[evaluatorIndex].task
          .executionRequirements.repository == repository))

  pure def invariant(current: EvaluationInstance): bool =
    current.workCycle > 0
    and current.input.ticket > 0
    and current.input.workResult > 0
    and current.input.acceptedSource.repository > 0
    and current.input.acceptedSource.commit > 0
    and planValid(current.plan)
    and planUsesRepository(
      current.plan,
      current.input.acceptedSource.repository,
    )
    and stateHistoryInvariant(current)
}
