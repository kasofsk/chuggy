/**
 * The ledger's fold: `ledgerStep` and `evolveLedgers` in `model/domain.qnt`.
 *
 * ONE PURE FOLD OF (TICKET BEFORE, EVENT, LEDGER BEFORE). It reads the ticket
 * after the event through `evolve` itself, applied to a graph holding that
 * ticket alone, so it restates none of `evolve`'s guards: an event `evolve`
 * leaves a ticket alone under moves its ledger nowhere either. Whatever folds
 * `evolve` over a history folds this beside it over the same rows.
 */

import type {
  EvaluationInstance,
  Ticket,
  TicketEvent,
  TicketGraph,
  TicketLedger,
  TicketState,
} from "./generated/modelTypes.ts";
import { eventTicket, evolve } from "./evolve.ts";
import { asTicketId } from "./ids.ts";
import { applyEvaluationReport, emptyLedger, heldInstances } from "./ticket.ts";
import { ticketAt } from "./ticketGraph.ts";

/** Every ticket's ledger, keyed as the graph is. */
export type Ledgers = ReadonlyMap<number, TicketLedger>;

/** No ticket, no ledger. */
export const genesisLedgers: Ledgers = new Map();

/** One ticket under one event, as `evolve` moves it. */
export function ticketAfter(before: Ticket, event: TicketEvent): Ticket {
  const id = asTicketId(before.definition.id);
  return ticketAt(evolve({ tickets: new Map([[id, before]]) }, event), id);
}

/** The run a state is asking, as its stage index and generation; none outside a running evaluation. */
function runningRun(
  state: TicketState,
): { readonly stage: number; readonly generation: number } | undefined {
  if (typeof state === "string" || state.type !== "Evaluation")
    return undefined;
  const evaluation = state.value.state;
  if (evaluation.type !== "Running") return undefined;
  return {
    stage: evaluation.value.stage.stageIndex,
    generation: evaluation.value.stage.generation,
  };
}

/**
 * The slots a step claims: one for a work cycle it started, and the released
 * roster of a run it started asking — an accepted result's first stage, a
 * passed stage's successor, a blocked stage's next generation.
 */
export function slotsClaimed(before: Ticket, after: Ticket): number {
  const work = after.workCyclesStarted > before.workCyclesStarted ? 1 : 0;
  const asked = runningRun(after.state);
  const was = runningRun(before.state);
  if (
    asked === undefined ||
    (was !== undefined &&
      was.stage === asked.stage &&
      was.generation === asked.generation)
  )
    return work;
  const stage = after.definition.evaluationPlan.stages[asked.stage];
  if (stage === undefined)
    throw new Error("slotsClaimed: the running stage indexes outside the plan");
  return work + stage.evaluators.length;
}

/**
 * The instance a step closes: the one the ticket held before and holds no
 * longer, as the event left it — a pass or a failure applies its report
 * first, and a revoke closes it as it stood.
 */
export function closedBy(
  before: Ticket,
  after: Ticket,
  event: TicketEvent,
): readonly EvaluationInstance[] {
  if (heldInstances(after.state).length > 0) return [];
  return heldInstances(before.state).map((held) => {
    switch (event.type) {
      case "TicketEvaluationPassed":
      case "TicketEvaluationReworkStarted":
      case "TicketEvaluationFailureEscalated":
        return applyEvaluationReport(held, event.value.report);
      default:
        return held;
    }
  });
}

/** The ledger after an event, from the ticket before it, the event and the ledger before it. */
export function ledgerStep(
  before: Ticket,
  event: TicketEvent,
  ledger: TicketLedger,
): TicketLedger {
  const after = ticketAfter(before, event);
  return {
    closedEvaluations: [
      ...ledger.closedEvaluations,
      ...closedBy(before, after, event),
    ],
    spawned: ledger.spawned + slotsClaimed(before, after),
    completions:
      ledger.completions +
      (after.state === "Done" && before.state !== "Done" ? 1 : 0),
  };
}

/** Every ticket's ledger after an event: a release opens an empty one, and any other event folds the ledger of the ticket it names. */
export function evolveLedgers(
  graph: TicketGraph,
  ledgers: Ledgers,
  event: TicketEvent,
): Ledgers {
  const id = eventTicket(event);
  if (event.type === "TicketCreated") {
    if (graph.tickets.has(id)) return ledgers;
    return new Map([...ledgers, [id, emptyLedger]]);
  }
  const ticket = graph.tickets.get(id);
  if (ticket === undefined) return ledgers;
  const ledger = ledgers.get(id);
  if (ledger === undefined)
    throw new Error(
      `evolveLedgers: ticket ${String(id)} is released and holds no ledger`,
    );
  return new Map([...ledgers, [id, ledgerStep(ticket, event, ledger)]]);
}

/** A ticket's ledger, failing loudly where the model would fail its own lookup. */
export function ledgerAt(ledgers: Ledgers, id: number): TicketLedger {
  const found = ledgers.get(id);
  if (found === undefined)
    throw new Error(`ledgers: no ledger for ticket ${String(id)}`);
  return found;
}
