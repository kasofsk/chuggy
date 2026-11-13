/**
 * An epic's graph in layers: each ticket on the layer of the longest path to
 * it, each layer by standing then number, ports in placed order, the longest
 * unfinished chain, the goal, and the edges no other path implies, over a
 * graph shaped like a large epic, a cycle, a ticket with no edges, and the
 * tickets outside the epic shown and hidden.
 */

import { expect, test } from "vitest";

import type { EpicGraphResponse } from "../../../src/contract/responses.ts";
import {
  epicGraphKickersCommonOf,
  epicGraphLayeredOf,
  epicGraphLayersReducedOf,
  epicGraphLayersStandingRank,
  epicGraphTitledOf,
} from "../app/core/epicGraphLayers.ts";
import type { EpicGraphLayered } from "../app/core/epicGraphLayers.ts";
import { epicGraphTicketsOf } from "../app/core/epics.ts";

type EpicGraphNode = EpicGraphResponse["nodes"][number];

function layeredOf(
  graph: EpicGraphResponse,
  outsideShown = true,
): EpicGraphLayered {
  return epicGraphLayeredOf(
    graph,
    epicGraphTicketsOf(graph, new Map()),
    outsideShown,
  );
}

function numbers(layered: EpicGraphLayered): readonly (readonly number[])[] {
  return layered.layers.map((layer) =>
    layer.map((ticket) => ticket.node.ticket),
  );
}

const largeMembers = 61;
const largeEdges = 223;
const largeFirst = 520;
const largeGoal = largeFirst + largeMembers - 1;
const largeOutside = 581;
/** How far apart, in members, the tickets each member is waited on by. */
const largeStrides = [7, 13, 20, 27];

/** A graph shaped like a large epic: members whose numbers rise along every
 * edge, one ticket outside that the goal waits on, and a goal that waits on
 * every other ticket. */
function largeGraph(): EpicGraphResponse {
  const nodes: EpicGraphNode[] = [];
  for (let at = 0; at < largeMembers; at += 1)
    nodes.push({
      ticket: largeFirst + at,
      title: at % 3 === 0 ? `Console primitive: Part ${String(at)}` : `Part`,
      phase: at < 12 ? "Done" : at === 20 ? "Work" : "Pending",
      member: true,
    });
  nodes.push({
    ticket: largeOutside,
    title: "Configuration: approval",
    phase: "Done",
    member: false,
  });
  const edges: { from: number; to: number }[] = [];
  for (let at = 0; at < largeMembers - 1; at += 1)
    edges.push({ from: largeFirst + at, to: largeGoal });
  edges.push({ from: largeOutside, to: largeGoal });
  for (const stride of largeStrides)
    for (let at = 0; at + stride < largeMembers - 1; at += 1)
      if (edges.length < largeEdges)
        edges.push({ from: largeFirst + at, to: largeFirst + at + stride });
  return { nodes, edges };
}

test("the large graph is shaped as its fixture says", () => {
  const graph = largeGraph();
  expect(graph.nodes.filter((node) => node.member)).toHaveLength(largeMembers);
  expect(graph.nodes.filter((node) => !node.member)).toHaveLength(1);
  expect(graph.edges).toHaveLength(largeEdges);
});

test("every edge of an acyclic graph runs from a layer to a later one, and each ticket sits one past the deepest it waits on", () => {
  const layered = layeredOf(largeGraph());
  expect(layered.edges).toHaveLength(largeEdges);
  for (const edge of layered.edges)
    expect(layered.layerOf.get(edge.to) ?? 0).toBeGreaterThan(
      layered.layerOf.get(edge.from) ?? 0,
    );
  for (const [ticket, layer] of layered.layerOf) {
    const deepest = Math.max(
      0,
      ...(layered.dependsOn.get(ticket) ?? []).map(
        (dependency) => layered.layerOf.get(dependency) ?? 0,
      ),
    );
    expect(layer).toBe(deepest + 1);
  }
  expect(layered.layers.flat()).toHaveLength(largeMembers + 1);
});

test("the goal is alone on the last layer and waits on every other ticket, the one outside included", () => {
  const layered = layeredOf(largeGraph());
  expect(layered.goal).toBe(largeGoal);
  expect(numbers(layered).at(-1)).toStrictEqual([largeGoal]);
  expect(layered.dependsOn.get(largeGoal)).toHaveLength(largeMembers);
  const hidden = layeredOf(largeGraph(), false);
  expect(hidden.goal).toBe(largeGoal);
  expect(hidden.dependsOn.get(largeGoal)).toHaveLength(largeMembers - 1);
});

test("a ticket's ports are in placed order, layer then place in it, both ways", () => {
  const layered = layeredOf(largeGraph());
  const placed = new Map(
    layered.layers.flatMap((layer, at) =>
      layer.map((ticket, place) => [ticket.node.ticket, [at, place]] as const),
    ),
  );
  const ordered = (tickets: readonly number[]) =>
    [...tickets].sort((left, right) => {
      const [leftLayer = 0, leftAt = 0] = placed.get(left) ?? [];
      const [rightLayer = 0, rightAt = 0] = placed.get(right) ?? [];
      return leftLayer - rightLayer || leftAt - rightAt;
    });
  for (const ports of [layered.dependsOn, layered.blocks])
    for (const tickets of ports.values())
      expect(tickets).toStrictEqual(ordered(tickets));
  expect(layered.dependsOn.get(largeGoal)?.[0]).toBe(largeFirst);
});

test("a layer is ordered Done, then running and escalated, then Ready, then Blocked, then the rest, then by number", () => {
  const graph: EpicGraphResponse = {
    nodes: [
      { ticket: 1, phase: "Pending", member: true },
      { ticket: 2, phase: "Revoked", member: true },
      { ticket: 3, member: true },
      { ticket: 4, phase: "Escalated", member: true },
      { ticket: 5, phase: "Evaluation", member: true },
      { ticket: 6, phase: "Done", member: true },
      { ticket: 7, phase: "Pending", member: true },
      { ticket: 8, phase: "Done", member: true },
      { ticket: 9, phase: "Work", member: true },
      { ticket: 10, phase: "Pending", member: true },
    ],
    edges: [
      { from: 9, to: 10 },
      { from: 9, to: 1 },
      { from: 6, to: 7 },
    ],
  };
  const layered = layeredOf(graph);
  expect(numbers(layered)).toStrictEqual([
    [6, 8, 4, 5, 9, 2, 3],
    [7, 1, 10],
  ]);
  expect(layered.layers[1]?.map((ticket) => ticket.standing)).toStrictEqual([
    "Ready",
    "Blocked",
    "Blocked",
  ]);
  expect(epicGraphLayersStandingRank("Finalization")).toBe(
    epicGraphLayersStandingRank("Work"),
  );
});

test("a ticket with no edges is in the first layer, and no goal is named for a graph that does not lead to one", () => {
  const layered = layeredOf({
    nodes: [
      { ticket: 1, phase: "Pending", member: true },
      { ticket: 2, phase: "Pending", member: true },
      { ticket: 3, phase: "Pending", member: true },
    ],
    edges: [{ from: 1, to: 2 }],
  });
  expect(numbers(layered)).toStrictEqual([[1, 3], [2]]);
  expect(layered.goal).toBe(undefined);
  expect(layered.dependsOn.get(3)).toStrictEqual([]);
  expect(layered.blocks.get(3)).toStrictEqual([]);
  expect(layeredOf({ nodes: [], edges: [] }).layers).toStrictEqual([]);
  expect(
    layeredOf({ nodes: [{ ticket: 1, member: true }], edges: [] }).goal,
  ).toBe(undefined);
});

test("a cycle is layered, chained and reduced without looping, its tickets kept joined", () => {
  const layered = layeredOf({
    nodes: [
      { ticket: 1, phase: "Pending", member: true },
      { ticket: 2, phase: "Pending", member: true },
      { ticket: 3, phase: "Pending", member: true },
      { ticket: 3, phase: "Pending", member: true },
    ],
    edges: [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 1 },
      { from: 1, to: 1 },
    ],
  });
  expect(layered.layers.flat()).toHaveLength(3);
  expect(layered.edges).toHaveLength(3);
  expect(layered.chain).toStrictEqual([1, 2, 3]);
  expect(layered.reduced).toStrictEqual(layered.edges);
});

test("the tickets outside the epic and their edges are placed only while shown, and still held either way", () => {
  const graph: EpicGraphResponse = {
    nodes: [
      { ticket: 9, phase: "Done", member: false },
      { ticket: 1, phase: "Pending", member: true },
      { ticket: 2, phase: "Pending", member: true },
    ],
    edges: [
      { from: 9, to: 1 },
      { from: 1, to: 2 },
      { from: 9, to: 8 },
    ],
  };
  const shown = layeredOf(graph, true);
  expect(numbers(shown)).toStrictEqual([[9], [1], [2]]);
  expect(shown.dependsOn.get(1)).toStrictEqual([9]);
  const hidden = layeredOf(graph, false);
  expect(numbers(hidden)).toStrictEqual([[1], [2]]);
  expect(hidden.dependsOn.get(1)).toStrictEqual([]);
  expect(hidden.edges).toStrictEqual([{ from: 1, to: 2 }]);
  expect(hidden.tickets.has(9)).toBe(true);
});

test("the longest chain runs through unfinished tickets only, and a tie goes to the lower numbers", () => {
  const layered = layeredOf({
    nodes: [
      { ticket: 1, phase: "Done", member: true },
      { ticket: 2, phase: "Pending", member: true },
      { ticket: 3, phase: "Pending", member: true },
      { ticket: 4, phase: "Pending", member: true },
      { ticket: 5, phase: "Pending", member: true },
      { ticket: 6, phase: "Revoked", member: true },
      { ticket: 7, phase: "Pending", member: true },
    ],
    edges: [
      { from: 1, to: 2 },
      { from: 2, to: 4 },
      { from: 3, to: 4 },
      { from: 2, to: 5 },
      { from: 3, to: 5 },
      { from: 5, to: 6 },
      { from: 6, to: 7 },
    ],
  });
  expect(layered.chain).toStrictEqual([2, 4]);
  expect(layeredOf(largeGraph()).chain).toStrictEqual([
    532,
    539,
    546,
    553,
    560,
    567,
    574,
    largeGoal,
  ]);
});

test("the large graph's chain is a path of unfinished tickets no other is longer than", () => {
  const graph = largeGraph();
  const layered = layeredOf(graph);
  const done = new Set(
    graph.nodes.filter((node) => node.phase === "Done").map((n) => n.ticket),
  );
  const joined = new Set(
    layered.edges.map((edge) => `${edge.from}-${edge.to}`),
  );
  for (const [at, ticket] of layered.chain.entries()) {
    expect(done.has(ticket)).toBe(false);
    const next = layered.chain[at + 1];
    if (next !== undefined) expect(joined.has(`${ticket}-${next}`)).toBe(true);
  }
  const longest = new Map<number, number>();
  for (const layer of [...layered.layers].reverse())
    for (const { node } of layer)
      longest.set(
        node.ticket,
        done.has(node.ticket)
          ? 0
          : 1 +
              Math.max(
                0,
                ...(layered.blocks.get(node.ticket) ?? []).map(
                  (next) => longest.get(next) ?? 0,
                ),
              ),
      );
  expect(layered.chain).toHaveLength(Math.max(...longest.values()));
});

test("the reduction drops each edge another path implies and keeps every one none does", () => {
  const layered = layeredOf(largeGraph());
  const reachable = (
    from: number,
    to: number,
    edges: readonly { from: number; to: number }[],
  ) => {
    const reached = new Set([from]);
    const waiting = [from];
    for (let at = 0; at < waiting.length; at += 1)
      for (const edge of edges)
        if (edge.from === waiting[at] && !reached.has(edge.to)) {
          reached.add(edge.to);
          waiting.push(edge.to);
        }
    return reached.has(to);
  };
  const kept = new Set(layered.reduced);
  expect(kept.size).toBeLessThan(layered.edges.length);
  for (const edge of layered.edges) {
    const others = layered.reduced.filter((other) => other !== edge);
    expect(reachable(edge.from, edge.to, others)).toBe(!kept.has(edge));
  }
  expect(
    epicGraphLayersReducedOf([
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 1, to: 3 },
    ]),
  ).toStrictEqual([
    { from: 1, to: 2 },
    { from: 2, to: 3 },
  ]);
});

test("a title's label before its first colon is a kicker, and one most cards carry is too common to show", () => {
  expect(epicGraphTitledOf("Console primitive: PageHeader")).toStrictEqual({
    kicker: "Console primitive",
    rest: "PageHeader",
  });
  expect(epicGraphTitledOf("TabNav")).toStrictEqual({
    kicker: undefined,
    rest: "TabNav",
  });
  expect(epicGraphTitledOf(": odd")).toStrictEqual({
    kicker: undefined,
    rest: ": odd",
  });
  expect(
    epicGraphKickersCommonOf(["API: a", "API: b", "API: c", "Gate: d", "e"]),
  ).toStrictEqual(new Set(["API"]));
  expect(
    epicGraphKickersCommonOf(["API: a", "API: b", "Gate: c", undefined]),
  ).toStrictEqual(new Set());
});
