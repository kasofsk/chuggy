/**
 * Executions as the wire sends them, for the suites that arrange and price
 * them.
 *
 * The figures are deliberately distinct per run, so a run added twice, added to
 * the wrong stage or dropped changes a total a case names rather than landing
 * on the same number by coincidence.
 */

import type {
  AdoptedExecution,
  AdoptedRunModelUsage,
  AdoptedRunTotals,
} from "../app/core/adoptedExecutions.ts";

export function runModel(
  model: string,
  costUsdMicros: number,
  tokensInput: number,
): AdoptedRunModelUsage {
  return {
    model,
    costUsdMicros,
    tokensInput,
    tokensOutput: tokensInput / 10,
    tokensCacheCreation: 0,
    tokensCacheRead: 0,
  };
}

export function runTotals(
  costUsdMicros: number,
  models: readonly AdoptedRunModelUsage[],
): AdoptedRunTotals {
  const tokensInput = models.reduce(
    (held, model) => held + model.tokensInput,
    0,
  );
  return {
    turns: 3,
    durationMs: 60_000,
    durationApiMs: 30_000,
    costUsdMicros,
    costBasis: "List",
    permissionDenials: 0,
    models: [...models],
    tokensInput,
    tokensOutput: tokensInput / 10,
    tokensCacheCreation: 0,
    tokensCacheRead: 0,
  };
}

export function run(
  taskKey: string,
  totals?: AdoptedRunTotals,
): AdoptedExecution {
  return {
    taskKey,
    state: "Terminal",
    attempt: 1,
    attemptsUnreported: 0,
    queuedAt: "2026-09-19T10:00:00.000Z",
    lastReportedAt: "2026-09-19T10:01:00.000Z",
    ...(totals === undefined ? {} : { totals }),
  };
}

export function workRun(
  ticket: number,
  cycle: number,
  totals?: AdoptedRunTotals,
): AdoptedExecution {
  return run(`work:${String(ticket)}:${String(cycle)}`, totals);
}

export function evaluationRun(
  ticket: number,
  workCycle: number,
  stage: number,
  generation: number,
  evaluator: number,
  totals?: AdoptedRunTotals,
): AdoptedExecution {
  return run(
    `evaluation:${String(ticket)}:${String(workCycle)}:${String(stage)}:${String(generation)}:${String(evaluator)}`,
    totals,
  );
}
