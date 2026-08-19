/// Focused safety examples for the separate execution-capacity model.

module execution_capacity_test {
  import execution_capacity.* from "../capacity"

  pure val entitlements = Map(
    1 -> { reserved: 4, maximum: 10 },
    2 -> { reserved: 6, maximum: 10 })

  pure def active(project: int, account: int, from: int, count: int): Set[Execution] =
    0.to(count - 1).map(i => {
      id: from + i,
      project: project,
      ticket: account,
      task: from + i,
      account: account,
      sourceSeq: account,
      sourceEffect: 0,
      status: Admitted
    })

  pure val fourSix = active(1, 1, 1, 4).union(active(2, 2, 100, 6))
  pure val fourFive = active(1, 1, 1, 4).union(active(2, 2, 100, 5))
  pure val eleven = fourSix.union(Set({
    id: 200, project: 1, ticket: 1, task: 200, account: 1,
    sourceSeq: 1, sourceEffect: 0, status: Running }))
  pure val queuedSurplus = fourSix.union(
    0.to(9).map(i => {
      id: 300 + i, project: 1, ticket: 3, task: 300 + i, account: 1,
      sourceSeq: 3, sourceEffect: 0, status: Queued }))

  pure val queuedA: Execution = {
    id: 500, project: 1, ticket: 5, task: 1, account: 1,
    sourceSeq: 5, sourceEffect: 0, status: Queued }
  pure val queuedB: Execution = {
    id: 600, project: 2, ticket: 6, task: 1, account: 2,
    sourceSeq: 6, sourceEffect: 0, status: Queued }
  pure val duplicateIdentity = Set(
    queuedA,
    { ...queuedA, id: 501, sourceEffect: 1 })

  /// Project-local ticket and task ids repeat across projects. Both
  /// registrations are live, and the ledger spans both.
  pure val crossProject = Set(
    { id: 700, project: 1, ticket: 3, task: 1, account: 1,
      sourceSeq: 7, sourceEffect: 0, status: Running },
    { id: 701, project: 2, ticket: 3, task: 1, account: 2,
      sourceSeq: 7, sourceEffect: 0, status: Running })

  pure val unprovenanced = Set({ ...queuedA, project: 0 })

  run reservationSplitIsSafeTest = assert(capacitySafe(10, entitlements, fourSix))
  run clusterOverallocationIsRefusedTest = assert(not(capacitySafe(10, entitlements, eleven)))
  run queuedWorkOwnsNoSlotTest = assert(capacitySafe(10, entitlements, queuedSurplus))
  run duplicateLogicalTaskIsRefusedTest = assert(not(capacitySafe(10, entitlements, duplicateIdentity)))
  run sameIdsInTwoProjectsAreDistinctTest = assert(and {
    capacitySafe(10, entitlements, crossProject),
    identityUnique(crossProject),
    activeCount(crossProject) == 2
  })
  run registrationWithoutAProjectIsRefusedTest = assert(and {
    not(provenanceWellFormed(unprovenanced)),
    not(capacitySafe(10, entitlements, unprovenanced))
  })
  run terminalIsAbsorbingTest = assert(and {
    legalStatusMove(Terminal, Terminal),
    not(legalStatusMove(Terminal, Queued)),
    not(legalStatusMove(Cancelled, Admitted))
  })
  run maximumAndClusterGateAdmissionTest = assert(and {
    mayAdmit(10, entitlements, fourFive, queuedA),
    not(mayAdmit(10, entitlements, fourSix, queuedA))
  })
  run reservationDeficitBeatsBorrowingTest = assert(
    preferredOver(entitlements, active(1, 1, 1, 4), queuedB, queuedA))
}
