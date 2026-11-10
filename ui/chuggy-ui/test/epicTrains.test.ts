/**
 * The trains on an epic's graph: found by setting a read beside the one
 * before, each phase lasting its own span, a travelling train on its
 * connector's curve, and every train at rest where no motion is drawn.
 */

import { expect, test } from "vitest";

import {
  epicGraphConnectorPoint,
  epicGraphDrawn,
} from "../app/core/epicGraph.ts";
import {
  epicTrainDepartingMs,
  epicTrainEmergingMs,
  epicTrainEnteringMs,
  epicTrainMovingMs,
  epicTrainPhaseAt,
  epicTrainPose,
  epicTrainRestingAt,
  epicTrainsOf,
  epicTrainsReadSame,
  epicTrainTravellingMs,
} from "../app/core/epicTrains.ts";
import type { EpicTrainGround } from "../app/core/epicTrains.ts";

const drawn = epicGraphDrawn(
  {
    nodes: [
      { ticket: 1, phase: "Work", member: true },
      { ticket: 2, phase: "Pending", member: true },
      { ticket: 3, phase: "Pending", member: true },
    ],
    edges: [
      { from: 1, to: 2 },
      { from: 1, to: 3 },
    ],
  },
  true,
);

const ground: EpicTrainGround = {
  cardOf: (ticket) => drawn.cards.find((card) => card.node.ticket === ticket),
  connectorOf: (from, to) =>
    drawn.connectors.find(
      (connector) => connector.from === from && connector.to === to,
    ),
};

function restingOn(ticket: number) {
  const card = ground.cardOf(ticket);
  if (card === undefined) throw new Error("the card is drawn");
  return epicTrainRestingAt(card);
}

test("the first read only places a resting train on every member with a run under way", () => {
  expect(
    epicTrainsOf(undefined, { running: [1, 3], done: [] }, drawn.connectors),
  ).toStrictEqual([
    { train: "Resting", ticket: 1 },
    { train: "Resting", ticket: 3 },
  ]);
});

test("a member whose run began since the read before has a train emerge, unless a dependency of it finished", () => {
  const before = { running: [], done: [] };
  expect(
    epicTrainsOf(before, { running: [1], done: [] }, drawn.connectors),
  ).toStrictEqual([{ train: "Emerging", ticket: 1 }]);
  expect(
    epicTrainsOf(
      { running: [1], done: [] },
      { running: [1], done: [] },
      drawn.connectors,
    ),
  ).toStrictEqual([{ train: "Resting", ticket: 1 }]);
});

test("a dependency finishing as its dependent starts sends its train along the connector between them", () => {
  expect(
    epicTrainsOf(
      { running: [1], done: [] },
      { running: [2], done: [1] },
      drawn.connectors,
    ),
  ).toStrictEqual([{ train: "Relaying", from: 1, to: 2 }]);
  expect(
    epicTrainsOf(
      { running: [], done: [] },
      { running: [3], done: [1] },
      drawn.connectors,
    ),
  ).toStrictEqual([{ train: "Relaying", from: 1, to: 3 }]);
});

test("two reads draw the same trains when the same members run and the same tickets are done", () => {
  expect(
    epicTrainsReadSame(
      { running: [1, 2], done: [3] },
      { running: [1, 2], done: [3] },
    ),
  ).toBe(true);
  expect(
    epicTrainsReadSame({ running: [1], done: [] }, { running: [2], done: [] }),
  ).toBe(false);
  expect(
    epicTrainsReadSame({ running: [1], done: [] }, { running: [1], done: [2] }),
  ).toBe(false);
});

test("an emerging train grows from its card over its own span, then rests", () => {
  const train = { train: "Emerging", ticket: 1 } as const;
  expect(epicTrainPhaseAt(train, 0)).toStrictEqual({
    phase: "Emerging",
    share: 0,
  });
  const half = epicTrainPose(train, epicTrainEmergingMs / 2, ground);
  expect(half).toMatchObject({ phase: "Emerging", scale: 0.5, opacity: 0.5 });
  expect(half?.at).toStrictEqual(restingOn(1));
  expect(epicTrainPose(train, epicTrainEmergingMs, ground)).toMatchObject({
    phase: "Resting",
    scale: 1,
    opacity: 1,
  });
  expect(epicTrainMovingMs(train)).toBe(epicTrainEmergingMs);
});

test("a relaying train leaves its card, travels the connector's curve and enters the dependent's, each over its own span", () => {
  const train = { train: "Relaying", from: 1, to: 2 } as const;
  const connector = ground.connectorOf(1, 2);
  if (connector === undefined) throw new Error("the connector is drawn");
  const [start, , , end] = connector.curve;
  expect(epicTrainPose(train, 0, ground)).toMatchObject({
    phase: "Departing",
    at: restingOn(1),
  });
  expect(
    epicTrainPose(train, epicTrainDepartingMs - 1e-9, ground)?.at.x,
  ).toBeCloseTo(start.x);
  const travelling = epicTrainDepartingMs + epicTrainTravellingMs / 2;
  expect(epicTrainPose(train, travelling, ground)).toMatchObject({
    phase: "Travelling",
    at: epicGraphConnectorPoint(connector, 0.5),
  });
  expect(
    epicTrainPose(train, epicTrainDepartingMs + epicTrainTravellingMs, ground),
  ).toMatchObject({ phase: "Entering", at: end });
  const movingMs =
    epicTrainDepartingMs + epicTrainTravellingMs + epicTrainEnteringMs;
  expect(epicTrainMovingMs(train)).toBe(movingMs);
  expect(epicTrainPose(train, movingMs, ground)).toMatchObject({
    phase: "Resting",
    at: restingOn(2),
  });
});

test("where no motion is drawn every train is at its rest: an emerging one on its card, a relaying one on its dependent", () => {
  expect(
    epicTrainPose({ train: "Emerging", ticket: 3 }, Infinity, ground),
  ).toStrictEqual({ phase: "Resting", at: restingOn(3), scale: 1, opacity: 1 });
  expect(
    epicTrainPose({ train: "Relaying", from: 1, to: 2 }, Infinity, ground),
  ).toStrictEqual({ phase: "Resting", at: restingOn(2), scale: 1, opacity: 1 });
});

test("a relay whose connector is not drawn rests on its dependent, and a train on a card not drawn is not drawn", () => {
  expect(
    epicTrainPose({ train: "Relaying", from: 9, to: 2 }, 0, ground),
  ).toMatchObject({ phase: "Resting", at: restingOn(2) });
  expect(epicTrainPose({ train: "Resting", ticket: 9 }, 0, ground)).toBe(
    undefined,
  );
});
