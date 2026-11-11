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
  run terminalIsAbsorbingTest = assert(Set(true, false).forall(named => and {
    legalStatusMove(Terminal, Terminal, named),
    not(legalStatusMove(Terminal, Queued, named)),
    not(legalStatusMove(Cancelled, Admitted, named))
  }))

  pure val statuses = Set(Queued, Admitted, Launching, Running, Terminal, Cancelled)
  /// The moves an execution that names a requirement may make, written out
  /// pair by pair so a change to any arm of `legalStatusMove` is seen here.
  pure val requirementBearingMoves = Set(
    (Queued, Admitted), (Queued, Cancelled),
    (Admitted, Launching), (Admitted, Terminal), (Admitted, Cancelled),
    (Launching, Running), (Launching, Terminal), (Launching, Cancelled),
    (Running, Terminal), (Running, Cancelled),
    (Terminal, Terminal), (Cancelled, Cancelled))

  run requirementBearingMovesAreExactlyTheTableTest = assert(
    tuples(statuses, statuses).forall(m =>
      legalStatusMove(m._1, m._2, true) == requirementBearingMoves.contains(m)))
  run requirementlessMovesAddOnlyQueuedToTerminalTest = assert(
    tuples(statuses, statuses).forall(m =>
      legalStatusMove(m._1, m._2, false) ==
        requirementBearingMoves.union(Set((Queued, Terminal))).contains(m)))

  /// One registration beside the ledger `fourSix`, moved by `legalStatusMove`
  /// alone, with whether it names a requirement fixed when it registers.
  var registered: Execution
  var registeredRequirementNamed: bool

  action register(named: bool): bool = all {
    registered' = queuedA,
    registeredRequirementNamed' = named
  }
  action move(after: ExecutionStatus): bool = all {
    legalStatusMove(registered.status, after, registeredRequirementNamed),
    registered' = { ...registered, status: after },
    registeredRequirementNamed' = registeredRequirementNamed
  }
  action holdsNoSlotSafely: bool = all {
    assert(activeCount(fourSix.union(Set(registered))) == activeCount(fourSix)),
    assert(capacitySafe(10, entitlements, fourSix.union(Set(registered)))),
    registered' = registered,
    registeredRequirementNamed' = registeredRequirementNamed
  }

  run requirementlessQueuedReachesTerminalTest =
    register(false)
      .then(holdsNoSlotSafely)
      .then(move(Terminal))
      .then(holdsNoSlotSafely)
      .then(all {
        assert(registered.status == Terminal),
        registered' = registered,
        registeredRequirementNamed' = registeredRequirementNamed
      })
  run requirementBearingQueuedNeverReachesTerminalTest =
    register(true).then(move(Terminal)).fail()
  run requirementBearingQueuedStillReachesTerminalByAdmissionTest =
    register(true)
      .then(move(Admitted))
      .then(move(Terminal))
      .then(all {
        assert(registered.status == Terminal),
        registered' = registered,
        registeredRequirementNamed' = registeredRequirementNamed
      })
  run maximumAndClusterGateAdmissionTest = assert(and {
    mayAdmit(10, entitlements, fourFive, queuedA),
    not(mayAdmit(10, entitlements, fourSix, queuedA))
  })
  run reservationDeficitBeatsBorrowingTest = assert(
    preferredOver(entitlements, active(1, 1, 1, 4), queuedB, queuedA))
}
