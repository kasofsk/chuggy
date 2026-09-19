module postgres_ticket_processing {
  import project_decision_processing.* from "./processing"

  pure def publishHead(
    state: ProcessingState,
    inputId: int,
    outcome: DomainOutcome,
  ): ProcessingState =
    if (isHeadUnsettled(state, inputId)) publishOutcome(state, inputId, outcome)
    else state

  pure def outcomesFollowAcceptance(state: ProcessingState): bool =
    state.outcomes.indices().forall(index =>
      state.outcomes[index].input.ordinal == index + 1)

  pure def postgresInvariant(state: ProcessingState): bool =
    invariant(state) and outcomesFollowAcceptance(state)
}
