/**
 * What a set of runs spent, and the words a reader sees it in.
 *
 * A stage's figure is summed here because the rows it groups are already in the
 * browser and already kept live; a ticket's is not, because the page this
 * screen holds may be short of the executions the ticket has and a sum over it
 * would be quietly wrong. Every dollar figure carries the basis the wire gave
 * it, so a list price is never read as a bill.
 */

import { nativeHttpPageItemsMax } from "../../../../src/contract/http.ts";
import type {
  ExecutionSummary,
  RunTotals,
} from "../../../../src/contract/responses.ts";
import {
  executionTaskKinds,
  type ExecutionTaskKind,
  type RunCostBasis,
} from "../../../../src/contract/rosters.ts";

/** Millionths of a dollar in a dollar, which is the unit a durable row holds. */
const costUsdMicrosPerUsd = 1_000_000;

/** The smallest amount cents can state, below which a spend would read as none. */
const costUsdCent = 0.01;

const costUsdDecimalsCents = 2;
const costUsdDecimalsFine = 4;

const durationMsPerSecond = 1_000;
const durationSecondsPerMinute = 60;
const durationMinutesPerHour = 60;

/** What a cost figure is, never abbreviated away from the reader. */
export function runCostBasisSentence(basis: RunCostBasis): string {
  switch (basis) {
    case "List":
      return "list price";
  }
}

/** Cents, or finer where cents alone would draw a spend as nothing spent. */
export function runCostLabel(
  costUsdMicros: number,
  basis: RunCostBasis,
): string {
  const usd = costUsdMicros / costUsdMicrosPerUsd;
  const decimals =
    usd === 0 || usd >= costUsdCent
      ? costUsdDecimalsCents
      : costUsdDecimalsFine;
  return `$${usd.toFixed(decimals)} (${runCostBasisSentence(basis)})`;
}

/** Grouped digits, because a token count is read at a glance and never summed
 * by eye. */
export function runCountLabel(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}

/** Whole units, largest first, with the ones that would be zero left out. */
export function runDurationLabel(durationMs: number): string {
  const seconds = Math.max(Math.floor(durationMs / durationMsPerSecond), 0);
  const minutes = Math.floor(seconds / durationSecondsPerMinute);
  const hours = Math.floor(minutes / durationMinutesPerHour);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${String(hours)}h`);
  if (minutes > 0) parts.push(`${String(minutes % durationMinutesPerHour)}m`);
  parts.push(`${String(seconds % durationSecondsPerMinute)}s`);
  return parts.join(" ");
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

/** One stage of one kind, and what the executions grouped under it spent. */
export interface RunStageRow {
  readonly taskKind: ExecutionTaskKind;
  readonly stage: number | undefined;
  readonly executions: number;
  readonly measured: number;
  readonly totals: RunTotals | undefined;
}

function runStageKey(summary: ExecutionSummary): string {
  return `${summary.taskKind}/${summary.stage === undefined ? "" : String(summary.stage)}`;
}

/** Stage order first, and within a stage the order the program runs the kinds in. */
function runStageBefore(left: RunStageRow, right: RunStageRow): number {
  const stages = (left.stage ?? 0) - (right.stage ?? 0);
  return stages === 0
    ? executionTaskKinds.indexOf(left.taskKind) -
        executionTaskKinds.indexOf(right.taskKind)
    : stages;
}

/**
 * The ticket's executions grouped on the stage of the program that ran them,
 * each row stating how many of its executions carry figures at all.
 */
export function runStageRows(
  summaries: readonly ExecutionSummary[],
): readonly RunStageRow[] {
  const grouped = new Map<string, ExecutionSummary[]>();
  for (const summary of summaries) {
    const key = runStageKey(summary);
    const held = grouped.get(key);
    if (held === undefined) grouped.set(key, [summary]);
    else held.push(summary);
  }
  const rows: RunStageRow[] = [];
  for (const group of grouped.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const measured = group.flatMap((summary) =>
      summary.runTotals === undefined ? [] : [summary.runTotals],
    );
    rows.push({
      taskKind: first.taskKind,
      stage: first.stage,
      executions: group.length,
      measured: measured.length,
      totals: runTotalsSummed(measured),
    });
  }
  return rows.sort(runStageBefore);
}

/** How many executions the row groups, and how many of them carry figures. */
export function runStageCoverageSentence(row: RunStageRow): string {
  const executions =
    row.executions === 1
      ? "1 execution"
      : `${String(row.executions)} executions`;
  return `${executions}, ${String(row.measured)} with figures`;
}

/** What the row is called, in the program's own words. */
export function runStageLabel(row: RunStageRow): string {
  const kind = row.taskKind.toLowerCase();
  return row.stage === undefined ? kind : `${kind} stage ${String(row.stage)}`;
}
