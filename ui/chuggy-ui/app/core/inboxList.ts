/**
 * Which tickets the inbox holds, the page it asks the wire for, and what the
 * shell's badge counts.
 *
 * Membership is the project table's "needs you" section rather than a second
 * definition of it, so a phase that changes section changes what the inbox
 * holds in the same edit and neither screen can disagree with the other about
 * whether a ticket needs a human. The page size is asked for rather than left
 * to the route's default, so the rows drawn are a number this console chose.
 *
 * THE BADGE COUNTS THE ROWS HELD, AND SAYS SO WHEN THE WIRE HAS MORE. The
 * question it asks is whether a further page is unread, which is the cursor the
 * last page answered with; whether the reader may ask for that page is a
 * different question, bounded by the accumulation's own caps, and answering the
 * first with the second would print a bare number at exactly the point it
 * became short.
 */

import { nativeHttpPageItemsMax } from "../../../../src/contract/http.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import type { ProjectPage } from "./apiRoutes.ts";
import type { ProjectTicketRows } from "./projectTicketPages.ts";
import { ticketSectionPhases } from "./ticketSections.ts";

export const inboxSection = "NeedsYou" as const;

export const inboxPhases: readonly TicketPhase[] =
  ticketSectionPhases(inboxSection);

/** Newest activity first, because an inbox is read from the top. */
export function inboxPage(cursor: string | undefined): ProjectPage {
  return {
    order: "RecentActivity",
    limit: nativeHttpPageItemsMax,
    ...(cursor === undefined ? {} : { cursor }),
    phase: inboxPhases,
  };
}

/** Nothing where the inbox is empty, so an empty badge is not drawn as a zero. */
export function inboxCountLabel(
  rows: ProjectTicketRows | undefined,
): string | undefined {
  if (rows === undefined) return undefined;
  const held = rows.tickets.length;
  if (held === 0) return undefined;
  return rows.nextCursor === undefined ? String(held) : `${String(held)}+`;
}
