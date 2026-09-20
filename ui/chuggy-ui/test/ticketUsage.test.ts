/**
 * What the ticket spent, grouped by the stage that spent it.
 *
 * The two failures these cases exist for are silent ones: a run priced into the
 * wrong stage, which moves money between two rows that still add to the right
 * total, and a per-model cost folded into the run's own, which doubles a figure
 * nobody recomputes by hand. So the stage rows are asserted individually AND
 * asserted to foot to the rollup, because either check alone passes under one
 * of those mutations.
 */

import { describe, expect, test } from "vitest";

import { ticketLedgerOf } from "../app/core/ticketLedger.ts";
import { ticketStageLabel, ticketUsageOf } from "../app/core/ticketUsage.ts";
import {
  evaluationRun,
  run,
  runModel,
  runTotals,
  workRun,
} from "./ticketRuns.ts";

const ticket = 7;

/** Distinct costs, so a run in the wrong row changes a number a case names. */
const workCost = 1_000_000;
const firstStageCost = 200_000;
const secondStageCost = 30_000;

function usage() {
  return ticketUsageOf(
    ticketLedgerOf(ticket, [
      workRun(ticket, 1, runTotals(workCost, [runModel("opus", workCost, 900)])),
      evaluationRun(
        ticket,
        1,
        0,
        0,
        0,
        runTotals(firstStageCost, [runModel("haiku", firstStageCost, 200)]),
      ),
      evaluationRun(
        ticket,
        1,
        1,
        0,
        0,
        runTotals(secondStageCost, [runModel("haiku", secondStageCost, 30)]),
      ),
    ]),
  );
}

describe("a run is priced into the stage its key names", () => {
  test("work and each evaluation stage are their own row", () => {
    expect(
      usage().byStage.map((row) => [
        row.label,
        row.spend.executions,
        row.spend.totals?.costUsdMicros,
      ]),
    ).toEqual([
      ["Work", 1, workCost],
      ["Stage 1", 1, firstStageCost],
      ["Stage 2", 1, secondStageCost],
    ]);
  });

  test("work is drawn before every evaluation stage", () => {
    expect(usage().byStage[0]?.label).toBe("Work");
  });

  test("two runs of one stage are one row", () => {
    const held = ticketUsageOf(
      ticketLedgerOf(ticket, [
        evaluationRun(ticket, 1, 0, 0, 0, runTotals(100, [])),
        evaluationRun(ticket, 1, 0, 0, 1, runTotals(400, [])),
      ]),
    );

    expect(held.byStage).toHaveLength(1);
    expect(held.byStage[0]?.spend.executions).toBe(2);
    expect(held.byStage[0]?.spend.totals?.costUsdMicros).toBe(500);
  });

  test("a stage is labelled from one rather than from the key's zero", () => {
    expect(ticketStageLabel({ kind: "Evaluation", stage: 0 })).toBe("Stage 1");
    expect(ticketStageLabel({ kind: "Evaluation", stage: 9 })).toBe("Stage 10");
  });

  test("stage ten is ordered after stage two, not beside stage one", () => {
    const held = ticketUsageOf(
      ticketLedgerOf(ticket, [
        evaluationRun(ticket, 1, 9, 0, 0, runTotals(1, [])),
        evaluationRun(ticket, 1, 1, 0, 0, runTotals(1, [])),
      ]),
    );

    expect(held.byStage.map((row) => row.label)).toEqual([
      "Stage 2",
      "Stage 10",
    ]);
  });
});

describe("the rollup", () => {
  test("the total is every run's own cost added once", () => {
    expect(usage().total.totals?.costUsdMicros).toBe(
      workCost + firstStageCost + secondStageCost,
    );
  });

  /**
   * The total and the stage rows are two walks of the same ledger, so this is
   * what holds them to the same set of runs. The ledger it walks carries a row
   * the stages could drop — an unplaceable one — because over a ledger of rows
   * that all land somewhere the sum cannot help but agree with itself.
   */
  test("the stage rows foot to the total, unplaceable rows included", () => {
    const held = ticketUsageOf(
      ticketLedgerOf(ticket, [
        workRun(ticket, 1, runTotals(workCost, [])),
        evaluationRun(ticket, 1, 0, 0, 0, runTotals(firstStageCost, [])),
        run("work:seven:1", runTotals(secondStageCost, [])),
      ]),
    );
    const footed = held.byStage.reduce(
      (sum, row) => sum + (row.spend.totals?.costUsdMicros ?? 0),
      0,
    );

    expect(footed).toBe(held.total.totals?.costUsdMicros);
    expect(
      held.byStage.reduce((sum, row) => sum + row.spend.executions, 0),
    ).toBe(held.total.executions);
  });

  test("a model's cost is the model rows added, never the run totals too", () => {
    const held = usage();
    const byModel = Object.fromEntries(
      held.byModel.map((model) => [model.model, model.costUsdMicros]),
    );

    expect(byModel).toEqual({
      opus: workCost,
      haiku: firstStageCost + secondStageCost,
    });
    expect(
      held.byModel.reduce((sum, model) => sum + model.costUsdMicros, 0),
    ).toBe(held.total.totals?.costUsdMicros);
  });

  test("a run carrying no figures is counted but not measured", () => {
    const held = ticketUsageOf(
      ticketLedgerOf(ticket, [
        workRun(ticket, 1, runTotals(500, [])),
        evaluationRun(ticket, 1, 0, 0, 0),
      ]),
    );

    expect(held.total.executions).toBe(2);
    expect(held.total.measured).toBe(1);
    expect(held.total.totals?.costUsdMicros).toBe(500);
  });

  test("a set nothing measured has no totals rather than totals of zero", () => {
    const held = ticketUsageOf(ticketLedgerOf(ticket, [workRun(ticket, 1)]));

    expect(held.total.totals).toBeUndefined();
    expect(held.total.executions).toBe(1);
    expect(held.total.measured).toBe(0);
  });
});

describe("a row the ledger could not place", () => {
  test("its spend is drawn rather than dropped from the ticket's total", () => {
    const held = ticketUsageOf(
      ticketLedgerOf(ticket, [
        workRun(ticket, 1, runTotals(500, [])),
        run("work:seven:1", runTotals(70, [])),
      ]),
    );

    expect(held.byStage.map((row) => row.label)).toEqual(["Work", "Unplaced"]);
    expect(held.total.totals?.costUsdMicros).toBe(570);
  });

  test("the unplaceable rows are drawn after every stage of the plan", () => {
    const held = ticketUsageOf(
      ticketLedgerOf(ticket, [
        run("work:seven:1", runTotals(70, [])),
        evaluationRun(ticket, 1, 0, 0, 0, runTotals(1, [])),
      ]),
    );

    expect(held.byStage.map((row) => row.label)).toEqual([
      "Stage 1",
      "Unplaced",
    ]);
  });
});
