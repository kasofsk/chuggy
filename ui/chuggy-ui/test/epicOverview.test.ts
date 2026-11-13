/**
 * What the epic page's Overview draws beside the description: the members
 * running and next, and the graph in small as layers of tiles in the width
 * the aside gives it.
 */

import { expect, test } from "vitest";

import type { EpicGraphResponse } from "../../../src/contract/responses.ts";
import { epicGraphLayeredOf } from "../app/core/epicGraphLayers.ts";
import {
  epicOverviewGraphGutter,
  epicOverviewGraphOf,
  epicOverviewGraphWidth,
  epicOverviewListsOf,
} from "../app/core/epicOverview.ts";
import { epicGraphTicketsOf } from "../app/core/epics.ts";
import { epicTicketsMembersOf } from "../app/core/epicTickets.ts";

const graph: EpicGraphResponse = {
  nodes: [
    { ticket: 1, title: "One", phase: "Done", member: true },
    { ticket: 2, title: "Two", phase: "Work", member: true },
    { ticket: 3, title: "Three", phase: "Pending", member: true },
    { ticket: 4, title: "Four", phase: "Pending", member: true },
    { ticket: 5, title: "Five", phase: "Escalated", member: true },
  ],
  edges: [
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
  ],
};

function listsOf(drawing: EpicGraphResponse) {
  const tickets = epicGraphTicketsOf(drawing, new Map());
  const members = epicTicketsMembersOf(
    drawing.nodes.filter((node) => node.member).map((node) => node.ticket),
    new Map(),
    drawing,
  );
  return epicOverviewListsOf(
    members,
    new Map([...tickets].map(([ticket, held]) => [ticket, held.standing])),
  );
}

test("Next falls back to the Blocked members whose every unfinished dependency is running, and leaves out one waiting on a Blocked one", () => {
  const lists = listsOf(graph);
  expect(lists.running.map((member) => member.ticket)).toStrictEqual([2]);
  expect(
    lists.next.map((member) => [member.ticket, member.after]),
  ).toStrictEqual([[3, [2]]]);
});

test("Next holds only the Ready members where there are any", () => {
  const lists = listsOf({
    ...graph,
    nodes: [
      ...graph.nodes,
      { ticket: 6, title: "Six", phase: "Pending", member: true },
    ],
  });
  expect(lists.next.map((member) => member.ticket)).toStrictEqual([6]);
});

type EpicGraphNode = EpicGraphResponse["nodes"][number];

/** The graph in small at the aside's width, the tickets outside left out. */
function smallOf(drawing: EpicGraphResponse) {
  return epicOverviewGraphOf(
    epicGraphLayeredOf(drawing, epicGraphTicketsOf(drawing, new Map()), false),
    epicOverviewGraphWidth,
  );
}

/** As many members as asked, none waiting on another, so one layer. */
function layerOf(count: number): EpicGraphResponse {
  const nodes: EpicGraphNode[] = [];
  for (let at = 1; at <= count; at += 1)
    nodes.push({ ticket: at, phase: "Pending", member: true });
  return { nodes, edges: [] };
}

test("the tiles are the largest size that keeps the widest layer on one line, centred after the gutter", () => {
  const sizes = [6, 7, 12, 13].map((count) => {
    const small = smallOf(layerOf(count));
    return [count, small.size, small.numbered, small.height];
  });
  expect(sizes).toStrictEqual([
    [6, 28, true, 28],
    [7, 20, false, 20],
    [12, 14, false, 14],
    [13, 14, false, 14 + 4 + 14],
  ]);
  const six = smallOf(layerOf(6));
  const room = epicOverviewGraphWidth - epicOverviewGraphGutter;
  expect(six.tiles[0]?.x).toBe(epicOverviewGraphGutter + (room - 198) / 2);
  expect(six.tiles.map((tile) => tile.y)).toStrictEqual([0, 0, 0, 0, 0, 0]);
});

test("a layer wider than the smallest tiles take on one line wraps into centred lines", () => {
  const small = smallOf(layerOf(13));
  expect([...new Set(small.tiles.map((tile) => tile.y))]).toStrictEqual([
    0, 18,
  ]);
  expect(
    small.tiles.filter((tile) => tile.y === 18).map((tile) => tile.x),
  ).toStrictEqual([epicOverviewGraphGutter + (220 - 14) / 2]);
  for (const tile of small.tiles) {
    expect(tile.x).toBeGreaterThanOrEqual(epicOverviewGraphGutter);
    expect(tile.x + small.size).toBeLessThanOrEqual(epicOverviewGraphWidth);
  }
});

/** 1 and 2, Done, are waited on by 3, Ready, which 4 waits on; 5 waits on
 * every other member and so is the goal, and 9 is outside the epic. */
const goalGraph: EpicGraphResponse = {
  nodes: [
    { ticket: 1, phase: "Done", member: true },
    { ticket: 2, phase: "Done", member: true },
    { ticket: 3, phase: "Pending", member: true },
    { ticket: 4, phase: "Pending", member: true },
    { ticket: 5, phase: "Pending", member: true },
    { ticket: 9, phase: "Done", member: false },
  ],
  edges: [
    { from: 1, to: 3 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 4, to: 5 },
    { from: 9, to: 1 },
  ],
};

test("the layers stand apart by a gap the tile size sets, each with a spine filled to its share done, and the goal is a bar across the last", () => {
  const small = smallOf(goalGraph);
  expect(small.size).toBe(28);
  const between = Math.round(28 * 0.6) + 4;
  expect(
    small.tiles.map((tile) => [tile.ticket, tile.group, tile.y]),
  ).toStrictEqual([
    [1, "Done", 0],
    [2, "Done", 0],
    [3, "Ready", 28 + between],
    [4, "Blocked", 2 * (28 + between)],
  ]);
  expect(small.goal).toStrictEqual({
    ticket: 5,
    group: "Blocked",
    x: epicOverviewGraphGutter,
    y: 3 * (28 + between),
    width: epicOverviewGraphWidth - epicOverviewGraphGutter,
    height: Math.round(28 * 0.7),
    filled: 2 / 4,
    step: true,
  });
  expect(
    small.spines.map((spine) => [spine.y, spine.height, spine.filled]),
  ).toStrictEqual([
    [0, 28, 1],
    [28 + between, 28, 0],
    [2 * (28 + between), 28, 0],
    [3 * (28 + between), Math.round(28 * 0.7), 0],
  ]);
  expect(small.height).toBe(3 * (28 + between) + Math.round(28 * 0.7));
});

test("the goal bar is never thinner than its least height", () => {
  const nodes: EpicGraphNode[] = [];
  const edges: { from: number; to: number }[] = [];
  for (let at = 1; at <= 13; at += 1) {
    nodes.push({ ticket: at, phase: "Done", member: true });
    edges.push({ from: at, to: 14 });
  }
  nodes.push({ ticket: 14, phase: "Pending", member: true });
  const small = smallOf({ nodes, edges });
  expect(small.size).toBe(14);
  expect(small.goal?.height).toBe(10);
  expect(small.goal?.filled).toBe(1);
});

test("the longest chain rings its tiles and runs from each step's bottom centre to the next one's top centre, and into the goal straight down", () => {
  const small = smallOf(goalGraph);
  expect(
    small.tiles.filter((tile) => tile.step).map((tile) => tile.ticket),
  ).toStrictEqual([3, 4]);
  const three = small.tiles.find((tile) => tile.ticket === 3);
  const four = small.tiles.find((tile) => tile.ticket === 4);
  if (three === undefined || four === undefined || small.goal === undefined)
    throw new Error("the chain's tiles and the goal are drawn");
  expect(small.links).toStrictEqual([
    {
      from: { x: three.x + 14, y: three.y + 28 },
      to: { x: four.x + 14, y: four.y },
    },
    {
      from: { x: four.x + 14, y: four.y + 28 },
      to: { x: four.x + 14, y: small.goal.y },
    },
  ]);
});

test("the tickets outside the epic are left out of the small graph", () => {
  const small = smallOf(goalGraph);
  expect(small.tiles.some((tile) => tile.ticket === 9)).toBe(false);
  expect(small.goal?.ticket).toBe(5);
});
