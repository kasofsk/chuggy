/**
 * The tickets the inbox holds: the phase page joined with the project's open
 * native actions, its standing agentic refusals and the lead's decisions held
 * for approval, one entry per ticket in any of the four.
 *
 * "Needs you" is the phase section plus any ticket carrying an open action,
 * which is what puts a ticket awaiting a finalization approval in front of the
 * person it waits on — `Finalization` is not a phase the section holds, so the
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
 * has four reads and a bounded index; the ticket's own page is one link away
 * and holds the rest. A proposed ticket is one of these: it is released, which
 * no phase the section holds, so its row says only what the proposal does.
 *
 * A READER WHO MAY NOT DISPATCH HAS NO PROPOSALS, and the read answering them
 * absent is that answer rather than a refusal to say beside the rows.
 */

import type { TicketResponse } from "../../../../src/contract/responses.ts";
import type {
  AgenticRefusalResponse,
  AgenticRefusalsResponse,
  ProjectNativeActionResponse,
  SelectorProposalResponse,
  SelectorProposalsResponse,
} from "../../../../src/contract/responses.ts";

import type { PanelState } from "./freshness.ts";
import type { ProjectNativeActionRows } from "./projectNativeActionPages.ts";
import type { ProjectTicketRows } from "./projectTicketPages.ts";

export interface InboxEntry {
  readonly ticket: number;
  readonly held: TicketResponse | undefined;
  readonly actions: readonly ProjectNativeActionResponse[];
  readonly refusals: readonly AgenticRefusalResponse[];
  readonly proposals: readonly SelectorProposalResponse[];
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

interface InboxUnionReads {
  readonly open: readonly ProjectNativeActionResponse[];
  readonly standing: readonly AgenticRefusalResponse[];
  readonly proposed: readonly SelectorProposalResponse[];
}

function inboxUnionEntry(
  ticket: number,
  held: TicketResponse | undefined,
  reads: InboxUnionReads,
): InboxEntry {
  return {
    ticket,
    held,
    actions: inboxUnionActionsAt(reads.open, ticket),
    refusals: inboxUnionRefusalsAt(reads.standing, ticket),
    proposals: reads.proposed.filter((proposal) =>
      proposal.tickets.includes(ticket),
    ),
  };
}

/**
 * The phase page's rows in the order it gave them, then the tickets only the
 * actions name, then those only the refusals name, then those only a proposal
 * names: each list is already ordered by its own fence, and interleaving them
 * would order by none. An unread proposals read is the one a caller omits.
 */
export function inboxUnion(
  rows: ProjectTicketRows | undefined,
  actions: ProjectNativeActionRows | undefined,
  refused: AgenticRefusalsResponse | undefined,
  proposals?: SelectorProposalsResponse,
): InboxUnion {
  const reads: InboxUnionReads = {
    open: actions?.actions ?? [],
    standing: refused?.refusals ?? [],
    proposed: proposals?.proposals ?? [],
  };
  const held = rows?.tickets ?? [];
  const listed = new Set(held.map((ticket) => ticket.ticket));
  const entries: InboxEntry[] = held.map((ticket) =>
    inboxUnionEntry(ticket.ticket, ticket, reads),
  );
  for (const ticket of [
    ...reads.open.map((action) => action.ticket),
    ...reads.standing.map((refusal) => refusal.ticket),
    ...reads.proposed.flatMap((proposal) => proposal.tickets),
  ]) {
    if (listed.has(ticket)) continue;
    listed.add(ticket);
    entries.push(inboxUnionEntry(ticket, undefined, reads));
  }
  return {
    entries,
    more:
      rows?.nextCursor !== undefined ||
      actions?.nextCursor !== undefined ||
      refused?.more === true ||
      proposals?.more === true,
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
 * What the panel draws, over the reads. Any one answering draws the union;
 * only a screen holding no answer at all refuses, and it refuses with the phase
 * page's reason, which is the read the section is named for.
 */
export function inboxUnionState(
  union: InboxUnion,
  phase: PanelState<ProjectTicketRows>,
  open: PanelState<ProjectNativeActionRows>,
  refused: PanelState<AgenticRefusalsResponse>,
  proposals: PanelState<SelectorProposalsResponse> = { state: "Pending" },
): PanelState<InboxUnion> {
  const states = [phase, open, refused, proposals];
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
  readonly proposals: string | undefined;
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
  proposals: PanelState<SelectorProposalsResponse> = { state: "Pending" },
): InboxRefusals {
  if (state.state !== "Ready")
    return {
      phase: undefined,
      open: undefined,
      standing: undefined,
      proposals: undefined,
    };
  return {
    phase: inboxUnionRefused(phase),
    open: inboxUnionRefused(open),
    standing: inboxUnionRefused(refused),
    proposals: proposals.state === "Failed" ? proposals.reason : undefined,
  };
}
