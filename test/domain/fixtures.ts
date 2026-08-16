/**
 * Hand-built tickets and cores, for the shapes the golden corpus does not
 * happen to reach.
 *
 * EVERY FIXTURE BUILT FROM THESE IS A SHAPE THE MACHINE COULD HAVE REACHED,
 * and `accountsFor` is what a suite asserts that with. `spawned` is bumped only
 * by a spawn, so a fixture that hands itself a task set or a record while
 * leaving the fresh ticket's zero in place is a state no trace holds — and the
 * work reduce reads that counter to stamp the artifact it produced, so a short
 * one answers a question the machine would answer differently.
 *
 * The builders go through `freshTicket` rather than writing a record literal,
 * which is what keeps a fixture's accounts the ones its configuration grants.
 */

import type { Config } from "../../src/domain/config.ts";
import { defaultProgram } from "../../src/domain/config.ts";
import type { Core } from "../../src/domain/core.ts";
import { freshTicket } from "../../src/domain/deciders.ts";
import {
  asProjectId,
  asTaskId,
  asTicketId,
  type TicketId,
} from "../../src/domain/ids.ts";
import {
  tkEval,
  tkWork,
  tsResolved,
  tsRunning,
  type Task,
  type TaskOutcome,
} from "../../src/domain/task.ts";
import type { Ticket } from "../../src/domain/ticket.ts";
import { wExclusive } from "../../src/domain/wrapUp.ts";

/** A ticket id, so a fixture reads the way the model's numbering does. */
export const id = (value: number): TicketId => asTicketId(value);

/** A resolved work task, as the retained record holds one. */
export const workTask = (value: number, outcome: TaskOutcome): Task => ({
  id: asTaskId(value),
  kind: tkWork,
  state: tsResolved(outcome),
});

/** A resolved task of eval stage `stage`. */
export const evalTask = (
  value: number,
  stage: number,
  outcome: TaskOutcome,
): Task => ({
  id: asTaskId(value),
  kind: tkEval(stage),
  state: tsResolved(outcome),
});

/** A work task still running, as a live set holds one. */
export const workRunning = (value: number): Task => ({
  id: asTaskId(value),
  kind: tkWork,
  state: tsRunning,
});

/** A task of eval stage `stage`, still running. */
export const evalRunning = (value: number, stage: number): Task => ({
  id: asTaskId(value),
  kind: tkEval(stage),
  state: tsRunning,
});

/**
 * A ticket authored on `project` with a lease on the resource of the same name,
 * carrying its configuration's full accounts and whatever the caller overrides.
 */
export function ticketOn(
  config: Config,
  project: number,
  overrides: Partial<Ticket> = {},
): Ticket {
  const born = freshTicket(
    config,
    [],
    defaultProgram(config),
    asProjectId(project),
    wExclusive(project),
  );
  return { ...born, ...overrides };
}

/** A core holding these tickets under dense ids from one, in the order given. */
export function coreOf(tickets: readonly Ticket[]): Core {
  const map = new Map<TicketId, Ticket>();
  tickets.forEach((ticket, index) => map.set(id(index + 1), ticket));
  return { tickets: map };
}

/** The model's `idsAccounted` for one ticket: every id ever issued is retired or live. */
export function accountsFor(ticket: Ticket): boolean {
  return ticket.spawned === ticket.record.length + ticket.tasks.length;
}

/** The same over a whole core: a fixture accounts for all of its ids or none of them. */
export function accountsForAll(core: Core): boolean {
  return [...core.tickets.values()].every(accountsFor);
}
