/**
 * What the epic page's Overview draws beside the description: the members
 * running, the ones next, and the graph in small, its cards blocks filled by
 * state and its edges lines.
 */

import {
  epicGraphMemberHeight,
  epicGraphMemberWidth,
  epicGraphNodeGap,
  epicGraphRankGap,
} from "./epicGraph.ts";
import type { EpicGraphDrawn, EpicGraphPoint } from "./epicGraph.ts";
import { epicTicketsGroupOf } from "./epicTickets.ts";
import type { EpicTicketsMember } from "./epicTickets.ts";
import { ticketStateLabelOf } from "./ticketHeader.ts";
import type {
  TicketStateLabelForm,
  TicketStateStanding,
} from "./ticketHeader.ts";
import type { Tone } from "./tones.ts";

export interface EpicOverviewLists {
  readonly running: readonly EpicTicketsMember[];
  readonly next: readonly EpicTicketsMember[];
}

/**
 * The members running, and the ones next: the Ready ones, or where there are
 * none, the Blocked ones whose every unfinished dependency is running. Each
 * keeps the order it was handed, which is the Tickets tab's.
 */
export function epicOverviewListsOf(
  members: readonly EpicTicketsMember[],
  standings: ReadonlyMap<number, TicketStateStanding>,
): EpicOverviewLists {
  const running = members.filter(
    (member) => epicTicketsGroupOf(member.standing) === "Running",
  );
  const ready = members.filter((member) => member.standing === "Ready");
  const runningOf = (ticket: number) => {
    const standing = standings.get(ticket);
    return standing !== undefined && epicTicketsGroupOf(standing) === "Running";
  };
  return {
    running,
    next:
      ready.length > 0
        ? ready
        : members.filter(
            (member) =>
              member.standing === "Blocked" && member.after.every(runningOf),
          ),
  };
}

export interface EpicOverviewBlock {
  readonly ticket: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tone: Tone;
  readonly form: TicketStateLabelForm;
}

export interface EpicOverviewLine {
  readonly from: number;
  readonly to: number;
  readonly points: readonly EpicGraphPoint[];
}

export interface EpicOverviewGraph {
  readonly blocks: readonly EpicOverviewBlock[];
  readonly lines: readonly EpicOverviewLine[];
  readonly width: number;
  readonly height: number;
}

/**
 * The laid out graph in small: each card a block in its state's tone and
 * form, each edge a line through its points, and the members with no edge in
 * rows under the graph, as many to a row as the graph is wide.
 */
export function epicOverviewGraphOf(drawn: EpicGraphDrawn): EpicOverviewGraph {
  const block = (
    ticket: number,
    standing: TicketStateStanding,
    at: { x: number; y: number; width: number; height: number },
  ): EpicOverviewBlock => {
    const label = ticketStateLabelOf(standing);
    return { ticket, ...at, tone: label.tone, form: label.form };
  };
  const stride = epicGraphMemberWidth + epicGraphNodeGap;
  const width = Math.max(drawn.width, epicGraphMemberWidth);
  const perRow = Math.max(1, Math.floor((width + epicGraphNodeGap) / stride));
  const top = drawn.cards.length === 0 ? 0 : drawn.height + epicGraphRankGap;
  const unconnected = drawn.unconnected.map((ticket, at) =>
    block(ticket.node.ticket, ticket.standing, {
      x: (at % perRow) * stride,
      y:
        top +
        Math.floor(at / perRow) * (epicGraphMemberHeight + epicGraphRankGap),
      width: epicGraphMemberWidth,
      height: epicGraphMemberHeight,
    }),
  );
  const rows = Math.ceil(drawn.unconnected.length / perRow);
  return {
    blocks: [
      ...drawn.cards.map((card) =>
        block(card.node.ticket, card.standing, card),
      ),
      ...unconnected,
    ],
    lines: drawn.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      points: edge.points,
    })),
    width,
    height:
      rows === 0
        ? drawn.height
        : top + rows * epicGraphMemberHeight + (rows - 1) * epicGraphRankGap,
  };
}
