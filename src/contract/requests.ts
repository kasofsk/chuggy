import { z } from "zod";

import {
  inquiryQuestionCharsMax,
  threadMessageCharsMax,
  threadTitleCharsMax,
} from "./http.ts";
import {
  briefFinalizationModes,
  forgeApps,
  forgeCredentialPermissions,
  forgeIds,
  forgeRepositoryVisibilities,
} from "./rosters.ts";

const bodyIdentitySchema = z.string().min(1);

export const forgeCredentialRequestSchema = z.strictObject({
  repository: bodyIdentitySchema,
  permissions: z.enum(forgeCredentialPermissions),
});

export const forgeInstallationClaimSchema = z.strictObject({
  forge: z.enum(forgeIds),
  app: z.enum(forgeApps),
  installationId: bodyIdentitySchema,
});

export const projectRepositoryBindSchema = z.strictObject({
  repository: bodyIdentitySchema,
});

export const projectRepositoryCreateSchema = z.strictObject({
  account: bodyIdentitySchema,
  name: bodyIdentitySchema,
  visibility: z.enum(forgeRepositoryVisibilities),
});

export const repositoryLandingSchema = z.strictObject({
  mode: z.enum(briefFinalizationModes),
});
export type RepositoryLanding = z.infer<typeof repositoryLandingSchema>;

export const projectRepositoryLandingSchema = z.strictObject({
  repository: bodyIdentitySchema,
  expected: repositoryLandingSchema,
  landing: repositoryLandingSchema,
});

export const projectRepositoryRetirementSchema = z.strictObject({
  repository: bodyIdentitySchema,
});

export const threadMessageSchema = z.strictObject({
  turn: bodyIdentitySchema,
  message: z.string().min(1).max(threadMessageCharsMax),
});

export const threadRenameRequestSchema = z.strictObject({
  title: z.string().max(threadTitleCharsMax),
});

export const threadHideRequestSchema = z.strictObject({ hidden: z.boolean() });

export const leadInquirySchema = z.strictObject({
  session: bodyIdentitySchema,
  turn: bodyIdentitySchema,
  question: z.string().min(1).max(inquiryQuestionCharsMax),
});
