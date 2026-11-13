/**
 * An epic's graph laid out top to bottom by dagre for the Overview's small
 * graph: where each card stands, and the points each edge is routed through.
 * It is the only module of the console that reaches dagre, and it reaches nothing of the console but
 * `epicGraph.ts`, so the graph's lazily loaded chunk carries dagre and
 * nothing the page's own bundle does not already hold.
 *
 * A ticket outside the epic is a smaller card, and may be left out, which
 * lays the graph out again without it. A member with no edge either way is
 * left out of the layout and named among the unconnected, which the Overview
 * places in rows of its own, so tickets unrelated to the rest do not make one
 * rank many cards wide.
 */

import { Graph, layout } from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel } from "@dagrejs/dagre";

import type { EpicGraphResponse } from "../../../../src/contract/responses.ts";
import {
  epicGraphEdgesShown,
  epicGraphMargin,
  epicGraphMemberHeight,
  epicGraphMemberWidth,
  epicGraphNodeGap,
  epicGraphOutsideHeight,
  epicGraphOutsideWidth,
  epicGraphRankGap,
} from "./epicGraph.ts";
import type {
  EpicGraphCard,
  EpicGraphDrawn,
  EpicGraphEdge,
  EpicGraphTicket,
} from "./epicGraph.ts";

type EpicGraphNode = EpicGraphResponse["nodes"][number];

function epicGraphCardSize(node: EpicGraphNode): {
  readonly width: number;
  readonly height: number;
} {
  return node.member
    ? { width: epicGraphMemberWidth, height: epicGraphMemberHeight }
    : { width: epicGraphOutsideWidth, height: epicGraphOutsideHeight };
}

/**
 * The graph laid out, with the tickets outside the epic or without them, each
 * ticket the one `epicGraphTicketsOf` holds. A node named twice is drawn
 * once, and an edge into a node the graph does not hold is left undrawn.
 */
export function epicGraphDrawn(
  graph: EpicGraphResponse,
  tickets: ReadonlyMap<number, EpicGraphTicket>,
  outsideShown: boolean,
): EpicGraphDrawn {
  const shown = [...tickets.values()]
    .filter((ticket) => outsideShown || ticket.node.member)
    .sort((left, right) => left.node.ticket - right.node.ticket);
  const edges = epicGraphEdgesShown(
    graph,
    new Set(shown.map((ticket) => ticket.node.ticket)),
  );
  const joined = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const laid = new Graph<GraphLabel, NodeLabel, EdgeLabel>();
  laid.setGraph({
    rankdir: "TB",
    nodesep: epicGraphNodeGap,
    ranksep: epicGraphRankGap,
    marginx: epicGraphMargin,
    marginy: epicGraphMargin,
  });
  laid.setDefaultEdgeLabel(() => ({}));
  const placed = shown.filter(
    (ticket) => joined.has(ticket.node.ticket) || !ticket.node.member,
  );
  for (const ticket of placed)
    laid.setNode(String(ticket.node.ticket), epicGraphCardSize(ticket.node));
  for (const edge of edges) laid.setEdge(String(edge.from), String(edge.to));
  layout(laid);
  const cards = placed.map((ticket): EpicGraphCard => {
    const at = laid.node(String(ticket.node.ticket));
    return {
      ...ticket,
      x: (at.x ?? 0) - at.width / 2,
      y: (at.y ?? 0) - at.height / 2,
      width: at.width,
      height: at.height,
    };
  });
  const box = laid.graph();
  return {
    tickets,
    cards,
    edges: edges.map((edge): EpicGraphEdge => {
      const from = tickets.get(edge.from);
      const to = tickets.get(edge.to);
      return {
        ...edge,
        outside: from?.node.member !== true || to?.node.member !== true,
        met: from?.standing === "Done",
        points: (
          laid.edge(String(edge.from), String(edge.to)).points ?? []
        ).map((point) => ({ x: point.x, y: point.y })),
      };
    }),
    unconnected: shown.filter(
      (ticket) => ticket.node.member && !joined.has(ticket.node.ticket),
    ),
    width: cards.length === 0 ? 0 : (box.width ?? 0),
    height: cards.length === 0 ? 0 : (box.height ?? 0),
  };
}
