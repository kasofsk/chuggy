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
import type { ExecutionCapability } from "../../interpreter/executionRequirement.ts";
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

export interface SuppliedRuntime {
  readonly image: string;
  readonly capabilities: readonly ExecutionCapability[];
}

function suppliedRuntime(runtime: string | SuppliedRuntime): SuppliedRuntime {
  return typeof runtime === "string"
    ? { image: runtime, capabilities: ["Agent:Claude"] }
    : runtime;
}

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
  if (requirement.mode === "Container")
    return runtimes.some((runtime) => runtime.image === requirement.image)
      ? {}
      : { denied: { resolved: "Denied", reason: "ExecutionPolicyDenied" } };
  const runtime = runtimes.find((candidate) =>
    requirement.capabilities.every((capability) =>
      candidate.capabilities.includes(capability),
    ),
  );
  return runtime === undefined
    ? {
        denied: { resolved: "Denied", reason: "RequiredCapabilityUnavailable" },
      }
    : { image: runtime.image };
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
