/**
 * The tickets the inbox holds: the phase page joined with the project's open
 * native actions, one entry per ticket in either.
 *
 * "Needs you" is the phase section plus any ticket carrying an open action,
 * which is what puts a ticket awaiting a finalization approval in front of the
 * person it waits on — `Finalizing` is not a phase the section holds, so the
 * actions are the only read that finds one.
 *
 * THE COUNT IS THE UNION AND NOT A SUM. An escalated ticket whose escalation is
 * also an open action is one thing needing a person, and adding the two reads
 * would say two.
 *
 * A TICKET ONLY THE ACTIONS NAME IS DRAWN FROM WHAT THE ACTION CARRIES. Reading
 * the ticket for each such entry is a request per row, and this screen already
 * has two reads and a bounded index; the ticket's own page is one link away and
 * holds the rest.
 */

import type { TicketResponse } from "../../../../src/contract/responses.ts";
import type { ProjectNativeActionResponse } from "../../../../src/contract/responses.ts";

import type { ProjectNativeActionRows } from "./projectNativeActionPages.ts";
import type { ProjectTicketRows } from "./projectTicketPages.ts";

export interface InboxEntry {
  readonly ticket: number;
  readonly held: TicketResponse | undefined;
  readonly actions: readonly ProjectNativeActionResponse[];
}

export interface InboxUnion {
  readonly entries: readonly InboxEntry[];
  readonly more: boolean;
}

export const inboxUnionEmpty: InboxUnion = { entries: [], more: false };

function inboxUnionActionsAt(
  actions: readonly ProjectNativeActionResponse[],
  ticket: number,
): readonly ProjectNativeActionResponse[] {
  return actions.filter((action) => action.ticket === ticket);
}

/**
 * The phase page's rows in the order it gave them, then the tickets only the
 * actions name in the order that read gave: each list is already newest first
 * by its own fence, and interleaving two fences would order by neither.
 */
export function inboxUnion(
  rows: ProjectTicketRows | undefined,
  actions: ProjectNativeActionRows | undefined,
): InboxUnion {
  const open = actions?.actions ?? [];
  const held = rows?.tickets ?? [];
  const listed = new Set(held.map((ticket) => ticket.ticket));
  const entries: InboxEntry[] = held.map((ticket) => ({
    ticket: ticket.ticket,
    held: ticket,
    actions: inboxUnionActionsAt(open, ticket.ticket),
  }));
  for (const action of open) {
    if (listed.has(action.ticket)) continue;
    listed.add(action.ticket);
    entries.push({
      ticket: action.ticket,
      held: undefined,
      actions: inboxUnionActionsAt(open, action.ticket),
    });
  }
  return {
    entries,
    more: rows?.nextCursor !== undefined || actions?.nextCursor !== undefined,
  };
}
