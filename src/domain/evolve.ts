/**
 * The state after an event: arm for arm the package's `evolve`
 * (`model/domain.qnt`, between its markers).
 *
 * THIS IS THE ONLY THING THAT MOVES A TICKET. A decider returns the event and
 * what it owes; the machine's step, a replay and the actor all fold this over
 * the events, so a journal row is re-applied rather than re-decided.
 *
 * EACH ARM CHECKS THAT THE TICKET STILL OWES ITS EVENT — the state the event
 * leaves, the evaluator the run still awaits, the finalization attempt the
 * ticket is on — and leaves the graph exactly as it is otherwise. That
 * identity is what a journal's legality check reads: an event that does not
 * move the state it lands on is one nothing decided there.
 *
 * The two work-failure arms ask only that the ticket is in Work, not which
 * task failed; the journal's legality check holds a failure row to the
 * current work task instead (`src/actor/journal.ts`). Every arm but a
 * release reads the ticket its event names, and a graph without it is a
 * caller's error, as it is the model's.
 */

import type {
  Ticket,
  TicketEvent,
  TicketGraph,
  WorkInput,
} from "./generated/modelTypes.ts";
import { begin, resumeBlocked } from "./evaluation.ts";
import { asTicketId, type TicketId } from "./ids.ts";
import { taskObligationEquals } from "./task.ts";
import {
  applyEvaluationReport,
  evaluationReworkInput,
  finalizationCurrent,
  finalizationReworkInput,
  initialWorkInput,
  nextCycleNumber,
  reportAdmissible,
  resumedFinalization,
  retryWorkInput,
  workTaskObligation,
} from "./ticket.ts";
import { ticketAt, withTicket } from "./ticketGraph.ts";
import { isPending, revocationAllowed } from "./phase.ts";

/** The ticket an event is about, whichever arm it is. */
export function eventTicket(event: TicketEvent): TicketId {
  switch (event.type) {
    case "TicketCreated":
      return asTicketId(event.value.id);
    case "TicketRevoked":
    case "TicketWorkResumed":
    case "TicketEvaluationResumed":
    case "TicketFinalizationResumed":
      return asTicketId(event.value);
    case "TicketUpdated":
    case "TicketDispatched":
    case "TicketWorkResultAccepted":
    case "TicketWorkProcessFailed":
    case "TicketWorkExecutionUnavailable":
    case "TicketEvaluationProgressed":
    case "TicketEvaluationPassed":
    case "TicketEvaluationReworkStarted":
    case "TicketEvaluationFailureEscalated":
    case "TicketEvaluationBlocked":
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationNeedsWork":
    case "TicketFinalizationUnavailable":
      return asTicketId(event.value.ticket);
  }
}

/** The package's `enterWorkCycle`: the next cycle, in Work, over this input at this source. */
function enterWorkCycle(
  graph: TicketGraph,
  ticket: Ticket,
  input: WorkInput,
  source: number,
): TicketGraph {
  return withTicket(graph, asTicketId(ticket.definition.id), {
    ...ticket,
    workCyclesStarted: nextCycleNumber(ticket),
    state: { type: "Work", value: { input, source } },
  });
}

/** The graph with one ticket's record replaced. */
function updateTicket(
  graph: TicketGraph,
  id: number,
  ticket: Ticket,
): TicketGraph {
  return withTicket(graph, asTicketId(id), ticket);
}

/** The state after an event, arm for arm the package's. */
export function evolve(graph: TicketGraph, event: TicketEvent): TicketGraph {
  switch (event.type) {
    case "TicketCreated": {
      const definition = event.value;
      if (graph.tickets.has(definition.id)) return graph;
      const tickets = new Map(graph.tickets);
      tickets.set(asTicketId(definition.id), {
        definition,
        revision: 1,
        workCyclesStarted: 0,
        state: "Pending",
      });
      return { tickets };
    }
    case "TicketUpdated": {
      const update = event.value;
      const ticket = graph.tickets.get(update.ticket);
      if (ticket === undefined) return graph;
      if (!isPending(ticket.state)) return graph;
      if (update.revision !== ticket.revision + 1) return graph;
      return updateTicket(graph, update.ticket, {
        ...ticket,
        definition: update.definition,
        revision: update.revision,
      });
    }
    case "TicketDispatched": {
      const ticket = ticketAt(graph, asTicketId(event.value.ticket));
      return ticket.state === "Pending"
        ? enterWorkCycle(
            graph,
            ticket,
            initialWorkInput(ticket.definition),
            event.value.source,
          )
        : graph;
    }
    case "TicketRevoked": {
      const ticket = ticketAt(graph, asTicketId(event.value));
      return revocationAllowed(ticket.state)
        ? updateTicket(graph, event.value, { ...ticket, state: "Revoked" })
        : graph;
    }
    case "TicketWorkResumed": {
      const ticket = ticketAt(graph, asTicketId(event.value));
      const state = ticket.state;
      if (typeof state === "string" || state.type !== "Escalated") return graph;
      const wall = state.value;
      switch (wall.type) {
        case "WorkFailureEscalated":
        case "WorkExecutionUnavailableEscalated":
          return enterWorkCycle(
            graph,
            ticket,
            wall.value.resumeInput,
            wall.value.source,
          );
        case "EvaluationFailureEscalated":
          return enterWorkCycle(
            graph,
            ticket,
            evaluationReworkInput(ticket.definition, wall.value.evidence),
            wall.value.source,
          );
        case "EvaluationBlockedEscalated":
        case "FinalizationUnavailableEscalated":
          return graph;
      }
    }
    case "TicketEvaluationResumed": {
      const ticket = ticketAt(graph, asTicketId(event.value));
      const state = ticket.state;
      if (
        typeof state === "string" ||
        state.type !== "Escalated" ||
        state.value.type !== "EvaluationBlockedEscalated"
      )
        return graph;
      return updateTicket(graph, event.value, {
        ...ticket,
        state: { type: "Evaluation", value: resumeBlocked(state.value.value) },
      });
    }
    case "TicketFinalizationResumed": {
      const ticket = ticketAt(graph, asTicketId(event.value));
      const state = ticket.state;
      if (
        typeof state === "string" ||
        state.type !== "Escalated" ||
        state.value.type !== "FinalizationUnavailableEscalated"
      )
        return graph;
      return updateTicket(graph, event.value, {
        ...ticket,
        state: {
          type: "Finalization",
          value: resumedFinalization(state.value.value.finalization),
        },
      });
    }
    case "TicketWorkResultAccepted": {
      const accepted = event.value;
      const ticket = ticketAt(graph, asTicketId(accepted.ticket));
      const state = ticket.state;
      if (typeof state === "string" || state.type !== "Work") return graph;
      if (
        !taskObligationEquals(
          accepted.result.obligation,
          workTaskObligation(
            ticket,
            ticket.workCyclesStarted,
            state.value.source,
            state.value.input,
          ),
        )
      )
        return graph;
      const evaluation = begin(
        ticket.workCyclesStarted,
        {
          ticket: accepted.ticket,
          workResult: accepted.result.resultRef,
          acceptedSourceRef: accepted.acceptedSourceRef,
        },
        ticket.definition.evaluationPlan,
      );
      return updateTicket(graph, accepted.ticket, {
        ...ticket,
        state: { type: "Evaluation", value: evaluation },
      });
    }
    case "TicketWorkProcessFailed":
    case "TicketWorkExecutionUnavailable": {
      const failure = event.value;
      const ticket = ticketAt(graph, asTicketId(failure.ticket));
      const state = ticket.state;
      if (typeof state === "string" || state.type !== "Work") return graph;
      const wall = {
        resumeInput: retryWorkInput(state.value.input, failure.evidence),
        source: state.value.source,
        evidence: failure.evidence,
      };
      return updateTicket(graph, failure.ticket, {
        ...ticket,
        state: {
          type: "Escalated",
          value:
            event.type === "TicketWorkProcessFailed"
              ? { type: "WorkFailureEscalated", value: wall }
              : { type: "WorkExecutionUnavailableEscalated", value: wall },
        },
      });
    }
    case "TicketEvaluationProgressed":
    case "TicketEvaluationPassed":
    case "TicketEvaluationReworkStarted":
    case "TicketEvaluationFailureEscalated":
    case "TicketEvaluationBlocked":
      return evolveJudgement(graph, event);
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationNeedsWork":
    case "TicketFinalizationUnavailable":
      return evolveFinalization(graph, event);
  }
}

/** The five evaluation arms: the report goes to the running instance, and the event moves only the state it concluded. */
function evolveJudgement(
  graph: TicketGraph,
  event: Extract<
    TicketEvent,
    {
      readonly type:
        | "TicketEvaluationProgressed"
        | "TicketEvaluationPassed"
        | "TicketEvaluationReworkStarted"
        | "TicketEvaluationFailureEscalated"
        | "TicketEvaluationBlocked";
    }
  >,
): TicketGraph {
  const fact = event.value;
  const ticket = ticketAt(graph, asTicketId(fact.ticket));
  const state = ticket.state;
  if (typeof state === "string" || state.type !== "Evaluation") return graph;
  const current = state.value;
  if (!reportAdmissible(current, fact.report)) return graph;
  const evaluation = applyEvaluationReport(current, fact.report);
  switch (event.type) {
    case "TicketEvaluationProgressed":
      return evaluation.state.type === "Running"
        ? updateTicket(graph, fact.ticket, {
            ...ticket,
            state: { type: "Evaluation", value: evaluation },
          })
        : graph;
    case "TicketEvaluationPassed":
      return evaluation.state.type === "EvaluationPassed"
        ? updateTicket(graph, fact.ticket, {
            ...ticket,
            state: {
              type: "Finalization",
              value: {
                workCycle: evaluation.workCycle,
                generation: 1,
                input: evaluation.input.workResult,
                source: evaluation.input.acceptedSourceRef,
              },
            },
          })
        : graph;
    case "TicketEvaluationReworkStarted":
      return evaluation.state.type === "EvaluationFailed"
        ? enterWorkCycle(
            graph,
            ticket,
            evaluationReworkInput(ticket.definition, event.value.evidence),
            current.input.acceptedSourceRef,
          )
        : graph;
    case "TicketEvaluationFailureEscalated":
      return evaluation.state.type === "EvaluationFailed"
        ? updateTicket(graph, fact.ticket, {
            ...ticket,
            state: {
              type: "Escalated",
              value: {
                type: "EvaluationFailureEscalated",
                value: {
                  evidence: event.value.evidence,
                  source: current.input.acceptedSourceRef,
                },
              },
            },
          })
        : graph;
    case "TicketEvaluationBlocked":
      return evaluation.state.type === "EvaluationBlocked"
        ? updateTicket(graph, fact.ticket, {
            ...ticket,
            state: {
              type: "Escalated",
              value: { type: "EvaluationBlockedEscalated", value: evaluation },
            },
          })
        : graph;
  }
}

/** The three finalization arms, each moving only the attempt the ticket is on. */
function evolveFinalization(
  graph: TicketGraph,
  event: Extract<
    TicketEvent,
    {
      readonly type:
        | "TicketFinalizationSucceeded"
        | "TicketFinalizationNeedsWork"
        | "TicketFinalizationUnavailable";
    }
  >,
): TicketGraph {
  const fact = event.value;
  const ticket = ticketAt(graph, asTicketId(fact.ticket));
  const state = ticket.state;
  if (typeof state === "string" || state.type !== "Finalization") return graph;
  const finalization = state.value;
  if (!finalizationCurrent(finalization, fact.workCycle, fact.generation))
    return graph;
  switch (event.type) {
    case "TicketFinalizationSucceeded":
      return updateTicket(graph, fact.ticket, { ...ticket, state: "Done" });
    case "TicketFinalizationNeedsWork":
      return enterWorkCycle(
        graph,
        ticket,
        finalizationReworkInput(ticket.definition, fact.evidence),
        finalization.source,
      );
    case "TicketFinalizationUnavailable":
      return updateTicket(graph, fact.ticket, {
        ...ticket,
        state: {
          type: "Escalated",
          value: {
            type: "FinalizationUnavailableEscalated",
            value: { finalization, evidence: fact.evidence },
          },
        },
      });
  }
}
