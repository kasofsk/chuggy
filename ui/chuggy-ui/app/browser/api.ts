/**
 * The API, as this browser's ports and as the one bridge a screen reads a
 * console query through.
 *
 * What a read is — its key, its fetch, its type and its freshness — is the
 * query's, in `core/consoleQuery.ts` and the factories built on it. What is
 * here is only what needs this tab: the session the ports run under, whether
 * the stream holds its position, and the cache.
 */

import {
  hashKey,
  notifyManager,
  queryOptions,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  QueryClient,
  QueryKey,
  UseQueryResult,
  keepPreviousData,
} from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { apiPortsOver } from "../core/apiPorts.ts";
import { apiOrThrow } from "../core/apiRequest.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import type { ConsoleQuery } from "../core/consoleQuery.ts";
import { panelReason, panelStateFromQuery } from "../core/freshness.ts";
import type { PanelState } from "../core/freshness.ts";
import { apiFetch, sleepMs } from "./ports.ts";
import { useSessionHolder } from "./session.tsx";
import {
  useProjectListRefresh,
  useProjectStreamHolding,
  useProjectStreamHoldingAsked,
} from "./stream.tsx";

/**
 * The ports every read runs on, where a refusal the session could not see
 * coming ends it. Believing in a session the API refuses draws every screen as
 * a failed read while `Sign out`, the only control that could clear it, sits on
 * a bar the landing page never draws.
 */
export function useApiPorts(): ApiPorts {
  const holder = useSessionHolder();
  return useMemo<ApiPorts>(
    () => apiPortsOver(holder, apiFetch, sleepMs),
    [holder],
  );
}

/** One query's options, the same however many queries a screen asks for at
 * once, so a key two screens read is read one way: kept for ever while the
 * stream holds its position under a `Streamed` read, whose frames keep it, and
 * stale at once otherwise. */
export function panelQueryOptions<T>(
  ports: ApiPorts,
  streamHolding: boolean,
  query: ConsoleQuery<T>,
) {
  return queryOptions({
    queryKey: query.queryKey,
    queryFn: async ({ signal, client }) =>
      apiOrThrow(
        await query.read(ports, signal, client.getQueryData(query.queryKey)),
        panelReason,
      ),
    refetchInterval: query.polledMs ?? false,
    staleTime: query.kept === "Streamed" && streamHolding ? Infinity : 0,
  });
}

/**
 * After a press has written pages into a list's entry, the read of that entry
 * running, if one is, started again, since it gathered from the entry as it
 * stood when it began and would land with fewer pages than the press wrote.
 * The restart cancels it silently, keeping every write since it began, the
 * frames folded among them, and gathers every page the entry now holds; a
 * press that finds no read running starts none.
 */
export function panelReadRestarted(client: QueryClient, key: QueryKey): void {
  if (client.isFetching({ queryKey: key, exact: true }) === 0) return;
  void client.invalidateQueries({ queryKey: key, exact: true });
}

/** What turns a console query into the cache's options under this tab's ports
 * and stream, for `useQueries` over several of them. */
export function usePanelQueryOptions(): <T>(
  query: ConsoleQuery<T>,
) => ReturnType<typeof panelQueryOptions<T>> {
  const ports = useApiPorts();
  const streamHolding = useProjectStreamHolding();
  return (query) => panelQueryOptions(ports, streamHolding, query);
}

/** The query's state, carrying a press that reads it again where its last read
 * failed. */
export function panelQueryState<T>(query: UseQueryResult<T>): PanelState<T> {
  const state = panelStateFromQuery<T>({
    data: query.data,
    error: query.error,
    isPending: query.isPending,
    dataUpdatedAt: query.dataUpdatedAt,
  });
  const retry = (): void => {
    void query.refetch();
  };
  if (state.state === "Failed") return { ...state, retry };
  if (state.state === "Ready" && state.rereadFailed === true)
    return { ...state, retry };
  return state;
}

/**
 * An answer of absent, kept through the read after it and through a read that
 * fails, as an answer of data is. A query holding no data is pending again from
 * the moment it is read again, its error and all, so a resource the reader has
 * none of would be drawn unread on every poll, and what a screen holds beneath
 * that answer taken away with it.
 */
function usePanelAbsenceKept<T>(
  key: QueryKey,
  query: UseQueryResult<T>,
  state: PanelState<T>,
): PanelState<T> {
  const keyed = hashKey(key);
  const [kept, setKept] = useState<
    { readonly keyed: string; readonly reason: string } | undefined
  >(undefined);
  const stands = state.state === "Pending" || state.state === "Failed";
  if (state.state === "Absent") {
    if (kept?.keyed !== keyed || kept.reason !== state.reason)
      setKept({ keyed, reason: state.reason });
  } else if (!stands && kept !== undefined) setKept(undefined);
  return stands && query.isFetched && kept?.keyed === keyed
    ? { state: "Absent", reason: kept.reason }
    : state;
}

/** What a screen may say of one query beyond what the query says of itself:
 * whether it is asked for at all, and what is drawn until it answers. */
export type PanelQueryObserved<T> = ConsoleQuery<T> & {
  readonly enabled?: boolean;
  readonly placeholderData?: typeof keepPreviousData;
};

/**
 * The bridge from a console query to the state a panel draws, registering a
 * list's refresh for as long as the screen is mounted. `combine` is handed the
 * cache's own answer beside that state, for what a screen reads off the query
 * itself.
 */
export function usePanelState<T>(query: PanelQueryObserved<T>): PanelState<T>;
export function usePanelState<T, S>(
  query: PanelQueryObserved<T>,
  combine: (state: PanelState<T>, answer: UseQueryResult<T>) => S,
): S;
export function usePanelState<T, S>(
  query: PanelQueryObserved<T>,
  combine?: (state: PanelState<T>, answer: UseQueryResult<T>) => S,
): PanelState<T> | S {
  useProjectListRefresh("list" in query ? query.list : undefined);
  const ports = useApiPorts();
  const streamHolding = useProjectStreamHoldingAsked(query.kept === "Streamed");
  const answer = useQuery({
    ...panelQueryOptions(ports, streamHolding, query),
    enabled: query.enabled ?? true,
    ...(query.placeholderData === undefined
      ? {}
      : { placeholderData: query.placeholderData }),
  });
  const state = usePanelAbsenceKept(
    query.queryKey,
    answer,
    panelQueryState(answer),
  );
  return combine === undefined ? state : combine(state, answer);
}

/** How many times one key's read has answered: every read that landed and
 * every write held as one moves it, and a failed read does not. Only that
 * key's events are heard, and the cache tells its listeners inside another
 * component's render whenever a query is built there, so this hears them once
 * the cache's batch is over, as the library's own hooks of the cache do. */
export function usePanelAnswers(key: QueryKey): number {
  const client = useQueryClient();
  const keyed = hashKey(key);
  const subscribe = useCallback(
    (changed: () => void) =>
      client.getQueryCache().subscribe(
        notifyManager.batchCalls((event) => {
          if (event.query.queryHash === keyed) changed();
        }),
      ),
    [client, keyed],
  );
  return useSyncExternalStore(
    subscribe,
    () => client.getQueryState(key)?.dataUpdateCount ?? 0,
  );
}
