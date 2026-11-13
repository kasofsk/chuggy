/**
 * An epic's graph as its Graph tab draws it, once `epicGraphLayout.ts` has
 * laid it out: the sizes and gaps it is laid out by, the curve each edge takes
 * from a dependency to what waits on it, the chain a card traces, which ticket
 * is selected, and how far the graph is scaled to the panel it sits in.
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
/** The least the graph is scaled down to fit its panel; narrower, it scrolls. */
export const epicGraphScaleLeast = 0.78;
/** The root size in px the sizes above are stated at, since a card holds text
 * set in `rem`. */
export const epicGraphRootPixels = 16;

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

/** How many times the root size the graph's sizes are stated at a root this
 * many px is; a root whose size reads as none draws the graph as stated. */
export function epicGraphRootScaleOf(rootPixels: number): number {
  return rootPixels > 0 ? rootPixels / epicGraphRootPixels : 1;
}

/** The graph as laid out, magnified by a root's scale, so its cards grow with
 * the text they hold. */
export function epicGraphDrawnAtRoot(
  drawn: EpicGraphDrawn,
  rootScale: number,
): EpicGraphDrawn {
  const at = (point: EpicGraphPoint): EpicGraphPoint => ({
    x: point.x * rootScale,
    y: point.y * rootScale,
  });
  return {
    ...drawn,
    cards: drawn.cards.map((card) => ({
      ...card,
      ...at(card),
      width: card.width * rootScale,
      height: card.height * rootScale,
    })),
    edges: drawn.edges.map((edge) => ({
      ...edge,
      points: edge.points.map(at),
    })),
    width: drawn.width * rootScale,
    height: drawn.height * rootScale,
  };
}

/** The key an edge between two tickets is known by. */
export function epicGraphEdgeKey(from: number, to: number): string {
  return `${String(from)}-${String(to)}`;
}

function epicGraphNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The edge as a smooth SVG path through its points: the uniform B-spline d3
 * calls `curveBasis`, which starts at the first point and ends at the last,
 * and a straight line where there are only two.
 */
export function epicGraphEdgePath(points: readonly EpicGraphPoint[]): string {
  const at = (x: number, y: number) =>
    `${epicGraphNumber(x)} ${epicGraphNumber(y)}`;
  const [first, second] = points;
  if (first === undefined) return "";
  if (second === undefined) return `M ${at(first.x, first.y)}`;
  const steps = [`M ${at(first.x, first.y)}`];
  let before = first;
  let here = second;
  const curved = (next: EpicGraphPoint) => {
    steps.push(
      `C ${at((2 * before.x + here.x) / 3, (2 * before.y + here.y) / 3)} ${at((before.x + 2 * here.x) / 3, (before.y + 2 * here.y) / 3)} ${at((before.x + 4 * here.x + next.x) / 6, (before.y + 4 * here.y + next.y) / 6)}`,
    );
    before = here;
    here = next;
  };
  for (const [index, next] of points.slice(2).entries()) {
    if (index === 0)
      steps.push(
        `L ${at((5 * before.x + here.x) / 6, (5 * before.y + here.y) / 6)}`,
      );
    curved(next);
  }
  if (points.length > 2) curved(here);
  steps.push(`L ${at(here.x, here.y)}`);
  return steps.join(" ");
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
  edges: readonly { readonly from: number; readonly to: number }[],
  onward: (edge: {
    readonly from: number;
    readonly to: number;
  }) => readonly [number, number],
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
  edges: readonly EpicGraphEdge[],
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

/** The key an edge is traced by. */
export function epicGraphEdgeKeyOf(edge: EpicGraphEdge): string {
  return epicGraphEdgeKey(edge.from, edge.to);
}

function epicGraphRunning(standing: TicketStateStanding): boolean {
  return (
    standing === "Work" ||
    standing === "Evaluation" ||
    standing === "Finalization"
  );
}

/**
 * The ticket selected: the one the address names where the graph holds it;
 * otherwise the first running member, top to bottom and then left to right,
 * else the first Ready one, else the topmost card, the unconnected row after
 * the graph. None where nothing is drawn.
 */
export function epicGraphSelectedOf(
  drawn: EpicGraphDrawn,
  named: number | undefined,
): number | undefined {
  if (named !== undefined && drawn.tickets.has(named)) return named;
  const read = [
    ...[...drawn.cards].sort(
      (left, right) => left.y - right.y || left.x - right.x,
    ),
    ...drawn.unconnected,
  ];
  const members = read.filter((ticket) => ticket.node.member);
  return (
    members.find((ticket) => epicGraphRunning(ticket.standing)) ??
    members.find((ticket) => ticket.standing === "Ready") ??
    read[0]
  )?.node.ticket;
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

/** How far the graph is scaled to fit its panel: never past its own size,
 * and never under the least, past which the panel scrolls instead. */
export function epicGraphScaleOf(width: number, panelWidth: number): number {
  if (width <= 0 || panelWidth <= 0) return 1;
  return Math.min(1, Math.max(epicGraphScaleLeast, panelWidth / width));
}

/** Where the panel opens scrolled to, so the selected card stands in its
 * middle where the scaled graph is wider than it. */
export function epicGraphScrollOf(
  centre: number,
  scaledWidth: number,
  panelWidth: number,
): number {
  return Math.min(
    Math.max(0, scaledWidth - panelWidth),
    Math.max(0, centre - panelWidth / 2),
  );
}
