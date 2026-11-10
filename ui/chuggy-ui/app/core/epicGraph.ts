/**
 * An epic's graph as its canvas draws it: where each ticket's card stands, the
 * curve each connector takes from a dependency to its dependent, the current
 * run a member's card names, and the view the canvas is panned and zoomed to.
 *
 * Cards stand in layers, left to right: each in the column one past the
 * deepest of its dependencies, so every connector runs rightward. A ticket
 * outside the epic is a smaller card, and the reader may leave those out, which
 * lays the graph out again without them.
 */

import type {
  EpicGraphResponse,
  ProjectTicket,
} from "../../../../src/contract/responses.ts";

import type { TicketListStanding } from "./ticketListView.ts";

type EpicGraphNode = EpicGraphResponse["nodes"][number];

export const epicGraphMemberWidth = 240;
export const epicGraphMemberHeight = 112;
export const epicGraphOutsideWidth = 192;
export const epicGraphOutsideHeight = 64;
export const epicGraphColumnGap = 96;
export const epicGraphRowGap = 24;

/** One card as it is placed. */
export interface EpicGraphCard {
  readonly node: EpicGraphNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point of the canvas, in its own units. */
export interface EpicGraphPoint {
  readonly x: number;
  readonly y: number;
}

/** A connector as the cubic curve it is drawn along, from the dependency's
 * right edge to the dependent's left. */
export interface EpicGraphConnector {
  readonly from: number;
  readonly to: number;
  /** Whether either end is outside the epic, which draws it dashed. */
  readonly outside: boolean;
  readonly curve: readonly [
    EpicGraphPoint,
    EpicGraphPoint,
    EpicGraphPoint,
    EpicGraphPoint,
  ];
}

export interface EpicGraphDrawn {
  readonly cards: readonly EpicGraphCard[];
  readonly connectors: readonly EpicGraphConnector[];
  readonly width: number;
  readonly height: number;
}

/**
 * The column of each node: one past the deepest of its dependencies, found by
 * taking each node once its dependencies are placed, so every pass is bounded
 * by the nodes and edges given. A node on a cycle is never freed that way and
 * stands in the first column.
 */
function epicGraphDrawnColumns(
  tickets: readonly number[],
  edges: readonly { readonly from: number; readonly to: number }[],
): ReadonlyMap<number, number> {
  const waiting = new Map(tickets.map((ticket) => [ticket, 0]));
  const outgoing = new Map<number, number[]>();
  for (const edge of edges) {
    waiting.set(edge.to, (waiting.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }
  const column = new Map(tickets.map((ticket) => [ticket, 0]));
  const freed = tickets.filter((ticket) => waiting.get(ticket) === 0);
  for (let next = 0; next < freed.length; next += 1) {
    const ticket = freed[next];
    if (ticket === undefined) break;
    const at = column.get(ticket) ?? 0;
    for (const to of outgoing.get(ticket) ?? []) {
      column.set(to, Math.max(column.get(to) ?? 0, at + 1));
      const left = (waiting.get(to) ?? 0) - 1;
      waiting.set(to, left);
      if (left === 0) freed.push(to);
    }
  }
  for (const ticket of tickets)
    if ((waiting.get(ticket) ?? 0) > 0) column.set(ticket, 0);
  return column;
}

/** The curve from one card's right edge to another's left, leaving and
 * arriving level. */
function epicGraphDrawnCurve(
  from: EpicGraphCard,
  to: EpicGraphCard,
): EpicGraphConnector["curve"] {
  const start = { x: from.x + from.width, y: from.y + from.height / 2 };
  const end = { x: to.x, y: to.y + to.height / 2 };
  const pull = Math.max(epicGraphColumnGap / 2, (end.x - start.x) / 2);
  return [
    start,
    { x: start.x + pull, y: start.y },
    { x: end.x - pull, y: end.y },
    end,
  ];
}

/** The cards of the nodes given, each column's stacked by ticket number. */
function epicGraphDrawnCards(
  nodes: readonly EpicGraphNode[],
  columns: ReadonlyMap<number, number>,
): readonly EpicGraphCard[] {
  const columnOf = (ticket: number) => columns.get(ticket) ?? 0;
  const ordered = [...nodes].sort(
    (left, right) =>
      columnOf(left.ticket) - columnOf(right.ticket) ||
      left.ticket - right.ticket,
  );
  const below = new Map<number, number>();
  return ordered.map((node): EpicGraphCard => {
    const column = columnOf(node.ticket);
    const y = below.get(column) ?? 0;
    const height = node.member ? epicGraphMemberHeight : epicGraphOutsideHeight;
    below.set(column, y + height + epicGraphRowGap);
    return {
      node,
      x: column * (epicGraphMemberWidth + epicGraphColumnGap),
      y,
      width: node.member ? epicGraphMemberWidth : epicGraphOutsideWidth,
      height,
    };
  });
}

/**
 * The graph laid out, with the tickets outside the epic or without them. A
 * node named twice is drawn once; an edge into a node the graph does not
 * hold, or one on a cycle, is left undrawn rather than looped on.
 */
export function epicGraphDrawn(
  graph: EpicGraphResponse,
  outsideShown: boolean,
): EpicGraphDrawn {
  const seen = new Set<number>();
  const nodes = graph.nodes.filter((node) => {
    if (seen.has(node.ticket) || (!outsideShown && !node.member)) return false;
    seen.add(node.ticket);
    return true;
  });
  const edges = graph.edges.filter(
    (edge) => seen.has(edge.from) && seen.has(edge.to) && edge.from !== edge.to,
  );
  const cards = epicGraphDrawnCards(
    nodes,
    epicGraphDrawnColumns(
      nodes.map((node) => node.ticket).sort((left, right) => left - right),
      edges,
    ),
  );
  const byTicket = new Map(cards.map((card) => [card.node.ticket, card]));
  const connectors = edges.flatMap((edge): EpicGraphConnector[] => {
    const from = byTicket.get(edge.from);
    const to = byTicket.get(edge.to);
    return from === undefined || to === undefined || from.x >= to.x
      ? []
      : [
          {
            from: edge.from,
            to: edge.to,
            outside: !from.node.member || !to.node.member,
            curve: epicGraphDrawnCurve(from, to),
          },
        ];
  });
  return {
    cards,
    connectors,
    width: Math.max(0, ...cards.map((card) => card.x + card.width)),
    height: Math.max(0, ...cards.map((card) => card.y + card.height)),
  };
}

/** The connector's curve as an SVG path. */
export function epicGraphConnectorPath(connector: EpicGraphConnector): string {
  const [start, pullStart, pullEnd, end] = connector.curve;
  return `M ${String(start.x)} ${String(start.y)} C ${String(pullStart.x)} ${String(pullStart.y)}, ${String(pullEnd.x)} ${String(pullEnd.y)}, ${String(end.x)} ${String(end.y)}`;
}

/** The point a share of the way along the connector's curve. */
export function epicGraphConnectorPoint(
  connector: EpicGraphConnector,
  share: number,
): EpicGraphPoint {
  const t = Math.min(1, Math.max(0, share));
  const [p0, p1, p2, p3] = connector.curve;
  const u = 1 - t;
  const at = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  return { x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) };
}

/** Where a node stands where the ticket list holds no row of it: its phase,
 * a Pending one ready once every dependency the graph holds of it is Done;
 * a draft never released has none. */
export function epicGraphStandingOf(
  node: EpicGraphNode,
  graph: EpicGraphResponse,
): TicketListStanding | undefined {
  if (node.phase !== "Pending") return node.phase;
  const done = new Set(
    graph.nodes
      .filter((other) => other.phase === "Done")
      .map((other) => other.ticket),
  );
  return graph.edges.every(
    (edge) => edge.to !== node.ticket || done.has(edge.from),
  )
    ? "Ready"
    : "Blocked";
}

/** The run a member's card names: its work in a cycle, or a stage of the
 * evaluation of one. */
export type EpicGraphRun =
  | { readonly run: "Work"; readonly cycle: number }
  | {
      readonly run: "Evaluation";
      readonly cycle: number;
      readonly stage: number;
    };

/** The run a ticket's row says it has under way, none where its latest has
 * ended or it has none. */
export function epicGraphRunOf(
  ticket: Pick<ProjectTicket, "latestExecution"> | undefined,
): EpicGraphRun | undefined {
  const latest = ticket?.latestExecution;
  if (
    latest === undefined ||
    latest.status === "Terminal" ||
    latest.status === "Cancelled"
  )
    return undefined;
  const identity = latest.identity;
  switch (identity.type) {
    case "WorkTask":
      return { run: "Work", cycle: identity.value.cycle };
    case "EvaluationTask":
      return {
        run: "Evaluation",
        cycle: identity.value.workCycle,
        stage: identity.value.stage,
      };
  }
}

/** Where the canvas looks: the offset of the graph's origin within the frame,
 * in the frame's pixels, and how far it is zoomed. */
export interface EpicGraphView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface EpicGraphSize {
  readonly width: number;
  readonly height: number;
}

export const epicGraphZoomLeast = 0.2;
export const epicGraphZoomMost = 2;
/** How much one press of zoom in or out changes the zoom by. */
export const epicGraphZoomStep = 1.25;
/** The frame's pixels left around the graph when it is fitted. */
export const epicGraphFitPadding = 24;

function epicGraphZoomBounded(zoom: number): number {
  return Math.min(epicGraphZoomMost, Math.max(epicGraphZoomLeast, zoom));
}

/** The whole graph centred in the frame, zoomed out until it fits and never
 * in past its own size. A frame not yet measured shows it at its own size. */
export function epicGraphFitted(
  graph: EpicGraphSize,
  frame: EpicGraphSize,
): EpicGraphView {
  const room = {
    width: frame.width - 2 * epicGraphFitPadding,
    height: frame.height - 2 * epicGraphFitPadding,
  };
  if (room.width <= 0 || room.height <= 0 || graph.width <= 0)
    return { x: epicGraphFitPadding, y: epicGraphFitPadding, zoom: 1 };
  const zoom = epicGraphZoomBounded(
    Math.min(1, room.width / graph.width, room.height / graph.height),
  );
  return {
    x: (frame.width - graph.width * zoom) / 2,
    y: (frame.height - graph.height * zoom) / 2,
    zoom,
  };
}

/** The view zoomed by a factor about the frame's centre, within the bounds. */
export function epicGraphZoomed(
  view: EpicGraphView,
  factor: number,
  frame: EpicGraphSize,
): EpicGraphView {
  const zoom = epicGraphZoomBounded(view.zoom * factor);
  const centre = { x: frame.width / 2, y: frame.height / 2 };
  const scale = zoom / view.zoom;
  return {
    x: centre.x - (centre.x - view.x) * scale,
    y: centre.y - (centre.y - view.y) * scale,
    zoom,
  };
}

/** The view as an SVG transform. */
export function epicGraphViewTransform(view: EpicGraphView): string {
  return `translate(${String(view.x)} ${String(view.y)}) scale(${String(view.zoom)})`;
}
