/**
 * The API, as this browser's ports and as the hook a screen reads it through.
 *
 * A query holds the resource itself and not a wrapper, so that a live change
 * frame can be written into the same key with `setQueryData`; a failed read
 * therefore arrives as the error, carrying the outcome the contract classified.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { apiOrThrow } from "../core/apiRequest.ts";
import type { ApiPorts, ApiResult } from "../core/apiRequest.ts";
import { panelReason, panelStateFromQuery } from "../core/freshness.ts";
import type { PanelState } from "../core/freshness.ts";
import type { ProjectQueryKey } from "../core/projectQueryKeys.ts";
import { apiFetch, sleepMs } from "./ports.ts";
import { useSessionHolder } from "./session.tsx";

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

/** The one hook a screen reads a resource through, and the panel state it draws. */
export function usePanelQuery<T>(
  key: ProjectQueryKey,
  read: (ports: ApiPorts, signal: AbortSignal) => Promise<ApiResult<T>>,
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
