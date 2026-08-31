/**
 * Every number the wire measured, formatted once: money, tokens, duration, an
 * instant, a span, and the absence of any of them.
 *
 * Total over `figureKinds`. A figure is built here and drawn by `ui/Figure.tsx`,
 * so no component composes one and no two places round the same quantity
 * differently. The summing stays in `runTotals.ts`; what this adds is the
 * reading.
 *
 * A DOLLAR NEVER APPEARS WITHOUT ITS BASIS. `costBasis` is the wire's word for
 * what the figure is, and a rollup over runs that disagreed on it says so, so
 * nothing on a page can be read as a bill that was not one. The tag is total
 * over the roster, which is what makes a basis the wire gains stop compiling
 * here rather than reaching a reader as a price.
 *
 * AN INSTANT IS ABSOLUTE AND A FRESHNESS IS RELATIVE. A ledger is compared row
 * to row and a relative time drifts while the page is open, so an instant is
 * the clock face with the full ISO on hover; how long ago a read happened is
 * `Freshness`'s and is not a figure.
 */

import type { RunTotals } from "../../../../src/contract/responses.ts";
import type { RunRollupBasis, RunSpan } from "./runTotals.ts";

export const figureKinds = [
  "Cost",
  "Tokens",
  "Duration",
  "Instant",
  "Span",
  "Absent",
] as const;

export type FigureKind = (typeof figureKinds)[number];

export type Figure =
  | { readonly kind: "Cost"; readonly text: string; readonly basis?: string }
  | { readonly kind: "Tokens"; readonly text: string }
  | { readonly kind: "Duration"; readonly text: string }
  | { readonly kind: "Instant"; readonly text: string; readonly iso: string }
  | {
      readonly kind: "Span";
      readonly start: string;
      readonly end?: string;
      readonly length: string;
      readonly open: boolean;
      readonly title: string;
    }
  | { readonly kind: "Absent"; readonly why: string };

/** What one row or one rollup spent, as the two cells a ledger draws for it. */
export interface Spend {
  readonly cost: Figure;
  readonly tokens: Figure;
}

/** Millionths of a dollar in a dollar, which is the unit a durable row holds. */
const costUsdMicrosPerUsd = 1_000_000;

/** The smallest amount cents can state, below which a spend would read as none. */
const costUsdCent = 0.01;

const costDecimalsCents = 2;
const costDecimalsFine = 4;

const msPerSecond = 1_000;
const secondsPerMinute = 60;
const minutesPerHour = 60;
const hoursPerDay = 24;

const thousand = 1_000;
const million = 1_000_000;

/** Above this a scaled figure is whole; below it one decimal tells two apart. */
const scaledDecimalBelow = 10;

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** The basis in the reader's own case, total over the roster and the rollup's own arm. */
function costBasisTag(basis: RunRollupBasis): string {
  switch (basis) {
    case "List":
      return "list";
    case "Mixed":
      return "mixed";
  }
}

/** Cents, or finer where cents alone would draw a spend as nothing spent. */
export function costFigure(
  costUsdMicros: number,
  basis: RunRollupBasis,
): Figure {
  const usd = costUsdMicros / costUsdMicrosPerUsd;
  const decimals =
    usd === 0 || usd >= costUsdCent ? costDecimalsCents : costDecimalsFine;
  return {
    kind: "Cost",
    text: `$${usd.toFixed(decimals)}`,
    basis: costBasisTag(basis),
  };
}

/** Whole above ten of a unit, one decimal below it, so two figures never read alike. */
function scaled(value: number, unit: number, suffix: string): string {
  const scaledValue = value / unit;
  return scaledValue < scaledDecimalBelow
    ? `${scaledValue.toFixed(1)}${suffix}`
    : `${String(Math.round(scaledValue))}${suffix}`;
}

/** The four counts a token figure adds, which is every kind the wire reports. */
export type TokenCounts = Pick<
  RunTotals,
  "tokensInput" | "tokensOutput" | "tokensCacheCreation" | "tokensCacheRead"
>;

/** What a spend figure needs of a run or of a rollup over runs. */
export type SpentTotals = TokenCounts & Pick<RunTotals, "costUsdMicros">;

/** One number over every kind of token, because a row is read at a glance. */
export function tokensFigure(totals: TokenCounts): Figure {
  const count =
    totals.tokensInput +
    totals.tokensOutput +
    totals.tokensCacheCreation +
    totals.tokensCacheRead;
  if (count >= million)
    return { kind: "Tokens", text: `${scaled(count, million, "M")} tok` };
  if (count >= thousand)
    return { kind: "Tokens", text: `${scaled(count, thousand, "k")} tok` };
  return { kind: "Tokens", text: `${String(Math.trunc(count))} tok` };
}

/** Below this a sexagesimal or calendar field is written with its leading zero. */
const paddedBelow = 10;

function padded(value: number): string {
  return value < paddedBelow ? `0${String(value)}` : String(value);
}

/** The second unit is dropped when it is empty, so a round span reads as round. */
function twoUnits(
  large: number,
  largeUnit: string,
  small: number,
  smallUnit: string,
  pad: boolean,
): string {
  const drawn = `${String(large)}${largeUnit}`;
  if (small === 0) return drawn;
  return `${drawn} ${pad ? padded(small) : String(small)}${smallUnit}`;
}

/** The largest two units, whole, because a third is noise at every scale. */
export function durationText(durationMs: number): string {
  const seconds = Math.max(Math.floor(durationMs / msPerSecond), 0);
  if (seconds < 1) return "<1s";
  const minutes = Math.floor(seconds / secondsPerMinute);
  const hours = Math.floor(minutes / minutesPerHour);
  const days = Math.floor(hours / hoursPerDay);
  if (days > 0) return twoUnits(days, "d", hours % hoursPerDay, "h", false);
  if (hours > 0)
    return twoUnits(hours, "h", minutes % minutesPerHour, "m", true);
  if (minutes > 0)
    return twoUnits(minutes, "m", seconds % secondsPerMinute, "s", true);
  return `${String(seconds)}s`;
}

export function durationFigure(durationMs: number): Figure {
  return { kind: "Duration", text: durationText(durationMs) };
}

function clockOf(at: Date): string {
  return `${padded(at.getHours())}:${padded(at.getMinutes())}`;
}

/**
 * The clock face for today, the date and the clock within the year, and the
 * whole date before it. Browser-local, because the reader's day is the one they
 * are comparing rows against.
 */
export function instantText(at: Date, now: Date): string {
  const clock = clockOf(at);
  if (
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  )
    return clock;
  const month = monthNames[at.getMonth()] ?? "";
  if (at.getFullYear() === now.getFullYear())
    return `${month} ${String(at.getDate())} ${clock}`;
  return `${String(at.getFullYear())}-${padded(at.getMonth() + 1)}-${padded(at.getDate())} ${clock}`;
}

/** An instant the clock could not read is an absence, never a printed string. */
export function instantFigure(stated: string, nowMs: number): Figure {
  const at = Date.parse(stated);
  if (!Number.isFinite(at)) return { kind: "Absent", why: "No instant" };
  return {
    kind: "Instant",
    text: instantText(new Date(at), new Date(nowMs)),
    iso: new Date(at).toISOString(),
  };
}

interface SpanParts {
  readonly startMs: number;
  readonly start: string;
  readonly startIso: string;
}

function spanStart(
  stated: string | undefined,
  nowMs: number,
): SpanParts | undefined {
  if (stated === undefined) return undefined;
  const startMs = Date.parse(stated);
  if (!Number.isFinite(startMs)) return undefined;
  const drawn = instantFigure(stated, nowMs);
  if (drawn.kind !== "Instant") return undefined;
  return { startMs, start: drawn.text, startIso: drawn.iso };
}

/**
 * A cycle's or a ticket's window: where it started, where it ended or that it
 * has not, and how long that is. An open end ticks with the clock it is handed.
 */
export function spanFigure(span: RunSpan, nowMs: number): Figure {
  const opened = spanStart(span.from, nowMs);
  if (opened === undefined)
    return { kind: "Absent", why: "No run figures yet" };
  const ended = spanStart(span.to, nowMs);
  if (ended === undefined)
    return {
      kind: "Span",
      start: opened.start,
      end: "running",
      length: `${durationText(nowMs - opened.startMs)} so far`,
      open: true,
      title: `${opened.startIso} → running`,
    };
  return {
    kind: "Span",
    start: opened.start,
    end: ended.start,
    length: durationText(ended.startMs - opened.startMs),
    open: false,
    title: `${opened.startIso} → ${ended.startIso}`,
  };
}

/**
 * One row's window, which is where it started and how long it has taken. A row
 * the wire has reported no end for is still running and says how long for.
 */
export function whenFigure(
  registeredAt: string,
  terminalAt: string | undefined,
  nowMs: number,
): Figure {
  const opened = spanStart(registeredAt, nowMs);
  if (opened === undefined) return { kind: "Absent", why: "No instant" };
  const ended = spanStart(terminalAt, nowMs);
  if (ended === undefined)
    return {
      kind: "Span",
      start: opened.start,
      length: `running ${durationText(nowMs - opened.startMs)}`,
      open: true,
      title: `${opened.startIso} → running`,
    };
  return {
    kind: "Span",
    start: opened.start,
    length: durationText(ended.startMs - opened.startMs),
    open: false,
    title: `${opened.startIso} → ${ended.startIso}`,
  };
}

/** The one absence a set of runs has: it is running, and nothing is counted yet. */
export function spendAbsent(why: string): Spend {
  return { cost: { kind: "Absent", why }, tokens: { kind: "Absent", why } };
}

/** What a run or a rollup spent, as the two cells that are always drawn together. */
export function spendFigures(
  totals: SpentTotals | undefined,
  basis: RunRollupBasis | undefined,
): Spend {
  if (totals === undefined || basis === undefined)
    return spendAbsent("No run figures yet");
  return {
    cost: costFigure(totals.costUsdMicros, basis),
    tokens: tokensFigure(totals),
  };
}
