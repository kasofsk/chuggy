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
import { grantTaskAuthority } from "../../interpreter/taskAuthority.ts";
import type { PolicyAuthorityGrant } from "../../interpreter/taskAuthority.ts";
import type { RuntimeFactsPort } from "../../interpreter/taskBriefing.ts";

/** What policy grants one kind of logical task: the profile it runs under and its ceiling. */
export interface SuppliedExecutionProfile {
  readonly profile: ExecutionProfile;
  readonly grant: PolicyAuthorityGrant;
}

/** The execution policy a deployment states, one entry per kind of logical task. */
export interface SuppliedExecutionPolicyConfig {
  readonly profiles: ReadonlyMap<ExecutionTaskKind, SuppliedExecutionProfile>;
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

/** Resolves the profile a deployment states for this kind of logical task. */
export function suppliedExecutionPolicy(
  input: SuppliedExecutionPolicyConfig,
): ExecutionPolicy {
  const config = checkedSuppliedExecutionPolicyConfig(input);
  return {
    profileFor: (execution: LogicalExecution): Promise<ProfileResolved> => {
      const supplied = config.profiles.get(execution.taskKind);
      return Promise.resolve(
        supplied === undefined
          ? { resolved: "Denied", reason: "ExecutionProfileUnavailable" }
          : {
              resolved: "Profile",
              profile: supplied.profile,
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
