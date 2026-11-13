/**
 * The lines an epic's graph is drawn with for one look at it. At rest the
 * longest chain is threaded from each step's card to the next step's port.
 * With a ticket in focus, a strong line runs from each of its dependencies to
 * its port for that one and from it to the port each dependent holds for it,
 * met where the dependency is Done, with a knot where each starts; where the
 * focus's chain up and down is small enough to read, its reduced edges are
 * drawn faint beneath. Each kind is one path's `d`, so a look is a handful of
 * elements however many lines it holds.
 *
 * Every line is a cubic from the bottom centre of the dependency's card to the
 * centre of the port, or to the top centre of a card with no port for it.
 */

import { epicGraphEdgeKey, epicGraphTraced } from "./epicGraph.ts";
import type { EpicGraphPoint } from "./epicGraph.ts";
import type { EpicGraphLayered } from "./epicGraphLayers.ts";

/** A card where it was measured, against the drawing its lines are in. */
export interface EpicGraphPlacedCard {
  readonly top: EpicGraphPoint;
  readonly bottom: EpicGraphPoint;
}

/** Where the cards and their ports were measured, each port by the key of
 * the edge from its dependency to the card holding it. */
export interface EpicGraphPlaced {
  readonly cards: ReadonlyMap<number, EpicGraphPlacedCard>;
  readonly ports: ReadonlyMap<string, EpicGraphPoint>;
}

/** What the lines are drawn for: the ticket in focus, or the longest chain
 * while nothing is, where it is drawn. */
export interface EpicGraphLook {
  readonly focus: number | undefined;
  readonly chain: boolean;
}

/** Each kind of line as one path's `d`, empty where it draws nothing. */
export interface EpicGraphLines {
  readonly faint: string;
  readonly strong: string;
  readonly met: string;
  readonly chain: string;
  readonly knots: string;
}

/** The most tickets a focus's chain may hold for its reduced edges to be
 * drawn faint. */
export const epicGraphLinesFaintTicketsMax = 16;
/** The least a curve leaves its card and enters its port by. */
export const epicGraphLinesBendLeast = 26;
export const epicGraphLinesKnotRadius = 2.5;

export const epicGraphPlacedNone: EpicGraphPlaced = {
  cards: new Map(),
  ports: new Map(),
};

/** Whether two looks draw the same lines. */
export function epicGraphLookSame(
  left: EpicGraphLook,
  right: EpicGraphLook,
): boolean {
  return left.focus === right.focus && left.chain === right.chain;
}

function epicGraphLinesFigure(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function epicGraphLinesPoint(point: EpicGraphPoint): string {
  return `${epicGraphLinesFigure(point.x)},${epicGraphLinesFigure(point.y)}`;
}

/** The cubic from one point down to another. */
export function epicGraphLinesCurve(
  from: EpicGraphPoint,
  to: EpicGraphPoint,
): string {
  const bend = Math.max(epicGraphLinesBendLeast, Math.abs(to.y - from.y) / 2);
  return `M${epicGraphLinesPoint(from)}C${epicGraphLinesPoint({ x: from.x, y: from.y + bend })} ${epicGraphLinesPoint({ x: to.x, y: to.y - bend })} ${epicGraphLinesPoint(to)}`;
}

function epicGraphLinesKnot(at: EpicGraphPoint): string {
  const radius = epicGraphLinesKnotRadius;
  const across = epicGraphLinesFigure(radius * 2);
  const arc = `a${String(radius)},${String(radius)} 0 1,0`;
  return `M${epicGraphLinesPoint({ x: at.x - radius, y: at.y })}${arc} ${across},0${arc} -${across},0`;
}

/** The line from a dependency to what waits on it, where both were measured:
 * its start, and its `d`. */
function epicGraphLinesEdge(
  placed: EpicGraphPlaced,
  from: number,
  to: number,
): { readonly start: EpicGraphPoint; readonly d: string } | undefined {
  const start = placed.cards.get(from)?.bottom;
  const end =
    placed.ports.get(epicGraphEdgeKey(from, to)) ?? placed.cards.get(to)?.top;
  if (start === undefined || end === undefined) return undefined;
  return { start, d: epicGraphLinesCurve(start, end) };
}

/** The strong lines into and out of the ticket in focus, split by whether
 * the dependency is Done, and a knot at each start. */
function epicGraphLinesStrongOf(
  layered: EpicGraphLayered,
  focus: number,
  placed: EpicGraphPlaced,
): Pick<EpicGraphLines, "strong" | "met" | "knots"> {
  const strong: string[] = [];
  const met: string[] = [];
  const knots = new Map<string, string>();
  const edges: readonly (readonly [number, number])[] = [
    ...(layered.dependsOn.get(focus) ?? []).map(
      (from) => [from, focus] as const,
    ),
    ...(layered.blocks.get(focus) ?? []).map((to) => [focus, to] as const),
  ];
  for (const [from, to] of edges) {
    const line = epicGraphLinesEdge(placed, from, to);
    if (line === undefined) continue;
    const done = layered.tickets.get(from)?.standing === "Done";
    (done ? met : strong).push(line.d);
    knots.set(epicGraphLinesPoint(line.start), epicGraphLinesKnot(line.start));
  }
  return {
    strong: strong.join(""),
    met: met.join(""),
    knots: [...knots.values()].join(""),
  };
}

/** The reduced edges along the focus's chain up and down, where that chain
 * holds few enough tickets. */
function epicGraphLinesFaintOf(
  layered: EpicGraphLayered,
  focus: number,
  placed: EpicGraphPlaced,
): string {
  const traced = epicGraphTraced(focus, layered.edges);
  if (traced.tickets.size > epicGraphLinesFaintTicketsMax) return "";
  return layered.reduced
    .filter((edge) => traced.edges.has(epicGraphEdgeKey(edge.from, edge.to)))
    .map((edge) => epicGraphLinesEdge(placed, edge.from, edge.to)?.d ?? "")
    .join("");
}

function epicGraphLinesChainOf(
  chain: readonly number[],
  placed: EpicGraphPlaced,
): string {
  return chain
    .slice(1)
    .map((to, at) => {
      const from = chain[at];
      if (from === undefined) return "";
      return epicGraphLinesEdge(placed, from, to)?.d ?? "";
    })
    .join("");
}

export function epicGraphLinesOf(
  layered: EpicGraphLayered,
  look: EpicGraphLook,
  placed: EpicGraphPlaced,
): EpicGraphLines {
  const none = { faint: "", strong: "", met: "", chain: "", knots: "" };
  if (look.focus === undefined)
    return look.chain
      ? { ...none, chain: epicGraphLinesChainOf(layered.chain, placed) }
      : none;
  return {
    ...none,
    faint: epicGraphLinesFaintOf(layered, look.focus, placed),
    ...epicGraphLinesStrongOf(layered, look.focus, placed),
  };
}

/** Whether a card's port for a dependency is lit: a strong line lands on it,
 * because the card or that dependency is the ticket in focus. */
export function epicGraphPortLit(
  focus: number | undefined,
  holder: number,
  dependency: number,
): boolean {
  return focus !== undefined && (focus === holder || focus === dependency);
}
