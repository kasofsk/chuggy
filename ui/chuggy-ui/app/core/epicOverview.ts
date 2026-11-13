/**
 * What the epic page's Overview draws beside the description: the members
 * running, the ones next, and the graph in small, its layers lines of tiles
 * filled by state, the longest chain threaded through them, and the goal a
 * bar that fills as what it waits on is done.
 */

import type { EpicGraphPoint } from "./epicGraph.ts";
import type { EpicGraphLayered } from "./epicGraphLayers.ts";
import { epicTicketsGroupOf } from "./epicTickets.ts";
import type { EpicTicketsGroup, EpicTicketsMember } from "./epicTickets.ts";
import type { TicketStateStanding } from "./ticketHeader.ts";

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

/** The aside's inner width, which the small graph is drawn to fill. */
export const epicOverviewGraphWidth = 230;
/** Left of the tiles, where each layer's spine stands. */
export const epicOverviewGraphGutter = 10;
export const epicOverviewGraphSpine = 2;
/** The larger tile sizes tried, largest first, each with the gap between its tiles. */
export const epicOverviewGraphSizes: readonly {
  readonly size: number;
  readonly gap: number;
}[] = [
  { size: 28, gap: 6 },
  { size: 20, gap: 5 },
];
/** The size taken where no larger one keeps the widest layer on one line. */
export const epicOverviewGraphSizeLeast = { size: 14, gap: 4 } as const;
/** The size at which a tile carries its number. */
export const epicOverviewGraphNumbered = 28;

export interface EpicOverviewTile {
  readonly ticket: number;
  readonly group: EpicTicketsGroup;
  readonly x: number;
  readonly y: number;
  /** On the longest chain, which rings it. */
  readonly step: boolean;
}

/** A layer's spine, filled from its top to the share of the layer done. */
export interface EpicOverviewSpine {
  readonly y: number;
  readonly height: number;
  readonly filled: number;
}

/** The goal as a bar across the tiles, filled to the share of what it waits on
 * that is done. */
export interface EpicOverviewGoal {
  readonly ticket: number;
  readonly group: EpicTicketsGroup;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly filled: number;
  readonly step: boolean;
}

/** One step of the longest chain to the next, bottom centre to top centre. */
export interface EpicOverviewLink {
  readonly from: EpicGraphPoint;
  readonly to: EpicGraphPoint;
}

export interface EpicOverviewGraph {
  readonly size: number;
  readonly numbered: boolean;
  readonly tiles: readonly EpicOverviewTile[];
  readonly spines: readonly EpicOverviewSpine[];
  readonly goal: EpicOverviewGoal | undefined;
  readonly links: readonly EpicOverviewLink[];
  readonly width: number;
  readonly height: number;
}

/** The largest tile that keeps the widest layer on one line, and the smallest
 * where none does. */
export function epicOverviewGraphSizeOf(
  widest: number,
  room: number,
): { readonly size: number; readonly gap: number } {
  const fits = epicOverviewGraphSizes.find(
    ({ size, gap }) => widest * size + (widest - 1) * gap <= room,
  );
  return fits ?? epicOverviewGraphSizeLeast;
}

function epicOverviewGraphShareDone(
  standings: readonly TicketStateStanding[],
): number {
  if (standings.length === 0) return 0;
  const done = standings.filter((standing) => standing === "Done").length;
  return done / standings.length;
}

/** A layer's tiles in centred lines, as many to a line as the room takes. */
function epicOverviewGraphLinesOf(
  layer: EpicGraphLayered["layers"][number],
  top: number,
  room: number,
  sized: { readonly size: number; readonly gap: number },
  chain: ReadonlySet<number>,
): { readonly tiles: readonly EpicOverviewTile[]; readonly height: number } {
  const { size, gap } = sized;
  const perLine = Math.max(1, Math.floor((room + gap) / (size + gap)));
  const lines = Math.ceil(layer.length / perLine);
  const tiles = layer.map((ticket, at): EpicOverviewTile => {
    const line = Math.floor(at / perLine);
    const across = Math.min(perLine, layer.length - line * perLine);
    const left =
      epicOverviewGraphGutter +
      (room - (across * size + (across - 1) * gap)) / 2;
    return {
      ticket: ticket.node.ticket,
      group: epicTicketsGroupOf(ticket.standing),
      x: left + (at % perLine) * (size + gap),
      y: top + line * (size + gap),
      step: chain.has(ticket.node.ticket),
    };
  });
  return { tiles, height: lines * size + (lines - 1) * gap };
}

/** Each step of the chain to the next: tile to tile, and into the goal
 * straight down. */
function epicOverviewGraphLinksOf(
  chain: readonly number[],
  tiles: ReadonlyMap<number, EpicOverviewTile>,
  goal: EpicOverviewGoal | undefined,
  size: number,
): readonly EpicOverviewLink[] {
  const links: EpicOverviewLink[] = [];
  for (const [at, ticket] of chain.entries()) {
    const from = tiles.get(ticket);
    const next = chain[at + 1];
    if (from === undefined || next === undefined) continue;
    const start = { x: from.x + size / 2, y: from.y + size };
    const to = tiles.get(next);
    if (to !== undefined)
      links.push({ from: start, to: { x: to.x + size / 2, y: to.y } });
    else if (goal?.ticket === next)
      links.push({ from: start, to: { x: start.x, y: goal.y } });
  }
  return links;
}

/**
 * The layering in small, as wide as it is given: a spine in the gutter for
 * each layer, each layer's tiles in centred lines, the goal a bar across the
 * last, and the longest chain threaded through. The layering is drawn as it
 * is handed, so the tickets outside the epic are left out by leaving them out
 * of it.
 */
export function epicOverviewGraphOf(
  layered: EpicGraphLayered,
  width: number,
): EpicOverviewGraph {
  const room = width - epicOverviewGraphGutter;
  const { goal } = layered;
  const layers =
    goal === undefined ? layered.layers : layered.layers.slice(0, -1);
  const sized = epicOverviewGraphSizeOf(
    Math.max(1, ...layers.map((layer) => layer.length)),
    room,
  );
  const between = Math.round(sized.size * 0.6) + 4;
  const chain = new Set(layered.chain);
  const tiles: EpicOverviewTile[] = [];
  const spines: EpicOverviewSpine[] = [];
  let top = 0;
  for (const layer of layers) {
    const lines = epicOverviewGraphLinesOf(layer, top, room, sized, chain);
    tiles.push(...lines.tiles);
    const share = epicOverviewGraphShareDone(
      layer.map((ticket) => ticket.standing),
    );
    spines.push({ y: top, height: lines.height, filled: share });
    top += lines.height + between;
  }
  const goalDrawn = epicOverviewGraphGoalOf(layered, top, room, sized.size);
  if (goalDrawn !== undefined)
    spines.push({
      y: goalDrawn.y,
      height: goalDrawn.height,
      filled: goalDrawn.group === "Done" ? 1 : 0,
    });
  const bottom =
    goalDrawn === undefined ? top - between : top + goalDrawn.height;
  return {
    size: sized.size,
    numbered: sized.size === epicOverviewGraphNumbered,
    tiles,
    spines,
    goal: goalDrawn,
    links: epicOverviewGraphLinksOf(
      layered.chain,
      new Map(tiles.map((tile) => [tile.ticket, tile])),
      goalDrawn,
      sized.size,
    ),
    width,
    height: Math.max(0, bottom),
  };
}

/** The goal's bar under the last layer, filled to the share of every other
 * ticket shown that is done, each of which it waits on. */
function epicOverviewGraphGoalOf(
  layered: EpicGraphLayered,
  top: number,
  room: number,
  size: number,
): EpicOverviewGoal | undefined {
  const { goal } = layered;
  const ticket = goal === undefined ? undefined : layered.tickets.get(goal);
  if (goal === undefined || ticket === undefined) return undefined;
  const waitedOn = layered.layers
    .slice(0, -1)
    .flatMap((layer) => layer.map((each) => each.standing));
  return {
    ticket: goal,
    group: epicTicketsGroupOf(ticket.standing),
    x: epicOverviewGraphGutter,
    y: top,
    width: room,
    height: Math.max(10, Math.round(size * 0.7)),
    filled: epicOverviewGraphShareDone(waitedOn),
    step: layered.chain.includes(goal),
  };
}
