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
  forgeAuthorizationTextCharsMax,
  forgeAuthorizationVerifierCharsMax,
  forgeAuthorizationVerifierCharsMin,
  inquiryQuestionCharsMax,
  leadDispatchesMax,
  selectorAllowlistNameCharsMax,
  selectorAllowlistNamesMax,
  selectorReviewFeedbackCharsMax,
  selectorSettingsTextCharsMax,
  threadMessageCharsMax,
  threadMessageImagesMax,
  threadTitleCharsMax,
  ticketNumberSchema,
} from "./http.ts";
import { authoringSchema } from "./authoring.ts";
import { briefSchema } from "./brief.ts";
import { configurationOverridesSchema } from "./configurationOverrides.ts";
import {
  briefFinalizationModes,
  forgeCredentialPermissions,
  forgeIds,
  forgeRepositoryVisibilities,
  nativeActionResolutions,
  placementRoutes,
  selectorDispatchModes,
  selectorModes,
  selectorReviewOutcomes,
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
  /**
   * A Pending ticket's released draft, revised and released again: the draft
   * revision it pins, as a release names one, and the ticket revision its
   * author read.
   */
  z.strictObject({
    mutation: z.literal("UpdateTicket"),
    ticket: ticketNumberSchema,
    expectedRevision: ticketNumberSchema,
    authoringVersion: countSchema,
    configurationRevision: z.string(),
  }),
  z.strictObject({
    mutation: z.literal("ResolveNativeAction"),
    action: z.string(),
    authorizingSequence: countSchema,
    resolution: z.enum(nativeActionResolutions),
  }),
  /**
   * The whole of the overrides a parked ticket is to hold, fenced to the open
   * escalation it was typed against as that escalation's answers are.
   */
  z.strictObject({
    mutation: z.literal("ChangeTicketOverrides"),
    ticket: ticketNumberSchema,
    action: z.string(),
    authorizingSequence: countSchema,
    overrides: configurationOverridesSchema,
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
  repository: bodyIdentitySchema,
  commit: bodyIdentitySchema,
});

export const forgeCredentialRequestSchema = z.strictObject({
  repository: bodyIdentitySchema,
  permissions: z.enum(forgeCredentialPermissions),
});

/**
 * What a person's authorization of the portal app came back with, and the proof
 * key it was begun under. Nothing names an account or an installation: which
 * accounts are claimed is what the forge answers the person, never the caller.
 */
export const forgeAuthorizationSchema = z.strictObject({
  forge: z.enum(forgeIds),
  code: z.string().min(1).max(forgeAuthorizationTextCharsMax),
  redirectUri: z.string().min(1).max(forgeAuthorizationTextCharsMax),
  codeVerifier: z
    .string()
    .min(forgeAuthorizationVerifierCharsMin)
    .max(forgeAuthorizationVerifierCharsMax),
});

/** The longest tenant or project name a principal may create. */
export const projectNameCharsMax = 39;

/**
 * A tenant or project name a principal creates: lowercase ASCII letters, digits
 * and hyphens, beginning and ending with a letter or digit.
 */
export const projectNameSchema = z
  .string()
  .max(projectNameCharsMax)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u);

/**
 * Names a path outside the tenant routes already begins with: the API's base
 * and probes, the console's own pages and the sign-in's return. A new tenant
 * may not take one, because its pages would share an address with that path.
 */
export const reservedTenantNames = [
  "api",
  "auth",
  "forge",
  "health",
  "projects",
  "tenants",
] as const;

export function tenantNameReserved(name: string): boolean {
  return reservedTenantNames.some((reserved) => reserved === name);
}

/**
 * One project to create, and the tenant it is created under. The server holds
 * each name to `projectNameSchema` and refuses one by naming its field.
 */
export const projectCreationSchema = z.strictObject({
  tenant: bodyIdentitySchema,
  project: bodyIdentitySchema,
});

/**
 * One binding. The project is the path's and is not repeated here, and nothing
 * else is chosen: a binding privileges no repository and elects none.
 */
export const projectRepositoryBindSchema = z.strictObject({
  repository: bodyIdentitySchema,
});

/**
 * One repository to create: whose account it is made under, what it is called,
 * and whether it is that account's alone to read. The forge is not named
 * because a deployment creates through the one its creation half is composed
 * for, and the project is the path's.
 */
export const projectRepositoryCreateSchema = z.strictObject({
  account: bodyIdentitySchema,
  name: bodyIdentitySchema,
  visibility: z.enum(forgeRepositoryVisibilities),
});

/** How a finished ticket lands: the mode alone today, the reference it lands on staying the brief's. */
export const repositoryLandingSchema = z.strictObject({
  mode: z.enum(briefFinalizationModes),
});
export type RepositoryLanding = z.infer<typeof repositoryLandingSchema>;

/** A repository's landing default, written against the one the writer read so two administrators cannot cross. */
export const projectRepositoryLandingSchema = z.strictObject({
  repository: bodyIdentitySchema,
  expected: repositoryLandingSchema,
  landing: repositoryLandingSchema,
});

/** Where a project's work and its evaluations run, both written whole. */
export const executionPlacementSchema = z.strictObject({
  work: z.enum(placementRoutes),
  evaluation: z.enum(placementRoutes),
});

/** Where a project's threads and its lead run, both written whole. */
export const sessionPlacementSchema = z.strictObject({
  thread: z.enum(placementRoutes),
  lead: z.enum(placementRoutes),
});

/**
 * One binding retired. It carries the repository and nothing else: retirement
 * is one-way and names its own row, so there is no value for a second writer
 * to be deciding against and nothing for an expected one to fence.
 */
export const projectRepositoryRetirementSchema = z.strictObject({
  repository: bodyIdentitySchema,
});

/**
 * One binding's configuration step asked for again. It carries the repository
 * and nothing else: the step reads the repository at its own head, and what it
 * may author is the project's one bootstrap.
 */
export const projectRepositoryConfigureSchema = z.strictObject({
  repository: bodyIdentitySchema,
});

export const draftCreationSchema = z.strictObject({
  configurationRevision: bodyIdentitySchema,
  configurationDigest: digestSchema,
  expectedProjectSequence: countSchema,
  authoring: authoringSchema,
  brief: briefSchema,
  overrides: configurationOverridesSchema.optional(),
});

export const draftRevisionSchema = z.strictObject({
  expectedVersion: countSchema,
  configurationRevision: bodyIdentitySchema,
  authoring: authoringSchema,
  brief: briefSchema,
  overrides: configurationOverridesSchema.optional(),
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
  threadStandingRules: selectorSettingsTextSchema.optional(),
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
      dispatchesPerDecision: selectorLimitSchema
        .max(leadDispatchesMax)
        .optional(),
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

/** A reviewer's answer to one held proposal, with the note the lead reads beside it. */
export const selectorProposalReviewSchema = z.strictObject({
  outcome: z.enum(selectorReviewOutcomes),
  feedback: z.string().min(1).max(selectorReviewFeedbackCharsMax).optional(),
});

/**
 * What a member puts in their own thread: a turn identity they mint themselves,
 * the text they typed, and the project-owned images it carries, each named by
 * the identity the upload route minted — a project's own, since no console
 * attaches one yet. The turn is the body's rather than a header's for the
 * reason `submissionSchema` gives — enqueuing is idempotent on it, so a
 * retried post answers the ordinal it already has instead of a second turn.
 */
export const threadMessageSchema = z.strictObject({
  turn: bodyIdentitySchema,
  message: z.string().min(1).max(threadMessageCharsMax),
  images: z.array(bodyIdentitySchema).max(threadMessageImagesMax).optional(),
});

/** What a member calls their own thread, over the title derived from its
 * first message; a title that trims to nothing clears the override. */
export const threadRenameRequestSchema = z.strictObject({
  title: z.string().max(threadTitleCharsMax),
});

/** Whether this thread is on its owner's rail. Nothing is deleted; a hidden
 * thread stays on the threads page. */
export const threadHideRequestSchema = z.strictObject({
  hidden: z.boolean(),
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
