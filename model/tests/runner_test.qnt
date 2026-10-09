/// Conformance examples for registered-runner placement, fencing and
/// scheduler-owned completion.
module registered_runner_test {
  import registered_runner.* from "../runner"
  import execution_capacity.* from "../capacity"

  pure val containerRequirement: ExecutionRequirement = ContainerRequirement({
    operatingSystem: MacOS, architecture: Arm64, image: 1
  })
  pure val nativeRequirement: ExecutionRequirement = NativeRequirement({
    architecture: Arm64, driver: XcodeBuild,
    xcodeVersionMin: 16, sdkVersionMin: 18
  })
  pure val personalProfile: ExecutionProfile = {
    route: RegisteredRunner, personalRunnerAllowed: true, minimumTrust: 1,
    secretsRequired: false, sourceRequired: false, dedicatedOwnerRequired: 0,
    ownerOf: 7, ownerFallback: Preferred
  }
  pure val inventory: CapabilityInventory = {
    containerPlatforms: Set(
      { operatingSystem: MacOS, architecture: Arm64 },
      { operatingSystem: Linux, architecture: Arm64 }),
    executionCapabilities: Set(AgentClaude, AgentCodex),
    nativePlatform: { operatingSystem: MacOS, architecture: Arm64 },
    nativeDrivers: Set(XcodeBuild, XcodeTesting, IosSimulatorTesting),
    xcodeVersion: 16, sdkVersions: Set(18), revision: 1
  }
  pure val runner: Runner = {
    id: 1, account: 1, class: Personal, enabled: true, draining: false,
    revoked: false, trust: 1, secretsAllowed: false, sourceAllowed: true,
    dedicatedOwner: 7, allowlist: Set(1), sessionGeneration: 1,
    retainedInventory: inventory
  }
  pure val session: RunnerSession = {
    runner: 1, generation: 1, leaseOpen: true, slotsOffered: 1, slotsUsed: 0,
    inventory: inventory
  }
  pure def execution(id: int): Execution = {
    id: id, project: 1, ticket: 1, task: id, account: 1,
    sourceSeq: 1, sourceEffect: 0, status: Launching
  }
  pure def placement(id: int, requirement: ExecutionRequirement): ExecutionPlacement = {
    execution: id, attemptGeneration: 1, requirement: requirement,
    profile: personalProfile, requirementIdentity: id, requirementDigest: 101,
    phase: Waiting
  }
  pure val initial: RunnerState = {
    runners: Map(1 -> runner), sessions: Map(1 -> session),
    executions: Map(1 -> execution(1)),
    placements: Map(1 -> placement(1, nativeRequirement)), assignments: Map()
  }

  run ordinaryContainerUsesRunnerModelTest = assert(and {
    inventoryMatches(containerRequirement, inventory),
    canAssign({ ...initial, placements: Map(1 -> placement(1, containerRequirement)) }, 1, 1, 10)
  })

  run advertisedFactsCannotGrantSecretAuthorityTest =
    val secretPlacement = { ...placement(1, nativeRequirement),
      profile: { ...personalProfile, secretsRequired: true } }
    val state = { ...initial, placements: Map(1 -> secretPlacement) }
    assert(and {
      inventoryMatches(nativeRequirement, inventory),
      not(policyAllows(runner, execution(1), secretPlacement.profile)),
      not(canAssign(state, 1, 1, 10))
    })

  run kubernetesRouteRemainsIndependentTest =
    val kubernetesPlacement = { ...placement(1, containerRequirement),
      profile: { ...personalProfile, route: Kubernetes } }
    val state = { ...initial, placements: Map(1 -> kubernetesPlacement) }
    assert(and {
      not(canAssign(state, 1, 1, 10)),
      placementOutcome(state, 1) == NotApplicable,
      kubernetesPlacement.requirement == containerRequirement
    })

  run transientAbsenceIsUnavailableTest =
    assert(placementOutcome(disconnect(initial, 1), 1) == Unavailable)

  run definitiveIncompatibilityTest =
    val incompatible = NativeRequirement({
      architecture: Arm64, driver: XcodeBuild,
      xcodeVersionMin: 17, sdkVersionMin: 18
    })
    val state = { ...initial, placements: Map(1 -> placement(1, incompatible)) }
    assert(placementOutcome(state, 1) == DefinitiveIncompatibility)

  run assignmentReservesSlotAtomicallyTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    assert(and {
      assigned.placements.get(1).phase == Assigned,
      assigned.sessions.get(1).slotsUsed == 1,
      assigned.assignments.get(10).attemptGeneration == 1,
      assigned.assignments.get(10).sessionGeneration == 1,
      assignmentCommitSafe(assigned)
    })

  run sessionTakeoverFencesStaleReportTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    val takenOver = takeOver(assigned, 1, inventory, 1)
    assert(and {
      takenOver.runners.get(1).sessionGeneration == 2,
      not(reportIsCurrent(takenOver, 10)),
      takenOver.placements.get(1).phase == Assigned,
      assignmentCommitSafe(takenOver)
    })

  run disconnectFencesReportWithoutTerminalizingTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    val disconnected = disconnect(assigned, 1)
    assert(and {
      not(reportIsCurrent(disconnected, 10)),
      disconnected.executions.get(1).status == Launching
    })

  run cancellationFencesReportAndReleasesSlotTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    val cancelled = cancel(assigned, 10)
    assert(and {
      cancelled.executions.get(1).status == Cancelled,
      cancelled.sessions.get(1).slotsUsed == 0,
      not(reportIsCurrent(cancelled, 10)),
      assignmentCommitSafe(cancelled)
    })

  run staleAttemptCannotReportTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    val retried = { ...assigned, placements: assigned.placements.set(1,
      { ...assigned.placements.get(1), attemptGeneration: 2, phase: Waiting }) }
    assert(not(reportIsCurrent(retried, 10)))

  run schedulerAloneTerminalizesTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    val reported = report(assigned, 10, 42)
    val verified = schedulerVerify(reported, 10)
    assert(and {
      reported.placements.get(1).phase == ResultPending,
      reported.executions.get(1).status == Launching,
      schedulerMayVerify(reported, 10),
      verified.executions.get(1).status == Terminal,
      verified.sessions.get(1).slotsUsed == 0,
      completionAuthoritySafe(verified),
      assignmentCommitSafe(verified)
    })

  run requirementsRemainImmutableAcrossPhysicalLifecycleTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    val reported = report(assigned, 10, 42)
    val verified = schedulerVerify(reported, 10)
    assert(and {
      assigned.placements.get(1).requirement == nativeRequirement,
      reported.placements.get(1).requirement == nativeRequirement,
      verified.placements.get(1).requirement == nativeRequirement
    })

  run boundedNativeDriverMustBeInstalledTest =
    val xcodeTestRequirement = NativeRequirement({
      architecture: Arm64, driver: XcodeTesting,
      xcodeVersionMin: 16, sdkVersionMin: 18
    })
    val buildOnly = { ...inventory, nativeDrivers: Set(XcodeBuild) }
    assert(not(inventoryMatches(xcodeTestRequirement, buildOnly)))

  run duplicateAssignmentIdentityIsRefusedTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    assert(not(canAssign(assigned, 1, 1, 10)))

  run takeoverAfterReportCannotVerifyOrReleaseNewSlotTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    val reported = report(assigned, 10, 42)
    val takenOver = takeOver(reported, 1, inventory, 1)
    assert(and {
      not(schedulerMayVerify(takenOver, 10)),
      takenOver.sessions.get(1).slotsUsed == 0,
      takenOver.executions.get(1).status == Launching,
      assignmentCommitSafe(takenOver)
    })

  run terminalCannotBeCancelledOrDoubleReleasedTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    val verified = schedulerVerify(report(assigned, 10, 42), 10)
    assert(and { not(mayCancel(verified, 10)), verified.sessions.get(1).slotsUsed == 0 })

  run physicalLifecyclePreservesLogicalLedgerIdentityTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    val disconnected = disconnect(assigned, 1)
    val takenOver = takeOver(disconnected, 1, inventory, 1)
    assert(and {
      ledgerIdentityUnchanged(initial, assigned),
      ledgerIdentityUnchanged(initial, disconnected),
      ledgerIdentityUnchanged(initial, takenOver),
      activeCount(executionSet(takenOver)) == activeCount(executionSet(initial))
    })

  run macNativeHostMayAlsoOfferLinuxContainersTest =
    val linuxContainer = ContainerRequirement({
      operatingSystem: Linux, architecture: Arm64, image: 7 })
    assert(and {
      inventoryMatches(linuxContainer, inventory),
      inventoryMatches(nativeRequirement, inventory)
    })

  run capabilityRequirementMatchesOnlyAnInventoryThatProvidesItTest =
    val codex = CapabilityRequirement({
      operatingSystem: Linux, architecture: Arm64,
      capabilities: Set(AgentCodex) })
    assert(and {
      inventoryMatches(codex, inventory),
      not(inventoryMatches(codex, {
        ...inventory, executionCapabilities: Set(AgentClaude) }))
    })

  run enrolledCompatibleRunnerWithoutSessionIsUnavailableTest =
    val absent = { ...initial, sessions: Map() }
    assert(and {
      placementOutcome(absent, 1) == Unavailable,
      not(canAssign(absent, 1, 1, 10))
    })

  run drainingCompatibleRunnerIsUnavailableNotDefinitiveTest =
    val drainingRunner = { ...runner, draining: true }
    val state = { ...initial, runners: Map(1 -> drainingRunner) }
    assert(and {
      placementOutcome(state, 1) == Unavailable,
      not(canAssign(state, 1, 1, 10))
    })

  run takeoverPublishesChangedInventoryAtomicallyTest =
    val changed = {
      ...inventory, nativeDrivers: Set(XcodeTesting), revision: 2 }
    val takenOver = takeOver(initial, 1, changed, 1)
    assert(and {
      takenOver.runners.get(1).retainedInventory == changed,
      takenOver.sessions.get(1).inventory == changed,
      inventoryObservationSafe(takenOver),
      placementOutcome(takenOver, 1) == DefinitiveIncompatibility
    })

  run personalRunnerTakesItsOwnersAllowlistedExecutionTest =
    val assigned = bindAssignment(initial, 10, 1, 1)
    assert(and {
      canAssign(initial, 1, 1, 10),
      placementOutcome(initial, 1) == Placeable,
      personalAssignmentSafe(assigned)
    })

  run personalRunnerRefusesAnotherOwnersExecutionTest =
    val state = { ...initial, placements: Map(1 -> { ...placement(1, nativeRequirement),
      profile: { ...personalProfile, ownerOf: 8 } }) }
    assert(and {
      not(canAssign(state, 1, 1, 10)),
      placementOutcome(state, 1) == DefinitiveIncompatibility
    })

  run personalRunnerRefusesOwnerlessExecutionTest =
    val ownerless = { ...runner, dedicatedOwner: 0 }
    val state = { ...initial, runners: Map(1 -> ownerless),
      placements: Map(1 -> { ...placement(1, nativeRequirement),
        profile: { ...personalProfile, ownerOf: 0 } }) }
    assert(and {
      ownerless.dedicatedOwner == state.placements.get(1).profile.ownerOf,
      not(canAssign(state, 1, 1, 10)),
      placementOutcome(state, 1) == DefinitiveIncompatibility
    })

  run personalRunnerRefusesAccountItDoesNotAllowlistTest =
    val unlisted = { ...runner, allowlist: Set(2) }
    val state = { ...initial, runners: Map(1 -> unlisted) }
    assert(and {
      unlisted.account == execution(1).account,
      not(canAssign(state, 1, 1, 10)),
      placementOutcome(state, 1) == DefinitiveIncompatibility
    })

  run personalRunnerServesAllowlistedAccountNotItsOwnTest =
    val elsewhere = { ...runner, account: 2 }
    val state = { ...initial, runners: Map(1 -> elsewhere) }
    assert(and {
      canAssign(state, 1, 1, 10),
      placementOutcome(state, 1) == Placeable
    })

  run dedicatedRunnerServesOnlyItsOwnAccountTest =
    val dedicated = { ...runner, class: Dedicated, account: 2 }
    val state = { ...initial, runners: Map(1 -> dedicated) }
    assert(and {
      dedicated.allowlist.contains(execution(1).account),
      not(canAssign(state, 1, 1, 10)),
      placementOutcome(state, 1) == DefinitiveIncompatibility,
      canAssign({ ...state, runners: Map(1 -> { ...dedicated, account: 1 }) }, 1, 1, 10)
    })

  /// The owner's runner 1 beside a Dedicated runner 2 of the account, both
  /// live, and an execution of that owner under the fallback given.
  pure def fallback(f: OwnerFallback): RunnerState = { ...initial,
    runners: Map(1 -> runner, 2 -> { ...runner, id: 2, class: Dedicated, dedicatedOwner: 0, allowlist: Set() }),
    sessions: Map(1 -> session, 2 -> { ...session, runner: 2 }),
    placements: Map(1 -> { ...placement(1, nativeRequirement),
      profile: { ...personalProfile, ownerFallback: f } }) }

  run preferredFallbackWaitsForLiveOwnerRunnerTest =
    val state = fallback(Preferred)
    assert(and {
      not(canAssign(state, 1, 2, 10)),
      canAssign(state, 1, 1, 10),
      placementOutcome(state, 1) == Placeable
    })

  run preferredFallbackBusyOwnerRunnerIsUnavailableTest =
    val state = fallback(Preferred)
    val busy = { ...state, sessions: state.sessions.set(1, { ...session, slotsUsed: 1 }) }
    assert(and {
      not(canAssign(busy, 1, 1, 10)),
      not(canAssign(busy, 1, 2, 10)),
      placementOutcome(busy, 1) == Unavailable
    })

  run preferredFallbackTakesDedicatedWhileOwnerRunnerIsAbsentTest =
    val offline = disconnect(fallback(Preferred), 1)
    assert(and {
      not(canAssign(offline, 1, 1, 10)),
      canAssign(offline, 1, 2, 10),
      placementOutcome(offline, 1) == Placeable
    })

  run strictFallbackRefusesDedicatedWhileOwnerHasRunnerTest =
    val offline = disconnect(fallback(Strict), 1)
    assert(and {
      not(canAssign(fallback(Strict), 1, 2, 10)),
      canAssign(fallback(Strict), 1, 1, 10),
      not(canAssign(offline, 1, 2, 10)),
      placementOutcome(offline, 1) == Unavailable
    })

  run strictFallbackOwnerRunnerUnableLeavesDedicatedRouteTest =
    val state = fallback(Strict)
    val unable = { ...runner, retainedInventory: { ...inventory, nativeDrivers: Set(XcodeTesting) } }
    val incapable = { ...state, runners: state.runners.set(1, unable),
      sessions: state.sessions.set(1, { ...session, inventory: unable.retainedInventory }) }
    assert(and {
      not(canAssign(incapable, 1, 1, 10)),
      canAssign(incapable, 1, 2, 10),
      placementOutcome(incapable, 1) == Placeable
    })

  run preferredFallbackTakesDedicatedWhileOwnerRunnerDrainsTest =
    val state = fallback(Preferred)
    val draining = { ...state, runners: state.runners.set(1, { ...runner, draining: true }) }
    assert(and {
      not(canAssign(draining, 1, 1, 10)),
      canAssign(draining, 1, 2, 10),
      placementOutcome(draining, 1) == Placeable
    })

  run ownerWithoutConfiguredRunnerFollowsDedicatedRouteTest =
    val state = fallback(Strict)
    val unlisted = { ...state, runners: state.runners.set(1, { ...runner, allowlist: Set(2) }) }
    val disallowed = { ...state, placements: Map(1 -> { ...state.placements.get(1),
      profile: { ...state.placements.get(1).profile, personalRunnerAllowed: false } }) }
    val ownerless = { ...state, runners: state.runners.set(1, { ...runner, dedicatedOwner: 0 }),
      placements: Map(1 -> { ...state.placements.get(1),
        profile: { ...state.placements.get(1).profile, ownerOf: 0 } }) }
    assert(and {
      canAssign(unlisted, 1, 2, 10), placementOutcome(unlisted, 1) == Placeable,
      canAssign(disallowed, 1, 2, 10), placementOutcome(disallowed, 1) == Placeable,
      canAssign(ownerless, 1, 2, 10), placementOutcome(ownerless, 1) == Placeable
    })
}
