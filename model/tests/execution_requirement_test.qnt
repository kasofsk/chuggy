module execution_requirement_test {
  import execution_requirement.* from "../execution_requirement"
  import registered_runner.* from "../runner"

  pure def container(image: int): ExecutionRequirement = ContainerRequirement({
    operatingSystem: Linux, architecture: Amd64, image: image })
  pure val nativeBase: ExecutionRequirement = NativeRequirement({
    architecture: Arm64, driver: XcodeBuild,
    xcodeVersionMin: 16, sdkVersionMin: 18 })
  pure val defaults: RequirementDefaults = {
    explicitTasks: Map(), taskKinds: Map(), tickets: Map(),
    platformDefault: nativeBase, platformDefaultVersion: 7
  }

  run precedenceIsExplicitThenKindThenTicketThenPlatformTest =
    val explicit = NativeRequirement({ architecture: Arm64, driver: XcodeBuild,
      xcodeVersionMin: 19, sdkVersionMin: 21 })
    val kind = NativeRequirement({ architecture: Arm64, driver: XcodeBuild,
      xcodeVersionMin: 18, sdkVersionMin: 20 })
    val ticket = NativeRequirement({ architecture: Arm64, driver: XcodeBuild,
      xcodeVersionMin: 17, sdkVersionMin: 19 })
    val configured = { ...defaults,
      explicitTasks: Map(11 -> explicit), taskKinds: Map(2 -> kind),
      tickets: Map(3 -> ticket) }
    assert(and {
      selectedRequirement(11, 2, 3, configured) == { value: explicit, source: ExplicitTask },
      selectedRequirement(12, 2, 3, configured) == { value: kind, source: TaskKindDefault },
      selectedRequirement(12, 4, 3, configured) == { value: ticket, source: TicketDefault },
      selectedRequirement(12, 4, 5, configured) == { value: nativeBase, source: PlatformDefault }
    })

  run tasksInOneTicketMayMaterializeDifferentRequirementsTest =
    val first = NativeRequirement({ architecture: Arm64, driver: XcodeBuild,
      xcodeVersionMin: 17, sdkVersionMin: 18 })
    val second = NativeRequirement({ architecture: Arm64, driver: XcodeBuild,
      xcodeVersionMin: 18, sdkVersionMin: 19 })
    val configured = { ...defaults, explicitTasks: Map(11 -> first, 12 -> second) }
    match materialize(101, 11, 2, 3, configured, LegacyWorker) {
      | Materialized(a) => match materialize(102, 12, 2, 3, configured, LegacyWorker) {
          | Materialized(b) => assert(and {
              a.value == first, b.value == second,
              a.identity != b.identity, a.digest != b.digest
            })
          | _ => assert(false)
        }
      | _ => assert(false)
    }

  run legacyReleaseImagePreservesContainerBehaviorTest =
    val migrated = defaultsFromLegacyReleaseImage(42, 1)
    match materialize(101, 11, 2, 3, migrated, LegacyWorker) {
      | Materialized(pinned) => assert(and {
          pinned.value == container(42),
          pinned.source == PlatformDefault,
          pinned.platformDefaultVersion == 1
        })
      | RequirementRefused => assert(false)
    }

  run singleAgentWorkerKeepsThePinnedImageAndConstrainsItTest =
    val migrated = defaultsFromLegacyReleaseImage(42, 1)
    match materialize(101, 11, 2, 3, migrated, SingleAgentWorker(AgentCodex)) {
      | Materialized(pinned) => assert(and {
          pinned.value == container(42),
          pinned.agent == RequiredAgent(AgentCodex),
          pinned.digest == requirementDigest(container(42))
        })
      | RequirementRefused => assert(false)
    }

  run siteRefusesAPinnedImageItDeclaresWithoutTheAgentTest =
    val migrated = defaultsFromLegacyReleaseImage(42, 1)
    match materialize(101, 11, 2, 3, migrated, SingleAgentWorker(AgentCodex)) {
      | Materialized(pinned) => assert(and {
          not(siteAdmits(pinned.value, pinned.agent,
            CapabilitiesDeclared(Set(AgentClaude)))),
          siteAdmits(pinned.value, pinned.agent,
            CapabilitiesDeclared(Set(AgentClaude, AgentCodex)))
        })
      | RequirementRefused => assert(false)
    }

  run siteAdmitsAPinnedImageItDeclaresNoCapabilitiesForTest =
    val migrated = defaultsFromLegacyReleaseImage(42, 1)
    match materialize(101, 11, 2, 3, migrated, SingleAgentWorker(AgentCodex)) {
      | Materialized(pinned) =>
          assert(siteAdmits(pinned.value, pinned.agent, CapabilitiesUndeclared))
      | RequirementRefused => assert(false)
    }

  run aWorkerNamingNoAgentConstrainsNoSiteEntryTest =
    val migrated = defaultsFromLegacyReleaseImage(42, 1)
    match materialize(101, 11, 2, 3, migrated, LegacyWorker) {
      | Materialized(pinned) => assert(and {
          pinned.agent == NoAgent,
          siteAdmits(pinned.value, pinned.agent,
            CapabilitiesDeclared(Set(AgentClaude)))
        })
      | RequirementRefused => assert(false)
    }

  run singleAgentWorkerAddsItsAgentToAnAuthoredCapabilityRequirementTest =
    val capability = CapabilityRequirement({
      operatingSystem: Linux, architecture: Amd64,
      capabilities: Set(AgentClaude) })
    val configured = {
      explicitTasks: Map(), taskKinds: Map(), tickets: Map(),
      platformDefault: capability, platformDefaultVersion: 1
    }
    match materialize(101, 11, 2, 3, configured, SingleAgentWorker(AgentCodex)) {
      | Materialized(pinned) => assert(and {
          pinned.value == CapabilityRequirement({
            operatingSystem: Linux, architecture: Amd64,
            capabilities: Set(AgentClaude, AgentCodex) }),
          siteAdmits(pinned.value, pinned.agent, CapabilitiesUndeclared)
        })
      | RequirementRefused => assert(false)
    }

  run singleAgentWorkerRefusesANativeRequirementTest =
    assert(materialize(
      101, 11, 2, 3, defaults, SingleAgentWorker(AgentCodex)
    ) == RequirementRefused)

  run changingDefaultDoesNotRewritePinnedRequirementTest =
    val oldConfig = defaultsFromLegacyReleaseImage(42, 1)
    val newConfig = defaultsFromLegacyReleaseImage(99, 2)
    match materialize(101, 11, 2, 3, oldConfig, LegacyWorker) {
      | Materialized(oldPinned) => match materialize(101, 11, 2, 3, newConfig, LegacyWorker) {
          | Materialized(newPinned) => assert(and {
              oldPinned.value == container(42),
              oldPinned.platformDefaultVersion == 1,
              pin(oldPinned, newPinned) == PinRefused,
              pin(oldPinned, oldPinned) == Pinned(oldPinned)
            })
          | _ => assert(false)
        }
      | _ => assert(false)
    }

  run malformedRequirementsAreRefusedTest =
    val malformed = { ...defaults, platformDefault: NativeRequirement({
      architecture: Arm64, driver: XcodeBuild,
      xcodeVersionMin: 0, sdkVersionMin: 18 }) }
    assert(materialize(101, 11, 2, 3, malformed, LegacyWorker) == RequirementRefused)

  run wideningOverrideIsRefusedTest =
    val widened = NativeRequirement({ architecture: Arm64, driver: XcodeBuild,
      xcodeVersionMin: 15, sdkVersionMin: 17 })
    val configured = { ...defaults, explicitTasks: Map(11 -> widened) }
    assert(materialize(101, 11, 2, 3, configured, LegacyWorker) == RequirementRefused)

  run variantChangeIsNotARefinementTest =
    val configured = { ...defaults, explicitTasks: Map(11 -> container(42)) }
    assert(materialize(101, 11, 2, 3, configured, LegacyWorker) == RequirementRefused)

  run digestIsStableForEqualValuesAndDistinctForExamplesTest = assert(and {
    requirementDigest(container(42)) == requirementDigest(container(42)),
    requirementDigest(container(42)) != requirementDigest(container(43)),
    requirementDigest(container(42)) != requirementDigest(nativeBase)
  })
}
