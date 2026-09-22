module task_contract {
  type WorkTaskIdentity = { ticket: int, cycle: int }

  type EvaluationTaskIdentity = {
    ticket: int,
    workCycle: int,
    stage: int,
    generation: int,
    evaluator: int
  }

  type TaskIdentity =
    WorkTask(WorkTaskIdentity)
    | EvaluationTask(EvaluationTaskIdentity)

  type TaskDefinition = {
    workload: int,
    inputs: int,
    executionRequirements: int,
    resultContract: int
  }

  type TaskObligation = {
    task: TaskIdentity,
    definition: TaskDefinition,
    contextRef: int
  }

  type ValidatedTaskResult = {
    obligation: TaskObligation,
    resultRef: int
  }

  type TaskFailure = { task: TaskIdentity, evidence: int }

  type TaskTerminal =
    TaskResultProduced(ValidatedTaskResult)
    | TaskProcessFailed(TaskFailure)
    | TaskExecutionUnavailable(TaskFailure)

  pure def taskOwner(task: TaskIdentity): int = match task {
    | WorkTask(identity) => identity.ticket
    | EvaluationTask(identity) => identity.ticket
  }

  pure def taskIdentityValid(task: TaskIdentity): bool = match task {
    | WorkTask(identity) => identity.ticket > 0 and identity.cycle > 0
    | EvaluationTask(identity) =>
        identity.ticket > 0
        and identity.workCycle > 0
        and identity.stage > 0
        and identity.generation > 0
        and identity.evaluator > 0
  }

  pure def taskDefinitionValid(definition: TaskDefinition): bool =
    definition.workload > 0
    and definition.inputs > 0
    and definition.executionRequirements > 0
    and definition.resultContract > 0

  pure def taskObligationValid(obligation: TaskObligation): bool =
    taskIdentityValid(obligation.task)
    and taskDefinitionValid(obligation.definition)
    and obligation.contextRef > 0

  pure def validatedTaskResult(
    obligation: TaskObligation,
    resultRef: int,
  ): ValidatedTaskResult = {
    obligation: obligation,
    resultRef: resultRef,
  }

  pure def terminalTask(terminal: TaskTerminal): TaskIdentity = match terminal {
    | TaskResultProduced(result) => result.obligation.task
    | TaskProcessFailed(failure) => failure.task
    | TaskExecutionUnavailable(failure) => failure.task
  }

  pure def terminalValid(terminal: TaskTerminal): bool = match terminal {
    | TaskResultProduced(result) =>
        taskObligationValid(result.obligation) and result.resultRef > 0
    | TaskProcessFailed(failure) =>
        taskIdentityValid(failure.task) and failure.evidence > 0
    | TaskExecutionUnavailable(failure) =>
        taskIdentityValid(failure.task) and failure.evidence > 0
  }
}
