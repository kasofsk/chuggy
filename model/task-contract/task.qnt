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

  type GitAccess = ReadRepository | PublishRepositoryResult

  type ExecutionRequirements = {
    repository: int,
    access: GitAccess,
    requiredCapabilities: Set[str],
  }

  type WorkspaceSource = { repository: int, commit: int }

  type OutputRef = GitOutput(WorkspaceSource)

  type TaskDefinition = {
    workload: int,
    inputs: int,
    executionRequirements: ExecutionRequirements,
    resultContract: int
  }

  type TaskObligation = {
    task: TaskIdentity,
    definition: TaskDefinition,
    source: WorkspaceSource,
    context: List[int]
  }

  type ResultFinding = { id: int, description: int }

  type ValidatedTaskResult = {
    obligation: TaskObligation,
    manifest: int,
    outputs: List[OutputRef],
    value: int,
    findings: List[ResultFinding]
  }

  type TaskFailure = {
    task: TaskIdentity,
    evidence: int
  }

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
    and definition.executionRequirements.repository > 0
    and definition.executionRequirements.requiredCapabilities.forall(name => name != "")
    and definition.resultContract > 0

  pure def readsRepository(definition: TaskDefinition, repository: int): bool =
    definition.executionRequirements.repository == repository
    and definition.executionRequirements.access == ReadRepository

  pure def publishesRepositoryResult(
    definition: TaskDefinition,
    repository: int,
  ): bool =
    definition.executionRequirements.repository == repository
    and definition.executionRequirements.access == PublishRepositoryResult

  pure def taskObligationValid(obligation: TaskObligation): bool =
    taskIdentityValid(obligation.task)
    and taskDefinitionValid(obligation.definition)
    and obligation.source.repository > 0
    and obligation.source.commit > 0
    and obligation.source.repository
      == obligation.definition.executionRequirements.repository

  pure def validatedTaskResult(
    obligation: TaskObligation,
    manifest: int,
    outputs: List[OutputRef],
    value: int,
    findings: List[ResultFinding],
  ): ValidatedTaskResult = {
    obligation: obligation,
    manifest: manifest,
    outputs: outputs,
    value: value,
    findings: findings,
  }

  pure def exactGitOutput(result: ValidatedTaskResult): WorkspaceSource =
    match result.outputs[0] {
      | GitOutput(output) => output
    }

  pure def hasExactGitOutput(result: ValidatedTaskResult): bool =
    result.outputs.length() == 1
    and match result.outputs[0] {
      | GitOutput(output) => output.repository
          == result.obligation.definition.executionRequirements.repository
        and output.repository == result.obligation.source.repository
        and output.commit > 0
    }

  pure def terminalTask(terminal: TaskTerminal): TaskIdentity = match terminal {
    | TaskResultProduced(result) => result.obligation.task
    | TaskProcessFailed(failure) => failure.task
    | TaskExecutionUnavailable(failure) => failure.task
  }

  pure def resultFindingValid(finding: ResultFinding): bool =
    finding.id > 0 and finding.description > 0

  pure def resultFindingsValid(findings: List[ResultFinding]): bool =
    findings.length() <= 32
    and findings.indices().forall(index => resultFindingValid(findings[index]))
    and findings.indices().forall(left =>
      findings.indices().forall(right =>
        left == right or findings[left].id != findings[right].id))

  pure def terminalValid(terminal: TaskTerminal): bool = match terminal {
    | TaskResultProduced(result) =>
        taskObligationValid(result.obligation) and result.manifest > 0
        and resultFindingsValid(result.findings)
    | TaskProcessFailed(failure) =>
        taskIdentityValid(failure.task) and failure.evidence > 0
    | TaskExecutionUnavailable(failure) =>
        taskIdentityValid(failure.task) and failure.evidence > 0
  }
}
