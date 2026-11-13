/**
 * An epic's graph: its tickets and the edges between those shown, the chain a
 * ticket traces, which ticket is selected, and what a ticket waits on and
 * what waits on it.
 */

import type { EpicGraphResponse } from "../../../../src/contract/responses.ts";
import type { TicketStateStanding } from "./ticketHeader.ts";

type EpicGraphNode = EpicGraphResponse["nodes"][number];

/** A ticket of the graph and the state its card is drawn in. */
export interface EpicGraphTicket {
  readonly node: EpicGraphNode;
  readonly standing: TicketStateStanding;
}

export interface EpicGraphPoint {
  readonly x: number;
  readonly y: number;
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

/** Each ticket and the tickets one step on from it, along the edges given in
 * the direction `onward` reads them. */
export function epicGraphAdjacency(
  edges: readonly EpicGraphEdgeShown[],
  onward: (edge: EpicGraphEdgeShown) => readonly [number, number],
): ReadonlyMap<number, readonly number[]> {
  const next = new Map<number, number[]>();
  for (const edge of edges) {
    const [here, there] = onward(edge);
    const held = next.get(here);
    if (held === undefined) next.set(here, [there]);
    else held.push(there);
  }
  return next;
}

/** Every ticket reached from one along an adjacency, the ticket itself
 * included; each is taken once, so the walk is bounded by the tickets the
 * adjacency names, a cycle included. */
export function epicGraphReached(
  ticket: number,
  next: ReadonlyMap<number, readonly number[]>,
): ReadonlySet<number> {
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
  const above = epicGraphReached(
    ticket,
    epicGraphAdjacency(edges, (edge) => [edge.to, edge.from]),
  );
  const below = epicGraphReached(
    ticket,
    epicGraphAdjacency(edges, (edge) => [edge.from, edge.to]),
  );
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
