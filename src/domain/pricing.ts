/**
 * The accounts the metering policies grant, and the bounds the measure is
 * parameterised by.
 *
 * The policies themselves are the model's. `Bounds` is not: the model declares
 * it too, but it is not on the API boundary, and it is passed explicitly for
 * the reason the model passes it — the measure stays a pure function usable at
 * any bounds, needing no ambient configuration.
 *
 * A ticket carries its own pricing and the bounds carry the instance's. That
 * is the model's arrangement rather than a duplication: the measure is bounded
 * by what the instance grants, whatever an individual ticket was authored with.
 */

import { assertNever } from "./assertNever.ts";
import type {
  FinalizationPricing,
  ReworkPolicy,
} from "./generated/modelTypes.ts";

export const deadlineOnly: FinalizationPricing = "DeadlineOnly";

/** Finalization rework priced with a budget of `budget` cycles. */
export function budgeted(budget: number): FinalizationPricing {
  return { type: "Budgeted", value: budget };
}

/** Eval rework granted a budget of `budget` cycles. */
export function reworkBudgetOf(budget: number): ReworkPolicy {
  return { type: "BudgetedRework", value: budget };
}

/** The finalization account's size under a pricing. `DeadlineOnly` grants none; gas alone meters the loop. */
export function finalizationBudget(pricing: FinalizationPricing): number {
  if (pricing === "DeadlineOnly") return 0;
  switch (pricing.type) {
    case "Budgeted":
      return pricing.value;
    default:
      return assertNever(pricing.type);
  }
}

/** The rework account's size under a policy. */
export function reworkBudget(policy: ReworkPolicy): number {
  switch (policy.type) {
    case "BudgetedRework":
      return policy.value;
    default:
      return assertNever(policy.type);
  }
}

/** What the measure needs to know about the deployment it is measuring. */
export interface Bounds {
  readonly reworkPolicy: ReworkPolicy;
  readonly nTasks: number;
  readonly maxStages: number;
  readonly finalizationPricing: FinalizationPricing;
}
