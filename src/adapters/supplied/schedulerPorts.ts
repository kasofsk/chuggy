/**
 * The scheduler ports a deployment answers with plain data: the mandatory
 * execution policy and the runtime facts observable before a worker exists.
 *
 * NOTHING IS OBSERVED OF A WORKSPACE THAT DOES NOT EXIST YET. This backend
 * places a pod, and the workspace is the worker's own, so the facts gathered
 * before a placement are the workspace path a deployment states its image uses
 * and nothing else. Changed files and handoffs are the empty lists they truly
 * are, rather than an outage the launch path would hold on.
 *
 * A GRANT IS REFUSED WHERE IT IS SUPPLIED. `grantTaskAuthority` is the one
 * place a policy answer enters the authority machinery, so a grant this tree's
 * vocabulary does not name fails when the process is composed rather than at
 * the first launch that reads it.
 */

import type {
  ExecutionPolicy,
  ExecutionProfile,
  ExecutionTaskKind,
  LogicalExecution,
  ProfileResolved,
} from "../../interpreter/executionScheduler.ts";
import type {
  Architecture,
  CapabilityExecutionRequirement,
  ExecutionCapability,
  OperatingSystem,
} from "../../interpreter/executionRequirement.ts";
import { grantTaskAuthority } from "../../interpreter/taskAuthority.ts";
import type { PolicyAuthorityGrant } from "../../interpreter/taskAuthority.ts";
import type { RuntimeFactsPort } from "../../interpreter/taskBriefing.ts";

/** What policy grants one kind of logical task: the profile it runs under and its ceiling. */
export interface SuppliedExecutionProfile {
  readonly profile: ExecutionProfile;
  readonly grant: PolicyAuthorityGrant;
}

/**
 * The execution policy a deployment states: what each kind of logical task may
 * do, and the admitted runtimes used to admit exact images or resolve capabilities.
 */
export interface SuppliedExecutionPolicyConfig {
  readonly profiles: ReadonlyMap<ExecutionTaskKind, SuppliedExecutionProfile>;
  readonly imagesAdmitted: readonly (string | SuppliedRuntime)[];
}

/**
 * One image a deployment admits, where omitting the capabilities says nothing
 * about what its worker provides — admitted before a deployment published
 * any — and leaves that unknown rather than nothing. An empty list is the
 * opposite statement, which no deployment means, so it is refused where the
 * policy is composed.
 */
export interface SuppliedRuntime {
  readonly image: string;
  readonly operatingSystem: OperatingSystem;
  readonly architecture: Architecture;
  readonly capabilities?: readonly ExecutionCapability[];
}

function suppliedRuntime(runtime: string | SuppliedRuntime): SuppliedRuntime {
  return typeof runtime === "string"
    ? { image: runtime, operatingSystem: "Linux", architecture: "Amd64" }
    : runtime;
}

/**
 * What an entry that declares no capabilities is taken to provide when a
 * requirement asks for a worker by capability. There is no image to fall back
 * on in that case, and every image admitted before capabilities were declared
 * is a Claude worker.
 */
const suppliedUndeclaredCapabilities: readonly ExecutionCapability[] = [
  "Agent:Claude",
];

/** What a deployment states about the workspace its worker image runs in. */
export interface SuppliedRuntimeFactsConfig {
  readonly workspace?: string;
}

/** Refuses a policy that grants nothing, and any grant this tree's vocabulary does not name. */
export function checkedSuppliedExecutionPolicyConfig(
  config: SuppliedExecutionPolicyConfig,
): SuppliedExecutionPolicyConfig {
  if (config.profiles.size === 0)
    throw new RangeError("supplied execution policy grants no task kind");
  if (config.imagesAdmitted.length === 0)
    throw new RangeError("supplied execution policy admits no image");
  if (
    config.imagesAdmitted.some(
      (runtime) =>
        (typeof runtime === "string" ? runtime : runtime.image).length === 0,
    )
  )
    throw new RangeError("supplied execution policy admits an empty image");
  if (
    config.imagesAdmitted.some(
      (runtime) =>
        typeof runtime !== "string" && runtime.capabilities?.length === 0,
    )
  )
    throw new RangeError(
      "supplied execution policy publishes an empty capability list",
    );
  for (const supplied of config.profiles.values()) {
    if (supplied.profile.profile.length === 0)
      throw new RangeError("supplied execution policy names an empty profile");
    if (supplied.profile.runtimeVersion.length === 0)
      throw new RangeError(
        "supplied execution policy names an empty runtime version",
      );
    grantTaskAuthority(supplied.grant);
  }
  return config;
}

/**
 * Whether this site runs the image an execution pins, and whether that image
 * provides the agent its configuration names. The pin is what runs: an entry
 * that declares its capabilities is refused for an agent it does not provide,
 * and an entry that declares none is admitted as the author's choice, because
 * a deployment that never said what an image provides has not said it does not
 * provide this.
 */
function suppliedPinnedAdmission(
  runtimes: readonly SuppliedRuntime[],
  image: string,
  capability: ExecutionCapability | undefined,
): { readonly denied: ProfileResolved } | Record<string, never> {
  const denied = {
    denied: { resolved: "Denied", reason: "ExecutionPolicyDenied" },
  } as const;
  const entry = runtimes.find((runtime) => runtime.image === image);
  if (entry === undefined) return denied;
  if (capability === undefined || entry.capabilities === undefined) return {};
  return entry.capabilities.includes(capability) ? {} : denied;
}

/**
 * The admitted entry that serves a requirement stated as capabilities, taken
 * from the end of the list: a version is bounded text no reader orders, so the
 * order a deployment wrote its entries in is the only account of which of them
 * is the most recently admitted.
 */
function suppliedCapabilityAdmission(
  runtimes: readonly SuppliedRuntime[],
  requirement: CapabilityExecutionRequirement,
): { readonly denied: ProfileResolved } | { readonly image: string } {
  const runtime = runtimes.findLast(
    (candidate) =>
      candidate.operatingSystem === requirement.operatingSystem &&
      candidate.architecture === requirement.architecture &&
      requirement.capabilities.every((capability) =>
        (candidate.capabilities ?? suppliedUndeclaredCapabilities).includes(
          capability,
        ),
      ),
  );
  return runtime === undefined
    ? {
        denied: { resolved: "Denied", reason: "RequiredCapabilityUnavailable" },
      }
    : { image: runtime.image };
}

/**
 * Whether this site runs what the execution's pinned requirement names. A
 * native requirement is refused by capability rather than by policy: no image
 * list can admit one, and the reason a caller reads should say which of the two
 * it ran into.
 */
function suppliedAdmission(
  config: SuppliedExecutionPolicyConfig,
  execution: LogicalExecution,
): { readonly denied: ProfileResolved } | { readonly image?: string } {
  const requirement = execution.requirement;
  const runtimes = config.imagesAdmitted.map(suppliedRuntime);
  if (requirement.mode === "Native")
    return {
      denied: { resolved: "Denied", reason: "RequiredCapabilityUnavailable" },
    };
  return requirement.mode === "Container"
    ? suppliedPinnedAdmission(
        runtimes,
        requirement.image,
        execution.agentCapability,
      )
    : suppliedCapabilityAdmission(runtimes, requirement);
}

/** Admits what this site runs, then resolves the profile it states for this kind of logical task. */
export function suppliedExecutionPolicy(
  input: SuppliedExecutionPolicyConfig,
): ExecutionPolicy {
  const config = checkedSuppliedExecutionPolicyConfig(input);
  return {
    profileFor: (execution: LogicalExecution): Promise<ProfileResolved> => {
      const admission = suppliedAdmission(config, execution);
      if ("denied" in admission) return Promise.resolve(admission.denied);
      const supplied = config.profiles.get(execution.taskKind);
      return Promise.resolve(
        supplied === undefined
          ? { resolved: "Denied", reason: "ExecutionProfileUnavailable" }
          : {
              resolved: "Profile",
              profile: supplied.profile,
              ...admission,
              grant: supplied.grant,
            },
      );
    },
  };
}

/** Reports the workspace a deployment states and the empty context a placement has. */
export function suppliedRuntimeFacts(
  config: SuppliedRuntimeFactsConfig,
): RuntimeFactsPort {
  return {
    facts: () =>
      Promise.resolve({
        read: "Facts",
        facts: {
          ...(config.workspace === undefined
            ? {}
            : { workspace: config.workspace }),
          changedFiles: [],
          handoff: [],
        },
      }),
  };
}
