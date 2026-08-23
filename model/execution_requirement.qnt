/// Materialization of the immutable requirement owned by a logical execution.
/// Placement backends consume this value; they do not reconstruct it from the
/// current configuration. The version records which platform default took part
/// in the decision, while the digest identifies the complete selected value.
module execution_requirement {
  import registered_runner.* from "./runner"

  type RequirementSource = ExplicitTask | TaskKindDefault | TicketDefault | PlatformDefault
  type RequirementCandidate = NoRequirement | Requested(ExecutionRequirement)
  type RequirementDefaults = {
    explicitTasks: int -> ExecutionRequirement,
    taskKinds: int -> ExecutionRequirement,
    tickets: int -> ExecutionRequirement,
    platformDefault: ExecutionRequirement,
    platformDefaultVersion: int
  }
  type MaterializedExecutionRequirement = {
    execution: int,
    value: ExecutionRequirement,
    identity: int,
    digest: int,
    source: RequirementSource,
    platformDefaultVersion: int
  }
  type MaterializationResult = Materialized(MaterializedExecutionRequirement) | RequirementRefused
  type PinResult = Pinned(MaterializedExecutionRequirement) | PinRefused

  pure def candidate(m: int -> ExecutionRequirement, key: int): RequirementCandidate =
    if (m.keys().contains(key)) Requested(m.get(key)) else NoRequirement

  /// Exact image/platform values make container requirements closed. Native
  /// version minima may only move upward relative to the platform contract;
  /// lowering one would widen the eligible worker set.
  pure def refines(value: ExecutionRequirement, baseline: ExecutionRequirement): bool =
    match value {
      | ContainerRequirement(v) => match baseline {
          | ContainerRequirement(b) => and {
              v.operatingSystem == b.operatingSystem,
              v.architecture == b.architecture
            }
          | _ => false
        }
      | NativeRequirement(v) => match baseline {
          | NativeRequirement(b) => and {
              v.architecture == b.architecture,
              v.driver == b.driver,
              v.xcodeVersionMin >= b.xcodeVersionMin,
              v.sdkVersionMin >= b.sdkVersionMin
            }
          | _ => false
        }
    }

  pure def wellFormed(value: ExecutionRequirement): bool = match value {
    | ContainerRequirement(v) => v.image > 0
    | NativeRequirement(v) => and { v.xcodeVersionMin > 0, v.sdkVersionMin > 0 }
  }

  pure def selectedRequirement(
    task: int, taskKind: int, ticket: int, defaults: RequirementDefaults
  ): { value: ExecutionRequirement, source: RequirementSource } =
    match candidate(defaults.explicitTasks, task) {
      | Requested(value) => { value: value, source: ExplicitTask }
      | NoRequirement => match candidate(defaults.taskKinds, taskKind) {
          | Requested(value) => { value: value, source: TaskKindDefault }
          | NoRequirement => match candidate(defaults.tickets, ticket) {
              | Requested(value) => { value: value, source: TicketDefault }
              | NoRequirement => { value: defaults.platformDefault, source: PlatformDefault }
            }
        }
    }

  /// Digest calculation is deliberately canonical and total over the closed
  /// variants. The identity belongs to the execution and is not configuration.
  pure def requirementDigest(value: ExecutionRequirement): int = match value {
    | ContainerRequirement(v) =>
        1000000 + (if (v.operatingSystem == MacOS) 100000 else 0) +
          (if (v.architecture == Arm64) 10000 else 0) + v.image
    | NativeRequirement(v) =>
        2000000 + (if (v.architecture == Arm64) 100000 else 0) +
          (match v.driver {
            | XcodeBuild => 10000
            | XcodeTesting => 20000
            | IosSimulatorTesting => 30000
          }) + v.xcodeVersionMin * 100 + v.sdkVersionMin
  }

  pure def materialize(
    execution: int, task: int, taskKind: int, ticket: int,
    defaults: RequirementDefaults
  ): MaterializationResult =
    val selected = selectedRequirement(task, taskKind, ticket, defaults)
    if (and {
      defaults.platformDefaultVersion > 0,
      wellFormed(defaults.platformDefault),
      wellFormed(selected.value),
      refines(selected.value, defaults.platformDefault)
    }) Materialized({
      execution: execution,
      value: selected.value,
      identity: execution,
      digest: requirementDigest(selected.value),
      source: selected.source,
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
    explicitTasks: Map(), taskKinds: Map(), tickets: Map(),
    platformDefault: ContainerRequirement({
      operatingSystem: Linux, architecture: Amd64, image: image }),
    platformDefaultVersion: version
  }
}
