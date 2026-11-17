/**
 * An epic's graph however it is drawn: a ticket's state, the edges between
 * the tickets shown, the chain a card traces, the ticket selected, and what a
 * ticket waits on and what waits on it.
 */

import { expect, test } from "vitest";

import type { EpicGraphResponse } from "../../../src/contract/responses.ts";
import {
  epicGraphEdgeKey,
  epicGraphEdgesShown,
  epicGraphNeighboursOf,
  epicGraphSelectedOf,
  epicGraphTraced,
} from "../app/core/epicGraph.ts";
import { epicGraphStandingOf, epicGraphTicketsOf } from "../app/core/epics.ts";
import type { ProjectTableRow } from "../app/core/projectTableRows.ts";

const noRows: ReadonlyMap<number, ProjectTableRow> = new Map();

/** The edges between every ticket a graph names. */
function edgesOf(drawing: EpicGraphResponse) {
  return epicGraphEdgesShown(
    drawing,
    new Set(drawing.nodes.map((node) => node.ticket)),
  );
}

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

test("a member's state is its row's where the list holds one, and the graph's where it holds none", () => {
  const row = {
    ticket: 4,
    phase: "Pending",
    openDependencies: [],
    revokedDependencies: [],
  } as unknown as ProjectTableRow;
  const tickets = epicGraphTicketsOf(graph, new Map([[4, row]]));
  expect(tickets.get(4)?.standing).toBe("Ready");
  expect(tickets.get(3)?.standing).toBe("Blocked");
  expect(tickets.get(2)?.standing).toBe("Work");
  const drafted = epicGraphTicketsOf(
    { ...graph, nodes: [...graph.nodes, { ticket: 7, member: true }] },
    noRows,
  );
  expect(drafted.get(7)?.standing).toBe("Draft");
});

test("a cycle is traced without looping, and an edge named twice or from a ticket to itself is shown once or not at all", () => {
  const edges = edgesOf({
    nodes: [
      { ticket: 1, phase: "Pending", member: true },
      { ticket: 2, phase: "Pending", member: true },
      { ticket: 2, phase: "Pending", member: true },
    ],
    edges: [
      { from: 1, to: 2 },
      { from: 2, to: 1 },
      { from: 1, to: 2 },
      { from: 1, to: 1 },
    ],
  });
  expect(edges).toStrictEqual([
    { from: 1, to: 2 },
    { from: 2, to: 1 },
  ]);
  expect(epicGraphTraced(1, edges).tickets).toStrictEqual(new Set([1, 2]));
});

test("a card traces everything it waits on and everything waiting on it, all the way along, with the edges between them", () => {
  const edges = edgesOf(graph);
  const trace = epicGraphTraced(2, edges);
  expect([...trace.tickets].sort()).toStrictEqual([1, 2, 3, 4]);
  expect([...trace.edges].sort()).toStrictEqual(["1-2", "2-3", "2-4"]);
  const fromThree = epicGraphTraced(3, edges);
  expect([...fromThree.tickets].sort()).toStrictEqual([1, 2, 3, 9]);
  expect(fromThree.edges.has("2-4")).toBe(false);
  expect(
    edges.filter((edge) =>
      fromThree.edges.has(epicGraphEdgeKey(edge.from, edge.to)),
    ),
  ).toHaveLength(3);
});

test("the ticket selected is the one the address names where the graph holds it, and none otherwise", () => {
  const tickets = epicGraphTicketsOf(graph, noRows);
  expect(epicGraphSelectedOf(tickets, 4)).toBe(4);
  expect(epicGraphSelectedOf(tickets, 9)).toBe(9);
  expect(epicGraphSelectedOf(tickets, 404)).toBe(undefined);
  expect(epicGraphSelectedOf(tickets, undefined)).toBe(undefined);
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
