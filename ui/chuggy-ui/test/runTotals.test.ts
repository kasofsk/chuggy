/**
 * What a set of runs adds up to, and the words the figures are read in.
 *
 * The quiet failures here are a sum that skips the runs that ended badly — the
 * ones a reader most wants counted — and a dollar figure drawn without the
 * basis that makes it a list price rather than a bill.
 */

import { expect, test } from "vitest";

import type { RunTotals } from "../../../src/contract/responses.ts";
import {
  generationLabel,
  runCostLabel,
  runCountLabel,
  runDurationLabel,
  runTotalsSummed,
} from "../app/core/runTotals.ts";

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

test("a dollar figure always says the basis it was published under", () => {
  expect(runCostLabel(420_000, "List")).toBe("$0.42 (list price)");
});

/** A run costing less than a cent still cost something, and drawing it as
 * nothing is the failure this covers. */
test("a spend below a cent is drawn finer rather than as nothing", () => {
  expect(runCostLabel(4_200, "List")).toBe("$0.0042 (list price)");
  expect(runCostLabel(0, "List")).toBe("$0.00 (list price)");
});

test("a generation past the first is drawn by number, in one spelling, never as a run", () => {
  expect(generationLabel(1)).toBeUndefined();
  expect(generationLabel(2)).toBe("generation 2");
  expect(generationLabel(3)).toBe("generation 3");
});

test("a count is grouped and a duration is whole units, largest first", () => {
  expect(runCountLabel(1_234_567)).toBe("1,234,567");
  expect(runDurationLabel(252_000)).toBe("4m 12s");
  expect(runDurationLabel(9_000)).toBe("9s");
  expect(runDurationLabel(3_912_000)).toBe("1h 5m 12s");
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
