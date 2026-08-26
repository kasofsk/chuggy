/**
 * What a chosen filter is on the wire, in the cache and to the fold.
 *
 * All four are decisions about one filter and none of them touches a browser,
 * so they are proved beside the accumulation they parametrise rather than
 * written into the component that calls them: a filter asking the wire for the
 * wrong phases, or two filters sharing one cache entry, looks exactly like a
 * screen that works until the day it does not.
 */

import { nativeHttpPageItemsMax } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import type { ProjectPage } from "./apiRoutes.ts";
import { projectListKey } from "./projectQueryKeys.ts";
import type { ProjectQueryKey } from "./projectQueryKeys.ts";
import { projectTicketRowsHaveMore } from "./projectTicketPages.ts";
import type { ProjectTicketRows } from "./projectTicketPages.ts";
import { ticketSectionPhases } from "./ticketSections.ts";
import type { TicketSection } from "./ticketSections.ts";

export const ticketFilterAll = "All";

export type TicketFilter = TicketSection | typeof ticketFilterAll;

/** Undefined rather than every phase, because a read that names them all is a
 * read the route would answer the same way with a longer query. */
export function ticketFilterPhases(
  filter: TicketFilter,
): readonly TicketPhase[] | undefined {
  return filter === ticketFilterAll ? undefined : ticketSectionPhases(filter);
}

/** One entry per filter: they hold different rows, and a shared entry would let
 * one filter's page walk answer another's. */
export function ticketFilterKey(
  partition: PartitionIdentity,
  filter: TicketFilter,
): ProjectQueryKey {
  return projectListKey(partition, "Ticket", `table:${filter}`);
}

/** The page size is asked for rather than left to the route's default, so the
 * row cap the accumulation holds is a bound this console can actually reach. */
export function ticketFilterPage(
  filter: TicketFilter,
  cursor: string | undefined,
): ProjectPage {
  const phases = ticketFilterPhases(filter);
  return {
    order: "RecentActivity",
    limit: nativeHttpPageItemsMax,
    ...(cursor === undefined ? {} : { cursor }),
    ...(phases === undefined ? {} : { phase: phases }),
  };
}

/** The cursor the next page is asked for with, and undefined when either bound
 * says there is no next page. */
export function ticketFilterMoreCursor(
  rows: ProjectTicketRows,
): string | undefined {
  return projectTicketRowsHaveMore(rows) ? rows.nextCursor : undefined;
}
