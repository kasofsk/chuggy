/**
 * Which rows a typed query keeps, over the one text each row draws.
 */

import { expect, test } from "vitest";

import {
  rosterSearchFilter,
  rosterSearchMatches,
} from "../app/core/rosterSearch.ts";

const drawn = ["kasofsk/chuggy", "gdoteof/scratch", "kasofsk/scratch"];

function kept(query: string): readonly string[] {
  return rosterSearchFilter(drawn, query, (row) => row);
}

test("a term matches whatever case either side is typed in", () => {
  expect(rosterSearchMatches("CHUGGY", "kasofsk/chuggy")).toBe(true);
  expect(rosterSearchMatches("chuggy", "Kasofsk/Chuggy")).toBe(true);
  expect(kept("Scratch")).toStrictEqual(["gdoteof/scratch", "kasofsk/scratch"]);
});

/** Terms are each required and in no order, so a second term narrows. */
test("a row is kept only when every term appears in it", () => {
  expect(kept("scratch kasofsk")).toStrictEqual(["kasofsk/scratch"]);
  expect(kept("  kasofsk \t scratch  ")).toStrictEqual(["kasofsk/scratch"]);
  expect(rosterSearchMatches("kasofsk gdoteof", "kasofsk/scratch")).toBe(false);
});

test("an empty or blank query keeps every row", () => {
  expect(kept("")).toStrictEqual(drawn);
  expect(kept("   ")).toStrictEqual(drawn);
});

test("a query matching nothing keeps no row", () => {
  expect(kept("absent")).toStrictEqual([]);
});
