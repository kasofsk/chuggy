/**
 * What a ticket's configuration plans its program to run, and whether a
 * program runs less: a stage of a catalog's selected plan it leaves out, or an
 * evaluator of one it keeps; for a document, a block of its `evaluations` no
 * stage runs. A document's stage runs its one block whatever evaluator keys it
 * lists, so only its stages count, and a document listing no `evaluations`
 * plans nothing. A catalog ticket whose overrides replace or add plans runs
 * less too where `overridesPlanShort` says its program does, against the
 * catalog's plan for its selection. Releasing a program that runs less asks the project's
 * `skip_planned_evaluations` permit, so a form drawn for a reader the
 * abilities read says lacks it neither offers one nor submits one.
 */

import { overridesPlanShort } from "../../../../src/contract/configurationOverrides.ts";
import type { ConfigurationSelection } from "../../../../src/contract/configurationSelection.ts";
import type { DraftInitializationResponse } from "../../../../src/contract/responses.ts";
import {
  configurationCatalogOf,
  configurationCatalogOverridden,
  configurationCatalogSelected,
  type CatalogOverrides,
} from "./configurationCatalog.ts";
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
  return programPlannedDocument(canonical);
}

/** The tasks a document plans: one stage for each block of its `evaluations`. */
function programPlannedDocument(canonical: string): readonly PlannedTask[] {
  return configurationViewOf(canonical).evaluations.map((_block, index) => ({
    stage: index + 1,
  }));
}

/**
 * The tasks a configuration plans under a selection and the plans a ticket
 * overrides, read from the document itself where no initialization was read: a catalog's selected plan stage by
 * stage, and nothing where the catalog holds no such plan.
 */
export function programPlannedUnder(
  canonical: string,
  selection: ConfigurationSelection | undefined,
  overrides?: CatalogOverrides,
): readonly PlannedTask[] {
  const catalog = configurationCatalogOverridden(canonical, overrides);
  if (catalog === undefined) return programPlannedDocument(canonical);
  const plan =
    catalog.plans.get(
      configurationCatalogSelected(catalog, selection).evaluation,
    ) ?? [];
  return plan.flatMap((stage, index) =>
    stage.evaluators.map((_name, position) => ({
      stage: index + 1,
      evaluator: position + 1,
    })),
  );
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

/**
 * Whether a program over the plan a ticket's overrides select runs less than
 * the catalog's own plan for its selection, or the catalog's default where it
 * names no such plan; never where the overrides replace no plan.
 */
export function programShortOfCatalog(
  canonical: string,
  overrides: CatalogOverrides | undefined,
  selection: ConfigurationSelection | undefined,
  program: PlannedProgram,
): boolean {
  if (Object.keys(overrides?.plans ?? {}).length === 0) return false;
  const catalog = configurationCatalogOf(canonical);
  const overridden = configurationCatalogOverridden(canonical, overrides);
  if (catalog === undefined || overridden === undefined) return false;
  const named = selection?.evaluation;
  const planned =
    (named === undefined ? undefined : catalog.plans.get(named)) ??
    catalog.plans.get(catalog.defaults.evaluation) ??
    [];
  const selected =
    overridden.plans.get(
      configurationCatalogSelected(overridden, selection).evaluation,
    ) ?? [];
  return overridesPlanShort(
    planned.map((stage) => stage.evaluators),
    selected.map((stage) => stage.evaluators),
    program,
  );
}
