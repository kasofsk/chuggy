import { z } from "zod";

import type { Config } from "../domain/config.ts";

const positiveInteger = z.number().int().positive();
const budgeted = z
  .object({
    type: z.literal("Budgeted"),
    value: z.number().int().nonnegative(),
  })
  .strict();

export const domainConfigurationSchema = z
  .object({
    nTickets: positiveInteger,
    nTasks: positiveInteger,
    reworkPolicy: z
      .object({
        type: z.literal("BudgetedRework"),
        value: z.number().int().nonnegative(),
      })
      .strict(),
    gas: z.number().int().nonnegative(),
    finalizationPricing: z.union([z.literal("DeadlineOnly"), budgeted]),
    maxStages: positiveInteger,
  })
  .strict();

export function domainConfigurationOf(value: unknown): Config {
  return domainConfigurationSchema.parse(value);
}
