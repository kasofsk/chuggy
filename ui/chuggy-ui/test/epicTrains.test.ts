/**
 * The trains on an epic's graph: found by setting a read beside the ones
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
  epicTrainsFinishedReadsMax,
  epicTrainsReadSame,
  epicTrainsSeenFirst,
  epicTrainsSeenNext,
  epicTrainTravellingMs,
} from "../app/core/epicTrains.ts";
import type {
  EpicTrainGround,
  EpicTrainsRead,
  EpicTrainsSeen,
} from "../app/core/epicTrains.ts";

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

/** A read of the graph above, holding its tickets and any Done beside them. */
function graphRead(read: {
  readonly running: readonly number[];
  readonly done: readonly number[];
}): EpicTrainsRead {
  return {
    ...read,
    held: [...new Set([1, 2, 3, ...read.done])].sort((a, b) => a - b),
  };
}

function seenAfter(
  ...given: readonly { running: number[]; done: number[] }[]
): EpicTrainsSeen {
  const [first, ...rest] = given.map(graphRead);
  if (first === undefined) throw new Error("a read is given");
  return rest.reduce(
    (seen, read) => epicTrainsSeenNext(seen, read, drawn.connectors),
    epicTrainsSeenFirst(first),
  );
}

test("the first read only places a resting train on every member with a run under way", () => {
  expect(
    epicTrainsSeenFirst(graphRead({ running: [1, 3], done: [] })).trains,
  ).toStrictEqual([
    { train: "Resting", ticket: 1 },
    { train: "Resting", ticket: 3 },
  ]);
});

test("a member whose run began since the read before has a train emerge, unless a dependency of it finished", () => {
  expect(
    seenAfter({ running: [], done: [] }, { running: [1], done: [] }).trains,
  ).toStrictEqual([{ train: "Emerging", ticket: 1 }]);
  expect(
    seenAfter({ running: [1], done: [] }, { running: [1], done: [] }).trains,
  ).toStrictEqual([{ train: "Resting", ticket: 1 }]);
});

test("a dependency finishing as its dependent starts sends its train along the connector between them", () => {
  expect(
    seenAfter({ running: [1], done: [] }, { running: [2], done: [1] }).trains,
  ).toStrictEqual([{ train: "Relaying", from: 1, to: 2 }]);
  expect(
    seenAfter({ running: [], done: [] }, { running: [3], done: [1] }).trains,
  ).toStrictEqual([{ train: "Relaying", from: 1, to: 3 }]);
});

test("a dependency that finished in reads of its own before its dependent starts still sends its train", () => {
  const seen = seenAfter(
    { running: [1], done: [] },
    { running: [], done: [] },
    { running: [], done: [1] },
    { running: [2], done: [1] },
  );
  expect(seen.trains).toStrictEqual([{ train: "Relaying", from: 1, to: 2 }]);
});

test("a dependency's finish sends no train once it is further back than the window of reads, the one its dependent starts in included", () => {
  const finishing = [
    { running: [1], done: [] },
    { running: [], done: [1] },
  ];
  const between = Array.from(
    { length: epicTrainsFinishedReadsMax - 1 },
    (_, at) => ({ running: [], done: [1, 10 + at] }),
  );
  const starting = {
    running: [2],
    done: [1, ...between.map((read) => read.done[1] ?? 0)],
  };
  expect(seenAfter(...finishing, ...between, starting).trains).toStrictEqual([
    { train: "Emerging", ticket: 2 },
  ]);
  const within = between.slice(1);
  expect(
    seenAfter(...finishing, ...within, {
      running: [2],
      done: [1, ...within.map((read) => read.done[1] ?? 0)],
    }).trains,
  ).toStrictEqual([{ train: "Relaying", from: 1, to: 2 }]);
});

test("a read that leaves a member running keeps the very train it had", () => {
  const relayed = seenAfter(
    { running: [1], done: [] },
    { running: [2], done: [1] },
  );
  const [train] = relayed.trains;
  const after = epicTrainsSeenNext(
    relayed,
    graphRead({ running: [2, 3], done: [1] }),
    drawn.connectors,
  );
  expect(after.trains[0]).toBe(train);
  expect(after.trains[1]).toStrictEqual({ train: "Relaying", from: 1, to: 3 });
});

test("two reads draw the same trains when the same members run and the graph holds the same tickets, the same of them done", () => {
  const read = (
    running: number[],
    done: number[],
    held = [1, 2, 3],
  ): EpicTrainsRead => ({ running, held, done });
  expect(epicTrainsReadSame(read([1, 2], [3]), read([1, 2], [3]))).toBe(true);
  expect(epicTrainsReadSame(read([1], []), read([2], []))).toBe(false);
  expect(epicTrainsReadSame(read([1], []), read([1], [2]))).toBe(false);
  expect(epicTrainsReadSame(read([1], []), read([1], [], [1, 2, 3, 4]))).toBe(
    false,
  );
});

test("a ticket new to the graph and already Done did not finish, so its dependent's train emerges", () => {
  const before: EpicTrainsRead = { running: [], held: [2, 3], done: [] };
  const after: EpicTrainsRead = { running: [2], held: [1, 2, 3], done: [1] };
  expect(
    epicTrainsSeenNext(epicTrainsSeenFirst(before), after, drawn.connectors)
      .trains,
  ).toStrictEqual([{ train: "Emerging", ticket: 2 }]);
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
