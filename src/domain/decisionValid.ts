/**
 * The package's own invariants and its `decisionValid` (`model/domain.qnt`,
 * between its markers): what a ticket's state must carry, what a graph must
 * hold, and whether a decision is one the machine may take where it was
 * taken — a refusal changes nothing, and an accepted command's every
 * obligation is well-formed, owed once and agrees with the state its event
 * evolves to, and that state satisfies `graphInvariant`.
 */

import type {
  Escalation,
  FinalizationOperation,
  Obligation,
  TaskIdentity,
  Ticket,
  TicketDecision,
  TicketEvent,
  TicketGraph,
  WorkInput,
} from "./generated/modelTypes.ts";
import { finalizationOperationEquals, graphEquals } from "./equality.ts";
import { evolve } from "./evolve.ts";
import { instanceValid } from "./evaluation.ts";
import { asTicketId } from "./ids.ts";
import {
  taskIdentityEquals,
  taskIdentityValid,
  taskObligationEquals,
  taskObligationValid,
  taskOwner,
} from "./task.ts";
import {
  evaluationRequested,
  evaluationReworkInput,
  failedBasisEntries,
  liveTaskList,
  listHasTask,
  releasedContentValid,
  releasedTicketValid,
} from "./ticket.ts";
import { ticketAt, ticketIds } from "./ticketGraph.ts";

/** The package's `workInputValid`: every reference the input carries is a real one. */
export function workInputValid(input: WorkInput): boolean {
  if (!releasedContentValid(input.released)) return false;
  if (!input.retryEvidence.every((evidence) => evidence > 0)) return false;
  const cause = input.cause;
  if (cause === "InitialWork") return true;
  switch (cause.type) {
    case "EvaluationRework":
      return (
        cause.value.length > 0 &&
        cause.value.every((entry) => entry.evaluator > 0 && entry.resultRef > 0)
      );
    case "FinalizationRework":
    case "EvaluationInvalidated":
      return cause.value > 0;
  }
}

/** A valid input over this ticket's released content. */
export function workInputMatchesTicket(
  ticket: Ticket,
  input: WorkInput,
): boolean {
  return workInputValid(input) && input.released === ticket.definition.content;
}

/**
 * Only a requested evaluation, which is never round 1, leaves a basis that is
 * not a pass, and a failed basis is the evaluation the operation follows.
 */
export function finalizationBasisValid(
  ticket: Ticket,
  operation: FinalizationOperation,
): boolean {
  const basis = operation.basis;
  if (basis === "PassedVerdict") return true;
  if (basis.type === "WithdrawnVerdict")
    return operation.round > 1 && basis.value > 0;
  const evaluation = basis.value;
  return (
    instanceValid(evaluation) &&
    evaluationRequested(evaluation) &&
    evaluation.input.ticket === ticket.definition.id &&
    evaluation.workCycle === operation.workCycle &&
    evaluation.round === operation.round &&
    evaluation.input.workResult === operation.input &&
    evaluation.input.acceptedSourceRef === operation.source &&
    failedBasisEntries(basis).length > 0
  );
}

/** What a finalization attempt must carry for the ticket on it. */
export function finalizationOperationValid(
  ticket: Ticket,
  operation: FinalizationOperation,
): boolean {
  return (
    operation.workCycle === ticket.workCyclesStarted &&
    operation.round > 0 &&
    operation.generation >= operation.round &&
    operation.input > 0 &&
    operation.source > 0 &&
    finalizationBasisValid(ticket, operation)
  );
}

/** What each wall must carry for the ticket parked at it. */
export function escalationValid(
  ticket: Ticket,
  escalation: Escalation,
): boolean {
  switch (escalation.type) {
    case "WorkFailureEscalated":
    case "WorkExecutionUnavailableEscalated":
      return (
        workInputMatchesTicket(ticket, escalation.value.resumeInput) &&
        escalation.value.source > 0 &&
        escalation.value.evidence > 0
      );
    case "EvaluationFailureEscalated":
      return (
        workInputMatchesTicket(
          ticket,
          evaluationReworkInput(ticket.definition, escalation.value.evidence),
        ) && escalation.value.source > 0
      );
    case "EvaluationBlockedEscalated": {
      const evaluation = escalation.value;
      return (
        instanceValid(evaluation) &&
        evaluation.input.ticket === ticket.definition.id &&
        evaluation.workCycle === ticket.workCyclesStarted &&
        evaluation.state.type === "EvaluationBlocked"
      );
    }
    case "FinalizationUnavailableEscalated": {
      const { finalization, evidence } = escalation.value;
      return finalizationOperationValid(ticket, finalization) && evidence > 0;
    }
  }
}

/** The package's `ticketInvariant`: what the ticket's state must carry. */
export function ticketInvariant(ticket: Ticket): boolean {
  if (!releasedTicketValid(ticket.definition)) return false;
  if (ticket.revision <= 0 || ticket.workCyclesStarted < 0) return false;
  const state = ticket.state;
  if (state === "Pending") return ticket.workCyclesStarted === 0;
  if (state === "Done" || state === "Revoked") return true;
  switch (state.type) {
    case "Work":
      return (
        ticket.workCyclesStarted > 0 &&
        workInputMatchesTicket(ticket, state.value.input) &&
        state.value.source > 0
      );
    case "Evaluation": {
      const evaluation = state.value;
      return (
        instanceValid(evaluation) &&
        evaluation.input.ticket === ticket.definition.id &&
        evaluation.workCycle === ticket.workCyclesStarted &&
        evaluation.input.acceptedSourceRef > 0 &&
        evaluation.state.type === "Running"
      );
    }
    case "Finalization":
      return finalizationOperationValid(ticket, state.value);
    case "Escalated":
      return escalationValid(ticket, state.value);
  }
}

/**
 * Everything this ticket transitively waits on: the package's bounded
 * fixpoint, reached by visiting each dependency once, since the writer asks
 * it of the whole project on every decision.
 */
export function dependencyClosure(
  graph: TicketGraph,
  id: number,
): ReadonlySet<number> {
  const found = new Set<number>();
  const pending = [...ticketAt(graph, asTicketId(id)).definition.dependencies];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (found.has(next)) continue;
    found.add(next);
    pending.push(...ticketAt(graph, asTicketId(next)).definition.dependencies);
  }
  return found;
}

/** No ticket waits on itself through any chain. */
export function dependencyGraphAcyclic(graph: TicketGraph): boolean {
  return ticketIds(graph).every((id) => !dependencyClosure(graph, id).has(id));
}

/**
 * The package's `graphInvariant`: every ticket keyed by its own id and
 * satisfying `ticketInvariant`, none naming itself or a ticket that does not
 * exist, and the dependencies acyclic.
 */
export function graphInvariant(graph: TicketGraph): boolean {
  return (
    ticketIds(graph).every((id) => {
      const ticket = ticketAt(graph, id);
      return (
        ticket.definition.id === id &&
        ticketInvariant(ticket) &&
        !ticket.definition.dependencies.has(id) &&
        [...ticket.definition.dependencies].every((d) => graph.tickets.has(d))
      );
    }) && dependencyGraphAcyclic(graph)
  );
}

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
        finalization.round > 0 &&
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
  const found = graph.tickets.get(ticket);
  return found === undefined ? [] : liveTaskList(found);
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
      return listHasTask(
        ticketLiveTasks(evolved, obligation.value.ticket),
        obligation.value.task.task,
      );
    case "CancelTask":
      return (
        listHasTask(
          ticketLiveTasks(prior, obligation.value.ticket),
          obligation.value.task,
        ) &&
        !listHasTask(
          ticketLiveTasks(evolved, obligation.value.ticket),
          obligation.value.task,
        )
      );
    case "FinalizeTicket": {
      const ticket = evolved.tickets.get(obligation.value.ticket);
      if (ticket === undefined) return false;
      const state = ticket.state;
      return (
        typeof state !== "string" &&
        state.type === "Finalization" &&
        finalizationOperationEquals(state.value, obligation.value.finalization)
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

/** A ticket completes only from a finalization whose basis is a pass. */
export function completionFollowsAPass(
  prior: TicketGraph,
  event: TicketEvent,
): boolean {
  if (event.type !== "TicketFinalizationSucceeded") return true;
  const ticket = prior.tickets.get(event.value.ticket);
  if (ticket === undefined) return false;
  const state = ticket.state;
  return (
    typeof state !== "string" &&
    state.type === "Finalization" &&
    state.value.basis === "PassedVerdict"
  );
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
    ) &&
    obligationsUnique(obligations) &&
    completionFollowsAPass(graph, event) &&
    graphInvariant(evolved)
  );
}
