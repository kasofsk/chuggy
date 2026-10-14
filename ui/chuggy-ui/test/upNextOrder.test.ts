/**
 * The order "Up next" is drawn in, one key at a time, over rows alone.
 */

import { expect, test } from "vitest";

import { phaseRoster } from "../../../src/contract/rosters.ts";
import type { TicketPhase } from "../../../src/contract/rosters.ts";
import { upNextOrdered, upNextPhaseRank } from "../app/core/upNextOrder.ts";
import type { UpNextRow } from "../app/core/upNextOrder.ts";

function row(
  ticket: number,
  open: readonly (readonly [number, TicketPhase])[] = [],
  revokedDependencies: readonly number[] = [],
): UpNextRow {
  return {
    ticket,
    openDependencies: open.map(([dependency, phase]) => ({
      ticket: dependency,
      phase,
    })),
    revokedDependencies,
  };
}

function ticketsOf(rows: readonly UpNextRow[]): readonly number[] {
  return upNextOrdered(rows).map((one) => one.ticket);
}

test("a ready row is drawn above a blocked one", () => {
  expect(ticketsOf([row(1, [[90, "Work"]]), row(2)])).toStrictEqual([2, 1]);
});

test("chains are drawn by their depth in the window", () => {
  const depthOne = row(1, [[90, "Pending"]]);
  const depthTwo = row(2, [[1, "Pending"]]);
  const depthThree = row(3, [[2, "Pending"]]);
  expect(ticketsOf([depthThree, depthTwo, depthOne])).toStrictEqual([1, 2, 3]);
});

test("at one depth, a row waiting on work in progress is above one waiting on work not started", () => {
  expect(
    ticketsOf([row(1, [[90, "Pending"]]), row(2, [[91, "Work"]])]),
  ).toStrictEqual([2, 1]);
});

test("what gates a row is its least advanced open dependency", () => {
  const finalizingAndPending = row(1, [
    [90, "Finalization"],
    [91, "Pending"],
  ]);
  expect(
    ticketsOf([finalizingAndPending, row(2, [[92, "Work"]])]),
  ).toStrictEqual([2, 1]);
});

test("rows alike on both keys keep the read's order, newest activity first", () => {
  const newer = row(1, [[90, "Work"]]);
  const older = row(2, [[91, "Work"]]);
  expect(ticketsOf([newer, older])).toStrictEqual([1, 2]);
  expect(ticketsOf([older, newer])).toStrictEqual([2, 1]);
  expect(ticketsOf([row(3), row(4)])).toStrictEqual([3, 4]);
});

test("an open dependency outside the window counts as ready, so its row is one away", () => {
  const outside = row(1, [[90, "Pending"]]);
  const held = row(2, [[90, "Pending"]]);
  const onHeld = row(3, [[2, "Pending"]]);
  expect(ticketsOf([onHeld, outside, held])).toStrictEqual([1, 2, 3]);
});

test("a row waiting on a revoked dependency is drawn after every other, in the read's order", () => {
  const revokedReady = row(1, [], [80]);
  const revokedBlocked = row(2, [[90, "Pending"]], [81]);
  expect(
    ticketsOf([
      revokedBlocked,
      revokedReady,
      row(3, [[91, "Pending"]]),
      row(4),
    ]),
  ).toStrictEqual([4, 3, 2, 1]);
});

test("a window that appears to hold a cycle is walked to an end and ordered", () => {
  const first = row(1, [[2, "Pending"]]);
  const second = row(2, [[1, "Pending"]]);
  expect(ticketsOf([first, second, row(3)])).toStrictEqual([3, 2, 1]);
});

test("phases are ranked from Done outward, and no two alike", () => {
  const nearestFirst = [
    "Done",
    "Finalization",
    "Evaluation",
    "Work",
    "Escalated",
    "Pending",
  ] as const;
  const ranks = nearestFirst.map(upNextPhaseRank);
  expect(ranks).toStrictEqual([...ranks].sort((left, right) => left - right));
  expect(new Set(phaseRoster.map(upNextPhaseRank)).size).toBe(
    phaseRoster.length,
  );
});
