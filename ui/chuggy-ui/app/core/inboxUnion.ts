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
 * THE BADGE AND THE PANEL READ ONE STATE, WHICH IS WHY IT IS DECIDED HERE.
 * Either read answering is enough to draw the union, because a question this
 * console did read is one a person has to be able to reach; the read that
 * refused is said as itself beside the rows rather than in place of them. A
 * screen counting rows a panel refuses to draw is the failure this arrangement
 * exists to make unreachable.
 *
 * A TICKET ONLY THE ACTIONS NAME IS DRAWN FROM WHAT THE ACTION CARRIES. Reading
 * the ticket for each such entry is a request per row, and this screen already
 * has two reads and a bounded index; the ticket's own page is one link away and
 * holds the rest.
 */

import type { TicketResponse } from "../../../../src/contract/responses.ts";
import type { ProjectNativeActionResponse } from "../../../../src/contract/responses.ts";

import type { PanelState } from "./freshness.ts";
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

function inboxUnionRefused(state: PanelState<unknown>): string | undefined {
  return state.state === "Absent" || state.state === "Failed"
    ? state.reason
    : undefined;
}

/** The older of the two observations, because a panel is as fresh as the
 * stalest half of what it draws. */
function inboxUnionObservedAtMs(
  phase: PanelState<ProjectTicketRows>,
  open: PanelState<ProjectNativeActionRows>,
): number | undefined {
  const observed = [phase, open]
    .map((state) => (state.state === "Ready" ? state.observedAtMs : undefined))
    .filter((at) => at !== undefined);
  return observed.length === 0 ? undefined : Math.min(...observed);
}

/**
 * What the panel draws, over both reads. Either one answering draws the union;
 * only a screen holding neither answer refuses, and it refuses with the phase
 * page's reason, which is the read the section is named for.
 */
export function inboxUnionState(
  union: InboxUnion,
  phase: PanelState<ProjectTicketRows>,
  open: PanelState<ProjectNativeActionRows>,
): PanelState<InboxUnion> {
  if (phase.state === "Ready" || open.state === "Ready")
    return {
      state: "Ready",
      value: union,
      observedAtMs: inboxUnionObservedAtMs(phase, open),
    };
  if (phase.state === "Absent" || phase.state === "Failed") return phase;
  if (open.state === "Absent" || open.state === "Failed") return open;
  return { state: "Pending" };
}

export interface InboxRefusals {
  readonly phase: string | undefined;
  readonly open: string | undefined;
}

/**
 * What each read could not do, to be said beside rows the other one supplied.
 * A refusal the panel is already showing in place of the rows is not repeated.
 */
export function inboxUnionRefusals(
  state: PanelState<InboxUnion>,
  phase: PanelState<ProjectTicketRows>,
  open: PanelState<ProjectNativeActionRows>,
): InboxRefusals {
  if (state.state !== "Ready") return { phase: undefined, open: undefined };
  return { phase: inboxUnionRefused(phase), open: inboxUnionRefused(open) };
}
