/**
 * When a panel's data was last observed, and what to draw when there is none.
 *
 * A resource that states its own `observedAt` is the better answer, because it
 * is when the server saw the world rather than when this tab heard about it;
 * the cache's own update time stands in otherwise. Absence and failure are
 * separate states, a failure carrying its outcome, so that neither is ever
 * drawn as an empty healthy table. A read that fails behind an answer leaves
 * the answer drawn, saying it was not updated, so nothing a reader holds
 * beneath a panel is taken away by a read they never asked for.
 */

import { ApiOutcomeError } from "./apiRequest.ts";
import type { ApiFailure } from "./apiRequest.ts";
import { agoText } from "./figures.ts";
import { failureOfThrown } from "./failureWords.ts";

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
  | { readonly state: "Absent" }
  | {
      readonly state: "Failed";
      readonly failure: ApiFailure;
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

export interface PanelQuery<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly dataUpdatedAt: number;
}

function panelFailure(error: unknown): ApiFailure | undefined {
  if (error instanceof ApiOutcomeError) return error.result;
  if (error === null || error === undefined) return undefined;
  return failureOfThrown(error);
}

/** A cache entry is the resource itself, so a failure arrives as the error. An
 * answer of absent wins, because the resource is gone; otherwise an answer held
 * wins over a read that failed, and only a read never answered is failed. */
export function panelStateFromQuery<T>(query: PanelQuery<T>): PanelState<T> {
  const failure = panelFailure(query.error);
  if (failure?.outcome === "Absent") return { state: "Absent" };
  if (!query.isPending && query.data !== undefined) {
    const observedAtMs = panelObservedAtMs(
      query.data,
      query.dataUpdatedAt === 0 ? undefined : query.dataUpdatedAt,
    );
    return failure === undefined
      ? { state: "Ready", value: query.data, observedAtMs }
      : { state: "Ready", value: query.data, observedAtMs, rereadFailed: true };
  }
  if (failure !== undefined) return { state: "Failed", failure };
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
