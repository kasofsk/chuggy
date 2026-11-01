/**
 * The API, as this browser's ports and as the one bridge a screen reads a
 * console query through.
 *
 * What a read is — its key, its fetch, its type and its freshness — is the
 * query's, in `core/consoleQuery.ts` and the factories built on it. What is
 * here is only what needs this tab: the session the ports run under, whether
 * the stream holds its position, and the cache.
 *
 * A PAGED LIST IS READ THROUGH `usePanelPages`, the same bridge over an
 * infinite query: a reader's press asks for the next page, a reread reads the
 * pages again from the first, and the cache runs the two one after the other,
 * so neither lands over the other.
 */

import {
  hashKey,
  infiniteQueryOptions,
  notifyManager,
  queryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  QueryClient,
  QueryKey,
  UseQueryResult,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { apiPortsOver } from "../core/apiPorts.ts";
import { apiOrThrow } from "../core/apiRequest.ts";
import type { ApiPorts } from "../core/apiRequest.ts";
import type { ProjectQueryKey } from "../core/projectQueryKeys.ts";
import { consolePagesMore } from "../core/consoleQuery.ts";
import type { ConsolePagesQuery, ConsoleQuery } from "../core/consoleQuery.ts";
import {
  panelFailureReason,
  panelReason,
  panelStateFromQuery,
} from "../core/freshness.ts";
import type { PanelState } from "../core/freshness.ts";
import { panelPagesDefaults } from "../core/panelQueryDefaults.ts";
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

/** What turns a console query into the cache's options under this tab's ports
 * and stream, for `useQueries` over several of them. */
export function usePanelQueryOptions(): <T>(
  query: ConsoleQuery<T>,
) => ReturnType<typeof panelQueryOptions<T>> {
  const ports = useApiPorts();
  const streamHolding = useProjectStreamHolding();
  return (query) => panelQueryOptions(ports, streamHolding, query);
}

/** What of a query's answer its panel state is drawn from, a list's pages or
 * one resource alike. */
interface PanelQueryAnswer<T> {
  readonly data: T | undefined;
  readonly error: Error | null;
  readonly isPending: boolean;
  readonly dataUpdatedAt: number;
  readonly refetch: () => Promise<unknown>;
}

/** The query's state, carrying a press that reads it again where its last read
 * failed. */
export function panelQueryState<T>(query: PanelQueryAnswer<T>): PanelState<T> {
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
  query: { readonly isFetched: boolean },
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

/** A paged list's options under this tab's ports: each page its own read,
 * from where the pages before it say the next begins, the rows drawn from the
 * pages through `select`, and a failed read asked again only as
 * `panelPagesDefaults` says. */
export function panelPagesOptions<P, Param, R>(
  ports: ApiPorts,
  client: QueryClient,
  query: ConsolePagesQuery<P, Param, R>,
) {
  return infiniteQueryOptions<P, Error, R, ProjectQueryKey, Param>({
    ...panelPagesDefaults(
      () => client.getQueryState(query.queryKey),
      query.rereadHeldAgain,
    ),
    queryKey: query.queryKey,
    /** The context's page parameter is a conditional type the library leaves
     * unresolved over a generic `Param`, which is what `initialPageParam` and
     * `getNextPageParam` make it. */
    queryFn: async ({ signal, pageParam }) =>
      apiOrThrow(
        await query.read(ports, signal, pageParam as Param),
        panelReason,
      ),
    initialPageParam: query.first,
    getNextPageParam: (_last, pages, _lastAt, pageParams) =>
      query.next({ pages, pageParams }),
    select: query.rows,
    refetchInterval: query.polledMs ?? false,
    staleTime: 0,
  });
}

/** What a screen may say of a paged list beyond what the list says of itself. */
export type PanelPagesObserved<P, Param, R> = ConsolePagesQuery<P, Param, R> & {
  readonly placeholderData?: typeof keepPreviousData;
};

/** A page after the first that could not be read, or a reread behind rows
 * that could not, while the rows already read stand. */
export interface PanelPagesFailure {
  readonly reason: string;
  /** Whether it was the reader's own press, whose page can be asked for again. */
  readonly more: boolean;
}

export interface PanelPages<R> {
  readonly state: PanelState<R>;
  /** The rows drawn are an earlier ask's, standing until this one answers. */
  readonly kept: boolean;
  readonly failure: PanelPagesFailure | undefined;
  /** The reader's press, where the list has a next page to give it. */
  readonly readMore: (() => void) | undefined;
  readonly reading: boolean;
}

/**
 * `usePanelState` for a paged list: its rows as a panel draws them, the press
 * that reads the next page, and why a page could not be read. A press that
 * fails is no reread failing, so the panel draws the rows as answered, and a
 * second press on a list while one is out is the first, which ends once
 * another list is drawn.
 */
export function usePanelPages<P, Param, R>(
  query: PanelPagesObserved<P, Param, R>,
): PanelPages<R> {
  useProjectListRefresh(query.list);
  const ports = useApiPorts();
  const client = useQueryClient();
  const keyed = hashKey(query.queryKey);
  const pressing = useRef<string | undefined>(undefined);
  const answer = useInfiniteQuery({
    ...panelPagesOptions(ports, client, query),
    ...(query.placeholderData === undefined
      ? {}
      : { placeholderData: query.placeholderData }),
  });
  /** The key the observer reads, moved in the effect after the one that moves
   * the observer, so a press's next page is asked of the list it began on. */
  const observed = useRef(keyed);
  useEffect(() => {
    observed.current = keyed;
  });
  const more = answer.isFetchNextPageError;
  const state = usePanelAbsenceKept(
    query.queryKey,
    answer,
    panelQueryState({ ...answer, error: more ? null : answer.error }),
  );
  const reason = panelFailureReason(answer.error);
  const kept = answer.isPlaceholderData;
  const readMore = (): void => {
    if (pressing.current === keyed) return;
    pressing.current = keyed;
    void consolePagesMore(
      query,
      client.getQueryData(query.queryKey)?.pages.length ?? 0,
      async () => {
        if (observed.current !== keyed)
          return { pages: undefined, failed: false };
        await answer.fetchNextPage({ cancelRefetch: false });
        const held = client.getQueryState(query.queryKey);
        return { pages: held?.data, failed: held?.status === "error" };
      },
    ).finally(() => {
      if (pressing.current === keyed) pressing.current = undefined;
    });
  };
  return {
    state,
    kept,
    failure:
      reason === undefined || answer.data === undefined || kept
        ? undefined
        : { reason, more },
    readMore:
      answer.hasNextPage && !kept && !answer.isFetchingNextPage
        ? readMore
        : undefined,
    reading: answer.isFetchingNextPage,
  };
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
