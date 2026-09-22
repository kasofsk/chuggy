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
 * The builders go through `freshTicket` rather than writing a ticket literal,
 * so a field added to the record reaches every fixture at once.
 */

import type { Config } from "../../src/domain/config.ts";
import { defaultProgram } from "../../src/domain/config.ts";
import { initRecord } from "../../src/domain/ticketGraph.ts";
import type {
  TicketGraph,
  Task,
  TaskOutcome,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { freshTicket } from "../../src/domain/deciders.ts";
import { asTicketId, type TicketId } from "../../src/domain/ids.ts";
import type { StepView } from "../../src/domain/invariants.ts";
import {
  evaluationTaskOf,
  tsResolved,
  tsOutstanding,
  workTaskOf,
} from "../../src/domain/task.ts";

/** A ticket id, so a fixture reads the way the model's numbering does. */
export const id = (value: number): TicketId => asTicketId(value);

/** A release's dependency draw, in the shape the release carries it: the model's set. */
export const depsOf = (...values: number[]): ReadonlySet<TicketId> =>
  new Set(values.map(id));

/** A resolved work task of `ticket`'s cycle, as the retained record holds one. */
export const workTask = (
  ticket: number,
  cycle: number,
  outcome: TaskOutcome,
): Task => ({
  identity: workTaskOf(ticket, cycle),
  state: tsResolved(outcome),
});

/** A resolved evaluator of `ticket`'s stage, both named by their keys, judging the named cycle. */
export const evalTask = (
  ticket: number,
  cycle: number,
  stage: number,
  evaluator: number,
  outcome: TaskOutcome,
): Task => ({
  identity: evaluationTaskOf(ticket, cycle, stage, 1, evaluator),
  state: tsResolved(outcome),
});

/** A work task still outstanding, as a live set holds one. */
export const workOutstanding = (ticket: number, cycle: number): Task => ({
  identity: workTaskOf(ticket, cycle),
  state: tsOutstanding,
});

/** An evaluator of `ticket`'s stage, both named by their keys, still outstanding. */
export const evalOutstanding = (
  ticket: number,
  cycle: number,
  stage: number,
  evaluator: number,
): Task => ({
  identity: evaluationTaskOf(ticket, cycle, stage, 1, evaluator),
  state: tsOutstanding,
});

/** A ticket as a release leaves it, with whatever the caller overrides. */
export function ticketOn(
  config: Config,
  overrides: Partial<Ticket> = {},
): Ticket {
  const born = freshTicket({
    deps: new Set<number>(),
    program: defaultProgram(config),
  });
  return { ...born, ...overrides };
}

/** A graph holding these tickets under dense ids from one, in the order given. */
export function graphOf(tickets: readonly Ticket[]): TicketGraph {
  const map = new Map<TicketId, Ticket>();
  tickets.forEach((ticket, index) => map.set(id(index + 1), ticket));
  return { tickets: map };
}

/**
 * The view of a state no decision has reached. The previous TicketGraph is the empty
 * fleet, which is exactly what the model's two ghosts hold after `init`.
 */
export function initialView(post: TicketGraph): StepView {
  return { pre: graphOf([]), rec: initRecord, post };
}

/**
 * A fleet in mid-flight: one ticket completed, one working behind it, and one
 * running its finalizer. Every safety invariant is green on it, so a defect
 * below is one edit away from a state that passes.
 */
export function healthyFleet(config: Config): readonly Ticket[] {
  const finished = (ticket: number): Partial<Ticket> => {
    const record: Task[] = [workTask(ticket, 1, "Passed")];
    for (let i = 0; i < config.nTasks; i++)
      record.push(evalTask(ticket, 1, 1, i + 1, "Passed"));
    return {
      record,
      workCyclesStarted: 1,
      spawned: record.length,
      artifact: { type: "ProducedArtifact", value: 1 },
    };
  };
  return [
    ticketOn(config, {
      ...finished(1),
      phase: "Done",
      completions: 1,
    }),
    ticketOn(config, {
      phase: "Work",
      deps: new Set([1]),
      tasks: new Set<Task>([workOutstanding(2, 1)]),
      workCyclesStarted: 1,
      spawned: 1,
    }),
    ticketOn(config, {
      ...finished(3),
      phase: "Finalization",
    }),
  ];
}

/** A fleet with one ticket replaced, which is how each defect stays a single edit. */
export function fleetBut(
  fleet: readonly Ticket[],
  index: number,
  overrides: Partial<Ticket>,
): TicketGraph {
  return graphOf(
    fleet.map((ticket, at) =>
      at === index ? { ...ticket, ...overrides } : ticket,
    ),
  );
}

/**
 * The model's `idsAccounted` for one ticket: every task ever spawned is
 * retired or live, and the work-cycle counter is what its work tasks show.
 */
export function accountsFor(ticket: Ticket): boolean {
  return (
    ticket.spawned === ticket.record.length + ticket.tasks.size &&
    ticket.workCyclesStarted ===
      [...ticket.record, ...ticket.tasks].filter(
        (task) => task.identity.type === "WorkTask",
      ).length
  );
}

/** The same over a whole graph: a fixture accounts for all of its ids or none of them. */
export function accountsForAll(graph: TicketGraph): boolean {
  return [...graph.tickets.values()].every(accountsFor);
}
