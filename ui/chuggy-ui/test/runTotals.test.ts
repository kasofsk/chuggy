/**
 * What a set of runs adds up to, and the words the figures are read in.
 *
 * The quiet failure here is a sum that skips the runs that ended badly — the
 * ones a reader most wants counted.
 */

import { expect, test } from "vitest";

import type { RunTotals } from "../../../src/contract/responses.ts";
import { runCountLabel, runTotalsSummed } from "../app/core/runTotals.ts";

function totals(over: Partial<RunTotals> = {}): RunTotals {
  return {
    turns: 2,
    durationMs: 1_000,
    durationApiMs: 900,
    tokensInput: 10,
    tokensOutput: 20,
    tokensCacheCreation: 30,
    tokensCacheRead: 40,
    costUsdMicros: 100_000,
    costBasis: "List",
    permissionDenials: 0,
    models: [
      {
        model: "opus",
        tokensInput: 10,
        tokensOutput: 20,
        tokensCacheCreation: 30,
        tokensCacheRead: 40,
        costUsdMicros: 100_000,
      },
    ],
    ...over,
  };
}

test("a count is grouped", () => {
  expect(runCountLabel(1_234_567)).toBe("1,234,567");
});

test("a sum over no run at all is no figure rather than a zero", () => {
  expect(runTotalsSummed([])).toBeUndefined();
});

test("every run's figures are summed and the per-model rows merged", () => {
  const summed = runTotalsSummed([
    totals(),
    totals({
      turns: 3,
      costUsdMicros: 50_000,
      models: [
        {
          model: "opus",
          tokensInput: 1,
          tokensOutput: 2,
          tokensCacheCreation: 3,
          tokensCacheRead: 4,
          costUsdMicros: 50_000,
        },
        {
          model: "haiku",
          tokensInput: 5,
          tokensOutput: 6,
          tokensCacheCreation: 7,
          tokensCacheRead: 8,
          costUsdMicros: 0,
        },
      ],
    }),
  ]);
  expect(summed?.turns).toBe(5);
  expect(summed?.costUsdMicros).toBe(150_000);
  expect(summed?.models).toEqual([
    {
      model: "opus",
      tokensInput: 11,
      tokensOutput: 22,
      tokensCacheCreation: 33,
      tokensCacheRead: 44,
      costUsdMicros: 150_000,
    },
    {
      model: "haiku",
      tokensInput: 5,
      tokensOutput: 6,
      tokensCacheCreation: 7,
      tokensCacheRead: 8,
      costUsdMicros: 0,
    },
  ]);
});

/** The label names one run's outcome, so a sum that carried one would be
 * naming a run it is not about. */
test("a sum carries no run's own outcome labels", () => {
  const summed = runTotalsSummed([
    totals({ resultSubtype: "success", stopReason: "end_turn" }),
  ]);
  expect(summed?.resultSubtype).toBeUndefined();
  expect(summed?.stopReason).toBeUndefined();
});
