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

import {
  nativeHttpDraftDependenciesMax,
  nativeHttpDraftEvaluatorsMax,
  nativeHttpDraftStagesMax,
  ticketNumberSchema,
} from "./http.ts";

/** The three page bounds an authored draft is held to, surfaced where it is parsed. */
export {
  nativeHttpDraftDependenciesMax,
  nativeHttpDraftEvaluatorsMax,
  nativeHttpDraftStagesMax,
};

export const evaluatorDefinitionSchema = z.strictObject({
  key: ticketNumberSchema,
});

/** A stage: its key, which is its position in the program, and the evaluators it runs by their keys. */
export const programStageSchema = z.strictObject({
  key: ticketNumberSchema,
  evaluators: z
    .array(evaluatorDefinitionSchema)
    .max(nativeHttpDraftEvaluatorsMax),
});

export const authoringSchema = z.strictObject({
  dependencies: z
    .array(ticketNumberSchema)
    .max(nativeHttpDraftDependenciesMax)
    .refine((values) => new Set(values).size === values.length),
  program: z.array(programStageSchema).max(nativeHttpDraftStagesMax),
});

export type ReleaseAuthoringBody = z.infer<typeof authoringSchema>;

export const programStageResponseSchema = programStageSchema.strip().extend({
  evaluators: z
    .array(evaluatorDefinitionSchema.strip())
    .max(nativeHttpDraftEvaluatorsMax),
});

/** The same authoring read back, dropping a field the reader does not know. */
export const authoringResponseSchema = authoringSchema.strip().extend({
  program: z.array(programStageResponseSchema).max(nativeHttpDraftStagesMax),
});
