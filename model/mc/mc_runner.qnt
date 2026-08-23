/// Small executable runner machine. Every mutating operation is guarded here;
/// the pure transition functions are decision values, not public actions.
module mc_registered_runner {
  import registered_runner.* from "../runner"
  import execution_capacity.* from "../capacity"

  pure val inventory: CapabilityInventory = {
    containerPlatforms: Set(
      { operatingSystem: MacOS, architecture: Arm64 },
      { operatingSystem: Linux, architecture: Arm64 }),
    nativePlatform: { operatingSystem: MacOS, architecture: Arm64 },
    nativeDrivers: Set(XcodeBuild, XcodeTesting, IosSimulatorTesting),
    xcodeVersion: 16, sdkVersions: Set(18), revision: 1
  }
  pure val changedInventory: CapabilityInventory = {
    ...inventory, nativeDrivers: Set(XcodeTesting), revision: 2
  }
  pure val profile: ExecutionProfile = {
    route: RegisteredRunner, personalRunnerAllowed: true, minimumTrust: 1,
    secretsRequired: false, sourceRequired: false, dedicatedOwnerRequired: 0
  }
  pure val initialState: RunnerState = {
    executions: Map(1 -> { id: 1, project: 1, ticket: 1, task: 1, account: 1,
      sourceSeq: 1, sourceEffect: 0, status: Launching }),
    placements: Map(1 -> { execution: 1, attemptGeneration: 1,
      requirement: NativeRequirement({ architecture: Arm64,
        driver: XcodeBuild, xcodeVersionMin: 16, sdkVersionMin: 18 }),
      profile: profile, requirementIdentity: 1, requirementDigest: 101, phase: Waiting }),
    runners: Map(1 -> { id: 1, account: 1, class: Personal, enabled: true,
      draining: false, revoked: false, trust: 1, secretsAllowed: false,
      sourceAllowed: true, dedicatedOwner: 0, sessionGeneration: 1,
      retainedInventory: inventory }),
    sessions: Map(1 -> { runner: 1, generation: 1, leaseOpen: true,
      slotsOffered: 1, slotsUsed: 0, inventory: inventory }),
    assignments: Map()
  }

  var runnerState: RunnerState
  action init = runnerState' = initialState
  action offerAssignment = all { canAssign(runnerState, 1, 1, 10), runnerState' = bindAssignment(runnerState, 10, 1, 1) }
  action loseSession = if (runnerState.sessions.keys().contains(1))
    runnerState.sessions.get(1).leaseOpen and runnerState' = disconnect(runnerState, 1)
    else all { false, runnerState' = runnerState }
  action observeNoSession = all {
    runnerState.assignments.keys().size() == 0,
    runnerState' = { ...runnerState, sessions: Map() }
  }
  action beginDrain = all {
    runnerState.assignments.keys().size() == 0,
    runnerState' = { ...runnerState, runners: runnerState.runners.set(1,
      { ...runnerState.runners.get(1), draining: true }) }
  }
  action takeover = all {
    runnerState.runners.get(1).sessionGeneration < 3,
    nondet nextInventory = Set(inventory, changedInventory).oneOf()
    runnerState' = takeOver(runnerState, 1, nextInventory, 1)
  }
  action runnerReport = if (runnerState.assignments.keys().contains(10))
    reportIsCurrent(runnerState, 10) and runnerState' = report(runnerState, 10, 42) else all { false, runnerState' = runnerState }
  action schedulerComplete = if (runnerState.assignments.keys().contains(10))
    schedulerMayVerify(runnerState, 10) and runnerState' = schedulerVerify(runnerState, 10) else all { false, runnerState' = runnerState }
  action schedulerCancel = if (runnerState.assignments.keys().contains(10))
    mayCancel(runnerState, 10) and runnerState' = cancel(runnerState, 10) else all { false, runnerState' = runnerState }
  action settle = runnerState' = runnerState
  action step = any { offerAssignment, loseSession, observeNoSession, beginDrain, takeover, runnerReport, schedulerComplete, schedulerCancel, settle }

  val allInvariants: bool = and {
    capacitySafe(2, Map(1 -> { reserved: 1, maximum: 2 }), executionSet(runnerState)),
    ledgerIdentityUnchanged(initialState, runnerState),
    assignmentCommitSafe(runnerState),
    completionAuthoritySafe(runnerState),
    inventoryObservationSafe(runnerState),
    pinnedRequirementsUnchanged(initialState, runnerState)
  }
}
