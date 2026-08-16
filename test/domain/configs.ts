/**
 * One `Config` per instance the corpus was emitted from, keyed by the string
 * the manifest's `instance` column carries.
 *
 * Each is transcribed whole from its module header in `model/mc/mc_chuggy.qnt`
 * rather than derived from a neighbour, so a reader checks a row against the
 * model by reading down it. `model/mc/mc_chuggy_directed.qnt` declares a
 * parallel module per instance with those same constants under a different
 * name — the same machine under a restricted step relation, which changes which
 * steps the sampler may try and nothing about what a step does — so a directed
 * golden's manifest row names its undirected sibling and replays here.
 */

import type { Config } from "../../src/domain/config.ts";
import {
  budgeted,
  deadlineOnly,
  reworkBudgetOf,
} from "../../src/domain/pricing.ts";

/** The gate account exists here, so a wrap-up failure spends it alongside gas. */
export const budgetedInstance: Config = {
  nTickets: 3,
  nTasks: 2,
  reworkPolicy: reworkBudgetOf(1),
  gas: 3,
  wrapUpPricing: budgeted(1),
  opRetryPricing: "RetryCharged",
  maxStages: 2,
  nProjects: 2,
};

/** Gas-only gate pricing: the gate loop is capped by the required account alone. */
export const deadlineOnlyInstance: Config = {
  nTickets: 3,
  nTasks: 2,
  reworkPolicy: reworkBudgetOf(1),
  gas: 3,
  wrapUpPricing: deadlineOnly,
  opRetryPricing: "RetryCharged",
  maxStages: 2,
  nProjects: 2,
};

/** A smaller, poorer fleet whose pipeline resumes cost nothing. */
export const retryFreeInstance: Config = {
  nTickets: 2,
  nTasks: 2,
  reworkPolicy: reworkBudgetOf(1),
  gas: 2,
  wrapUpPricing: deadlineOnly,
  opRetryPricing: "RetryFree",
  maxStages: 2,
  nProjects: 2,
};

/** Every instance the corpus draws from, under the name its manifest row carries. */
export const CONFIGS: Readonly<Record<string, Config>> = {
  mc_chuggy_budgeted: budgetedInstance,
  mc_chuggy_deadline_only: deadlineOnlyInstance,
  mc_chuggy_retryfree: retryFreeInstance,
};
