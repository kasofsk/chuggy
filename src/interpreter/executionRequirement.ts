import type { z } from "zod";

import {
  allArchitectures,
  allExecutionCapabilities,
  allOperatingSystems,
  executionRequirementSchema,
  releaseConfigurationHeaderSchema,
  type executionRequirementsSchema,
} from "../contract/configurationDocument.ts";

/** The platform and capability rosters, surfaced where a requirement is materialized. */
export { allArchitectures, allExecutionCapabilities, allOperatingSystems };
export type OperatingSystem = (typeof allOperatingSystems)[number];
export type Architecture = (typeof allArchitectures)[number];
export type ExecutionTaskKind = "Work" | "Evaluation";
export type ExecutionTaskKindKey = ExecutionTaskKind | `Evaluation:${number}`;
export interface Platform {
  readonly operatingSystem: OperatingSystem;
  readonly architecture: Architecture;
}
export type NativeDriver =
  "XcodeBuild" | "XcodeTesting" | "IosSimulatorTesting";
export type ExecutionCapability = (typeof allExecutionCapabilities)[number];

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
  "TaskKindDefault" | "TicketDefault" | "PlatformDefault";

export interface MaterializedExecutionRequirement {
  readonly value: ExecutionRequirement;
  readonly source: RequirementSource;
  readonly platformDefaultVersion: number;
}

export function asRequirementSource(value: unknown): RequirementSource {
  if (
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
  readonly stageQualifiedEvaluation: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requirement(value: unknown): ExecutionRequirement | undefined {
  const parsed = executionRequirementSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
  if (
    value.mode === "ContainerCapability" &&
    baseline.mode === "ContainerCapability"
  )
    return (
      value.operatingSystem === baseline.operatingSystem &&
      value.architecture === baseline.architecture &&
      baseline.capabilities.every((capability) =>
        value.capabilities.includes(capability),
      )
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

/**
 * The requirement a configuration that names an agent runs under. A pinned
 * image is what runs, so a container requirement is returned as it stands and
 * the agent constrains the catalog entry that image names rather than replacing
 * it; a requirement authored by capability names workers rather than an image,
 * so the agent joins the capabilities it asks for.
 */
function requirementForAgent(
  value: ExecutionRequirement,
  capability: ExecutionCapability | undefined,
): ExecutionRequirement | undefined {
  if (capability === undefined || value.mode === "Container") return value;
  if (value.mode === "Native") return undefined;
  return {
    ...value,
    capabilities: [...new Set([...value.capabilities, capability])],
  };
}

/**
 * The agent capability a configuration's worker needs, which is what an image
 * has to provide for the configuration to run on it. A worker that states no
 * single agent needs none.
 */
export function executionAgentCapability(
  configuration: unknown,
): ExecutionCapability | undefined {
  const root = record(configuration);
  const authored = record(root?.["configuration"] ?? configuration);
  const worker = record(authored?.["worker"]);
  const mode = record(worker?.["mode"]);
  const agent = mode?.["type"] === "SingleAgent" ? mode["agent"] : undefined;
  return agent === "Claude" || agent === "Codex" ? `Agent:${agent}` : undefined;
}

/**
 * The form the two statements of the platform default are compared in when
 * they are stated in different modes and the configuration names an agent: as
 * the capability each satisfies, which is what lets a default authored by
 * capability and the legacy image field be one requirement rather than two
 * modes that can never match.
 */
function platformDefaultComparable(
  value: ExecutionRequirement,
  capability: ExecutionCapability,
): ExecutionRequirement | undefined {
  if (value.mode === "Native") return undefined;
  if (value.mode === "Container")
    return {
      mode: "ContainerCapability",
      operatingSystem: value.operatingSystem,
      architecture: value.architecture,
      capabilities: [capability],
    };
  return {
    ...value,
    capabilities: [...new Set([...value.capabilities, capability])],
  };
}

/**
 * Whether the two statements of the platform default agree. The conversion
 * above exists only to bridge a mode mismatch, so where there is none the two
 * are compared as they stand however the worker is authored: naming an agent
 * does not make one image stand for another, and a default left behind by a
 * bumped image field is a disagreement rather than a pair to reconcile.
 */
function platformDefaultMatchesLegacy(
  platformDefault: ExecutionRequirement,
  legacy: ExecutionRequirement,
  capability: ExecutionCapability | undefined,
): boolean {
  if (
    capability === undefined ||
    (platformDefault.mode === "Container" && legacy.mode === "Container")
  )
    return JSON.stringify(platformDefault) === JSON.stringify(legacy);
  const effectiveDefault = platformDefaultComparable(
    platformDefault,
    capability,
  );
  const effectiveLegacy = platformDefaultComparable(legacy, capability);
  return (
    effectiveDefault !== undefined &&
    effectiveLegacy !== undefined &&
    refines(effectiveDefault, effectiveLegacy)
  );
}

/**
 * The requirements a configuration states, held to the two rules its shape
 * cannot say: the platform default is the image field's requirement, and every
 * other default refines it.
 */
function configuredRequirements(
  configured: z.output<typeof executionRequirementsSchema>,
  legacy: ExecutionRequirement,
  stageQualifiedEvaluation: boolean,
  capability: ExecutionCapability | undefined,
): RequirementConfiguration | undefined {
  const { platformDefault, ticketDefault, taskKindDefaults = {} } = configured;
  if (!platformDefaultMatchesLegacy(platformDefault, legacy, capability))
    return undefined;
  const candidates = [ticketDefault, ...Object.values(taskKindDefaults)];
  if (
    candidates.some(
      (candidate) =>
        candidate !== undefined && !refines(candidate, platformDefault),
    )
  )
    return undefined;
  return {
    platformDefault,
    platformDefaultVersion: configured.platformDefaultVersion,
    ...(ticketDefault === undefined ? {} : { ticketDefault }),
    taskKindDefaults,
    stageQualifiedEvaluation,
  };
}

function parsedConfiguration(
  value: unknown,
): RequirementConfiguration | undefined {
  const parsed = releaseConfigurationHeaderSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const legacy: ExecutionRequirement = {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: parsed.data.image,
  };
  const stageQualifiedEvaluation = record(value)?.["evaluations"] !== undefined;
  if (parsed.data.executionRequirements !== undefined)
    return configuredRequirements(
      parsed.data.executionRequirements,
      legacy,
      stageQualifiedEvaluation,
      executionAgentCapability(value),
    );
  return {
    platformDefault: legacy,
    platformDefaultVersion: 1,
    stageQualifiedEvaluation,
  };
}

/** Whether a release reads a configuration's version, its image and where its tasks run. */
export function executionRequirementConfigurationIsValid(
  value: unknown,
): boolean {
  return parsedConfiguration(value) !== undefined;
}

export function materializeExecutionRequirement(
  configuration: unknown,
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
      (stage === undefined || !Number.isSafeInteger(stage) || stage < 1))
  )
    throw new TypeError("execution task kind and stage are inconsistent");
  const kindKey: ExecutionTaskKindKey =
    kind === "Work" || !parsed.stageQualifiedEvaluation
      ? kind
      : `Evaluation:${stage as number}`;
  const kindDefault = parsed.taskKindDefaults?.[kindKey];
  const value = kindDefault ?? parsed.ticketDefault ?? parsed.platformDefault;
  const capability = executionAgentCapability(configuration);
  const selected = requirementForAgent(value, capability);
  if (selected === undefined)
    throw new TypeError(
      "single-agent worker requires a container execution requirement",
    );
  const source: RequirementSource =
    kindDefault !== undefined
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
