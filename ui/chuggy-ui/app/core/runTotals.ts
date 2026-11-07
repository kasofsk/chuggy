/**
 * What a set of runs spent, and the words a reader sees it in.
 *
 * A stage's figure is summed here because the rows it groups are already in the
 * browser and already kept live; a ticket's is not, because the page this
 * screen holds may be short of the executions the ticket has and a sum over it
 * would be quietly wrong.
 *
 * `runSpendOf` CARRIES NO BASIS IT DID NOT EARN: it reports the one basis every
 * measured run agreed on and reports disagreement as disagreement, which is the
 * one thing a single `RunTotals` cannot say about itself, and it reports how
 * many of the executions it was handed carried figures at all, so a caller
 * never reads a sum over a third of a set as a sum over the set.
 *
 * A RUN'S TIME RUNS FROM WHEN IT WAS TAKEN TO ITS END, and its wait from its
 * registration to when it was taken, each counted to now while it lasts. A
 * set's time and wait are its runs' summed, never one span across them, so the
 * gap between two runs is counted as neither. `instantSchema` promises only a
 * non-empty string, so an instant that does not parse counts for nothing.
 */

import { nativeHttpPageItemsMax } from "../../../../src/contract/http.ts";
import type {
  ExecutionSummary,
  RunTotals,
  TaskIdentity,
} from "../../../../src/contract/responses.ts";
import type { RunCostBasis } from "../../../../src/contract/rosters.ts";

/** Grouped digits, because a token count is read at a glance and never summed
 * by eye. */
export function runCountLabel(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}

/** A count and its noun, the noun plural unless the count is one. */
export function countedLabel(value: number, noun: string): string {
  return `${runCountLabel(value)} ${noun}${value === 1 ? "" : "s"}`;
}

type RunModelUsage = RunTotals["models"][number];

function runModelsMerged(totals: readonly RunTotals[]): RunModelUsage[] {
  const merged = new Map<string, RunModelUsage>();
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

function runTotalsAdded(held: RunTotals, arriving: RunTotals): RunTotals {
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
 * Every run's figures added, with the per-model rows merged by model. The
 * outcome labels are dropped: each names one run and a sum names none.
 */
export function runTotalsSummed(
  totals: readonly RunTotals[],
): RunTotals | undefined {
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

/** The basis every measured run agreed on, or that they did not agree. */
export type RunRollupBasis = RunCostBasis | "Mixed";

/** A sum of runs, which claims a single run's basis only where every run shared it. */
export type RunRollup = Omit<RunTotals, "costBasis"> & {
  readonly costBasis: RunRollupBasis;
};

/** What a set of executions spent, and how much of that set could be measured. */
export interface RunSpend {
  readonly executions: number;
  readonly measured: number;
  readonly totals: RunRollup | undefined;
}

function runRollupBasis(
  totals: readonly RunTotals[],
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
export function runSpendOf(summaries: readonly ExecutionSummary[]): RunSpend {
  const measured = summaries.flatMap((row) =>
    row.runTotals === undefined ? [] : [row.runTotals],
  );
  const summed = runTotalsSummed(measured);
  const basis = runRollupBasis(measured);
  return {
    executions: summaries.length,
    measured: measured.length,
    totals:
      summed === undefined || basis === undefined
        ? undefined
        : { ...summed, costBasis: basis },
  };
}

/** What a run's time and its wait are read off. */
export type RunTimed = Pick<
  ExecutionSummary,
  "registeredAt" | "takenAt" | "terminalAt"
>;

/** A run's time and its wait, or a set's sums of them; `ranMs` is absent
 * where nothing in the set has been taken. */
export interface RunTime {
  readonly ranMs: number | undefined;
  readonly waitedMs: number;
}

function runTimeInstantMs(stated: string | undefined): number | undefined {
  if (stated === undefined) return undefined;
  const at = Date.parse(stated);
  return Number.isFinite(at) ? at : undefined;
}

function runTimeAdded(held: RunTime, run: RunTimed, nowMs: number): RunTime {
  const registeredMs = runTimeInstantMs(run.registeredAt);
  const takenMs = runTimeInstantMs(run.takenAt);
  const endMs = runTimeInstantMs(run.terminalAt) ?? nowMs;
  const waitEndMs = takenMs ?? endMs;
  const waitedMs =
    registeredMs === undefined ? 0 : Math.max(waitEndMs - registeredMs, 0);
  return {
    ranMs:
      takenMs === undefined
        ? held.ranMs
        : (held.ranMs ?? 0) + Math.max(endMs - takenMs, 0),
    waitedMs: held.waitedMs + waitedMs,
  };
}

/** The runs' times and waits summed, each run's counted to now while it lasts. */
export function runTimeOf(runs: readonly RunTimed[], nowMs: number): RunTime {
  return runs.reduce<RunTime>((held, run) => runTimeAdded(held, run, nowMs), {
    ranMs: undefined,
    waitedMs: 0,
  });
}

/** Which work cycle a task belongs to, a work task's own or an evaluation's. */
export function identityCycle(identity: TaskIdentity): number {
  return identity.type === "WorkTask"
    ? identity.value.cycle
    : identity.value.workCycle;
}
