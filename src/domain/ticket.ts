/**
 * What a ticket does with its own fields: what a park implies, how far through
 * its program it is, and the two sites that move its task set.
 *
 * The record is the model's, so `completions` is a stored ghost here as it is
 * there rather than reconstructed from the phase — a stored duplicate of a
 * derivable fact is a finding, and this one is the model's own accounting,
 * carried so a golden state compares field for field.
 */

import type { Task, TaskKind, Ticket } from "./generated/modelTypes.ts";
import { isSettled } from "./phase.ts";
import {
  evalStage,
  nextTaskId,
  retiredInIdOrder,
  spawnTasks,
} from "./task.ts";

/**
 * A desk task is open exactly while the ticket is parked, and parked is one
 * phase. Deriving it makes the equivalence hold by construction where storing
 * it would need the equivalence proved.
 */
export function hasOpenHumanTask(ticket: Ticket): boolean {
  return ticket.phase === "Escalated";
}

/**
 * How many stages of the authored program have not yet passed: the digit
 * appears while evaluating and vanishes on every exit.
 */
export function stagesLeft(ticket: Ticket): number {
  return ticket.phase === "Evaluating"
    ? ticket.program.length - evalStage(ticket.tasks)
    : 0;
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

/** Move the live set into the retained record, in id order, and leave it empty. */
export function retireLive(ticket: Ticket): Ticket {
  return {
    ...ticket,
    tasks: new Set<Task>(),
    record: [...ticket.record, ...retiredInIdOrder(ticket.tasks)],
  };
}

/** Whether this ticket has reached one of the three settled phases. */
export function ticketIsSettled(ticket: Ticket): boolean {
  return isSettled(ticket.phase);
}
