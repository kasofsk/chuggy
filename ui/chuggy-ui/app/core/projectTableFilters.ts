/**
 * What a chosen filter, order and search are on the wire, in the cache, to the
 * fold and on the screen.
 *
 * Each is a decision about one filter and none of them touches a browser,
 * so they are proved beside the accumulation they parametrise rather than
 * written into the component that calls them: a filter asking the wire for the
 * wrong phases, or two filters sharing one cache entry, looks exactly like a
 * screen that works until the day it does not.
 */

import { nativeHttpPageItemsMax } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { phaseRoster } from "../../../../src/contract/rosters.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import type { ProjectPage } from "./apiRoutes.ts";
import { projectListReread } from "./projectQueryKeys.ts";
import type { ProjectList } from "./projectQueryKeys.ts";
import {
  projectTicketRowsFolded,
  projectTicketRowsLive,
} from "./projectTicketPages.ts";
import type {
  ProjectTicketRows,
  ProjectTicketRowsNext,
} from "./projectTicketPages.ts";

export const ticketFilterAll = "All";

/** The standings of the Pending phase a filter can name. The wire names
 * phases only, so a filter naming one reads Pending and the list narrows what
 * it read to the rows that stand in it. */
export const ticketFilterStandings = ["Ready", "Blocked"] as const;

export type TicketFilterStanding = (typeof ticketFilterStandings)[number];

/** Every ticket, the tickets in one phase, or the Pending tickets of one
 * standing. */
export type TicketFilter =
  TicketPhase | TicketFilterStanding | typeof ticketFilterAll;

/** The filter a word names, or undefined where it names none. */
export function ticketFilterOf(word: unknown): TicketFilter | undefined {
  if (word === ticketFilterAll) return ticketFilterAll;
  return (
    ticketFilterStandings.find((standing) => standing === word) ??
    phaseRoster.find((phase) => phase === word)
  );
}

/** Whether a filter names a standing rather than a phase or All. */
export function ticketFilterIsStanding(
  filter: TicketFilter,
): filter is TicketFilterStanding {
  return ticketFilterStandings.some((standing) => standing === filter);
}

/** The standing a filter narrows the rows read to, where it names one. */
export function ticketFilterStandingOf(
  filter: TicketFilter,
): TicketFilterStanding | undefined {
  return ticketFilterIsStanding(filter) ? filter : undefined;
}

/** What the wire is asked under a filter, which for a standing is its phase. */
export function ticketFilterRead(
  filter: TicketFilter,
): TicketPhase | typeof ticketFilterAll {
  return ticketFilterIsStanding(filter) ? "Pending" : filter;
}

/** Undefined rather than every phase, because a read that names them all is a
 * read the route would answer the same way with a longer query. */
export function ticketFilterPhases(
  filter: TicketFilter,
): readonly TicketPhase[] | undefined {
  const read = ticketFilterRead(filter);
  return read === ticketFilterAll ? undefined : [read];
}

/** The order a list is read in: by last activity, or by ticket number from either end. */
export type TicketListOrder = "RecentActivity" | "Newest" | "Oldest";

/** What the list asks the wire for: the filter's phases, the order its sort reads in, and the search and the creator, where there is one. */
export interface TicketListAsk {
  readonly filter: TicketFilter;
  readonly order: TicketListOrder;
  readonly search: string | undefined;
  /** The principal of the member whose tickets alone the list holds. */
  readonly creator?: string | undefined;
}

/** The list a reader who has chosen nothing is drawn, which a ticket reference and a mention read too. */
export const ticketListAskDefault: TicketListAsk = {
  filter: ticketFilterAll,
  order: "RecentActivity",
  search: undefined,
};

/** Whether the list is the active one: no search, no creator, by recent activity, kept live by folding frames. */
function ticketListAskActive(ask: TicketListAsk): boolean {
  return (
    ask.search === undefined &&
    ask.creator === undefined &&
    ask.order === "RecentActivity"
  );
}

/**
 * One entry per read, order, search and creator, since a shared entry would
 * let one's page walk answer another's; the filters reading one phase share
 * its entry. The active list folds a frame in, within the phases its filter
 * admits, and reads again for a ticket it has not got; a list under a search,
 * a creator or an order by number is read again on a ticket's frame, because whether the ticket
 * belongs to it, and where, is the server's to say; every one folds an
 * execution's frame into its ticket's row.
 */
export function ticketFilterList(
  partition: PartitionIdentity,
  ask: TicketListAsk,
): ProjectList<ProjectTicketRows> {
  const name = `table:${ticketFilterRead(ask.filter)}:${ask.order}:${JSON.stringify([ask.search ?? null, ask.creator ?? null])}`;
  if (!ticketListAskActive(ask))
    return projectTicketRowsLive(
      projectListReread<ProjectTicketRows>(partition, "Ticket", name),
    );
  return projectTicketRowsFolded(
    partition,
    name,
    ticketFilterPhases(ask.filter),
  );
}

/**
 * The reads the list is drawn from, in order: any list but the active one is a
 * single read. The active list is what is neither Done nor Revoked or finished
 * lately, and then, where the filter admits a finished phase, what finished
 * before that by recency, a row both hold being drawn once.
 */
function ticketFilterReads(ask: TicketListAsk): readonly ProjectPage[] {
  const phases = ticketFilterPhases(ask.filter);
  const asked: ProjectPage = {
    order: ask.order,
    limit: nativeHttpPageItemsMax,
    ...(phases === undefined ? {} : { phase: phases }),
    ...(ask.creator === undefined ? {} : { creator: ask.creator }),
  };
  if (ask.search !== undefined) return [{ ...asked, q: ask.search }];
  if (!ticketListAskActive(ask)) return [asked];
  const finished = (phases ?? phaseRoster).filter(
    (phase) => phase === "Done" || phase === "Revoked",
  );
  return [
    { ...asked, active: true },
    ...(finished.length === 0 ? [] : [{ ...asked, phase: finished }]),
  ];
}

/** How many reads the list is drawn from. */
export function ticketFilterReadsCount(ask: TicketListAsk): number {
  return ticketFilterReads(ask).length;
}

/** The page size is asked for rather than left to the route's default, so the
 * row cap the accumulation holds is a bound this console can actually reach. */
export function ticketFilterPage(
  ask: TicketListAsk,
  next: ProjectTicketRowsNext,
): ProjectPage {
  const read = ticketFilterReads(ask)[next.read];
  if (read === undefined)
    throw new RangeError(`the ticket list has no read ${String(next.read)}`);
  return next.cursor === undefined ? read : { ...read, cursor: next.cursor };
}

/** Whether a read says the project holds no ticket at all, which only the
 * unfiltered list can say, and only once nothing further is left to read. */
export function ticketFilterProjectEmpty(
  ask: TicketListAsk,
  rows: ProjectTicketRows,
): boolean {
  return (
    ask.filter === ticketFilterAll &&
    ask.search === undefined &&
    ask.creator === undefined &&
    rows.tickets.length === 0 &&
    rows.next === undefined &&
    rows.failure === undefined
  );
}
