/**
 * How the console's cache reads again on its own: a read that failed is read
 * again when the tab comes back into view or back online, and one the network
 * or the server failed is asked twice more first, on the library's backoff.
 *
 * Written over the query's shape rather than the library's types, so the
 * decision stays reachable from a suite with no cache.
 */

import { ApiOutcomeError } from "./apiRequest.ts";

export const panelQueryRetriesMax = 2;

interface PanelQueryStatus {
  readonly state: { readonly status: string };
}

/** Only a read that failed, since a live frame is what updates one that did not. */
export function panelQueryFailedRefetched(query: PanelQueryStatus): boolean {
  return query.state.status === "error";
}

/** `apiRequest.ts` already spends a `Retryable` answer, and every other
 * refusal is an answer that asking again would not change. */
export function panelQueryRetried(failures: number, error: unknown): boolean {
  if (failures >= panelQueryRetriesMax) return false;
  if (!(error instanceof ApiOutcomeError)) return false;
  switch (error.result.outcome) {
    case "Unreachable":
    case "Fault":
      return true;
    case "Absent":
    case "Rejected":
    case "Conflict":
    case "Unauthenticated":
    case "Retryable":
    case "Unreadable":
      return false;
  }
}

/** What of a paged list's query says which of its reads failed. */
interface PanelPagesStatus {
  readonly status: string;
  readonly data: unknown;
  readonly fetchMeta: { readonly fetchMore?: unknown } | null;
}

/**
 * Whether a paged list's read that failed may be asked again on its own. A
 * reader's press never is, so its failure stands until the reader presses
 * again; a reread behind pages already held only where the list says so; and
 * a read holding no pages always is.
 */
export function panelPagesFailedAgain(
  query: PanelPagesStatus | undefined,
  rereadHeldAgain: boolean,
): boolean {
  if (query?.fetchMeta?.fetchMore !== undefined) return false;
  return rereadHeldAgain || query?.data === undefined;
}

export const panelQueryDefaults = {
  refetchOnWindowFocus: panelQueryFailedRefetched,
  refetchOnReconnect: panelQueryFailedRefetched,
  retry: panelQueryRetried,
} as const;
