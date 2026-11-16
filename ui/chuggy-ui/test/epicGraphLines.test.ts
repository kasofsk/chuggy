/**
 * An epic graph's lines for one look: the curve each is drawn as, its ends at
 * a card's foot and a port or a card's top, the longest chain at rest, the
 * strong lines into and out of the ticket in focus split by whether the
 * dependency is Done with a knot at each start, the faint reduced edges of a
 * small enough chain, and which ports are lit.
 */

import { expect, test } from "vitest";

import type { EpicGraphResponse } from "../../../src/contract/responses.ts";
import { epicGraphEdgeKey } from "../app/core/epicGraph.ts";
import { epicGraphLayeredOf } from "../app/core/epicGraphLayers.ts";
import type { EpicGraphLayered } from "../app/core/epicGraphLayers.ts";
import {
  epicGraphLinesCurve,
  epicGraphLinesFaintTicketsMax,
  epicGraphLinesOf,
  epicGraphPortLit,
} from "../app/core/epicGraphLines.ts";
import type { EpicGraphPlaced } from "../app/core/epicGraphLines.ts";
import { epicGraphTicketsOf } from "../app/core/epics.ts";

function layeredOf(graph: EpicGraphResponse): EpicGraphLayered {
  return epicGraphLayeredOf(graph, epicGraphTicketsOf(graph, new Map()), true);
}

/** Each card a column by its number and a row by its layer, every port
 * measured but those `portless` names, by the key of its edge. */
function placedOf(
  layered: EpicGraphLayered,
  portless: readonly string[] = [],
): EpicGraphPlaced {
  const cards = new Map<
    number,
    { top: { x: number; y: number }; bottom: { x: number; y: number } }
  >();
  for (const [ticket, layer] of layered.layerOf)
    cards.set(ticket, {
      top: { x: ticket * 10, y: layer * 100 },
      bottom: { x: ticket * 10, y: layer * 100 + 60 },
    });
  const ports = new Map<string, { x: number; y: number }>();
  for (const [ticket, dependencies] of layered.dependsOn)
    for (const [at, dependency] of dependencies.entries()) {
      const key = epicGraphEdgeKey(dependency, ticket);
      const top = cards.get(ticket)?.top;
      if (top !== undefined && !portless.includes(key))
        ports.set(key, { x: top.x + at, y: top.y });
    }
  return { cards, ports };
}

/** 1 (Done) and 2 → 3 → 4, and 3 → 5. */
const branched: EpicGraphResponse = {
  nodes: [
    { ticket: 1, phase: "Done", member: true },
    { ticket: 2, phase: "Pending", member: true },
    { ticket: 3, phase: "Pending", member: true },
    { ticket: 4, phase: "Pending", member: true },
    { ticket: 5, phase: "Pending", member: true },
  ],
  edges: [
    { from: 1, to: 3 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 3, to: 5 },
    { from: 2, to: 4 },
  ],
};

test("a line is the cubic from its start down to its end, bent by half the drop and never by less than the least bend", () => {
  expect(epicGraphLinesCurve({ x: 10, y: 60 }, { x: 40, y: 300 })).toBe(
    "M10,60C10,180 40,180 40,300",
  );
  expect(epicGraphLinesCurve({ x: 10, y: 60 }, { x: 40, y: 80 })).toBe(
    "M10,60C10,86 40,54 40,80",
  );
  expect(epicGraphLinesCurve({ x: 0.04, y: 1 / 3 }, { x: 1, y: 2 })).toBe(
    "M0,0.3C0,26.3 1,-24 1,2",
  );
});

test("at rest the longest chain is threaded from each step's foot to the next step's port, and nothing else is drawn", () => {
  const layered = layeredOf(branched);
  expect(layered.chain).toStrictEqual([2, 3, 4]);
  const lines = epicGraphLinesOf(
    layered,
    { focus: undefined, chain: true },
    placedOf(layered),
  );
  expect(lines).toStrictEqual({
    faint: "",
    strong: "",
    met: "",
    chain:
      epicGraphLinesCurve({ x: 20, y: 160 }, { x: 31, y: 200 }) +
      epicGraphLinesCurve({ x: 30, y: 260 }, { x: 41, y: 300 }),
    knots: "",
  });
  expect(
    epicGraphLinesOf(
      layered,
      { focus: undefined, chain: false },
      placedOf(layered),
    ),
  ).toStrictEqual({ faint: "", strong: "", met: "", chain: "", knots: "" });
});

test("a ticket in focus draws a strong line from each dependency to its port and to each dependent's port for it, met where the dependency is Done, a knot at each start", () => {
  const layered = layeredOf(branched);
  const lines = epicGraphLinesOf(
    layered,
    { focus: 3, chain: true },
    placedOf(layered),
  );
  expect(lines.chain).toBe("");
  expect(lines.met).toBe(
    epicGraphLinesCurve({ x: 10, y: 160 }, { x: 30, y: 200 }),
  );
  const strong = lines.strong.match(/M[^M]+/gu) ?? [];
  expect(strong).toStrictEqual([
    epicGraphLinesCurve({ x: 20, y: 160 }, { x: 31, y: 200 }),
    epicGraphLinesCurve({ x: 30, y: 260 }, { x: 41, y: 300 }),
    epicGraphLinesCurve({ x: 30, y: 260 }, { x: 50, y: 300 }),
  ]);
  expect(lines.knots.match(/M[^M]+/gu)).toStrictEqual([
    "M7.5,160a2.5,2.5 0 1,0 5,0a2.5,2.5 0 1,0 -5,0",
    "M17.5,160a2.5,2.5 0 1,0 5,0a2.5,2.5 0 1,0 -5,0",
    "M27.5,260a2.5,2.5 0 1,0 5,0a2.5,2.5 0 1,0 -5,0",
  ]);
});

test("a dependent with no port for the ticket takes its card's top centre, and a ticket not measured draws no line", () => {
  const layered = layeredOf(branched);
  const lines = epicGraphLinesOf(
    layered,
    { focus: 3, chain: false },
    placedOf(layered, [epicGraphEdgeKey(3, 5)]),
  );
  expect(lines.strong).toContain(
    epicGraphLinesCurve({ x: 30, y: 260 }, { x: 50, y: 300 }),
  );
  const placed = placedOf(layered);
  const cards = new Map(placed.cards);
  cards.delete(1);
  expect(
    epicGraphLinesOf(layered, { focus: 3, chain: false }, { ...placed, cards })
      .met,
  ).toBe("");
});

test("a chain small enough draws its reduced edges faint, and the edges another path implies not at all", () => {
  const layered = layeredOf(branched);
  const faint = epicGraphLinesOf(
    layered,
    { focus: 4, chain: false },
    placedOf(layered),
  ).faint.match(/M[^M]+/gu);
  expect(faint).toStrictEqual([
    epicGraphLinesCurve({ x: 10, y: 160 }, { x: 30, y: 200 }),
    epicGraphLinesCurve({ x: 20, y: 160 }, { x: 31, y: 200 }),
    epicGraphLinesCurve({ x: 30, y: 260 }, { x: 41, y: 300 }),
  ]);
});

test("a chain of more tickets than the most draws nothing faint", () => {
  const count = epicGraphLinesFaintTicketsMax + 1;
  const tickets = Array.from({ length: count }, (_, at) => at + 1);
  const layered = layeredOf({
    nodes: tickets.map((ticket) => ({
      ticket,
      phase: "Pending",
      member: true,
    })),
    edges: tickets.slice(1).map((ticket) => ({ from: ticket - 1, to: ticket })),
  });
  const placed = placedOf(layered);
  expect(
    epicGraphLinesOf(layered, { focus: 2, chain: false }, placed).faint,
  ).toBe("");
  const fewer = layeredOf({
    nodes: tickets.slice(1).map((ticket) => ({
      ticket,
      phase: "Pending",
      member: true,
    })),
    edges: tickets.slice(2).map((ticket) => ({ from: ticket - 1, to: ticket })),
  });
  expect(
    epicGraphLinesOf(fewer, { focus: 2, chain: false }, placedOf(fewer)).faint,
  ).not.toBe("");
});

test("a port is lit where its card or its dependency is the ticket in focus, and none is with nothing in focus", () => {
  expect(epicGraphPortLit(3, 3, 1)).toBe(true);
  expect(epicGraphPortLit(3, 4, 3)).toBe(true);
  expect(epicGraphPortLit(3, 4, 2)).toBe(false);
  expect(epicGraphPortLit(undefined, 4, 2)).toBe(false);
});
