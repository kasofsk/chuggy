/**
 * The trains on an epic's graph, which `core/epicTrains.ts` finds by setting
 * each read of the graph beside the one before and places at every moment.
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
  epicTrainsOf,
  epicTrainsReadSame,
} from "../../core/epicTrains.ts";
import type {
  EpicTrain,
  EpicTrainGround,
  EpicTrainPose,
  EpicTrainsRead,
} from "../../core/epicTrains.ts";
import type { EpicGraphConnector } from "../../core/epicGraph.ts";
import { useViewportMotion } from "../shell/viewport.ts";
import { LocomotiveEngine } from "../ui/Locomotive.tsx";

import "./epic.css";

function epicTrainTransform(pose: EpicTrainPose): string {
  const half = epicTrainSize / 2;
  return `translate(${String(pose.at.x)} ${String(pose.at.y)}) scale(${String(pose.scale)}) translate(${String(-half)} ${String(-half)})`;
}

/** One train, drawn at its first pose and stepped from there to its rest. */
const EpicTrainDrawn = memo(function EpicTrainDrawn(props: {
  readonly train: EpicTrain;
  readonly ground: EpicTrainGround;
  readonly moving: boolean;
}): ReactNode {
  const drawn = useRef<SVGGElement>(null);
  const { train, ground, moving } = props;
  useEffect(() => {
    const element = drawn.current;
    const movingMs = epicTrainMovingMs(train);
    if (!moving || movingMs === 0 || element === null) return undefined;
    let begunMs: number | undefined;
    let frame = requestAnimationFrame(function stepped(nowMs: number) {
      begunMs ??= nowMs;
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
  const pose = epicTrainPose(train, moving ? 0 : Infinity, ground);
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

/** What a read draws trains from, and the trains it drew against the read
 * before it, held until a read draws different ones. */
interface EpicTrainsHeld {
  readonly read: EpicTrainsRead;
  readonly trains: readonly EpicTrain[];
  /** How many reads have drawn different trains, so each set mounts afresh. */
  readonly generation: number;
}

export function EpicTrains(props: {
  readonly read: EpicTrainsRead;
  readonly connectors: readonly EpicGraphConnector[];
  readonly ground: EpicTrainGround;
}): ReactNode {
  const moving = useViewportMotion();
  const [held, setHeld] = useState<EpicTrainsHeld>(() => ({
    read: props.read,
    trains: epicTrainsOf(undefined, props.read, props.connectors),
    generation: 0,
  }));
  if (!epicTrainsReadSame(held.read, props.read))
    setHeld({
      read: props.read,
      trains: epicTrainsOf(held.read, props.read, props.connectors),
      generation: held.generation + 1,
    });
  return (
    <g className="epic-trains" aria-hidden="true">
      {held.trains.map((train) => (
        <EpicTrainDrawn
          key={`${String(held.generation)}-${train.train === "Relaying" ? `${String(train.from)}-${String(train.to)}` : String(train.ticket)}`}
          train={train}
          ground={props.ground}
          moving={moving}
        />
      ))}
    </g>
  );
}
