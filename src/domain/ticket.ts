/**
 * What a ticket does with its own fields: what a park implies, and the two
 * sites that move its task set.
 *
 * The record is the model's, so `completions` is a stored ghost here as it is
 * there rather than reconstructed from the phase — a stored duplicate of a
 * derivable fact is a finding, and this one is the model's own accounting,
 * carried so a golden state compares field for field.
 */

import type {
  Escalation,
  Resume,
  Task,
  TaskKind,
  Ticket,
} from "./generated/modelTypes.ts";
import { isSettled } from "./phase.ts";
import { nextTaskId, retiredInIdOrder, spawnTasks, tkWork } from "./task.ts";

/**
 * A desk task is open exactly while the ticket is parked, and parked is one
 * phase. Deriving it makes the equivalence hold by construction where storing
 * it would need the equivalence proved.
 */
export function hasOpenHumanTask(ticket: Ticket): boolean {
  return ticket.phase === "Escalated";
}

/**
 * Where each wall resumes, total on the sum, so every park offers the desk
 * exactly one continuation and the unparked ticket offers none — which is what
 * lets the resume point stay off the ticket rather than sit beside the wall
 * that implies it. The two work walls and the evaluation-failure wall all buy
 * a new artifact; only the walls they answer differ.
 */
export function resumeOf(escalation: Escalation): Resume {
  switch (escalation) {
    case "NoEscalation":
      return "NoResume";
    case "WorkFailureEscalated":
    case "WorkExecutionUnavailableEscalated":
      return "ResumeWork";
    case "EvaluationFailureEscalated":
      return "ResumeRework";
    case "EvaluationBlockedEscalated":
      return "ResumeEvaluation";
    case "FinalizationUnavailableEscalated":
      return "ResumeFinalization";
  }
}

/**
 * Install a fresh fan-out and bump the spawn ghost by the same count. Callers
 * guarantee the previous set is already retired, which every spawn site does.
 */
export function spawnOn(ticket: Ticket, kind: TaskKind, count: number): Ticket {
  if (ticket.tasks.size !== 0) {
    throw new Error(
      `spawnOn: ticket still holds ${String(ticket.tasks.size)} live task(s); the caller must retire first`,
    );
  }
  return {
    ...ticket,
    tasks: spawnTasks(
      kind,
      nextTaskId(ticket.record.length, ticket.tasks.size),
      count,
    ),
    spawned: ticket.spawned + count,
  };
}

/**
 * The work spawn: a work cycle is one task, always. Work is not staged and
 * carries no authored width, so the only fan-out left is an evaluation
 * stage's, and every work spawn site is this call.
 */
export function spawnWork(ticket: Ticket): Ticket {
  return spawnOn(ticket, tkWork, 1);
}

/** Move the live set into the retained record, in id order, and leave it empty. */
export function retireLive(ticket: Ticket): Ticket {
  return {
    ...ticket,
    tasks: new Set<Task>(),
    record: [...ticket.record, ...retiredInIdOrder(ticket.tasks)],
  };
}

/** Whether this ticket has reached one of the absorbing terminals. */
export function ticketIsSettled(ticket: Ticket): boolean {
  return isSettled(ticket.phase);
}
