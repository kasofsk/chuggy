/**
 * An epic's graph: its tickets and the edges between those shown, the chain a
 * ticket traces, which ticket is selected, and what a ticket waits on and
 * what waits on it. The sizes and gaps are the ones `epicGraphLayout.ts` lays
 * the Overview's small graph out by.
 */

import type { EpicGraphResponse } from "../../../../src/contract/responses.ts";
import type { TicketStateStanding } from "./ticketHeader.ts";

type EpicGraphNode = EpicGraphResponse["nodes"][number];

export const epicGraphMemberWidth = 216;
export const epicGraphMemberHeight = 74;
export const epicGraphOutsideWidth = 168;
export const epicGraphOutsideHeight = 52;
/** Between two cards of one rank. */
export const epicGraphNodeGap = 22;
/** Between one rank and the next. */
export const epicGraphRankGap = 34;
/** Around the graph, so a card's focus ring is not cut at its edge. */
export const epicGraphMargin = 6;

/** A ticket of the graph and the state its card is drawn in. */
export interface EpicGraphTicket {
  readonly node: EpicGraphNode;
  readonly standing: TicketStateStanding;
}

/** One card as it is placed, by its top left corner. */
export interface EpicGraphCard extends EpicGraphTicket {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EpicGraphPoint {
  readonly x: number;
  readonly y: number;
}

/** An edge from a dependency to its dependent, through the points the layout
 * routed it by. */
export interface EpicGraphEdge {
  readonly from: number;
  readonly to: number;
  /** Either end is outside the epic, which draws it dashed. */
  readonly outside: boolean;
  /** The dependency is Done, so what it held is met. */
  readonly met: boolean;
  readonly points: readonly EpicGraphPoint[];
}

export interface EpicGraphDrawn {
  /** Every ticket the graph names, drawn or left out. */
  readonly tickets: ReadonlyMap<number, EpicGraphTicket>;
  readonly cards: readonly EpicGraphCard[];
  readonly edges: readonly EpicGraphEdge[];
  /** The members with no edge either way, lowest number first. */
  readonly unconnected: readonly EpicGraphTicket[];
  readonly width: number;
  readonly height: number;
}

/** The key an edge between two tickets is known by. */
export function epicGraphEdgeKey(from: number, to: number): string {
  return `${String(from)}-${String(to)}`;
}

/** An edge between two tickets shown, from a dependency to what waits on it. */
export interface EpicGraphEdgeShown {
  readonly from: number;
  readonly to: number;
}

/** The edges between tickets shown, each once, none from a ticket to itself. */
export function epicGraphEdgesShown(
  graph: EpicGraphResponse,
  shown: ReadonlySet<number>,
): readonly EpicGraphEdgeShown[] {
  const seen = new Set<string>();
  return graph.edges
    .filter((edge) => {
      const key = epicGraphEdgeKey(edge.from, edge.to);
      if (
        seen.has(key) ||
        edge.from === edge.to ||
        !shown.has(edge.from) ||
        !shown.has(edge.to)
      )
        return false;
      seen.add(key);
      return true;
    })
    .map((edge) => ({ from: edge.from, to: edge.to }));
}

/** What a card traces: itself, everything it waits on and everything waiting
 * on it, all the way along, and the edges along those chains. */
export interface EpicGraphTrace {
  readonly tickets: ReadonlySet<number>;
  readonly edges: ReadonlySet<string>;
}

/** Every ticket reached from one along the edges in one direction, the ticket
 * itself included; each is taken once, so the walk is bounded by the edges
 * given, a cycle included. */
function epicGraphTraceReached(
  ticket: number,
  edges: readonly EpicGraphEdgeShown[],
  onward: (edge: EpicGraphEdgeShown) => readonly [number, number],
): ReadonlySet<number> {
  const next = new Map<number, number[]>();
  for (const edge of edges) {
    const [here, there] = onward(edge);
    next.set(here, [...(next.get(here) ?? []), there]);
  }
  const reached = new Set([ticket]);
  const waiting = [ticket];
  for (let at = 0; at < waiting.length; at += 1)
    for (const there of next.get(waiting[at] ?? ticket) ?? [])
      if (!reached.has(there)) {
        reached.add(there);
        waiting.push(there);
      }
  return reached;
}

export function epicGraphTraced(
  ticket: number,
  edges: readonly EpicGraphEdgeShown[],
): EpicGraphTrace {
  const above = epicGraphTraceReached(ticket, edges, (edge) => [
    edge.to,
    edge.from,
  ]);
  const below = epicGraphTraceReached(ticket, edges, (edge) => [
    edge.from,
    edge.to,
  ]);
  return {
    tickets: new Set([...above, ...below]),
    edges: new Set(
      edges
        .filter(
          (edge) =>
            (above.has(edge.from) && above.has(edge.to)) ||
            (below.has(edge.from) && below.has(edge.to)),
        )
        .map((edge) => epicGraphEdgeKey(edge.from, edge.to)),
    ),
  };
}

/** The ticket selected: the one the address names, where the graph holds
 * it; none otherwise. */
export function epicGraphSelectedOf(
  tickets: ReadonlyMap<number, EpicGraphTicket>,
  named: number | undefined,
): number | undefined {
  return named !== undefined && tickets.has(named) ? named : undefined;
}

/** What a ticket waits on and what waits on it, each lowest number first. */
export function epicGraphNeighboursOf(
  graph: EpicGraphResponse,
  ticket: number,
): {
  readonly dependsOn: readonly number[];
  readonly blocks: readonly number[];
} {
  const of = (tickets: readonly number[]) =>
    [...new Set(tickets)]
      .filter((other) => other !== ticket)
      .sort((left, right) => left - right);
  return {
    dependsOn: of(
      graph.edges.filter((edge) => edge.to === ticket).map((edge) => edge.from),
    ),
    blocks: of(
      graph.edges.filter((edge) => edge.from === ticket).map((edge) => edge.to),
    ),
  };
}
