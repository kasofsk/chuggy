/**
 * When a panel's data was last observed, and what to draw when there is none.
 *
 * A resource that states its own `observedAt` is the better answer, because it
 * is when the server saw the world rather than when this tab heard about it;
 * the cache's own update time stands in otherwise. Absence and failure are
 * separate states carrying their reason, so that neither is ever drawn as an
 * empty healthy table. A read that fails behind an answer leaves the answer
 * drawn, saying it was not updated, so nothing a reader holds beneath a panel
 * is taken away by a read they never asked for.
 */

import { ApiOutcomeError } from "./apiRequest.ts";
import type { ApiFailure } from "./apiRequest.ts";
import { agoText } from "./figures.ts";

export const freshnessStaleAfterMs = 60_000;

export type PanelState<T> =
  | { readonly state: "Pending" }
  | {
      readonly state: "Ready";
      readonly value: T;
      readonly observedAtMs: number | undefined;
      readonly rereadFailed?: boolean;
      readonly retry?: () => void;
    }
  | { readonly state: "Absent"; readonly reason: string }
  | {
      readonly state: "Failed";
      readonly reason: string;
      readonly retry?: () => void;
    };

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

export function panelFailureReason(error: unknown): string | undefined {
  if (error instanceof ApiOutcomeError) return panelReason(error.result);
  if (error === null || error === undefined) return undefined;
  return error instanceof Error ? error.message : "the read failed";
}

/** A cache entry is the resource itself, so a failure arrives as the error. An
 * answer of absent wins, because the resource is gone; otherwise an answer held
 * wins over a read that failed, and only a read never answered is failed. */
export function panelStateFromQuery<T>(query: PanelQuery<T>): PanelState<T> {
  const reason = panelFailureReason(query.error);
  if (
    reason !== undefined &&
    query.error instanceof ApiOutcomeError &&
    query.error.result.outcome === "Absent"
  )
    return { state: "Absent", reason };
  if (!query.isPending && query.data !== undefined) {
    const observedAtMs = panelObservedAtMs(
      query.data,
      query.dataUpdatedAt === 0 ? undefined : query.dataUpdatedAt,
    );
    return reason === undefined
      ? { state: "Ready", value: query.data, observedAtMs }
      : { state: "Ready", value: query.data, observedAtMs, rereadFailed: true };
  }
  if (reason !== undefined) return { state: "Failed", reason };
  return { state: "Pending" };
}

/** Whole units only, because a panel header is read at a glance. The rounding
 * itself is `figures.ts`'s `agoText`, so one elapsed time is rounded once. */
export function freshnessLabel(
  nowMs: number,
  observedAtMs: number | undefined,
): string {
  if (observedAtMs === undefined) return "never observed";
  return `${agoText(nowMs, observedAtMs)} ago`;
}

export function freshnessIsStale(
  nowMs: number,
  observedAtMs: number | undefined,
): boolean {
  return (
    observedAtMs === undefined || nowMs - observedAtMs >= freshnessStaleAfterMs
  );
}
