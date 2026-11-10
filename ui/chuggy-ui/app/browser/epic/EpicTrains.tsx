/**
 * The trains on an epic's graph, which `core/epicTrains.ts` finds by setting
 * each read of the graph beside the reads before and places at every moment.
 *
 * A moving train is stepped once a frame by setting its transform on the
 * element itself, so a frame draws nothing of React's, and it stops once the
 * train rests. A reader who takes no motion is drawn each train where it comes
 * to rest, and nothing moves. They are decoration: hidden from a reader who
 * does not see them, and never in the way of a press.
 */

import { memo, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  epicTrainMovingMs,
  epicTrainPose,
  epicTrainSize,
  epicTrainsReadSame,
  epicTrainsSeenFirst,
  epicTrainsSeenNext,
  epicTrainTicket,
} from "../../core/epicTrains.ts";
import type {
  EpicTrain,
  EpicTrainGround,
  EpicTrainPose,
  EpicTrainsRead,
  EpicTrainsSeen,
} from "../../core/epicTrains.ts";
import type { EpicGraphConnector } from "../../core/epicGraph.ts";
import { useViewportMotion } from "../shell/viewport.ts";
import { LocomotiveEngine } from "../ui/Locomotive.tsx";

import "./epic.css";

function epicTrainTransform(pose: EpicTrainPose): string {
  const half = epicTrainSize / 2;
  return `translate(${String(pose.at.x)} ${String(pose.at.y)}) scale(${String(pose.scale)}) translate(${String(-half)} ${String(-half)})`;
}

/** How long a train has moved for as it is drawn: none before its first
 * frame, and since that frame after it, so a new ground draws a train that
 * has come to rest at rest rather than back at its start. */
function epicTrainDrawnElapsedMs(
  train: EpicTrain,
  moving: boolean,
  begun: { readonly train: EpicTrain; readonly atMs: number } | undefined,
): number {
  if (!moving) return Infinity;
  return begun?.train === train ? performance.now() - begun.atMs : 0;
}

/** One train, drawn at its first pose and stepped from there to its rest. A
 * new ground, as each read of the graph brings, steps the same train on from
 * where it had got to rather than from its start. */
const EpicTrainDrawn = memo(function EpicTrainDrawn(props: {
  readonly train: EpicTrain;
  readonly ground: EpicTrainGround;
  readonly moving: boolean;
}): ReactNode {
  const drawn = useRef<SVGGElement>(null);
  const begun = useRef<{ readonly train: EpicTrain; readonly atMs: number }>(
    undefined,
  );
  const { train, ground, moving } = props;
  useEffect(() => {
    const element = drawn.current;
    const movingMs = epicTrainMovingMs(train);
    if (!moving || movingMs === 0 || element === null) return undefined;
    let frame = requestAnimationFrame(function stepped(nowMs: number) {
      if (begun.current?.train !== train)
        begun.current = { train, atMs: nowMs };
      const begunMs = begun.current.atMs;
      const pose = epicTrainPose(train, nowMs - begunMs, ground);
      if (pose === undefined) return;
      element.setAttribute("transform", epicTrainTransform(pose));
      element.setAttribute("opacity", String(pose.opacity));
      element.dataset["phase"] = pose.phase;
      if (nowMs - begunMs < movingMs) frame = requestAnimationFrame(stepped);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [train, ground, moving]);
  const pose = epicTrainPose(
    train,
    epicTrainDrawnElapsedMs(train, moving, begun.current),
    ground,
  );
  if (pose === undefined) return null;
  return (
    <g
      ref={drawn}
      className="epic-train"
      data-train={train.train}
      data-phase={pose.phase}
      transform={epicTrainTransform(pose)}
      opacity={pose.opacity}
    >
      <foreignObject width={epicTrainSize} height={epicTrainSize}>
        <span className="epic-train-engine">
          <LocomotiveEngine />
        </span>
      </foreignObject>
    </g>
  );
});

export function EpicTrains(props: {
  readonly read: EpicTrainsRead;
  readonly connectors: readonly EpicGraphConnector[];
  readonly ground: EpicTrainGround;
}): ReactNode {
  const moving = useViewportMotion();
  const [seen, setSeen] = useState<EpicTrainsSeen>(() =>
    epicTrainsSeenFirst(props.read),
  );
  if (!epicTrainsReadSame(seen.read, props.read))
    setSeen(epicTrainsSeenNext(seen, props.read, props.connectors));
  return (
    <g className="epic-trains" aria-hidden="true">
      {seen.trains.map((train) => (
        <EpicTrainDrawn
          key={epicTrainTicket(train)}
          train={train}
          ground={props.ground}
          moving={moving}
        />
      ))}
    </g>
  );
}
