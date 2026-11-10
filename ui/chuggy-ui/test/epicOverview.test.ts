/**
 * What the epic page's Overview draws beside the description: the members
 * running and next, and the graph in small.
 */

import { expect, test } from "vitest";

import type { EpicGraphResponse } from "../../../src/contract/responses.ts";
import {
  epicGraphMemberHeight,
  epicGraphMemberWidth,
  epicGraphRankGap,
} from "../app/core/epicGraph.ts";
import { epicGraphDrawn } from "../app/core/epicGraphLayout.ts";
import {
  epicOverviewGraphOf,
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

test("the small graph draws each card a block in its state's tone and form, each edge a line, and an unlinked member in a row under them", () => {
  const drawn = epicGraphDrawn(
    graph,
    epicGraphTicketsOf(graph, new Map()),
    false,
  );
  const small = epicOverviewGraphOf(drawn);
  expect(
    small.blocks.map((block) => [block.ticket, block.tone, block.form]),
  ).toStrictEqual([
    [1, "pass", "Filled"],
    [2, "live", "Filled"],
    [3, "queued", "Tinted"],
    [4, "queued", "Tinted"],
    [5, "parked", "Filled"],
  ]);
  expect(small.lines).toHaveLength(3);
  const unlinked = small.blocks.find((block) => block.ticket === 5);
  expect(unlinked?.y).toBe(drawn.height + epicGraphRankGap);
  expect(small.height).toBe(
    drawn.height + epicGraphRankGap + epicGraphMemberHeight,
  );
  expect(small.width).toBeGreaterThanOrEqual(epicGraphMemberWidth);
});
