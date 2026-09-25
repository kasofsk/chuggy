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
  instantText,
  settledFigure,
  sinceFigure,
  spanFigure,
  spanSetFigure,
  spendFigures,
  tokenCountText,
  tokensFigure,
  whenFigure,
} from "../app/core/figures.ts";

/** The drawn text of a figure, which every kind but an absence carries. */
function textOf(figure: Figure): string {
  if (figure.kind === "Absent" || figure.kind === "Span")
    throw new Error(`no plain text on a ${figure.kind} figure`);
  return figure.text;
}

/** The basis a cost figure carries, which is the half a bill would not have. */
function basisOf(figure: Figure): string | undefined {
  if (figure.kind !== "Cost") throw new Error("not a cost figure");
  return figure.basis;
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
  expect(listed).toEqual({ kind: "Cost", text: "$0.42", basis: "list" });
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
  expect(instantText(new Date(2026, 7, 27, 10, 12), now)).toBe("10:12");
  expect(instantText(new Date(2026, 7, 26, 18, 40), now)).toBe("Aug 26 18:40");
  expect(instantText(new Date(2025, 10, 2, 9, 0), now)).toBe(
    "2025-11-02 09:00",
  );
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

test("an ago figure carries the relative reading and the full date and clock for its hover", () => {
  const at = new Date(2026, 7, 24, 12, 0);
  const figure = agoFigure(at.toISOString(), at.getTime() + 3_600_000 * 24 * 2);
  if (figure.kind !== "Ago") throw new Error("not an ago figure");
  expect(figure.text).toBe("2d ago");
  expect(figure.full).toBe("2026-08-24 12:00");
});

test("a closed span says when it started and how long it ran, an open one only when", () => {
  const from = "2026-08-27T10:19:00Z";
  const nowMs = Date.parse("2026-08-27T11:07:00Z");
  const closed = spanFigure({ from, to: "2026-08-27T10:49:00Z" }, nowMs);
  expect(closed.kind).toBe("Span");
  if (closed.kind !== "Span") throw new Error("not a span");
  expect(closed.parts).toEqual(["started 48m ago", "ran 30m"]);
  expect(closed.open).toBe(false);
  const open = spanFigure({ from, to: undefined }, nowMs);
  if (open.kind !== "Span") throw new Error("not a span");
  expect(open.parts).toEqual(["started 48m ago"]);
  expect(open.open).toBe(true);
});

test("a span hovers its absolute ends, to the second", () => {
  const from = new Date(2026, 7, 27, 10, 19, 5);
  const to = new Date(2026, 7, 27, 10, 49, 0);
  const closed = spanFigure(
    { from: from.toISOString(), to: to.toISOString() },
    to.getTime(),
  );
  if (closed.kind !== "Span") throw new Error("not a span");
  expect(closed.title).toBe("2026-08-27 10:19:05 → 2026-08-27 10:49:00");
  const open = spanFigure({ from: from.toISOString(), to: undefined }, 0);
  if (open.kind !== "Span") throw new Error("not a span");
  expect(open.title).toBe("2026-08-27 10:19:05");
});

test("a row's window is when it started, and once ended how long it ran", () => {
  const nowMs = Date.parse("2026-08-27T11:07:00Z");
  const ended = whenFigure(
    {
      registeredAt: "2026-08-27T10:31:00Z",
      terminalAt: "2026-08-27T10:48:40Z",
    },
    nowMs,
  );
  if (ended.kind !== "Span") throw new Error("not a span");
  expect(ended.parts).toEqual(["started 36m ago", "ran 17m 40s"]);
  const running = whenFigure({ registeredAt: "2026-08-27T11:03:20Z" }, nowMs);
  if (running.kind !== "Span") throw new Error("not a span");
  expect(running.parts).toEqual(["started 3m 40s ago"]);
  expect(running.open).toBe(true);
});

/**
 * §5.2's waiting reading: where the wire carries the first attempt's opening,
 * the queue is its own figure and the start is the run's, and where it does not
 * the row is timed from its registration as it was before the field existed.
 */
test("a row separates the wait from the run where the wire carries the start", () => {
  const nowMs = Date.parse("2026-08-27T11:07:00Z");
  const ran = whenFigure(
    {
      registeredAt: "2026-08-27T10:31:00Z",
      startedAt: "2026-08-27T10:31:12Z",
      terminalAt: "2026-08-27T10:48:40Z",
    },
    nowMs,
  );
  if (ran.kind !== "Span") throw new Error("not a span");
  expect(ran.parts).toEqual([
    "started 35m 48s ago",
    "waited 12s",
    "ran 17m 28s",
  ]);
  const running = whenFigure(
    {
      registeredAt: "2026-08-27T11:03:20Z",
      startedAt: "2026-08-27T11:03:32Z",
    },
    nowMs,
  );
  if (running.kind !== "Span") throw new Error("not a span");
  expect(running.parts).toEqual(["started 3m 28s ago", "waited 12s"]);
  expect(running.open).toBe(true);
});

test("an ago on the ticket page is two units, names what happened and hovers the second", () => {
  const at = new Date(2026, 7, 27, 10, 19, 5);
  const figure = sinceFigure(
    at.toISOString(),
    at.getTime() + 634_000,
    "started",
  );
  if (figure.kind !== "Ago") throw new Error("not an ago figure");
  expect(figure.text).toBe("started 10m 34s ago");
  expect(figure.full).toBe("2026-08-27 10:19:05");
  const bare = sinceFigure(at.toISOString(), at.getTime() + 4_000);
  if (bare.kind !== "Ago") throw new Error("not an ago figure");
  expect(bare.text).toBe("4s ago");
  expect(sinceFigure("not an instant", 0).kind).toBe("Absent");
});

test("a settled window is read from when it last moved, and how long it ran where it ran", () => {
  const nowMs = Date.parse("2026-08-27T11:07:00Z");
  const changedAt = "2026-08-27T10:44:00Z";
  const ran = settledFigure(
    changedAt,
    { from: "2026-08-27T10:07:00Z", to: undefined },
    nowMs,
  );
  if (ran.kind !== "Span") throw new Error("not a span");
  expect(ran.parts).toEqual(["23m ago", "ran 37m"]);
  expect(ran.open).toBe(false);
  const never = settledFigure(
    changedAt,
    { from: undefined, to: undefined },
    nowMs,
  );
  if (never.kind !== "Span") throw new Error("not a span");
  expect(never.parts).toEqual(["23m ago"]);
});

test("a span with no readable start, and a spend with no totals, are absences", () => {
  expect(spanFigure({ from: undefined, to: undefined }, 0).kind).toBe("Absent");
  expect(spanFigure({ from: "not an instant", to: undefined }, 0).kind).toBe(
    "Absent",
  );
  const absent = spendFigures(undefined, undefined);
  expect(absent.cost.kind).toBe("Absent");
  expect(absent.tokens.kind).toBe("Absent");
});

/** The unit a quantity carries, which is the half that says what it counts. */
function unitOf(figure: Figure): string {
  if (figure.kind !== "Quantity") throw new Error("not a quantity figure");
  return figure.unit;
}

/**
 * A CEILING IS NOT SCALED. A token budget drawn as `17.5M` is a number nobody
 * typed and nobody can check against the box they type it into, which is why
 * the set figures group their digits instead of shortening them.
 */
test("a count keeps every digit it was given, in groups", () => {
  expect(textOf(countFigure(17_523_063, "tokens"))).toBe("17,523,063");
  expect(unitOf(countFigure(17_523_063, "tokens"))).toBe("tokens");
  expect(textOf(countFigure(0, "pages"))).toBe("0");
  expect(textOf(countFigure(999, "calls"))).toBe("999");
  expect(textOf(countFigure(1000, "calls"))).toBe("1,000");
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
