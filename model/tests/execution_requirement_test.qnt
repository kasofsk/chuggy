module execution_requirement_test {
  import execution_requirement.* from "../execution_requirement"
  import registered_runner.* from "../runner"

  pure def container(image: int): ExecutionRequirement = ContainerRequirement({
    operatingSystem: Linux, architecture: Amd64, image: image })
  pure def capable(capabilities: Set[ExecutionCapability]): ExecutionRequirement =
    CapabilityRequirement({ operatingSystem: MacOS, architecture: Arm64,
      capabilities: capabilities })
  pure val capabilityBase: ExecutionRequirement = capable(Set("Tool:Xcode"))
  pure val defaults: RequirementDefaults = {
    taskKinds: Map(), tickets: Map(),
    platformDefault: capabilityBase, platformDefaultVersion: 7
  }

  run precedenceIsKindThenTicketThenPlatformTest =
    val kind = capable(Set("Tool:Xcode", "Simulator:iOS"))
    val ticket = capable(Set("Tool:Xcode", "Host:Signing"))
    val configured = { ...defaults,
      taskKinds: Map(2 -> kind), tickets: Map(3 -> ticket) }
    assert(and {
      selectedRequirement(2, 3, configured) == { value: kind, source: TaskKindDefault },
      selectedRequirement(4, 3, configured) == { value: ticket, source: TicketDefault },
      selectedRequirement(4, 5, configured) == { value: capabilityBase, source: PlatformDefault }
    })

  run tasksInOneTicketMayMaterializeDifferentRequirementsTest =
    val first = capable(Set("Tool:Xcode", "Simulator:iOS"))
    val second = capable(Set("Tool:Xcode", "Host:Signing"))
    val configured = { ...defaults, taskKinds: Map(2 -> first, 4 -> second) }
    match materialize(101, 2, 3, configured, LegacyWorker) {
      | Materialized(a) => match materialize(102, 4, 3, configured, LegacyWorker) {
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
    match materialize(101, 2, 3, migrated, LegacyWorker) {
      | Materialized(pinned) => assert(and {
          pinned.value == container(42),
          pinned.source == PlatformDefault,
          pinned.platformDefaultVersion == 1
        })
      | RequirementRefused => assert(false)
    }

  run singleAgentWorkerKeepsThePinnedImageAndConstrainsItTest =
    val migrated = defaultsFromLegacyReleaseImage(42, 1)
    match materialize(101, 2, 3, migrated, SingleAgentWorker("Agent:Codex")) {
      | Materialized(pinned) => assert(and {
          pinned.value == container(42),
          pinned.agent == RequiredAgent("Agent:Codex"),
          pinned.digest == requirementDigest(container(42))
        })
      | RequirementRefused => assert(false)
    }

  run siteRefusesAPinnedImageItDeclaresWithoutTheAgentTest =
    val migrated = defaultsFromLegacyReleaseImage(42, 1)
    match materialize(101, 2, 3, migrated, SingleAgentWorker("Agent:Codex")) {
      | Materialized(pinned) => assert(and {
          not(siteAdmits(pinned.value, pinned.agent,
            CapabilitiesDeclared(Set("Agent:Claude")))),
          siteAdmits(pinned.value, pinned.agent,
            CapabilitiesDeclared(Set("Agent:Claude", "Agent:Codex")))
        })
      | RequirementRefused => assert(false)
    }

  run siteAdmitsAPinnedImageItDeclaresNoCapabilitiesForTest =
    val migrated = defaultsFromLegacyReleaseImage(42, 1)
    match materialize(101, 2, 3, migrated, SingleAgentWorker("Agent:Codex")) {
      | Materialized(pinned) =>
          assert(siteAdmits(pinned.value, pinned.agent, CapabilitiesUndeclared))
      | RequirementRefused => assert(false)
    }

  run siteRefusesAnAgentACapabilitySelectionDoesNotNameTest =
    assert(not(siteAdmits(
      CapabilityRequirement({ operatingSystem: Linux, architecture: Amd64,
        capabilities: Set("Agent:Claude") }),
      RequiredAgent("Agent:Codex"), CapabilitiesUndeclared)))

  run anOpenCapabilityCarriesTheAgentBesideItTest =
    match materialize(101, 2, 3, defaults, SingleAgentWorker("Agent:Claude")) {
      | Materialized(pinned) => assert(and {
          pinned.value == capable(Set("Tool:Xcode", "Agent:Claude")),
          siteAdmits(pinned.value, pinned.agent, CapabilitiesUndeclared)
        })
      | RequirementRefused => assert(false)
    }

  run aWorkerNamingNoAgentConstrainsNoSiteEntryTest =
    val migrated = defaultsFromLegacyReleaseImage(42, 1)
    match materialize(101, 2, 3, migrated, LegacyWorker) {
      | Materialized(pinned) => assert(and {
          pinned.agent == NoAgent,
          siteAdmits(pinned.value, pinned.agent,
            CapabilitiesDeclared(Set("Agent:Claude")))
        })
      | RequirementRefused => assert(false)
    }

  run singleAgentWorkerAddsItsAgentToAnAuthoredCapabilityRequirementTest =
    val capability = CapabilityRequirement({
      operatingSystem: Linux, architecture: Amd64,
      capabilities: Set("Agent:Claude") })
    val configured = {
      taskKinds: Map(), tickets: Map(),
      platformDefault: capability, platformDefaultVersion: 1
    }
    match materialize(101, 2, 3, configured, SingleAgentWorker("Agent:Codex")) {
      | Materialized(pinned) => assert(and {
          pinned.value == CapabilityRequirement({
            operatingSystem: Linux, architecture: Amd64,
            capabilities: Set("Agent:Claude", "Agent:Codex") }),
          siteAdmits(pinned.value, pinned.agent, CapabilitiesUndeclared)
        })
      | RequirementRefused => assert(false)
    }

  run changingDefaultDoesNotRewritePinnedRequirementTest =
    val oldConfig = defaultsFromLegacyReleaseImage(42, 1)
    val newConfig = defaultsFromLegacyReleaseImage(99, 2)
    match materialize(101, 2, 3, oldConfig, LegacyWorker) {
      | Materialized(oldPinned) => match materialize(101, 2, 3, newConfig, LegacyWorker) {
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
    val malformed = { ...defaults, platformDefault: capable(Set()) }
    assert(materialize(101, 2, 3, malformed, LegacyWorker) == RequirementRefused)

  run wideningOverrideIsRefusedTest =
    val widened = capable(Set("Simulator:iOS"))
    val configured = { ...defaults, taskKinds: Map(2 -> widened) }
    assert(materialize(101, 2, 3, configured, LegacyWorker) == RequirementRefused)

  run variantChangeIsNotARefinementTest =
    val configured = { ...defaults, taskKinds: Map(2 -> container(42)) }
    assert(materialize(101, 2, 3, configured, LegacyWorker) == RequirementRefused)

  run digestIsStableForEqualValuesAndDistinctForExamplesTest = assert(and {
    requirementDigest(container(42)) == requirementDigest(container(42)),
    requirementDigest(container(42)) != requirementDigest(container(43)),
    requirementDigest(container(42)) != requirementDigest(capabilityBase),
    requirementDigest(capable(Set("Tool:Xcode", "Simulator:iOS"))) !=
      requirementDigest(capable(Set("Tool:Xcode", "Host:Signing")))
  })
}
