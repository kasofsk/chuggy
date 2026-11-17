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
 * EACH ARM READS AND MOVES ONE TICKET, the one `eventTicket` names, so an event
 * takes its `eventSlice` to exactly what it leaves of that ticket in the whole
 * graph. The journal's fold (`src/actor/journal.ts`) and the ledger's
 * `ticketAfter` both read a ticket that way.
 *
 * The two work-failure arms ask only that the ticket is in Work, not which
 * task failed; the journal's legality check holds a failure row to the
 * current work task instead (`src/actor/journal.ts`). Every arm but a
 * release reads the ticket its event names, and a graph without it is a
 * caller's error, as it is the model's.
 */

import type {
  EvaluationFailureInvalidatedFact,
  EvaluationInvalidatedFact,
  EvaluationReworkEntry,
  EvaluationWithdrawnFact,
  TaskTerminalFact,
  Ticket,
  TicketEvent,
  TicketGraph,
  TicketState,
  WorkInput,
} from "./generated/modelTypes.ts";
import { begin, resumeBlocked } from "./evaluation.ts";
import { asTicketId, type TicketId } from "./ids.ts";
import { taskObligationEquals } from "./task.ts";
import {
  applyEvaluationReport,
  evaluationRequested,
  evaluationReworkInput,
  failedBasisEntries,
  finalizationAfter,
  finalizationCurrent,
  finalizationReworkInput,
  initialWorkInput,
  invalidatableEvaluation,
  invalidatedWorkInput,
  nextCycleNumber,
  reportAdmissible,
  requestedEvaluation,
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
    case "TicketEvaluationInvalidated":
    case "TicketEvaluationFailureInvalidated":
    case "TicketEvaluationBlocked":
    case "TicketEvaluationFailureReturned":
    case "TicketEvaluationWithdrawn":
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationNeedsWork":
    case "TicketFinalizationUnavailable":
    case "TicketFinalizationNeedsEvaluation":
    case "TicketFinalizationFailureReworked":
    case "TicketFinalizationFailureEscalated":
    case "TicketFinalizationFailureInvalidated":
      return asTicketId(event.value.ticket);
  }
}

/** The part of a graph an event reads and moves: the ticket it names, alone. */
export function eventSlice(
  graph: TicketGraph,
  event: TicketEvent,
): TicketGraph {
  const id = eventTicket(event);
  const ticket = graph.tickets.get(id);
  return { tickets: new Map(ticket === undefined ? [] : [[id, ticket]]) };
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

/** Events of the named arms. */
type EventOf<Type extends TicketEvent["type"]> = Extract<
  TicketEvent,
  { readonly type: Type }
>;

/** The state after an event, arm for arm the package's. */
export function evolve(graph: TicketGraph, event: TicketEvent): TicketGraph {
  switch (event.type) {
    case "TicketCreated":
    case "TicketUpdated":
    case "TicketDispatched":
    case "TicketRevoked":
      return evolveAuthoring(graph, event);
    case "TicketWorkResumed":
      return resumeWork(graph, event.value);
    case "TicketEvaluationResumed":
    case "TicketFinalizationResumed":
      return evolveResume(graph, event);
    case "TicketWorkResultAccepted":
    case "TicketWorkProcessFailed":
    case "TicketWorkExecutionUnavailable":
      return evolveWork(graph, event);
    case "TicketEvaluationProgressed":
    case "TicketEvaluationPassed":
    case "TicketEvaluationReworkStarted":
    case "TicketEvaluationFailureEscalated":
    case "TicketEvaluationBlocked":
      return evolveJudgement(graph, event);
    case "TicketEvaluationFailureReturned":
      return evolveFailureReturned(graph, event.value);
    case "TicketEvaluationFailureInvalidated":
      return evolveFailureInvalidation(graph, event.value);
    case "TicketEvaluationInvalidated":
      return evolveInvalidation(graph, event.value);
    case "TicketEvaluationWithdrawn":
      return evolveWithdrawal(graph, event.value);
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationNeedsWork":
    case "TicketFinalizationUnavailable":
    case "TicketFinalizationNeedsEvaluation":
      return evolveFinalization(graph, event);
    case "TicketFinalizationFailureReworked":
    case "TicketFinalizationFailureEscalated":
    case "TicketFinalizationFailureInvalidated":
      return evolveFailureStands(graph, event);
  }
}

/** The release, the update, the dispatch and the revoke. */
function evolveAuthoring(
  graph: TicketGraph,
  event: EventOf<
    "TicketCreated" | "TicketUpdated" | "TicketDispatched" | "TicketRevoked"
  >,
): TicketGraph {
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
  }
}

/** A work wall's resume: a new cycle at the input and source the wall kept. */
function resumeWork(graph: TicketGraph, id: number): TicketGraph {
  const ticket = ticketAt(graph, asTicketId(id));
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

/** The evaluation and finalization resumes, each leaving the wall it answers. */
function evolveResume(
  graph: TicketGraph,
  event: EventOf<"TicketEvaluationResumed" | "TicketFinalizationResumed">,
): TicketGraph {
  switch (event.type) {
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
  }
}

/** A work cycle's result or failure, either only while the ticket is in Work. */
function evolveWork(
  graph: TicketGraph,
  event: EventOf<
    | "TicketWorkResultAccepted"
    | "TicketWorkProcessFailed"
    | "TicketWorkExecutionUnavailable"
  >,
): TicketGraph {
  switch (event.type) {
    case "TicketWorkResultAccepted": {
      const accepted = event.value;
      const ticket = ticketAt(graph, asTicketId(accepted.ticket));
      const state = ticket.state;
      if (typeof state === "string" || state.type !== "Work") return graph;
      if (
        !taskObligationEquals(
          accepted.result.obligation,
          workTaskObligation(ticket, ticket.workCyclesStarted),
        )
      )
        return graph;
      const evaluation = begin(
        ticket.workCyclesStarted,
        1,
        "OpenedByWork",
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
  }
}

/** The wall a failed judgement escalates to, holding its evidence and source. */
function evaluationFailureWall(
  evidence: readonly EvaluationReworkEntry[],
  source: number,
): TicketState {
  return {
    type: "Escalated",
    value: { type: "EvaluationFailureEscalated", value: { evidence, source } },
  };
}

/**
 * The five evaluation arms: the report goes to the running instance, and the
 * event moves only the state it concluded. A failing arm moves only an
 * evaluation a work result opened; a requested one's failure is returned.
 */
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
  const failed =
    evaluation.state.type === "EvaluationFailed" &&
    !evaluationRequested(current);
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
              value: finalizationAfter(evaluation, "PassedVerdict"),
            },
          })
        : graph;
    case "TicketEvaluationReworkStarted":
      return failed
        ? enterWorkCycle(
            graph,
            ticket,
            evaluationReworkInput(ticket.definition, event.value.evidence),
            current.input.acceptedSourceRef,
          )
        : graph;
    case "TicketEvaluationFailureEscalated":
      return failed
        ? updateTicket(graph, fact.ticket, {
            ...ticket,
            state: evaluationFailureWall(
              event.value.evidence,
              current.input.acceptedSourceRef,
            ),
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

/**
 * A requested evaluation's failure returned to its requester: the report
 * concludes the running instance, and the finalizer that asked for it is
 * handed the failed verdict.
 */
function evolveFailureReturned(
  graph: TicketGraph,
  fact: TaskTerminalFact,
): TicketGraph {
  const ticket = ticketAt(graph, asTicketId(fact.ticket));
  const state = ticket.state;
  if (typeof state === "string" || state.type !== "Evaluation") return graph;
  const current = state.value;
  if (!reportAdmissible(current, fact.report)) return graph;
  if (!evaluationRequested(current)) return graph;
  const evaluation = applyEvaluationReport(current, fact.report);
  if (evaluation.state.type !== "EvaluationFailed") return graph;
  return updateTicket(graph, fact.ticket, {
    ...ticket,
    state: {
      type: "Finalization",
      value: finalizationAfter(evaluation, {
        type: "FailedVerdict",
        value: evaluation,
      }),
    },
  });
}

/** A failed evaluation taken back into work: the report concludes the running instance, and the next cycle starts over the source it judged. */
function evolveFailureInvalidation(
  graph: TicketGraph,
  fact: EvaluationFailureInvalidatedFact,
): TicketGraph {
  const ticket = ticketAt(graph, asTicketId(fact.ticket));
  const state = ticket.state;
  if (typeof state === "string" || state.type !== "Evaluation") return graph;
  const current = state.value;
  if (!reportAdmissible(current, fact.report)) return graph;
  if (evaluationRequested(current)) return graph;
  return applyEvaluationReport(current, fact.report).state.type ===
    "EvaluationFailed"
    ? enterWorkCycle(
        graph,
        ticket,
        invalidatedWorkInput(ticket.definition, fact.evidence),
        current.input.acceptedSourceRef,
      )
    : graph;
}

/** An abandoned evaluation a work result opened: the next cycle, over the source it was judging, once the ticket still holds that cycle's evaluation. */
function evolveInvalidation(
  graph: TicketGraph,
  fact: EvaluationInvalidatedFact,
): TicketGraph {
  const ticket = ticketAt(graph, asTicketId(fact.ticket));
  const evaluation = invalidatableEvaluation(ticket.state);
  return evaluation !== null &&
    evaluation.workCycle === fact.workCycle &&
    !evaluationRequested(evaluation)
    ? enterWorkCycle(
        graph,
        ticket,
        invalidatedWorkInput(ticket.definition, fact.evidence),
        evaluation.input.acceptedSourceRef,
      )
    : graph;
}

/** A requested evaluation withdrawn unjudged: its requester's finalizer is handed the withdrawal, once the ticket still holds that round. */
function evolveWithdrawal(
  graph: TicketGraph,
  fact: EvaluationWithdrawnFact,
): TicketGraph {
  const ticket = ticketAt(graph, asTicketId(fact.ticket));
  const evaluation = invalidatableEvaluation(ticket.state);
  if (
    evaluation === null ||
    evaluation.workCycle !== fact.workCycle ||
    evaluation.round !== fact.round ||
    !evaluationRequested(evaluation)
  )
    return graph;
  return updateTicket(graph, fact.ticket, {
    ...ticket,
    state: {
      type: "Finalization",
      value: finalizationAfter(evaluation, {
        type: "WithdrawnVerdict",
        value: fact.evidence,
      }),
    },
  });
}

/** The four finalization arms that read no failed verdict, each moving only the attempt the ticket is on. */
function evolveFinalization(
  graph: TicketGraph,
  event: Extract<
    TicketEvent,
    {
      readonly type:
        | "TicketFinalizationSucceeded"
        | "TicketFinalizationNeedsWork"
        | "TicketFinalizationUnavailable"
        | "TicketFinalizationNeedsEvaluation";
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
      return finalization.basis === "PassedVerdict"
        ? updateTicket(graph, fact.ticket, { ...ticket, state: "Done" })
        : graph;
    case "TicketFinalizationNeedsEvaluation":
      return updateTicket(graph, fact.ticket, {
        ...ticket,
        state: {
          type: "Evaluation",
          value: requestedEvaluation(ticket, finalization, fact.evidence),
        },
      });
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

/** The three arms a failed verdict that stands takes, each moving only the attempt the ticket is on and only when that attempt follows a failure. */
function evolveFailureStands(
  graph: TicketGraph,
  event: EventOf<
    | "TicketFinalizationFailureReworked"
    | "TicketFinalizationFailureEscalated"
    | "TicketFinalizationFailureInvalidated"
  >,
): TicketGraph {
  const fact = event.value;
  const ticket = ticketAt(graph, asTicketId(fact.ticket));
  const state = ticket.state;
  if (typeof state === "string" || state.type !== "Finalization") return graph;
  const finalization = state.value;
  if (!finalizationCurrent(finalization, fact.workCycle, fact.generation))
    return graph;
  const basis = finalization.basis;
  if (basis === "PassedVerdict" || basis.type !== "FailedVerdict") return graph;
  switch (event.type) {
    case "TicketFinalizationFailureReworked":
      return enterWorkCycle(
        graph,
        ticket,
        evaluationReworkInput(ticket.definition, failedBasisEntries(basis)),
        finalization.source,
      );
    case "TicketFinalizationFailureEscalated":
      return updateTicket(graph, fact.ticket, {
        ...ticket,
        state: evaluationFailureWall(
          failedBasisEntries(basis),
          finalization.source,
        ),
      });
    case "TicketFinalizationFailureInvalidated":
      return enterWorkCycle(
        graph,
        ticket,
        invalidatedWorkInput(ticket.definition, event.value.invalidation),
        finalization.source,
      );
  }
}
