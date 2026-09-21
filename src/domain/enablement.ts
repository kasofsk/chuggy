/**
 * What the machine will accept, as pure predicates over an observed `TicketGraph`.
 *
 * EVERY GUARD IS STATED ONCE AND REFERENCED. The model hoisted these out of
 * its actions for a reason worth repeating here: a guard copied into a second
 * caller drifts silently, and the copy keeps claiming the machine accepts a
 * step the machine now refuses. So the replay checker, the deciders' callers
 * and the suites all read these, and none restates one.
 *
 * They are parameterised by a `TicketGraph` rather than reading ambient state,
 * because the journaled actor must re-check enablement at a REPLAYED prefix
 * state — a value, not a live variable.
 */

import { isValidProgram, ticketIdUniverse, type Config } from "./config.ts";
import { ticketAt, ticketIds } from "./ticketGraph.ts";
import type {
  ArtifactMark,
  TicketGraph,
  FinalizationOutcome,
  StageDefinition,
} from "./generated/modelTypes.ts";
import { hasOpenHumanTask } from "./ticket.ts";
import type { TicketId } from "./ids.ts";
import { outstandingCount } from "./task.ts";

/** Anything not settled and not past the point of no return. */
export function revocableIn(graph: TicketGraph, id: TicketId): boolean {
  const phase = ticketAt(graph, id).phase;
  return !["Done", "Revoked", "Finalization"].includes(phase);
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
  return ticketAt(graph, id).deps;
}

/**
 * What this ticket's dependencies produced. Derived, never stored, and stable:
 * every dep is Done before a dependent can dispatch, and Done is absorbing, so
 * nothing here can change under a reader.
 */
export function depArtifacts(
  graph: TicketGraph,
  id: TicketId,
): readonly ArtifactMark[] {
  return [...waitsOn(graph, id)]
    .sort((a, b) => a - b)
    .map((d) => ticketAt(graph, d as TicketId).artifact);
}

export function depsDoneIn(graph: TicketGraph, id: TicketId): boolean {
  return [...waitsOn(graph, id)].every(
    (k) => ticketAt(graph, k as TicketId).phase === "Done",
  );
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
 * What a release may depend on: anything not revoked. A revoked ticket never
 * reaches Done, so depending on one is authoring a ticket that can never run.
 */
export function dependableIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((k) => ticketAt(graph, k).phase !== "Revoked");
}

export function revocablesIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => revocableIn(graph, j));
}

export function readiesIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => isReadyIn(graph, j));
}

/** The two phases that hold a live task set, and so may take a completion. */
export function taskPhaseIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => {
    const phase = ticketAt(graph, j).phase;
    return phase === "Work" || phase === "Evaluation";
  });
}

export function reducibleWorkIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => {
    const ticket = ticketAt(graph, j);
    return ticket.phase === "Work" && outstandingCount(ticket.tasks) === 0;
  });
}

export function reducibleEvalIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => {
    const ticket = ticketAt(graph, j);
    return (
      ticket.phase === "Evaluation" && outstandingCount(ticket.tasks) === 0
    );
  });
}

export function doneIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => ticketAt(graph, j).phase === "Done");
}

export function retryablesIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter((j) => retryableIn(graph, j));
}

/** The derived waiting room: released, with every dependency Done. */
export function isReadyIn(graph: TicketGraph, id: TicketId): boolean {
  return ticketAt(graph, id).phase === "Pending" && depsDoneIn(graph, id);
}

export function isBlockedIn(graph: TicketGraph, id: TicketId): boolean {
  return ticketAt(graph, id).phase === "Pending" && !depsDoneIn(graph, id);
}

/** The phase that holds the finalizer obligation, and so may take its result. */
export function finalizableIn(graph: TicketGraph, id: TicketId): boolean {
  return graph.tickets.has(id) && ticketAt(graph, id).phase === "Finalization";
}

export function finalizationOutcomeEnabled(
  graph: TicketGraph,
  id: TicketId,
  outcome: FinalizationOutcome,
): boolean {
  const phase = ticketAt(graph, id).phase;
  switch (outcome) {
    case "FinalizationSucceeded":
    case "FinalizationNeedsWork":
    case "FinalizationResultUnavailable":
      return phase === "Finalization";
  }
}

/** Every result the finalizer service may report. */
export const finalizationOutcomes: readonly FinalizationOutcome[] = [
  "FinalizationSucceeded",
  "FinalizationNeedsWork",
  "FinalizationResultUnavailable",
];

/** Whether a live task of this ticket is still outstanding under the named id. */
export function outstandingTaskIn(
  graph: TicketGraph,
  id: TicketId,
  taskId: number,
): boolean {
  return [...ticketAt(graph, id).tasks].some(
    (t) => t.id === taskId && t.state === "Outstanding",
  );
}

/** Every value a release must draw from a universe, which is its program alone. */
export function releasableAuthoring(
  config: Config,
  authoring: { readonly prog: readonly StageDefinition[] },
): boolean {
  return isValidProgram(config, authoring.prog);
}

/** The ids a release may still claim, which is what makes a fleet quiet or not. */
export function releasableIdsIn(
  config: Config,
  graph: TicketGraph,
): readonly TicketId[] {
  if (graph.tickets.size >= config.nTickets) return [];
  return ticketIdUniverse(config).filter((j) => !graph.tickets.has(j));
}

/** Tickets running their finalizer, which is the phase a result may be reported for. */
export function finalizingIn(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph).filter(
    (j) => ticketAt(graph, j).phase === "Finalization",
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
    ticketIds(graph).every((j) => {
      const phase = ticketAt(graph, j).phase;
      return phase === "Done" || phase === "Revoked";
    })
  );
}

/** The task ids of this ticket the fabric could still report on. */
export function outstandingTaskIdsIn(
  graph: TicketGraph,
  id: TicketId,
): readonly number[] {
  return [...ticketAt(graph, id).tasks]
    .filter((t) => t.state === "Outstanding")
    .map((t) => t.id)
    .sort((a, b) => a - b);
}
