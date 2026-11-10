/**
 * An epic's graph as its canvas draws it: the cards in layers left to right,
 * the curves between them, the tickets outside the epic left out on asking,
 * the run a card names, and the view fitted, zoomed and bounded.
 */

import { expect, test } from "vitest";

import type {
  EpicGraphResponse,
  ProjectTicket,
} from "../../../src/contract/responses.ts";
import {
  epicGraphColumnGap,
  epicGraphConnectorPath,
  epicGraphConnectorPoint,
  epicGraphDrawn,
  epicGraphFitPadding,
  epicGraphFitted,
  epicGraphMemberHeight,
  epicGraphMemberWidth,
  epicGraphOutsideWidth,
  epicGraphRowGap,
  epicGraphRunOf,
  epicGraphStandingOf,
  epicGraphZoomed,
  epicGraphZoomLeast,
  epicGraphZoomMost,
} from "../app/core/epicGraph.ts";

const column = epicGraphMemberWidth + epicGraphColumnGap;

const graph: EpicGraphResponse = {
  nodes: [
    { ticket: 5, title: "Charge", phase: "Work", member: true },
    { ticket: 2, title: "Schema", phase: "Done", member: false },
    { ticket: 7, phase: "Pending", member: true },
    { ticket: 4, title: "Refund", phase: "Pending", member: true },
  ],
  edges: [
    { from: 2, to: 5 },
    { from: 5, to: 7 },
    { from: 5, to: 4 },
    { from: 9, to: 4 },
  ],
};

function cardsAt(drawn: ReturnType<typeof epicGraphDrawn>) {
  return new Map(drawn.cards.map((card) => [card.node.ticket, card]));
}

test("a card stands one layer past its deepest dependency, so every connector runs rightward", () => {
  const drawn = epicGraphDrawn(graph, true);
  const at = cardsAt(drawn);
  expect([2, 5, 4, 7].map((ticket) => at.get(ticket)?.x)).toStrictEqual([
    0,
    column,
    2 * column,
    2 * column,
  ]);
  expect(drawn.connectors).toHaveLength(3);
  for (const connector of drawn.connectors) {
    const [start, , , end] = connector.curve;
    expect(start.x).toBeLessThan(end.x);
  }
});

test("cards of one layer stack by ticket number, and an outside ticket's card is the smaller", () => {
  const drawn = epicGraphDrawn(graph, true);
  const at = cardsAt(drawn);
  expect(at.get(4)?.y).toBe(0);
  expect(at.get(7)?.y).toBe(epicGraphMemberHeight + epicGraphRowGap);
  expect(at.get(2)?.width).toBe(epicGraphOutsideWidth);
  expect(at.get(5)?.width).toBe(epicGraphMemberWidth);
  expect(drawn.height).toBe(2 * epicGraphMemberHeight + epicGraphRowGap);
});

test("a connector touching an outside ticket is marked, and one into a ticket the graph does not hold is undrawn", () => {
  const drawn = epicGraphDrawn(graph, true);
  expect(
    drawn.connectors.map((connector) => [
      connector.from,
      connector.to,
      connector.outside,
    ]),
  ).toStrictEqual([
    [2, 5, true],
    [5, 7, false],
    [5, 4, false],
  ]);
});

test("leaving the outside tickets out lays the graph out again without them or their connectors", () => {
  const drawn = epicGraphDrawn(graph, false);
  const at = cardsAt(drawn);
  expect(at.has(2)).toBe(false);
  expect(at.get(5)?.x).toBe(0);
  expect(at.get(4)?.x).toBe(column);
  expect(drawn.connectors.every((connector) => !connector.outside)).toBe(true);
});

test("a connector is a curve from the dependency's right edge to the dependent's left, leaving and arriving level", () => {
  const drawn = epicGraphDrawn(graph, false);
  const connector = drawn.connectors.find((each) => each.to === 4);
  if (connector === undefined) throw new Error("the connector is drawn");
  const [start, pullStart, pullEnd, end] = connector.curve;
  expect(start).toStrictEqual({
    x: epicGraphMemberWidth,
    y: epicGraphMemberHeight / 2,
  });
  expect(end).toStrictEqual({ x: column, y: epicGraphMemberHeight / 2 });
  expect(pullStart.y).toBe(start.y);
  expect(pullEnd.y).toBe(end.y);
  expect(epicGraphConnectorPath(connector)).toMatch(/^M .+ C .+, .+, .+$/u);
  expect(epicGraphConnectorPoint(connector, 0)).toStrictEqual(start);
  expect(epicGraphConnectorPoint(connector, 1)).toStrictEqual(end);
});

test("a cycle is laid out without looping and draws no backward connector", () => {
  const drawn = epicGraphDrawn(
    {
      nodes: [
        { ticket: 1, phase: "Pending", member: true },
        { ticket: 2, phase: "Pending", member: true },
      ],
      edges: [
        { from: 1, to: 2 },
        { from: 2, to: 1 },
      ],
    },
    true,
  );
  expect(drawn.cards).toHaveLength(2);
  expect(drawn.connectors).toStrictEqual([]);
});

test("an empty graph draws nothing", () => {
  expect(epicGraphDrawn({ nodes: [], edges: [] }, true)).toStrictEqual({
    cards: [],
    connectors: [],
    width: 0,
    height: 0,
  });
});

test("a pending ticket the list holds no row of is ready once every dependency the graph holds is done, and a draft stands nowhere", () => {
  const nodes = graph.nodes;
  const pending = nodes.find((node) => node.ticket === 7);
  const blocked = nodes.find((node) => node.ticket === 4);
  if (pending === undefined || blocked === undefined)
    throw new Error("the nodes are held");
  expect(epicGraphStandingOf(pending, graph)).toBe("Blocked");
  expect(
    epicGraphStandingOf(pending, {
      ...graph,
      nodes: nodes.map((node) =>
        node.ticket === 5 ? { ...node, phase: "Done" as const } : node,
      ),
    }),
  ).toBe("Ready");
  expect(epicGraphStandingOf({ ticket: 3, member: true }, graph)).toBe(
    undefined,
  );
  expect(epicGraphStandingOf(nodes[0] ?? pending, graph)).toBe("Work");
});

function latest(
  status: NonNullable<ProjectTicket["latestExecution"]>["status"],
  identity: NonNullable<ProjectTicket["latestExecution"]>["identity"],
): Pick<ProjectTicket, "latestExecution"> {
  return {
    latestExecution: {
      execution: "execution-1",
      task: 1,
      identity,
      status,
    } as NonNullable<ProjectTicket["latestExecution"]>,
  };
}

test("a card names the run under way, its stage and cycle, and none once the run has ended", () => {
  expect(
    epicGraphRunOf(
      latest("Running", { type: "WorkTask", value: { ticket: 5, cycle: 2 } }),
    ),
  ).toStrictEqual({ run: "Work", cycle: 2 });
  expect(
    epicGraphRunOf(
      latest("Queued", {
        type: "EvaluationTask",
        value: {
          ticket: 5,
          workCycle: 3,
          stage: 1,
          generation: 1,
          evaluator: 0,
        },
      }),
    ),
  ).toStrictEqual({ run: "Evaluation", cycle: 3, stage: 1 });
  for (const status of ["Terminal", "Cancelled"] as const)
    expect(
      epicGraphRunOf(
        latest(status, { type: "WorkTask", value: { ticket: 5, cycle: 2 } }),
      ),
    ).toBe(undefined);
  expect(epicGraphRunOf({ latestExecution: undefined })).toBe(undefined);
  expect(epicGraphRunOf(undefined)).toBe(undefined);
});

test("the graph opens centred and fitted with its padding, and never zoomed in past its own size", () => {
  const small = epicGraphFitted(
    { width: 200, height: 100 },
    { width: 1000, height: 500 },
  );
  expect(small).toStrictEqual({ x: 400, y: 200, zoom: 1 });
  const wide = epicGraphFitted(
    { width: 4000, height: 100 },
    { width: 1000 + 2 * epicGraphFitPadding, height: 500 },
  );
  expect(wide.zoom).toBe(0.25);
  expect(wide.x).toBe(epicGraphFitPadding);
  const vast = epicGraphFitted(
    { width: 100_000, height: 100 },
    { width: 1000, height: 500 },
  );
  expect(vast.zoom).toBe(epicGraphZoomLeast);
});

test("a frame not yet measured shows the graph at its own size inside the padding", () => {
  expect(
    epicGraphFitted({ width: 200, height: 100 }, { width: 0, height: 0 }),
  ).toStrictEqual({ x: epicGraphFitPadding, y: epicGraphFitPadding, zoom: 1 });
});

test("zooming keeps the frame's centre where it was and stays within its bounds", () => {
  const frame = { width: 800, height: 400 };
  const view = { x: 100, y: 50, zoom: 1 };
  const zoomed = epicGraphZoomed(view, 2, frame);
  expect(zoomed.zoom).toBe(2);
  const centreBefore = (400 - view.x) / view.zoom;
  const centreAfter = (400 - zoomed.x) / zoomed.zoom;
  expect(centreAfter).toBeCloseTo(centreBefore);
  expect(epicGraphZoomed(view, 10, frame).zoom).toBe(epicGraphZoomMost);
  expect(epicGraphZoomed(view, 0.01, frame).zoom).toBe(epicGraphZoomLeast);
});
