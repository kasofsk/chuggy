/**
 * Every request body the public wire accepts.
 *
 * The schemas parse into plain wire values; turning one into an interpreter
 * type is the server's own step. A cursor is not here: it is opaque to every
 * reader but the server that issued it, so its payload is that server's shape
 * rather than the wire's, and `cursorSchema` is all the wire says about one.
 */

import { z } from "zod";

import {
  countSchema,
  digestSchema,
  dispatchViewSchemaVersion,
  inquiryQuestionCharsMax,
  selectorAllowlistNameCharsMax,
  selectorAllowlistNamesMax,
  selectorSettingsTextCharsMax,
  threadMessageCharsMax,
  ticketNumberSchema,
} from "./http.ts";
import { authoringSchema } from "./authoring.ts";
import { briefSchema } from "./brief.ts";
import {
  nativeActionResolutions,
  selectorDispatchModes,
  selectorModes,
} from "./rosters.ts";

/** An identity a body may carry, bounded only by the body limit itself. */
const bodyIdentitySchema = z.string().min(1);

export const publicMutationSchema = z.discriminatedUnion("mutation", [
  z.strictObject({
    mutation: z.literal("RevokeTicket"),
    ticket: ticketNumberSchema,
  }),
  z.strictObject({
    mutation: z.literal("ResumeTicket"),
    ticket: ticketNumberSchema,
  }),
  z.strictObject({
    mutation: z.literal("ReleaseDraft"),
    ticket: ticketNumberSchema,
    authoringVersion: countSchema,
    configurationRevision: z.string(),
  }),
  z.strictObject({
    mutation: z.literal("ResolveNativeAction"),
    action: z.string(),
    authorizingSequence: countSchema,
    resolution: z.enum(nativeActionResolutions),
  }),
  z.strictObject({
    mutation: z.literal("ManualDispatch"),
    ticket: ticketNumberSchema,
    expectedTicketVersion: countSchema,
  }),
  z.strictObject({
    mutation: z.literal("ProposeDispatch"),
    ticket: ticketNumberSchema,
    expectedTicketVersion: countSchema,
    observedViewToken: z.strictObject({
      tenant: bodyIdentitySchema,
      project: bodyIdentitySchema,
      recoveryEpoch: bodyIdentitySchema,
      schemaVersion: z.literal(dispatchViewSchemaVersion),
      watermark: countSchema,
      digest: digestSchema,
    }),
    selectorDecisionReference: z.string(),
  }),
]);

export type PublicMutation = z.infer<typeof publicMutationSchema>;

export const configurationCreationSchema = z.strictObject({
  revision: bodyIdentitySchema,
  parent: bodyIdentitySchema.optional(),
  canonical: bodyIdentitySchema,
});

export const repositoryConfigurationImportSchema = z.strictObject({
  commit: bodyIdentitySchema,
});

export const draftCreationSchema = z.strictObject({
  configurationRevision: bodyIdentitySchema,
  configurationDigest: digestSchema,
  expectedProjectSequence: countSchema,
  authoring: authoringSchema,
  brief: briefSchema,
});

export const draftRevisionSchema = z.strictObject({
  expectedVersion: countSchema,
  configurationRevision: bodyIdentitySchema,
  authoring: authoringSchema,
  brief: briefSchema,
});

export const submissionSchema = z.strictObject({
  operation: bodyIdentitySchema,
  mutation: publicMutationSchema,
});

const selectorLimitSchema = z.number().int().safe().positive();
const selectorSettingsTextSchema = z
  .string()
  .min(1)
  .max(selectorSettingsTextCharsMax);
const selectorAllowlistSchema = z
  .array(z.string().min(1).max(selectorAllowlistNameCharsMax))
  .max(selectorAllowlistNamesMax);

/**
 * What one project sets for itself, an absent field meaning the installation
 * default, so a write clears an override by omitting it. `concurrentDecisions`
 * and `selectionsPerMinute` are not here, because they bound one shared pool
 * rather than one project's behaviour.
 */
export const selectorProjectOverridesSchema = z.strictObject({
  northStar: selectorSettingsTextSchema.optional(),
  mode: z.enum(selectorModes).optional(),
  dispatchMode: z.enum(selectorDispatchModes).optional(),
  basePrompt: selectorSettingsTextSchema.optional(),
  modelAllowlist: selectorAllowlistSchema.optional(),
  toolAllowlist: selectorAllowlistSchema.optional(),
  limits: z
    .strictObject({
      tokensPerDecision: selectorLimitSchema.optional(),
      millisecondsPerDecision: selectorLimitSchema.optional(),
      toolCallsPerDecision: selectorLimitSchema.optional(),
      dispatchesPerDecision: selectorLimitSchema.optional(),
      inputBytesPerDecision: selectorLimitSchema.optional(),
      candidatePagesPerDecision: selectorLimitSchema.optional(),
    })
    .optional(),
  operationalContextMaxAgeMs: selectorLimitSchema.optional(),
});

/** The whole override set, written under the revision the writer read it at. */
export const selectorProjectSettingsSchema = z.strictObject({
  expectedRevision: countSchema,
  overrides: selectorProjectOverridesSchema,
});

/**
 * What a member puts in their own thread: a turn identity they mint themselves
 * and the text they typed. The turn is the body's rather than a header's for
 * the reason `submissionSchema` gives — enqueuing is idempotent on it, so a
 * retried post answers the ordinal it already has instead of a second turn.
 */
export const threadMessageSchema = z.strictObject({
  turn: bodyIdentitySchema,
  message: z.string().min(1).max(threadMessageCharsMax),
});

/**
 * What a member asks the lead aside: the session and the turn they mint
 * themselves, and the question they typed. Both identities are the body's
 * rather than a header's for the reason `submissionSchema` gives — opening is
 * idempotent on them, so a retried post answers the ordinal it already has
 * instead of forking the lead a second time.
 */
export const leadInquirySchema = z.strictObject({
  session: bodyIdentitySchema,
  turn: bodyIdentitySchema,
  question: z.string().min(1).max(inquiryQuestionCharsMax),
});
