/// Materialization of the immutable requirement owned by a logical execution.
/// Placement backends consume this value; they do not reconstruct it from the
/// current configuration. The version records which platform default took part
/// in the decision, while the digest identifies the complete selected value.
module execution_requirement {
  import registered_runner.* from "./runner"

  type RequirementSource = TaskKindDefault | TicketDefault | PlatformDefault
  type RequirementCandidate = NoRequirement | Requested(ExecutionRequirement)
  type RequirementDefaults = {
    taskKinds: int -> ExecutionRequirement,
    tickets: int -> ExecutionRequirement,
    platformDefault: ExecutionRequirement,
    platformDefaultVersion: int
  }
  /// The agent an execution's authored worker mode named, which the site has
  /// to provide for the execution to run. It travels beside the value rather
  /// than inside it, so it takes no part in the digest.
  type AgentConstraint = NoAgent | RequiredAgent(ExecutionCapability)
  type MaterializedExecutionRequirement = {
    execution: int,
    value: ExecutionRequirement,
    identity: int,
    digest: RequirementDigest,
    source: RequirementSource,
    agent: AgentConstraint,
    platformDefaultVersion: int
  }
  type MaterializationResult = Materialized(MaterializedExecutionRequirement) | RequirementRefused
  type PinResult = Pinned(MaterializedExecutionRequirement) | PinRefused
  type WorkerMode = LegacyWorker | SingleAgentWorker(ExecutionCapability)
  /// What a site publishes about one image it admits. A site that admitted an
  /// image before it published capabilities at all declares none, which is not
  /// the same statement as declaring an empty set.
  type ImageCapabilities = CapabilitiesUndeclared | CapabilitiesDeclared(Set[ExecutionCapability])

  pure def candidate(m: int -> ExecutionRequirement, key: int): RequirementCandidate =
    if (m.keys().contains(key)) Requested(m.get(key)) else NoRequirement

  /// Exact image/platform values make container requirements closed, and a
  /// capability selection may only add to the platform contract's: dropping one
  /// would widen the eligible worker set.
  pure def refines(value: ExecutionRequirement, baseline: ExecutionRequirement): bool =
    match value {
      | ContainerRequirement(v) => match baseline {
          | ContainerRequirement(b) => and {
              v.operatingSystem == b.operatingSystem,
              v.architecture == b.architecture
            }
          | _ => false
        }
      | CapabilityRequirement(v) => match baseline {
          | CapabilityRequirement(b) => and {
              v.operatingSystem == b.operatingSystem,
              v.architecture == b.architecture,
              b.capabilities.subseteq(v.capabilities)
            }
          | _ => false
        }
    }

  pure def wellFormed(value: ExecutionRequirement): bool = match value {
    | ContainerRequirement(v) => v.image > 0
    | CapabilityRequirement(v) => v.capabilities.size() > 0
  }

  /// A requirement is authored for a kind of task, for a ticket or for the
  /// platform, and never for one task: a task is named by an identity its
  /// ticket mints as it spawns, so nothing an author writes down can name one.
  pure def selectedRequirement(
    taskKind: int, ticket: int, defaults: RequirementDefaults
  ): { value: ExecutionRequirement, source: RequirementSource } =
    match candidate(defaults.taskKinds, taskKind) {
      | Requested(value) => { value: value, source: TaskKindDefault }
      | NoRequirement => match candidate(defaults.tickets, ticket) {
          | Requested(value) => { value: value, source: TicketDefault }
          | NoRequirement => { value: defaults.platformDefault, source: PlatformDefault }
        }
    }

  /// The authored worker mode names its primary agent concern, and an image a
  /// configuration selected is what runs. A container selection is therefore
  /// materialized as it stands and the agent constrains the site's entry for
  /// that image; only a selection stated as capabilities names workers rather
  /// than an image, so only that one takes the agent among its own.
  pure def requirementForWorker(
    selected: ExecutionRequirement, workerMode: WorkerMode
  ): ExecutionRequirement = match workerMode {
    | LegacyWorker => selected
    | SingleAgentWorker(agent) => match selected {
        | ContainerRequirement(_) => selected
        | CapabilityRequirement(capability) => CapabilityRequirement({
            ...capability,
            capabilities: capability.capabilities.union(Set(agent))
          })
      }
  }

  pure def agentConstraint(workerMode: WorkerMode): AgentConstraint = match workerMode {
    | LegacyWorker => NoAgent
    | SingleAgentWorker(agent) => RequiredAgent(agent)
  }

  /// Whether a site runs the pinned value for the execution's agent. A site
  /// that publishes what an image provides refuses an agent that is not among
  /// them; a site that publishes nothing about it has not said the image fails
  /// to provide one, so the selection stands. A selection stated as
  /// capabilities carries the agent among its own and is admitted against a
  /// session's inventory instead.
  pure def siteAdmits(
    value: ExecutionRequirement, agent: AgentConstraint, published: ImageCapabilities
  ): bool = match agent {
    | NoAgent => true
    | RequiredAgent(required) => match value {
        | ContainerRequirement(_) => match published {
            | CapabilitiesUndeclared => true
            | CapabilitiesDeclared(provided) => provided.contains(required)
          }
        | CapabilityRequirement(capability) => capability.capabilities.contains(required)
      }
  }

  /// A digest is canonical: two values share one exactly when they are equal,
  /// so the model takes the value as its own digest and the implementation
  /// hashes its canonical bytes. The identity belongs to the execution and is
  /// not configuration.
  type RequirementDigest = ExecutionRequirement
  pure def requirementDigest(value: ExecutionRequirement): RequirementDigest = value

  pure def materialize(
    execution: int, taskKind: int, ticket: int,
    defaults: RequirementDefaults, workerMode: WorkerMode
  ): MaterializationResult =
    val selected = selectedRequirement(taskKind, ticket, defaults)
    val value = requirementForWorker(selected.value, workerMode)
    if (and {
      defaults.platformDefaultVersion > 0,
      wellFormed(defaults.platformDefault),
      wellFormed(value),
      refines(selected.value, defaults.platformDefault)
    }) Materialized({
      execution: execution,
      value: value,
      identity: execution,
      digest: requirementDigest(value),
      source: selected.source,
      agent: agentConstraint(workerMode),
      platformDefaultVersion: defaults.platformDefaultVersion
    })
    else RequirementRefused

  /// Re-observation is idempotent, but neither a wider nor merely different
  /// value can replace what logical execution creation committed.
  pure def pin(existing: MaterializedExecutionRequirement,
               proposed: MaterializedExecutionRequirement): PinResult =
    if (existing == proposed) Pinned(existing) else PinRefused

  /// Compatibility adapter for the former release-level image setting. It is
  /// the platform container default, so configurations without overrides keep
  /// exactly the Kubernetes requirement they had before materialization.
  pure def defaultsFromLegacyReleaseImage(image: int, version: int): RequirementDefaults = {
    taskKinds: Map(), tickets: Map(),
    platformDefault: ContainerRequirement({
      operatingSystem: Linux, architecture: Amd64, image: image }),
    platformDefaultVersion: version
  }
}
