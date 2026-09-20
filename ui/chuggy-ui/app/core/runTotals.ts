/**
 * What a set of runs spent and when it ran, summed once.
 *
 * THE SUM IS OVER ROWS THIS BROWSER ALREADY HOLDS. The executions read answers
 * one ticket in one bounded page with no cursor, so a rollup over it is a
 * rollup over the ticket's runs as this console read them, and it says how many
 * of the rows it was handed carried figures at all — a sum over a third of a
 * set is never handed back as a sum over the set.
 *
 * A ROLLUP CARRIES NO BASIS IT DID NOT EARN. It reports the one basis every
 * measured run agreed on and reports disagreement as `Mixed`, which is the one
 * thing a single run's totals cannot say about itself.
 *
 * A COST IS ADDED ONCE. A run's own `costUsdMicros` and its per-model rows are
 * two accounts of the same money: the rollup adds the run totals and merges the
 * model rows separately, and neither is folded into the other.
 *
 * TIME IS READ BY A CLOCK, NOT BY A STRING. The wire promises only a non-empty
 * string, so ordering is over what parses as an instant and what does not is
 * left out. A set holding a run the machine can still move has not ended,
 * whatever instants its rows carry.
 */

import { nativeHttpPageItemsMax } from "../../../../src/contract/http.ts";
import { adoptedExecutionSettled } from "./adoptedExecutions.ts";
import type {
  AdoptedExecution,
  AdoptedRunModelUsage,
  AdoptedRunTotals,
} from "./adoptedExecutions.ts";

export type RunRollupBasis = "List" | "Mixed";

export interface RunSpan {
  readonly from: string | undefined;
  readonly to: string | undefined;
}

/** A sum of runs, which claims a single run's basis only where every run shared it. */
export type RunRollup = Omit<AdoptedRunTotals, "costBasis"> & {
  readonly costBasis: RunRollupBasis;
};

/** What a set of executions spent, and how much of that set could be measured. */
export interface RunSpend {
  readonly executions: number;
  readonly measured: number;
  readonly totals: RunRollup | undefined;
}

export function runCountLabel(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}

/**
 * Every model row of every run, added per model. The map is bounded by the page
 * the wire itself is bounded by, so a set naming more models than a page could
 * hold draws the ones it reached rather than growing without a bound.
 */
function runModelsMerged(
  totals: readonly AdoptedRunTotals[],
): AdoptedRunModelUsage[] {
  const merged = new Map<string, AdoptedRunModelUsage>();
  for (const total of totals)
    for (const usage of total.models) {
      const held = merged.get(usage.model);
      if (held === undefined) {
        if (merged.size >= nativeHttpPageItemsMax) continue;
        merged.set(usage.model, usage);
        continue;
      }
      merged.set(usage.model, {
        model: usage.model,
        tokensInput: held.tokensInput + usage.tokensInput,
        tokensOutput: held.tokensOutput + usage.tokensOutput,
        tokensCacheCreation:
          held.tokensCacheCreation + usage.tokensCacheCreation,
        tokensCacheRead: held.tokensCacheRead + usage.tokensCacheRead,
        costUsdMicros: held.costUsdMicros + usage.costUsdMicros,
      });
    }
  return [...merged.values()];
}

function runTotalsAdded(
  held: AdoptedRunTotals,
  arriving: AdoptedRunTotals,
): AdoptedRunTotals {
  return {
    turns: held.turns + arriving.turns,
    durationMs: held.durationMs + arriving.durationMs,
    durationApiMs: held.durationApiMs + arriving.durationApiMs,
    tokensInput: held.tokensInput + arriving.tokensInput,
    tokensOutput: held.tokensOutput + arriving.tokensOutput,
    tokensCacheCreation:
      held.tokensCacheCreation + arriving.tokensCacheCreation,
    tokensCacheRead: held.tokensCacheRead + arriving.tokensCacheRead,
    costUsdMicros: held.costUsdMicros + arriving.costUsdMicros,
    costBasis: held.costBasis,
    permissionDenials: held.permissionDenials + arriving.permissionDenials,
    models: [],
  };
}

/**
 * Every run's figures added, with the per-model rows merged by model. The words
 * one run ended on are dropped: each names a single run and a sum names none.
 */
export function runTotalsSummed(
  totals: readonly AdoptedRunTotals[],
): AdoptedRunTotals | undefined {
  const first = totals[0];
  if (first === undefined) return undefined;
  const summed = totals.reduce(runTotalsAdded, {
    turns: 0,
    durationMs: 0,
    durationApiMs: 0,
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheCreation: 0,
    tokensCacheRead: 0,
    costUsdMicros: 0,
    costBasis: first.costBasis,
    permissionDenials: 0,
    models: [],
  });
  return { ...summed, models: runModelsMerged(totals) };
}

function runRollupBasis(
  totals: readonly AdoptedRunTotals[],
): RunRollupBasis | undefined {
  const first = totals[0];
  if (first === undefined) return undefined;
  return totals.every((each) => each.costBasis === first.costBasis)
    ? first.costBasis
    : "Mixed";
}

/**
 * The executions' own figures added, over however many of them carry any. A set
 * nothing measured has no totals rather than totals of zero.
 */
export function runSpendOf(executions: readonly AdoptedExecution[]): RunSpend {
  const measured = executions.flatMap((row) =>
    row.totals === undefined ? [] : [row.totals],
  );
  const summed = runTotalsSummed(measured);
  const basis = runRollupBasis(measured);
  return {
    executions: executions.length,
    measured: measured.length,
    totals:
      summed === undefined || basis === undefined
        ? undefined
        : { ...summed, costBasis: basis },
  };
}

/** The instants a clock can read, earliest first; the rest are not ordered at all. */
function runInstantsOrdered(instants: readonly string[]): readonly string[] {
  return instants
    .flatMap((stated) => {
      const at = Date.parse(stated);
      return Number.isFinite(at) ? [{ stated, at }] : [];
    })
    .sort((left, right) => left.at - right.at)
    .map((held) => held.stated);
}

/**
 * From the earliest queueing to the latest report. A set still holding a run
 * the machine can move has not ended, and neither has one whose settled rows
 * carry no report to end it at.
 */
export function runSpanOf(executions: readonly AdoptedExecution[]): RunSpan {
  const queued = runInstantsOrdered(executions.map((row) => row.queuedAt));
  const reported = runInstantsOrdered(
    executions.flatMap((row) =>
      row.lastReportedAt === undefined ? [] : [row.lastReportedAt],
    ),
  );
  const open = executions.some(
    (row) => !adoptedExecutionSettled(row) || row.lastReportedAt === undefined,
  );
  return { from: queued[0], to: open ? undefined : reported.at(-1) };
}
