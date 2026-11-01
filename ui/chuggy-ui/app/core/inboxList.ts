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
 * A REREAD IS NOT A FIRST READ: it gathers as many pages as the rows it
 * replaces had, so a reader's "more" is not taken away on a frame, and one that
 * fails answers the failure, which leaves the rows it would have replaced on
 * screen.
 */

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
import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import {
  projectListAlongside,
  projectListAlongsideReread,
  projectListRereadNamed,
} from "./projectQueryKeys.ts";
import type { ProjectList, ProjectListChange } from "./projectQueryKeys.ts";
import { projectTicketExecutionLater } from "./projectTicketPages.ts";

export const inboxSection = "NeedsYou" as const;

export const inboxListName = "inbox";

/** How many pages one read gathers at the most, and how many entries the rows hold at once. */
export const inboxPagesMax = 20;
export const inboxEntriesMax = 500;

export interface InboxRows {
  readonly entries: readonly InboxEntryResponse[];
  /** Every ticket the inbox holds, as the last page answered it. */
  readonly count: number;
  /** Undefined before the first page and once the last has answered. */
  readonly nextCursor: string | undefined;
  readonly pagesRead: number;
  /** Why the page a reader asked for after the first could not be read. */
  readonly failure: ApiFailure | undefined;
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

type InboxPageRead = (
  cursor: string | undefined,
) => Promise<ApiResult<InboxResponse>>;

/** The pages a read gathers: one on a first read, and on a reread as many as the rows it replaces had. */
export async function inboxRowsRead(
  previous: InboxRows | undefined,
  readPage: InboxPageRead,
): Promise<ApiResult<InboxRows>> {
  const wanted = Math.min(Math.max(previous?.pagesRead ?? 1, 1), inboxPagesMax);
  let rows = inboxRowsEmpty;
  for (let page = 0; page < wanted; page += 1) {
    const answered = await readPage(rows.nextCursor);
    if (answered.outcome !== "Ok") return answered;
    rows = inboxRowsAppend(rows, answered.value);
    if (!inboxRowsHaveMore(rows)) break;
  }
  return { outcome: "Ok", value: rows };
}

/** What a reader's "more" does to the rows: the page appended, or why it could not be read. */
export function inboxRowsAfterPage(
  previous: InboxRows,
  answered: ApiResult<InboxResponse>,
): InboxRows {
  return answered.outcome === "Ok"
    ? inboxRowsAppend(previous, answered.value)
    : { ...previous, failure: answered };
}

/** Whether a `Ticket` frame is about a ticket the rows hold, or one whose phase the inbox holds. */
export function inboxRowsRereads(
  previous: InboxRows | undefined,
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

/** An `Execution` frame taken as its ticket's latest where the rows hold that ticket and it is later than the one held. */
export function inboxRowsExecutionFold(
  previous: InboxRows | undefined,
  representation: unknown,
): InboxRows | undefined {
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

/** The inbox's one key under the partition, with every frame that reaches it. */
export function inboxList(
  partition: PartitionIdentity,
): ProjectList<InboxRows> {
  const named = projectListRereadNamed<InboxRows>(
    partition,
    "Ticket",
    inboxListName,
    (change, previous) => inboxRowsRereads(previous, change),
  );
  return projectListAlongside(
    projectListAlongsideReread(
      projectListAlongsideReread(named, "NativeAction"),
      "AgenticRefusal",
    ),
    "Execution",
    (previous, change) =>
      inboxRowsExecutionFold(previous, change.representation),
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
