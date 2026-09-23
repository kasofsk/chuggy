/**
 * The state after an event: arm for arm the model's `evolve`
 * (`model/domain.qnt`), which is the package's over chuggy's record.
 *
 * THIS IS THE ONLY THING THAT MOVES A TICKET. A decider returns the event and
 * what it owes; the machine's step, a replay and the actor all fold this over
 * the events, so a journal row is re-applied rather than re-decided.
 *
 * EACH ARM CHECKS THAT THE TICKET STILL OWES ITS EVENT — the phase the event
 * leaves, the work task the cycle is on, the evaluator the run still awaits,
 * the finalization attempt the ticket is on — and leaves any other ticket
 * exactly as it is. That identity is what a journal's legality check reads:
 * an event that does not move the state it lands on is one nothing decided
 * there.
 *
 * The two work-failure arms are the model's one strengthening over the
 * package, whose arms park a ticket in Work whatever task the failure names;
 * see `onCurrentWork`.
 */

import type {
  EvaluationInstance,
  TaskTerminalReport,
  Ticket,
  TicketEvent,
  TicketGraph,
  WorkFailureEvent,
} from "./generated/modelTypes.ts";
import { resumeBlocked } from "./evaluation.ts";
import { asTicketId, type TicketId } from "./ids.ts";
import {
  taskIdentityEquals,
  taskObligationEquals,
  workTaskOf,
} from "./task.ts";
import { freshTicket } from "./deciders.ts";
import {
  applyEvaluationReport,
  begunInstance,
  currentInstance,
  finalizationCurrent,
  finalizationOperationOf,
  instanceBlocked,
  reportAdmissible,
  runningStageIndex,
  spawnEvalRun,
  spawnWork,
  withInstance,
  workTaskObligation,
} from "./ticket.ts";
import { withTicket } from "./ticketGraph.ts";
import { revocationAllowed } from "./phase.ts";

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

/** Park on the desk, naming the wall; where Retry resumes is the wall's own (`resumeOf`). */
function park(ticket: Ticket, wall: Ticket["escalation"]): Ticket {
  return { ...ticket, phase: "Escalated", escalation: wall };
}

/** Enter a new work cycle, from wherever the event says the ticket was. */
function enterWork(ticket: Ticket): Ticket {
  return { ...spawnWork(ticket), phase: "Work", escalation: "NoEscalation" };
}

/**
 * The work walls: the event moves the ticket only while it is on the cycle the
 * failure names. The package checks the phase alone; this guard is what makes
 * a failure row for a replaced cycle inert on replay.
 */
function onCurrentWork(ticket: Ticket, failure: WorkFailureEvent): boolean {
  return (
    ticket.phase === "Work" &&
    taskIdentityEquals(
      failure.task,
      workTaskOf(ticket.definition.id, ticket.workCyclesStarted),
    )
  );
}

/**
 * The evaluation events' shared shape: the report goes to the current
 * instance, and the event moves the ticket only while the instance still owes
 * the reported task and concludes as the event says it did.
 */
function evolveEvaluation(
  ticket: Ticket,
  report: TaskTerminalReport,
  concluded: (advanced: EvaluationInstance) => boolean,
  moved: (advanced: EvaluationInstance) => Ticket,
): Ticket {
  if (ticket.phase !== "Evaluation") return ticket;
  if (!reportAdmissible(currentInstance(ticket), report)) return ticket;
  const advanced = applyEvaluationReport(currentInstance(ticket), report);
  return concluded(advanced) ? moved(advanced) : ticket;
}

/** Whether the finalization event answers the attempt this ticket is on. */
function onCurrentAttempt(
  ticket: Ticket,
  fact: { readonly workCycle: number; readonly generation: number },
): boolean {
  return (
    ticket.phase === "Finalization" &&
    finalizationCurrent(
      finalizationOperationOf(ticket),
      fact.workCycle,
      fact.generation,
    )
  );
}

/** A resume, which moves only a ticket parked at a wall that resumes this way. */
function evolveResume(
  ticket: Ticket,
  event: Extract<
    TicketEvent,
    {
      readonly type:
        | "TicketWorkResumed"
        | "TicketEvaluationResumed"
        | "TicketFinalizationResumed";
    }
  >,
): Ticket {
  switch (event.type) {
    case "TicketWorkResumed":
      return ticket.phase === "Escalated" &&
        (ticket.escalation === "WorkFailureEscalated" ||
          ticket.escalation === "WorkExecutionUnavailableEscalated" ||
          ticket.escalation === "EvaluationFailureEscalated")
        ? enterWork(ticket)
        : ticket;
    case "TicketEvaluationResumed":
      return ticket.phase === "Escalated" &&
        ticket.escalation === "EvaluationBlockedEscalated"
        ? spawnEvalRun({
            ...withInstance(ticket, resumeBlocked(currentInstance(ticket))),
            phase: "Evaluation",
            escalation: "NoEscalation",
          })
        : ticket;
    case "TicketFinalizationResumed":
      return ticket.phase === "Escalated" &&
        ticket.escalation === "FinalizationUnavailableEscalated"
        ? {
            ...ticket,
            phase: "Finalization",
            escalation: "NoEscalation",
            finalizationGeneration: ticket.finalizationGeneration + 1,
          }
        : ticket;
  }
}

/** A judgement's report, which moves only an instance still awaiting the reported task. */
function evolveJudgement(
  ticket: Ticket,
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
): Ticket {
  switch (event.type) {
    case "TicketEvaluationProgressed":
      return evolveEvaluation(
        ticket,
        event.value.report,
        (advanced) => runningStageIndex(advanced) >= 0,
        (advanced) =>
          runningStageIndex(advanced) ===
          runningStageIndex(currentInstance(ticket))
            ? withInstance(ticket, advanced)
            : spawnEvalRun(withInstance(ticket, advanced)),
      );
    case "TicketEvaluationPassed":
      return evolveEvaluation(
        ticket,
        event.value.report,
        (advanced) => advanced.state.type === "EvaluationPassed",
        (advanced) => ({
          ...withInstance(ticket, advanced),
          phase: "Finalization",
          finalizationGeneration: 1,
        }),
      );
    case "TicketEvaluationReworkStarted":
      return evolveEvaluation(
        ticket,
        event.value.report,
        (advanced) => advanced.state.type === "EvaluationFailed",
        (advanced) => enterWork(withInstance(ticket, advanced)),
      );
    case "TicketEvaluationFailureEscalated":
      return evolveEvaluation(
        ticket,
        event.value.report,
        (advanced) => advanced.state.type === "EvaluationFailed",
        (advanced) =>
          park(withInstance(ticket, advanced), "EvaluationFailureEscalated"),
      );
    case "TicketEvaluationBlocked":
      return evolveEvaluation(
        ticket,
        event.value.report,
        instanceBlocked,
        (advanced) =>
          park(withInstance(ticket, advanced), "EvaluationBlockedEscalated"),
      );
  }
}

/** A finalizer's report, which moves only the attempt the ticket is on. */
function evolveFinalization(
  ticket: Ticket,
  event: Extract<
    TicketEvent,
    {
      readonly type:
        | "TicketFinalizationSucceeded"
        | "TicketFinalizationNeedsWork"
        | "TicketFinalizationUnavailable";
    }
  >,
): Ticket {
  switch (event.type) {
    case "TicketFinalizationSucceeded":
      return onCurrentAttempt(ticket, event.value)
        ? { ...ticket, phase: "Done", completions: ticket.completions + 1 }
        : ticket;
    case "TicketFinalizationNeedsWork":
      return onCurrentAttempt(ticket, event.value) ? enterWork(ticket) : ticket;
    case "TicketFinalizationUnavailable":
      return onCurrentAttempt(ticket, event.value)
        ? park(ticket, "FinalizationUnavailableEscalated")
        : ticket;
  }
}

/** One ticket under one event, each arm applying only to a ticket that still owes it. */
export function evolveTicket(ticket: Ticket, event: TicketEvent): Ticket {
  switch (event.type) {
    case "TicketCreated":
      return ticket;
    case "TicketDispatched":
      return ticket.phase === "Pending"
        ? { ...enterWork(ticket), source: event.value.source }
        : ticket;
    case "TicketRevoked":
      return revocationAllowed(ticket.phase)
        ? { ...ticket, phase: "Revoked", escalation: "NoEscalation" }
        : ticket;
    case "TicketWorkResumed":
    case "TicketEvaluationResumed":
    case "TicketFinalizationResumed":
      return evolveResume(ticket, event);
    case "TicketWorkResultAccepted": {
      const accepted = event.value;
      if (
        ticket.phase !== "Work" ||
        !taskObligationEquals(
          accepted.result.obligation,
          workTaskObligation(ticket, ticket.workCyclesStarted),
        )
      )
        return ticket;
      return spawnEvalRun({
        ...ticket,
        phase: "Evaluation",
        source: accepted.acceptedSourceRef,
        evaluations: [
          ...ticket.evaluations,
          begunInstance(
            ticket,
            accepted.result.resultRef,
            accepted.acceptedSourceRef,
          ),
        ],
      });
    }
    case "TicketWorkProcessFailed":
      return onCurrentWork(ticket, event.value)
        ? park(ticket, "WorkFailureEscalated")
        : ticket;
    case "TicketWorkExecutionUnavailable":
      return onCurrentWork(ticket, event.value)
        ? park(ticket, "WorkExecutionUnavailableEscalated")
        : ticket;
    case "TicketEvaluationProgressed":
    case "TicketEvaluationPassed":
    case "TicketEvaluationReworkStarted":
    case "TicketEvaluationFailureEscalated":
    case "TicketEvaluationBlocked":
      return evolveJudgement(ticket, event);
    case "TicketFinalizationSucceeded":
    case "TicketFinalizationNeedsWork":
    case "TicketFinalizationUnavailable":
      return evolveFinalization(ticket, event);
  }
}

/**
 * The state after an event, applied only to a state that still owes it and
 * the identity on every other. The package states the same at its `evolve`,
 * through the `reportAdmissible` and `finalizationCurrent` guards each arm
 * reads.
 */
export function evolve(graph: TicketGraph, event: TicketEvent): TicketGraph {
  if (event.type === "TicketCreated") {
    const id = asTicketId(event.value.id);
    if (graph.tickets.has(id)) return graph;
    const tickets = new Map(graph.tickets);
    tickets.set(id, freshTicket(event.value));
    return { tickets };
  }
  const id = eventTicket(event);
  const ticket = graph.tickets.get(id);
  if (ticket === undefined) return graph;
  const evolved = evolveTicket(ticket, event);
  return evolved === ticket ? graph : withTicket(graph, id, evolved);
}
