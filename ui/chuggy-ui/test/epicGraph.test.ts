/**
 * An epic's graph as its Graph tab lays it out: top to bottom, each edge's
 * dependent under its dependency, the members with no edge in a row of their
 * own, an edge out of a Done ticket met, the chain a card traces, the ticket
 * selected where the address names none, and the scale it is drawn at.
 */

import { expect, test } from "vitest";

import type { EpicGraphResponse } from "../../../src/contract/responses.ts";
import {
  epicGraphDrawn,
  epicGraphEdgeKeyOf,
  epicGraphEdgePath,
  epicGraphMemberHeight,
  epicGraphMemberWidth,
  epicGraphNeighboursOf,
  epicGraphOutsideHeight,
  epicGraphOutsideWidth,
  epicGraphScaleLeast,
  epicGraphScaleOf,
  epicGraphScrollOf,
  epicGraphSelectedOf,
  epicGraphTraced,
} from "../app/core/epicGraph.ts";
import { epicGraphStandingOf } from "../app/core/epics.ts";
import type { ProjectTableRow } from "../app/core/projectTableRows.ts";

const noRows: ReadonlyMap<number, ProjectTableRow> = new Map();

/** A chain 1 → 2 → 3 with a branch 2 → 4, an outside ticket 9 that 3 waits
 * on, and a member 6 nothing touches. */
const graph: EpicGraphResponse = {
  nodes: [
    { ticket: 1, title: "Schema", phase: "Done", member: true },
    { ticket: 2, title: "Charge", phase: "Work", member: true },
    { ticket: 3, title: "Refund", phase: "Pending", member: true },
    { ticket: 4, title: "Invoice", phase: "Pending", member: true },
    { ticket: 6, title: "Ledger", phase: "Pending", member: true },
    { ticket: 9, title: "Billing API", phase: "Done", member: false },
  ],
  edges: [
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 2, to: 4 },
    { from: 9, to: 3 },
    { from: 9, to: 8 },
  ],
};

function cardsAt(drawn: ReturnType<typeof epicGraphDrawn>) {
  return new Map(drawn.cards.map((card) => [card.node.ticket, card]));
}

test("every edge's dependent is laid out below its dependency", () => {
  const drawn = epicGraphDrawn(graph, noRows, true);
  const at = cardsAt(drawn);
  expect(drawn.edges.length).toBe(4);
  for (const edge of drawn.edges) {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (from === undefined || to === undefined)
      throw new Error("both ends are laid out");
    expect(to.y).toBeGreaterThanOrEqual(from.y + from.height);
    const first = edge.points[0];
    const last = edge.points.at(-1);
    expect(first?.y).toBeLessThan(last?.y ?? Number.NaN);
  }
});

test("a member is a card of the member's size and a ticket outside the epic a smaller one", () => {
  const at = cardsAt(epicGraphDrawn(graph, noRows, true));
  expect([at.get(2)?.width, at.get(2)?.height]).toStrictEqual([
    epicGraphMemberWidth,
    epicGraphMemberHeight,
  ]);
  expect([at.get(9)?.width, at.get(9)?.height]).toStrictEqual([
    epicGraphOutsideWidth,
    epicGraphOutsideHeight,
  ]);
  expect(epicGraphOutsideWidth).toBeLessThan(epicGraphMemberWidth);
});

test("a member with no edge either way is left out of the layout and stands in the row under it", () => {
  const drawn = epicGraphDrawn(graph, noRows, true);
  expect(cardsAt(drawn).has(6)).toBe(false);
  expect(drawn.unconnected.map((ticket) => ticket.node.ticket)).toStrictEqual([
    6,
  ]);
  for (const card of drawn.cards) {
    expect(card.x + card.width).toBeLessThanOrEqual(drawn.width);
    expect(card.y + card.height).toBeLessThanOrEqual(drawn.height);
  }
});

test("an edge out of a Done ticket is met, and one out of any other is not", () => {
  const drawn = epicGraphDrawn(graph, noRows, true);
  expect(
    drawn.edges.map((edge) => [edge.from, edge.to, edge.met, edge.outside]),
  ).toStrictEqual([
    [1, 2, true, false],
    [2, 3, false, false],
    [2, 4, false, false],
    [9, 3, true, true],
  ]);
});

test("a member's state is its row's where the list holds one, and the graph's where it holds none", () => {
  const row = {
    ticket: 4,
    phase: "Pending",
    openDependencies: [],
    revokedDependencies: [],
  } as unknown as ProjectTableRow;
  const drawn = epicGraphDrawn(graph, new Map([[4, row]]), true);
  expect(drawn.tickets.get(4)?.standing).toBe("Ready");
  expect(drawn.tickets.get(3)?.standing).toBe("Blocked");
  expect(drawn.tickets.get(2)?.standing).toBe("Work");
  const drafted = epicGraphDrawn(
    { ...graph, nodes: [...graph.nodes, { ticket: 7, member: true }] },
    noRows,
    true,
  );
  expect(drafted.tickets.get(7)?.standing).toBe("Draft");
});

test("leaving the outside tickets out lays the graph out again without them or their edges", () => {
  const drawn = epicGraphDrawn(graph, noRows, false);
  expect(cardsAt(drawn).has(9)).toBe(false);
  expect(drawn.tickets.has(9)).toBe(true);
  expect(drawn.edges.every((edge) => !edge.outside)).toBe(true);
});

test("a member whose only edge is to a ticket left out joins the row under the graph", () => {
  const drawn = epicGraphDrawn(
    {
      nodes: [
        { ticket: 1, phase: "Pending", member: true },
        { ticket: 5, phase: "Work", member: false },
      ],
      edges: [{ from: 5, to: 1 }],
    },
    noRows,
    false,
  );
  expect(drawn.cards).toStrictEqual([]);
  expect(drawn.unconnected.map((ticket) => ticket.node.ticket)).toStrictEqual([
    1,
  ]);
  expect([drawn.width, drawn.height]).toStrictEqual([0, 0]);
});

test("a cycle is laid out without looping, and a ticket named twice is drawn once", () => {
  const drawn = epicGraphDrawn(
    {
      nodes: [
        { ticket: 1, phase: "Pending", member: true },
        { ticket: 2, phase: "Pending", member: true },
        { ticket: 2, phase: "Pending", member: true },
      ],
      edges: [
        { from: 1, to: 2 },
        { from: 2, to: 1 },
        { from: 1, to: 1 },
      ],
    },
    noRows,
    true,
  );
  expect(drawn.cards).toHaveLength(2);
  expect(drawn.edges).toHaveLength(2);
  expect(epicGraphTraced(1, drawn.edges).tickets).toStrictEqual(
    new Set([1, 2]),
  );
});

test("an edge is a smooth curve through every point the layout routed it by, from the first to the last", () => {
  expect(
    epicGraphEdgePath([
      { x: 0, y: 0 },
      { x: 0, y: 60 },
    ]),
  ).toBe("M 0 0 L 0 60");
  const path = epicGraphEdgePath([
    { x: 0, y: 0 },
    { x: 6, y: 30 },
    { x: 12, y: 60 },
  ]);
  expect(path).toMatch(/^M 0 0 L 1 5 C .+ C .+ L 12 60$/u);
  expect(epicGraphEdgePath([])).toBe("");
});

test("a card traces everything it waits on and everything waiting on it, all the way along, with the edges between them", () => {
  const drawn = epicGraphDrawn(graph, noRows, true);
  const trace = epicGraphTraced(2, drawn.edges);
  expect([...trace.tickets].sort()).toStrictEqual([1, 2, 3, 4]);
  expect([...trace.edges].sort()).toStrictEqual(["1-2", "2-3", "2-4"]);
  const fromThree = epicGraphTraced(3, drawn.edges);
  expect([...fromThree.tickets].sort()).toStrictEqual([1, 2, 3, 9]);
  expect(fromThree.edges.has("2-4")).toBe(false);
  expect(
    drawn.edges.filter((edge) => fromThree.edges.has(epicGraphEdgeKeyOf(edge))),
  ).toHaveLength(3);
});

test("the ticket selected is the one the address names, else the first running member, else the first Ready one, else the topmost", () => {
  const drawn = epicGraphDrawn(graph, noRows, true);
  expect(epicGraphSelectedOf(drawn, 4)).toBe(4);
  expect(epicGraphSelectedOf(drawn, 9)).toBe(9);
  expect(epicGraphSelectedOf(drawn, 404)).toBe(2);
  expect(epicGraphSelectedOf(drawn, undefined)).toBe(2);
  const idle = epicGraphDrawn(
    {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.ticket === 2 || node.ticket === 4
          ? { ...node, phase: "Done" as const }
          : node,
      ),
    },
    noRows,
    true,
  );
  expect(epicGraphSelectedOf(idle, undefined)).toBe(3);
  const settled = epicGraphDrawn(
    {
      nodes: [
        { ticket: 5, phase: "Done", member: true },
        { ticket: 4, phase: "Done", member: true },
      ],
      edges: [{ from: 5, to: 4 }],
    },
    noRows,
    true,
  );
  expect(epicGraphSelectedOf(settled, undefined)).toBe(5);
  expect(
    epicGraphSelectedOf(
      epicGraphDrawn({ nodes: [], edges: [] }, noRows, true),
      undefined,
    ),
  ).toBe(undefined);
});

test("what a ticket depends on and what it blocks are each listed once, lowest number first", () => {
  expect(epicGraphNeighboursOf(graph, 3)).toStrictEqual({
    dependsOn: [2, 9],
    blocks: [],
  });
  expect(epicGraphNeighboursOf(graph, 2)).toStrictEqual({
    dependsOn: [1],
    blocks: [3, 4],
  });
});

test("the graph scales to its panel's width, never past its own size nor under the least", () => {
  expect(epicGraphScaleOf(500, 1000)).toBe(1);
  expect(epicGraphScaleOf(1000, 900)).toBe(0.9);
  expect(epicGraphScaleOf(1000, 300)).toBe(epicGraphScaleLeast);
  expect(epicGraphScaleOf(1000, 0)).toBe(1);
});

test("a panel narrower than the graph opens scrolled to centre the selection, within what it can scroll", () => {
  expect(epicGraphScrollOf(600, 1000, 400)).toBe(400);
  expect(epicGraphScrollOf(100, 1000, 400)).toBe(0);
  expect(epicGraphScrollOf(990, 1000, 400)).toBe(600);
  expect(epicGraphScrollOf(200, 300, 400)).toBe(0);
});

test("a pending ticket the list holds no row of is ready once every dependency the graph holds is done, and a draft stands nowhere", () => {
  const pending = graph.nodes.find((node) => node.ticket === 3);
  if (pending === undefined) throw new Error("the node is held");
  expect(epicGraphStandingOf(pending, graph)).toBe("Blocked");
  expect(
    epicGraphStandingOf(pending, {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.ticket === 2 ? { ...node, phase: "Done" as const } : node,
      ),
    }),
  ).toBe("Ready");
  expect(epicGraphStandingOf({ ticket: 7, member: true }, graph)).toBe(
    undefined,
  );
});
