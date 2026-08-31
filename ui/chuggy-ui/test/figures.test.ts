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
  costFigure,
  durationText,
  instantText,
  spanFigure,
  spendFigures,
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

test("a closed span names both ends and an open one says it is still running", () => {
  const from = "2026-08-27T10:19:00Z";
  const nowMs = Date.parse("2026-08-27T11:07:00Z");
  const closed = spanFigure({ from, to: "2026-08-27T10:49:00Z" }, nowMs);
  expect(closed.kind).toBe("Span");
  if (closed.kind !== "Span") throw new Error("not a span");
  expect(closed.length).toBe("30m");
  expect(closed.open).toBe(false);
  const open = spanFigure({ from, to: undefined }, nowMs);
  if (open.kind !== "Span") throw new Error("not a span");
  expect(open.end).toBe("running");
  expect(open.length).toBe("48m so far");
  expect(open.open).toBe(true);
});

test("a row's window is its start and how long, and a running one says how long so far", () => {
  const nowMs = Date.parse("2026-08-27T11:07:00Z");
  const ended = whenFigure(
    "2026-08-27T10:31:00Z",
    "2026-08-27T10:48:40Z",
    nowMs,
  );
  if (ended.kind !== "Span") throw new Error("not a span");
  expect(ended.length).toBe("17m 40s");
  expect(ended.end).toBe(undefined);
  const running = whenFigure("2026-08-27T11:03:20Z", undefined, nowMs);
  if (running.kind !== "Span") throw new Error("not a span");
  expect(running.length).toBe("running 3m 40s");
  expect(running.open).toBe(true);
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
