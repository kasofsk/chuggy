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
import { initRecord } from "../../src/domain/core.ts";
import type {
  Core,
  Task,
  TaskOutcome,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { freshTicket } from "../../src/domain/deciders.ts";
import { asTaskId, asTicketId, type TicketId } from "../../src/domain/ids.ts";
import type { StepView } from "../../src/domain/invariants.ts";
import {
  tkEval,
  tkWork,
  tsResolved,
  tsOutstanding,
} from "../../src/domain/task.ts";

/** A ticket id, so a fixture reads the way the model's numbering does. */
export const id = (value: number): TicketId => asTicketId(value);

/** A release's dependency draw, in the shape the release carries it: the model's set. */
export const depsOf = (...values: number[]): ReadonlySet<TicketId> =>
  new Set(values.map(id));

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

/** A work task still outstanding, as a live set holds one. */
export const workOutstanding = (value: number): Task => ({
  id: asTaskId(value),
  kind: tkWork,
  state: tsOutstanding,
});

/** A task of eval stage `stage`, still outstanding. */
export const evalOutstanding = (value: number, stage: number): Task => ({
  id: asTaskId(value),
  kind: tkEval(stage),
  state: tsOutstanding,
});

/**
 * A ticket as a release leaves it, carrying its configuration's full accounts
 * and whatever the caller overrides.
 */
export function ticketOn(
  config: Config,
  finalizer: Ticket["finalizer"] = "ManagedFinalizer",
  overrides: Partial<Ticket> = {},
): Ticket {
  const born = freshTicket({
    deps: new Set<number>(),
    program: defaultProgram(config),
    workFanout: config.nTasks,
    reworkPolicy: config.reworkPolicy,
    finalizationPricing: config.finalizationPricing,
    resumePricing: "RetryCharged",
    finalizer,
    gas: config.gas,
  });
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
 * running its finalizer. Every safety invariant is green on it, so a defect
 * below is one edit away from a state that passes.
 */
export function healthyFleet(config: Config): readonly Ticket[] {
  const width = config.nTasks;
  const record: Task[] = [];
  for (let i = 0; i < width; i++) record.push(workTask(i + 1, "Passed"));
  for (let i = 0; i < width; i++) {
    record.push(evalTask(width + i + 1, 0, "Passed"));
  }
  const live = new Set<Task>();
  for (let i = 0; i < width; i++) live.add(workOutstanding(i + 1));
  const finished = {
    record,
    spawned: record.length,
    artifact: { type: "ProducedArtifact", value: width } as const,
    gasLeft: config.gas - 1,
  };
  return [
    ticketOn(config, "ManagedFinalizer", {
      ...finished,
      phase: "Done",
      completions: 1,
    }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      deps: new Set([1]),
      tasks: live,
      spawned: width,
      gasLeft: config.gas - 1,
    }),
    ticketOn(config, "ManagedFinalizer", {
      ...finished,
      phase: "Finalizing",
    }),
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
  return ticket.spawned === ticket.record.length + ticket.tasks.size;
}

/** The same over a whole core: a fixture accounts for all of its ids or none of them. */
export function accountsForAll(core: Core): boolean {
  return [...core.tickets.values()].every(accountsFor);
}
