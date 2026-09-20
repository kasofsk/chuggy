/**
 * What a ticket has spent, grouped the way its plan runs: per stage, per model,
 * and rolled up over both.
 *
 * ONE SUM, THROUGH `runTotals.ts`. Every figure here is `runSpendOf`'s, so the
 * stage rows and the rollup are the same arithmetic over different sets and a
 * quantity is never added two ways on one page. The per-model rows come from
 * that rollup's own merge rather than a second pass, because a run's own
 * `costUsdMicros` and its model rows are two accounts of the same money and
 * adding both would double every ticket's cost.
 *
 * THE STAGE ROWS FOOT TO THE ROLLUP. Every row the ledger holds lands in
 * exactly one stage — work, one evaluation stage, or the rows whose key names
 * no cycle of this ticket — so the table adds up to the total drawn above it. A
 * grouping that quietly dropped the unplaceable rows would report a ticket as
 * having spent less than it did.
 *
 * ORDER IS THE ORDINAL AND NEVER THE DRAWN LABEL, which would sort `Stage 10`
 * between `Stage 1` and `Stage 2`. Work precedes every evaluation stage because
 * that is the order the plan runs them in, and the unplaceable rows come last
 * because they belong to no part of it.
 */

import type {
  AdoptedExecution,
  AdoptedRunModelUsage,
} from "./adoptedExecutions.ts";
import type { TicketLedger, TicketRunStage } from "./ticketLedger.ts";
import { ticketLedgerExecutions } from "./ticketLedger.ts";
import { runSpendOf } from "./runTotals.ts";
import type { RunSpend } from "./runTotals.ts";

/** Work runs before stage 0, and the unplaceable rows after every stage. */
const stageOrdinalWork = -1;
const stageOrdinalUnplaced = Number.MAX_SAFE_INTEGER;

export interface TicketStageUsage {
  readonly stage: TicketRunStage;
  readonly ordinal: number;
  readonly label: string;
  readonly spend: RunSpend;
}

export interface TicketUsage {
  readonly total: RunSpend;
  readonly byStage: readonly TicketStageUsage[];
  readonly byModel: readonly AdoptedRunModelUsage[];
}

function stageOrdinalOf(stage: TicketRunStage): number {
  switch (stage.kind) {
    case "Work":
      return stageOrdinalWork;
    case "Evaluation":
      return stage.stage;
    case "Unplaced":
      return stageOrdinalUnplaced;
  }
}

/**
 * The stage as a reader names it. Stages are 0-based in the key and 1-based in
 * the reading, because a plan's first stage is the first one to a person.
 */
export function ticketStageLabel(stage: TicketRunStage): string {
  switch (stage.kind) {
    case "Work":
      return "Work";
    case "Evaluation":
      return `Stage ${String(stage.stage + 1)}`;
    case "Unplaced":
      return "Unplaced";
  }
}

function stageHeld(
  stages: Map<number, { stage: TicketRunStage; rows: AdoptedExecution[] }>,
  stage: TicketRunStage,
): AdoptedExecution[] {
  const ordinal = stageOrdinalOf(stage);
  const held = stages.get(ordinal);
  if (held !== undefined) return held.rows;
  const rows: AdoptedExecution[] = [];
  stages.set(ordinal, { stage, rows });
  return rows;
}

/**
 * Which stage each row sits in, taken from where the ledger already placed it
 * rather than by reading its key a second time. One parse decides both the
 * ledger's arrangement and this grouping, so the two cannot come to disagree
 * about a row and the stage rows always foot to the rollup.
 */
function stagedRows(
  ledger: TicketLedger,
  stages: Map<number, { stage: TicketRunStage; rows: AdoptedExecution[] }>,
): void {
  for (const cycle of ledger.cycles) {
    if (cycle.work !== undefined)
      stageHeld(stages, { kind: "Work" }).push(cycle.work);
    for (const evaluation of cycle.evaluations)
      stageHeld(stages, {
        kind: "Evaluation",
        stage: evaluation.stage,
      }).push(evaluation.execution);
  }
  for (const held of ledger.unplaced)
    stageHeld(stages, { kind: "Unplaced" }).push(held.execution);
}

/** What the ticket spent, over the rows the ledger was built from. */
export function ticketUsageOf(ledger: TicketLedger): TicketUsage {
  const stages = new Map<
    number,
    { stage: TicketRunStage; rows: AdoptedExecution[] }
  >();
  stagedRows(ledger, stages);
  const total = runSpendOf(ticketLedgerExecutions(ledger));
  return {
    total,
    byStage: [...stages.entries()]
      .sort(([left], [right]) => left - right)
      .map(([ordinal, held]) => ({
        stage: held.stage,
        ordinal,
        label: ticketStageLabel(held.stage),
        spend: runSpendOf(held.rows),
      })),
    byModel: total.totals?.models ?? [],
  };
}
