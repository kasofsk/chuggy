/**
 * The epic page carries no trains: nothing of the page, of the epic's core
 * modules, of its sheets or of their tests names one, so a train drawn on
 * the graph cannot come back unnoticed. The conversation's locomotive is
 * another thing and is not read here.
 */

import { expect, test } from "vitest";

const epicSources = import.meta.glob<string>(
  [
    "../app/browser/EpicPage.tsx",
    "../app/browser/EpicsPage.tsx",
    "../app/browser/Epic.css",
    "../app/browser/epic/*",
    "../app/core/epic*.ts",
    "./epic*",
  ],
  { query: "?raw", import: "default", eager: true },
);

test("the epic page's sources are read", () => {
  expect(Object.keys(epicSources)).toContain("../app/core/epics.ts");
  expect(Object.keys(epicSources)).toContain(
    "../app/browser/epic/EpicGraphView.tsx",
  );
});

test("nothing on the epic page names a train", () => {
  const naming = Object.entries(epicSources)
    .filter(
      ([path, source]) =>
        !path.endsWith("/epicTrainsAbsent.test.ts") &&
        /\btrains?\b|Trains?\b/u.test(source),
    )
    .map(([path]) => path);
  expect(naming).toStrictEqual([]);
});
