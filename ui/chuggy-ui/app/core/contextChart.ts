/**
 * Where the growth chart's marks fall: its axes and their ticks, the main
 * series as a line over an area broken at each compaction, the subagent series
 * apart, the threshold and each compaction's rule — all in the chart's own
 * units for a plot of the width the page measured.
 *
 * THE VERTICAL SCALE IS THE WINDOW where something named it, so a context
 * nearing its threshold is drawn nearing the top; with no window it is the
 * highest point, rounded up to a step a reader can count in.
 */

import type { Copy } from "./copy.ts";
import type {
  ContextCompactionMark,
  ContextGrowthView,
  ContextPoint,
} from "./contextView.ts";
import { contextAtLabel, contextCompactionSaid } from "./contextView.ts";
import { groupedDigits, tokenCountText } from "./figures.ts";

/** The chart's height, and the room each edge keeps for its labels. */
export const contextChartHeight = 210;
const contextChartInsetLeft = 36;
const contextChartInsetRight = 8;
const contextChartInsetTop = 18;
const contextChartInsetBottom = 18;

/** The width a chart is laid out for before the page has measured one. */
export const contextChartWidthDefault = 640;

/** About how many steps each axis is divided into. */
const contextChartStepsY = 4;
const contextChartStepsX = 6;

/** The room the first horizontal tick's label takes, which a tick inside it
 * would be drawn over. */
const contextChartTickFirstRoom = 48;

/** The steps a scale may be divided in, within each power of ten. */
const contextChartStepsNice = [1, 2, 2.5, 5] as const;
const contextChartStepsWhole = [1, 2, 5] as const;
const contextChartDecade = 10;

/** One tick of an axis: where it falls and what it says. */
export interface ContextTick {
  readonly at: number;
  readonly label: string | Copy;
}

/** One unbroken run of a series, as the path its line takes and, for the main
 * series, the area under it. */
export interface ContextChartPiece {
  readonly line: string;
  readonly area: string | undefined;
  readonly ends: readonly { readonly x: number; readonly y: number }[];
}

export interface ContextChart {
  readonly width: number;
  readonly height: number;
  readonly plot: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly yTicks: readonly ContextTick[];
  readonly xTicks: readonly ContextTick[];
  readonly main: readonly ContextChartPiece[];
  readonly subagent: readonly ContextChartPiece[];
  readonly threshold:
    | {
        readonly y: number;
        readonly label: Copy;
        /** The label's baseline, beside the line where no grid line crosses
         * its letters. */
        readonly labelY: number;
      }
    | undefined;
  readonly compactions: readonly { readonly x: number; readonly label: Copy }[];
}

/** The largest step from `steps` in some power of ten that is at most `about`. */
function contextChartStep(about: number, steps: readonly number[]): number {
  if (about <= 1) return 1;
  const decade = contextChartDecade ** Math.floor(Math.log10(about));
  const fitting = steps
    .map((step) => step * decade)
    .filter((step) => step <= about);
  return Math.max(...fitting, decade);
}

/** The top of the vertical scale: the window where every mark fits in it, and
 * otherwise the highest mark, or the window above them, rounded up to a whole
 * step. */
export function contextChartTop(view: ContextGrowthView): number {
  const highest = Math.max(
    1,
    view.window ?? 0,
    view.threshold ?? 0,
    ...view.points.map((point) => point.tokens),
    ...view.compactions.map((mark) => mark.before),
  );
  if (view.window === highest) return view.window;
  const step = contextChartStep(
    highest / contextChartStepsY,
    contextChartStepsNice,
  );
  return Math.ceil(highest / step) * step;
}

/** The vertical ticks: whole steps below the top, and the top itself. */
export function contextChartTicksY(top: number): readonly number[] {
  const step = contextChartStep(
    top / contextChartStepsY,
    contextChartStepsNice,
  );
  const ticks: number[] = [];
  for (
    let value = 0;
    value < top && ticks.length <= contextChartStepsY * 2;
    value += step
  )
    ticks.push(value);
  return [...ticks, top];
}

/** The horizontal ticks: the first call or turn, then whole steps after it. */
export function contextChartTicksX(count: number): readonly number[] {
  const step = contextChartStep(
    count / contextChartStepsX,
    contextChartStepsWhole,
  );
  const ticks = [1];
  for (
    let at = step;
    at <= count && ticks.length <= contextChartStepsX * 2;
    at += step
  )
    if (at > 1) ticks.push(at);
  return ticks;
}

/** The main series' points split at every compaction between two of them. */
export function contextChartBroken(
  points: readonly ContextPoint[],
  compactions: readonly ContextCompactionMark[],
): readonly (readonly ContextPoint[])[] {
  const pieces: ContextPoint[][] = [];
  let piece: ContextPoint[] = [];
  for (const point of points) {
    const previous = piece.at(-1);
    const cut =
      previous !== undefined &&
      compactions.some(
        (mark) =>
          mark.ordinal >= previous.ordinal && mark.ordinal < point.ordinal,
      );
    if (cut) {
      pieces.push(piece);
      piece = [];
    }
    piece.push(point);
  }
  if (piece.length > 0) pieces.push(piece);
  return pieces;
}

/** A subagent series split wherever its calls are not consecutive, or the
 * next is another subagent's. */
export function contextChartRuns(
  points: readonly ContextPoint[],
): readonly (readonly ContextPoint[])[] {
  const runs: ContextPoint[][] = [];
  for (const point of points) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (
      run !== undefined &&
      last !== undefined &&
      point.ordinal === last.ordinal + 1 &&
      point.parent === last.parent
    )
      run.push(point);
    else runs.push([point]);
  }
  return runs;
}

/** The chart's coordinate for a call or turn, and for a count of tokens. */
export interface ContextChartScale {
  readonly x: (ordinal: number) => number;
  readonly y: (tokens: number) => number;
}

function contextChartScaleOf(
  plot: ContextChart["plot"],
  count: number,
  top: number,
): ContextChartScale {
  const span = Math.max(count - 1, 1);
  return {
    x: (ordinal) =>
      plot.left + ((ordinal - 1) / span) * (plot.right - plot.left),
    y: (tokens) => plot.bottom - (tokens / top) * (plot.bottom - plot.top),
  };
}

function contextChartRounded(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function contextChartPiece(
  points: readonly ContextPoint[],
  scale: ContextChartScale,
  bottom: number | undefined,
): ContextChartPiece {
  const at = points.map((point) => ({
    x: scale.x(point.ordinal),
    y: scale.y(point.tokens),
  }));
  const line = at
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${contextChartRounded(point.x)} ${contextChartRounded(point.y)}`,
    )
    .join(" ");
  const first = at[0];
  const last = at.at(-1);
  const area =
    bottom === undefined || first === undefined || last === undefined
      ? undefined
      : `${line} L${contextChartRounded(last.x)} ${contextChartRounded(bottom)} L${contextChartRounded(first.x)} ${contextChartRounded(bottom)} Z`;
  const ends = first === undefined || last === undefined ? [] : [first, last];
  return { line, area, ends };
}

/** Where the threshold's label's baseline sits against its line: this far
 * beneath it, or this far above it. */
const contextChartThresholdBelow = 12;
const contextChartThresholdAbove = 4;

/** The rows a label's letters take above its baseline and below it. */
const contextChartLabelAscent = 9;
const contextChartLabelDescent = 3;

/** The threshold label's baseline: beneath its line, unless a grid line would
 * cross its letters there and would not above it. */
function contextChartThresholdLabelY(
  y: number,
  grid: readonly number[],
): number {
  const crossed = (baseline: number): boolean =>
    grid.some(
      (at) =>
        at > baseline - contextChartLabelAscent &&
        at < baseline + contextChartLabelDescent,
    );
  const below = y + contextChartThresholdBelow;
  const above = y - contextChartThresholdAbove;
  return crossed(below) && !crossed(above) ? above : below;
}

/** Every mark of the chart for a plot `width` wide. */
export function contextChartOf(
  view: ContextGrowthView,
  width: number,
): ContextChart {
  const plot = {
    left: contextChartInsetLeft,
    right: Math.max(width - contextChartInsetRight, contextChartInsetLeft + 1),
    top: contextChartInsetTop,
    bottom: contextChartHeight - contextChartInsetBottom,
  };
  const count = Math.max(view.count, 1);
  const top = contextChartTop(view);
  const scale = contextChartScaleOf(plot, count, top);
  const main = view.points.filter((point) => point.series === "Main");
  const subagent = view.points.filter((point) => point.series === "Subagent");
  const yTicks = contextChartTicksY(top).map((value) => ({
    at: scale.y(value),
    label: tokenCountText(value),
  }));
  const thresholdY =
    view.threshold === undefined ? undefined : scale.y(view.threshold);
  return {
    width,
    height: contextChartHeight,
    plot,
    yTicks,
    xTicks: contextChartTicksX(count)
      .map((ordinal) => ({
        at: scale.x(ordinal),
        label: contextChartTickX(view, ordinal),
      }))
      .filter(
        (tick, index) =>
          index === 0 || tick.at - plot.left >= contextChartTickFirstRoom,
      ),
    main: contextChartBroken(main, view.compactions).map((piece) =>
      contextChartPiece(piece, scale, plot.bottom),
    ),
    subagent: contextChartRuns(subagent).map((run) =>
      contextChartPiece(run, scale, undefined),
    ),
    threshold:
      view.threshold === undefined || thresholdY === undefined
        ? undefined
        : {
            y: thresholdY,
            label: {
              id: "context-compacts-at",
              args: { tokens: tokenCountText(view.threshold) },
            },
            labelY: contextChartThresholdLabelY(
              thresholdY,
              yTicks.map((tick) => tick.at),
            ),
          },
    compactions: view.compactions.map((mark) => ({
      x: contextChartCompactionX(mark, scale, count),
      label: contextCompactionSaid(mark),
    })),
  };
}

/** A compaction's rule stands halfway between the call or turn it followed
 * and the next, and within the axis at either end. */
function contextChartCompactionX(
  mark: ContextCompactionMark,
  scale: ContextChartScale,
  count: number,
): number {
  return scale.x(Math.min(Math.max(mark.ordinal + 0.5, 1), count));
}

function contextChartTickX(
  view: ContextGrowthView,
  ordinal: number,
): string | Copy {
  return ordinal === 1
    ? contextAtLabel(view.unit, ordinal)
    : groupedDigits(ordinal);
}

/** The point a pointer at `x` is nearest, of every series. */
export function contextChartNearest(
  view: ContextGrowthView,
  chart: ContextChart,
  x: number,
): ContextPoint | undefined {
  const scale = contextChartScaleOf(
    chart.plot,
    Math.max(view.count, 1),
    contextChartTop(view),
  );
  let nearest: ContextPoint | undefined = undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of view.points) {
    const away = Math.abs(scale.x(point.ordinal) - x);
    if (away < distance) {
      nearest = point;
      distance = away;
    }
  }
  return nearest;
}

/** The room between a point and the note that names it. */
const contextChartTipGap = 8;

/** Where a box the size of the hover's note stands. */
export interface ContextChartTipAt {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the hover's note of `size` stands for the point drawn `at`: beside it,
 * right or else left, level with it within the plot, and where neither side has
 * the room, above it or else below it. The note never covers the point it
 * names.
 */
export function contextChartTipAt(
  chart: ContextChart,
  at: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
): ContextChartTipAt {
  const gap = contextChartTipGap;
  const { plot } = chart;
  const level = Math.max(
    plot.top,
    Math.min(at.y - size.height / 2, plot.bottom - size.height),
  );
  if (at.x + gap + size.width <= chart.width)
    return { x: at.x + gap, y: level };
  if (at.x - gap - size.width >= 0)
    return { x: at.x - gap - size.width, y: level };
  const x = Math.max(
    0,
    Math.min(at.x - size.width / 2, chart.width - size.width),
  );
  const above = at.y - gap - size.height;
  return { x, y: above >= 0 ? above : at.y + gap };
}

/** Where one point is drawn, for the mark a hover puts on it. */
export function contextChartAt(
  view: ContextGrowthView,
  chart: ContextChart,
  point: ContextPoint,
): { readonly x: number; readonly y: number } {
  const scale = contextChartScaleOf(
    chart.plot,
    Math.max(view.count, 1),
    contextChartTop(view),
  );
  return { x: scale.x(point.ordinal), y: scale.y(point.tokens) };
}
