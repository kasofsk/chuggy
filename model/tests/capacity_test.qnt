/// Focused safety examples for the separate execution-capacity model.

module execution_capacity_test {
  import execution_capacity.* from "../capacity"

  pure val entitlements = Map(
    1 -> { reserved: 4, maximum: 10 },
    2 -> { reserved: 6, maximum: 10 })

  pure def active(account: int, from: int, count: int): Set[Execution] =
    0.to(count - 1).map(i => {
      id: from + i,
      ticket: account,
      task: from + i,
      account: account,
      sourceSeq: account,
      sourceEffect: 0,
      status: Admitted
    })

  pure val fourSix = active(1, 1, 4).union(active(2, 100, 6))
  pure val fourFive = active(1, 1, 4).union(active(2, 100, 5))
  pure val eleven = fourSix.union(Set({
    id: 200, ticket: 1, task: 200, account: 1,
    sourceSeq: 1, sourceEffect: 0, status: Running }))
  pure val queuedSurplus = fourSix.union(
    0.to(9).map(i => {
      id: 300 + i, ticket: 3, task: 300 + i, account: 1,
      sourceSeq: 3, sourceEffect: 0, status: Queued }))

  pure val queuedA: Execution = {
    id: 500, ticket: 5, task: 1, account: 1,
    sourceSeq: 5, sourceEffect: 0, status: Queued }
  pure val queuedB: Execution = {
    id: 600, ticket: 6, task: 1, account: 2,
    sourceSeq: 6, sourceEffect: 0, status: Queued }
  pure val duplicateIdentity = Set(
    queuedA,
    { ...queuedA, id: 501, sourceEffect: 1 })

  run reservationSplitIsSafe = assert(capacitySafe(10, entitlements, fourSix))
  run clusterOverallocationIsRefused = assert(not(capacitySafe(10, entitlements, eleven)))
  run queuedWorkOwnsNoSlot = assert(capacitySafe(10, entitlements, queuedSurplus))
  run duplicateLogicalTaskIsRefused = assert(not(capacitySafe(10, entitlements, duplicateIdentity)))
  run terminalIsAbsorbing = assert(and {
    legalStatusMove(Terminal, Terminal),
    not(legalStatusMove(Terminal, Queued)),
    not(legalStatusMove(Cancelled, Admitted))
  })
  run maximumAndClusterGateAdmission = assert(and {
    mayAdmit(10, entitlements, fourFive, queuedA),
    not(mayAdmit(10, entitlements, fourSix, queuedA))
  })
  run reservationDeficitBeatsBorrowing = assert(
    preferredOver(entitlements, active(1, 1, 4), queuedB, queuedA))
}
