/**
 * One ticket's executions in the machine's own structure: work cycles, each
 * holding the run that produced an artifact and the runs that judged it.
 *
 * THE KEY PLACES THE ROW, AND NOTHING ELSE DOES. `taskKey` states the cycle a
 * run belongs to and the stage that judged it, so the arrangement here is read
 * rather than recovered. Nothing sorts rows to find out what they are and
 * nothing matches identity stems: a key that does not name this ticket is
 * `unplaced` and is drawn as itself, because a run placed in a cycle nobody can
 * check it belongs to is worse than a run drawn beside the ledger.
 *
 * ORDER IS THE KEY'S OWN COORDINATES. Cycles ascend by cycle number and the
 * evaluations inside one ascend by stage, then generation, then evaluator —
 * every one of them a field the machine wrote into the key. Ordering by an
 * instant would put a run that was queued late into the wrong place the first
 * time two clocks disagreed.
 *
 * A CYCLE HOLDS AT MOST ONE WORK RUN, which is the store's keying rather than
 * this module's choice: `taskKey` is what an execution is read by, so two rows
 * cannot name `work:<ticket>:<cycle>` at once. A repeat would be the same row.
 *
 * A CYCLE WITH NO WORK RUN IS DRAWN, NOT DROPPED. The evaluations of a cycle
 * can be read while the work run that produced their artifact has aged out of
 * the page the wire answers with, and a cycle that vanished because its work
 * row did would be a gap no reader could see.
 */

import type { AdoptedExecution } from "./adoptedExecutions.ts";
import { ticketTaskKeyParse } from "./ticketTaskKey.ts";

/** Which part of the ticket's plan a run belongs to, as its key states it. */
export type TicketRunStage =
  | { readonly kind: "Work" }
  | { readonly kind: "Evaluation"; readonly stage: number }
  | { readonly kind: "Unplaced" };

/** One judging run, with the coordinates that order it inside its cycle. */
export interface TicketLedgerEvaluation {
  readonly execution: AdoptedExecution;
  readonly stage: number;
  readonly generation: number;
  readonly evaluator: number;
}

/** One work cycle: what ran, and what judged what it produced. */
export interface TicketLedgerCycle {
  readonly cycle: number;
  readonly work: AdoptedExecution | undefined;
  readonly evaluations: readonly TicketLedgerEvaluation[];
}

/**
 * Why a row sits outside the cycles. `Unreadable` is a key this console cannot
 * parse; `OtherTicket` is one that parses and names a different ticket, which
 * is the read disagreeing with its own filter rather than an unreadable key.
 */
export type TicketLedgerUnplacedReason = "Unreadable" | "OtherTicket";

export interface TicketLedgerUnplaced {
  readonly execution: AdoptedExecution;
  readonly why: TicketLedgerUnplacedReason;
}

export interface TicketLedger {
  readonly cycles: readonly TicketLedgerCycle[];
  readonly unplaced: readonly TicketLedgerUnplaced[];
}

interface LedgerCycleHeld {
  work: AdoptedExecution | undefined;
  readonly evaluations: TicketLedgerEvaluation[];
}

function ledgerCycleHeld(
  cycles: Map<number, LedgerCycleHeld>,
  cycle: number,
): LedgerCycleHeld {
  const held = cycles.get(cycle);
  if (held !== undefined) return held;
  const fresh: LedgerCycleHeld = { work: undefined, evaluations: [] };
  cycles.set(cycle, fresh);
  return fresh;
}

/** Stage, then generation, then evaluator — the key's own coordinates, in order. */
function ledgerEvaluationOrder(
  left: TicketLedgerEvaluation,
  right: TicketLedgerEvaluation,
): number {
  if (left.stage !== right.stage) return left.stage - right.stage;
  if (left.generation !== right.generation)
    return left.generation - right.generation;
  return left.evaluator - right.evaluator;
}

/** The ticket's executions as the machine arranged them, and the rows that
 * name no cycle of it. */
export function ticketLedgerOf(
  ticket: number,
  executions: readonly AdoptedExecution[],
): TicketLedger {
  const cycles = new Map<number, LedgerCycleHeld>();
  const unplaced: TicketLedgerUnplaced[] = [];
  for (const execution of executions) {
    const key = ticketTaskKeyParse(execution.taskKey);
    if (key.kind === "Unreadable") {
      unplaced.push({ execution, why: "Unreadable" });
      continue;
    }
    if (key.ticket !== ticket) {
      unplaced.push({ execution, why: "OtherTicket" });
      continue;
    }
    if (key.kind === "Work") {
      ledgerCycleHeld(cycles, key.cycle).work = execution;
      continue;
    }
    ledgerCycleHeld(cycles, key.workCycle).evaluations.push({
      execution,
      stage: key.stage,
      generation: key.generation,
      evaluator: key.evaluator,
    });
  }
  return {
    cycles: [...cycles.entries()]
      .sort(([left], [right]) => left - right)
      .map(([cycle, held]) => ({
        cycle,
        work: held.work,
        evaluations: [...held.evaluations].sort(ledgerEvaluationOrder),
      })),
    unplaced,
  };
}

/** Every row the ledger holds, in the order it draws them. */
export function ticketLedgerExecutions(
  ledger: TicketLedger,
): readonly AdoptedExecution[] {
  return [
    ...ledger.cycles.flatMap((cycle) => [
      ...(cycle.work === undefined ? [] : [cycle.work]),
      ...cycle.evaluations.map((evaluation) => evaluation.execution),
    ]),
    ...ledger.unplaced.map((held) => held.execution),
  ];
}
