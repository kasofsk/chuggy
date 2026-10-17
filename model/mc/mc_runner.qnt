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
    revision: 1
  }
  pure val changedInventory: CapabilityInventory = {
    ...inventory, executionCapabilities: Set("Simulator:iOS"), revision: 2
  }
  pure val profile: ExecutionProfile = {
    route: RegisteredRunner, personalRunnerAllowed: true, minimumTrust: 1,
    secretsRequired: false, sourceRequired: false, dedicatedOwnerRequired: 0,
    ownerOf: 7, ownerFallback: Preferred
  }
  pure val requirement: ExecutionRequirement = CapabilityRequirement({
    operatingSystem: MacOS, architecture: Arm64, capabilities: Set("Tool:Xcode") })
  pure def execution(id: int): Execution = { id: id, project: 1, ticket: 1, task: id,
    account: 1, sourceSeq: 1, sourceEffect: id - 1, status: Launching }
  pure val profiles: int -> ExecutionProfile = Map(
    1 -> profile,
    2 -> { ...profile, ownerOf: 0 },
    3 -> { ...profile, personalRunnerAllowed: false },
    4 -> { ...profile, ownerFallback: Strict })
  pure def session(rid: int): RunnerSession = { runner: rid, generation: 1,
    leaseOpen: true, slotsOffered: 1, slotsUsed: 0, inventory: inventory }
  pure val owners: Runner = { id: 1, account: 1, class: Personal, enabled: true,
    draining: false, revoked: false, trust: 1, secretsAllowed: false,
    sourceAllowed: true, dedicatedOwner: 7, allowlist: Set(1), sessionGeneration: 1,
    retainedInventory: inventory }
  pure val dedicated: Runner = { ...owners, id: 2, class: Dedicated, dedicatedOwner: 0, allowlist: Set() }
  pure val initialState: RunnerState = {
    executions: profiles.keys().mapBy(id => execution(id)),
    placements: profiles.keys().mapBy(id => { execution: id, attemptGeneration: 1,
      requirement: requirement, profile: profiles.get(id), requirementIdentity: id,
      requirementDigest: 101, phase: Waiting }),
    runners: Map(1 -> owners, 2 -> dedicated),
    sessions: Map(1 -> session(1), 2 -> session(2)),
    assignments: Map()
  }
  /// The executions are one owner's under a Preferred fallback, owner-less,
  /// the same owner's refusing a Personal runner, and the same owner's under a
  /// Strict fallback. Against them runner 1 is that owner's, another owner's,
  /// that owner's without the account allowlisted, an owner-less Personal
  /// runner, or a Dedicated runner of the account, and runner 2 is a
  /// Dedicated runner of the account or of another.
  pure val initialRunners: Set[Runner] = Set(
    owners,
    { ...owners, dedicatedOwner: 8 },
    { ...owners, allowlist: Set(2) },
    { ...owners, dedicatedOwner: 0 },
    { ...owners, class: Dedicated, dedicatedOwner: 0, allowlist: Set() })
  pure val secondRunners: Set[Runner] = Set(dedicated, { ...dedicated, account: 2 })
  pure val assignmentIds: Set[int] = Set(10, 11, 12, 13)

  /// Whether a Personal runner of the execution's owner is configured for its
  /// placement and can run its requirement.
  pure def ownedBy(s: RunnerState, id: int, o: int): bool =
    val r = s.runners.get(o)
    val p = s.placements.get(id)
    and { r.class == Personal, policyConfigures(r, executionById(s, id), p.profile), inventoryMatches(p.requirement, r.retainedInventory) }
  /// Whether binding would give a non-Personal runner a Strict execution whose
  /// owner has a runner for it.
  pure def bindsPastStrictOwner(s: RunnerState, id: int, rid: int): bool = and {
    s.runners.get(rid).class != Personal, s.placements.get(id).profile.ownerFallback == Strict,
    s.runners.keys().exists(o => ownedBy(s, id, o))
  }
  /// Whether binding would give a non-Personal runner an execution while one
  /// of its owner's runners for it takes new work under a current session.
  pure def bindsPastLiveOwner(s: RunnerState, id: int, rid: int): bool = and {
    s.runners.get(rid).class != Personal,
    s.runners.keys().exists(o => and {
      ownedBy(s, id, o), not(s.runners.get(o).draining),
      if (s.sessions.keys().contains(o)) sessionIsCurrent(s.runners.get(o), s.sessions.get(o)) else false
    })
  }

  var runnerState: RunnerState
  /// Whether some binding gave a non-Personal runner a Strict execution whose
  /// owner had a runner for it. A binding is judged when it is made, since an
  /// owner's runner can gain the inventory or the session after another
  /// runner took the work, and nothing after the binding undoes it.
  var boundPastStrictOwner: bool
  /// Whether some binding gave a non-Personal runner an execution while one of
  /// its owner's runners for it was live.
  var boundPastLiveOwner: bool
  action ghostsKept = all { boundPastStrictOwner' = boundPastStrictOwner, boundPastLiveOwner' = boundPastLiveOwner }
  action init = all {
    nondet r = initialRunners.oneOf()
    nondet second = secondRunners.oneOf()
    runnerState' = { ...initialState, runners: Map(1 -> r, 2 -> second) },
    boundPastStrictOwner' = false,
    boundPastLiveOwner' = false
  }
  action offerAssignment = nondet id = runnerState.placements.keys().oneOf()
    nondet rid = runnerState.runners.keys().oneOf()
    nondet aid = assignmentIds.oneOf()
    all { canAssign(runnerState, id, rid, aid), runnerState' = bindAssignment(runnerState, aid, id, rid),
      boundPastStrictOwner' = (boundPastStrictOwner or bindsPastStrictOwner(runnerState, id, rid)),
      boundPastLiveOwner' = (boundPastLiveOwner or bindsPastLiveOwner(runnerState, id, rid)) }
  action loseSession = nondet rid = runnerState.sessions.keys().oneOf()
    all { runnerState.sessions.get(rid).leaseOpen, runnerState' = disconnect(runnerState, rid), ghostsKept }
  action observeNoSession = nondet rid = runnerState.sessions.keys().oneOf()
    all {
      runnerState.assignments.keys().forall(aid => runnerState.assignments.get(aid).runner != rid),
      runnerState' = { ...runnerState, sessions: runnerState.sessions.keys().exclude(Set(rid)).mapBy(k => runnerState.sessions.get(k)) },
      ghostsKept
    }
  action beginDrain = nondet rid = runnerState.runners.keys().oneOf()
    all {
      runnerState.assignments.keys().forall(aid => runnerState.assignments.get(aid).runner != rid),
      runnerState' = { ...runnerState, runners: runnerState.runners.set(rid,
        { ...runnerState.runners.get(rid), draining: true }) },
      ghostsKept
    }
  action takeover = nondet rid = runnerState.runners.keys().oneOf()
    all {
      runnerState.runners.get(rid).sessionGeneration < 3,
      nondet nextInventory = Set(inventory, changedInventory).oneOf()
      runnerState' = takeOver(runnerState, rid, nextInventory, 1),
      ghostsKept
    }
  action runnerReport = nondet aid = assignmentIds.oneOf()
    all { runnerState.assignments.keys().contains(aid), reportIsCurrent(runnerState, aid),
      runnerState' = report(runnerState, aid, 42), ghostsKept }
  action schedulerComplete = nondet aid = assignmentIds.oneOf()
    all { runnerState.assignments.keys().contains(aid), schedulerMayVerify(runnerState, aid),
      runnerState' = schedulerVerify(runnerState, aid), ghostsKept }
  action schedulerCancel = nondet aid = assignmentIds.oneOf()
    all { runnerState.assignments.keys().contains(aid), mayCancel(runnerState, aid),
      runnerState' = cancel(runnerState, aid), ghostsKept }
  action settle = all { runnerState' = runnerState, ghostsKept }
  action step = any { offerAssignment, loseSession, observeNoSession, beginDrain, takeover, runnerReport, schedulerComplete, schedulerCancel, settle }

  val allInvariants: bool = and {
    capacitySafe(4, Map(1 -> { reserved: 1, maximum: 4 }), executionSet(runnerState)),
    ledgerIdentityUnchanged(initialState, runnerState),
    assignmentCommitSafe(runnerState),
    completionAuthoritySafe(runnerState),
    inventoryObservationSafe(runnerState),
    personalAssignmentSafe(runnerState),
    accountAssignmentSafe(runnerState),
    not(boundPastStrictOwner),
    not(boundPastLiveOwner),
    pinnedRequirementsUnchanged(initialState, runnerState)
  }
}
