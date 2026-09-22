/**
 * The derived sets the safety invariants are stated over: the visibility edges
 * and the two walks that guard each other.
 *
 * THE BOUNDED SWEEP IS THE TERMINATION ARGUMENT, NOT AN IMPLEMENTATION
 * DETAIL. Each of these is a fixpoint computed by repeating a monotone step
 * over the whole fleet, and the repeat count is the fleet's own size — which
 * is the whole of the argument that a monotone fixpoint over a finite lattice
 * terminates, and is house rule 9's explicit bound rather than a loop that
 * happens to stop. `model/domain.qnt` keeps that shape over the cheaper single
 * fold deliberately, and says so at `visEdges`: the relation is downward-only
 * today, so one ascending pass would already reach the closure, and keeping
 * the sweep is what lets a future edge kind point upward with no rewrite. An
 * implementer who reads a summary writes the fold and silently drops that.
 *
 * ITERATION ORDER IS EXPLICIT EVERYWHERE HERE. Every pass reads `liveTickets`,
 * which sorts, rather than inheriting a map's insertion order — stable in
 * JavaScript, which is exactly why relying on it would pass every test until
 * the day a ticket map was rebuilt from a different source.
 */

import { liveTickets, ticketAt } from "./ticketGraph.ts";
import type { TicketGraph } from "./generated/modelTypes.ts";
import type { TicketId } from "./ids.ts";
import { hasOpenHumanTask } from "./ticket.ts";

/** The walk's edge relation: the dependency edges, and only those. */
export function visEdges(
  graph: TicketGraph,
  id: TicketId,
): readonly TicketId[] {
  return [...ticketAt(graph, id).definition.dependencies].sort(
    (a, b) => a - b,
  ) as TicketId[];
}

/** Whether a ticket belongs to the set being swept, given what the pass before it admitted. */
export type SweepStep = (
  graph: TicketGraph,
  id: TicketId,
  admitted: ReadonlySet<TicketId>,
) => boolean;

/**
 * Repeats `step` over the fleet as many times as the fleet holds tickets, each
 * pass reading only what the pass before it admitted. The repeat count is the
 * bound, and the bound is the construction.
 */
export function sweep(
  graph: TicketGraph,
  step: SweepStep,
): ReadonlySet<TicketId> {
  const ids = liveTickets(graph);
  let admitted: ReadonlySet<TicketId> = new Set<TicketId>();
  for (let pass = 0; pass < ids.length; pass++) {
    const next = new Set<TicketId>();
    for (const id of ids) if (step(graph, id, admitted)) next.add(id);
    admitted = next;
  }
  return admitted;
}

/**
 * Tickets that cannot move without a human: parked, or Pending behind a chain
 * containing one. A healthy-Blocked ticket is deliberately not stuck — it
 * sits flat while what it waits on runs, and progresses vicariously.
 */
export function stuckSet(graph: TicketGraph): ReadonlySet<TicketId> {
  return sweep(graph, (c, id, stuck) => {
    const phase = ticketAt(c, id).phase;
    return (
      phase === "Escalated" ||
      (phase === "Pending" && visEdges(c, id).some((d) => stuck.has(d)))
    );
  });
}

/**
 * Tickets reachable from an open desk task by walking the same edges. Coverage
 * propagates through every phase, over the edge relation `stuckSet` walks, so
 * the containment between them is structural per pass.
 */
export function coveredSet(graph: TicketGraph): ReadonlySet<TicketId> {
  return sweep(
    graph,
    (c, id, covered) =>
      hasOpenHumanTask(ticketAt(c, id)) ||
      visEdges(c, id).some((d) => covered.has(d)),
  );
}

/** Containment, which is how the two walks are compared against each other. */
export function subsetOf(
  left: ReadonlySet<TicketId>,
  right: ReadonlySet<TicketId>,
): boolean {
  return [...left].every((id) => right.has(id));
}
