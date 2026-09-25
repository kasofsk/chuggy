/**
 * What the ticket page's status bar and the slot under it say: the tone the bar
 * is tinted in, its one dim line, and which one card the slot holds.
 *
 * NEEDS YOU COMES BEFORE NOW. A finalizing ticket can be running and waiting on
 * an approval at once, and the card that can answer the question is the one a
 * reader has to act on.
 */

import type {
  ExecutionSummary,
  NativeActionResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import {
  escalationDetail,
  escalationDetailLine,
  nativeActionKindLabel,
  revokedDependencyLine,
} from "./codeLabels.ts";
import { settledFigure, sinceFigure } from "./figures.ts";
import type { Figure } from "./figures.ts";
import { runSpanOf } from "./runTotals.ts";
import type { Cycle, Ledger as LedgerFacts, RanStage } from "./ticketLedger.ts";
import { cycleLabel, ledgerLastSet, stageLabel } from "./ticketLedger.ts";
import { phaseIsRunning } from "./ticketPageFacts.ts";
import { phaseTone } from "./tones.ts";
import type { Tone } from "./tones.ts";

/** The run the Now card is about, and the two labels it is headed by. */
export interface RunningNow {
  readonly execution: ExecutionSummary;
  readonly stage: string;
  readonly run: string;
}

export type TicketSlot =
  | {
      readonly slot: "NeedsYou";
      readonly detail: string;
      readonly more: string | undefined;
    }
  | { readonly slot: "Now"; readonly running: RunningNow }
  | { readonly slot: "Nothing" };

/** Everything the slot is chosen from; `open` is absent while its read is. */
export interface SituationReads {
  readonly ticket: TicketResponse;
  readonly ledger: LedgerFacts | undefined;
  readonly stageCount: number;
  readonly open: readonly NativeActionResponse[] | undefined;
  readonly executions: readonly ExecutionSummary[];
}

/** A blocked ticket is parked whatever its phase says, because it waits on a
 * person as an escalated one does. */
export function ticketStatusTone(ticket: TicketResponse): Tone {
  return ticket.revokedDependencies.length > 0
    ? "parked"
    : phaseTone(ticket.phase);
}

/**
 * A running ticket from the release the journal dated, or its first run where
 * it dated none; anything else from the instant it last moved, with how long
 * it ran where this page holds its runs.
 */
export function ticketStatusFigure(
  ticket: TicketResponse,
  executions: readonly ExecutionSummary[],
  nowMs: number,
): Figure {
  const span = runSpanOf(executions);
  const from =
    span.from === undefined ? undefined : (ticket.releasedAt ?? span.from);
  if (!phaseIsRunning(ticket.phase))
    return settledFigure(ticket.changedAt, { from, to: span.to }, nowMs);
  const started = ticket.releasedAt ?? span.from;
  return started === undefined
    ? sinceFigure(ticket.changedAt, nowMs)
    : sinceFigure(started, nowMs, "started");
}

/** The cycle the ticket's artifact belongs to, which is the last one on the page. */
function currentCycle(facts: LedgerFacts): Cycle | undefined {
  return facts.cycles.at(-1);
}

/**
 * The stage a resume re-asked now, not the first one a resume ever touched: a
 * cycle can hold more than one stage past its first generation at once, so
 * this takes the highest-numbered one that is still running, and only falls
 * back to the highest-numbered one at all where none is.
 */
function resumedStage(facts: LedgerFacts): number | undefined {
  const cycle = currentCycle(facts);
  const resumed = (cycle?.stages ?? []).filter(
    (row): row is RanStage =>
      row.kind === "Ran" &&
      row.evaluators.some((evaluator) => evaluator.generation > 1),
  );
  const running = resumed.filter((row) => row.verdict === "Running");
  return (running.length > 0 ? running : resumed).at(-1)?.stage;
}

/** A resume shows in the ledger as the stage it re-asked sitting past its
 * first generation. */
export function resumedFrom(facts: LedgerFacts): string | undefined {
  const cycle = currentCycle(facts);
  const stage = resumedStage(facts);
  if (cycle === undefined || stage === undefined) return undefined;
  return `Resumed at stage ${String(stage)} · ${cycleLabel(cycle.ordinal).toLowerCase()}`;
}

function needsYou(reads: SituationReads): TicketSlot | undefined {
  const ticket = reads.ticket;
  const blocked = revokedDependencyLine(ticket.revokedDependencies);
  if (blocked !== undefined)
    return { slot: "NeedsYou", detail: blocked, more: undefined };
  const escalation = ticket.escalation;
  if (escalation !== undefined)
    return {
      slot: "NeedsYou",
      detail: escalationDetail(escalation),
      more: escalationDetailLine(escalation.kind, {
        lastSet:
          reads.ledger === undefined ? undefined : ledgerLastSet(reads.ledger),
        stageCount: reads.stageCount,
      }),
    };
  const question = reads.open?.[0];
  if (question === undefined) return undefined;
  return {
    slot: "NeedsYou",
    detail: nativeActionKindLabel(question.kind),
    more: undefined,
  };
}

function cycleExecutions(cycle: Cycle): readonly ExecutionSummary[] {
  return [
    ...(cycle.work?.executions ?? []),
    ...cycle.stages.flatMap((row) =>
      row.kind === "Ran"
        ? row.evaluators.flatMap((evaluator) => evaluator.set.executions)
        : [],
    ),
  ];
}

function executionLive(row: ExecutionSummary): boolean {
  return row.status !== "Terminal" && row.status !== "Cancelled";
}

/** The current cycle's newest live run, numbered by where it stands among the
 * runs this page holds, which is the count the status bar draws. */
function runningNow(reads: SituationReads): RunningNow | undefined {
  if (!phaseIsRunning(reads.ticket.phase) || reads.ledger === undefined)
    return undefined;
  const cycle = currentCycle(reads.ledger);
  if (cycle === undefined) return undefined;
  const live = cycleExecutions(cycle)
    .filter(executionLive)
    .sort((left, right) => left.task - right.task)
    .at(-1);
  if (live === undefined) return undefined;
  const ordinal = reads.executions.filter(
    (row) => row.task <= live.task,
  ).length;
  const identity = live.identity;
  return {
    execution: live,
    stage:
      identity.type === "WorkTask"
        ? "Work"
        : stageLabel(identity.value.stage, reads.stageCount),
    run: `run ${String(ordinal)}`,
  };
}

export function ticketSlot(reads: SituationReads): TicketSlot {
  const asked = needsYou(reads);
  if (asked !== undefined) return asked;
  const running = runningNow(reads);
  return running === undefined ? { slot: "Nothing" } : { slot: "Now", running };
}
