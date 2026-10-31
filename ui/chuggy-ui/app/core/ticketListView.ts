/**
 * The order the ticket list draws the rows it read in, what each row's state
 * chip says, and what of the list the page's address holds.
 *
 * A PENDING TICKET IS READY OR BLOCKED, which is the one thing a reader scanning
 * the list needs from it: whether anything stands between it and a dispatch.
 * Blocked is any dependency still open or revoked, read off the row itself.
 *
 * THE STATE ORDER IS THE READER'S QUESTIONS: what needs a human, what is moving
 * and how near it is to landing, what can start, what waits, and then what
 * finished. Pending rows are ordered nearest to dispatchable first by
 * `upNextOrdered`, so the ready ones lead them.
 *
 * THE SEARCH AND THE ORDER BY NUMBER ARE THE SERVER'S. They are asked of the
 * read, so what they draw is the project's rather than the rows one page held.
 * The State and Activity sorts order the rows read and state nothing about the
 * project: they read the active list, which holds every active row.
 */

import { ticketSearchCharsMax } from "../../../../src/contract/http.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import type { TicketListOrder } from "./projectTableFilters.ts";
import type { ProjectTableRow } from "./projectTableRows.ts";
import { upNextOrdered } from "./upNextOrder.ts";

export const ticketListSorts = [
  "State",
  "Newest",
  "Oldest",
  "Activity",
] as const;
export type TicketListSort = (typeof ticketListSorts)[number];

export const ticketListSortTitles: Readonly<Record<TicketListSort, string>> = {
  State: "State",
  Newest: "Newest first",
  Oldest: "Oldest first",
  Activity: "Last activity",
};

/** The sort a word names, State where it names none. */
export function ticketListSortOf(word: unknown): TicketListSort {
  return ticketListSorts.find((sort) => sort === word) ?? "State";
}

/** The order a sort reads the list in; State and Activity order what the active list holds. */
export function ticketListSortOrder(sort: TicketListSort): TicketListOrder {
  return sort === "Newest" || sort === "Oldest" ? sort : "RecentActivity";
}

/** How long typing must stand before the list is read under it. */
export const ticketListSearchWaitMs = 250;

/** What a reader typed, as the read is asked it: trimmed, cut to the server's
 * bound, and nothing where nothing is left. */
export function ticketListSearchOf(typed: string): string | undefined {
  const search = [...typed.trim()]
    .slice(0, ticketSearchCharsMax)
    .join("")
    .trim();
  return search === "" ? undefined : search;
}

/** What of the list the page's address holds, so a link carries the view and a reload keeps it. */
export interface TicketListQuery {
  readonly q?: string;
  readonly sort?: TicketListSort;
}

/** The address with its search or its sort replaced; State, being the sort
 * an address naming none is drawn in, is written as none. */
export function ticketListQueryWith(
  query: TicketListQuery,
  change:
    { readonly q: string | undefined } | { readonly sort: TicketListSort },
): TicketListQuery {
  const q = "q" in change ? change.q : query.q;
  const sort = "sort" in change ? change.sort : query.sort;
  return {
    ...(q === undefined ? {} : { q }),
    ...(sort === undefined || sort === "State" ? {} : { sort }),
  };
}

/** The view an address names. The router parses each value as JSON, so a
 * search written by hand as `?q=121`, `?q=true` or `?q=null` arrives as
 * something other than text, and is read back as the text it was. */
export function ticketListQueryOf(
  search: Readonly<Record<string, unknown>>,
): TicketListQuery {
  const typed = search["q"];
  const q =
    typeof typed === "string" ||
    typeof typed === "number" ||
    typeof typed === "boolean" ||
    typed === null
      ? ticketListSearchOf(String(typed))
      : undefined;
  const sort = ticketListSorts.find((each) => each === search["sort"]);
  return {
    ...(q === undefined ? {} : { q }),
    ...(sort === undefined ? {} : { sort }),
  };
}

/** What a row's chip says: its phase, a Pending one read as Ready or Blocked. */
export type TicketListStanding =
  Exclude<TicketPhase, "Pending"> | "Ready" | "Blocked";

export function ticketListStandingOf(
  row: Pick<
    ProjectTableRow,
    "phase" | "openDependencies" | "revokedDependencies"
  >,
): TicketListStanding {
  if (row.phase !== "Pending") return row.phase;
  return row.openDependencies.length === 0 &&
    row.revokedDependencies.length === 0
    ? "Ready"
    : "Blocked";
}

/** The phases in the order the State sort draws them. */
const ticketListPhaseOrder: readonly TicketPhase[] = [
  "Escalated",
  "Finalization",
  "Evaluation",
  "Work",
  "Pending",
  "Done",
  "Revoked",
];

function ticketListByActivity(a: ProjectTableRow, b: ProjectTableRow): number {
  return (
    Date.parse(b.activityAt) - Date.parse(a.activityAt) || b.ticket - a.ticket
  );
}

function ticketListByState(
  rows: readonly ProjectTableRow[],
): readonly ProjectTableRow[] {
  return ticketListPhaseOrder.flatMap((phase) => {
    const held = rows.filter((row) => row.phase === phase);
    return phase === "Pending"
      ? upNextOrdered([...held].sort(ticketListByActivity))
      : [...held].sort(ticketListByActivity);
  });
}

/** The rows to draw, in order: the orders by number are the read's own. */
export function ticketListShown(
  rows: readonly ProjectTableRow[],
  sort: TicketListSort,
): readonly ProjectTableRow[] {
  switch (sort) {
    case "State":
      return ticketListByState(rows);
    case "Activity":
      return [...rows].sort(ticketListByActivity);
    case "Newest":
    case "Oldest":
      return rows;
  }
}
