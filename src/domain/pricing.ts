/**
 * The three metering policies, the accounts they grant, and the bounds the
 * measure is parameterised by.
 *
 * These are policies rather than constants because the model generates
 * escalation traces under each branch and the choice between them is made on
 * evidence. `Bounds` is passed explicitly for the same reason the model passes
 * it: the measure stays a pure function usable at any bounds, needing no
 * ambient configuration.
 */

import { assertNever } from "./assertNever.ts";

/** Gate-rework pricing. `DeadlineOnly` grants no gate account; gas alone meters the loop. */
export type WrapUpPricing =
  | { readonly pricing: "Budgeted"; readonly budget: number }
  | { readonly pricing: "DeadlineOnly" };

/** Eval-rework pricing. One branch for now, and a new one lands as a constructor here. */
export type ReworkPolicy = {
  readonly policy: "RWBudget";
  readonly budget: number;
};

/** Operator-retry metering. `RetryFree` reproduces a known livelock by configuration. */
export type RetryPricing = "RetryCharged" | "RetryFree";

export const deadlineOnly: WrapUpPricing = { pricing: "DeadlineOnly" };

/** Gate rework priced with a budget of `budget` cycles. */
export function budgeted(budget: number): WrapUpPricing {
  return { pricing: "Budgeted", budget };
}

/** Eval rework granted a budget of `budget` cycles. */
export function reworkBudgetOf(budget: number): ReworkPolicy {
  return { policy: "RWBudget", budget };
}

/** The gate account's size under a pricing. */
export function wrapUpBudget(pricing: WrapUpPricing): number {
  switch (pricing.pricing) {
    case "Budgeted":
      return pricing.budget;
    case "DeadlineOnly":
      return 0;
    default:
      return assertNever(pricing);
  }
}

/** The rework account's size under a policy. */
export function reworkBudget(policy: ReworkPolicy): number {
  switch (policy.policy) {
    case "RWBudget":
      return policy.budget;
    default:
      return assertNever(policy.policy);
  }
}

/** What the measure needs to know about the deployment it is measuring. */
export interface Bounds {
  readonly reworkPolicy: ReworkPolicy;
  readonly nTasks: number;
  readonly maxStages: number;
  readonly wrapUpPricing: WrapUpPricing;
}
