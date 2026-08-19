/// The generated TypeScript API boundary.
///
/// `scripts/generate-model-api.mjs` compiles this module with the repository's
/// pinned Quint and emits every `Api*` alias below without the `Api` prefix.
/// Adding a public model type is therefore an explicit reviewable act. The
/// generator fails closed when an alias reaches a Quint construct it cannot
/// represent faithfully in TypeScript and Zod.
module chuggy_api {
  import chuggy_measure.* from "./measure"
  import chuggy_refinement.* from "./refinement"

  type ApiPhase = Phase
  type ApiTaskKind = TaskKind
  type ApiTaskOutcome = TaskOutcome
  type ApiTaskState = TaskState
  type ApiTask = Task
  type ApiVerdict = Verdict
  type ApiCombinator = Combinator
  type ApiStage = Stage
  type ApiFinalizationPricing = FinalizationPricing
  type ApiReworkPolicy = ReworkPolicy
  type ApiRetryPricing = RetryPricing
  type ApiResume = Resume
  type ApiReason = Reason
  type ApiFinalizationOutcome = FinalizationOutcome
  type ApiFinalizer = Finalizer
  type ApiArtifactMark = ArtifactMark
  type ApiTicket = Ticket
  // `Core` is exposed only to model-facing tooling. Product code should use
  // projections; its map codec is retained so the generator's mapping remains
  // explicit and tested.
  type ApiCore = Core
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
