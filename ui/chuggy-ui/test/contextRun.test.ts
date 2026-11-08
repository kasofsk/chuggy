/**
 * A run's series as the Context tab reads it: rows the runtime recorded for
 * one request are one call, a subagent's calls are a series of their own, a
 * compaction falls at the call it followed, and the window is a reading's
 * where one was taken and the series' last call against the snapshot's window
 * where none was.
 */

import { expect, test } from "vitest";

import {
  contextCacheRead,
  contextCallsOf,
  contextRunCompactions,
  contextRunGrowth,
  contextRunReadingsPageRows,
  contextRunTiles,
  contextRunTurnsPageRows,
  contextRunWindow,
} from "../app/core/contextRun.ts";
import {
  runContextPageReadingsMax,
  runTurnsPageLimitMax,
} from "../../../src/contract/http.ts";
import {
  contextCompacted,
  contextReading,
  contextRow,
  contextWindow,
} from "./contextFixture.ts";

test("consecutive rows with the same model and the same three input figures are one call", () => {
  const calls = contextCallsOf([
    contextRow(1, { read: 1_000 }),
    contextRow(2, { read: 1_000 }),
    contextRow(3, { read: 1_000 }),
    contextRow(4, { read: 1_500 }),
    contextRow(5, { read: 1_500, model: "claude-haiku-4-5" }),
  ]);
  expect(
    calls.map((call) => [call.call, call.rowFirst, call.rowLast, call.tokens]),
  ).toStrictEqual([
    [1, 1, 3, 1_102],
    [2, 4, 4, 1_602],
    [3, 5, 5, 1_602],
  ]);
});

test("the same figures apart are two calls, and rows out of order are folded in order", () => {
  const calls = contextCallsOf([
    contextRow(3, { read: 1_000 }),
    contextRow(1, { read: 1_000 }),
    contextRow(2, { read: 2_000 }),
  ]);
  expect(calls.map((call) => call.rowFirst)).toStrictEqual([1, 2, 3]);
});

test("a row naming a subagent's call is of the subagent series, and never folds into the main call beside it", () => {
  const calls = contextCallsOf([
    contextRow(1, { read: 1_000 }),
    contextRow(2, { read: 1_000, parent: "toolu_1" }),
    contextRow(3, { read: 1_000, parent: "toolu_1" }),
    contextRow(4, { read: 1_200 }),
  ]);
  expect(calls.map((call) => [call.call, call.series])).toStrictEqual([
    [1, "Main"],
    [2, "Subagent"],
    [3, "Main"],
  ]);
  const growth = contextRunGrowth(
    calls,
    [],
    contextRunWindow(calls, [], undefined),
  );
  expect(growth.points.map((point) => point.series)).toStrictEqual([
    "Main",
    "Subagent",
    "Main",
  ]);
  const tiles = contextRunTiles(calls, growth);
  expect(tiles[1]?.note).toStrictEqual({
    id: "context-subagent-calls",
    args: { count: "1" },
  });
});

test("a compaction is drawn at the call whose rows it was read after, with its sizes", () => {
  const calls = contextCallsOf([
    contextRow(1, { read: 100_000 }),
    contextRow(2, { read: 100_000 }),
    contextRow(3, { read: 317_000 }),
    contextRow(4, { read: 45_000 }),
  ]);
  expect(
    contextRunCompactions(calls, [
      contextReading(1, 1, undefined),
      contextCompacted(2, 3, 317_189, 45_000),
    ]),
  ).toStrictEqual([{ ordinal: 2, before: 317_189, after: 45_000 }]);
});

test("the window is the newest reading's, read at the call it followed", () => {
  const calls = contextCallsOf([
    contextRow(1, { read: 1_000 }),
    contextRow(2, { read: 2_000 }),
  ]);
  const window = contextRunWindow(
    calls,
    [
      contextReading(1, 1, contextWindow({ totalTokens: 1 })),
      contextReading(2, 2, contextWindow()),
    ],
    350_000,
  );
  expect([
    window.reading,
    window.at,
    window.used,
    window.window,
    window.threshold,
  ]).toStrictEqual([true, 2, 373_880, 1_000_000, 967_000]);
});

test("with no reading the window is the last main call against the window the snapshot named, or used alone", () => {
  const calls = contextCallsOf([
    contextRow(1, { read: 1_000 }),
    contextRow(2, { read: 9_000, parent: "toolu_1" }),
  ]);
  const named = contextRunWindow(calls, [], 350_000);
  expect([
    named.reading,
    named.at,
    named.used,
    named.window,
    named.threshold,
  ]).toStrictEqual([false, 1, 1_102, 350_000, undefined]);
  expect(named.segments.map((segment) => segment.kind)).toStrictEqual([
    "Used",
    "Free",
  ]);
  const alone = contextRunWindow(calls, [], undefined);
  expect([alone.window, alone.segments]).toStrictEqual([undefined, []]);
});

test("cache read is what every call read from cache, and its share of everything they read", () => {
  const cache = contextCacheRead(
    contextCallsOf([
      contextRow(1, { input: 0, read: 900, created: 100 }),
      contextRow(2, { input: 0, read: 900, created: 100, parent: "toolu_1" }),
    ]),
  );
  expect(cache.tokens).toBe(1_800);
  expect(cache.share?.kind === "Quantity" ? cache.share.text : undefined).toBe(
    "90",
  );
});

test("a page of either series asks for the most rows the server answers", () => {
  expect(contextRunTurnsPageRows).toBe(runTurnsPageLimitMax);
  expect(contextRunReadingsPageRows).toBe(runContextPageReadingsMax);
});
