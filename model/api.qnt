/// The generated TypeScript API boundary.
///
/// `scripts/generate-model-api.ts` compiles this module with the repository's
/// pinned Quint and emits every `Api*` alias below without the `Api` prefix.
/// Adding a public model type is therefore an explicit reviewable act. The
/// generator fails closed when an alias reaches a Quint construct it cannot
/// represent faithfully in TypeScript and Zod.
module chuggy_api {
  import task_contract.* from "./task-contract/task"
  import chuggy_ticket.* from "./ticket"
  import chuggy_refinement.* from "./refinement"
  import chuggy_identity.* from "./identity"

  type ApiPhase = Phase
  type ApiWorkTaskIdentity = WorkTaskIdentity
  type ApiEvaluationTaskIdentity = EvaluationTaskIdentity
  type ApiTaskIdentity = TaskIdentity
  type ApiTaskOutcome = TaskOutcome
  type ApiTaskState = TaskState
  type ApiTask = Task
  type ApiVerdict = Verdict
  type ApiEvaluatorDefinition = EvaluatorDefinition
  type ApiStageDefinition = StageDefinition
  type ApiEvaluationFailureDisposition = EvaluationFailureDisposition
  type ApiResume = Resume
  type ApiEscalation = Escalation
  type ApiFinalizationOutcome = FinalizationOutcome
  type ApiArtifactMark = ArtifactMark
  type ApiTicket = Ticket
  type ApiInstallationId = InstallationId
  type ApiTicketRef = TicketRef
  // `TicketGraph` is exposed only to model-facing tooling. Product code
  // should use projections; its map codec is retained so the generator's
  // mapping remains explicit and tested.
  type ApiTicketGraph = TicketGraph
  type ApiTransition = Transition
  type ApiStepRecord = StepRecord

  type ApiTaskResultRef = TaskResultRef
  type ApiDecisionEvent = DecisionEvent
  type ApiEntry = Entry

  // Quint's JSON compiler expects a runnable module. These private no-op
  // actions make the API module compilable without becoming part of the
  // exported type boundary above.
  var apiClock: int
  action apiInit = all { apiClock' = 0 }
  action apiStep = all { apiClock' = apiClock }
}
