/**
 * The rail's calendar buckets, with no renderer.
 *
 * Every moment here is built with the local `Date` constructor rather than
 * `Date.UTC` or a `Z`-suffixed literal: the buckets are the reader's own
 * calendar days, so a case naming "just before midnight" must mean the local
 * one, not whichever moment UTC midnight happens to be in the runner's zone.
 */

import { expect, test } from "vitest";

import { threadGroupHeading, threadGroups } from "../app/core/threadGroups.ts";

const noon = new Date(2026, 8, 7, 12, 0, 0).getTime();

test("a moment on the reader's own day is Today", () => {
  expect(
    threadGroupHeading(new Date(2026, 8, 7, 0, 1, 0).getTime(), noon),
  ).toBe("Today");
});

test("a moment just before local midnight is Yesterday and just after it is Today", () => {
  const yesterdayLate = new Date(2026, 8, 6, 23, 59, 0).getTime();
  const todayEarly = new Date(2026, 8, 7, 0, 1, 0).getTime();
  expect(threadGroupHeading(yesterdayLate, noon)).toBe("Yesterday");
  expect(threadGroupHeading(todayEarly, noon)).toBe("Today");
});

test("the boundary at seven days is the last day Previous 7 days holds", () => {
  const sevenDaysAgo = new Date(2026, 7, 31, 12, 0, 0).getTime();
  const eightDaysAgo = new Date(2026, 7, 30, 12, 0, 0).getTime();
  expect(threadGroupHeading(sevenDaysAgo, noon)).toBe("Previous 7 days");
  expect(threadGroupHeading(eightDaysAgo, noon)).toBe("Previous 30 days");
});

test("the boundary at thirty days is the last day Previous 30 days holds", () => {
  const thirtyDaysAgo = new Date(2026, 7, 8, 12, 0, 0).getTime();
  const thirtyOneDaysAgo = new Date(2026, 7, 7, 12, 0, 0).getTime();
  expect(threadGroupHeading(thirtyDaysAgo, noon)).toBe("Previous 30 days");
  expect(threadGroupHeading(thirtyOneDaysAgo, noon)).toBe("Older");
});

test("items group in heading order and keep the caller's order within a bucket", () => {
  const items = [
    { id: "a", atMs: new Date(2026, 8, 6, 9, 0, 0).getTime() },
    { id: "b", atMs: new Date(2026, 8, 7, 8, 0, 0).getTime() },
    { id: "c", atMs: new Date(2026, 8, 7, 9, 0, 0).getTime() },
    { id: "d", atMs: new Date(2026, 6, 1, 9, 0, 0).getTime() },
  ];
  const groups = threadGroups(items, (item) => item.atMs, noon);
  expect(groups.map((group) => group.heading)).toEqual([
    "Today",
    "Yesterday",
    "Older",
  ]);
  expect(groups[0]?.entries.map((item) => item.id)).toEqual(["b", "c"]);
});

test("a bucket nothing fell into is not drawn", () => {
  const groups = threadGroups(
    [{ id: "only", atMs: noon }],
    (item) => item.atMs,
    noon,
  );
  expect(groups).toEqual([
    { heading: "Today", entries: [{ id: "only", atMs: noon }] },
  ]);
});
