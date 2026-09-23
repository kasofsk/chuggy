/**
 * Whether a decision is one the machine may take where it was taken: a
 * refusal changes nothing, and an accepted command's every obligation is
 * well-formed, owed once, and agrees with the state its event evolves to
 * (`decisionValid` in `model/domain.qnt`, the package's own).
 *
 * The evolved state's own invariants are the bundle's, checked on the state
 * the step lands in; this reads only what the obligations claim beside it.
 */

import type {
  Obligation,
  TaskIdentity,
  TicketDecision,
  TicketGraph,
} from "./generated/modelTypes.ts";
import { graphEquals } from "./equality.ts";
import { evolve } from "./evolve.ts";
import { asTicketId } from "./ids.ts";
import {
  taskIdentityEquals,
  taskIdentityValid,
  taskObligationEquals,
  taskObligationValid,
  taskOwner,
} from "./task.ts";
import {
  finalizationOperationEquals,
  finalizationOperationOf,
  liveTasks,
} from "./ticket.ts";

/** Every obligation names its own ticket, and every reference in it is a real one. */
export function obligationValid(obligation: Obligation): boolean {
  switch (obligation.type) {
    case "ExecuteTask":
      return (
        obligation.value.ticket === taskOwner(obligation.value.task.task) &&
        taskObligationValid(obligation.value.task)
      );
    case "FinalizeTicket": {
      const { ticket, finalization, configuration } = obligation.value;
      return (
        ticket > 0 &&
        finalization.workCycle > 0 &&
        finalization.generation > 0 &&
        configuration > 0 &&
        finalization.input > 0 &&
        finalization.source > 0
      );
    }
    case "CancelTask":
      return (
        obligation.value.ticket === taskOwner(obligation.value.task) &&
        taskIdentityValid(obligation.value.task)
      );
  }
}

/** Structural equality on an obligation: the same arm, and every field of it. */
export function obligationEquals(left: Obligation, right: Obligation): boolean {
  switch (left.type) {
    case "ExecuteTask":
      return (
        right.type === "ExecuteTask" &&
        left.value.ticket === right.value.ticket &&
        taskObligationEquals(left.value.task, right.value.task)
      );
    case "FinalizeTicket":
      return (
        right.type === "FinalizeTicket" &&
        left.value.ticket === right.value.ticket &&
        left.value.configuration === right.value.configuration &&
        finalizationOperationEquals(
          left.value.finalization,
          right.value.finalization,
        )
      );
    case "CancelTask":
      return (
        right.type === "CancelTask" &&
        left.value.ticket === right.value.ticket &&
        taskIdentityEquals(left.value.task, right.value.task)
      );
  }
}

/** No obligation is owed twice by one decision. */
export function obligationsUnique(obligations: readonly Obligation[]): boolean {
  return obligations.every((obligation, index) =>
    obligations
      .slice(index + 1)
      .every((later) => !obligationEquals(obligation, later)),
  );
}

/** The tasks a graph's ticket is running, and none for a ticket it does not hold. */
function ticketLiveTasks(
  graph: TicketGraph,
  ticket: number,
): readonly TaskIdentity[] {
  const found = graph.tickets.get(asTicketId(ticket));
  return found === undefined ? [] : liveTasks(found);
}

function hasTask(tasks: readonly TaskIdentity[], task: TaskIdentity): boolean {
  return tasks.some((owed) => taskIdentityEquals(owed, task));
}

/**
 * An obligation agrees with the event beside it: a task to run is one the
 * evolved ticket owes, a task to stop is one the prior ticket owed and the
 * evolved one does not, and a finalization to attempt is the one the evolved
 * ticket is on.
 */
export function obligationAgrees(
  prior: TicketGraph,
  evolved: TicketGraph,
  obligation: Obligation,
): boolean {
  switch (obligation.type) {
    case "ExecuteTask":
      return hasTask(
        ticketLiveTasks(evolved, obligation.value.ticket),
        obligation.value.task.task,
      );
    case "CancelTask":
      return (
        hasTask(
          ticketLiveTasks(prior, obligation.value.ticket),
          obligation.value.task,
        ) &&
        !hasTask(
          ticketLiveTasks(evolved, obligation.value.ticket),
          obligation.value.task,
        )
      );
    case "FinalizeTicket": {
      const ticket = evolved.tickets.get(asTicketId(obligation.value.ticket));
      return (
        ticket !== undefined &&
        ticket.phase === "Finalization" &&
        finalizationOperationEquals(
          finalizationOperationOf(ticket),
          obligation.value.finalization,
        )
      );
    }
  }
}

/** The state a decision leaves: a refusal's is the one it found. */
export function applyDecision(
  graph: TicketGraph,
  decision: TicketDecision,
): TicketGraph {
  return decision.type === "TicketRefused"
    ? graph
    : evolve(graph, decision.value.event);
}

/** The decision is valid at the state it was taken in. */
export function decisionValid(
  graph: TicketGraph,
  decision: TicketDecision,
): boolean {
  if (decision.type === "TicketRefused") {
    return graphEquals(applyDecision(graph, decision), graph);
  }
  const { event, obligations } = decision.value;
  const evolved = evolve(graph, event);
  return (
    obligations.every(
      (obligation) =>
        obligationValid(obligation) &&
        obligationAgrees(graph, evolved, obligation),
    ) && obligationsUnique(obligations)
  );
}
