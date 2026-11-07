/**
 * What the Usage tab sums by step: each step's runs, their time, their wait
 * and their spend, and the same over every run read.
 *
 * A RUN'S TIME AND ITS WAIT ARE THE SIDEBAR'S, `ticketOverviewRunTime` over a
 * step's runs, so a step's figures are its runs' as the Runs tab draws them
 * and the Total's are the sidebar's. The sums are over the page of executions
 * read; the ticket's own cost and tokens are its read's roll-up.
 *
 * A STEP IS NAMED AS THE PLAN NAMES IT, work first and then the stages in the
 * program's order, which is the stage's number and never its drawn name.
 */

import type { ExecutionSummary } from "../../../../src/contract/responses.ts";
import { runSpendOf } from "./runTotals.ts";
import type { RunSpend } from "./runTotals.ts";
import { ticketOverviewRunTime } from "./ticketOverview.ts";
import type { TicketOverviewRunTime } from "./ticketOverview.ts";
import { stageLabel } from "./ticketLedger.ts";
import type { StageNames } from "./ticketLedger.ts";

/** One row of the by-step table, or its Total. */
export interface TicketUsageStep {
  readonly label: string;
  readonly runs: number;
  readonly time: TicketOverviewRunTime;
  readonly spend: RunSpend;
}

export interface TicketUsageSteps {
  readonly steps: readonly TicketUsageStep[];
  readonly total: TicketUsageStep;
}

/** Work's place before every stage, whose numbers start at one. */
const ticketUsageWorkOrdinal = 0;

function ticketUsageOrdinal(summary: ExecutionSummary): number {
  return summary.identity.type === "WorkTask"
    ? ticketUsageWorkOrdinal
    : summary.identity.value.stage;
}

function ticketUsageStep(
  label: string,
  executions: readonly ExecutionSummary[],
  nowMs: number,
): TicketUsageStep | undefined {
  const time = ticketOverviewRunTime(executions, nowMs);
  if (time === undefined) return undefined;
  return {
    label,
    runs: executions.length,
    time,
    spend: runSpendOf(executions),
  };
}

/** The executions read, by step and in total; none before the first run. */
export function ticketUsageStepsOf(
  executions: readonly ExecutionSummary[],
  names: StageNames,
  nowMs: number,
): TicketUsageSteps | undefined {
  const total = ticketUsageStep("Total", executions, nowMs);
  if (total === undefined) return undefined;
  const grouped = new Map<number, ExecutionSummary[]>();
  for (const summary of executions) {
    const ordinal = ticketUsageOrdinal(summary);
    const held = grouped.get(ordinal);
    if (held === undefined) grouped.set(ordinal, [summary]);
    else held.push(summary);
  }
  const steps = [...grouped]
    .sort(([left], [right]) => left - right)
    .flatMap(([ordinal, runs]) => {
      const step = ticketUsageStep(
        ordinal === ticketUsageWorkOrdinal
          ? "Work"
          : stageLabel(ordinal, names),
        runs,
        nowMs,
      );
      return step === undefined ? [] : [step];
    });
  return { steps, total };
}
