/// Small executable runner machine. Every mutating operation is guarded here;
/// the pure transition functions are decision values, not public actions.
module mc_registered_runner {
  import registered_runner.* from "../runner"
  import execution_capacity.* from "../capacity"

  pure val inventory: CapabilityInventory = {
    platforms: Set(
      { operatingSystem: MacOS, architecture: Arm64 },
      { operatingSystem: Linux, architecture: Arm64 }),
    executionCapabilities: Set(
      "Agent:Claude", "Agent:Codex", "Tool:Xcode", "Simulator:iOS"),
    memoryCeiling: Unbounded,
    agentsAdvertised: false,
    revision: 1
  }
  pure val changedInventory: CapabilityInventory = {
    ...inventory, executionCapabilities: Set("Simulator:iOS"), revision: 2
  }
  /// Every capability of `inventory` under a ceiling below each execution's size.
  pure val smallInventory: CapabilityInventory = {
    ...inventory, memoryCeiling: CeilingMib(2048), revision: 3
  }
  /// Every capability of `inventory` but Claude, advertised as the agents it takes.
  pure val benchedInventory: CapabilityInventory = {
    ...inventory, executionCapabilities: Set("Agent:Codex", "Tool:Xcode", "Simulator:iOS"),
    agentsAdvertised: true, revision: 4
  }
  pure val profile: ExecutionProfile = {
    route: RegisteredRunner, minimumTrust: 1,
    secretsRequired: false, sourceRequired: false, ownerOf: 7
  }
  pure val requirement: ExecutionRequirement = CapabilityRequirement({
    operatingSystem: MacOS, architecture: Arm64, capabilities: Set("Tool:Xcode") })
  pure def execution(id: int): Execution = { id: id, project: 1, ticket: 1, task: id,
    account: 1, sourceSeq: 1, sourceEffect: id - 1, status: Launching }
  pure val profiles: int -> ExecutionProfile = Map(
    1 -> profile,
    2 -> { ...profile, ownerOf: 0 })
  pure def session(rid: int): RunnerSession = { runner: rid, generation: 1,
    leaseOpen: true, slotsOffered: 1, slotsUsed: 0, inventory: inventory }
  pure val owners: Runner = { id: 1, enabled: true,
    draining: false, revoked: false, trust: 1, secretsAllowed: false,
    sourceAllowed: true, owner: 7, allowlist: Set(1), sessionGeneration: 1,
    retainedInventory: inventory }
  pure val initialState: RunnerState = {
    executions: profiles.keys().mapBy(id => execution(id)),
    placements: profiles.keys().mapBy(id => { execution: id, attemptGeneration: 1,
      requirement: requirement, profile: profiles.get(id), requirementIdentity: id,
      requirementDigest: 101, memoryMib: 4096,
      agent: if (id == 2) AgentUnnamed else AgentNamed("Agent:Claude"), phase: Waiting }),
    runners: Map(1 -> owners, 2 -> { ...owners, id: 2 }),
    sessions: Map(1 -> session(1), 2 -> session(2)),
    assignments: Map()
  }
  /// The executions are one owner's and owner-less. Against them runner 1 is
  /// that owner's, another owner's, that owner's without the account
  /// allowlisted, or an owner-less runner, and runner 2 is that owner's or
  /// another owner's.
  pure val initialRunners: Set[Runner] = Set(
    owners,
    { ...owners, owner: 8 },
    { ...owners, allowlist: Set(2) },
    { ...owners, owner: 0 })
  pure val secondRunners: Set[Runner] = Set({ ...owners, id: 2 }, { ...owners, id: 2, owner: 8 })
  pure val assignmentIds: Set[int] = Set(10, 11, 12, 13)

  var runnerState: RunnerState
  action init = all {
    nondet r = initialRunners.oneOf()
    nondet second = secondRunners.oneOf()
    runnerState' = { ...initialState, runners: Map(1 -> r, 2 -> second) }
  }
  action offerAssignment = nondet id = runnerState.placements.keys().oneOf()
    nondet rid = runnerState.runners.keys().oneOf()
    nondet aid = assignmentIds.oneOf()
    all { canAssign(runnerState, id, rid, aid), runnerState' = bindAssignment(runnerState, aid, id, rid) }
  action loseSession = nondet rid = runnerState.sessions.keys().oneOf()
    all { runnerState.sessions.get(rid).leaseOpen, runnerState' = disconnect(runnerState, rid) }
  action observeNoSession = nondet rid = runnerState.sessions.keys().oneOf()
    all {
      runnerState.assignments.keys().forall(aid => runnerState.assignments.get(aid).runner != rid),
      runnerState' = { ...runnerState, sessions: runnerState.sessions.keys().exclude(Set(rid)).mapBy(k => runnerState.sessions.get(k)) }
    }
  action beginDrain = nondet rid = runnerState.runners.keys().oneOf()
    all {
      runnerState.assignments.keys().forall(aid => runnerState.assignments.get(aid).runner != rid),
      runnerState' = { ...runnerState, runners: runnerState.runners.set(rid,
        { ...runnerState.runners.get(rid), draining: true }) }
    }
  action takeover = nondet rid = runnerState.runners.keys().oneOf()
    all {
      runnerState.runners.get(rid).sessionGeneration < 3,
      nondet nextInventory = Set(inventory, changedInventory, smallInventory, benchedInventory).oneOf()
      runnerState' = takeOver(runnerState, rid, nextInventory, 1)
    }
  action runnerReport = nondet aid = assignmentIds.oneOf()
    all { runnerState.assignments.keys().contains(aid), reportIsCurrent(runnerState, aid),
      runnerState' = report(runnerState, aid, 42) }
  action schedulerComplete = nondet aid = assignmentIds.oneOf()
    all { runnerState.assignments.keys().contains(aid), schedulerMayVerify(runnerState, aid),
      runnerState' = schedulerVerify(runnerState, aid) }
  action schedulerCancel = nondet aid = assignmentIds.oneOf()
    all { runnerState.assignments.keys().contains(aid), mayCancel(runnerState, aid),
      runnerState' = cancel(runnerState, aid) }
  action settle = all { runnerState' = runnerState }
  action step = any { offerAssignment, loseSession, observeNoSession, beginDrain, takeover, runnerReport, schedulerComplete, schedulerCancel, settle }

  val allInvariants: bool = and {
    capacitySafe(4, Map(1 -> { reserved: 1, maximum: 4 }), executionSet(runnerState)),
    ledgerIdentityUnchanged(initialState, runnerState),
    assignmentCommitSafe(runnerState),
    completionAuthoritySafe(runnerState),
    inventoryObservationSafe(runnerState),
    personalAssignmentSafe(runnerState),
    pinnedRequirementsUnchanged(initialState, runnerState)
  }
}
