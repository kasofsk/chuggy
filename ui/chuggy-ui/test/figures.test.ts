/**
 * The formatters every figure on the console is drawn from.
 *
 * A dollar is checked for its basis tag as well as its digits, because the tag
 * is the half that stops a list price being read as a bill; a duration and a
 * token count are checked at the boundaries their scales change at, because a
 * figure that is right in the middle of a range and wrong at its edge reads as
 * a working formatter.
 */

import { expect, test } from "vitest";

import type { Figure } from "../app/core/figures.ts";
import {
  agoFigure,
  agoText,
  bytesSetFigure,
  costFigure,
  countFigure,
  durationText,
  instantFigure,
  instantFigureAtMs,
  instantText,
  sinceFigure,
  spanSetFigure,
  spendFigures,
  tokenCountText,
  tokensFigure,
} from "../app/core/figures.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { copyOrDataText } from "../app/core/copy.ts";

/** The drawn text of a figure, which every kind but an absence carries. */
function textOf(figure: Figure): string {
  switch (figure.kind) {
    case "Absent":
    case "Span":
      throw new Error(`no plain text on a ${figure.kind} figure`);
    case "Ago":
      return copyTextEn(figure.text);
    case "Tokens":
      return figure.unit === undefined
        ? figure.text
        : `${figure.text} ${copyTextEn(figure.unit)}`;
    case "Instant":
      return copyOrDataText(copyTextEn, figure.text);
    case "Cost":
    case "Duration":
    case "Quantity":
      return figure.text;
  }
}

/** The basis a cost figure carries, which is the half a bill would not have. */
function basisOf(figure: Figure): string | undefined {
  if (figure.kind !== "Cost") throw new Error("not a cost figure");
  return figure.basis === undefined ? undefined : copyTextEn(figure.basis);
}

function tokens(counts: {
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
}) {
  return {
    tokensInput: counts.input ?? 0,
    tokensOutput: counts.output ?? 0,
    tokensCacheCreation: counts.cacheCreation ?? 0,
    tokensCacheRead: counts.cacheRead ?? 0,
  };
}

test("a cost is cents, is finer below a cent, and always carries its basis", () => {
  const listed = costFigure(420_000, "List");
  expect(listed).toEqual({
    kind: "Cost",
    text: "$0.42",
    basis: { id: "figures-basis-list" },
  });
  expect(textOf(costFigure(3_100, "List"))).toBe("$0.0031");
  expect(textOf(costFigure(0, "List"))).toBe("$0.00");
  expect(textOf(costFigure(12_800_000, "List"))).toBe("$12.80");
  expect(basisOf(costFigure(420_000, "Mixed"))).toBe("mixed");
});

/**
 * A cent is the boundary the rule is written about: cents can state exactly a
 * cent, so exactly a cent is drawn in cents and only what is below it is finer.
 */
test("a cost of exactly one cent is drawn in cents, and one below it is not", () => {
  expect(textOf(costFigure(10_000, "List"))).toBe("$0.01");
  expect(textOf(costFigure(9_999, "List"))).toBe("$0.0100");
  expect(textOf(costFigure(10_001, "List"))).toBe("$0.01");
});

/**
 * Each scale boundary twice: the last count in the smaller unit and the first
 * in the larger, including the one that rounds up out of its own bucket.
 */
test("a token count changes unit at the boundary, and never reads as a thousand of one", () => {
  expect(textOf(tokensFigure(tokens({ input: 999 })))).toBe("999 tok");
  expect(textOf(tokensFigure(tokens({ input: 1_000 })))).toBe("1.0k tok");
  expect(textOf(tokensFigure(tokens({ input: 999_499 })))).toBe("999k tok");
  expect(textOf(tokensFigure(tokens({ input: 999_500 })))).toBe("1.0M tok");
  expect(textOf(tokensFigure(tokens({ input: 999_999 })))).toBe("1.0M tok");
  expect(textOf(tokensFigure(tokens({ input: 1_000_000 })))).toBe("1.0M tok");
});

test("one kind of token is the same scale without the unit word", () => {
  expect(tokenCountText(41_000)).toBe("41k");
  expect(tokenCountText(999)).toBe("999");
  expect(tokenCountText(1_200_000)).toBe("1.2M");
});

/**
 * The decimal belongs below ten of a unit, and a count that rounds up to ten is
 * not below it — the same bucket error as `1000k`, one unit down.
 */
test("a count that rounds up to ten of a unit is drawn whole, not with a decimal", () => {
  expect(tokenCountText(9_949)).toBe("9.9k");
  expect(tokenCountText(9_999)).toBe("10k");
  expect(tokenCountText(10_000)).toBe("10k");
  expect(tokenCountText(9_999_999)).toBe("10M");
});

test("a token figure is every kind added, scaled with one decimal below ten", () => {
  expect(textOf(tokensFigure(tokens({ input: 800, output: 12 })))).toBe(
    "812 tok",
  );
  expect(textOf(tokensFigure(tokens({ input: 9_100 })))).toBe("9.1k tok");
  expect(textOf(tokensFigure(tokens({ input: 38_000 })))).toBe("38k tok");
  expect(textOf(tokensFigure(tokens({ input: 1_200_000 })))).toBe("1.2M tok");
  expect(
    textOf(
      tokensFigure(
        tokens({ input: 10, output: 10, cacheCreation: 10, cacheRead: 10 }),
      ),
    ),
  ).toBe("40 tok");
});

test("a duration is the largest two units, whole, and says when it is under a second", () => {
  expect(durationText(400)).toBe("<1s");
  expect(durationText(48_000)).toBe("48s");
  expect(durationText(252_000)).toBe("4m 12s");
  expect(durationText(3_960_000)).toBe("1h 06m");
  expect(durationText(183_600_000)).toBe("2d 3h");
});

test("an instant is the clock today, the date within the year, and the year before it", () => {
  const now = new Date(2026, 7, 27, 11, 7);
  const said = (at: Date): string =>
    copyOrDataText(copyTextEn, instantText(at, now));
  expect(said(new Date(2026, 7, 27, 10, 12))).toBe("10:12");
  expect(said(new Date(2026, 7, 26, 18, 40))).toBe("Aug 26 18:40");
  expect(said(new Date(2026, 0, 3, 7, 5))).toBe("Jan 3 07:05");
  expect(said(new Date(2025, 10, 2, 9, 0))).toBe("2025-11-02 09:00");
});

const agoNowMs = Date.parse("2026-08-26T12:00:00Z");

test("how long ago is the largest whole unit, at each boundary its scale changes", () => {
  expect(agoText(agoNowMs, agoNowMs - 3_000)).toBe("3s");
  expect(agoText(agoNowMs, agoNowMs - 59_000)).toBe("59s");
  expect(agoText(agoNowMs, agoNowMs - 60_000)).toBe("1m");
  expect(agoText(agoNowMs, agoNowMs - 3_600_000 + 1)).toBe("59m");
  expect(agoText(agoNowMs, agoNowMs - 3_600_000)).toBe("1h");
  expect(agoText(agoNowMs, agoNowMs - 3_600_000 * 24 + 1)).toBe("23h");
  expect(agoText(agoNowMs, agoNowMs - 3_600_000 * 24)).toBe("1d");
});

test("a clock that ran backwards reads as no time elapsed, not a negative one", () => {
  expect(agoText(agoNowMs, agoNowMs + 10_000)).toBe("0s");
});

test("an instant the clock cannot read is an absence, never a printed string", () => {
  expect(agoFigure("not an instant", agoNowMs).kind).toBe("Absent");
});

test("an instant counted in milliseconds reads as one stated does, and one no date holds is an absence", () => {
  const at = new Date(2026, 7, 26, 18, 40);
  const now = new Date(2026, 7, 27, 11, 7).getTime();
  expect(instantFigureAtMs(at.getTime(), now)).toStrictEqual(
    instantFigure(at.toISOString(), now),
  );
  expect(textOf(instantFigureAtMs(at.getTime(), now))).toBe("Aug 26 18:40");
  expect(instantFigureAtMs(Number.MAX_SAFE_INTEGER, now).kind).toBe("Absent");
  expect(instantFigure("not an instant", now).kind).toBe("Absent");
});

test("an ago figure carries the relative reading and the full date and clock for its hover", () => {
  const at = new Date(2026, 7, 24, 12, 0);
  const figure = agoFigure(at.toISOString(), at.getTime() + 3_600_000 * 24 * 2);
  if (figure.kind !== "Ago") throw new Error("not an ago figure");
  expect(textOf(figure)).toBe("2d ago");
  expect(figure.full).toBe("2026-08-24 12:00");
});

test("an ago on the ticket page is two units, names what happened and hovers the second", () => {
  const at = new Date(2026, 7, 27, 10, 19, 5);
  const figure = sinceFigure(at.toISOString(), at.getTime() + 634_000, {
    id: "figures-happened-started",
  });
  if (figure.kind !== "Ago") throw new Error("not an ago figure");
  expect(textOf(figure)).toBe("Started 10m 34s ago");
  expect(figure.full).toBe("2026-08-27 10:19:05");
  const bare = sinceFigure(at.toISOString(), at.getTime() + 4_000);
  if (bare.kind !== "Ago") throw new Error("not an ago figure");
  expect(textOf(bare)).toBe("4s ago");
  expect(sinceFigure("not an instant", 0).kind).toBe("Absent");
});

test("a spend with no totals is an absence", () => {
  const absent = spendFigures(undefined, undefined);
  expect(absent.cost.kind).toBe("Absent");
  expect(absent.tokens.kind).toBe("Absent");
});

/** The unit a quantity carries, which is the half that says what it counts. */
function unitOf(figure: Figure): string {
  if (figure.kind !== "Quantity") throw new Error("not a quantity figure");
  return copyTextEn(figure.unit);
}

/**
 * A CEILING IS NOT SCALED. A token budget drawn as `17.5M` is a number nobody
 * typed and nobody can check against the box they type it into, which is why
 * the set figures group their digits instead of shortening them.
 */
test("a count keeps every digit it was given, in groups", () => {
  const tokens = { id: "figures-unit-tokens" } as const;
  const calls = { id: "figures-unit-calls" } as const;
  expect(textOf(countFigure(17_523_063, tokens))).toBe("17,523,063");
  expect(unitOf(countFigure(17_523_063, tokens))).toBe("tokens");
  expect(textOf(countFigure(0, { id: "figures-unit-pages" }))).toBe("0");
  expect(textOf(countFigure(999, calls))).toBe("999");
  expect(textOf(countFigure(1000, calls))).toBe("1,000");
});

/** A span somebody set is written in the largest unit that states it exactly,
 * because rounding a ceiling states a limit the project does not have. */
test("a set span takes the largest unit that is still exact", () => {
  expect(textOf(spanSetFigure(3_600_000))).toBe("1");
  expect(unitOf(spanSetFigure(3_600_000))).toBe("h");
  expect(textOf(spanSetFigure(900_000))).toBe("15");
  expect(unitOf(spanSetFigure(900_000))).toBe("min");
  expect(textOf(spanSetFigure(90_000))).toBe("90");
  expect(unitOf(spanSetFigure(90_000))).toBe("s");
  expect(unitOf(spanSetFigure(500))).toBe("ms");
});

/** A span that does not divide exactly into a coarser unit stays in
 * milliseconds rather than round to a whole one that misstates it. */
test("a set span that is not a whole coarser unit stays in milliseconds", () => {
  expect(textOf(spanSetFigure(900_500))).toBe("900,500");
  expect(unitOf(spanSetFigure(900_500))).toBe("ms");
  expect(textOf(spanSetFigure(90_500))).toBe("90,500");
  expect(unitOf(spanSetFigure(90_500))).toBe("ms");
  expect(textOf(spanSetFigure(1_500))).toBe("1,500");
  expect(unitOf(spanSetFigure(1_500))).toBe("ms");
});

test("a set size takes the largest binary unit that is still exact", () => {
  expect(textOf(bytesSetFigure(1_048_576))).toBe("1");
  expect(unitOf(bytesSetFigure(1_048_576))).toBe("MiB");
  expect(unitOf(bytesSetFigure(2048))).toBe("KiB");
  expect(unitOf(bytesSetFigure(1500))).toBe("bytes");
  expect(unitOf(bytesSetFigure(0))).toBe("bytes");
});
