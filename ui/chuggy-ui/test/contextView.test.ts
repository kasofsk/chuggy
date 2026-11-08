/**
 * The window's bar and legend, and the growth chart's geometry: a held
 * category is never drawn too thin to see, a deferred one is listed and not
 * drawn, a window no reading split says its categories were not recorded,
 * and the chart breaks its line at each compaction and keeps a subagent's
 * calls apart.
 */

import { expect, test } from "vitest";

import {
  contextChartBroken,
  contextChartOf,
  contextChartRuns,
  contextChartTicksX,
  contextChartTicksY,
  contextChartTop,
} from "../app/core/contextChart.ts";
import { contextSessionOf } from "../app/core/contextSession.ts";
import type { ContextGrowthView } from "../app/core/contextView.ts";
import {
  contextCompactionsTile,
  contextPeakOf,
  contextPointSaid,
  contextSegmentWidthMin,
  contextWindowRead,
  contextWindowUnread,
} from "../app/core/contextView.ts";
import { contextSessionBody, contextWindow } from "./contextFixture.ts";

test("a reading's bar draws what is held, then the room left, then the buffer, and no deferred tools", () => {
  const view = contextWindowRead("Call", 173, contextWindow());
  expect(view.segments.map((segment) => segment.kind)).toStrictEqual([
    "Used",
    "Used",
    "Used",
    "Used",
    "Used",
    "Free",
    "Buffer",
  ]);
  const ends = view.segments.at(-1);
  expect((ends?.start ?? 0) + (ends?.width ?? 0)).toBeCloseTo(1, 9);
  expect(view.rows.map((row) => row.kind)).toStrictEqual([
    "Used",
    "Used",
    "Used",
    "Used",
    "Used",
    "Free",
    "Buffer",
    "Deferred",
    "Window",
  ]);
  expect(
    view.rows.find((row) => row.kind === "Deferred")?.share,
  ).toBeUndefined();
});

test("a held category far under the least visible width is drawn at it, at the room left's cost", () => {
  const view = contextWindowRead(
    "Call",
    1,
    contextWindow({
      maxTokens: 1_000_000,
      categories: [
        { name: "System prompt", tokens: 10, kind: "Used" },
        { name: "Messages", tokens: 500_000, kind: "Used" },
        { name: "Free space", tokens: 499_990, kind: "Free" },
      ],
    }),
  );
  const [prompt, messages, free] = view.segments;
  expect(prompt?.width).toBe(contextSegmentWidthMin);
  expect(messages?.width).toBe(0.5);
  expect((free?.width ?? 0) + contextSegmentWidthMin + 0.5).toBeCloseTo(1, 9);
});

test("a window no reading split lists every category as not recorded, and the series' context as used", () => {
  const view = contextWindowUnread("Call", 173, 300_000, 1_000_000);
  expect(view.rows.filter((row) => row.kind === "Unrecorded")).toHaveLength(5);
  expect(
    view.rows
      .filter((row) => row.kind !== "Unrecorded")
      .map((row) => [row.kind, row.tokens]),
  ).toStrictEqual([
    ["Used", 300_000],
    ["Free", 700_000],
    ["Window", 1_000_000],
  ]);
  expect(view.threshold).toBeUndefined();
});

const growth: ContextGrowthView = {
  unit: "Call",
  points: [
    { ordinal: 1, tokens: 20_000, series: "Main" },
    { ordinal: 2, tokens: 30_000, series: "Main" },
    { ordinal: 3, tokens: 9_000, series: "Subagent" },
    { ordinal: 4, tokens: 11_000, series: "Subagent" },
    { ordinal: 5, tokens: 317_000, series: "Main" },
    { ordinal: 6, tokens: 45_000, series: "Main" },
  ],
  compactions: [{ ordinal: 5, before: 317_189, after: 45_000 }],
  threshold: 317_000,
  window: 350_000,
  count: 6,
};

test("the main line breaks at a compaction, and a subagent's calls run apart from it", () => {
  const main = growth.points.filter((point) => point.series === "Main");
  expect(
    contextChartBroken(main, growth.compactions).map((piece) =>
      piece.map((point) => point.ordinal),
    ),
  ).toStrictEqual([[1, 2, 5], [6]]);
  expect(
    contextChartRuns(
      growth.points.filter((point) => point.series === "Subagent"),
    ).map((run) => run.map((point) => point.ordinal)),
  ).toStrictEqual([[3, 4]]);
  const chart = contextChartOf(growth, 640);
  expect([
    chart.main.length,
    chart.subagent.length,
    chart.compactions.length,
  ]).toStrictEqual([2, 1, 1]);
  expect(chart.threshold?.y).toBeLessThan(chart.plot.bottom);
});

/** The x of a path's vertices, from its `M` and `L` commands. */
function contextPathXs(path: string | undefined): readonly number[] {
  return [...(path ?? "").matchAll(/[ML](-?[\d.]+) /gu)].map((match) =>
    Number(match[1]),
  );
}

test("a run's compaction stands between the call it followed and the next, which opens the next stretch", () => {
  const chart = contextChartOf(growth, 640);
  const [before, after] = chart.main;
  const call = (ordinal: number): number =>
    chart.plot.left +
    ((ordinal - 1) / (growth.count - 1)) * (chart.plot.right - chart.plot.left);
  expect(chart.compactions[0]?.x).toBeCloseTo((call(5) + call(6)) / 2, 1);
  expect(contextPathXs(before?.line).at(-1)).toBeCloseTo(call(5), 1);
  expect(contextPathXs(after?.line)[0]).toBeCloseTo(call(6), 1);
});

test("a session's compaction stands before the turn it fell in, after the line's rise to the turn before, and that turn opens the next stretch low", () => {
  const body = contextSessionBody(
    [50_000, 120_000, 165_000, 46_000, 70_000].map((total, at) => ({
      ordinal: at + 1,
      total,
    })),
  );
  const view = contextSessionOf({
    context: {
      ...body,
      turns: body.turns.map((turn) => ({
        ...turn,
        readings: turn.readings.map((reading) => ({
          ...reading,
          recordedAt: `2026-11-08T0${String(turn.ordinal)}:00:00.000Z`,
        })),
      })),
    },
    entries: [],
    cuts: [
      {
        boundary: "cut",
        at: "2026-11-08T03:30:00.000Z",
        tokensBefore: 172_355,
        tokensAfter: 36_000,
      },
    ],
  });
  expect(view.growth.compactions).toStrictEqual([
    { ordinal: 3, before: 172_355, after: 36_000 },
  ]);
  const chart = contextChartOf(view.growth, 640);
  const turn = (ordinal: number): number =>
    chart.plot.left +
    ((ordinal - 1) / (view.growth.count - 1)) *
      (chart.plot.right - chart.plot.left);
  const rule = chart.compactions[0]?.x ?? Number.NaN;
  expect(rule).toBeCloseTo((turn(3) + turn(4)) / 2, 1);
  const [before, after] = chart.main;
  expect(contextPathXs(before?.line)).toHaveLength(3);
  expect(contextPathXs(before?.line).at(-1)).toBeCloseTo(turn(3), 1);
  expect(contextPathXs(after?.line)[0]).toBeCloseTo(turn(4), 1);
});

test("the peak is the highest the context reached, a compaction's figure before it included", () => {
  expect(contextPeakOf(growth)).toStrictEqual({
    ordinal: 5,
    tokens: 317_189,
    series: "Main",
  });
  expect(
    contextPeakOf({
      ...growth,
      compactions: [{ ordinal: 5, before: 300_000, after: 45_000 }],
    }),
  ).toStrictEqual({ ordinal: 5, tokens: 317_000, series: "Main" });
});

test("the vertical scale is the window where one is named, and a counted step otherwise", () => {
  expect(contextChartTop({ ...growth, window: 1_000_000 })).toBe(1_000_000);
  expect(
    contextChartTop({ ...growth, window: undefined, threshold: undefined }),
  ).toBe(350_000);
  expect(contextChartTicksY(1_000_000)).toStrictEqual([
    0, 250_000, 500_000, 750_000, 1_000_000,
  ]);
  expect(contextChartTicksX(173)).toStrictEqual([
    1, 20, 40, 60, 80, 100, 120, 140, 160,
  ]);
});

test("a hover says the context, the call, and how far it moved from the call before it in its series", () => {
  const point = growth.points[3];
  if (point === undefined) throw new Error("no point");
  expect(contextPointSaid(growth, point)).toStrictEqual([
    { id: "context-tokens", args: { tokens: "11,000" } },
    { id: "context-at", args: { unit: "call", at: "4" } },
    { id: "context-point-subagent" },
    {
      id: "context-point-moved",
      args: { moved: "rose", growth: "2,000", unit: "call", previous: "3" },
    },
  ]);
});

test("the compactions tile counts them and says after which call the last came, or the threshold where none did", () => {
  expect(contextCompactionsTile(growth).note).toStrictEqual({
    id: "context-compactions-after",
    args: { unit: "call", at: "5" },
  });
  expect(
    contextCompactionsTile({ ...growth, compactions: [], threshold: undefined })
      .note,
  ).toStrictEqual({
    id: "context-threshold-unrecorded",
  });
});
