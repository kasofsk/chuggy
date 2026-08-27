/**
 * What a set of runs adds up to, and the words the figures are read in.
 *
 * The quiet failures here are a sum that skips the runs that ended badly — the
 * ones a reader most wants counted — and a dollar figure drawn without the
 * basis that makes it a list price rather than a bill.
 */

import { expect, test } from "vitest";

import type {
  ExecutionSummary,
  RunTotals,
} from "../../../src/contract/responses.ts";
import {
  runCostLabel,
  runCountLabel,
  runDurationLabel,
  runStageCoverageSentence,
  runStageLabel,
  runStageRows,
  runTotalsSummed,
} from "../app/core/runTotals.ts";

const digest = "a".repeat(64);

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

function summary(
  execution: string,
  over: Partial<ExecutionSummary> = {},
): ExecutionSummary {
  return {
    execution,
    ticket: 7,
    task: 1,
    taskKind: "Work",
    cluster: "rig",
    configurationRevision: "r1",
    requirementIdentity: "req-1",
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: "chuggy/worker",
    },
    requirementDigest: digest,
    requirementSource: "PlatformDefault",
    platformDefaultVersion: 1,
    status: "Terminal",
    retriesSpent: 0,
    registeredAt: "2026-08-27T00:00:00Z",
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

/** A run that ended badly still spent what it spent; a total that left it out
 * would be the one figure a reader is looking for. */
test("a stage's total counts every execution's figures, whatever it ended as", () => {
  const rows = runStageRows([
    summary("e1", { stage: 1, runTotals: totals({ costUsdMicros: 1_000 }) }),
    summary("e2", {
      stage: 1,
      status: "Terminal",
      outcome: "Failed",
      runTotals: totals({ costUsdMicros: 2_000 }),
    }),
    summary("e3", {
      stage: 1,
      status: "Running",
      runTotals: totals({ costUsdMicros: 4_000 }),
    }),
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.totals?.costUsdMicros).toBe(7_000);
  expect(rows[0]?.executions).toBe(3);
  expect(rows[0]?.measured).toBe(3);
});

test("the rows are one per kind and stage, in the order the program runs them", () => {
  const rows = runStageRows([
    summary("e1", { taskKind: "Evaluation", stage: 1 }),
    summary("e2", { taskKind: "Work", stage: 2 }),
    summary("e3", { taskKind: "Work", stage: 1 }),
    summary("e4", { taskKind: "Work", stage: 1 }),
  ]);
  expect(rows.map(runStageLabel)).toEqual([
    "work stage 1",
    "evaluation stage 1",
    "work stage 2",
  ]);
  expect(rows[0]?.executions).toBe(2);
});

test("an execution carrying no figures is counted and not measured", () => {
  const rows = runStageRows([summary("e1", { stage: 1 })]);
  expect(rows[0]?.executions).toBe(1);
  expect(rows[0]?.measured).toBe(0);
  expect(rows[0]?.totals).toBeUndefined();
});

test("a row says how many executions it groups and how many were measured", () => {
  const row = {
    taskKind: "Work" as const,
    stage: 1,
    executions: 2,
    measured: 1,
    totals: undefined,
  };
  expect(runStageCoverageSentence(row)).toBe("2 executions, 1 with figures");
  expect(runStageCoverageSentence({ ...row, executions: 1, measured: 0 })).toBe(
    "1 execution, 0 with figures",
  );
});
