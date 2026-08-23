/**
 * The three scheduler ports a deployment answers with the plain data it
 * supplies: the mandatory execution policy, the immutable pinned
 * configurations, and the runtime facts the fabric can observe before a worker
 * exists.
 *
 * NONE OF THESE READS THE SCHEDULER'S DATABASE, AND THAT IS THE SCHEMA'S
 * DECISION RATHER THAN A CHOICE MADE HERE. `src/adapters/postgres/schema.ts`
 * revokes the scheduler role on `draft`, `draft_revision` and
 * `configuration_revision`, so the process holding a scheduler credential
 * cannot read authored content at all; what it may brief a worker with is
 * therefore what its deployment handed it.
 *
 * A REVISION THIS DEPLOYMENT WAS NOT GIVEN IS A HOLD AND NEVER AN ABSENCE. The
 * `Missing` arm says the pinned revision is definitively gone, which retires
 * the ticket; not having been supplied one is a fact about this process, so it
 * takes `Unavailable` and leaves the execution exactly as it was. A digest that
 * contradicts the pin is not checked twice either — `./taskBriefing.ts` refuses
 * a configuration whose revision or digest is not the pinned one, and a second
 * opinion here could only disagree with it.
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
import type { Partition } from "../../interpreter/projectStore.ts";
import { grantTaskAuthority } from "../../interpreter/taskAuthority.ts";
import type { PolicyAuthorityGrant } from "../../interpreter/taskAuthority.ts";
import type {
  ConfigurationRead,
  PinnedConfigurationPort,
  PinnedTaskConfiguration,
  RuntimeFactsPort,
} from "../../interpreter/taskBriefing.ts";

/** What policy grants one kind of logical task: the profile it runs under and its ceiling. */
export interface SuppliedExecutionProfile {
  readonly profile: ExecutionProfile;
  readonly grant: PolicyAuthorityGrant;
}

/** The execution policy a deployment states, one entry per kind of logical task. */
export interface SuppliedExecutionPolicyConfig {
  readonly profiles: ReadonlyMap<ExecutionTaskKind, SuppliedExecutionProfile>;
}

/** One immutable authored revision as a deployment supplies it, with the partition it belongs to. */
export interface SuppliedTaskConfiguration extends PinnedTaskConfiguration {
  readonly tenant: string;
  readonly project: string;
}

/** What a deployment states about the workspace its worker image runs in. */
export interface SuppliedRuntimeFactsConfig {
  readonly workspace?: string;
}

/** The key one supplied revision is found by, length-prefixed so two partitions cannot collide. */
function suppliedRevisionKey(
  tenant: string,
  project: string,
  revision: string,
): string {
  return [tenant, project, revision]
    .map((part) => `${String(part.length)}:${part}`)
    .join("/");
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

/** Reads back a pinned revision this deployment was supplied, holding on one it was not. */
export function suppliedTaskConfigurations(
  configurations: readonly SuppliedTaskConfiguration[],
): PinnedConfigurationPort {
  const supplied = new Map(
    configurations.map((configuration) => [
      suppliedRevisionKey(
        configuration.tenant,
        configuration.project,
        configuration.configurationRevision,
      ),
      configuration,
    ]),
  );
  return {
    configuration: (partition: Partition, pin): Promise<ConfigurationRead> => {
      const found = supplied.get(
        suppliedRevisionKey(
          partition.tenant,
          partition.project,
          pin.configurationRevision,
        ),
      );
      return Promise.resolve(
        found === undefined
          ? { read: "Unavailable" }
          : { read: "Configuration", configuration: found },
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
