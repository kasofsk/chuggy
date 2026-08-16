/**
 * The machine's observed state, and what one decision records about itself.
 *
 * `Core` is a record around the ticket map rather than the bare map, which is
 * the shape the model keeps for the same reason: the ticket source stays open,
 * and arrivals grow the map's dense, never-reused id domain without any
 * decider needing surgery.
 *
 * The map is iterated in ascending id order everywhere, never in insertion
 * order. JavaScript's insertion order is stable, which is exactly why relying
 * on it would pass every test until the day a ticket map was rebuilt from a
 * different source.
 */

import type { Effect } from "./effect.ts";
import type { TicketId } from "./ids.ts";
import type { Phase } from "./phase.ts";
import type { Ticket } from "./ticket.ts";
import { woNone, type WrapUpObs } from "./wrapUp.ts";

/** The observed state, as the pure deciders see it. */
export interface Core {
  readonly tickets: ReadonlyMap<TicketId, Ticket>;
}

/** One observed phase transition. `from === to` is a real row: the stage advance is one. */
export interface Transition {
  readonly ticket: TicketId;
  readonly from: Phase;
  readonly to: Phase;
}

/** One decision's observable record, which a golden trace carries verbatim. */
export interface StepRecord {
  readonly label: string;
  readonly transitions: readonly Transition[];
  readonly effects: readonly Effect[];
  readonly attempt: WrapUpObs;
}

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
  attempt: woNone,
};

/** The ticket ids of a core, ascending. Every fold over the fleet reads this. */
export function ticketIds(core: Core): readonly TicketId[] {
  return [...core.tickets.keys()].sort((a, b) => a - b);
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

/** The live tickets: everything the map holds, which is every ticket ever arrived. */
export function liveTickets(core: Core): readonly TicketId[] {
  return ticketIds(core);
}
