/**
 * Reading and replacing one ticket in the observed state.
 *
 * `TicketGraph` is the model's record around the ticket map rather than the bare map,
 * for the reason the model keeps it: the ticket source stays open, and
 * releases grow the map's sparse id domain without any decider needing
 * surgery.
 *
 * The map is iterated in ascending id order everywhere, never in insertion
 * order. JavaScript's insertion order is stable, which is exactly why relying
 * on it would pass every test until the day a ticket map was rebuilt from a
 * different source — and ids are sparse, so insertion order is not id order.
 */

import type { TicketGraph, Ticket } from "./generated/modelTypes.ts";
import { asTicketId, type TicketId } from "./ids.ts";

/** The ticket ids of a graph, ascending. Every fold over the fleet reads this. */
export function ticketIds(graph: TicketGraph): readonly TicketId[] {
  return [...graph.tickets.keys()].sort((a, b) => a - b).map(asTicketId);
}

/** Reads a ticket, failing loudly where the model would fail its own lookup. */
export function ticketAt(graph: TicketGraph, id: TicketId): Ticket {
  const found = graph.tickets.get(id);
  if (found === undefined) {
    throw new Error(
      `graph: no ticket ${String(id)}; a decider was called on a state that refuses it`,
    );
  }
  return found;
}

/** A graph with one ticket replaced, leaving every other entry alone. */
export function withTicket(
  graph: TicketGraph,
  id: TicketId,
  ticket: Ticket,
): TicketGraph {
  const tickets = new Map(graph.tickets);
  tickets.set(id, ticket);
  return { tickets };
}

/** The live tickets: everything the map holds, which is every ticket ever released. */
export function liveTickets(graph: TicketGraph): readonly TicketId[] {
  return ticketIds(graph);
}
