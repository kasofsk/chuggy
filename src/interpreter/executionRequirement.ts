export type OperatingSystem = "Linux" | "MacOS";
export type Architecture = "Amd64" | "Arm64";
export type ExecutionTaskKind = "Work" | "Evaluation";
export type ExecutionTaskKindKey = ExecutionTaskKind | `Evaluation:${number}`;
export interface Platform {
  readonly operatingSystem: OperatingSystem;
  readonly architecture: Architecture;
}
export type NativeDriver =
  "XcodeBuild" | "XcodeTesting" | "IosSimulatorTesting";
export type ExecutionCapability = "Agent:Claude" | "Agent:Codex";

export type ContainerExecutionRequirement = Readonly<
  Platform & { readonly mode: "Container"; readonly image: string }
>;
export type CapabilityExecutionRequirement = Readonly<
  Platform & {
    readonly mode: "ContainerCapability";
    readonly capabilities: readonly ExecutionCapability[];
  }
>;
export type NativeExecutionRequirement = Readonly<{
  readonly mode: "Native";
  readonly architecture: Architecture;
  readonly driver: NativeDriver;
  readonly xcodeVersionMin: number;
  readonly sdkVersionMin: number;
}>;

export type ExecutionRequirement =
  | ContainerExecutionRequirement
  | CapabilityExecutionRequirement
  | NativeExecutionRequirement;

export type RequirementSource =
  "ExplicitTask" | "TaskKindDefault" | "TicketDefault" | "PlatformDefault";

export interface MaterializedExecutionRequirement {
  readonly value: ExecutionRequirement;
  readonly source: RequirementSource;
  readonly platformDefaultVersion: number;
}

export function asRequirementSource(value: unknown): RequirementSource {
  if (
    value !== "ExplicitTask" &&
    value !== "TaskKindDefault" &&
    value !== "TicketDefault" &&
    value !== "PlatformDefault"
  )
    throw new TypeError("execution requirement source is malformed");
  return value;
}

interface RequirementConfiguration {
  readonly platformDefault: ExecutionRequirement;
  readonly platformDefaultVersion: number;
  readonly ticketDefault?: ExecutionRequirement;
  readonly taskKindDefaults?: Readonly<
    Partial<Record<ExecutionTaskKindKey, ExecutionRequirement>>
  >;
  readonly taskDefaults?: Readonly<Record<string, ExecutionRequirement>>;
  readonly stageQualifiedEvaluation: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function capabilityRequirement(
  item: Record<string, unknown>,
): CapabilityExecutionRequirement | undefined {
  if (
    !hasOnlyKeys(item, [
      "mode",
      "operatingSystem",
      "architecture",
      "capabilities",
    ])
  )
    return undefined;
  const operatingSystem = item["operatingSystem"];
  const architecture = item["architecture"];
  const capabilities = item["capabilities"];
  if (
    (operatingSystem !== "Linux" && operatingSystem !== "MacOS") ||
    (architecture !== "Amd64" && architecture !== "Arm64") ||
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    !capabilities.every(
      (capability) =>
        capability === "Agent:Claude" || capability === "Agent:Codex",
    ) ||
    new Set(capabilities).size !== capabilities.length
  )
    return undefined;
  return {
    mode: "ContainerCapability",
    operatingSystem,
    architecture,
    capabilities,
  };
}

function requirement(value: unknown): ExecutionRequirement | undefined {
  const item = record(value);
  if (item?.["mode"] === "Container") {
    if (
      !hasOnlyKeys(item, ["mode", "operatingSystem", "architecture", "image"])
    )
      return undefined;
    const operatingSystem = item["operatingSystem"];
    const architecture = item["architecture"];
    const image = item["image"];
    if (
      (operatingSystem === "Linux" || operatingSystem === "MacOS") &&
      (architecture === "Amd64" || architecture === "Arm64") &&
      typeof image === "string" &&
      image.length > 0
    )
      return { mode: "Container", operatingSystem, architecture, image };
  }
  if (item?.["mode"] === "ContainerCapability")
    return capabilityRequirement(item);
  if (item?.["mode"] === "Native") {
    if (
      !hasOnlyKeys(item, [
        "mode",
        "architecture",
        "driver",
        "xcodeVersionMin",
        "sdkVersionMin",
      ])
    )
      return undefined;
    const architecture = item["architecture"];
    const driver = item["driver"];
    const xcodeVersionMin = item["xcodeVersionMin"];
    const sdkVersionMin = item["sdkVersionMin"];
    if (
      (architecture === "Amd64" || architecture === "Arm64") &&
      (driver === "XcodeBuild" ||
        driver === "XcodeTesting" ||
        driver === "IosSimulatorTesting") &&
      Number.isSafeInteger(xcodeVersionMin) &&
      Number(xcodeVersionMin) > 0 &&
      Number.isSafeInteger(sdkVersionMin) &&
      Number(sdkVersionMin) > 0
    )
      return {
        mode: "Native",
        architecture,
        driver,
        xcodeVersionMin: Number(xcodeVersionMin),
        sdkVersionMin: Number(sdkVersionMin),
      };
  }
  return undefined;
}

export function asExecutionRequirement(value: unknown): ExecutionRequirement {
  const parsed = requirement(value);
  if (parsed === undefined)
    throw new TypeError("execution requirement is malformed");
  return parsed;
}

function refines(
  value: ExecutionRequirement,
  baseline: ExecutionRequirement,
): boolean {
  if (value.mode !== baseline.mode) return false;
  if (value.mode === "Container" && baseline.mode === "Container")
    return (
      value.operatingSystem === baseline.operatingSystem &&
      value.architecture === baseline.architecture
    );
  if (value.mode === "Native" && baseline.mode === "Native")
    return (
      value.architecture === baseline.architecture &&
      value.driver === baseline.driver &&
      value.xcodeVersionMin >= baseline.xcodeVersionMin &&
      value.sdkVersionMin >= baseline.sdkVersionMin
    );
  return false;
}

function agentCapability(
  configuration: unknown,
): ExecutionCapability | undefined {
  const root = record(configuration);
  const authored = record(root?.["configuration"] ?? configuration);
  const worker = record(authored?.["worker"]);
  const mode = record(worker?.["mode"]);
  const agent = mode?.["type"] === "SingleAgent" ? mode["agent"] : undefined;
  return agent === "Claude" || agent === "Codex" ? `Agent:${agent}` : undefined;
}

function requirementMap(
  value: unknown,
  validKey: (key: string) => boolean,
): Readonly<Record<string, ExecutionRequirement>> | undefined {
  if (value === undefined) return {};
  const source = record(value);
  if (source === undefined) return undefined;
  const result: Record<string, ExecutionRequirement> = {};
  for (const [key, candidate] of Object.entries(source)) {
    const parsed = requirement(candidate);
    if (!validKey(key) || parsed === undefined) return undefined;
    result[key] = parsed;
  }
  return result;
}

function configuredRequirements(
  value: unknown,
  legacy: ExecutionRequirement,
  stageQualifiedEvaluation: boolean,
): RequirementConfiguration | undefined {
  const configured = record(value);
  if (
    configured === undefined ||
    !hasOnlyKeys(configured, [
      "platformDefault",
      "platformDefaultVersion",
      "ticketDefault",
      "taskKindDefaults",
      "taskDefaults",
    ])
  )
    return undefined;
  const platformDefault = requirement(configured?.["platformDefault"]);
  const platformDefaultVersion = configured?.["platformDefaultVersion"];
  if (
    platformDefault === undefined ||
    !Number.isSafeInteger(platformDefaultVersion) ||
    Number(platformDefaultVersion) < 1
  )
    return undefined;
  if (JSON.stringify(platformDefault) !== JSON.stringify(legacy))
    return undefined;
  const ticketDefault =
    configured?.["ticketDefault"] === undefined
      ? undefined
      : requirement(configured["ticketDefault"]);
  if (
    configured?.["ticketDefault"] !== undefined &&
    ticketDefault === undefined
  )
    return undefined;
  const taskKindDefaults = requirementMap(
    configured?.["taskKindDefaults"],
    (key) =>
      key === "Work" ||
      key === "Evaluation" ||
      /^Evaluation:(0|[1-9][0-9]*)$/u.test(key),
  ) as Partial<Record<ExecutionTaskKindKey, ExecutionRequirement>> | undefined;
  const taskDefaults = requirementMap(configured?.["taskDefaults"], (key) =>
    /^[1-9][0-9]*$/u.test(key),
  );
  if (taskKindDefaults === undefined || taskDefaults === undefined)
    return undefined;
  const candidates = [
    ticketDefault,
    ...Object.values(taskKindDefaults),
    ...Object.values(taskDefaults),
  ];
  if (
    candidates.some(
      (candidate) =>
        candidate !== undefined && !refines(candidate, platformDefault),
    )
  )
    return undefined;
  return {
    platformDefault,
    platformDefaultVersion: Number(platformDefaultVersion),
    ...(ticketDefault === undefined ? {} : { ticketDefault }),
    taskKindDefaults,
    taskDefaults,
    stageQualifiedEvaluation,
  };
}

function parsedConfiguration(
  value: unknown,
): RequirementConfiguration | undefined {
  const root = record(value);
  if (
    root === undefined ||
    root["version"] !== 1 ||
    typeof root["image"] !== "string" ||
    root["image"] === ""
  )
    return undefined;
  const legacy: ExecutionRequirement = {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: root["image"],
  };
  if (root["executionRequirements"] !== undefined)
    return configuredRequirements(
      root["executionRequirements"],
      legacy,
      root["evaluations"] !== undefined,
    );
  return {
    platformDefault: legacy,
    platformDefaultVersion: 1,
    stageQualifiedEvaluation: root["evaluations"] !== undefined,
  };
}

export function executionRequirementConfigurationIsValid(
  value: unknown,
): boolean {
  return parsedConfiguration(value) !== undefined;
}

export function materializeExecutionRequirement(
  configuration: unknown,
  task: number,
  kind: ExecutionTaskKind,
  stage?: number,
): MaterializedExecutionRequirement {
  const parsed = parsedConfiguration(configuration);
  if (parsed === undefined)
    throw new TypeError(
      "execution requirement configuration is malformed or widening",
    );
  if (
    (kind === "Work" && stage !== undefined) ||
    (kind === "Evaluation" &&
      (stage === undefined || !Number.isSafeInteger(stage) || stage < 0))
  )
    throw new TypeError("execution task kind and stage are inconsistent");
  const explicit = parsed.taskDefaults?.[String(task)];
  const kindKey: ExecutionTaskKindKey =
    kind === "Work" || !parsed.stageQualifiedEvaluation
      ? kind
      : `Evaluation:${stage as number}`;
  const kindDefault = parsed.taskKindDefaults?.[kindKey];
  const value =
    explicit ?? kindDefault ?? parsed.ticketDefault ?? parsed.platformDefault;
  const capability = agentCapability(configuration);
  const selected =
    capability !== undefined && value.mode === "Container"
      ? {
          mode: "ContainerCapability" as const,
          operatingSystem: value.operatingSystem,
          architecture: value.architecture,
          capabilities: [capability],
        }
      : value;
  const source: RequirementSource =
    explicit !== undefined
      ? "ExplicitTask"
      : kindDefault !== undefined
        ? "TaskKindDefault"
        : parsed.ticketDefault !== undefined
          ? "TicketDefault"
          : "PlatformDefault";
  return {
    value: selected,
    source,
    platformDefaultVersion: parsed.platformDefaultVersion,
  };
}
