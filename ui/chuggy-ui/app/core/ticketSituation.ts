/**
 * Which one card the ticket's Overview holds, and what it says.
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
  escalationEvidenceLine,
  escalationStep,
  nativeActionKindLabel,
  revokedDependencyLine,
  runnerLossLine,
  runStepLine,
  usageResumeLine,
} from "./codeLabels.ts";
import type { EscalationStep } from "./codeLabels.ts";
import { ticketLandingEscalatedRemoval } from "./ticketLandings.ts";
import type { TicketLanding } from "./ticketLandings.ts";
import type {
  Cycle,
  Ledger as LedgerFacts,
  RanStage,
  StageNames,
} from "./ticketLedger.ts";
import {
  cycleLabel,
  cycleLastSet,
  ledgerLastSet,
  stageEvaluatorsCurrent,
  stageLabel,
} from "./ticketLedger.ts";
import { phaseIsRunning } from "./ticketPageFacts.ts";
import { ticketRunsCycleOutcome } from "./ticketRuns.ts";

/** The run the Now card is about: the step it is, as the plan names it, and
 * the cycle it runs in. */
export interface RunningNow {
  readonly execution: ExecutionSummary;
  readonly step: string;
  readonly cycle: number;
}

/** The run a parked ticket stopped at, by its task's number, which is its
 * page, and the step it is where the plan names one. */
export interface NeedsYouRun {
  readonly task: number;
  readonly execution: string;
  readonly step: string | undefined;
}

/** The attempt whose worker's text says why a job was lost or its run stopped, read on its own route. */
export interface ReasonAttempt {
  readonly execution: string;
  readonly attempt: string;
}

export type TicketSlot =
  | {
      readonly slot: "NeedsYou";
      readonly detail: string;
      /** Where it stopped: the step and the cycle. */
      readonly where: string | undefined;
      /** The run it stopped at. */
      readonly run: NeedsYouRun | undefined;
      /** The page the way past it is on, drawn beside the detail. */
      readonly step: EscalationStep | undefined;
      readonly more: string | undefined;
      readonly reason: ReasonAttempt | undefined;
    }
  | { readonly slot: "Now"; readonly running: RunningNow }
  | { readonly slot: "Nothing" };

/** Everything the slot is chosen from; `open` is absent while its read is,
 * `landings` are none while theirs is, `setupOverridable` is whether the card
 * offers this reader the ticket's setup lines to change, and `nowMs` is the
 * clock an instant the card names is read against. */
export interface SituationReads {
  readonly ticket: TicketResponse;
  readonly landings: readonly TicketLanding[];
  readonly ledger: LedgerFacts | undefined;
  readonly names: StageNames;
  readonly open: readonly NativeActionResponse[] | undefined;
  readonly executions: readonly ExecutionSummary[];
  readonly setupOverridable: boolean;
  readonly nowMs: number;
}

/** The cycle the ticket's artifact belongs to, which is the last one on the page. */
function currentCycle(facts: LedgerFacts): Cycle | undefined {
  return facts.cycles.at(-1);
}

/** The line under a parked ticket's wall: the scheduler's own resume where it
 * will make one, the runner's losses where a job was lost, and otherwise the
 * wall's own line. */
function needsYouMore(
  reads: SituationReads,
  escalation: NonNullable<TicketResponse["escalation"]>,
): string | undefined {
  if (escalation.usageResume !== undefined)
    return usageResumeLine(escalation.usageResume, reads.nowMs);
  if (escalation.lost !== undefined) return runnerLossLine(escalation.lost);
  const failed = escalation.failed;
  return (
    (failed === undefined
      ? undefined
      : runStepLine(failed, reads.setupOverridable)) ??
    ticketLandingEscalatedRemoval(reads.landings, escalation.evidence) ??
    escalationEvidenceLine(escalation.evidence) ??
    escalationDetailLine(escalation.kind, {
      lastSet:
        reads.ledger === undefined ? undefined : ledgerLastSet(reads.ledger),
      names: reads.names,
    })
  );
}

/** A card that names only what is asked, with nowhere it stopped. */
function needsYouAsked(detail: string): TicketSlot {
  return {
    slot: "NeedsYou",
    detail,
    where: undefined,
    run: undefined,
    step: undefined,
    more: undefined,
    reason: undefined,
  };
}

/** A run as the step it is: work, or its stage where the plan names it. */
function needsYouStep(
  execution: ExecutionSummary,
  names: StageNames,
): string | undefined {
  const identity = execution.identity;
  return identity.type === "WorkTask"
    ? "work"
    : names?.[identity.value.stage - 1];
}

/** The run a cycle stopped at: the evaluator of its last stage that did not
 * pass, or its work. */
function needsYouStopped(cycle: Cycle): ExecutionSummary | undefined {
  const stage = cycle.stages
    .filter((row): row is RanStage => row.kind === "Ran")
    .at(-1);
  if (stage === undefined) return cycle.work?.executions.at(-1);
  return stageEvaluatorsCurrent(stage).find(
    (row) => row.set.verdict === "Failed" || row.set.verdict === "Blocked",
  )?.set.executions[0];
}

/**
 * Where a parked ticket stopped, from the current cycle: the step that failed
 * or blocked and the cycle it did so in, and the run it stopped at, which is
 * the one whose worker said why where the escalation names one.
 */
function needsYouWhere(
  reads: SituationReads,
  said: { readonly execution: string } | undefined,
): {
  readonly where: string | undefined;
  readonly run: NeedsYouRun | undefined;
} {
  const cycle =
    reads.ledger === undefined ? undefined : currentCycle(reads.ledger);
  const last = cycle === undefined ? undefined : cycleLastSet(cycle);
  const stopped = last?.verdict === "Failed" || last?.verdict === "Blocked";
  const execution =
    said === undefined
      ? cycle === undefined || !stopped
        ? undefined
        : needsYouStopped(cycle)
      : reads.executions.find((row) => row.execution === said.execution);
  return {
    where:
      cycle === undefined || !stopped
        ? undefined
        : `${ticketRunsCycleOutcome(cycle, reads.names, undefined)} in ${cycleLabel(cycle.ordinal).toLowerCase()}`,
    run:
      execution === undefined
        ? undefined
        : {
            task: execution.task,
            execution: execution.execution,
            step: needsYouStep(execution, reads.names),
          },
  };
}

function needsYou(reads: SituationReads): TicketSlot | undefined {
  const ticket = reads.ticket;
  const blocked = revokedDependencyLine(ticket.revokedDependencies);
  if (blocked !== undefined) return needsYouAsked(blocked);
  const escalation = ticket.escalation;
  if (escalation !== undefined) {
    const said = escalation.lost ?? escalation.failed;
    const { where, run } = needsYouWhere(reads, said);
    return {
      slot: "NeedsYou",
      detail: escalationDetail(escalation),
      where,
      run,
      step: escalationStep(escalation),
      more:
        where !== undefined && escalation.kind === "EvaluationFailureEscalated"
          ? undefined
          : needsYouMore(reads, escalation),
      reason:
        said?.error === undefined
          ? undefined
          : { execution: said.execution, attempt: said.attempt },
    };
  }
  const question = reads.open?.[0];
  if (question === undefined) return undefined;
  return needsYouAsked(nativeActionKindLabel(question.kind));
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

/** The current cycle's newest live run, as the step it is. */
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
  const identity = live.identity;
  return {
    execution: live,
    step:
      identity.type === "WorkTask"
        ? "Work"
        : stageLabel(identity.value.stage, reads.names),
    cycle: cycle.ordinal,
  };
}

export function ticketSlot(reads: SituationReads): TicketSlot {
  const asked = needsYou(reads);
  if (asked !== undefined) return asked;
  const running = runningNow(reads);
  return running === undefined ? { slot: "Nothing" } : { slot: "Now", running };
}
