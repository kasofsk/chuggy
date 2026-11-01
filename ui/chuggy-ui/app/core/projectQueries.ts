/**
 * The project's own reads that no frame names: what the reader may do, where
 * its work and its sessions run, its selector's settings, its bindings and its
 * people. Each is under the partition and under no kind, so the partition's
 * refetch is what reaches it, and a write that changes one invalidates it by
 * the query's own key.
 */

import type { QueryClient } from "@tanstack/query-core";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { apiProjectAuthorities, apiProjectPeople } from "./accessRoutes.ts";
import {
  apiExecutionPlacement,
  apiForgeApps,
  apiHostedRuns,
  apiOwnerFallback,
  apiProjectAbilities,
  apiProjectArtifact,
  apiProjectRepositories,
  apiSelectorSettings,
  apiSelectorSettingsHistory,
  apiSessionPlacement,
  apiWorkerPools,
} from "./apiRoutes.ts";
import { consolePartitionQuery } from "./consoleQuery.ts";
import { sessionPlacementPolledMs } from "./sessionRunners.ts";

export function projectAbilitiesQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "abilities", (ports) =>
    apiProjectAbilities(ports, partition),
  );
}

export function executionPlacementQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "execution-placement", (ports) =>
    apiExecutionPlacement(ports, partition),
  );
}

export function ownerFallbackQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "owner-fallback", (ports) =>
    apiOwnerFallback(ports, partition),
  );
}

/** Polled, since nothing names the placement or a runner's poll. */
export function sessionPlacementQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(
    partition,
    "session-placement",
    (ports) => apiSessionPlacement(ports, partition),
    sessionPlacementPolledMs,
  );
}

export function workerPoolsQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "worker-pools", (ports) =>
    apiWorkerPools(ports, partition),
  );
}

export function selectorSettingsQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "selector-settings", (ports) =>
    apiSelectorSettings(ports, partition),
  );
}

export function selectorSettingsHistoryQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(
    partition,
    "selector-settings-history",
    (ports) => apiSelectorSettingsHistory(ports, partition),
  );
}

export function hostedRunsQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "hosted-runs", (ports) =>
    apiHostedRuns(ports, partition),
  );
}

/** The site's apps as the project's repositories page reads them, apart from
 * the tenant's entry `forgeAppsQuery` keeps. */
export function projectForgeAppsQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "forge-apps", (ports) =>
    apiForgeApps(ports),
  );
}

/**
 * The project's bindings, asking what the worker App reaches of each. A bind
 * raises no frame, so it invalidates both this and
 * `projectRepositoriesReachUnaskedQuery`, which do not ask the same thing and
 * so hold different answers under different keys.
 */
export function projectRepositoriesQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "project-repositories", (ports) =>
    apiProjectRepositories(ports, partition, { reach: true }),
  );
}

export function projectRepositoriesReachUnaskedQuery(
  partition: PartitionIdentity,
) {
  return consolePartitionQuery(
    partition,
    "project-repositories-reach-unasked",
    (ports) => apiProjectRepositories(ports, partition, { reach: false }),
  );
}

/** Both reads of a project's bindings, which a write to a binding leaves stale. */
export async function projectRepositoriesInvalidated(
  client: QueryClient,
  partition: PartitionIdentity,
): Promise<void> {
  await Promise.all(
    [
      projectRepositoriesQuery(partition),
      projectRepositoriesReachUnaskedQuery(partition),
    ].map((query) => client.invalidateQueries({ queryKey: query.queryKey })),
  );
}

export function projectPermissionsQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "access-authorities", (ports) =>
    apiProjectAuthorities(ports, partition.tenant, partition.project),
  );
}

export function projectPeopleQuery(partition: PartitionIdentity) {
  return consolePartitionQuery(partition, "access-people", (ports) =>
    apiProjectPeople(ports, partition.tenant, partition.project),
  );
}

/** One image, beside the project's other reads. */
export function projectImageQuery(
  partition: PartitionIdentity,
  artifact: string,
) {
  return consolePartitionQuery(
    partition,
    `artifacts/${artifact}`,
    (ports, signal) => apiProjectArtifact(ports, partition, artifact, signal),
  );
}
