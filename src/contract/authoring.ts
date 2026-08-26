/**
 * The authoring a ticket carries, as the wire writes it.
 *
 * The same value shapes appear in a draft body, in a draft read, in the
 * initialization's offered choices and in a dispatch candidate, so they are
 * written once here — twice over, because a request body is refused for a
 * field the server does not know and a read of a hand-assembled resource drops
 * one instead, which is the rule `responses.ts` states and it has to hold at
 * every depth or a field added inside `authoring` stops every loaded browser
 * reading a draft.
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

const budgetedFinalizationSchema = z.strictObject({
  type: z.literal("Budgeted"),
  value: countSchema,
});

export const finalizationPricingSchema = z.union([
  z.literal("DeadlineOnly"),
  budgetedFinalizationSchema,
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

export const programStageResponseSchema = programStageSchema.strip();
export const reworkPolicyResponseSchema = reworkPolicySchema.strip();

export const finalizationPricingResponseSchema = z.union([
  z.literal("DeadlineOnly"),
  budgetedFinalizationSchema.strip(),
]);

/** The same authoring read back, dropping a field the reader does not know. */
export const authoringResponseSchema = authoringSchema.strip().extend({
  program: z.array(programStageResponseSchema).max(nativeHttpDraftStagesMax),
  reworkPolicy: reworkPolicyResponseSchema,
  finalizationPricing: finalizationPricingResponseSchema,
});
