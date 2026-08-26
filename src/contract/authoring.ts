/**
 * The authoring a ticket carries, as the wire writes it.
 *
 * The same value shapes appear in a draft body, in a draft read, in the
 * initialization's offered choices and in a dispatch candidate, so they are
 * written once here.
 */

import { z } from "zod";

import { countSchema, ticketNumberSchema } from "./http.ts";
import {
  evaluationCombinators,
  finalizers,
  resumePricings,
} from "./rosters.ts";

export const nativeHttpDraftDependenciesMax = 100;
export const nativeHttpDraftStagesMax = 100;

export const programStageSchema = z.strictObject({
  fanout: ticketNumberSchema,
  combinator: z.enum(evaluationCombinators),
});

export const reworkPolicySchema = z.strictObject({
  type: z.literal("BudgetedRework"),
  value: countSchema,
});

export const finalizationPricingSchema = z.union([
  z.literal("DeadlineOnly"),
  z.strictObject({ type: z.literal("Budgeted"), value: countSchema }),
]);

export const resumePricingSchema = z.enum(resumePricings);
export const finalizerSchema = z.enum(finalizers);

export const authoringSchema = z.strictObject({
  dependencies: z
    .array(ticketNumberSchema)
    .max(nativeHttpDraftDependenciesMax)
    .refine((values) => new Set(values).size === values.length),
  program: z.array(programStageSchema).max(nativeHttpDraftStagesMax),
  workFanout: ticketNumberSchema,
  reworkPolicy: reworkPolicySchema,
  finalizationPricing: finalizationPricingSchema,
  resumePricing: resumePricingSchema,
  finalizer: finalizerSchema,
});

export type ReleaseAuthoringBody = z.infer<typeof authoringSchema>;
