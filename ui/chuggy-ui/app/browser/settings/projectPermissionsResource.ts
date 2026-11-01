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
import type { PanelState } from "../../core/freshness.ts";
import {
  projectPeopleQuery,
  projectPermissionsQuery,
} from "../../core/projectQueries.ts";
import { usePanelState } from "../api.ts";

export function useProjectAuthorities(
  partition: PartitionIdentity,
): PanelState<AccessProjectAuthorities> {
  return usePanelState(projectPermissionsQuery(partition));
}

export function useProjectPeople(
  partition: PartitionIdentity,
): PanelState<AccessProjectPeople> {
  return usePanelState(projectPeopleQuery(partition));
}

export async function projectPermissionsReread(
  client: QueryClient,
  partition: PartitionIdentity,
): Promise<void> {
  await Promise.all(
    [projectPermissionsQuery(partition), projectPeopleQuery(partition)].map(
      (query) => client.invalidateQueries({ queryKey: query.queryKey }),
    ),
  );
}
