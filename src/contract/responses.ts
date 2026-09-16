import { z } from "zod";
import {
  countSchema,
  forgeInstallationsAnsweredMax,
  forgeRefusalMessageCharsMax,
  forgeRepositoriesAnsweredMax,
  identitySchema,
  inquiriesAnsweredMax,
  inquiryQuestionCharsMax,
  instantSchema,
  leadTurnsAnsweredMax,
  nativeHttpPageItemsMax,
  partitionSchema,
  projectRepositoriesAnsweredMax,
  sessionStoreStreamCharsMax,
  sessionStoreStreamsAnswered,
  sessionTranscriptEntriesMax,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
  threadTitleCharsMax,
  threadTurnRecordedCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
} from "./http.ts";
import { repositoryLandingSchema } from "./requests.ts";
import {
  forgeAccountKinds,
  forgeApps,
  sessionStates,
  sessionTurnFailures,
  sessionTurnInputKinds,
  sessionTurnStates,
  threadStandings,
} from "./rosters.ts";

const page = <T extends z.ZodType>(item: T) =>
  z.array(item).max(nativeHttpPageItemsMax);

export const installationResponseSchema = z.object({
  installation: identitySchema,
});
export type InstallationResponse = z.infer<typeof installationResponseSchema>;
export const projectInventoryResponseSchema = z.strictObject({
  projects: page(partitionSchema),
  nextCursor: z.string().optional(),
});
export type ProjectInventoryResponse = z.infer<
  typeof projectInventoryResponseSchema
>;

const sessionTurnMeasureShape = {
  model: z.string().max(sessionTurnModelCharsMax).optional(),
  tokens: countSchema.optional(),
  costMicros: countSchema.optional(),
  durationMs: countSchema.optional(),
  tools: z
    .array(z.string().max(sessionTurnToolNameCharsMax))
    .max(sessionTurnToolsMax)
    .optional(),
  batchFirst: countSchema.optional(),
  batchLast: countSchema.optional(),
};
export const leadTurnResponseSchema = z.object({
  turn: identitySchema,
  ordinal: countSchema,
  inputKind: z.enum(sessionTurnInputKinds),
  state: z.enum(sessionTurnStates),
  failure: z.enum(sessionTurnFailures).optional(),
  ...sessionTurnMeasureShape,
});
export type LeadTurnResponse = z.infer<typeof leadTurnResponseSchema>;
export const leadStoreStreamResponseSchema = z.object({
  stream: z.string().min(1).max(sessionStoreStreamCharsMax),
  batches: countSchema,
});
export const leadResponseSchema = z.object({
  session: identitySchema,
  state: z.enum(sessionStates),
  agentReference: identitySchema.optional(),
  turns: z.array(leadTurnResponseSchema).max(leadTurnsAnsweredMax),
  streams: z
    .array(leadStoreStreamResponseSchema)
    .max(sessionStoreStreamsAnswered),
});
export type LeadResponse = z.infer<typeof leadResponseSchema>;
export const leadTranscriptEntryResponseSchema = z.object({
  uuid: identitySchema.optional(),
  type: identitySchema,
  timestamp: instantSchema.optional(),
  message: z.unknown(),
});
export const leadTranscriptResponseSchema = z.object({
  stream: z.string().min(1).max(sessionStoreStreamCharsMax),
  entries: z
    .array(leadTranscriptEntryResponseSchema)
    .max(sessionTranscriptEntriesMax),
  held: z.array(identitySchema).max(sessionTranscriptEntriesMax).optional(),
  cut: countSchema.optional(),
  compaction: z
    .object({ boundary: identitySchema, at: instantSchema.optional() })
    .optional(),
  elided: countSchema,
  truncated: z.boolean(),
  nextAfter: countSchema.optional(),
});
export type LeadTranscriptResponse = z.infer<
  typeof leadTranscriptResponseSchema
>;

export const threadEntryResponseSchema = z.object({
  session: identitySchema,
  owner: identitySchema.optional(),
  state: z.enum(threadStandings),
  mine: z.boolean(),
  turns: countSchema,
  agentReference: identitySchema.optional(),
  title: z.string().max(threadTitleCharsMax).optional(),
  openedAt: instantSchema,
  lastActivityAt: instantSchema,
  hidden: z.boolean(),
});
export type ThreadEntryResponse = z.infer<typeof threadEntryResponseSchema>;
export const threadsResponseSchema = z.object({
  threads: z.array(threadEntryResponseSchema).max(threadsAnsweredMax),
});
export type ThreadsResponse = z.infer<typeof threadsResponseSchema>;
export const threadTurnResponseSchema = z.object({
  turn: identitySchema,
  ordinal: countSchema,
  inputKind: z.enum(sessionTurnInputKinds),
  state: z.enum(sessionTurnStates),
  input: z.string().max(threadTurnRecordedCharsMax),
  result: z.string().max(sessionTurnResultCharsMax).optional(),
  failure: z.enum(sessionTurnFailures).optional(),
  ...sessionTurnMeasureShape,
});
export type ThreadTurnResponse = z.infer<typeof threadTurnResponseSchema>;
export const threadResponseSchema = z.object({
  session: identitySchema,
  owner: identitySchema.optional(),
  state: z.enum(threadStandings),
  mine: z.boolean(),
  agentReference: identitySchema.optional(),
  title: z.string().max(threadTitleCharsMax).optional(),
  openedAt: instantSchema,
  lastActivityAt: instantSchema,
  hidden: z.boolean(),
  turns: z.array(threadTurnResponseSchema).max(threadTurnsAnsweredMax),
  nextBefore: countSchema.optional(),
  streams: z
    .array(leadStoreStreamResponseSchema)
    .max(sessionStoreStreamsAnswered),
});
export type ThreadResponse = z.infer<typeof threadResponseSchema>;
export const threadTranscriptResponseSchema = leadTranscriptResponseSchema;
export type ThreadTranscriptResponse = LeadTranscriptResponse;
export const threadRenameResponseSchema = threadEntryResponseSchema;
export const threadHideResponseSchema = threadEntryResponseSchema;
export const threadMessageAcceptedSchema = z.object({
  turn: identitySchema,
  ordinal: countSchema,
});
export type ThreadMessageAccepted = z.infer<typeof threadMessageAcceptedSchema>;

const inquiryMeasureShape = leadTurnResponseSchema.pick({
  model: true,
  tokens: true,
  costMicros: true,
  durationMs: true,
}).shape;
export const leadInquiryResponseSchema = z.object({
  session: identitySchema,
  asker: identitySchema.optional(),
  mine: z.boolean(),
  state: z.enum(sessionStates),
  turnState: z.enum(sessionTurnStates),
  ordinal: countSchema,
  question: z.string().min(1).max(inquiryQuestionCharsMax),
  answer: z.string().max(sessionTurnResultCharsMax).optional(),
  failure: z.enum(sessionTurnFailures).optional(),
  askedAt: instantSchema,
  ...inquiryMeasureShape,
});
export type LeadInquiryResponse = z.infer<typeof leadInquiryResponseSchema>;
export const leadInquiriesResponseSchema = z.object({
  inquiries: z.array(leadInquiryResponseSchema).max(inquiriesAnsweredMax),
});
export type LeadInquiriesResponse = z.infer<typeof leadInquiriesResponseSchema>;
export const leadInquiryAcceptedSchema = z.object({
  session: identitySchema,
  turn: identitySchema,
  ordinal: countSchema,
});
export type LeadInquiryAccepted = z.infer<typeof leadInquiryAcceptedSchema>;

export const forgeAppResponseSchema = z.object({
  app: z.enum(forgeApps),
  id: identitySchema,
  slug: identitySchema,
  installUrl: z.string().min(1),
});
export type ForgeAppResponse = z.infer<typeof forgeAppResponseSchema>;
export const forgeAppsResponseSchema = z.object({
  apps: z.array(forgeAppResponseSchema).max(forgeApps.length),
});
export type ForgeAppsResponse = z.infer<typeof forgeAppsResponseSchema>;
export const forgeInstallationClaimedSchema = z.object({
  forge: identitySchema,
  app: z.enum(forgeApps),
  account: identitySchema,
  accountKind: z.enum(forgeAccountKinds),
  installationId: identitySchema,
});
export type ForgeInstallationClaimedResponse = z.infer<
  typeof forgeInstallationClaimedSchema
>;
export const forgeInstallationResponseSchema =
  forgeInstallationClaimedSchema.extend({ claimedAt: instantSchema });
export type ForgeInstallationResponse = z.infer<
  typeof forgeInstallationResponseSchema
>;
export const forgeInstallationsResponseSchema = z.object({
  installations: z
    .array(forgeInstallationResponseSchema)
    .max(forgeInstallationsAnsweredMax),
  truncated: z.boolean(),
});
export type ForgeInstallationsResponse = z.infer<
  typeof forgeInstallationsResponseSchema
>;
export const forgeRepositoryResponseSchema = z.object({
  name: identitySchema,
  fullName: z.string().min(1),
  url: z.string().min(1),
  defaultBranch: z.string().min(1),
  private: z.boolean(),
});
export type ForgeRepositoryResponse = z.infer<
  typeof forgeRepositoryResponseSchema
>;
export const forgeRepositoriesResponseSchema = z.object({
  repositories: z
    .array(forgeRepositoryResponseSchema)
    .max(forgeRepositoriesAnsweredMax),
  truncated: z.boolean(),
});
export type ForgeRepositoriesResponse = z.infer<
  typeof forgeRepositoriesResponseSchema
>;

export const projectRepositoryBoundSchema = z.object({
  repository: z.string().min(1),
  landing: repositoryLandingSchema,
});
export type ProjectRepositoryBoundResponse = z.infer<
  typeof projectRepositoryBoundSchema
>;
export const projectRepositoryAlreadyBoundSchema = z.object({
  repository: z.string().min(1),
});
export type ProjectRepositoryAlreadyBoundResponse = z.infer<
  typeof projectRepositoryAlreadyBoundSchema
>;
export const projectRepositoryRulesetSchema = z.discriminatedUnion("result", [
  z.object({ result: z.literal("Created") }),
  z.object({
    result: z.literal("Refused"),
    message: z.string().max(forgeRefusalMessageCharsMax),
  }),
  z.object({ result: z.literal("Skipped") }),
  z.object({ result: z.literal("Unavailable") }),
]);
export type ProjectRepositoryRulesetResponse = z.infer<
  typeof projectRepositoryRulesetSchema
>;
export const projectRepositoryCreatedSchema = z.object({
  repository: z.string().min(1),
  landing: repositoryLandingSchema,
  created: z.object({
    account: identitySchema,
    name: identitySchema,
    url: z.string().min(1),
  }),
  seeded: z.boolean(),
  ruleset: projectRepositoryRulesetSchema,
});
export type ProjectRepositoryCreatedResponse = z.infer<
  typeof projectRepositoryCreatedSchema
>;
export const projectRepositoryResponseSchema = z.object({
  repository: z.string().min(1),
  boundAt: instantSchema,
  landing: repositoryLandingSchema,
  retiredAt: instantSchema.optional(),
});
export type ProjectRepositoryResponse = z.infer<
  typeof projectRepositoryResponseSchema
>;
export const projectRepositoryLandingWrittenSchema = z.object({
  repository: projectRepositoryResponseSchema,
});
export const projectRepositoryLandingConflictSchema = z.object({
  repository: projectRepositoryResponseSchema,
});
export const projectRepositoryRetiredSchema = z.object({
  repository: projectRepositoryResponseSchema,
});
export const projectRepositoriesResponseSchema = z.object({
  repositories: z
    .array(projectRepositoryResponseSchema)
    .max(projectRepositoriesAnsweredMax),
});
export type ProjectRepositoriesResponse = z.infer<
  typeof projectRepositoriesResponseSchema
>;
