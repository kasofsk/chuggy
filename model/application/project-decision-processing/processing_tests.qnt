module project_decision_processing_tests {
  import project_decision_processing.* from "processing"
  import postgres_ticket_processing as postgres from "./postgres"

  pure val empty: ProcessingState = { nextOrdinal: 1, inputs: Map(), outcomes: [] }
  pure val authorization: AuthorizationRecord = { principal: 1, authorizedOperation: 2, policyRevision: 3 }
  pure val first = accept(empty, 10, 100, authorization)
  pure val both = accept(first, 20, 200, authorization)
  pure val refused = publishOutcome(both, 10, Refused(300))
  pure val decided = publishOutcome(refused, 20, Decided({
    eventDigest: 400, obligations: [{ contentDigest: 500 }, { contentDigest: 600 }],
  }))

  run acceptanceIdentityTest = assert(and {
    mayAccept(first, 10, 100, authorization),
    accept(first, 10, 100, authorization) == first,
    not(mayAccept(first, 10, 101, authorization)),
    not(mayAccept(first, 10, 100, { ...authorization, principal: 2 })),
    not(mayAccept(first, 10, 100, { ...authorization, policyRevision: 4 })),
  })

  run headOrderingTest = assert(and {
    isHeadUnsettled(both, 10), not(isHeadUnsettled(both, 20)),
    not(isHeadUnsettled(refused, 10)), isHeadUnsettled(refused, 20),
    postgres::publishHead(both, 20, Refused(300)) == both,
    postgres::publishHead(both, 10, Refused(300)) == refused,
    postgres::postgresInvariant(decided),
    not(postgres::outcomesFollowAcceptance(publishOutcome(both, 20, Refused(300)))),
  })

  run refusalHasPositionWithoutEventTest = assert(and {
    invariant(decided), decided.outcomes.length() == 2,
    eventProjection(decided) == [400],
    publishOutcome(decided, 10, Refused(999)) == decided,
  })

  run obligationProvenanceTest = assert(deliverableObligations(decided) == [
    { outcomePosition: 2, obligationOrdinal: 0, obligation: { contentDigest: 500 } },
    { outcomePosition: 2, obligationOrdinal: 1, obligation: { contentDigest: 600 } },
  ])
}
