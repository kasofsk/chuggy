/**
 * The draw sets: which commands the environment sends, as pure predicates
 * over an observed `TicketGraph`. `decide` (`src/domain/deciders.ts`) is what
 * accepts or refuses a command; these say only where the machine's actions,
 * the actor's harness and the walks draw from, and each is the model's own
 * form of the same name (`model/domain.qnt`). The release room is the one
 * bound here `decide` does not refuse over: it is the deployment's `nTickets`,
 * not the package's, and the writer refuses a release outside it before
 * `decide` is asked.
 *
 * They are parameterised by a `TicketGraph` rather than reading ambient state,
 * because a draw is taken at a state the caller holds — a value, not a live
 * variable.
 */

import {
  aDispatchSource,
  aFinalizationEvidence,
  defaultPlan,
  releasedTicketOf,
  revisedTicketOf,
  ticketIdUniverse,
  type Config,
} from "./config.ts";
import { ticketAt, ticketIds } from "./ticketGraph.ts";
import type {
  ArtifactMark,
  ReleasedTicket,
  StageDefinition,
  TaskIdentity,
  TaskTerminalReport,
  Ticket,
  TicketCommand,
  TicketGraph,
} from "./generated/modelTypes.ts";
import {
  artifactOf,
  attemptGeneration,
  dependenciesComplete,
  hasOpenHumanTask,
  instanceTasks,
  isReady,
  ledgerInstances,
  liveTasks,
  taskRefOf,
} from "./ticket.ts";
import { decide, unaskedDisposition } from "./deciders.ts";
import type { TicketId } from "./ids.ts";
import { isPending, isTerminal, phaseOf, revocationAllowed } from "./phase.ts";
import { workTaskIdentity } from "./task.ts";
import { ledgerAt, type Ledgers } from "./ledger.ts";

/** Anything not settled and not past the point of no return. */
export function revocableIn(graph: TicketGraph, id: TicketId): boolean {
  return revocationAllowed(ticketAt(graph, id).state);
}

/**
 * A parked ticket. Every wall the sum can hold resumes somewhere (`resumeOf`
 * is total), so there is no stamp left to hold this to beyond the desk task.
 */
export function retryableIn(graph: TicketGraph, id: TicketId): boolean {
  return hasOpenHumanTask(ticketAt(graph, id));
}

/** What this ticket waits on before it may run — the single definition every reader shares. */
export function waitsOn(graph: TicketGraph, id: TicketId): ReadonlySet<number> {
  return ticketAt(graph, id).definition.dependencies;
}

/**
 * What this ticket's dependencies produced. Derived, never stored, and stable:
 * every dep is Done before a dependent can dispatch, and Done is absorbing, so
 * nothing here can change under a reader.
 */
export function depArtifacts(
  graph: TicketGraph,
  ledgers: Ledgers,
  id: TicketId,
): readonly ArtifactMark[] {
  return [...waitsOn(graph, id)]
    .sort((a, b) => a - b)
    .map((d) =>
      artifactOf(ticketAt(graph, d as TicketId), ledgerAt(ledgers, d)),
    );
}

export function depsDoneIn(graph: TicketGraph, id: TicketId): boolean {
  return dependenciesComplete(graph, ticketAt(graph, id));
}

/**
 * May this id be claimed? The fleet has room, the id is one the universe
 * offers, and nothing holds it — including a ticket long since settled, since
 * an id is never reused.
 */
export function canReleaseIn(
  config: Config,
  graph: TicketGraph,
  id: TicketId,
): boolean {
  return (
    graph.tickets.size < config.nTickets &&
    ticketIdUniverse(config).includes(id) &&
    !graph.tickets.has(id)
  );
}

/**
 * What a release draws its dependencies from: anything not revoked.
 * `decideCreate` refuses no dependency that exists, but a revoked ticket
 * never reaches Done, so the author the machine models never writes a ticket
 * that can never run.
 */
export function dependableIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((k) => ticketAt(graph, k).state !== "Revoked");
}

/** Tickets an update may be drawn for: the Pending ones. */
export function revisablesIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => isPending(ticketAt(graph, j).state));
}

/**
 * The update an author sends for a ticket: its next revision, written against
 * the revision it holds, keeping its dependencies, over the plan the author
 * drew.
 */
export function updateOf(
  ticket: Ticket,
  stages: readonly StageDefinition[],
): TicketCommand {
  const id = ticket.definition.id;
  return {
    type: "UpdateTicket",
    value: {
      ticket: id,
      expectedRevision: ticket.revision,
      definition: revisedTicketOf(
        id,
        ticket.revision + 1,
        ticket.definition.dependencies,
        stages,
      ),
    },
  };
}

export function revocablesIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => revocableIn(graph, j));
}

export function readiesIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => isReady(graph, j));
}

/** Tickets the fabric is currently running a task for, which is who a completion can be delivered to. */
export function completableIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter(
    (j) => liveTasks(ticketAt(graph, j)).length > 0,
  );
}

export function doneIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => ticketAt(graph, j).state === "Done");
}

export function retryablesIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => retryableIn(graph, j));
}

/** The derived waiting room's other half: Pending behind a dependency not yet Done. */
export function isBlockedIn(graph: TicketGraph, id: TicketId): boolean {
  return isPending(ticketAt(graph, id).state) && !depsDoneIn(graph, id);
}

/** The ids a release may still claim, which is what makes a fleet quiet or not. */
export function releasableIdsIn(
  config: Config,
  graph: TicketGraph,
): readonly TicketId[] {
  if (graph.tickets.size >= config.nTickets) return [];
  return ticketIdUniverse(config).filter((j) => !graph.tickets.has(j));
}

/** Tickets running their finalizer, which is who a finalizer's result is drawn for. */
export function finalizingIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter(
    (j) => phaseOf(ticketAt(graph, j).state) === "Finalization",
  );
}

/**
 * A fleet nothing can move: no id left to release, and every ticket settled at
 * a terminal. It is the stutter's guard, so a run that reaches it records that
 * it did rather than deadlocking.
 */
export function quietIn(config: Config, graph: TicketGraph): boolean {
  return (
    releasableIdsIn(config, graph).length === 0 &&
    ticketIds(graph).every((j) => isTerminal(ticketAt(graph, j).state))
  );
}

/**
 * The tasks of this ticket the fabric could still report on: the work cycle's
 * one task, or the obligations the running stage owes, in the roster's order.
 */
export function outstandingTasksIn(
  graph: TicketGraph,
  id: TicketId,
): readonly TaskIdentity[] {
  return liveTasks(ticketAt(graph, id));
}

/**
 * Every task identity this ticket has ever been owed: one work task per cycle
 * it started, and every evaluator of every run its instances hold. A superset
 * of the live set, which is the point: a report about a settled task is built
 * from here to show `decide` refuses it.
 */
export function deliverableTasksIn(
  graph: TicketGraph,
  ledgers: Ledgers,
  id: TicketId,
): readonly TaskIdentity[] {
  const ticket = ticketAt(graph, id);
  const work = Array.from({ length: ticket.workCyclesStarted }, (_, index) =>
    workTaskIdentity(id, index + 1),
  );
  return [
    ...work,
    ...ledgerInstances(ticket, ledgerAt(ledgers, id)).flatMap(instanceTasks),
  ];
}

/** A process failure for a task of ticket `id`, at the evidence the suites derive for it. */
export function failureReportOf(
  id: number,
  task: TaskIdentity,
): TaskTerminalReport {
  return {
    type: "TerminalFailureReport",
    value: {
      ticket: id,
      failure: { task, evidence: taskRefOf(task) },
      kind: "ProcessFailure",
    },
  };
}

/** A finalizer's success for ticket `id`'s attempt (`workCycle`, `generation`). */
export function finalizationReportOf(
  id: number,
  workCycle: number,
  generation: number,
): TicketCommand {
  return {
    type: "ReportFinalizationResult",
    value: {
      ticket: id,
      workCycle,
      generation,
      result: { type: "FinalizationSucceeded", value: aFinalizationEvidence },
    },
  };
}

/** An id the instance can name that is not `id`: the universe holds 1 and 2 whenever it holds a ticket. */
export function otherIdOf(id: number): number {
  return id === 1 ? 2 : 1;
}

/**
 * The updates an environment may send out of turn for ticket `id` (the
 * model's `updateProbesIn`): one at a revision the ticket is not at (the one
 * before it where there is one), one whose definition names another ticket,
 * and one that changes the dependencies — each wrong in that one way only —
 * and, for an id not released, the first revision.
 */
export function updateProbesIn(
  config: Config,
  graph: TicketGraph,
  id: TicketId,
): readonly TicketCommand[] {
  const plan = defaultPlan(config);
  const ticket = graph.tickets.get(id);
  if (ticket === undefined) {
    const definition = releasedTicketOf(id, new Set(), plan);
    return [
      {
        type: "UpdateTicket",
        value: { ticket: id, expectedRevision: 1, definition },
      },
    ];
  }
  const dependencies = ticket.definition.dependencies;
  const next = ticket.revision + 1;
  const stale = ticket.revision > 1 ? ticket.revision - 1 : next;
  const changed: ReadonlySet<number> =
    dependencies.size === 0 ? new Set([otherIdOf(id)]) : new Set();
  const update = (
    expectedRevision: number,
    definition: ReleasedTicket,
  ): TicketCommand => ({
    type: "UpdateTicket",
    value: { ticket: id, expectedRevision, definition },
  });
  return [
    update(stale, revisedTicketOf(id, next, dependencies, plan)),
    update(
      ticket.revision,
      revisedTicketOf(otherIdOf(id), next, dependencies, plan),
    ),
    update(ticket.revision, revisedTicketOf(id, next, changed, plan)),
  ];
}

/**
 * The commands an environment may send out of turn (the model's
 * `commandProbesIn`, in its order): for every id the instance can name, a
 * create that collides, names itself or names what does not exist, the
 * updates `updateProbesIn` names, and a dispatch, a revoke and a resume; a failure for every task a ticket has ever
 * been owed, and for the first work task of an id not released; and a
 * finalizer's result for the attempt a ticket is on, the generation before it
 * and the cycle before it. Every one is well-formed, so which of them `decide`
 * refuses is the ticket's state and nothing else.
 */
export function commandProbesIn(
  config: Config,
  graph: TicketGraph,
  ledgers: Ledgers,
): readonly TicketCommand[] {
  const universe = ticketIdUniverse(config);
  const live = ticketIds(graph);
  const absent = universe.filter((j) => !graph.tickets.has(j));
  const plan = defaultPlan(config);
  const perId = universe.flatMap((j): TicketCommand[] => [
    { type: "CreateTicket", value: releasedTicketOf(j, new Set(), plan) },
    { type: "CreateTicket", value: releasedTicketOf(j, new Set([j]), plan) },
    {
      type: "CreateTicket",
      value: releasedTicketOf(j, new Set(absent.filter((k) => k !== j)), plan),
    },
    { type: "DispatchTicket", value: { ticket: j, source: aDispatchSource } },
    { type: "RevokeTicket", value: j },
    { type: "ResumeTicket", value: j },
    ...updateProbesIn(config, graph, j),
  ]);
  const reports = [
    ...live.flatMap((j) =>
      deliverableTasksIn(graph, ledgers, j).map((task) =>
        failureReportOf(j, task),
      ),
    ),
    ...absent.map((j) => failureReportOf(j, workTaskIdentity(j, 1))),
  ].map((report): TicketCommand => ({
    type: "ReportTaskTerminal",
    value: report,
  }));
  const finalizations = [
    ...live.flatMap((j) => {
      const ticket = ticketAt(graph, j);
      const cycle = Math.max(1, ticket.workCyclesStarted);
      const generation = Math.max(1, attemptGeneration(ticket));
      return [
        finalizationReportOf(j, cycle, generation),
        ...(generation > 1
          ? [finalizationReportOf(j, cycle, generation - 1)]
          : []),
        ...(cycle > 1 ? [finalizationReportOf(j, cycle - 1, generation)] : []),
      ];
    }),
    ...absent.map((j) => finalizationReportOf(j, 1, 1)),
  ];
  return [...perId, ...reports, ...finalizations];
}

/** The probes `decide` refuses in this graph. No refusal asks the policy, so any one will do. */
export function refusedCommandsIn(
  config: Config,
  graph: TicketGraph,
  ledgers: Ledgers,
): readonly TicketCommand[] {
  return commandProbesIn(config, graph, ledgers).filter(
    (command) =>
      decide(graph, command, () => unaskedDisposition).type === "TicketRefused",
  );
}
