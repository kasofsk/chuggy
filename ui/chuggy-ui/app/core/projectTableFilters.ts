/**
 * Which sections a chosen filter draws.
 *
 * A FILTER IS A VIEW AND NOT A SECOND READ. `GET /ticket-machine/tickets`
 * answers the whole project in one body with no cursor and no phase query, so
 * every filter is drawn from the one entry the table already holds. That is
 * why nothing here builds a request or a cache key, and why choosing a filter
 * cannot fail, empty the table or lose a row the reader had.
 */

import { ticketSectionRoster, ticketSectionTitles } from "./ticketSections.ts";
import type { TicketSection } from "./ticketSections.ts";

export const ticketFilterAll = "All";

export type TicketFilter = TicketSection | typeof ticketFilterAll;

export const ticketFilterRoster: readonly TicketFilter[] = [
  ticketFilterAll,
  ...ticketSectionRoster,
];

/** Every section under `All`, and the one the filter names otherwise, so the
 * sections a screen draws are this list and never a branch of its own. */
export function ticketFilterSections(
  filter: TicketFilter,
): readonly TicketSection[] {
  return filter === ticketFilterAll ? ticketSectionRoster : [filter];
}

export function ticketFilterTitle(filter: TicketFilter): string {
  return filter === ticketFilterAll ? "all" : ticketSectionTitles[filter];
}
