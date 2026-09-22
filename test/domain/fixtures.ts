/**
 * Hand-built tickets and cores, for the shapes the golden corpus does not
 * happen to reach.
 *
 * EVERY FIXTURE BUILT FROM THESE IS A SHAPE THE MACHINE COULD HAVE REACHED,
 * and `accountsFor` is what a suite asserts that with. `spawned` is bumped only
 * by a spawn, so a fixture that hands itself a task set or an instance while
 * leaving the fresh ticket's zero in place is a state no trace holds — and the
 * work reduce reads that counter to stamp the artifact it produced, so a short
 * one answers a question the machine would answer differently.
 *
 * AN INSTANCE IS BUILT BY THE PROTOCOL, never written out. A judgement's shape
 * is the protocol's own invariant, and a literal that satisfies it today is a
 * literal nobody rechecks; driving `begin` and `applyProduced` cannot produce
 * a state the machine could not.
 *
 * The builders go through `freshTicket` rather than writing a ticket literal,
 * so a field added to the record reaches every fixture at once.
 */

import type { Config } from "../../src/domain/config.ts";
import { defaultProgram } from "../../src/domain/config.ts";
import { initRecord } from "../../src/domain/ticketGraph.ts";
import type {
  TicketGraph,
  EvaluationInstance,
  EvaluationVerdict,
  FailureKind,
  StageDefinition,
  Task,
  TaskIdentity,
  TaskOutcome,
  TaskTerminalReport,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { freshTicket } from "../../src/domain/deciders.ts";
import {
  applyFailure,
  applyProduced,
  begin,
  currentTaskObligations,
} from "../../src/domain/evaluation.ts";
import { asTicketId, type TicketId } from "../../src/domain/ids.ts";
import type { StepView } from "../../src/domain/invariants.ts";
import {
  evaluationSpawnTotal,
  taskRefOf,
  taskResultRefOf,
} from "../../src/domain/ticket.ts";
import {
  evaluationTaskOf,
  tsResolved,
  tsOutstanding,
  workTaskOf,
} from "../../src/domain/task.ts";

/** The evaluator an obligation names, which is what a fixture answers by. */
function evaluatorOf(task: TaskIdentity): number {
  if (task.type !== "EvaluationTask")
    throw new Error("fixtures: an obligation is an evaluation task");
  return task.value.evaluator;
}

/**
 * A judgement of one work cycle, driven through the protocol until it settles:
 * every evaluator answers with what `verdictFor` says, so a fixture states
 * which dissenter it wants and nothing about the shape that results.
 */
export function judgedInstance(
  ticket: number,
  cycle: number,
  workResult: number,
  program: readonly StageDefinition[],
  verdictFor: (evaluator: number) => EvaluationVerdict = () => "EvaluatorPass",
): EvaluationInstance {
  let instance = begin(cycle, { ticket, workResult }, { stages: program });
  for (let owed = currentTaskObligations(instance); owed.length > 0;) {
    const task = owed[0];
    if (task === undefined) break;
    const evaluator = evaluatorOf(task);
    instance = applyProduced(instance, task, evaluator, verdictFor(evaluator));
    owed = currentTaskObligations(instance);
  }
  return instance;
}

/**
 * A judgement in flight: the named evaluators of the first stage have passed
 * and the rest still owe, which is the state a completion is enabled at.
 */
export function runningInstance(
  ticket: number,
  cycle: number,
  workResult: number,
  program: readonly StageDefinition[],
  answered: ReadonlySet<number>,
): EvaluationInstance {
  let instance = begin(cycle, { ticket, workResult }, { stages: program });
  for (const task of currentTaskObligations(instance)) {
    const evaluator = evaluatorOf(task);
    if (answered.has(evaluator))
      instance = applyProduced(instance, task, evaluator, "EvaluatorPass");
  }
  return instance;
}

/**
 * The same, with infrastructure stopping the named evaluators of the lowest
 * stage: it settles blocked, which is the state the desk's own wall mirrors.
 */
export function blockedInstance(
  ticket: number,
  cycle: number,
  workResult: number,
  program: readonly StageDefinition[],
  stopped: ReadonlySet<number>,
): EvaluationInstance {
  let instance = begin(cycle, { ticket, workResult }, { stages: program });
  for (let owed = currentTaskObligations(instance); owed.length > 0;) {
    const task = owed[0];
    if (task === undefined) break;
    const evaluator = evaluatorOf(task);
    instance = stopped.has(evaluator)
      ? applyFailure(instance, task, "ExecutionUnavailableFailure", evaluator)
      : applyProduced(instance, task, evaluator, "EvaluatorPass");
    owed = currentTaskObligations(instance);
  }
  return instance;
}

/** How many evaluators a program's first stage lists, which is what one run of it claims. */
export function rosterOf(program: readonly StageDefinition[]): number {
  return program[0]?.evaluators.length ?? 0;
}

/** A ticket id, so a fixture reads the way the model's numbering does. */
export const id = (value: number): TicketId => asTicketId(value);

/** A release's dependency draw, in the shape the release carries it: the model's set. */
export const depsOf = (...values: number[]): ReadonlySet<TicketId> =>
  new Set(values.map(id));

/** A resolved work task of `ticket`'s cycle. */
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

/** What a work task comes back with when it produced its artifact. */
export const producedReport = (task: TaskIdentity): TaskTerminalReport => ({
  type: "WorkResultReport",
  value: { result: taskResultRefOf(task) },
});

/** What an evaluator comes back with, carrying the verdict it reached. */
export const judgedReport = (
  task: TaskIdentity,
  verdict: EvaluationVerdict,
): TaskTerminalReport => ({
  type: "EvaluationResultReport",
  value: { result: taskResultRefOf(task), verdict },
});

/** What a task comes back with when it stopped instead of answering. */
export const stoppedReport = (
  task: TaskIdentity,
  kind: FailureKind,
): TaskTerminalReport => ({
  type: "TerminalFailureReport",
  value: { evidence: taskRefOf(task), kind },
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
  const program = defaultProgram(config);
  const finished = (ticket: number): Partial<Ticket> => {
    const judged = judgedInstance(ticket, 1, 1, program);
    return {
      evaluations: [judged],
      workCyclesStarted: 1,
      spawned: 1 + rosterOf(program),
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
 * The model's `idsAccounted` for one ticket: the mint counter is one slot per
 * work cycle started, plus what every run of every instance claimed.
 */
export function accountsFor(ticket: Ticket): boolean {
  return (
    ticket.spawned === ticket.workCyclesStarted + evaluationSpawnTotal(ticket)
  );
}

/** The same over a whole graph: a fixture accounts for all of its ids or none of them. */
export function accountsForAll(graph: TicketGraph): boolean {
  return [...graph.tickets.values()].every(accountsFor);
}
