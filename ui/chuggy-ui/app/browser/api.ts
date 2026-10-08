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

import { queryOptions, useQueries, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { ProjectChangeKind } from "../../../../src/contract/events.ts";
import { apiOrThrow } from "../core/apiRequest.ts";
import type { ApiPorts, ApiResult } from "../core/apiRequest.ts";
import {
  panelReason,
  panelStateFromQuery,
  panelStatePolled,
} from "../core/freshness.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  projectResourceKey,
  projectsInventoryKey,
  tenantResourceKey,
} from "../core/projectQueryKeys.ts";
import type { ProjectList, ProjectQueryKey } from "../core/projectQueryKeys.ts";
import { apiFetch, sleepMs } from "./ports.ts";
import { useSessionHolder } from "./session.tsx";
import { useProjectListRefresh } from "./stream.tsx";

type PanelRead<T> = (
  ports: ApiPorts,
  signal: AbortSignal,
) => Promise<ApiResult<T>>;

/**
 * The ports every read runs on, where a refusal the session could not see
 * coming ends it: a 401 reaching here is the API disagreeing with a session
 * this console still believes in, and believing it anyway draws every screen as
 * a failed read while `Sign out`, the only control that could clear it, sits on
 * a bar the landing page never draws.
 *
 * So the token is renewed once against the issuer, and the session is forgotten
 * and said to be where the issuer will not renew it or where the API refuses
 * the fresh one too — a token minted happily and rejected anyway, which is what
 * an audience or a key set changing under a stored session looks like.
 */
export function useApiPorts(): ApiPorts {
  const holder = useSessionHolder();
  return useMemo<ApiPorts>(() => {
    const abandon = async (): Promise<void> => {
      await holder.signOut();
      holder.refuse("the API refused this session, so it was signed out");
    };
    return {
      fetch: apiFetch,
      bearer: () => holder.bearer(),
      sleepMs: (ms: number, signal: AbortSignal | undefined) =>
        sleepMs(ms, signal),
      renew: async () => {
        if (await holder.refresh()) return true;
        await abandon();
        return false;
      },
      refused: abandon,
    };
  }, [holder]);
}

/** One key's read, the same however many keys a screen asks for at once, so a
 * key two screens read is read one way. */
function panelQueryOptions<T>(
  ports: ApiPorts,
  key: ProjectQueryKey,
  read: PanelRead<T>,
  polledMs: number | undefined,
) {
  return queryOptions({
    queryKey: key,
    queryFn: async ({ signal }) =>
      apiOrThrow(await read(ports, signal), panelReason),
    retry: false,
    refetchInterval: polledMs ?? false,
  });
}

function panelQueryState<T>(
  query: UseQueryResult<T>,
  polledMs: number | undefined,
): PanelState<T> {
  const state = {
    data: query.data,
    error: query.error,
    isPending: query.isPending,
    dataUpdatedAt: query.dataUpdatedAt,
  };
  return polledMs === undefined
    ? panelStateFromQuery<T>(state)
    : panelStatePolled<T>(state);
}

function usePanelQuery<T>(
  key: ProjectQueryKey,
  read: PanelRead<T>,
  polledMs?: number,
): PanelState<T> {
  const ports = useApiPorts();
  const query = useQuery(panelQueryOptions(ports, key, read, polledMs));
  return panelQueryState(query, polledMs);
}

/** One resource of one kind, written by the frame that names it — or a part
 * under one, which no frame names and the partition's refetch reaches. One
 * that moves where no frame says so is read again every `polledMs` while a
 * screen draws it and the tab is in view, keeping its last answer if one fails. */
export function usePanelResource<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  resource: string,
  read: PanelRead<T>,
  polledMs?: number,
): PanelState<T> {
  return usePanelQuery(
    projectResourceKey(partition, kind, resource),
    read,
    polledMs,
  );
}

/** Several resources of one kind, each under the key `usePanelResource` reads
 * it at, so a frame naming one writes it and a screen drawing one shares it. */
export function usePanelResources<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  resources: readonly string[],
  read: (
    resource: string,
    ports: ApiPorts,
    signal: AbortSignal,
  ) => Promise<ApiResult<T>>,
): readonly PanelState<T>[] {
  return usePanelResourcesRead(partition, kind, resources, read, true);
}

/** Several resources as `usePanelResources` reads them, answered from what a
 * screen drawing one already read and never requested here, so one no screen
 * has read is pending. */
export function usePanelResourcesHeld<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  resources: readonly string[],
  read: (
    resource: string,
    ports: ApiPorts,
    signal: AbortSignal,
  ) => Promise<ApiResult<T>>,
): readonly PanelState<T>[] {
  return usePanelResourcesRead(partition, kind, resources, read, false);
}

function usePanelResourcesRead<T>(
  partition: PartitionIdentity,
  kind: ProjectChangeKind,
  resources: readonly string[],
  read: (
    resource: string,
    ports: ApiPorts,
    signal: AbortSignal,
  ) => Promise<ApiResult<T>>,
  requested: boolean,
): readonly PanelState<T>[] {
  const ports = useApiPorts();
  const queries = useQueries({
    queries: resources.map((resource) => ({
      ...panelQueryOptions(
        ports,
        projectResourceKey(partition, kind, resource),
        (readPorts, signal) => read(resource, readPorts, signal),
        undefined,
      ),
      enabled: requested,
    })),
  });
  return queries.map((query) => panelQueryState<T>(query, undefined));
}

/** A list entry, whose refresh the list itself carries and this registers,
 * read again every `polledMs` as well where a caller names one. */
export function usePanelList<T>(
  list: ProjectList<T>,
  read: PanelRead<T>,
  polledMs?: number,
): PanelState<T> {
  useProjectListRefresh(list);
  return usePanelQuery(list.key, read, polledMs);
}

/**
 * The inventory, which belongs to no partition and so has no refresh path of
 * its own: `["projects"]` is outside `projectPartitionKey`, so neither a
 * `Project` frame nor the fallback's refetch reaches it and the switcher's list
 * is the one this tab opened with, or last created a project in
 * (kasofsk/chuggy#439).
 */
export function usePanelInventory<T>(read: PanelRead<T>): PanelState<T> {
  return usePanelQuery(projectsInventoryKey(), read);
}

/** One tenant's own resource, shared by every project under it and so outside
 * any one partition's refresh path — the same arrangement as `usePanelInventory`,
 * for a read that belongs to the tenant rather than to no partition at all. */
export function usePanelTenantResource<T>(
  tenant: string,
  resource: string,
  read: PanelRead<T>,
): PanelState<T> {
  return usePanelQuery(tenantResourceKey(tenant, resource), read);
}
