/**
 * The favicon's own locomotive, inlined at the card's scale and animated as a
 * sprite, so the console's first paint says a read is in flight rather than
 * only saying so in words.
 *
 * The engine holds its position and the ground passes under it, rather than
 * the engine crossing the card: a card's width belongs to layout, not to a
 * stylesheet, so a keyframe that travelled it would have to measure the card
 * from React and hold that measurement in state. A ground that tiles needs no
 * measurement — it is one `@keyframes` rule sliding a repeating background by
 * one tile, in `Locomotive.css`.
 *
 * The engine's own life is a sprite: four frames sit side by side, drawn once
 * as one wide `<svg>`, and `.locomotive-engine` is a window one frame wide
 * with `overflow: hidden` around it. `.locomotive-sprite` is the sheet,
 * `steps(4)` in `Locomotive.css` holding each frame still and then jumping to
 * the next rather than sliding between them, timed off `--duration-chug` —
 * zeroed for reduced motion, where the sheet sits on its first frame, drawn
 * and still. No frame is chosen from React: nothing here carries per-frame
 * state, a timer, or a `style` attribute, only the four frames' coordinates
 * and one CSS animation.
 *
 * The drawing is a copy of `public/favicon.svg`'s `rect`s rather than a
 * shared import: an SVG file is not import-able as markup without a bundler
 * plugin this console does not otherwise need. The favicon is this sprite's
 * first frame — the engine at rest — and if this drawing ever changes, both
 * copies change together in the same commit.
 *
 * `LocomotiveEngine` is the sprite alone, kept apart from the ground so the
 * card reads as one thing that holds its place and one that passes under it.
 * It is this card's alone: the strip above a waiting composer draws
 * chuggernaut's train instead, which crosses the strip rather than standing on
 * a ground, and so shares no drawing with the favicon.
 */

import type { ReactNode } from "react";

import "./Locomotive.css";

type PixelRect = readonly [number, number, number, number, string];
type WheelPhase = "A" | "B";
type PuffStage = "none" | "near" | "drifting" | "fading";

const frameWidthUnits = 16;
const frameCount = 4;

const ink = "#1b1530";
const bodyRed = "#e0413f";
const bodyRedLight = "#ff8c86";
const bodyRedShadow = "#9b2335";
const windowBlue = "#7fd8ff";
const cream = "#f0f0f5";
const steelHighlight = "#b9bccb";
const steelLight = "#b4bcc8";
const steelDark = "#6b7280";
const lampGold = "#f5c542";
const lampGoldShadow = "#b8860b";

function engineBodyRects(
  frameOffsetX: number,
  bobOffsetY: number,
): readonly PixelRect[] {
  const x = frameOffsetX;
  const y = bobOffsetY;
  return [
    [x + 10, y + 0, 3, 1, cream],
    [x + 9, y + 1, 1, 1, ink],
    [x + 10, y + 1, 3, 1, steelHighlight],
    [x + 13, y + 1, 1, 1, ink],
    [x + 10, y + 2, 3, 1, steelDark],
    [x + 1, y + 3, 5, 1, ink],
    [x + 9, y + 3, 5, 1, ink],
    [x + 0, y + 4, 1, 1, ink],
    [x + 1, y + 4, 1, 1, bodyRedLight],
    [x + 2, y + 4, 4, 1, bodyRed],
    [x + 6, y + 4, 1, 1, ink],
    [x + 7, y + 4, 1, 1, ink],
    [x + 8, y + 4, 7, 1, steelLight],
    [x + 15, y + 4, 1, 1, ink],
    [x + 0, y + 5, 1, 1, ink],
    [x + 1, y + 5, 1, 1, bodyRed],
    [x + 2, y + 5, 3, 1, cream],
    [x + 5, y + 5, 1, 1, bodyRed],
    [x + 6, y + 5, 1, 1, ink],
    [x + 7, y + 5, 1, 1, ink],
    [x + 8, y + 5, 3, 1, steelLight],
    [x + 11, y + 5, 1, 1, ink],
    [x + 12, y + 5, 3, 1, steelLight],
    [x + 15, y + 5, 1, 1, ink],
    [x + 0, y + 6, 1, 1, ink],
    [x + 1, y + 6, 5, 1, windowBlue],
    [x + 6, y + 6, 1, 1, ink],
    [x + 7, y + 6, 1, 1, ink],
    [x + 8, y + 6, 3, 1, steelLight],
    [x + 11, y + 6, 1, 1, ink],
    [x + 12, y + 6, 2, 1, steelLight],
    [x + 14, y + 6, 1, 1, lampGold],
    [x + 15, y + 6, 1, 1, ink],
    [x + 0, y + 7, 1, 1, ink],
    [x + 1, y + 7, 5, 1, windowBlue],
    [x + 6, y + 7, 1, 1, ink],
    [x + 7, y + 7, 1, 1, ink],
    [x + 8, y + 7, 6, 1, steelLight],
    [x + 14, y + 7, 1, 1, lampGoldShadow],
    [x + 15, y + 7, 1, 1, ink],
    [x + 0, y + 8, 1, 1, ink],
    [x + 1, y + 8, 1, 1, bodyRed],
    [x + 2, y + 8, 3, 1, windowBlue],
    [x + 5, y + 8, 1, 1, bodyRed],
    [x + 6, y + 8, 9, 1, ink],
    [x + 15, y + 8, 1, 1, ink],
    [x + 0, y + 9, 1, 1, ink],
    [x + 1, y + 9, 5, 1, bodyRedShadow],
    [x + 6, y + 9, 1, 1, ink],
    [x + 7, y + 9, 1, 1, ink],
    [x + 8, y + 9, 6, 1, steelLight],
    [x + 15, y + 9, 1, 1, ink],
    [x + 0, y + 10, 16, 1, ink],
  ];
}

function engineWheelRects(
  frameOffsetX: number,
  bobOffsetY: number,
  phase: WheelPhase,
): readonly PixelRect[] {
  const x = frameOffsetX;
  const y = bobOffsetY;
  const [hubNear, hubFar] =
    phase === "A" ? [steelDark, steelLight] : [steelLight, steelDark];
  return [
    [x + 2, y + 11, 2, 1, ink],
    [x + 11, y + 11, 2, 1, ink],
    [x + 1, y + 12, 1, 1, ink],
    [x + 2, y + 12, 2, 1, steelLight],
    [x + 4, y + 12, 1, 1, ink],
    [x + 10, y + 12, 1, 1, ink],
    [x + 11, y + 12, 2, 1, steelLight],
    [x + 13, y + 12, 1, 1, ink],
    [x + 14, y + 12, 1, 1, bodyRedShadow],
    [x + 1, y + 13, 1, 1, ink],
    [x + 2, y + 13, 1, 1, hubNear],
    [x + 3, y + 13, 1, 1, hubFar],
    [x + 4, y + 13, 1, 1, ink],
    [x + 10, y + 13, 1, 1, ink],
    [x + 11, y + 13, 1, 1, hubNear],
    [x + 12, y + 13, 1, 1, hubFar],
    [x + 13, y + 13, 1, 1, ink],
    [x + 14, y + 13, 1, 1, bodyRedShadow],
    [x + 1, y + 14, 1, 1, ink],
    [x + 2, y + 14, 2, 1, steelLight],
    [x + 4, y + 14, 1, 1, ink],
    [x + 10, y + 14, 1, 1, ink],
    [x + 11, y + 14, 2, 1, steelLight],
    [x + 13, y + 14, 1, 1, ink],
  ];
}

function enginePuffRects(
  frameOffsetX: number,
  stage: PuffStage,
): readonly PixelRect[] {
  const x = frameOffsetX;
  switch (stage) {
    case "none":
      return [];
    case "near":
      return [[x + 7, 0, 2, 1, cream]];
    case "drifting":
      return [
        [x + 5, 0, 2, 1, steelHighlight],
        [x + 6, 1, 2, 1, cream],
      ];
    case "fading":
      return [[x + 2, 0, 2, 1, steelDark]];
  }
}

function spriteFrameRects(
  frameIndex: number,
  bobOffsetY: number,
  wheelPhase: WheelPhase,
  puffStage: PuffStage,
): readonly PixelRect[] {
  const frameOffsetX = frameIndex * frameWidthUnits;
  return [
    ...engineBodyRects(frameOffsetX, bobOffsetY),
    ...engineWheelRects(frameOffsetX, bobOffsetY, wheelPhase),
    ...enginePuffRects(frameOffsetX, puffStage),
  ];
}

const spriteRects: readonly PixelRect[] = [
  ...spriteFrameRects(0, 0, "A", "none"),
  ...spriteFrameRects(1, 1, "B", "near"),
  ...spriteFrameRects(2, 0, "A", "drifting"),
  ...spriteFrameRects(3, 1, "B", "fading"),
];

function LocomotiveEngine(): ReactNode {
  return (
    <span className="locomotive-engine" aria-hidden="true">
      <svg
        className="locomotive-sprite"
        viewBox={`0 0 ${frameCount * frameWidthUnits} ${frameWidthUnits}`}
        shapeRendering="crispEdges"
      >
        {spriteRects.map(([rectX, rectY, width, height, fill]) => (
          <rect
            key={`${rectX}-${rectY}`}
            x={rectX}
            y={rectY}
            width={width}
            height={height}
            fill={fill}
          />
        ))}
      </svg>
    </span>
  );
}

export function Locomotive(): ReactNode {
  return (
    <div className="locomotive" role="img" aria-label="chuggy is under way">
      <LocomotiveEngine />
      <div className="locomotive-track" aria-hidden="true" />
    </div>
  );
}
