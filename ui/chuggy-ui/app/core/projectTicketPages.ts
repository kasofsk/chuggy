/**
 * The rows the project table holds, and what a page, a live frame or a refused
 * read does to them.
 *
 * The accumulation is the cache entry itself, so the pages a reader has asked
 * for and the frames that arrived since are one value and a fold does not have
 * to reach past the query it is registered on. A page that will not read keeps
 * the rows already there and records why, because a table that empties itself
 * on a refusal is a table that says the project is empty.
 *
 * A REFETCH IS NOT A FIRST READ. The entry this accumulation lives in sits
 * under the partition prefix that the degraded stream's fallback and a
 * `Project` frame both invalidate, so rebuilding it from the first page alone
 * would take a reader's pages away on a timer. That is why a read gathers as
 * many pages as the entry it is replacing had, and why a refusal keeps them.
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
 * begins, and a page that adds no row is not one a reader asked for: a read
 * gathers past it, so a list whose first read is empty opens on its second.
 */

import { ticketResponseSchema } from "../../../../src/contract/responses.ts";
import type {
  ProjectResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import type { ApiResult } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";

export const projectTicketPagesMax = 20;
export const projectTicketRowsMax = 500;

/** Where the next page is read: which of the list's reads, from its start or from the cursor its last page answered. */
export interface ProjectTicketRowsNext {
  readonly read: number;
  readonly cursor: string | undefined;
}

/** Where a list's first page is read. */
const projectTicketRowsFirst: ProjectTicketRowsNext = {
  read: 0,
  cursor: undefined,
};

export interface ProjectTicketRows {
  readonly tickets: readonly TicketResponse[];
  /** Undefined before the first page and once every read has answered its last. */
  readonly next: ProjectTicketRowsNext | undefined;
  readonly pagesRead: number;
  /** How many tickets the server says a search matched, as the last page answered it. */
  readonly matched: number | undefined;
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
  held: readonly TicketResponse[],
  arriving: readonly TicketResponse[],
): readonly TicketResponse[] {
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

/** `reads` is how many reads the list is drawn from, and the page is one of the read `previous` names next. */
export function projectTicketRowsAppend(
  previous: ProjectTicketRows,
  page: ProjectResponse,
  reads = 1,
): ProjectTicketRows {
  return {
    tickets: projectTicketRowsMerged(previous.tickets, page.tickets),
    next: projectTicketRowsNextAfter(previous.next?.read ?? 0, page, reads),
    pagesRead: previous.pagesRead + 1,
    matched: page.matched,
    failure: undefined,
  };
}

/** The cursor is kept, so the same page can be asked for again. */
export function projectTicketRowsFailed(
  previous: ProjectTicketRows,
  reason: string,
): ProjectTicketRows {
  return { ...previous, failure: reason };
}

/** What a page asked for after the first does to the rows, refusal included:
 * the first page has no rows to keep, so its refusal is the panel's own. */
export function projectTicketRowsAfterPage(
  previous: ProjectTicketRows,
  answered: ApiResult<ProjectResponse>,
  reads = 1,
): ProjectTicketRows {
  return answered.outcome === "Ok"
    ? projectTicketRowsAppend(previous, answered.value, reads)
    : projectTicketRowsFailed(previous, panelReason(answered));
}

export function projectTicketRowsHaveMore(rows: ProjectTicketRows): boolean {
  return (
    rows.next !== undefined &&
    rows.pagesRead < projectTicketPagesMax &&
    rows.tickets.length < projectTicketRowsMax
  );
}

/**
 * The pages a read gathers: one on a first read, and as many as the reader had
 * asked for on a refetch, and one more for each that added no row. A refusal is
 * answered with the rows there are — the ones just gathered, or the ones being
 * replaced — and only a read holding none at all answers with the refusal
 * itself.
 */
export async function projectTicketRowsRead(
  previous: ProjectTicketRows | undefined,
  readPage: (
    cursor: string | undefined,
    read: number,
  ) => Promise<ApiResult<ProjectResponse>>,
  reads = 1,
): Promise<ApiResult<ProjectTicketRows>> {
  let wanted = Math.max(previous?.pagesRead ?? 1, 1);
  let rows = projectTicketRowsEmpty;
  for (let page = 0; page < wanted; page += 1) {
    const next = rows.pagesRead === 0 ? projectTicketRowsFirst : rows.next;
    if (next === undefined) break;
    const answered = await readPage(next.cursor, next.read);
    if (answered.outcome !== "Ok") {
      const held = rows.pagesRead === 0 ? previous : rows;
      if (held === undefined) return answered;
      return {
        outcome: "Ok",
        value: projectTicketRowsFailed(held, panelReason(answered)),
      };
    }
    const held = rows.tickets.length;
    rows = projectTicketRowsAppend(rows, answered.value, reads);
    if (!projectTicketRowsHaveMore(rows)) break;
    if (rows.tickets.length === held) wanted += 1;
  }
  return { outcome: "Ok", value: rows };
}

function projectTicketRowsWithout(
  rows: ProjectTicketRows,
  ticket: number,
): ProjectTicketRows {
  return {
    ...rows,
    tickets: rows.tickets.filter((held) => held.ticket !== ticket),
  };
}

/** A ticket the filter no longer admits leaves; one it admits and the list has
 * not got is the most recent activity there is, so it arrives at the top. */
function projectTicketRowsWith(
  rows: ProjectTicketRows,
  arriving: TicketResponse,
): ProjectTicketRows {
  const held = rows.tickets.some((ticket) => ticket.ticket === arriving.ticket);
  if (held)
    return {
      ...rows,
      tickets: rows.tickets.map((ticket) =>
        ticket.ticket === arriving.ticket ? arriving : ticket,
      ),
    };
  return {
    ...rows,
    tickets: [arriving, ...rows.tickets].slice(0, projectTicketRowsMax),
  };
}

/**
 * A `Ticket` frame folded into the rows: the representation is the ticket read's
 * own body, a null one is a tombstone, and anything else leaves the rows alone
 * because a list that cannot read a frame is better stale than wrong.
 */
export function projectTicketRowsFold(
  previous: ProjectTicketRows | undefined,
  resource: string,
  representation: unknown,
  phases: readonly TicketPhase[] | undefined,
): ProjectTicketRows | undefined {
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
