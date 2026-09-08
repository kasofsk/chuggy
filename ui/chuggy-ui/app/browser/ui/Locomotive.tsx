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
 * by one tile, in `Locomotive.css` — and the engine itself carries no
 * animation of its own, so nothing here is animated a second time to fake the
 * depth the moving ground already gives it.
 *
 * `LocomotiveEngine` is the drawing alone, with no ground and no wrapper of
 * its own, because the conversation surface's waiting strip crosses the
 * engine itself rather than sliding ground under a still one — a second copy
 * of these `rect`s would be a finding, so the strip imports this instead.
 * `Locomotive` is the engine plus the ground, unchanged, for the Loading card.
 *
 * The drawing is a copy of `public/favicon.svg`'s `rect`s rather than a shared
 * import: an SVG file is not import-able as markup without a bundler plugin
 * this console does not otherwise need. The favicon does not change, and if
 * this drawing ever does, both copies change together in the same commit.
 */

import type { ReactNode } from "react";

import "./Locomotive.css";

const locomotiveDrawing: ReadonlyArray<
  readonly [number, number, number, number, string]
> = [
  [12, 0, 2, 1, "#f0f0f5"],
  [11, 1, 1, 1, "#f0f0f5"],
  [12, 1, 1, 1, "#b9bccb"],
  [13, 1, 1, 1, "#f0f0f5"],
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
  [2, 5, 3, 1, "#7fd8ff"],
  [5, 5, 1, 1, "#e0413f"],
  [6, 5, 1, 1, "#1b1530"],
  [11, 5, 1, 1, "#1b1530"],
  [12, 5, 2, 1, "#6b7280"],
  [14, 5, 1, 1, "#1b1530"],
  [0, 6, 1, 1, "#1b1530"],
  [1, 6, 1, 1, "#e0413f"],
  [2, 6, 3, 1, "#7fd8ff"],
  [5, 6, 1, 1, "#e0413f"],
  [6, 6, 9, 1, "#1b1530"],
  [0, 7, 1, 1, "#1b1530"],
  [1, 7, 1, 1, "#e0413f"],
  [2, 7, 3, 1, "#9b2335"],
  [5, 7, 1, 1, "#e0413f"],
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
  [2, 11, 3, 1, "#1b1530"],
  [10, 11, 3, 1, "#1b1530"],
  [14, 11, 1, 1, "#1b1530"],
  [1, 12, 1, 1, "#1b1530"],
  [2, 12, 1, 1, "#b4bcc8"],
  [3, 12, 1, 1, "#6b7280"],
  [4, 12, 1, 1, "#b4bcc8"],
  [5, 12, 1, 1, "#1b1530"],
  [9, 12, 1, 1, "#1b1530"],
  [10, 12, 1, 1, "#b4bcc8"],
  [11, 12, 1, 1, "#6b7280"],
  [12, 12, 1, 1, "#b4bcc8"],
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
  [2, 14, 3, 1, "#1b1530"],
  [10, 14, 3, 1, "#1b1530"],
  [14, 14, 2, 1, "#1b1530"],
];

export function LocomotiveEngine(): ReactNode {
  return (
    <svg
      className="locomotive-engine"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {locomotiveDrawing.map(([x, y, width, height, fill]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={width}
          height={height}
          fill={fill}
        />
      ))}
    </svg>
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
