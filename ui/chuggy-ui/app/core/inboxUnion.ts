/**
 * The tickets the inbox holds: the phase page joined with the project's open
 * native actions and its standing agentic refusals, one entry per ticket in
 * any of the three.
 *
 * "Needs you" is the phase section plus any ticket carrying an open action,
 * which is what puts a ticket awaiting a finalization approval in front of the
 * person it waits on — `Finalizing` is not a phase the section holds, so the
 * actions are the only read that finds one.
 *
 * A REFUSED TICKET NEEDS A PERSON AND NO OTHER READ FINDS IT. The lead declines
 * to dispatch a released ticket and the ticket stays where it is, so its phase
 * is nothing the section holds and it has no open question behind it; without
 * this read a refusal is a ticket that silently never runs.
 *
 * THE COUNT IS THE UNION AND NOT A SUM. An escalated ticket whose escalation is
 * also an open action is one thing needing a person, and adding the reads
 * would say two.
 *
 * THE BADGE AND THE PANEL READ ONE STATE, WHICH IS WHY IT IS DECIDED HERE.
 * Any read answering is enough to draw the union, because a question this
 * console did read is one a person has to be able to reach; the read that
 * refused is said as itself beside the rows rather than in place of them. A
 * screen counting rows a panel refuses to draw is the failure this arrangement
 * exists to make unreachable.
 *
 * A TICKET ONLY THE ACTIONS NAME IS DRAWN FROM WHAT THE ACTION CARRIES. Reading
 * the ticket for each such entry is a request per row, and this screen already
 * has three reads and a bounded index; the ticket's own page is one link away
 * and holds the rest.
 */

import type { TicketResponse } from "../../../../src/contract/responses.ts";
import type {
  AgenticRefusalResponse,
  AgenticRefusalsResponse,
  ProjectNativeActionResponse,
} from "../../../../src/contract/responses.ts";

import type { PanelState } from "./freshness.ts";
import type { ProjectNativeActionRows } from "./projectNativeActionPages.ts";
import type { ProjectTicketRows } from "./projectTicketPages.ts";

export interface InboxEntry {
  readonly ticket: number;
  readonly held: TicketResponse | undefined;
  readonly actions: readonly ProjectNativeActionResponse[];
  readonly refusals: readonly AgenticRefusalResponse[];
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

function inboxUnionRefusalsAt(
  refusals: readonly AgenticRefusalResponse[],
  ticket: number,
): readonly AgenticRefusalResponse[] {
  return refusals.filter((refusal) => refusal.ticket === ticket);
}

function inboxUnionEntry(
  ticket: number,
  held: TicketResponse | undefined,
  open: readonly ProjectNativeActionResponse[],
  standing: readonly AgenticRefusalResponse[],
): InboxEntry {
  return {
    ticket,
    held,
    actions: inboxUnionActionsAt(open, ticket),
    refusals: inboxUnionRefusalsAt(standing, ticket),
  };
}

/**
 * The phase page's rows in the order it gave them, then the tickets only the
 * actions name, then the tickets only the refusals name: each list is already
 * ordered by its own fence, and interleaving three fences would order by none.
 */
export function inboxUnion(
  rows: ProjectTicketRows | undefined,
  actions: ProjectNativeActionRows | undefined,
  refused: AgenticRefusalsResponse | undefined,
): InboxUnion {
  const open = actions?.actions ?? [];
  const standing = refused?.refusals ?? [];
  const held = rows?.tickets ?? [];
  const listed = new Set(held.map((ticket) => ticket.ticket));
  const entries: InboxEntry[] = held.map((ticket) =>
    inboxUnionEntry(ticket.ticket, ticket, open, standing),
  );
  for (const ticket of [
    ...open.map((action) => action.ticket),
    ...standing.map((refusal) => refusal.ticket),
  ]) {
    if (listed.has(ticket)) continue;
    listed.add(ticket);
    entries.push(inboxUnionEntry(ticket, undefined, open, standing));
  }
  return {
    entries,
    more:
      rows?.nextCursor !== undefined ||
      actions?.nextCursor !== undefined ||
      refused?.more === true,
  };
}

function inboxUnionRefused(state: PanelState<unknown>): string | undefined {
  return state.state === "Absent" || state.state === "Failed"
    ? state.reason
    : undefined;
}

/** The oldest of the observations, because a panel is as fresh as the
 * stalest part of what it draws. */
function inboxUnionObservedAtMs(
  states: readonly PanelState<unknown>[],
): number | undefined {
  const observed = states
    .map((state) => (state.state === "Ready" ? state.observedAtMs : undefined))
    .filter((at) => at !== undefined);
  return observed.length === 0 ? undefined : Math.min(...observed);
}

/**
 * What the panel draws, over the three reads. Any one answering draws the
 * union; only a screen holding no answer at all refuses, and it refuses with
 * the phase page's reason, which is the read the section is named for.
 */
export function inboxUnionState(
  union: InboxUnion,
  phase: PanelState<ProjectTicketRows>,
  open: PanelState<ProjectNativeActionRows>,
  refused: PanelState<AgenticRefusalsResponse>,
): PanelState<InboxUnion> {
  const states = [phase, open, refused];
  if (states.some((state) => state.state === "Ready"))
    return {
      state: "Ready",
      value: union,
      observedAtMs: inboxUnionObservedAtMs(states),
    };
  if (phase.state === "Absent" || phase.state === "Failed") return phase;
  if (open.state === "Absent" || open.state === "Failed") return open;
  if (refused.state === "Absent" || refused.state === "Failed") return refused;
  return { state: "Pending" };
}

export interface InboxRefusals {
  readonly phase: string | undefined;
  readonly open: string | undefined;
  readonly standing: string | undefined;
}

/**
 * What each read could not do, to be said beside rows the others supplied. A
 * refusal the panel is already showing in place of the rows is not repeated.
 */
export function inboxUnionRefusals(
  state: PanelState<InboxUnion>,
  phase: PanelState<ProjectTicketRows>,
  open: PanelState<ProjectNativeActionRows>,
  refused: PanelState<AgenticRefusalsResponse>,
): InboxRefusals {
  if (state.state !== "Ready")
    return { phase: undefined, open: undefined, standing: undefined };
  return {
    phase: inboxUnionRefused(phase),
    open: inboxUnionRefused(open),
    standing: inboxUnionRefused(refused),
  };
}
