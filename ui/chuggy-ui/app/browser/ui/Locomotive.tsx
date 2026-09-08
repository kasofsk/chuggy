/**
 * The favicon's own locomotive, inlined at the card's scale and moving, so the
 * console's first paint says a read is in flight rather than only saying so in
 * words.
 *
 * The engine holds still and the ground passes under it, rather than the
 * engine crossing the card: a card's width belongs to layout, not to a
 * stylesheet, so a keyframe that travelled it would have to measure the card
 * from React and hold that measurement in state. A ground that tiles needs no
 * measurement — it is one `@keyframes` rule sliding a repeating background
 * by one tile, in `Locomotive.css`.
 *
 * The engine itself is a sprite: four frames, drawn once each and held side
 * by side in the markup, with `Locomotive.css` sliding a window over them one
 * whole frame at a time via `steps()` — no per-frame React state, no timer,
 * no `style` attribute. The frames are computed from one pixel drawing rather
 * than written out four times: each shifts the body a grid row, swaps a
 * wheel's rim colour, and picks a puff.
 *
 * The rest frame — the first — is a copy of `public/favicon.svg`'s `rect`s
 * rather than a shared import: an SVG file is not import-able as markup
 * without a bundler plugin this console does not otherwise need. If this
 * drawing changes, both copies change together in the same commit.
 *
 * `LocomotiveEngine` is the sprite alone, exported so a caller elsewhere in
 * the console — the strip above a waiting composer — draws the same engine
 * without the ground this card slides under it, and without a second copy of
 * the drawing to keep in step with the favicon.
 */

import type { ReactNode } from "react";

import "./Locomotive.css";

type Pixel = readonly [
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
];

/** The boiler, cab and funnel — rows -1 to 10 of the grid. Row -1 is empty at
 * rest: the headroom the body bobs into on the frames that raise it. */
const bodyPixels: readonly Pixel[] = [
  [12, 0, 2, 1, "#f0f0f5"],
  [11, 1, 1, 1, "#f0f0f5"],
  [12, 1, 1, 1, "#b9bccb"],
  [13, 1, 1, 1, "#f0f0f5"],
  [2, 2, 3, 1, "#1b1530"],
  [12, 2, 1, 1, "#b9bccb"],
  [1, 3, 5, 1, "#1b1530"],
  [11, 3, 3, 1, "#1b1530"],
  [0, 4, 1, 1, "#1b1530"],
  [1, 4, 1, 1, "#ff8c86"],
  [2, 4, 4, 1, "#e0413f"],
  [6, 4, 1, 1, "#1b1530"],
  [11, 4, 1, 1, "#1b1530"],
  [12, 4, 2, 1, "#6b7280"],
  [14, 4, 1, 1, "#1b1530"],
  [0, 5, 1, 1, "#1b1530"],
  [1, 5, 1, 1, "#e0413f"],
  [2, 5, 4, 1, "#7fd8ff"],
  [6, 5, 1, 1, "#1b1530"],
  [11, 5, 1, 1, "#1b1530"],
  [12, 5, 2, 1, "#6b7280"],
  [14, 5, 1, 1, "#1b1530"],
  [0, 6, 1, 1, "#1b1530"],
  [1, 6, 1, 1, "#e0413f"],
  [2, 6, 4, 1, "#7fd8ff"],
  [6, 6, 9, 1, "#1b1530"],
  [0, 7, 1, 1, "#1b1530"],
  [1, 7, 1, 1, "#e0413f"],
  [2, 7, 4, 1, "#9b2335"],
  [6, 7, 1, 1, "#1b1530"],
  [7, 7, 4, 1, "#b4bcc8"],
  [11, 7, 1, 1, "#f5c542"],
  [12, 7, 3, 1, "#b4bcc8"],
  [15, 7, 1, 1, "#1b1530"],
  [0, 8, 1, 1, "#1b1530"],
  [1, 8, 5, 1, "#e0413f"],
  [6, 8, 1, 1, "#1b1530"],
  [7, 8, 4, 1, "#b4bcc8"],
  [11, 8, 1, 1, "#b8860b"],
  [12, 8, 2, 1, "#b4bcc8"],
  [14, 8, 1, 1, "#f5c542"],
  [15, 8, 1, 1, "#1b1530"],
  [0, 9, 1, 1, "#1b1530"],
  [1, 9, 5, 1, "#9b2335"],
  [6, 9, 1, 1, "#1b1530"],
  [7, 9, 8, 1, "#6b7280"],
  [15, 9, 1, 1, "#1b1530"],
  [0, 10, 16, 1, "#1b1530"],
];

/** The wheels — rows 11 to 15 — fixed to the rails while the body above bobs. */
const groundPixels: readonly Pixel[] = [
  [2, 11, 3, 1, "#1b1530"],
  [10, 11, 3, 1, "#1b1530"],
  [14, 11, 1, 1, "#1b1530"],
  [1, 12, 1, 1, "#1b1530"],
  [2, 12, 1, 1, "#b4bcc8"],
  [5, 12, 1, 1, "#1b1530"],
  [9, 12, 1, 1, "#1b1530"],
  [10, 12, 1, 1, "#b4bcc8"],
  [13, 12, 1, 1, "#1b1530"],
  [14, 12, 1, 1, "#9b2335"],
  [15, 12, 1, 1, "#1b1530"],
  [1, 13, 1, 1, "#1b1530"],
  [2, 13, 3, 1, "#b4bcc8"],
  [5, 13, 1, 1, "#1b1530"],
  [9, 13, 1, 1, "#1b1530"],
  [10, 13, 3, 1, "#b4bcc8"],
  [13, 13, 1, 1, "#1b1530"],
  [14, 13, 1, 1, "#9b2335"],
  [15, 13, 1, 1, "#1b1530"],
  [1, 14, 1, 1, "#1b1530"],
  [2, 14, 3, 1, "#b4bcc8"],
  [5, 14, 1, 1, "#1b1530"],
  [9, 14, 1, 1, "#1b1530"],
  [10, 14, 3, 1, "#b4bcc8"],
  [13, 14, 1, 1, "#1b1530"],
  [2, 15, 3, 1, "#1b1530"],
  [10, 15, 3, 1, "#1b1530"],
  [14, 15, 2, 1, "#1b1530"],
];

/** The puff, by frame: absent at rest, then a pixel that grows, drifts toward
 * the funnel's right, and fades before the loop returns to nothing. */
const puffFrames: readonly (readonly Pixel[])[] = [
  [],
  [[14, 1, 1, 1, "#b9bccb"]],
  [
    [14, 0, 1, 1, "#b9bccb"],
    [15, 1, 1, 1, "#f0f0f5"],
  ],
  [[15, 0, 1, 1, "#f0f0f5"]],
];

function shiftedUp(pixels: readonly Pixel[], rows: number): readonly Pixel[] {
  return pixels.map(
    ([x, y, width, height, fill]): Pixel => [x, y - rows, width, height, fill],
  );
}

function wheelHub(index: number): readonly [Pixel, Pixel] {
  const fill = index % 2 === 0 ? "#6b7280" : "#b4bcc8";
  return [
    [3, 12, 2, 1, fill],
    [11, 12, 2, 1, fill],
  ];
}

const frames: readonly (readonly Pixel[])[] = puffFrames.map(
  (puff, index) => [
    ...shiftedUp(bodyPixels, index % 2),
    ...groundPixels,
    ...wheelHub(index),
    ...puff,
  ],
);

export function LocomotiveEngine(): ReactNode {
  return (
    <div className="locomotive-engine" aria-hidden="true">
      <div className="locomotive-sprite">
        {frames.map((frame, index) => (
          <svg
            key={index}
            className="locomotive-frame"
            viewBox="0 -1 16 17"
            shapeRendering="crispEdges"
          >
            {frame.map(([x, y, width, height, fill]) => (
              <rect
                key={`${x}-${y}-${width}`}
                x={x}
                y={y}
                width={width}
                height={height}
                fill={fill}
              />
            ))}
          </svg>
        ))}
      </div>
    </div>
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
