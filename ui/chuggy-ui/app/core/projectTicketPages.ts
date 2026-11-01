/**
 * The rows the project table holds, the pages they are read from, and what a
 * page, a live frame or a refused read does to them.
 *
 * The entry is the pages as read, each with where the read after it resumes,
 * and the rows are derived from them, so the pages a reader has asked for and
 * the frames that arrived since are one value and a fold does not have to
 * reach past the query it is registered on. A refetch reads the pages again
 * from the first, as many as the entry holds and no more.
 *
 * TWO BOUNDS, AND NEITHER IMPLIES THE OTHER. The page budget stops a server
 * that keeps answering with a cursor, and bites first when the pages are small.
 * The row cap is the browser's own and bites first when they are full: it is
 * how many rows this table will hold at once, and a reader who has paged past
 * it wants a filter rather than more rows. Deriving one from the other would
 * make whichever came second unreachable, and an unreachable bound is one
 * nothing can prove.
 *
 * A LIST MAY BE MORE THAN ONE READ, each paged to its end before the next
 * begins. A first page is drawn empty or not, so an empty active read says so;
 * a "Show more" reads past a page that adds no row, so a press draws a row
 * wherever one is left. A first page that drew nothing asks the reads after it
 * whether anything is left, and draws none of what they hold: a list with
 * nothing behind its button is a project with no ticket.
 */

import type { InfiniteData } from "@tanstack/query-core";

import {
  executionSummarySchema,
  ticketLatestExecutionSchema,
  ticketResponseSchema,
} from "../../../../src/contract/responses.ts";
import type {
  ProjectResponse,
  ProjectTicket,
  TicketLatestExecution,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import type { ApiResult } from "./apiRequest.ts";
import {
  projectListAlongside,
  projectListFoldedElseReread,
  projectListPagesEach,
} from "./projectQueryKeys.ts";
import type { ProjectList } from "./projectQueryKeys.ts";

export const projectTicketPagesMax = 20;
export const projectTicketRowsMax = 500;

/** Where the next page is read: which of the list's reads, from its start or from the cursor its last page answered. */
export interface ProjectTicketRowsNext {
  readonly read: number;
  readonly cursor: string | undefined;
}

/** Where a list's first page is read. */
export const projectTicketRowsFirst: ProjectTicketRowsNext = {
  read: 0,
  cursor: undefined,
};

/** What holds ticket rows: the rows drawn, or one page of them. */
interface ProjectTicketsHeld {
  readonly tickets: readonly ProjectTicket[];
}

/** One page as read, and where the read after it resumes. */
export interface ProjectTicketPage extends ProjectTicketsHeld {
  /** Undefined once every read has answered its last. */
  readonly next: ProjectTicketRowsNext | undefined;
  /** How many tickets the server says a search matched. */
  readonly matched: number | undefined;
}

/** The entry the rows are read under: every page read, and where each was read from. */
export type ProjectTicketPages = InfiniteData<
  ProjectTicketPage,
  ProjectTicketRowsNext
>;

export interface ProjectTicketRows extends ProjectTicketsHeld {
  /** Undefined before the first page and once every read has answered its last. */
  readonly next: ProjectTicketRowsNext | undefined;
  readonly pagesRead: number;
  /** How many tickets the server says a search matched, as the last page answered it. */
  readonly matched: number | undefined;
  /** Why a page could not be read, while the rows already read stand. */
  readonly failure: string | undefined;
}

export const projectTicketRowsEmpty: ProjectTicketRows = {
  tickets: [],
  next: undefined,
  pagesRead: 0,
  matched: undefined,
  failure: undefined,
};

/** The order the read gave, with a ticket already held kept where it is: a page
 * that repeats one must not draw it twice. */
function projectTicketRowsMerged(
  held: readonly ProjectTicket[],
  arriving: readonly ProjectTicket[],
): readonly ProjectTicket[] {
  const seen = new Set(held.map((ticket) => ticket.ticket));
  const merged = [...held];
  for (const ticket of arriving) {
    if (seen.has(ticket.ticket)) continue;
    if (merged.length >= projectTicketRowsMax) break;
    seen.add(ticket.ticket);
    merged.push(ticket);
  }
  return merged;
}

/** Where the read after `page` resumes: the same read where it named a cursor, else the start of the read after it, else nowhere. */
function projectTicketRowsNextAfter(
  read: number,
  page: ProjectResponse,
  reads: number,
): ProjectTicketRowsNext | undefined {
  if (page.nextCursor !== undefined) return { read, cursor: page.nextCursor };
  return read + 1 < reads ? { read: read + 1, cursor: undefined } : undefined;
}

/** `reads` is how many reads the list is drawn from, and `at` is where the page was read. */
export function projectTicketPageOf(
  at: ProjectTicketRowsNext,
  page: ProjectResponse,
  reads = 1,
): ProjectTicketPage {
  return {
    tickets: page.tickets,
    next: projectTicketRowsNextAfter(at.read, page, reads),
    matched: page.matched,
  };
}

/** The rows the pages draw, in the order they were read. */
export function projectTicketRowsOf(
  pages: ProjectTicketPages,
): ProjectTicketRows {
  let tickets: readonly ProjectTicket[] = [];
  for (const page of pages.pages)
    tickets = projectTicketRowsMerged(tickets, page.tickets);
  const last = pages.pages.at(-1);
  return {
    tickets,
    next: last?.next,
    pagesRead: pages.pages.length,
    matched: last?.matched,
    failure: undefined,
  };
}

export function projectTicketRowsHaveMore(rows: ProjectTicketRows): boolean {
  return (
    rows.next !== undefined &&
    rows.pagesRead < projectTicketPagesMax &&
    rows.tickets.length < projectTicketRowsMax
  );
}

/** Where the page after the pages is read, or undefined where a bound or the reads' end says none is. */
export function projectTicketPagesNext(
  pages: ProjectTicketPages,
): ProjectTicketRowsNext | undefined {
  const rows = projectTicketRowsOf(pages);
  return projectTicketRowsHaveMore(rows) ? rows.next : undefined;
}

/** Whether the last page carries no ticket the pages before it do not, which a press reads past. */
export function projectTicketPagesReadPast(pages: ProjectTicketPages): boolean {
  const last = pages.pages.at(-1);
  if (last === undefined) return false;
  const held = new Set(
    pages.pages
      .slice(0, -1)
      .flatMap((page) => page.tickets.map((ticket) => ticket.ticket)),
  );
  return !last.tickets.some((ticket) => !held.has(ticket.ticket));
}

type ProjectTicketPageRead = (
  cursor: string | undefined,
  read: number,
) => Promise<ApiResult<ProjectResponse>>;

/** `next` moved past each further read whose first page is empty and last,
 * so a list holding nothing offers a press only where a row is behind it. A
 * page that holds a row is left for that press to draw. */
async function projectTicketPageEnded(
  next: ProjectTicketRowsNext | undefined,
  readPage: ProjectTicketPageRead,
  reads: number,
): Promise<ProjectTicketRowsNext | undefined> {
  let held = next;
  for (let asked = 0; asked < reads; asked += 1) {
    if (held === undefined || held.cursor !== undefined) break;
    const answered = await readPage(undefined, held.read);
    if (answered.outcome !== "Ok") break;
    const page = answered.value;
    if (page.tickets.length > 0 || page.nextCursor !== undefined) break;
    held = projectTicketRowsNextAfter(held.read, page, reads);
  }
  return held;
}

/** One page, read where `at` says; the list's first page, where it draws
 * nothing, asks the reads after it whether anything is left. */
export async function projectTicketPageRead(
  readPage: ProjectTicketPageRead,
  at: ProjectTicketRowsNext,
  reads = 1,
): Promise<ApiResult<ProjectTicketPage>> {
  const answered = await readPage(at.cursor, at.read);
  if (answered.outcome !== "Ok") return answered;
  const page = projectTicketPageOf(at, answered.value, reads);
  const first = at.read === 0 && at.cursor === undefined;
  if (!first || page.tickets.length > 0) return { outcome: "Ok", value: page };
  return {
    outcome: "Ok",
    value: {
      ...page,
      next: await projectTicketPageEnded(page.next, readPage, reads),
    },
  };
}

function projectTicketRowsWithout<R extends ProjectTicketsHeld>(
  rows: R,
  ticket: number,
): R {
  return {
    ...rows,
    tickets: rows.tickets.filter((held) => held.ticket !== ticket),
  };
}

/** A ticket's frame carries no latest execution, so a row keeps the one it has. */
function projectTicketRowsWith<R extends ProjectTicketsHeld>(
  rows: R,
  arriving: TicketResponse,
): R {
  return {
    ...rows,
    tickets: rows.tickets.map((ticket) =>
      ticket.ticket !== arriving.ticket
        ? ticket
        : ticket.latestExecution === undefined
          ? arriving
          : { ...arriving, latestExecution: ticket.latestExecution },
    ),
  };
}

/**
 * A `Ticket` frame folded into the rows, or into one page of them: the
 * representation is the ticket read's own body, a null one is a tombstone, a
 * ticket the phases no longer admit leaves, and anything else leaves the rows
 * alone because a list that cannot read a frame is better stale than wrong. A
 * ticket the rows have not got is left to the read `projectTicketRowsRereads`
 * asks for.
 */
export function projectTicketRowsFold<R extends ProjectTicketsHeld>(
  previous: R | undefined,
  resource: string,
  representation: unknown,
  phases: readonly TicketPhase[] | undefined,
): R | undefined {
  if (previous === undefined) return previous;
  if (representation === null) {
    const gone = Number(resource);
    return Number.isInteger(gone)
      ? projectTicketRowsWithout(previous, gone)
      : previous;
  }
  const read = ticketResponseSchema.safeParse(representation);
  if (!read.success) return previous;
  const arriving = read.data;
  if (phases !== undefined && !phases.includes(arriving.phase))
    return projectTicketRowsWithout(previous, arriving.ticket);
  return projectTicketRowsWith(previous, arriving);
}

/**
 * Whether a `Ticket` frame brings in a ticket the phases admit and the rows
 * have not got, which the list reads again for: the frame carries no latest
 * execution, and the read answers the row with one.
 */
export function projectTicketRowsRereads(
  previous: ProjectTicketsHeld | undefined,
  representation: unknown,
  phases: readonly TicketPhase[] | undefined,
): boolean {
  const read = ticketResponseSchema.safeParse(representation);
  if (previous === undefined || !read.success) return false;
  const arriving = read.data;
  if (phases !== undefined && !phases.includes(arriving.phase)) return false;
  return !previous.tickets.some((held) => held.ticket === arriving.ticket);
}

/** The list of the rows within `phases`, kept live by `Ticket` and
 * `Execution` frames alike: a frame folds into every page, and whether it
 * rereads is asked of every row the pages hold. */
export function projectTicketRowsFolded(
  partition: PartitionIdentity,
  name: string,
  phases: readonly TicketPhase[] | undefined,
): ProjectList<ProjectTicketPages> {
  return projectTicketRowsLive(
    projectListFoldedElseReread<ProjectTicketPages>(
      partition,
      "Ticket",
      name,
      (previous, change) =>
        projectListPagesEach(previous, (page) =>
          projectTicketRowsFold(
            page,
            change.resource,
            change.representation,
            phases,
          ),
        ),
      (previous, change) =>
        projectTicketRowsRereads(
          previous === undefined ? undefined : projectTicketRowsOf(previous),
          change.representation,
          phases,
        ),
    ),
  );
}

/** Whether an execution is its ticket's latest over the one held, in the order
 * `latest=true` answers: the higher task, the same execution being itself. */
export function projectTicketExecutionLater(
  held: TicketLatestExecution | undefined,
  arriving: TicketLatestExecution,
): boolean {
  return (
    held === undefined ||
    held.execution === arriving.execution ||
    held.task < arriving.task
  );
}

/**
 * An `Execution` frame folded into the rows, or into one page of them: the row
 * of its ticket takes it as its latest execution where it is, and a frame that
 * will not read — a tombstone among them — an older execution's, or one for a
 * ticket the rows do not hold leaves every row where it was.
 */
export function projectTicketRowsExecutionFold<R extends ProjectTicketsHeld>(
  previous: R | undefined,
  representation: unknown,
): R | undefined {
  if (previous === undefined) return previous;
  const read = executionSummarySchema.safeParse(representation);
  if (!read.success) return previous;
  const ticket = read.data.ticket;
  const arriving = ticketLatestExecutionSchema.parse(read.data);
  const at = previous.tickets.findIndex((held) => held.ticket === ticket);
  const held = previous.tickets[at];
  if (
    held === undefined ||
    !projectTicketExecutionLater(held.latestExecution, arriving)
  )
    return previous;
  return {
    ...previous,
    tickets: previous.tickets.with(at, { ...held, latestExecution: arriving }),
  };
}

/** A list of ticket pages that an `Execution` frame keeps live as well. */
export function projectTicketRowsLive(
  list: ProjectList<ProjectTicketPages>,
): ProjectList<ProjectTicketPages> {
  return projectListAlongside(list, "Execution", (previous, change) =>
    projectListPagesEach(previous, (page) =>
      projectTicketRowsExecutionFold(page, change.representation),
    ),
  );
}
