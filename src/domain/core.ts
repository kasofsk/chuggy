/**
 * Reading and replacing one ticket in the observed state, and what a decision
 * returns about itself.
 *
 * `Core` is the model's record around the ticket map rather than the bare map,
 * for the reason the model keeps it: the ticket source stays open, and
 * releases grow the map's sparse id domain without any decider needing
 * surgery.
 *
 * The map is iterated in ascending id order everywhere, never in insertion
 * order. JavaScript's insertion order is stable, which is exactly why relying
 * on it would pass every test until the day a ticket map was rebuilt from a
 * different source — and ids are sparse, so insertion order is not id order.
 */

import type { Core, StepRecord, Ticket } from "./generated/modelTypes.ts";
import { asTicketId, type TicketId } from "./ids.ts";

/** What a pure decider returns: the record performed, and the state after it. */
export interface Decision {
  readonly rec: StepRecord;
  readonly post: Core;
}

/** The record the model's `init` writes: what is observed at a state no decision has reached. */
export const initRecord: StepRecord = {
  label: "init",
  transitions: [],
  effects: [],
};

/** The ticket ids of a core, ascending. Every fold over the fleet reads this. */
export function ticketIds(core: Core): readonly TicketId[] {
  return [...core.tickets.keys()].sort((a, b) => a - b).map(asTicketId);
}

/** Reads a ticket, failing loudly where the model would fail its own lookup. */
export function ticketAt(core: Core, id: TicketId): Ticket {
  const found = core.tickets.get(id);
  if (found === undefined) {
    throw new Error(
      `core: no ticket ${String(id)}; a decider was called on a state that refuses it`,
    );
  }
  return found;
}

/** A core with one ticket replaced, leaving every other entry alone. */
export function withTicket(core: Core, id: TicketId, ticket: Ticket): Core {
  const tickets = new Map(core.tickets);
  tickets.set(id, ticket);
  return { tickets };
}

/** The live tickets: everything the map holds, which is every ticket ever released. */
export function liveTickets(core: Core): readonly TicketId[] {
  return ticketIds(core);
}
