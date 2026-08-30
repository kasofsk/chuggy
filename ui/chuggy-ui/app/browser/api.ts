/**
 * The API, as this browser's ports and as the hooks a screen reads it through.
 *
 * A query holds the resource itself and not a wrapper, so that a live change
 * frame can be written into the same key with `setQueryData`; a failed read
 * therefore arrives as the error, carrying the outcome the contract classified.
 *
 * There is a hook per kind of key and none that takes a key, because a panel
 * that named its own entry could name a list entry the stream has not been told
 * about, and a screen with no live refresh path compiles and runs exactly like
 * one that has one. So the key is built here: `usePanelResource` from what a
 * frame of that kind carries, which is what the stream writes; `usePanelList`
 * from a `ProjectList`, which cannot be made without its refresh.
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

export type PanelRead<T> = (
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

/** One resource of one kind: the stream writes this entry from the frame that
 * carries it, so the panel has a live refresh path and declares nothing. */
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

/** The inventory belongs to no partition and so to no stream: it is read at the
 * landing, where there is no project yet to open one for. */
export function usePanelInventory<T>(read: PanelRead<T>): PanelState<T> {
  return usePanelQuery(projectsInventoryKey(), read);
}
