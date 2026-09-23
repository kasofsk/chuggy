/**
 * Hand-built tickets and cores, for the shapes the golden corpus does not
 * happen to reach.
 *
 * EVERY FIXTURE BUILT FROM THESE IS A SHAPE THE MACHINE COULD HAVE REACHED,
 * and `accountsFor` is what a suite asserts that with. `spawned` is bumped only
 * by a spawn, so a fixture that hands itself a work cycle or an instance while
 * leaving the fresh ticket's zero in place is a state no trace holds.
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
import {
  anAcceptedSource,
  defaultPlan,
  evaluatorTaskOf,
  releasedTicketOf,
} from "../../src/domain/config.ts";
import type {
  TicketGraph,
  EvaluationInput,
  EvaluationInstance,
  EvaluationVerdict,
  FailureKind,
  StageDefinition,
  TaskIdentity,
  TaskObligation,
  TaskTerminalReport,
  Ticket,
  ValidatedTaskResult,
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
  producedResultRef,
  taskRefOf,
} from "../../src/domain/ticket.ts";
import { workTaskOf } from "../../src/domain/task.ts";

/** The evaluator an obligation names, which is what a fixture answers by. */
function evaluatorOf(task: TaskIdentity): number {
  if (task.type !== "EvaluationTask")
    throw new Error("fixtures: an obligation is an evaluation task");
  return task.value.evaluator;
}

/**
 * The obligation a task identity implies, under the conventions every fixture
 * here builds by: a released definition minted from the ticket's own id, an
 * evaluator's definition minted from its key, a work task asked under its own
 * cycle, and a judgement asked under the reference the cycle it judges
 * reported. Derived rather than passed so a caller states the task and nothing
 * about the record it is held against.
 */
export function obligationFor(task: TaskIdentity): TaskObligation {
  if (task.type === "WorkTask")
    return {
      task,
      definition: releasedTicketOf(task.value.ticket, new Set(), [])
        .workConfiguration,
      contextRef: task.value.cycle,
    };
  return {
    task,
    definition: evaluatorTaskOf(task.value.evaluator),
    contextRef: workResultOf(task.value.ticket, task.value.workCycle),
  };
}

/** What the work cycle `cycle` of ticket `ticket` reported, at fixture scope. */
export function workResultOf(ticket: number, cycle: number): number {
  return producedResultRef(workTaskOf(ticket, cycle));
}

/** The result a task produced, at the obligation it was spawned under. */
export function resultFor(task: TaskIdentity): ValidatedTaskResult {
  return {
    obligation: obligationFor(task),
    resultRef: producedResultRef(task),
  };
}

/** An instance's input: what the cycle reported, at the source it was accepted at. */
function inputFor(ticket: number, cycle: number): EvaluationInput {
  return {
    ticket,
    workResult: workResultOf(ticket, cycle),
    acceptedSourceRef: anAcceptedSource,
  };
}

/** One evaluator's answer, carried at the obligation the running stage owes it. */
function answer(
  instance: EvaluationInstance,
  obligation: TaskObligation,
  verdict: EvaluationVerdict,
): EvaluationInstance {
  return applyProduced(
    instance,
    obligation.task,
    { obligation, resultRef: evaluatorOf(obligation.task) },
    verdict,
  );
}

/**
 * A judgement of one work cycle, driven through the protocol until it settles:
 * every evaluator answers with what `verdictFor` says, so a fixture states
 * which dissenter it wants and nothing about the shape that results.
 */
export function judgedInstance(
  ticket: number,
  cycle: number,
  stages: readonly StageDefinition[],
  verdictFor: (evaluator: number) => EvaluationVerdict = () => "EvaluatorPass",
): EvaluationInstance {
  let instance = begin(cycle, inputFor(ticket, cycle), { stages });
  for (let owed = currentTaskObligations(instance); owed.length > 0;) {
    const obligation = owed[0];
    if (obligation === undefined) break;
    instance = answer(
      instance,
      obligation,
      verdictFor(evaluatorOf(obligation.task)),
    );
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
  stages: readonly StageDefinition[],
  answered: ReadonlySet<number>,
): EvaluationInstance {
  let instance = begin(cycle, inputFor(ticket, cycle), { stages });
  for (const obligation of currentTaskObligations(instance)) {
    if (answered.has(evaluatorOf(obligation.task)))
      instance = answer(instance, obligation, "EvaluatorPass");
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
  stages: readonly StageDefinition[],
  stopped: ReadonlySet<number>,
): EvaluationInstance {
  let instance = begin(cycle, inputFor(ticket, cycle), { stages });
  for (let owed = currentTaskObligations(instance); owed.length > 0;) {
    const obligation = owed[0];
    if (obligation === undefined) break;
    const evaluator = evaluatorOf(obligation.task);
    instance = stopped.has(evaluator)
      ? applyFailure(
          instance,
          obligation.task,
          "ExecutionUnavailableFailure",
          evaluator,
        )
      : answer(instance, obligation, "EvaluatorPass");
    owed = currentTaskObligations(instance);
  }
  return instance;
}

/** How many evaluators a plan's first stage lists, which is what one run of it claims. */
export function rosterOf(stages: readonly StageDefinition[]): number {
  return stages[0]?.evaluators.length ?? 0;
}

/** A ticket id, so a fixture reads the way the model's numbering does. */
export const id = (value: number): TicketId => asTicketId(value);

/** A release's dependency draw, in the shape the release carries it: the model's set. */
export const depsOf = (...values: number[]): ReadonlySet<TicketId> =>
  new Set(values.map(id));

/** What a work task comes back with when it produced its artifact, at the source it was accepted at. */
export const producedReport = (task: TaskIdentity): TaskTerminalReport => ({
  type: "WorkResultReport",
  value: { result: resultFor(task), acceptedSourceRef: anAcceptedSource },
});

/** What an evaluator comes back with, carrying the verdict it reached. */
export const judgedReport = (
  task: TaskIdentity,
  verdict: EvaluationVerdict,
): TaskTerminalReport => ({
  type: "EvaluationResultReport",
  value: { result: resultFor(task), verdict },
});

/**
 * The same report a task would send, carried at the obligation named rather
 * than the one it owes: what a fabric answering for a spawn that was never made
 * puts on the wire, and the only thing that tells the two apart is the rule
 * that weighs the whole obligation.
 */
export const carriedAt = (
  task: TaskIdentity,
  obligation: TaskObligation,
): TaskTerminalReport =>
  task.type === "WorkTask"
    ? {
        type: "WorkResultReport",
        value: {
          result: { obligation, resultRef: producedResultRef(task) },
          acceptedSourceRef: anAcceptedSource,
        },
      }
    : {
        type: "EvaluationResultReport",
        value: {
          result: { obligation, resultRef: producedResultRef(task) },
          verdict: "EvaluatorPass",
        },
      };

/** What a task comes back with when it stopped instead of answering. */
export const stoppedReport = (
  task: TaskIdentity,
  kind: FailureKind,
): TaskTerminalReport => ({
  type: "TerminalFailureReport",
  value: { failure: { task, evidence: taskRefOf(task) }, kind },
});

/**
 * What a task of either kind comes back with when its execution settled at
 * `verdict`, which is the pairing `submit_task_completion` builds from a row.
 */
export const reportedAt = (
  task: TaskIdentity,
  verdict: "Pass" | "Fail",
): TaskTerminalReport => {
  if (task.type === "EvaluationTask")
    return judgedReport(
      task,
      verdict === "Pass" ? "EvaluatorPass" : "EvaluatorFail",
    );
  return verdict === "Pass"
    ? producedReport(task)
    : stoppedReport(task, "ProcessFailure");
};

/**
 * What a fixture may override on a ticket: every field of the record, plus the
 * two halves of the released definition a fixture varies — the ids it waits on
 * and the stages it is judged by — so a caller states those and nothing about
 * the rest of what the release froze.
 */
export type TicketOverrides = Partial<Ticket> & {
  readonly dependencies?: ReadonlySet<number>;
  readonly stages?: readonly StageDefinition[];
};

/** A ticket as a release leaves it, with whatever the caller overrides. */
export function ticketOn(
  config: Config,
  overrides: TicketOverrides = {},
): Ticket {
  const { dependencies, stages, ...rest } = overrides;
  const born = freshTicket(
    releasedTicketOf(
      1,
      dependencies ?? new Set<number>(),
      stages ?? defaultPlan(config),
    ),
  );
  return { ...born, ...rest };
}

/**
 * A graph holding these tickets under dense ids from one, in the order given.
 * The release names the ticket inside the record it froze, so the id the map
 * assigns is written there too: a fixture that stated one and was filed under
 * another is a state no release could have produced.
 */
export function graphOf(tickets: readonly Ticket[]): TicketGraph {
  const map = new Map<TicketId, Ticket>();
  tickets.forEach((ticket, index) => {
    const ticketId = id(index + 1);
    map.set(ticketId, {
      ...ticket,
      definition: { ...ticket.definition, id: ticketId },
    });
  });
  return { tickets: map };
}

/**
 * The view of a state no decision has reached. The previous TicketGraph is the empty
 * fleet, which is exactly what the model's two ghosts hold after `init`.
 */
export function initialView(post: TicketGraph): StepView {
  return { pre: graphOf([]), last: "NoDecision", post };
}

/**
 * A fleet in mid-flight: one ticket completed, one working behind it, and one
 * running its finalizer. Every safety invariant is green on it, so a defect
 * below is one edit away from a state that passes.
 */
export function healthyFleet(config: Config): readonly Ticket[] {
  const stages = defaultPlan(config);
  const finished = (ticket: number): Partial<Ticket> => ({
    evaluations: [judgedInstance(ticket, 1, stages)],
    workCyclesStarted: 1,
    spawned: 1 + rosterOf(stages),
    source: anAcceptedSource,
  });
  return [
    ticketOn(config, {
      ...finished(1),
      phase: "Done",
      completions: 1,
    }),
    ticketOn(config, {
      phase: "Work",
      dependencies: new Set([1]),
      source: anAcceptedSource,
      workCyclesStarted: 1,
      spawned: 1,
    }),
    ticketOn(config, {
      ...finished(3),
      phase: "Finalization",
      finalizationGeneration: 1,
    }),
  ];
}

/** A fleet with one ticket replaced, which is how each defect stays a single edit. */
export function fleetBut(
  fleet: readonly Ticket[],
  index: number,
  overrides: TicketOverrides,
): TicketGraph {
  const { dependencies, stages, ...rest } = overrides;
  return graphOf(
    fleet.map((ticket, at) =>
      at === index
        ? {
            ...ticket,
            ...rest,
            definition: {
              ...ticket.definition,
              ...(dependencies === undefined ? {} : { dependencies }),
              ...(stages === undefined ? {} : { evaluationPlan: { stages } }),
            },
          }
        : ticket,
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
