/**
 * The inbox as this console holds it: one read under one key, the rows its
 * pages make, which frames read it again, and what the shell's badge counts.
 *
 * The server answers the inbox whole — every ticket in a phase of
 * `inboxPhases`, with an open action, refused by the lead or named by a held
 * decision, one entry each — so the console joins nothing. The phases are the
 * contract's, and the project table's "Needs you" section is held to them, so
 * the two screens cannot disagree about whether a ticket needs a human.
 *
 * A FRAME NEVER WRITES AN ENTRY, IT ONLY SAYS WHEN TO READ AGAIN. A
 * `NativeAction` or `AgenticRefusal` frame may move any ticket into or out of
 * the inbox, so each rereads it; a `Ticket` frame does where the inbox holds
 * that ticket or its phase is one the inbox holds, and is nothing to the inbox
 * otherwise. No frame names a held decision, so the read is polled while
 * anything draws it.
 *
 * The entry is the pages as read, and the rows are derived from them. A
 * reread reads again as many pages as the entry holds, so a reader's "more" is
 * not taken away on a frame, and one that fails leaves the pages it would have
 * replaced on screen.
 */

import type { InfiniteData } from "@tanstack/query-core";

import {
  inboxPhases,
  nativeHttpPageItemsMax,
} from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import {
  executionSummarySchema,
  ticketLatestExecutionSchema,
  ticketResponseSchema,
} from "../../../../src/contract/responses.ts";
import type {
  InboxEntryResponse,
  InboxResponse,
  ProjectTicket,
} from "../../../../src/contract/responses.ts";

import type { InboxPage } from "./apiRoutes.ts";
import {
  projectListAlongside,
  projectListAlongsideReread,
  projectListPagesEach,
  projectListRereadNamed,
} from "./projectQueryKeys.ts";
import type { ProjectList, ProjectListChange } from "./projectQueryKeys.ts";
import { projectTicketExecutionLater } from "./projectTicketPages.ts";

export const inboxSection = "NeedsYou" as const;

export const inboxListName = "inbox";

/** How many pages one read gathers at the most, and how many entries the rows hold at once. */
export const inboxPagesMax = 20;
export const inboxEntriesMax = 500;

/** What holds inbox entries: the rows drawn, or one page of them. */
interface InboxEntriesHeld {
  readonly entries: readonly InboxEntryResponse[];
}

/** The entry the inbox is read under: every page read, and the cursor each was read from. */
export type InboxPages = InfiniteData<InboxResponse, string | undefined>;

export interface InboxRows extends InboxEntriesHeld {
  /** Every ticket the inbox holds, as the last page answered it. */
  readonly count: number;
  /** Undefined before the first page and once the last has answered. */
  readonly nextCursor: string | undefined;
  readonly pagesRead: number;
  /** Why the page a reader asked for after the first could not be read, while the rows already read stand. */
  readonly failure: string | undefined;
}

export const inboxRowsEmpty: InboxRows = {
  entries: [],
  count: 0,
  nextCursor: undefined,
  pagesRead: 0,
  failure: undefined,
};

/** Newest activity first, at the most a page holds, from where the last page stopped. */
export function inboxPage(cursor: string | undefined): InboxPage {
  return {
    limit: nativeHttpPageItemsMax,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** A page's entries after the rows', a ticket already held kept where it is. */
export function inboxRowsAppend(
  previous: InboxRows,
  page: InboxResponse,
): InboxRows {
  const seen = new Set(previous.entries.map((entry) => entry.ticket.ticket));
  const entries = [...previous.entries];
  for (const entry of page.entries) {
    if (seen.has(entry.ticket.ticket)) continue;
    if (entries.length >= inboxEntriesMax) break;
    seen.add(entry.ticket.ticket);
    entries.push(entry);
  }
  return {
    entries,
    count: page.count,
    nextCursor: page.nextCursor,
    pagesRead: previous.pagesRead + 1,
    failure: undefined,
  };
}

export function inboxRowsHaveMore(rows: InboxRows): boolean {
  return (
    rows.nextCursor !== undefined &&
    rows.pagesRead < inboxPagesMax &&
    rows.entries.length < inboxEntriesMax
  );
}

/** The rows the pages draw, in the order they were read. */
export function inboxRowsOf(pages: InboxPages): InboxRows {
  let rows = inboxRowsEmpty;
  for (const page of pages.pages) rows = inboxRowsAppend(rows, page);
  return rows;
}

/** The cursor the page after the pages is read from, or undefined where a bound or the last page says none is. */
export function inboxPagesNext(pages: InboxPages): string | undefined {
  const rows = inboxRowsOf(pages);
  return inboxRowsHaveMore(rows) ? rows.nextCursor : undefined;
}

/** Whether a `Ticket` frame is about a ticket the rows hold, or one whose phase the inbox holds. */
export function inboxRowsRereads(
  previous: InboxEntriesHeld | undefined,
  change: ProjectListChange,
): boolean {
  const ticket = Number(change.resource);
  if (
    previous?.entries.some((entry) => entry.ticket.ticket === ticket) === true
  )
    return true;
  const read = ticketResponseSchema.safeParse(change.representation);
  return read.success && inboxPhases.includes(read.data.phase);
}

/** An `Execution` frame taken as its ticket's latest where the rows, or one page of them, hold that ticket and it is later than the one held. */
export function inboxRowsExecutionFold<R extends InboxEntriesHeld>(
  previous: R | undefined,
  representation: unknown,
): R | undefined {
  if (previous === undefined) return previous;
  const read = executionSummarySchema.safeParse(representation);
  if (!read.success) return previous;
  const arriving = ticketLatestExecutionSchema.parse(read.data);
  const at = previous.entries.findIndex(
    (entry) => entry.ticket.ticket === read.data.ticket,
  );
  const held = previous.entries[at];
  if (
    held === undefined ||
    !projectTicketExecutionLater(held.ticket.latestExecution, arriving)
  )
    return previous;
  return {
    ...previous,
    entries: previous.entries.with(at, {
      ...held,
      ticket: { ...held.ticket, latestExecution: arriving },
    }),
  };
}

/** The inbox's one key under the partition, with every frame that reaches
 * it: a frame folds into every page, and whether it rereads is asked of every
 * entry the pages hold. */
export function inboxList(
  partition: PartitionIdentity,
): ProjectList<InboxPages> {
  const named = projectListRereadNamed<InboxPages>(
    partition,
    "Ticket",
    inboxListName,
    (change, previous) =>
      inboxRowsRereads(
        previous === undefined ? undefined : inboxRowsOf(previous),
        change,
      ),
  );
  return projectListAlongside(
    projectListAlongsideReread(
      projectListAlongsideReread(named, "NativeAction"),
      "AgenticRefusal",
    ),
    "Execution",
    (previous, change) =>
      projectListPagesEach(previous, (page) =>
        inboxRowsExecutionFold(page, change.representation),
      ),
  );
}

/** The entry's ticket where its phase is what holds it here, which is what its phase's own answers are offered for. */
export function inboxEntryPhased(
  entry: InboxEntryResponse,
): ProjectTicket | undefined {
  return inboxPhases.includes(entry.ticket.phase) ? entry.ticket : undefined;
}

/** Nothing where the inbox is empty, so an empty badge is not drawn as a zero. */
export function inboxCountLabel(
  rows: InboxRows | undefined,
): string | undefined {
  if (rows === undefined || rows.count === 0) return undefined;
  return String(rows.count);
}
