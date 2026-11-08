/**
 * That the Usage tab's steps are named as the plan names them, in the
 * program's order, and that their times and waits are their runs' summed as
 * the Runs tab and the sidebar sum them.
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";

import { durationFigure } from "../app/core/figures.ts";
import { runTimeOf } from "../app/core/runTotals.ts";
import { ticketOverviewRunTime } from "../app/core/ticketOverview.ts";
import { ticketUsageStepsOf } from "../app/core/ticketUsage.ts";
import {
  evalIdentity,
  ledgerPage,
  workIdentity,
} from "./ticketLedgerFixture.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";

const nowMs = Date.parse("2026-11-07T12:00:00Z");

/** Two cycles: each a work run and a run of each of two stages, listed out of
 * the program's order, one of them taken long after it registered. */
const twoCycles: readonly ExecutionShape[] = [
  {
    execution: "e-review-1",
    task: 3,
    identity: evalIdentity(1, 2, 1),
    outcome: "Failed",
    registeredAt: "2026-11-07T10:10:00Z",
    takenAt: "2026-11-07T10:11:00Z",
    terminalAt: "2026-11-07T10:16:00Z",
  },
  {
    execution: "e-work-1",
    task: 1,
    identity: workIdentity(1),
    outcome: "Passed",
    registeredAt: "2026-11-07T10:00:00Z",
    takenAt: "2026-11-07T10:00:30Z",
    terminalAt: "2026-11-07T10:08:00Z",
  },
  {
    execution: "e-checks-1",
    task: 2,
    identity: evalIdentity(1, 1, 1),
    outcome: "Passed",
    registeredAt: "2026-11-07T10:08:00Z",
    takenAt: "2026-11-07T10:09:00Z",
    terminalAt: "2026-11-07T10:09:16Z",
  },
  {
    execution: "e-work-2",
    task: 4,
    identity: workIdentity(2),
    outcome: "Passed",
    registeredAt: "2026-11-07T10:16:00Z",
    takenAt: "2026-11-07T10:56:00Z",
    terminalAt: "2026-11-07T11:08:00Z",
  },
  {
    execution: "e-checks-2",
    task: 5,
    identity: evalIdentity(2, 1, 1),
    status: "Running",
    registeredAt: "2026-11-07T11:08:00Z",
    takenAt: "2026-11-07T11:09:00Z",
  },
];

const executions = ledgerPage(twoCycles).executions;

function stepsOf(names: readonly string[] | undefined) {
  const usage = ticketUsageStepsOf(executions, names, nowMs, copyTextEn);
  if (usage === undefined) throw new Error("no usage");
  return usage;
}

test("the steps are work and then each stage by its plan's name, in the program's order", () => {
  expect(stepsOf(["checks", "review"]).steps.map((step) => step.label)).toEqual(
    ["Work", "checks", "review"],
  );
});

test("a configuration that names no stages numbers them", () => {
  expect(stepsOf(undefined).steps.map((step) => step.label)).toEqual([
    "Work",
    "Stage 1",
    "Stage 2",
  ]);
});

/** The runs of work where `stage` is undefined, and of that stage otherwise. */
function stepRuns(stage: number | undefined) {
  return executions.filter((row) =>
    stage === undefined
      ? row.identity.type === "WorkTask"
      : row.identity.type === "EvaluationTask" &&
        row.identity.value.stage === stage,
  );
}

const stages = [undefined, 1, 2];

test("each step's run time and wait are its runs' summed, as a Runs row sums them", () => {
  const expected = stages.map((stage) => {
    const time = runTimeOf(stepRuns(stage), nowMs);
    return [
      stepRuns(stage).length,
      durationFigure(time.ranMs ?? 0),
      durationFigure(time.waitedMs),
    ];
  });
  expect(
    stepsOf(["checks", "review"]).steps.map((step) => [
      step.runs,
      step.time.ran,
      step.time.waited,
    ]),
  ).toEqual(expected);
});

test("the Total is the steps' times and waits added, which is the sidebar's", () => {
  const total = stepsOf(["checks", "review"]).total;
  const summed = stages
    .map((stage) => runTimeOf(stepRuns(stage), nowMs))
    .reduce<{ readonly ranMs: number; readonly waitedMs: number }>(
      (sum, time) => ({
        ranMs: sum.ranMs + (time.ranMs ?? 0),
        waitedMs: sum.waitedMs + time.waitedMs,
      }),
      { ranMs: 0, waitedMs: 0 },
    );
  expect(total.label).toBe("Total");
  expect(total.runs).toBe(executions.length);
  expect(total.time).toEqual({
    ran: durationFigure(summed.ranMs),
    waited: durationFigure(summed.waitedMs),
  });
  expect(total.time).toEqual(ticketOverviewRunTime(executions, nowMs));
});

test("there are no steps before the first run", () => {
  expect(ticketUsageStepsOf([], ["checks"], nowMs, copyTextEn)).toBeUndefined();
});
