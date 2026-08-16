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
import { initRecord, type Core } from "../../src/domain/core.ts";
import { freshTicket } from "../../src/domain/deciders.ts";
import {
  asProjectId,
  asTaskId,
  asTicketId,
  type TicketId,
} from "../../src/domain/ids.ts";
import type { StepView } from "../../src/domain/invariants.ts";
import {
  tkEval,
  tkWork,
  tsResolved,
  tsRunning,
  type Task,
  type TaskOutcome,
} from "../../src/domain/task.ts";
import type { Ticket } from "../../src/domain/ticket.ts";
import { aSome, wExclusive } from "../../src/domain/wrapUp.ts";

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

/**
 * The view of a state no decision has reached. The previous Core is the empty
 * fleet, which is exactly what the model's two ghosts hold after `init`.
 */
export function initialView(post: Core): StepView {
  return { pre: coreOf([]), rec: initRecord, post };
}

/**
 * A fleet in mid-flight: one ticket completed, one working behind it, and one
 * holding a second project's gate. Every safety invariant is green on it, so a
 * defect below is one edit away from a state that passes.
 */
export function healthyFleet(config: Config): readonly Ticket[] {
  const width = config.nTasks;
  const record: Task[] = [];
  for (let i = 0; i < width; i++) record.push(workTask(i + 1, "TPassed"));
  for (let i = 0; i < width; i++) {
    record.push(evalTask(width + i + 1, 0, "TPassed"));
  }
  const live: Task[] = [];
  for (let i = 0; i < width; i++) live.push(workRunning(i + 1));
  const finished = {
    record,
    spawned: record.length,
    artifact: aSome(width),
    gasLeft: config.gas - 1,
  };
  return [
    ticketOn(config, 1, { ...finished, phase: "PDone" }),
    ticketOn(config, 1, {
      phase: "PWorking",
      deps: [id(1)],
      tasks: live,
      spawned: width,
      gasLeft: config.gas - 1,
    }),
    ticketOn(config, 2, { ...finished, phase: "PWrapUpHolding" }),
  ];
}

/** A fleet with one ticket replaced, which is how each defect stays a single edit. */
export function fleetBut(
  fleet: readonly Ticket[],
  index: number,
  overrides: Partial<Ticket>,
): Core {
  return coreOf(
    fleet.map((ticket, at) =>
      at === index ? { ...ticket, ...overrides } : ticket,
    ),
  );
}

/** The model's `idsAccounted` for one ticket: every id ever issued is retired or live. */
export function accountsFor(ticket: Ticket): boolean {
  return ticket.spawned === ticket.record.length + ticket.tasks.length;
}

/** The same over a whole core: a fixture accounts for all of its ids or none of them. */
export function accountsForAll(core: Core): boolean {
  return [...core.tickets.values()].every(accountsFor);
}
