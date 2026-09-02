/**
 * Which tickets the inbox holds, the two pages it asks the wire for, and what
 * the shell's badge counts.
 *
 * Phase membership is the project table's "needs you" section rather than a
 * second definition of it, so a phase that changes section changes what the
 * inbox holds in the same edit and neither screen can disagree with the other
 * about whether a ticket needs a human. A ticket with an open native action
 * needs one too, and `inboxUnion.ts` is where the two reads become one list.
 * Each page size is asked for rather than left to the route's default, so the
 * rows drawn are a number this console chose.
 *
 * THE BADGE COUNTS THE UNION HELD, AND SAYS SO WHEN THE WIRE HAS MORE. The
 * question it asks is whether a further page is unread on either read, which is
 * the cursor the last page answered with; whether the reader may ask for that
 * page is a different question, bounded by the accumulations' own caps, and
 * answering the first with the second would print a bare number at exactly the
 * point it became short.
 */

import {
  agenticRefusalsAnsweredMax,
  nativeHttpPageItemsMax,
} from "../../../../src/contract/http.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import type { NativeActionsPage, ProjectPage } from "./apiRoutes.ts";
import type { InboxUnion } from "./inboxUnion.ts";
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

/** The open actions the inbox joins its phase page with, newest fence first. */
export function inboxActionsPage(
  cursor: string | undefined,
): NativeActionsPage {
  return {
    limit: nativeHttpPageItemsMax,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** The standing refusals, asked for at the whole of what one read answers. */
export function inboxRefusalsPage(): { readonly limit: number } {
  return { limit: agenticRefusalsAnsweredMax };
}

/** Nothing where the inbox is empty, so an empty badge is not drawn as a zero. */
export function inboxCountLabel(union: InboxUnion): string | undefined {
  const held = union.entries.length;
  if (held === 0) return undefined;
  return union.more ? `${String(held)}+` : String(held);
}
