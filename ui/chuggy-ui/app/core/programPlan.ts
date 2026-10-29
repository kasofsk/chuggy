/**
 * What a ticket's configuration plans its program to run, and whether a
 * program runs less: a stage of a catalog's selected plan it leaves out, or an
 * evaluator of one it keeps; for a document, a block of its `evaluations` no
 * stage runs. A document's stage runs its one block whatever evaluator keys it
 * lists, so only its stages count, and a document listing no `evaluations`
 * plans nothing. Releasing a program that runs less asks the project's
 * `skip_planned_evaluations` permit, so a form drawn for a reader the
 * abilities read says lacks it neither offers one nor submits one.
 */

import type { DraftInitializationResponse } from "../../../../src/contract/responses.ts";
import { configurationCatalogOf } from "./configurationCatalog.ts";
import { configurationViewOf } from "./configurationView.ts";

/** A program as the wire holds it: stages and the evaluators in each, by key. */
export type PlannedProgram = DraftInitializationResponse["defaults"]["program"];

/** One task a configuration plans: a stage by its program key, and under a
 * catalog the evaluator in it by its key. */
export interface PlannedTask {
  readonly stage: number;
  readonly evaluator?: number;
}

/**
 * The tasks an initialization's configuration plans, the initialization being
 * the one a form draws under its selection: a catalog's defaults are then its
 * selected plan, stage by stage.
 */
export function programPlanned(
  initialization: DraftInitializationResponse,
): readonly PlannedTask[] {
  const canonical = initialization.configuration.canonical;
  if (configurationCatalogOf(canonical) !== undefined)
    return initialization.defaults.program.flatMap((stage) =>
      stage.evaluators.map((evaluator) => ({
        stage: stage.key,
        evaluator: evaluator.key,
      })),
    );
  return configurationViewOf(canonical).evaluations.map((_block, index) => ({
    stage: index + 1,
  }));
}

function programRuns(program: PlannedProgram, task: PlannedTask): boolean {
  const evaluators =
    program.find((stage) => stage.key === task.stage)?.evaluators ?? [];
  return task.evaluator === undefined
    ? evaluators.length > 0
    : evaluators.some((evaluator) => evaluator.key === task.evaluator);
}

/** Whether a program leaves out some task its configuration plans. */
export function programShort(
  planned: readonly PlannedTask[],
  program: PlannedProgram,
): boolean {
  return planned.some((task) => !programRuns(program, task));
}

/** The fewest evaluators a stage keyed from one may hold and still run what is planned in it. */
export function programStageLeast(
  planned: readonly PlannedTask[],
  stage: number,
): number {
  return planned
    .filter((task) => task.stage === stage)
    .reduce((least, task) => Math.max(least, task.evaluator ?? 1), 1);
}
