/**
 * Who holds a project's permissions and the project's people, read as two
 * resources of the partition and read again together after a holder is added
 * or removed.
 */

import type { QueryClient } from "@tanstack/react-query";

import type {
  AccessProjectAuthorities,
  AccessProjectPeople,
} from "../../../../../src/contract/accessPlane.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import {
  apiProjectAuthorities,
  apiProjectPeople,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import { usePanelResource } from "../api.ts";

/** No frame names these reads, so the partition's own refetch and a change's invalidation are what reach them. */
export const projectPermissionsResource = "access-authorities";

export const projectPeopleResource = "access-people";

export function useProjectAuthorities(
  partition: PartitionIdentity,
): PanelState<AccessProjectAuthorities> {
  return usePanelResource(
    partition,
    "Project",
    projectPermissionsResource,
    (ports) =>
      apiProjectAuthorities(ports, partition.tenant, partition.project),
  );
}

export function useProjectPeople(
  partition: PartitionIdentity,
): PanelState<AccessProjectPeople> {
  return usePanelResource(
    partition,
    "Project",
    projectPeopleResource,
    (ports) => apiProjectPeople(ports, partition.tenant, partition.project),
  );
}

export async function projectPermissionsReread(
  client: QueryClient,
  partition: PartitionIdentity,
): Promise<void> {
  await Promise.all(
    [projectPermissionsResource, projectPeopleResource].map((resource) =>
      client.invalidateQueries({
        queryKey: projectResourceKey(partition, "Project", resource),
      }),
    ),
  );
}
