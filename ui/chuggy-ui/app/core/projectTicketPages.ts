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
 * begins. A first read is its first page, empty or not, so an empty active
 * read says so; a "Show more" reads past a page that adds no row, so a press
 * draws a row wherever one is left. A first read that drew nothing asks the
 * reads after it whether anything is left, and draws none of what they hold:
 * a list with nothing behind its button is a project with no ticket.
 */

import { ticketResponseSchema } from "../../../../src/contract/responses.ts";
import type {
  ProjectResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";
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

/** Whether a page carries a ticket the rows do not hold yet. */
function projectTicketRowsAdds(
  rows: ProjectTicketRows,
  page: ProjectResponse,
): boolean {
  const held = new Set(rows.tickets.map((ticket) => ticket.ticket));
  return page.tickets.some((ticket) => !held.has(ticket.ticket));
}

type ProjectTicketPageRead = (
  cursor: string | undefined,
  read: number,
) => Promise<ApiResult<ProjectResponse>>;

/** Where a gather writes each page it reads, answering the rows as they then
 * stand, or undefined where there are none to write to. */
type ProjectTicketRowsLand = (
  update: (rows: ProjectTicketRows) => ProjectTicketRows,
) => ProjectTicketRows | undefined;

/**
 * Reads on from `from` until `pages` pages have answered — or, `pastEmpty`,
 * have each added a row — the list's reads end or a bound is reached, landing
 * every page as it answers. Answers the refusal that stopped it, if one did;
 * the pages before it have landed.
 */
async function projectTicketRowsGather(
  from: ProjectTicketRows,
  land: ProjectTicketRowsLand,
  readPage: ProjectTicketPageRead,
  reads: number,
  pages: number,
  pastEmpty: boolean,
): Promise<ApiFailure | undefined> {
  let rows: ProjectTicketRows | undefined = from;
  let wanted = pages;
  for (let page = 0; page < wanted && rows !== undefined; page += 1) {
    const next: ProjectTicketRowsNext | undefined =
      rows.pagesRead === 0 ? projectTicketRowsFirst : rows.next;
    if (next === undefined) break;
    const answered = await readPage(next.cursor, next.read);
    if (answered.outcome !== "Ok") return answered;
    if (pastEmpty && !projectTicketRowsAdds(rows, answered.value)) wanted += 1;
    rows = land((held) => projectTicketRowsAppend(held, answered.value, reads));
    if (rows === undefined || !projectTicketRowsHaveMore(rows)) break;
  }
  return undefined;
}

/** The rows with `next` moved past each further read whose first page is
 * empty and last, so a list holding nothing offers a press only where a row is
 * behind it. A page that holds a row is left for that press to draw. */
async function projectTicketRowsEnded(
  rows: ProjectTicketRows,
  readPage: ProjectTicketPageRead,
  reads: number,
): Promise<ProjectTicketRows> {
  let held = rows;
  for (let asked = 0; asked < reads; asked += 1) {
    const next = held.next;
    if (held.tickets.length > 0 || next?.cursor !== undefined) break;
    if (next === undefined) break;
    const answered = await readPage(undefined, next.read);
    if (answered.outcome !== "Ok") break;
    const page = answered.value;
    if (page.tickets.length > 0 || page.nextCursor !== undefined) break;
    held = {
      ...held,
      next: projectTicketRowsNextAfter(next.read, page, reads),
    };
  }
  return held;
}

/**
 * The pages a read gathers: one on a first read, and on a refetch exactly as
 * many as the entry it replaces had read, so a refetch never reads further
 * than the last one did. A refusal is
 * answered with the rows there are — the ones just gathered, or the ones being
 * replaced — and only a read holding none at all answers with the refusal
 * itself.
 */
export async function projectTicketRowsRead(
  previous: ProjectTicketRows | undefined,
  readPage: ProjectTicketPageRead,
  reads = 1,
): Promise<ApiResult<ProjectTicketRows>> {
  let rows = projectTicketRowsEmpty;
  const refused = await projectTicketRowsGather(
    rows,
    (update) => (rows = update(rows)),
    readPage,
    reads,
    Math.max(previous?.pagesRead ?? 1, 1),
    false,
  );
  if (refused === undefined)
    return {
      outcome: "Ok",
      value: await projectTicketRowsEnded(rows, readPage, reads),
    };
  const held = rows.pagesRead === 0 ? previous : rows;
  if (held === undefined) return refused;
  return {
    outcome: "Ok",
    value: projectTicketRowsFailed(held, panelReason(refused)),
  };
}

/**
 * What a reader's "Show more" does to the rows `land` holds: one page that adds
 * a row, read past as many as add none, so a press draws something whenever
 * the list has anything left. A refusal is recorded on the rows it reached.
 */
export async function projectTicketRowsMore(
  rows: ProjectTicketRows,
  land: ProjectTicketRowsLand,
  readPage: ProjectTicketPageRead,
  reads = 1,
): Promise<void> {
  const refused = await projectTicketRowsGather(
    rows,
    land,
    readPage,
    reads,
    1,
    true,
  );
  if (refused !== undefined)
    land((held) => projectTicketRowsFailed(held, panelReason(refused)));
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
