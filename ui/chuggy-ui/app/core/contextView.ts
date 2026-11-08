/**
 * What a Context view draws, whoever's context it is: the window as the latest
 * reading held it, the context at each call or turn with the compactions that
 * cut it, and the geometry the bar and the chart are drawn to.
 *
 * A RUN AND A SESSION ARRIVE AT THE SAME SHAPES. `contextRun.ts` and
 * `contextSession.ts` are the two adapters, each turning its own reads into a
 * `ContextWindowView` and a `ContextGrowthView`, so one component draws both
 * and the rules below are stated once.
 *
 * A READING IS EXACT AND NOTHING ELSE IS. Where no reading holds the window's
 * categories, each is "Not recorded" rather than guessed, and the one figure
 * that is known — the context the newest call or turn was sent — is drawn as
 * used, against the window only where something named the window.
 */

import type { RunContextWindow } from "../../../../src/contract/responses.ts";
import type { RunContextCategoryKind } from "../../../../src/contract/rosters.ts";
import type { Copy } from "./copy.ts";
import { groupedDigits, sharePartFigure, tokenCountText } from "./figures.ts";
import type { Figure } from "./figures.ts";

/** What a view's x axis counts: a run's calls to the model, or a session's turns. */
export type ContextUnit = "Call" | "Turn";

/** A category's colour, one of the categorical slots `tokens.css` names. */
export const contextSlots = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type ContextSlot = (typeof contextSlots)[number];

/** A name the catalog words, or the runtime's own where the catalog has none. */
export type ContextName = Copy | string;

/** The categories the runtime is known to name, each with its word and slot. */
const contextCategoriesKnown: readonly {
  readonly said: string;
  readonly name: Copy;
  readonly slot: ContextSlot | undefined;
}[] = [
  {
    said: "system prompt",
    name: { id: "context-category-system-prompt" },
    slot: 1,
  },
  {
    said: "system tools",
    name: { id: "context-category-system-tools" },
    slot: 2,
  },
  {
    said: "memory files",
    name: { id: "context-category-memory-files" },
    slot: 3,
  },
  { said: "skills", name: { id: "context-category-skills" }, slot: 4 },
  { said: "messages", name: { id: "context-category-messages" }, slot: 5 },
  { said: "mcp tools", name: { id: "context-category-mcp-tools" }, slot: 6 },
  { said: "custom agents", name: { id: "context-category-agents" }, slot: 7 },
  {
    said: "free space",
    name: { id: "context-category-free" },
    slot: undefined,
  },
  { said: "free", name: { id: "context-category-free" }, slot: undefined },
  {
    said: "autocompact buffer",
    name: { id: "context-category-buffer" },
    slot: undefined,
  },
  {
    said: "deferred tools",
    name: { id: "context-category-deferred" },
    slot: undefined,
  },
];

/** The slot a used category the catalog does not know is drawn in. */
const contextSlotOther: ContextSlot = 8;

/** The categories a view without a reading lists as not recorded, in the order
 * a reading lists them. */
const contextCategoriesUnrecorded: readonly Copy[] = [
  { id: "context-category-system-prompt" },
  { id: "context-category-system-tools" },
  { id: "context-category-memory-files" },
  { id: "context-category-skills" },
  { id: "context-category-messages" },
];

/** One row of the window's legend table. */
export interface ContextCategoryRow {
  readonly name: ContextName;
  readonly kind: RunContextCategoryKind | "Unrecorded" | "Window";
  readonly slot: ContextSlot | undefined;
  readonly tokens: number | undefined;
  /** Of the whole window; absent where nothing named the window, or for a
   * category held out of it. */
  readonly share: Figure | undefined;
}

/** One span of the bar, as fractions of its whole length. */
export interface ContextSegment {
  readonly kind: "Used" | "Free" | "Buffer";
  readonly name: ContextName;
  readonly slot: ContextSlot | undefined;
  readonly tokens: number;
  readonly start: number;
  readonly width: number;
  /** Whether the span is wide enough to carry its name and size inside it. */
  readonly labelled: boolean;
}

/** The window as the latest reading held it, or as far as the series says. */
export interface ContextWindowView {
  readonly unit: ContextUnit;
  /** The call or turn the window is read at, where there is one. */
  readonly at: number | undefined;
  readonly reading: boolean;
  readonly used: number;
  readonly window: number | undefined;
  readonly threshold: number | undefined;
  readonly rows: readonly ContextCategoryRow[];
  /** Empty where nothing named the window, so there is no whole to draw against. */
  readonly segments: readonly ContextSegment[];
}

/** The narrowest a held category is drawn, as a share of the bar, so a small
 * one is still seen. */
export const contextSegmentWidthMin = 0.006;

/** The narrowest span that carries its own name and size inside it. */
export const contextSegmentLabelledMin = 0.12;

/** The category the runtime named, as the catalog words it and the slot it is
 * drawn in. */
export function contextCategoryOf(
  said: string,
  kind: RunContextCategoryKind,
): { readonly name: ContextName; readonly slot: ContextSlot | undefined } {
  const known = contextCategoriesKnown.find(
    (category) => category.said === said.trim().toLowerCase(),
  );
  const slot = kind === "Used" ? (known?.slot ?? contextSlotOther) : undefined;
  return { name: known?.name ?? said, slot };
}

function contextShareOf(
  tokens: number,
  window: number | undefined,
): Figure | undefined {
  return window === undefined || window <= 0
    ? undefined
    : sharePartFigure(tokens / window);
}

/** A reading's categories as the legend lists them: each in the order the
 * runtime gave, a held-out category with no share, and the whole last. */
function contextReadRows(
  window: RunContextWindow,
): readonly ContextCategoryRow[] {
  const rows = window.categories.map((category): ContextCategoryRow => {
    const { name, slot } = contextCategoryOf(category.name, category.kind);
    return {
      name,
      kind: category.kind,
      slot,
      tokens: category.tokens,
      share:
        category.kind === "Deferred"
          ? undefined
          : contextShareOf(category.tokens, window.maxTokens),
    };
  });
  return [...rows, contextWindowRow(window.maxTokens)];
}

function contextWindowRow(window: number): ContextCategoryRow {
  return {
    name: { id: "context-category-window" },
    kind: "Window",
    slot: undefined,
    tokens: window,
    share: contextShareOf(window, window),
  };
}

/** What a view says where no reading split the window: every category not
 * recorded, the context the series last sent as used, and the rest free. */
function contextUnreadRows(
  used: number,
  window: number | undefined,
): readonly ContextCategoryRow[] {
  const unrecorded = contextCategoriesUnrecorded.map(
    (name): ContextCategoryRow => ({
      name,
      kind: "Unrecorded",
      slot: undefined,
      tokens: undefined,
      share: undefined,
    }),
  );
  const usedRow: ContextCategoryRow = {
    name: { id: "context-category-used" },
    kind: "Used",
    slot: undefined,
    tokens: used,
    share: contextShareOf(used, window),
  };
  if (window === undefined) return [...unrecorded, usedRow];
  const free = Math.max(window - used, 0);
  return [
    ...unrecorded,
    usedRow,
    {
      name: { id: "context-category-free" },
      kind: "Free",
      slot: undefined,
      tokens: free,
      share: contextShareOf(free, window),
    },
    contextWindowRow(window),
  ];
}

interface ContextSpan {
  readonly kind: ContextSegment["kind"];
  readonly name: ContextName;
  readonly slot: ContextSlot | undefined;
  readonly tokens: number;
}

/** The spans a reading draws: what is held, then the room left, then the
 * reserve at the far end. A held-out category is not drawn, and a room the
 * reading left out is what the rest of the window comes to. */
function contextReadSpans(window: RunContextWindow): readonly ContextSpan[] {
  const used = window.categories
    .filter((category) => category.kind === "Used" && category.tokens > 0)
    .map((category): ContextSpan => {
      const { name, slot } = contextCategoryOf(category.name, "Used");
      return { kind: "Used", name, slot, tokens: category.tokens };
    });
  const buffer = window.categories
    .filter((category) => category.kind === "Buffer")
    .reduce((sum, category) => sum + category.tokens, 0);
  const free =
    window.categories.find((category) => category.kind === "Free")?.tokens ??
    Math.max(
      window.maxTokens -
        buffer -
        used.reduce((sum, span) => sum + span.tokens, 0),
      0,
    );
  return [
    ...used,
    {
      kind: "Free",
      name: { id: "context-category-free" },
      slot: undefined,
      tokens: free,
    },
    ...(buffer > 0
      ? [
          {
            kind: "Buffer",
            name: { id: "context-category-buffer" },
            slot: undefined,
            tokens: buffer,
          } as const,
        ]
      : []),
  ];
}

/**
 * Each span's share of the bar, a held one never narrower than the least that
 * is seen. What that widening costs is taken from the room left, or from the
 * widest span where there is too little room to give it.
 */
export function contextSegmentsOf(
  spans: readonly ContextSpan[],
  whole: number,
): readonly ContextSegment[] {
  if (whole <= 0) return [];
  const widths = spans.map((span) =>
    span.kind === "Used" && span.tokens > 0
      ? Math.max(span.tokens / whole, contextSegmentWidthMin)
      : span.tokens / whole,
  );
  const over = widths.reduce((sum, width) => sum + width, 0) - 1;
  if (over > 0) {
    const free = spans.findIndex((span) => span.kind === "Free");
    const widest = widths.indexOf(Math.max(...widths));
    const from =
      free >= 0 && (widths[free] ?? 0) >= over ? free : Math.max(widest, 0);
    widths[from] = Math.max((widths[from] ?? 0) - over, 0);
  }
  let start = 0;
  return spans.map((span, index) => {
    const width = widths[index] ?? 0;
    const segment = {
      ...span,
      start,
      width,
      labelled: width >= contextSegmentLabelledMin,
    };
    start += width;
    return segment;
  });
}

/** The window a reading held, read at the call or turn it was taken after. */
export function contextWindowRead(
  unit: ContextUnit,
  at: number | undefined,
  window: RunContextWindow,
): ContextWindowView {
  return {
    unit,
    at,
    reading: true,
    used: window.totalTokens,
    window: window.maxTokens,
    threshold: window.autoCompactThreshold,
    rows: contextReadRows(window),
    segments: contextSegmentsOf(contextReadSpans(window), window.maxTokens),
  };
}

/** The window where no reading split it: the context the series last sent, as
 * used, against the window where something named it. */
export function contextWindowUnread(
  unit: ContextUnit,
  at: number | undefined,
  used: number,
  window: number | undefined,
): ContextWindowView {
  const spans: readonly ContextSpan[] = [
    {
      kind: "Used",
      name: { id: "context-category-used" },
      slot: undefined,
      tokens: used,
    },
    {
      kind: "Free",
      name: { id: "context-category-free" },
      slot: undefined,
      tokens: Math.max((window ?? 0) - used, 0),
    },
  ];
  return {
    unit,
    at,
    reading: false,
    used,
    window,
    threshold: undefined,
    rows: contextUnreadRows(used, window),
    segments: window === undefined ? [] : contextSegmentsOf(spans, window),
  };
}

/** Where a view's figures are read at: the call or turn its unit counts. */
export function contextAtLabel(unit: ContextUnit, at: number): Copy {
  return {
    id: "context-at",
    args: { unit: contextUnitWord(unit), at: groupedDigits(at) },
  };
}

/** The selector word a message chooses its unit's wording by. */
export function contextUnitWord(unit: ContextUnit): string {
  return unit === "Call" ? "call" : "turn";
}

/** A span's name and size, as the bar writes it inside a span wide enough. */
export function contextSegmentLabel(segment: ContextSegment): {
  readonly name: ContextName;
  readonly tokens: string;
} {
  return { name: segment.name, tokens: tokenCountText(segment.tokens) };
}

/** Which series a point of the growth chart belongs to. */
export type ContextSeries = "Main" | "Subagent";

/** The context sent at one call or turn. */
export interface ContextPoint {
  readonly ordinal: number;
  readonly tokens: number;
  readonly series: ContextSeries;
}

/** One compaction, after the call or turn whose point the series last drew
 * before it, with the window's size before it and after it where the runtime
 * said. */
export interface ContextCompactionMark {
  readonly ordinal: number;
  readonly before: number;
  readonly after: number | undefined;
}

/** How the context grew across a run's calls or a session's turns. */
export interface ContextGrowthView {
  readonly unit: ContextUnit;
  readonly points: readonly ContextPoint[];
  readonly compactions: readonly ContextCompactionMark[];
  readonly threshold: number | undefined;
  readonly window: number | undefined;
  /** How many calls or turns the axis counts, which a series may not reach. */
  readonly count: number;
}

/** The highest context the main series reached, and where. */
export function contextPeakOf(
  points: readonly ContextPoint[],
): ContextPoint | undefined {
  let peak: ContextPoint | undefined = undefined;
  for (const point of points)
    if (
      point.series === "Main" &&
      (peak === undefined || point.tokens > peak.tokens)
    )
      peak = point;
  return peak;
}

/** The point before `point` in its own series, which its growth is read from. */
export function contextPointPrevious(
  points: readonly ContextPoint[],
  point: ContextPoint,
): ContextPoint | undefined {
  let previous: ContextPoint | undefined = undefined;
  for (const each of points) {
    if (each.ordinal >= point.ordinal) break;
    if (each.series === point.series) previous = each;
  }
  return previous;
}

/** What a hover over one point says: its context, where it was sent, and how
 * far it moved from the point before it in its series. */
export function contextPointSaid(
  view: ContextGrowthView,
  point: ContextPoint,
): readonly Copy[] {
  const previous = contextPointPrevious(view.points, point);
  const lines: Copy[] = [
    { id: "context-tokens", args: { tokens: groupedDigits(point.tokens) } },
    contextAtLabel(view.unit, point.ordinal),
  ];
  if (point.series === "Subagent") lines.push({ id: "context-point-subagent" });
  if (previous === undefined) return lines;
  const moved = point.tokens - previous.tokens;
  lines.push({
    id: "context-point-moved",
    args: {
      moved: moved >= 0 ? "rose" : "fell",
      growth: groupedDigits(Math.abs(moved)),
      unit: contextUnitWord(view.unit),
      previous: groupedDigits(previous.ordinal),
    },
  });
  return lines;
}

/** A compaction as its rule's label says it: from what to what, or from what
 * alone where the runtime did not say. */
export function contextCompactionSaid(mark: ContextCompactionMark): Copy {
  return mark.after === undefined
    ? {
        id: "context-compacted-from",
        args: { before: groupedDigits(mark.before) },
      }
    : {
        id: "context-compacted",
        args: {
          before: groupedDigits(mark.before),
          after: groupedDigits(mark.after),
        },
      };
}

/** One tile of the Growth row: its name, its figure, and the line under it. */
export interface ContextTile {
  readonly name: Copy;
  readonly value: string | Copy;
  readonly note: Copy | undefined;
}

/** What the Compactions tile says under its count: after which call or turn
 * the last one came, or the threshold where none did. */
function contextCompactionsNote(view: ContextGrowthView): Copy {
  const last = view.compactions.at(-1);
  if (last !== undefined)
    return {
      id: "context-compactions-after",
      args: {
        unit: contextUnitWord(view.unit),
        at: groupedDigits(last.ordinal),
      },
    };
  return view.threshold === undefined
    ? { id: "context-threshold-unrecorded" }
    : {
        id: "context-compactions-at",
        args: { tokens: groupedDigits(view.threshold) },
      };
}

/** The Compactions tile: how many, and what is said under the count. */
export function contextCompactionsTile(view: ContextGrowthView): ContextTile {
  const count = view.compactions.length;
  return {
    name: { id: "context-compactions" },
    value: count === 0 ? { id: "context-none" } : groupedDigits(count),
    note: contextCompactionsNote(view),
  };
}
