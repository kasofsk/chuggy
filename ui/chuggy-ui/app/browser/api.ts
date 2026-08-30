/**
 * The API, as this browser's ports and as the hooks a screen reads it through.
 *
 * A query holds the resource itself and not a wrapper, so that a live change
 * frame can be written into the same key with `setQueryData`; a failed read
 * therefore arrives as the error, carrying the outcome the contract classified.
 *
 * There is a hook per kind of key and none that takes a key. WHAT THAT MAKES
 * UNWRITABLE IS A LIST ENTRY WITH NO REFRESH, and only that: `usePanelList`
 * takes a `ProjectList`, which cannot be made without one, so the omission that
 * left a dispatch panel reading once is now a compile error.
 *
 * IT PROMISES NOTHING ABOUT A RESOURCE. `usePanelResource` takes the resource
 * name as a string, and a name no frame carries typechecks: the evidence panels
 * read parts under an execution — a run's turns, its configuration, an
 * artifact's body — while the change log names the bare execution id. Those
 * entries are reached by the partition's own refetch and by nothing else, which
 * is the freshness a finished run's evidence needs and is not live.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectChangeKind } from "../../../../src/contract/events.ts";
import { apiOrThrow } from "../core/apiRequest.ts";
import type { ApiPorts, ApiResult } from "../core/apiRequest.ts";
import { panelReason, panelStateFromQuery } from "../core/freshness.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  projectResourceKey,
  projectsInventoryKey,
} from "../core/projectQueryKeys.ts";
import type { ProjectList, ProjectQueryKey } from "../core/projectQueryKeys.ts";
import { apiFetch, sleepMs } from "./ports.ts";
import { useSessionHolder } from "./session.tsx";
import { useProjectListRefresh } from "./stream.tsx";

type PanelRead<T> = (
  ports: ApiPorts,
  signal: AbortSignal,
) => Promise<ApiResult<T>>;

export function useApiPorts(): ApiPorts {
  const holder = useSessionHolder();
  return useMemo<ApiPorts>(
    () => ({
      fetch: apiFetch,
      bearer: () => holder.bearer(),
      sleepMs: (ms: number, signal: AbortSignal | undefined) =>
        sleepMs(ms, signal),
    }),
    [holder],
  );
}

function usePanelQuery<T>(
  key: ProjectQueryKey,
  read: PanelRead<T>,
): PanelState<T> {
  const ports = useApiPorts();
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      apiOrThrow(await read(ports, signal), panelReason),
    retry: false,
  });
  return panelStateFromQuery<T>({
    data: query.data,
    error: query.error,
    isPending: query.isPending,
    dataUpdatedAt: query.dataUpdatedAt,
  });
}

/** One resource of one kind, written by the frame that names it — or a part
 * under one, which no frame names and the partition's refetch reaches. */
export function usePanelResource<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  resource: string,
  read: PanelRead<T>,
): PanelState<T> {
  return usePanelQuery(projectResourceKey(partition, kind, resource), read);
}

/** A list entry, whose refresh the list itself carries and this registers. */
export function usePanelList<T>(
  list: ProjectList<T>,
  read: PanelRead<T>,
): PanelState<T> {
  useProjectListRefresh(list);
  return usePanelQuery(list.key, read);
}

/**
 * The inventory, which belongs to no partition and so has no refresh path at
 * all: `["projects"]` is outside `projectPartitionKey`, so neither a `Project`
 * frame nor the fallback's refetch reaches it and the switcher's list is the
 * one this tab opened with (kasofsk/chuggy#439).
 */
export function usePanelInventory<T>(read: PanelRead<T>): PanelState<T> {
  return usePanelQuery(projectsInventoryKey(), read);
}
