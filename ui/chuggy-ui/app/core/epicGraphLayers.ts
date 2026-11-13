/**
 * An epic's graph in layers, as the Graph tab draws it: each ticket shown on
 * the layer of the longest path to it, each layer ordered by standing and
 * then number, what each ticket waits on and what waits on it in the order
 * they are placed, the longest chain of unfinished tickets, the goal every
 * other member leads to where there is one, and the edges left once every
 * edge another path already implies is dropped.
 *
 * The graph is not guaranteed acyclic, so every walk skips a ticket already
 * on its own stack, and so ends.
 */

import type { EpicGraphResponse } from "../../../../src/contract/responses.ts";
import { epicGraphEdgesShown } from "./epicGraph.ts";
import type { EpicGraphEdgeShown, EpicGraphTicket } from "./epicGraph.ts";
import type { TicketStateStanding } from "./ticketHeader.ts";

export interface EpicGraphLayered {
  /** Every ticket the graph names, shown or left out. */
  readonly tickets: ReadonlyMap<number, EpicGraphTicket>;
  /** The tickets shown, first layer first, each in its order. */
  readonly layers: readonly (readonly EpicGraphTicket[])[];
  /** Each shown ticket's layer, counted from one. */
  readonly layerOf: ReadonlyMap<number, number>;
  /** What each shown ticket waits on, in the order they are placed. */
  readonly dependsOn: ReadonlyMap<number, readonly number[]>;
  /** What waits on each shown ticket, in the order they are placed. */
  readonly blocks: ReadonlyMap<number, readonly number[]>;
  /** The longest chain of unfinished tickets, what is waited on first. */
  readonly chain: readonly number[];
  readonly goal: number | undefined;
  /** The edges between tickets shown, each once. */
  readonly edges: readonly EpicGraphEdgeShown[];
  /** The edges no other path between the same two tickets implies. */
  readonly reduced: readonly EpicGraphEdgeShown[];
}

/** Where a standing sorts within a layer: what is finished, what is moving,
 * what may start, what may not, and the rest. */
export function epicGraphLayersStandingRank(
  standing: TicketStateStanding,
): number {
  switch (standing) {
    case "Done":
      return 0;
    case "Work":
    case "Evaluation":
    case "Finalization":
    case "Escalated":
      return 1;
    case "Ready":
      return 2;
    case "Blocked":
      return 3;
    case "Draft":
    case "Revoked":
      return 4;
  }
}

function epicGraphLayersFinished(standing: TicketStateStanding): boolean {
  return standing === "Done" || standing === "Revoked";
}

function epicGraphLayersAdjacency(
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

/** Each ticket's layer: one past the deepest of what it waits on, a
 * dependency already on the walk's stack skipped. The recursion is bounded by
 * the tickets given, since a ticket is entered at most once. */
function epicGraphLayersDepthOf(
  shown: readonly number[],
  waitsOn: ReadonlyMap<number, readonly number[]>,
): ReadonlyMap<number, number> {
  const depth = new Map<number, number>();
  const stack = new Set<number>();
  const deepen = (ticket: number): number => {
    const known = depth.get(ticket);
    if (known !== undefined) return known;
    stack.add(ticket);
    let deepest = 0;
    for (const dependency of waitsOn.get(ticket) ?? [])
      if (!stack.has(dependency))
        deepest = Math.max(deepest, deepen(dependency));
    stack.delete(ticket);
    depth.set(ticket, deepest + 1);
    return deepest + 1;
  };
  for (const ticket of shown) deepen(ticket);
  return depth;
}

/** Whether one chain is to be preferred to another: longer, and between two
 * as long, the one with the lower number at the first place they differ. */
function epicGraphLayersChainBetter(
  chain: readonly number[],
  than: readonly number[],
): boolean {
  if (chain.length !== than.length) return chain.length > than.length;
  for (const [at, ticket] of chain.entries()) {
    const other = than[at] ?? ticket;
    if (ticket !== other) return ticket < other;
  }
  return false;
}

/** The longest chain of unfinished tickets along what waits on what. Each
 * ticket is entered once and its best chain onward kept, which only ever
 * holds tickets already finished with, so no chain names a ticket twice. */
function epicGraphLayersChainOf(
  shown: readonly number[],
  unfinished: ReadonlySet<number>,
  waitedOnBy: ReadonlyMap<number, readonly number[]>,
): readonly number[] {
  const onward = new Map<number, readonly number[]>();
  const stack = new Set<number>();
  const follow = (ticket: number): readonly number[] => {
    const known = onward.get(ticket);
    if (known !== undefined) return known;
    stack.add(ticket);
    let best: readonly number[] = [];
    for (const dependent of waitedOnBy.get(ticket) ?? []) {
      if (stack.has(dependent) || !unfinished.has(dependent)) continue;
      const along = follow(dependent);
      if (epicGraphLayersChainBetter(along, best)) best = along;
    }
    stack.delete(ticket);
    const chain = [ticket, ...best];
    onward.set(ticket, chain);
    return chain;
  };
  let longest: readonly number[] = [];
  for (const ticket of shown) {
    if (!unfinished.has(ticket)) continue;
    const chain = follow(ticket);
    if (epicGraphLayersChainBetter(chain, longest)) longest = chain;
  }
  if (new Set(longest).size !== longest.length)
    throw new Error("the longest chain names no ticket twice");
  return longest;
}

/** Every ticket reached from one along the adjacency given, itself included,
 * each once. */
function epicGraphLayersReached(
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

/** The edges with each dropped that the edges still kept join another way,
 * weighed one at a time against what is kept, so a cycle stays joined. */
export function epicGraphLayersReducedOf(
  edges: readonly EpicGraphEdgeShown[],
): readonly EpicGraphEdgeShown[] {
  const kept = new Set(edges);
  for (const edge of edges) {
    kept.delete(edge);
    const reached = epicGraphLayersReached(
      edge.from,
      epicGraphLayersAdjacency([...kept], (each) => [each.from, each.to]),
    );
    if (!reached.has(edge.to)) kept.add(edge);
  }
  return edges.filter((edge) => kept.has(edge));
}

/** The ticket alone on the last layer, where it is a member and every other
 * member is among what it waits on, all the way along. */
function epicGraphLayersGoalOf(
  layers: readonly (readonly EpicGraphTicket[])[],
  waitsOn: ReadonlyMap<number, readonly number[]>,
): number | undefined {
  const last = layers.at(-1);
  const [goal, beside] = last ?? [];
  if (layers.length < 2 || goal === undefined || beside !== undefined)
    return undefined;
  if (!goal.node.member) return undefined;
  const reached = epicGraphLayersReached(goal.node.ticket, waitsOn);
  return layers.every((layer) =>
    layer.every(
      (ticket) => !ticket.node.member || reached.has(ticket.node.ticket),
    ),
  )
    ? goal.node.ticket
    : undefined;
}

function epicGraphLayersPlacedOf(
  layers: readonly (readonly EpicGraphTicket[])[],
): (left: number, right: number) => number {
  const place = new Map<number, readonly [number, number]>();
  for (const [layer, tickets] of layers.entries())
    for (const [at, ticket] of tickets.entries())
      place.set(ticket.node.ticket, [layer, at]);
  return (left, right) => {
    const [leftLayer, leftAt] = place.get(left) ?? [0, 0];
    const [rightLayer, rightAt] = place.get(right) ?? [0, 0];
    return leftLayer - rightLayer || leftAt - rightAt;
  };
}

function epicGraphLayersPortsOf(
  shown: readonly number[],
  next: ReadonlyMap<number, readonly number[]>,
  placed: (left: number, right: number) => number,
): ReadonlyMap<number, readonly number[]> {
  return new Map(
    shown.map((ticket) => [ticket, [...(next.get(ticket) ?? [])].sort(placed)]),
  );
}

/**
 * The graph in layers, with the tickets outside the epic or without them,
 * each ticket the one `epicGraphTicketsOf` holds. A ticket named twice is
 * placed once, and an edge into a ticket not shown is left out.
 */
export function epicGraphLayeredOf(
  graph: EpicGraphResponse,
  tickets: ReadonlyMap<number, EpicGraphTicket>,
  outsideShown: boolean,
): EpicGraphLayered {
  const shownTickets = [...tickets.values()]
    .filter((ticket) => outsideShown || ticket.node.member)
    .sort((left, right) => left.node.ticket - right.node.ticket);
  const shown = shownTickets.map((ticket) => ticket.node.ticket);
  const edges = epicGraphEdgesShown(graph, new Set(shown));
  const waitsOn = epicGraphLayersAdjacency(edges, (edge) => [
    edge.to,
    edge.from,
  ]);
  const waitedOnBy = epicGraphLayersAdjacency(edges, (edge) => [
    edge.from,
    edge.to,
  ]);
  const layerOf = epicGraphLayersDepthOf(shown, waitsOn);
  const layers: EpicGraphTicket[][] = [];
  for (const ticket of shownTickets) {
    const at = (layerOf.get(ticket.node.ticket) ?? 1) - 1;
    for (let empty = layers.length; empty <= at; empty += 1) layers.push([]);
    layers[at]?.push(ticket);
  }
  for (const layer of layers)
    layer.sort(
      (left, right) =>
        epicGraphLayersStandingRank(left.standing) -
          epicGraphLayersStandingRank(right.standing) ||
        left.node.ticket - right.node.ticket,
    );
  if (layers.some((layer) => layer.length === 0))
    throw new Error("every layer up to the deepest holds a ticket");
  const placed = epicGraphLayersPlacedOf(layers);
  const unfinished = new Set(
    shownTickets
      .filter((ticket) => !epicGraphLayersFinished(ticket.standing))
      .map((ticket) => ticket.node.ticket),
  );
  return {
    tickets,
    layers,
    layerOf,
    dependsOn: epicGraphLayersPortsOf(shown, waitsOn, placed),
    blocks: epicGraphLayersPortsOf(shown, waitedOnBy, placed),
    chain: epicGraphLayersChainOf(shown, unfinished, waitedOnBy),
    goal: epicGraphLayersGoalOf(layers, waitsOn),
    edges,
    reduced: epicGraphLayersReducedOf(edges),
  };
}

/** A title split at its first `: `, the part before it a kicker. */
export interface EpicGraphTitled {
  readonly kicker: string | undefined;
  readonly rest: string;
}

export function epicGraphTitledOf(title: string): EpicGraphTitled {
  const at = title.indexOf(": ");
  return at <= 0
    ? { kicker: undefined, rest: title }
    : { kicker: title.slice(0, at), rest: title.slice(at + 2) };
}

/** The kickers too common to tell cards apart: each carried by more than half
 * of the tickets given. */
export function epicGraphKickersCommonOf(
  titles: readonly (string | undefined)[],
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const { kicker } = epicGraphTitledOf(title ?? "");
    if (kicker !== undefined) counts.set(kicker, (counts.get(kicker) ?? 0) + 1);
  }
  return new Set(
    [...counts]
      .filter(([, count]) => count * 2 > titles.length)
      .map(([kicker]) => kicker),
  );
}
