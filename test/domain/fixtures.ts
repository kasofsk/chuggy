/**
 * Hand-built tickets and cores, for the shapes the golden corpus does not
 * happen to reach.
 *
 * EVERY FIXTURE BUILT FROM THESE IS A SHAPE THE MACHINE COULD HAVE REACHED,
 * and `accountsFor` is what a suite asserts that with. A ledger's `spawned` is
 * bumped only by a spawn, so `ledgerFor` derives it from the ticket and the
 * instances it closed rather than taking the fresh ledger's zero.
 *
 * AN INSTANCE IS BUILT BY THE PROTOCOL, never written out. A judgement's shape
 * is the protocol's own invariant, and a literal that satisfies it today is a
 * literal nobody rechecks; driving `begin` and `applyProduced` cannot produce
 * a state the machine could not.
 *
 * The builders go through `bornTicket` rather than writing a ticket literal,
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
  SuccessfulTicketDecision,
  TaskIdentity,
  TaskObligation,
  TaskTerminalReport,
  Ticket,
  TicketDecision,
  TicketLedger,
  TicketState,
  ValidatedTaskResult,
} from "../../src/domain/generated/modelTypes.ts";
import {
  applyFailure,
  applyProduced,
  begin,
  currentTaskObligations,
} from "../../src/domain/evaluation.ts";
import { asTicketId, type TicketId } from "../../src/domain/ids.ts";
import type { StepView } from "../../src/domain/invariants.ts";
import { genesisLedgers, type Ledgers } from "../../src/domain/ledger.ts";
import {
  emptyLedger,
  evaluationSpawnTotal,
  initialWorkInput,
  ledgerInstances,
  producedResultRef,
  taskRefOf,
} from "../../src/domain/ticket.ts";
import { taskOwner, workTaskIdentity } from "../../src/domain/task.ts";

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
  return producedResultRef(workTaskIdentity(ticket, cycle));
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
 * and the rest still owe, which is the state a completion is accepted at.
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

/** The accepted decision, which a refusal would mean the fixture is wrong about. */
export function acceptedOf(decision: TicketDecision): SuccessfulTicketDecision {
  if (decision.type === "TicketRefused")
    throw new Error(
      `refused ${decision.value.type} where a decision was expected`,
    );
  return decision.value;
}

/** A ticket id, so a fixture reads the way the model's numbering does. */
export const id = (value: number): TicketId => asTicketId(value);

/** A release's dependency draw, in the shape the release carries it: the model's set. */
export const depsOf = (...values: number[]): ReadonlySet<TicketId> =>
  new Set(values.map(id));

/** What a work task comes back with when it produced its artifact, at the source it was accepted at. */
export const producedReport = (task: TaskIdentity): TaskTerminalReport => ({
  type: "WorkResultReport",
  value: {
    ticket: taskOwner(task),
    result: resultFor(task),
    acceptedSourceRef: anAcceptedSource,
  },
});

/** What an evaluator comes back with, carrying the verdict it reached. */
export const judgedReport = (
  task: TaskIdentity,
  verdict: EvaluationVerdict,
): TaskTerminalReport => ({
  type: "EvaluationResultReport",
  value: { ticket: taskOwner(task), result: resultFor(task), verdict },
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
          ticket: taskOwner(task),
          result: { obligation, resultRef: producedResultRef(task) },
          acceptedSourceRef: anAcceptedSource,
        },
      }
    : {
        type: "EvaluationResultReport",
        value: {
          ticket: taskOwner(task),
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
  value: {
    ticket: taskOwner(task),
    failure: { task, evidence: taskRefOf(task) },
    kind,
  },
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

/** A ticket as the package's `decideCreate` releases one. */
function bornTicket(definition: Ticket["definition"]): Ticket {
  return { definition, revision: 1, workCyclesStarted: 0, state: "Pending" };
}

/** A ticket as a release leaves it, with whatever the caller overrides. */
export function ticketOn(
  config: Config,
  overrides: TicketOverrides = {},
): Ticket {
  const { dependencies, stages, ...rest } = overrides;
  const born = bornTicket(
    releasedTicketOf(
      1,
      dependencies ?? new Set<number>(),
      stages ?? defaultPlan(config),
    ),
  );
  return { ...born, ...rest };
}

/** A work cycle running from the released content, at the source it was dispatched or accepted at. */
export function workState(
  ticket: Ticket,
  source: number = anAcceptedSource,
): TicketState {
  return {
    type: "Work",
    value: { input: initialWorkInput(ticket.definition), source },
  };
}

/** The work wall a failed cycle parks on, resuming from the released content. */
export function workEscalatedState(ticket: Ticket, evidence = 1): TicketState {
  return {
    type: "Escalated",
    value: {
      type: "WorkFailureEscalated",
      value: {
        resumeInput: initialWorkInput(ticket.definition),
        source: anAcceptedSource,
        evidence,
      },
    },
  };
}

/** The finalization a passed judgement opens, at the generation named. */
export function finalizationState(
  instance: EvaluationInstance,
  generation = 1,
): TicketState {
  return {
    type: "Finalization",
    value: {
      workCycle: instance.workCycle,
      generation,
      input: instance.input.workResult,
      source: instance.input.acceptedSourceRef,
    },
  };
}

/** A judgement the ticket holds open. */
export function evaluationState(instance: EvaluationInstance): TicketState {
  return { type: "Evaluation", value: instance };
}

/**
 * A ticket's ledger as the fold would have kept it: the instances it closed,
 * the one completion a Done ticket recorded, and every slot its cycles and
 * runs claimed — with whatever the caller overrides on top.
 */
export function ledgerFor(
  ticket: Ticket,
  overrides: Partial<TicketLedger> = {},
): TicketLedger {
  const closedEvaluations =
    overrides.closedEvaluations ?? emptyLedger.closedEvaluations;
  const spawned =
    ticket.workCyclesStarted +
    evaluationSpawnTotal(
      ledgerInstances(ticket, { ...emptyLedger, closedEvaluations }),
    );
  return {
    closedEvaluations,
    spawned,
    completions: ticket.state === "Done" ? 1 : 0,
    ...overrides,
  };
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
 * Every ticket's ledger as `ledgerFor` derives it, with the overrides given
 * for any ticket by its id.
 */
export function ledgersOf(
  graph: TicketGraph,
  overrides: ReadonlyMap<number, Partial<TicketLedger>> = new Map(),
): Ledgers {
  return new Map(
    [...graph.tickets].map(([ticketId, ticket]) => [
      ticketId,
      ledgerFor(ticket, overrides.get(ticketId)),
    ]),
  );
}

/**
 * The view of a state no decision has reached. The previous graph and ledgers
 * are empty, which is exactly what the model's ghosts hold after `init`.
 */
export function initialView(
  post: TicketGraph,
  postLedgers: Ledgers = ledgersOf(post),
): StepView {
  return {
    pre: graphOf([]),
    preLedgers: genesisLedgers,
    last: "NoDecision",
    post,
    postLedgers,
  };
}

/** A graph and its ledgers, which is what one state of the machine is. */
export interface World {
  readonly graph: TicketGraph;
  readonly ledgers: Ledgers;
}

/** A fleet: tickets in id order, and the ledger overrides each carries. */
export interface Fleet {
  readonly tickets: readonly Ticket[];
  readonly closed: readonly (readonly EvaluationInstance[])[];
}

/** The fleet as one state. */
export function worldOf(fleet: Fleet): World {
  const graph = graphOf(fleet.tickets);
  return {
    graph,
    ledgers: ledgersOf(
      graph,
      new Map(
        fleet.closed.map((closedEvaluations, at) => [
          at + 1,
          { closedEvaluations },
        ]),
      ),
    ),
  };
}

/**
 * A fleet in mid-flight: one ticket completed, one working behind it, and one
 * running its finalizer. Every safety invariant is green on it, so a defect
 * below is one edit away from a state that passes.
 */
export function healthyFleet(config: Config): Fleet {
  const stages = defaultPlan(config);
  const done = judgedInstance(1, 1, stages);
  const finalizing = judgedInstance(3, 1, stages);
  const working = ticketOn(config, {
    dependencies: new Set([1]),
    workCyclesStarted: 1,
  });
  return {
    tickets: [
      ticketOn(config, { workCyclesStarted: 1, state: "Done" }),
      { ...working, state: workState(working) },
      ticketOn(config, {
        workCyclesStarted: 1,
        state: finalizationState(finalizing),
      }),
    ],
    closed: [[done], [], [finalizing]],
  };
}

/**
 * A fleet with one ticket replaced, and optionally its ledger, which is how
 * each defect stays a single edit.
 */
export function fleetBut(
  fleet: Fleet,
  index: number,
  overrides: TicketOverrides,
  ledger: Partial<TicketLedger> = {},
): World {
  const { dependencies, stages, ...rest } = overrides;
  const tickets = fleet.tickets.map((ticket, at) =>
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
  );
  const graph = graphOf(tickets);
  const kept = worldOf({ tickets, closed: fleet.closed }).ledgers;
  const target = id(index + 1);
  const ticket = graph.tickets.get(target);
  const base = kept.get(target);
  if (ticket === undefined || base === undefined)
    throw new Error("fixtures: fleetBut indexes outside the fleet");
  return {
    graph,
    ledgers: new Map([
      ...kept,
      [
        target,
        ledgerFor(ticket, {
          closedEvaluations: base.closedEvaluations,
          ...ledger,
        }),
      ],
    ]),
  };
}

/**
 * The model's `idsAccounted` for one ticket: the mint counter is one slot per
 * work cycle started, plus what every run of every instance claimed.
 */
export function accountsFor(ticket: Ticket, ledger: TicketLedger): boolean {
  return (
    ledger.spawned ===
    ticket.workCyclesStarted +
      evaluationSpawnTotal(ledgerInstances(ticket, ledger))
  );
}

/** The same over a whole state: a fixture accounts for all of its ids or none of them. */
export function accountsForAll(world: World): boolean {
  return [...world.graph.tickets].every(([ticketId, ticket]) => {
    const ledger = world.ledgers.get(ticketId);
    return ledger !== undefined && accountsFor(ticket, ledger);
  });
}
