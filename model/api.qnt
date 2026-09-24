/// The generated TypeScript API boundary.
///
/// `scripts/generate-model-api.ts` compiles this module with the repository's
/// pinned Quint and emits every `Api*` alias below without the `Api` prefix.
/// Adding a public model type is therefore an explicit reviewable act. The
/// generator fails closed when an alias reaches a Quint construct it cannot
/// represent faithfully in TypeScript and Zod.
module chuggy_api {
  import task_contract.* from "./task-contract/task"
  import evaluation_protocol.* from "./ticket-domain/evaluation/evaluation"
  import chuggy_ticket.* from "./ticket"
  import chuggy_refinement.* from "./refinement"
  import chuggy_identity.* from "./identity"

  type ApiPhase = Phase
  type ApiWorkTaskIdentity = WorkTaskIdentity
  type ApiEvaluationTaskIdentity = EvaluationTaskIdentity
  type ApiTaskIdentity = TaskIdentity
  type ApiFailureKind = FailureKind
  type ApiTaskDefinition = TaskDefinition
  type ApiTaskObligation = TaskObligation
  type ApiTaskFailure = TaskFailure
  type ApiValidatedTaskResult = ValidatedTaskResult
  type ApiTaskTerminalReport = TaskTerminalReport
  type ApiEvaluatorDefinition = EvaluatorDefinition
  type ApiStageDefinition = StageDefinition
  type ApiEvaluationPlan = EvaluationPlan
  type ApiEvaluationInput = EvaluationInput
  type ApiEvaluationVerdict = EvaluationVerdict
  type ApiEvaluatorResult = EvaluatorResult
  type ApiEvaluatorStatus = EvaluatorStatus
  type ApiEvaluationReworkEntry = EvaluationReworkEntry
  type ApiStageRun = StageRun
  type ApiEvaluationProgress = EvaluationProgress
  type ApiEvaluationState = EvaluationState
  type ApiEvaluationInstance = EvaluationInstance
  type ApiEvaluationFailureDisposition = EvaluationFailureDisposition
  type ApiResume = Resume
  type ApiEscalation = Escalation
  type ApiFinalizationResult = FinalizationResult
  type ApiFinalizationResultReport = FinalizationResultReport
  type ApiArtifactMark = ArtifactMark
  type ApiReleasedContent = ReleasedContent
  type ApiReleasedTicket = ReleasedTicket
  type ApiTicket = Ticket
  type ApiInstallationId = InstallationId
  type ApiTicketRef = TicketRef
  // `TicketGraph` is exposed only to model-facing tooling. Product code
  // should use projections; its map codec is retained so the generator's
  // mapping remains explicit and tested.
  type ApiTicketGraph = TicketGraph
  type ApiFinalizationOperation = FinalizationOperation
  type ApiTaskTerminalFact = TaskTerminalFact
  type ApiEvaluationReworkFact = EvaluationReworkFact
  type ApiWorkResultAcceptedEvent = WorkResultAcceptedEvent
  type ApiWorkFailureEvent = WorkFailureEvent
  type ApiFinalizationFact = FinalizationFact
  type ApiTicketUpdate = TicketUpdate
  type ApiTicketEvent = TicketEvent
  type ApiTicketTaskObligation = TicketTaskObligation
  type ApiFinalizationObligation = FinalizationObligation
  type ApiTaskCancellation = TaskCancellation
  type ApiObligation = Obligation
  type ApiSuccessfulTicketDecision = SuccessfulTicketDecision
  type ApiTicketCommand = TicketCommand
  type ApiIncompleteDependencies = IncompleteDependencies
  type ApiCurrentTaskRefusal = CurrentTaskRefusal
  type ApiCurrentFinalizationRefusal = CurrentFinalizationRefusal
  type ApiStaleRevision = StaleRevision
  type ApiTicketRefusal = TicketRefusal
  type ApiTicketDecision = TicketDecision
  type ApiLastDecision = LastDecision

  type ApiEntry = Entry

  // Quint's JSON compiler expects a runnable module. These private no-op
  // actions make the API module compilable without becoming part of the
  // exported type boundary above.
  var apiClock: int
  action apiInit = all { apiClock' = 0 }
  action apiStep = all { apiClock' = apiClock }
}
