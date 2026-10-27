/// Registered runners are a physical route beneath the one durable execution
/// ledger in execution_capacity. Observations never allocate logical capacity.
///
/// COMMIT BOUNDARIES. The logical execution commit owns entitlement status and
/// the immutable requirement/profile identity. The assignment commit binds one
/// attempt generation to one session generation while reserving its slot.
/// Heartbeat, lease and inventory freshness are deliberately eventual: their
/// absence may hold placement but cannot consume entitlement or conclude work.
/// Only schedulerVerify moves the durable ledger to Terminal.
module registered_runner {
  import execution_capacity.* from "./capacity"

  type RunnerClass = Personal | Dedicated | Shared
  type OperatingSystem = Linux | MacOS
  type Architecture = Amd64 | Arm64
  /// A capability is a token a project and its runners agree on, and nothing
  /// here enumerates them: an agent is the token `Agent:<name>`, and a runner's
  /// owner decides how it meets each one it declares.
  type ExecutionCapability = str
  type Platform = { operatingSystem: OperatingSystem, architecture: Architecture }
  /// First delivery is explicit routing: enabling registered runners cannot
  /// redirect or reduce Kubernetes placement. Automatic spillover is absent.
  type ExecutionRoute = Kubernetes | RegisteredRunner
  type ContainerExecutionRequirement = { operatingSystem: OperatingSystem, architecture: Architecture, image: int }
  type CapabilityExecutionRequirement = { operatingSystem: OperatingSystem, architecture: Architecture, capabilities: Set[ExecutionCapability] }
  /// A requirement names the image a task runs on, which a runner must obtain
  /// and run, or the capabilities it needs, which a runner meets however its
  /// owner arranged: in an image of its own or on its host.
  type ExecutionRequirement = ContainerRequirement(ContainerExecutionRequirement) | CapabilityRequirement(CapabilityExecutionRequirement)
  /// Whether a non-Personal runner may take an owned execution while its
  /// owner has a Personal runner configured for it: never under Strict, and
  /// under Preferred only while none of those runners is live. An execution
  /// whose owner has no such runner takes the route it would without one.
  type OwnerFallback = Strict | Preferred
  type ExecutionProfile = { route: ExecutionRoute, personalRunnerAllowed: bool, minimumTrust: int, secretsRequired: bool, sourceRequired: bool, dedicatedOwnerRequired: int, ownerOf: int, ownerFallback: OwnerFallback }
  /// The most memory a runner takes one execution of, in MiB, which its owner
  /// configures and it advertises; a runner naming none bounds no size.
  type MemoryCeiling = Unbounded | CeilingMib(int)
  type CapabilityInventory = {
    platforms: Set[Platform], executionCapabilities: Set[ExecutionCapability], memoryCeiling: MemoryCeiling, revision: int
  }
  /// All authority here is administrator-owned, never advertised inventory.
  /// A Personal runner's `dedicatedOwner` is the member it serves and its
  /// `allowlist` the accounts that member opted it into; every other class
  /// serves its own `account`.
  type Runner = { id: int, account: int, class: RunnerClass, enabled: bool, draining: bool, revoked: bool, trust: int, secretsAllowed: bool, sourceAllowed: bool, dedicatedOwner: int, allowlist: Set[int], sessionGeneration: int, retainedInventory: CapabilityInventory }
  type RunnerSession = { runner: int, generation: int, leaseOpen: bool, slotsOffered: int, slotsUsed: int, inventory: CapabilityInventory }
  type PlacementPhase = Waiting | Assigned | ResultPending | PlacementCancelled
  /// `memoryMib` is the size the execution runs at, pinned with it.
  type ExecutionPlacement = { execution: int, attemptGeneration: int, requirement: ExecutionRequirement, profile: ExecutionProfile, requirementIdentity: int, requirementDigest: int, memoryMib: int, phase: PlacementPhase }
  type AssignmentStatus = Offered | Reported | Verified | AssignmentCancelled
  type Assignment = { id: int, execution: int, attemptGeneration: int, runner: int, sessionGeneration: int, status: AssignmentStatus, manifest: int }
  type PlacementOutcome = NotApplicable | Placeable | Unavailable | DefinitiveIncompatibility
  type RunnerState = { executions: int -> Execution, placements: int -> ExecutionPlacement, runners: int -> Runner, sessions: int -> RunnerSession, assignments: int -> Assignment }

  pure def executionById(s: RunnerState, id: int): Execution = s.executions.get(id)
  pure def executionSet(s: RunnerState): Set[Execution] = s.executions.keys().map(id => s.executions.get(id))
  pure def inventoryMatches(r: ExecutionRequirement, i: CapabilityInventory): bool = match r {
    | ContainerRequirement(c) => i.platforms.contains({
        operatingSystem: c.operatingSystem, architecture: c.architecture })
    | CapabilityRequirement(c) => and {
        i.platforms.contains({
          operatingSystem: c.operatingSystem, architecture: c.architecture }),
        c.capabilities.subseteq(i.executionCapabilities)
      }
  }
  /// Whether a runner takes an execution of the placement's size: one under
  /// its ceiling, or any where it names none.
  pure def sizeFits(p: ExecutionPlacement, i: CapabilityInventory): bool = match i.memoryCeiling {
    | Unbounded => true
    | CeilingMib(m) => p.memoryMib <= m
  }
  pure def policyAllows(r: Runner, e: Execution, p: ExecutionProfile): bool = and {
    p.route == RegisteredRunner, r.class == Personal or r.account == e.account, r.enabled, not(r.draining), not(r.revoked),
    r.class != Personal or p.personalRunnerAllowed, r.class != Personal or p.ownerOf != 0,
    r.class != Personal or r.dedicatedOwner == p.ownerOf, r.class != Personal or r.allowlist.contains(e.account),
    r.trust >= p.minimumTrust,
    not(p.secretsRequired) or r.secretsAllowed, not(p.sourceRequired) or r.sourceAllowed,
    p.dedicatedOwnerRequired == 0 or r.dedicatedOwner == p.dedicatedOwnerRequired
  }
  /// Drain is volatile placement posture, not a proof that the configured
  /// route can never satisfy the pinned requirement.
  pure def policyConfigures(r: Runner, e: Execution, p: ExecutionProfile): bool = and {
    p.route == RegisteredRunner, r.class == Personal or r.account == e.account, r.enabled, not(r.revoked),
    r.class != Personal or p.personalRunnerAllowed, r.class != Personal or p.ownerOf != 0,
    r.class != Personal or r.dedicatedOwner == p.ownerOf, r.class != Personal or r.allowlist.contains(e.account),
    r.trust >= p.minimumTrust,
    not(p.secretsRequired) or r.secretsAllowed, not(p.sourceRequired) or r.sourceAllowed,
    p.dedicatedOwnerRequired == 0 or r.dedicatedOwner == p.dedicatedOwnerRequired
  }
  pure def sessionIsCurrent(r: Runner, s: RunnerSession): bool = s.runner == r.id and s.generation == r.sessionGeneration and s.leaseOpen
  pure def sessionHasSlot(s: RunnerSession): bool = s.slotsUsed < s.slotsOffered
  /// The owner's runners for an execution: the Personal runners configured
  /// for its placement as `placementOutcome` configures one, which are the
  /// owner's, allowlist its account and can run its requirement at its size.
  pure def ownerRunners(s: RunnerState, e: Execution, p: ExecutionPlacement): Set[int] = s.runners.keys().filter(rid => and { s.runners.get(rid).class == Personal, policyConfigures(s.runners.get(rid), e, p.profile), inventoryMatches(p.requirement, s.runners.get(rid).retainedInventory), sizeFits(p, s.runners.get(rid).retainedInventory) })
  /// A live runner takes new work under a current session, so a draining one
  /// is not live.
  pure def runnerIsLive(s: RunnerState, rid: int): bool = if (s.sessions.keys().contains(rid)) and { not(s.runners.get(rid).draining), sessionIsCurrent(s.runners.get(rid), s.sessions.get(rid)) } else false
  /// `placementOutcome` configures a runner without it: the fallback refuses
  /// one only for an owner's runner that is itself configured, so an
  /// execution it holds back is never definitively incompatible.
  pure def ownerFallbackAllows(s: RunnerState, r: Runner, e: Execution, p: ExecutionPlacement): bool = and {
    r.class == Personal or p.profile.ownerFallback == Preferred or ownerRunners(s, e, p).size() == 0,
    r.class == Personal or ownerRunners(s, e, p).forall(o => not(runnerIsLive(s, o)))
  }
  pure def placementOutcome(s: RunnerState, id: int): PlacementOutcome =
    val e = executionById(s, id)
    val p = s.placements.get(id)
    val configured = s.runners.keys().filter(rid => and {
      policyConfigures(s.runners.get(rid), e, p.profile),
      inventoryMatches(p.requirement, s.runners.get(rid).retainedInventory),
      sizeFits(p, s.runners.get(rid).retainedInventory)
    })
    if (p.profile.route != RegisteredRunner) NotApplicable
    else if (configured.exists(rid => if (s.sessions.keys().contains(rid)) and {
      policyAllows(s.runners.get(rid), e, p.profile),
      ownerFallbackAllows(s, s.runners.get(rid), e, p),
      sessionIsCurrent(s.runners.get(rid), s.sessions.get(rid)),
      sessionHasSlot(s.sessions.get(rid)),
      inventoryMatches(p.requirement, s.sessions.get(rid).inventory),
      sizeFits(p, s.sessions.get(rid).inventory)
    } else false)) Placeable
    else if (configured.size() > 0) Unavailable
    else DefinitiveIncompatibility

  pure def canAssign(s: RunnerState, id: int, rid: int, aid: int): bool = if (s.sessions.keys().contains(rid))
    val e = executionById(s, id)
    val p = s.placements.get(id)
    val r = s.runners.get(rid)
    val session = s.sessions.get(rid)
    and { e.status == Launching, p.phase == Waiting, not(s.assignments.keys().contains(aid)), policyAllows(r, e, p.profile), ownerFallbackAllows(s, r, e, p), sessionIsCurrent(r, session), sessionHasSlot(session), inventoryMatches(p.requirement, session.inventory), sizeFits(p, session.inventory) }
    else false
  pure def bindAssignment(s: RunnerState, aid: int, id: int, rid: int): RunnerState =
    val p = s.placements.get(id)
    val r = s.runners.get(rid)
    val session = s.sessions.get(rid)
    { ...s,
      placements: s.placements.set(id, { ...p, phase: Assigned }),
      sessions: s.sessions.set(rid, { ...session, slotsUsed: session.slotsUsed + 1 }),
      assignments: s.assignments.put(aid, { id: aid, execution: id, attemptGeneration: p.attemptGeneration, runner: rid, sessionGeneration: r.sessionGeneration, status: Offered, manifest: 0 }) }
  pure def takeOver(s: RunnerState, rid: int, i: CapabilityInventory, slots: int): RunnerState =
    val r = s.runners.get(rid)
    val generation = r.sessionGeneration + 1
    { ...s, runners: s.runners.set(rid, {
        ...r, sessionGeneration: generation, retainedInventory: i }),
      sessions: s.sessions.put(rid, { runner: rid, generation: generation,
        leaseOpen: true, slotsOffered: slots, slotsUsed: 0, inventory: i }) }
  pure def disconnect(s: RunnerState, rid: int): RunnerState =
    val session = s.sessions.get(rid)
    { ...s, sessions: s.sessions.set(rid, { ...session, leaseOpen: false }) }
  pure def reportIsCurrent(s: RunnerState, aid: int): bool =
    val a = s.assignments.get(aid)
    val p = s.placements.get(a.execution)
    val r = s.runners.get(a.runner)
    and { a.status == Offered, p.phase == Assigned, a.attemptGeneration == p.attemptGeneration, a.sessionGeneration == r.sessionGeneration, sessionIsCurrent(r, s.sessions.get(a.runner)) }
  pure def report(s: RunnerState, aid: int, manifest: int): RunnerState =
    val a = s.assignments.get(aid)
    val p = s.placements.get(a.execution)
    { ...s, placements: s.placements.set(a.execution, { ...p, phase: ResultPending }), assignments: s.assignments.set(aid, { ...a, status: Reported, manifest: manifest }) }
  pure def schedulerMayVerify(s: RunnerState, aid: int): bool =
    val a = s.assignments.get(aid)
    val p = s.placements.get(a.execution)
    val r = s.runners.get(a.runner)
    and { a.status == Reported, p.phase == ResultPending, a.manifest > 0, a.attemptGeneration == p.attemptGeneration, a.sessionGeneration == r.sessionGeneration, s.sessions.get(a.runner).generation == a.sessionGeneration }
  pure def schedulerVerify(s: RunnerState, aid: int): RunnerState =
    val a = s.assignments.get(aid)
    val e = executionById(s, a.execution)
    val session = s.sessions.get(a.runner)
    { ...s, executions: s.executions.set(e.id, { ...e, status: Terminal }), sessions: s.sessions.set(a.runner, { ...session, slotsUsed: session.slotsUsed - 1 }), assignments: s.assignments.set(aid, { ...a, status: Verified }) }
  pure def mayCancel(s: RunnerState, aid: int): bool =
    val a = s.assignments.get(aid)
    val e = executionById(s, a.execution)
    a.status != Verified and a.status != AssignmentCancelled and e.status != Terminal and e.status != Cancelled
  pure def cancel(s: RunnerState, aid: int): RunnerState =
    val a = s.assignments.get(aid)
    val e = executionById(s, a.execution)
    val session = s.sessions.get(a.runner)
    val owns = a.sessionGeneration == session.generation and (a.status == Offered or a.status == Reported)
    { ...s, executions: s.executions.set(e.id, { ...e, status: Cancelled }), placements: s.placements.set(e.id, { ...s.placements.get(e.id), phase: PlacementCancelled }), sessions: s.sessions.set(a.runner, { ...session, slotsUsed: if (owns) session.slotsUsed - 1 else session.slotsUsed }), assignments: s.assignments.set(aid, { ...a, status: AssignmentCancelled }) }

  /// Assignment/session operations cannot add or remove logical allocations.
  pure def ledgerIdentityUnchanged(before: RunnerState, after: RunnerState): bool = executionSet(before).map(e => { id: e.id, account: e.account }) == executionSet(after).map(e => { id: e.id, account: e.account })
  pure def assignmentCommitSafe(s: RunnerState): bool = and {
    s.sessions.keys().forall(rid => val session = s.sessions.get(rid) and {
      session.slotsOffered >= 0, session.slotsUsed >= 0, session.slotsUsed <= session.slotsOffered,
      session.slotsUsed == s.assignments.keys().map(aid => s.assignments.get(aid)).filter(a => a.runner == rid and a.sessionGeneration == session.generation and (a.status == Offered or a.status == Reported)).size()
    }),
    s.placements.keys().forall(id => val p = s.placements.get(id) p.phase != Assigned or s.assignments.keys().map(aid => s.assignments.get(aid)).filter(a => a.execution == id and a.attemptGeneration == p.attemptGeneration and a.status == Offered).size() == 1)
  }
  pure def completionAuthoritySafe(s: RunnerState): bool = executionSet(s).filter(e => e.status == Terminal).forall(e => s.assignments.keys().map(aid => s.assignments.get(aid)).exists(a => a.execution == e.id and a.status == Verified and a.attemptGeneration == s.placements.get(e.id).attemptGeneration))
  pure def pinnedRequirementsUnchanged(initial: RunnerState, s: RunnerState): bool = initial.placements.keys().forall(id => and { s.placements.get(id).requirement == initial.placements.get(id).requirement, s.placements.get(id).profile == initial.placements.get(id).profile, s.placements.get(id).requirementIdentity == initial.placements.get(id).requirementIdentity, s.placements.get(id).requirementDigest == initial.placements.get(id).requirementDigest, s.placements.get(id).memoryMib == initial.placements.get(id).memoryMib })
  /// A Personal runner is assigned only its owner's execution, in an account
  /// it allowlists.
  pure def personalAssignmentSafe(s: RunnerState): bool = s.assignments.keys().forall(aid =>
    val a = s.assignments.get(aid)
    val r = s.runners.get(a.runner)
    val p = s.placements.get(a.execution)
    or {
      r.class != Personal,
      and {
        p.profile.personalRunnerAllowed, p.profile.ownerOf != 0, r.dedicatedOwner == p.profile.ownerOf,
        r.allowlist.contains(executionById(s, a.execution).account)
      }
    })
  /// Every other runner is assigned only executions of its own account.
  pure def accountAssignmentSafe(s: RunnerState): bool = s.assignments.keys().forall(aid =>
    val a = s.assignments.get(aid)
    s.runners.get(a.runner).class == Personal or s.runners.get(a.runner).account == executionById(s, a.execution).account)
  /// A current session and its durable last observation publish atomically.
  pure def inventoryObservationSafe(s: RunnerState): bool = s.sessions.keys().forall(rid =>
    val session = s.sessions.get(rid)
    val runner = s.runners.get(rid)
    session.generation != runner.sessionGeneration or
      session.inventory == runner.retainedInventory)
}
