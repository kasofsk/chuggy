/**
 * What a set of runs spent, and the words a reader sees it in.
 *
 * A stage's figure is summed here because the rows it groups are already in the
 * browser and already kept live; a ticket's is not, because the page this
 * screen holds may be short of the executions the ticket has and a sum over it
 * would be quietly wrong. Every dollar figure carries the basis the wire gave
 * it, so a list price is never read as a bill.
 *
 * `runSpendOf` CARRIES NO BASIS IT DID NOT EARN: it reports the one basis every
 * measured run agreed on and reports disagreement as disagreement, which is the
 * one thing a single `RunTotals` cannot say about itself, and it reports how
 * many of the executions it was handed carried figures at all, so a caller
 * never reads a sum over a third of a set as a sum over the set.
 *
 * TIME IS READ BY A CLOCK, NOT BY A STRING. `instantSchema` promises only a
 * non-empty string, so `runSpanOf` orders by what parses as an instant and
 * leaves out what does not, and it ends a span only once nothing in it is still
 * open.
 */

import { nativeHttpPageItemsMax } from "../../../../src/contract/http.ts";
import type {
  ExecutionSummary,
  RunTotals,
  TaskIdentity,
} from "../../../../src/contract/responses.ts";
import type { RunCostBasis } from "../../../../src/contract/rosters.ts";

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

/** A count and its noun, the noun plural unless the count is one. */
export function countedLabel(value: number, noun: string): string {
  return `${runCountLabel(value)} ${noun}${value === 1 ? "" : "s"}`;
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

/** When a set of executions started, and when it ended if nothing in it is open. */
export interface RunSpan {
  readonly from: string | undefined;
  readonly to: string | undefined;
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
 * From the earliest registration to the latest end. A set still holding an
 * execution the wire has reported no end for has not ended.
 */
export function runSpanOf(summaries: readonly ExecutionSummary[]): RunSpan {
  const started = runInstantsOrdered(summaries.map((row) => row.registeredAt));
  const ended = runInstantsOrdered(
    summaries.flatMap((row) =>
      row.terminalAt === undefined ? [] : [row.terminalAt],
    ),
  );
  const open = summaries.some((row) => row.terminalAt === undefined);
  return { from: started[0], to: open ? undefined : ended.at(-1) };
}

/** Which work cycle a task belongs to, a work task's own or an evaluation's. */
export function identityCycle(identity: TaskIdentity): number {
  return identity.type === "WorkTask"
    ? identity.value.cycle
    : identity.value.workCycle;
}

/** The word a generation past the first draws as, never "run" — one spelling
 * for every generation past the first, the model's own word for it. */
export function generationLabel(generation: number): string | undefined {
  return generation <= 1 ? undefined : `generation ${String(generation)}`;
}
