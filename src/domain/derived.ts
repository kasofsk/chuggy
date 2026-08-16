/**
 * The derived sets the safety invariants are stated over: the visibility
 * edges, the two walks that guard each other, the revocation closure, and the
 * upward fixpoint that says a ticket still has a route to Done.
 *
 * THE BOUNDED SWEEP IS THE TERMINATION ARGUMENT, NOT AN IMPLEMENTATION
 * DETAIL. Three of these are fixpoints computed by repeating a monotone step
 * over the whole fleet, and the repeat count is the fleet's own size — which
 * is the whole of the argument that a monotone fixpoint over a finite lattice
 * terminates, and is house rule 9's explicit bound rather than a loop that
 * happens to stop. `model/domain.qnt` keeps that shape over the cheaper single
 * fold deliberately, and says so at `visEdges`: the relation is downward-only
 * today, so one ascending pass would already reach the closure, and keeping
 * the sweep is what lets a future edge kind point upward with no rewrite. An
 * implementer who reads a summary writes the fold and silently drops that.
 *
 * `revokeDoomed` is the one that is NOT a sweep, and the model's fold says
 * which by consuming its index rather than discarding it: one ascending pass
 * decides each id after every id it depends on, which is sound because deps
 * point strictly downward and `depsAcyclic` is what makes that true.
 *
 * ITERATION ORDER IS EXPLICIT EVERYWHERE HERE. Every pass reads `liveTickets`,
 * which sorts, rather than inheriting a map's insertion order — stable in
 * JavaScript, which is exactly why relying on it would pass every test until
 * the day a ticket map was rebuilt from a different source.
 */

import { liveTickets, ticketAt, type Core } from "./core.ts";
import { waitsOn } from "./enablement.ts";
import type { TicketId } from "./ids.ts";
import { hasOpenHumanTask } from "./ticket.ts";

/** The walk's edge relation: the dependency edges, and only those. */
export function visEdges(core: Core, id: TicketId): readonly TicketId[] {
  return ticketAt(core, id).deps;
}

/** Whether a ticket belongs to the set being swept, given what the pass before it admitted. */
export type SweepStep = (
  core: Core,
  id: TicketId,
  admitted: ReadonlySet<TicketId>,
) => boolean;

/**
 * Repeats `step` over the fleet as many times as the fleet holds tickets, each
 * pass reading only what the pass before it admitted. The repeat count is the
 * bound, and the bound is the construction.
 */
export function sweep(core: Core, step: SweepStep): ReadonlySet<TicketId> {
  const ids = liveTickets(core);
  let admitted: ReadonlySet<TicketId> = new Set<TicketId>();
  for (let pass = 0; pass < ids.length; pass++) {
    const next = new Set<TicketId>();
    for (const id of ids) if (step(core, id, admitted)) next.add(id);
    admitted = next;
  }
  return admitted;
}

/**
 * Tickets whose own measure cannot descend without a human: parked, or Pending
 * behind a chain containing one. A healthy-Blocked ticket is deliberately not
 * stuck, because it progresses vicariously while its deps run.
 */
export function stuckSet(core: Core): ReadonlySet<TicketId> {
  return sweep(core, (c, id, stuck) => {
    const phase = ticketAt(c, id).phase;
    return (
      phase === "PEscalated" ||
      (phase === "PPending" && visEdges(c, id).some((d) => stuck.has(d)))
    );
  });
}

/**
 * Tickets reachable from an open desk task by walking the same edges. Coverage
 * propagates through every phase, over the edge relation `stuckSet` walks, so
 * the containment between them is structural per pass.
 */
export function coveredSet(core: Core): ReadonlySet<TicketId> {
  return sweep(
    core,
    (c, id, covered) =>
      hasOpenHumanTask(ticketAt(c, id)) ||
      visEdges(c, id).some((d) => covered.has(d)),
  );
}

/**
 * Tickets with a reachable route to Done, as a least fixpoint upward from the
 * terminal — the opposite direction from `stuckSet`, because a dependency
 * cycle has no base case and would never be reached growing outward from one.
 */
export function canFinishSet(core: Core): ReadonlySet<TicketId> {
  return sweep(core, (c, id, finishable) => {
    const phase = ticketAt(c, id).phase;
    return (
      phase === "PDone" ||
      (phase !== "PRevoked" && waitsOn(c, id).every((d) => finishable.has(d)))
    );
  });
}

/**
 * Tickets transitively doomed by a revocation: a revoked ticket anywhere in the
 * dependency closure means this one can never unblock. One ascending pass,
 * because deps point strictly downward.
 */
export function revokeDoomed(core: Core): ReadonlySet<TicketId> {
  const doomed = new Set<TicketId>();
  for (const id of liveTickets(core)) {
    const deps = ticketAt(core, id).deps;
    const behind = deps.some(
      (d) => ticketAt(core, d).phase === "PRevoked" || doomed.has(d),
    );
    if (behind) doomed.add(id);
  }
  return doomed;
}

/** Containment, which is how the two walks are compared against each other. */
export function subsetOf(
  left: ReadonlySet<TicketId>,
  right: ReadonlySet<TicketId>,
): boolean {
  return [...left].every((id) => right.has(id));
}
