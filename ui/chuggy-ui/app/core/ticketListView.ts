/**
 * Which of a filter's rows the ticket list draws, in what order, and what each
 * row's state chip says.
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
 * WHAT FINISHED A WHILE AGO IS HELD BACK. A Done or Revoked row whose last
 * activity is older than a day is not drawn until the reader asks for more, a
 * page at a time and newest first, so the list opens on what is live; a search
 * reaches into what is held back the same way.
 */

import type { TicketPhase } from "../../../../src/contract/rosters.ts";

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

/** The sort a stored word names, State where it names none. */
export function ticketListSortOf(stored: string | null): TicketListSort {
  return ticketListSorts.find((sort) => sort === stored) ?? "State";
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

/** How long a finished row stays drawn without asking for it. */
export const ticketListRecentMs = 86_400_000;

/** How many held-back rows one "Show more" draws. */
export const ticketListOlderPage = 20;

function ticketListFinished(phase: TicketPhase): boolean {
  return phase === "Done" || phase === "Revoked";
}

function ticketListRecent(row: ProjectTableRow, nowMs: number): boolean {
  if (!ticketListFinished(row.phase)) return true;
  const at = Date.parse(row.activityAt);
  return at >= nowMs - ticketListRecentMs;
}

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

function ticketListSorted(
  rows: readonly ProjectTableRow[],
  sort: TicketListSort,
): readonly ProjectTableRow[] {
  switch (sort) {
    case "State":
      return ticketListByState(rows);
    case "Newest":
      return [...rows].sort((a, b) => b.ticket - a.ticket);
    case "Oldest":
      return [...rows].sort((a, b) => a.ticket - b.ticket);
    case "Activity":
      return [...rows].sort(ticketListByActivity);
  }
}

/** Whether a row's title, or its number, holds what was typed. */
function ticketListMatches(row: ProjectTableRow, search: string): boolean {
  const typed = search.trim().toLocaleLowerCase();
  if (typed === "") return true;
  const number = typed.replace(/^#/u, "");
  return (
    (row.title ?? "").toLocaleLowerCase().includes(typed) ||
    String(row.ticket) === number
  );
}

export interface TicketListShown {
  /** The rows to draw, in order. */
  readonly shown: readonly ProjectTableRow[];
  /** How many rows the read holds that are not held back. */
  readonly active: number;
  /** How many matching rows are still held back. */
  readonly remaining: number;
}

export function ticketListShown(
  rows: readonly ProjectTableRow[],
  view: {
    readonly sort: TicketListSort;
    readonly search: string;
    readonly older: number;
    readonly nowMs: number;
  },
): TicketListShown {
  const matching = rows.filter((row) => ticketListMatches(row, view.search));
  const held = matching
    .filter((row) => !ticketListRecent(row, view.nowMs))
    .sort(ticketListByActivity);
  const revealed = new Set(held.slice(0, Math.max(0, view.older)));
  return {
    shown: ticketListSorted(
      matching.filter(
        (row) => ticketListRecent(row, view.nowMs) || revealed.has(row),
      ),
      view.sort,
    ),
    active: rows.filter((row) => ticketListRecent(row, view.nowMs)).length,
    remaining: held.length - revealed.size,
  };
}
