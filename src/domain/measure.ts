/**
 * The termination measure: a nonnegative integer per ticket, summed over the
 * fleet, that every non-exempt step strictly decreases.
 *
 * EVERY WEIGHT IS DERIVED, NEVER WRITTEN. `radix` is the one place a "+ 1"
 * appears in the whole chain, and each weight above it is built from the one
 * below: a digit bounded by `maxDigit` takes `maxDigit + 1` distinct values, so
 * the next weight up must be worth exactly that many units of this one. The
 * model derives them this way so that a change to the rung set or to a bound
 * cannot leave a literal stale, and an implementation that flattened them into
 * constants would silently stop tracking the specification.
 */

import { asSafeInteger } from "./ids.ts";
import { phaseRank, rankCeiling } from "./phase.ts";
import { reworkBudget, wrapUpBudget, type Bounds } from "./pricing.ts";
import { runningCount } from "./task.ts";
import { stagesLeft, type Ticket } from "./ticket.ts";
import type { Core } from "./core.ts";
import { ticketIds } from "./core.ts";

/** A digit bounded by `maxDigit` takes this many values, so the next weight up is worth this much. */
export function radix(maxDigit: number): number {
  return maxDigit + 1;
}

/** One unit of stage progress, which strictly dominates the running-task count. */
export function stageWeight(bounds: Bounds): number {
  return radix(bounds.nTasks);
}

/** One unit of phase rank, which strictly dominates the stage digit plus any running count. */
export function rankWeight(bounds: Bounds): number {
  return radix(bounds.maxStages) * stageWeight(bounds);
}

/** A strict upper bound on `micro`, derived from the ladder's ceiling rather than restated. */
export function microBound(bounds: Bounds): number {
  return radix(rankCeiling) * rankWeight(bounds);
}

/** Within-cycle progress, lexicographic in rank, stages left and running count. */
export function micro(bounds: Bounds, ticket: Ticket): number {
  return (
    phaseRank(ticket.phase) * rankWeight(bounds) +
    stagesLeft(ticket) * stageWeight(bounds) +
    runningCount(ticket.tasks)
  );
}

/**
 * The per-ticket measure: the three accounts and `micro`, radix-flattened.
 * Each account's radix is one more than its grant, so every digit stays
 * strictly below its own radix.
 */
export function ticketMeasure(bounds: Bounds, ticket: Ticket): number {
  const accounts =
    (ticket.gasLeft * radix(wrapUpBudget(bounds.wrapUpPricing)) +
      ticket.wrapUpLeft) *
      radix(reworkBudget(bounds.reworkPolicy)) +
    ticket.reworkLeft;
  const measure = accounts * microBound(bounds) + micro(bounds, ticket);
  return asSafeInteger(measure, "ticketMeasure");
}

/** The fleet's measure. Steps touch one ticket, so descent of the sum is descent per ticket. */
export function sysMeasure(bounds: Bounds, core: Core): number {
  let total = 0;
  for (const id of ticketIds(core)) {
    const ticket = core.tickets.get(id);
    if (ticket === undefined) continue;
    total += ticketMeasure(bounds, ticket);
  }
  return asSafeInteger(total, "sysMeasure");
}
