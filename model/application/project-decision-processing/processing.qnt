module project_decision_processing {
  type ObligationRecord = { contentDigest: int }

  type DomainDecisionRecord = {
    eventDigest: int,
    obligations: List[ObligationRecord],
  }

  type DomainOutcome =
    Decided(DomainDecisionRecord)
    | Refused(int)

  type AuthorizationRecord = {
    principal: int,
    authorizedOperation: int,
    policyRevision: int,
  }

  type AcceptedInput = {
    id: int,
    ordinal: int,
    contentDigest: int,
    authorization: AuthorizationRecord,
  }

  type PublishedOutcome = {
    position: int,
    input: AcceptedInput,
    outcome: DomainOutcome,
  }

  type DeliverableObligation = {
    outcomePosition: int,
    obligationOrdinal: int,
    obligation: ObligationRecord,
  }

  type ProcessingState = {
    nextOrdinal: int,
    inputs: int -> AcceptedInput,
    outcomes: List[PublishedOutcome],
  }

  pure def hasOutcome(state: ProcessingState, inputId: int): bool =
    state.outcomes.indices().exists(index =>
      state.outcomes[index].input.id == inputId)

  pure def mayAccept(
    state: ProcessingState,
    inputId: int,
    contentDigest: int,
    authorization: AuthorizationRecord,
  ): bool =
    not(state.inputs.keys().contains(inputId))
    or (state.inputs.get(inputId).contentDigest == contentDigest
      and state.inputs.get(inputId).authorization == authorization)

  pure def accept(
    state: ProcessingState,
    inputId: int,
    contentDigest: int,
    authorization: AuthorizationRecord,
  ): ProcessingState =
    if (state.inputs.keys().contains(inputId)) state
    else {
      ...state,
      nextOrdinal: state.nextOrdinal + 1,
      inputs: state.inputs.put(inputId, {
        id: inputId,
        ordinal: state.nextOrdinal,
        contentDigest: contentDigest,
        authorization: authorization,
      }),
    }

  pure def isHeadUnsettled(state: ProcessingState, inputId: int): bool =
    state.inputs.keys().contains(inputId)
    and not(hasOutcome(state, inputId))
    and state.inputs.keys().forall(other =>
      hasOutcome(state, other)
      or state.inputs.get(inputId).ordinal <= state.inputs.get(other).ordinal)

  pure def publishOutcome(
    state: ProcessingState,
    inputId: int,
    outcome: DomainOutcome,
  ): ProcessingState =
    if (hasOutcome(state, inputId)) state
    else {
      ...state,
      outcomes: state.outcomes.append({
        position: state.outcomes.length() + 1,
        input: state.inputs.get(inputId),
        outcome: outcome,
      }),
    }

  pure def eventProjection(state: ProcessingState): List[int] =
    state.outcomes.foldl([], (events, entry) => match entry.outcome {
      | Decided(decision) => events.append(decision.eventDigest)
      | Refused(_) => events
    })

  pure def outcomeObligations(
    entry: PublishedOutcome,
  ): List[DeliverableObligation] = (match entry.outcome {
      | Refused(_) => []
      | Decided(decision) =>
          range(0, decision.obligations.length()).foldl(
            [],
            (found, index) => found.append({
              outcomePosition: entry.position,
              obligationOrdinal: index,
              obligation: decision.obligations[index],
            })
          )
    })

  pure def deliverableObligations(
    state: ProcessingState,
  ): List[DeliverableObligation] =
    state.outcomes.foldl([], (derived, entry) =>
      derived.concat(outcomeObligations(entry)))

  pure def positionsAreDense(state: ProcessingState): bool =
    state.outcomes.indices().forall(index =>
      state.outcomes[index].position == index + 1)

  pure def outcomeInputsAreUnique(state: ProcessingState): bool =
    state.outcomes.indices().forall(left =>
      state.outcomes.indices().forall(right =>
        left == right
        or state.outcomes[left].input.id != state.outcomes[right].input.id))

  pure def outcomeAttributionMatches(state: ProcessingState): bool =
    state.outcomes.indices().forall(index =>
      val entry = state.outcomes[index]
      state.inputs.keys().contains(entry.input.id)
      and state.inputs.get(entry.input.id) == entry.input)

  pure def outcomesAreValid(state: ProcessingState): bool =
    state.outcomes.indices().forall(index =>
      match state.outcomes[index].outcome {
        | Decided(decision) => decision.eventDigest > 0
        | Refused(reasonDigest) => reasonDigest > 0
      })

  pure def invariant(state: ProcessingState): bool =
    positionsAreDense(state)
    and outcomeInputsAreUnique(state)
    and outcomeAttributionMatches(state)
    and outcomesAreValid(state)
}
