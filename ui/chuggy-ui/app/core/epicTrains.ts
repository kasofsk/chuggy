/**
 * The trains an epic's graph draws its work in motion with, found by setting
 * one read of the graph beside the read before it.
 *
 * A train rests on every member with a run under way. A member whose run
 * began since the read before has one that emerges from its card, unless a
 * dependency of it finished in the same span: then the train leaves that
 * dependency's card, travels the connector between them along its curve, and
 * enters the member's. The first read has nothing before it, so its trains
 * only rest.
 *
 * Each phase lasts its own span, and where a train stands at a moment is
 * decided here from how long it has been moving, so a reader who takes no
 * motion is drawn the place a train comes to rest and nothing on the way.
 */

import { epicGraphConnectorPoint } from "./epicGraph.ts";
import type {
  EpicGraphCard,
  EpicGraphConnector,
  EpicGraphPoint,
} from "./epicGraph.ts";

/** What of one read of the graph its trains are found from. */
export interface EpicTrainsRead {
  /** The members with a run under way, ascending. */
  readonly running: readonly number[];
  /** The tickets drawn that are Done, ascending. */
  readonly done: readonly number[];
}

export type EpicTrain =
  | { readonly train: "Resting"; readonly ticket: number }
  | { readonly train: "Emerging"; readonly ticket: number }
  | { readonly train: "Relaying"; readonly from: number; readonly to: number };

export const epicTrainEmergingMs = 600;
export const epicTrainDepartingMs = 400;
export const epicTrainTravellingMs = 1200;
export const epicTrainEnteringMs = 400;

/** The side of the square a train is drawn in, in the canvas's units. */
export const epicTrainSize = 28;
/** How far in from its card's lower right corner a resting train stands. */
const epicTrainInset = 8;

/** Whether two reads would draw the same trains. */
export function epicTrainsReadSame(
  left: EpicTrainsRead,
  right: EpicTrainsRead,
): boolean {
  const same = (a: readonly number[], b: readonly number[]) =>
    a.length === b.length && a.every((ticket, at) => b[at] === ticket);
  return same(left.running, right.running) && same(left.done, right.done);
}

/** Whether a ticket's run ended, or it came to be Done, between two reads. */
function epicTrainsFinished(
  previous: EpicTrainsRead,
  next: EpicTrainsRead,
  ticket: number,
): boolean {
  return (
    (previous.running.includes(ticket) && !next.running.includes(ticket)) ||
    (!previous.done.includes(ticket) && next.done.includes(ticket))
  );
}

/** One train for each member with a run under way, by what it was doing in
 * the read before. */
export function epicTrainsOf(
  previous: EpicTrainsRead | undefined,
  next: EpicTrainsRead,
  connectors: readonly Pick<EpicGraphConnector, "from" | "to">[],
): readonly EpicTrain[] {
  return next.running.map((ticket): EpicTrain => {
    if (previous === undefined || previous.running.includes(ticket))
      return { train: "Resting", ticket };
    const from = connectors
      .filter(
        (connector) =>
          connector.to === ticket &&
          epicTrainsFinished(previous, next, connector.from),
      )
      .map((connector) => connector.from)
      .sort((left, right) => left - right)[0];
    return from === undefined
      ? { train: "Emerging", ticket }
      : { train: "Relaying", from, to: ticket };
  });
}

export type EpicTrainPhase =
  "Emerging" | "Departing" | "Travelling" | "Entering" | "Resting";

/** The phase a train is in after moving for a span, and the share of that
 * phase it has done. */
export function epicTrainPhaseAt(
  train: EpicTrain,
  elapsedMs: number,
): { readonly phase: EpicTrainPhase; readonly share: number } {
  switch (train.train) {
    case "Resting":
      return { phase: "Resting", share: 1 };
    case "Emerging":
      return elapsedMs < epicTrainEmergingMs
        ? {
            phase: "Emerging",
            share: Math.max(0, elapsedMs) / epicTrainEmergingMs,
          }
        : { phase: "Resting", share: 1 };
    case "Relaying": {
      const spans = [
        ["Departing", epicTrainDepartingMs],
        ["Travelling", epicTrainTravellingMs],
        ["Entering", epicTrainEnteringMs],
      ] as const;
      let begun = 0;
      for (const [phase, spanMs] of spans) {
        if (elapsedMs < begun + spanMs)
          return { phase, share: Math.max(0, elapsedMs - begun) / spanMs };
        begun += spanMs;
      }
      return { phase: "Resting", share: 1 };
    }
  }
}

/** Where a train rests on its card: its centre, in from the lower right. */
export function epicTrainRestingAt(card: EpicGraphCard): EpicGraphPoint {
  const fromEdge = epicTrainInset + epicTrainSize / 2;
  return {
    x: card.x + card.width - fromEdge,
    y: card.y + card.height - fromEdge,
  };
}

/** Where a train is drawn: its centre, and how large and opaque it is. */
export interface EpicTrainPose {
  readonly phase: EpicTrainPhase;
  readonly at: EpicGraphPoint;
  readonly scale: number;
  readonly opacity: number;
}

/** What a pose is read against: the cards drawn and the connectors between them. */
export interface EpicTrainGround {
  readonly cardOf: (ticket: number) => EpicGraphCard | undefined;
  readonly connectorOf: (
    from: number,
    to: number,
  ) => EpicGraphConnector | undefined;
}

function epicTrainPoseBetween(
  from: EpicGraphPoint,
  to: EpicGraphPoint,
  share: number,
): EpicGraphPoint {
  return {
    x: from.x + (to.x - from.x) * share,
    y: from.y + (to.y - from.y) * share,
  };
}

/** A relaying train's pose, along its connector; one whose connector is not
 * drawn, as its ticket's outside tickets may not be, rests on its dependent. */
function epicTrainPoseRelaying(
  train: Extract<EpicTrain, { train: "Relaying" }>,
  phase: { readonly phase: EpicTrainPhase; readonly share: number },
  ground: EpicTrainGround,
  rest: EpicGraphPoint,
): EpicTrainPose {
  const connector = ground.connectorOf(train.from, train.to);
  const from = ground.cardOf(train.from);
  const still = { phase: "Resting", at: rest, scale: 1, opacity: 1 } as const;
  if (connector === undefined || from === undefined) return still;
  const [start, , , end] = connector.curve;
  switch (phase.phase) {
    case "Departing":
      return {
        ...still,
        phase: phase.phase,
        at: epicTrainPoseBetween(epicTrainRestingAt(from), start, phase.share),
      };
    case "Travelling":
      return {
        ...still,
        phase: phase.phase,
        at: epicGraphConnectorPoint(connector, phase.share),
      };
    case "Entering":
      return {
        ...still,
        phase: phase.phase,
        at: epicTrainPoseBetween(end, rest, phase.share),
      };
    case "Emerging":
    case "Resting":
      return still;
  }
}

/** Where a train is drawn after moving for a span, none where the card it
 * rests on is not drawn. */
export function epicTrainPose(
  train: EpicTrain,
  elapsedMs: number,
  ground: EpicTrainGround,
): EpicTrainPose | undefined {
  const card = ground.cardOf(
    train.train === "Relaying" ? train.to : train.ticket,
  );
  if (card === undefined) return undefined;
  const rest = epicTrainRestingAt(card);
  const phase = epicTrainPhaseAt(train, elapsedMs);
  if (train.train === "Relaying")
    return epicTrainPoseRelaying(train, phase, ground, rest);
  return phase.phase === "Emerging"
    ? { phase: phase.phase, at: rest, scale: phase.share, opacity: phase.share }
    : { phase: "Resting", at: rest, scale: 1, opacity: 1 };
}

/** How long a train moves for before it rests. */
export function epicTrainMovingMs(train: EpicTrain): number {
  switch (train.train) {
    case "Resting":
      return 0;
    case "Emerging":
      return epicTrainEmergingMs;
    case "Relaying":
      return epicTrainDepartingMs + epicTrainTravellingMs + epicTrainEnteringMs;
  }
}
