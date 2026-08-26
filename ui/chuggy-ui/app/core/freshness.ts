/**
 * When a panel's data was last observed, and what to draw when there is none.
 *
 * A resource that states its own `observedAt` is the better answer, because it
 * is when the server saw the world rather than when this tab heard about it;
 * the cache's own update time stands in otherwise. Absence and failure are
 * separate states carrying their reason, so that neither is ever drawn as an
 * empty healthy table.
 */

import { ApiOutcomeError } from "./apiRequest.ts";
import type { ApiFailure } from "./apiRequest.ts";

export const freshnessStaleAfterMs = 60_000;

export type PanelState<T> =
  | { readonly state: "Pending" }
  | {
      readonly state: "Ready";
      readonly value: T;
      readonly observedAtMs: number | undefined;
    }
  | { readonly state: "Absent"; readonly reason: string }
  | { readonly state: "Failed"; readonly reason: string };

/** The resource's own observation when it states one, and the cache's if not. */
export function panelObservedAtMs(
  value: unknown,
  dataUpdatedAtMs: number | undefined,
): number | undefined {
  if (value !== null && typeof value === "object" && "observedAt" in value) {
    const stated = (value as { readonly observedAt: unknown }).observedAt;
    if (typeof stated === "string") {
      const parsed = Date.parse(stated);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return dataUpdatedAtMs;
}

export function panelReason(result: ApiFailure): string {
  switch (result.outcome) {
    case "Unauthenticated":
      return "this session is not signed in";
    case "Absent":
      return "the API has no such resource, or will not show it to you";
    case "Conflict":
      return `the API refused this read as ${result.code}`;
    case "Retryable":
      return `the API asked to be tried again and kept saying so`;
    case "Rejected":
      return `the API rejected this read as ${result.code}`;
    case "Fault":
      return `the API failed with ${result.code}`;
    case "Unreachable":
      return `the API could not be reached: ${result.reason}`;
    case "Unreadable":
      return `the API answered something this console cannot read: ${result.reason}`;
  }
}

export interface PanelQuery<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly dataUpdatedAt: number;
}

/** A cache entry is the resource itself, so a failure arrives as the error. */
export function panelStateFromQuery<T>(query: PanelQuery<T>): PanelState<T> {
  if (query.error instanceof ApiOutcomeError)
    return query.error.result.outcome === "Absent"
      ? { state: "Absent", reason: panelReason(query.error.result) }
      : { state: "Failed", reason: panelReason(query.error.result) };
  if (query.error !== null && query.error !== undefined)
    return {
      state: "Failed",
      reason:
        query.error instanceof Error ? query.error.message : "the read failed",
    };
  if (query.isPending || query.data === undefined) return { state: "Pending" };
  return {
    state: "Ready",
    value: query.data,
    observedAtMs: panelObservedAtMs(
      query.data,
      query.dataUpdatedAt === 0 ? undefined : query.dataUpdatedAt,
    ),
  };
}

/** Whole units only, because a panel header is read at a glance. */
export function freshnessLabel(
  nowMs: number,
  observedAtMs: number | undefined,
): string {
  if (observedAtMs === undefined) return "never observed";
  const elapsedSeconds = Math.max(
    Math.floor((nowMs - observedAtMs) / 1_000),
    0,
  );
  if (elapsedSeconds < 60) return `${String(elapsedSeconds)}s ago`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

export function freshnessIsStale(
  nowMs: number,
  observedAtMs: number | undefined,
): boolean {
  return (
    observedAtMs === undefined || nowMs - observedAtMs >= freshnessStaleAfterMs
  );
}
