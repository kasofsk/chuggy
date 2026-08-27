/**
 * Every public response body, as a schema a browser can run over `unknown`.
 *
 * A representation the server assembles by hand is parsed leniently — the
 * named fields are guaranteed and anything further is dropped — while the
 * shapes the server itself pins before sending are strict here too, because
 * those are the ones a missing field would be a server fault in. The
 * selector's operational context is not among them: it is an agent's resource
 * rather than a browser's.
 */

import { z } from "zod";

import {
  countSchema,
  cursorSchema,
  digestSchema,
  dispatchViewSchemaVersion,
  identitySchema,
  instantSchema,
  nativeHttpPageItemsMax,
  partitionSchema,
  ticketNumberSchema,
} from "./http.ts";
import {
  authoringResponseSchema,
  finalizationPricingResponseSchema,
  finalizationPricingSchema,
  finalizerSchema,
  programStageResponseSchema,
  programStageSchema,
  resumePricingSchema,
  reworkPolicySchema,
  reworkPolicyResponseSchema,
} from "./authoring.ts";
import { briefResponseSchema } from "./brief.ts";
import {
  architectures,
  artifactRoles,
  attemptStates,
  draftStates,
  escalationReasons,
  executionOutcomes,
  executionStatuses,
  executionTaskKinds,
  nativeActionKindResolutions,
  nativeActionKinds,
  nativeActionResolutions,
  nativeDrivers,
  notificationKinds,
  type NativeActionKind,
  type NativeActionResolution,
  operatingSystems,
  operationRefusalCodes,
  operationStates,
  outputRenderers,
  phaseRoster,
  repositoryConfigurationFaults,
  requirementSources,
  resultVerdicts,
  schedulerFreshnesses,
} from "./rosters.ts";

const page = <T extends z.ZodType>(item: T) =>
  z.array(item).max(nativeHttpPageItemsMax);

/** The partition inside a hand-assembled representation, which drops rather
 * than refuses. */
const partitionValueSchema = partitionSchema.strip();

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

/**
 * A ticket as the project table and its own read both carry it. The brief is
 * the ticket's own read alone: an intent is a paragraph, and a page of them is
 * a page of documents rather than a table.
 */
export const ticketResponseSchema = z.object({
  ticket: ticketNumberSchema,
  phase: z.enum(phaseRoster),
  sequence: countSchema,
  reason: z.enum(escalationReasons).optional(),
  brief: briefResponseSchema.optional(),
});
export type TicketResponse = z.infer<typeof ticketResponseSchema>;

export const projectResponseSchema = z.object({
  partition: partitionValueSchema,
  sequence: countSchema,
  tickets: page(ticketResponseSchema),
  nextAfter: ticketNumberSchema.optional(),
  nextCursor: cursorSchema.optional(),
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

/**
 * One open native action: the fence a `ResolveNativeAction` must name, and the
 * answers this action admits. Those are a subset of what its kind may ask for —
 * an escalation the machine has no resumption for admits only the revoke.
 */
const nativeActionFields = {
  action: identitySchema,
  kind: z.enum(nativeActionKinds),
  authorizingSequence: countSchema,
  admits: z
    .array(z.enum(nativeActionResolutions))
    .min(1)
    .max(nativeActionResolutions.length),
};

function nativeActionKindAdmits(
  kind: NativeActionKind,
): readonly NativeActionResolution[] {
  return nativeActionKindResolutions[kind];
}

const nativeActionAdmitsItsKind = (value: {
  readonly kind: NativeActionKind;
  readonly admits: readonly NativeActionResolution[];
}) =>
  value.admits.every((resolution) =>
    nativeActionKindAdmits(value.kind).includes(resolution),
  );

const nativeActionPairing =
  "a native action admits an answer its kind does not ask for";

export const nativeActionResponseSchema = z
  .object(nativeActionFields)
  .refine(nativeActionAdmitsItsKind, nativeActionPairing);
export type NativeActionResponse = z.infer<typeof nativeActionResponseSchema>;

/** Every action a ticket has open, which the ticket read deliberately omits. */
export const ticketNativeActionsResponseSchema = z.object({
  actions: page(nativeActionResponseSchema),
});
export type TicketNativeActionsResponse = z.infer<
  typeof ticketNativeActionsResponseSchema
>;

/** The same action named across a project, where the ticket is not the path. */
export const projectNativeActionResponseSchema = z
  .object({ ticket: ticketNumberSchema, ...nativeActionFields })
  .refine(nativeActionAdmitsItsKind, nativeActionPairing);
export type ProjectNativeActionResponse = z.infer<
  typeof projectNativeActionResponseSchema
>;

/** A project's open actions, newest fence first, one bounded page at a time. */
export const projectNativeActionsResponseSchema = z.object({
  actions: page(projectNativeActionResponseSchema),
  nextCursor: cursorSchema.optional(),
});
export type ProjectNativeActionsResponse = z.infer<
  typeof projectNativeActionsResponseSchema
>;

export const operationalStatusResponseSchema = z.object({
  observedAt: instantSchema,
  schedulerFreshness: z.enum(schedulerFreshnesses),
  queued: countSchema,
  admitted: countSchema,
  launching: countSchema,
  running: countSchema,
  clusterSlotsMax: countSchema,
  clusterActive: countSchema,
  accountMaximum: countSchema,
  accountActive: countSchema,
  accountReservationDeficit: countSchema,
});
export type OperationalStatusResponse = z.infer<
  typeof operationalStatusResponseSchema
>;

/**
 * What a task was required to run on, as the scheduler materialized it. The
 * arms are strict because the interpreter refuses a requirement carrying a key
 * outside the mode it names.
 */
const executionRequirementSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("Container"),
    operatingSystem: z.enum(operatingSystems),
    architecture: z.enum(architectures),
    image: z.string().min(1),
  }),
  z.strictObject({
    mode: z.literal("Native"),
    architecture: z.enum(architectures),
    driver: z.enum(nativeDrivers),
    xcodeVersionMin: ticketNumberSchema,
    sdkVersionMin: ticketNumberSchema,
  }),
]);

/**
 * The label the catalog holds for an admitted image. It sits beside the
 * requirement rather than inside it, because the requirement is the digested
 * value and a label is not part of what an execution is.
 */
export const workerSchema = z.strictObject({
  name: identitySchema,
  version: identitySchema,
});

export const executionSummarySchema = z.object({
  execution: identitySchema,
  ticket: ticketNumberSchema,
  task: countSchema,
  taskKind: z.enum(executionTaskKinds),
  stage: countSchema.optional(),
  cluster: identitySchema,
  configurationRevision: identitySchema,
  requirementIdentity: identitySchema,
  requirement: executionRequirementSchema,
  requirementDigest: digestSchema,
  requirementSource: z.enum(requirementSources),
  worker: workerSchema.optional(),
  platformDefaultVersion: ticketNumberSchema,
  status: z.enum(executionStatuses),
  outcome: z.enum(executionOutcomes).optional(),
  retriesSpent: countSchema,
  registeredAt: instantSchema,
  terminalAt: instantSchema.optional(),
});
export type ExecutionSummary = z.infer<typeof executionSummarySchema>;

export const executionsResponseSchema = z.object({
  executions: page(executionSummarySchema),
  nextAfter: identitySchema.optional(),
});
export type ExecutionsResponse = z.infer<typeof executionsResponseSchema>;

const outputDefinitionSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  mediaType: z.string().min(1),
  renderer: z.enum(outputRenderers),
});

const resultArtifactSchema = z.object({
  ordinal: countSchema,
  role: z.enum(artifactRoles),
  path: z.string().min(1),
  digest: z.string().min(1),
  bytes: countSchema,
  output: outputDefinitionSchema.optional(),
});

const executionAttemptSchema = z.object({
  attempt: identitySchema,
  number: countSchema,
  generation: countSchema,
  state: z.enum(attemptStates),
  openedAt: instantSchema,
  endedAt: instantSchema.optional(),
});

const executionResultSchema = z.object({
  manifest: identitySchema,
  attempt: identitySchema,
  schemaVersion: countSchema,
  digest: z.string().min(1),
  verdict: z.enum(resultVerdicts),
  recordedAt: instantSchema,
  artifacts: page(resultArtifactSchema),
});

export const executionResponseSchema = executionSummarySchema.extend({
  attempts: page(executionAttemptSchema),
  result: executionResultSchema.optional(),
});
export type ExecutionResponse = z.infer<typeof executionResponseSchema>;

export const outputContentResponseSchema = z.object({
  read: z.literal("Content"),
  mediaType: z.string().min(1),
  renderer: z.enum(outputRenderers),
  content: z.string(),
});
export type OutputContentResponse = z.infer<typeof outputContentResponseSchema>;

const operationIdentitySchema = {
  operation: identitySchema,
  acceptedAt: z.iso.datetime({ offset: true }),
};

export const operationResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...operationIdentitySchema, state: z.literal("Pending") }),
  z.strictObject({
    ...operationIdentitySchema,
    state: z.literal("Succeeded"),
    decidedSequence: countSchema,
  }),
  z.strictObject({
    ...operationIdentitySchema,
    state: z.literal("Refused"),
    code: z.enum(operationRefusalCodes),
    refusedHead: countSchema,
    refusedLifecycleGeneration: countSchema,
  }),
  z.strictObject({ ...operationIdentitySchema, state: z.literal("Answered") }),
  z.strictObject({ ...operationIdentitySchema, state: z.literal("Cancelled") }),
]);
export type OperationResponse = z.infer<typeof operationResponseSchema>;

/** What a submission's 202 and a cancellation's 200 both carry, and no more. */
export const operationAcceptanceSchema = z.strictObject({
  operation: identitySchema,
  state: z.enum(operationStates),
});
export type OperationAcceptance = z.infer<typeof operationAcceptanceSchema>;

const notificationSchema = z.strictObject({
  ordinal: countSchema,
  kind: z.enum(notificationKinds),
  resource: identitySchema,
  projectSequence: countSchema.optional(),
  authoringVersion: countSchema.optional(),
});

export const notificationsResponseSchema = z.discriminatedUnion("result", [
  z.strictObject({ result: z.literal("Reset"), cursor: countSchema }),
  z.strictObject({
    result: z.literal("Events"),
    cursor: countSchema,
    events: page(notificationSchema),
  }),
]);
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;

export const dispatchViewTokenSchema = z.strictObject({
  tenant: identitySchema,
  project: identitySchema,
  recoveryEpoch: identitySchema,
  schemaVersion: z.literal(dispatchViewSchemaVersion),
  watermark: countSchema,
  digest: digestSchema,
});

const dispatchCandidateSchema = z.strictObject({
  ticket: ticketNumberSchema,
  ticketVersion: countSchema,
  dependencies: page(ticketNumberSchema),
  workFanout: ticketNumberSchema,
  program: page(programStageSchema),
  reworkPolicy: reworkPolicySchema,
  finalizationPricing: finalizationPricingSchema,
  resumePricing: resumePricingSchema,
  finalizer: finalizerSchema,
  configurationRevision: identitySchema,
  configurationDigest: digestSchema,
  configurationCanonical: z.string().min(1),
});

export const dispatchViewResponseSchema = z.discriminatedUnion("result", [
  z.strictObject({ result: z.literal("Reset") }),
  z.strictObject({
    result: z.literal("Page"),
    token: dispatchViewTokenSchema,
    candidates: page(dispatchCandidateSchema),
    nextAfter: ticketNumberSchema.optional(),
    notificationCursor: countSchema,
  }),
]);
export type DispatchViewResponse = z.infer<typeof dispatchViewResponseSchema>;

export const configurationResponseSchema = z.object({
  partition: partitionValueSchema,
  revision: identitySchema,
  parent: identitySchema.optional(),
  canonical: z.string().min(1),
  digest: z.string().min(1),
});
export type ConfigurationResponse = z.infer<typeof configurationResponseSchema>;

const configurationProvenanceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("Authored") }),
  z.object({
    source: z.literal("Repository"),
    repository: identitySchema,
    commit: identitySchema,
    path: z.string().min(1),
    name: identitySchema,
  }),
]);

const configurationSummaryBase = {
  revision: identitySchema,
  parent: identitySchema.optional(),
  digest: z.string().min(1),
  createdAt: instantSchema,
  provenance: configurationProvenanceSchema,
};

const configurationSummarySchema = z.discriminatedUnion("readiness", [
  z.object({
    ...configurationSummaryBase,
    readiness: z.literal("Incomplete"),
  }),
  z.object({
    ...configurationSummaryBase,
    readiness: z.literal("Ready"),
    image: z.string().min(1),
    worker: workerSchema.optional(),
    practices: page(z.string().min(1)),
    workInstructionsCount: countSchema,
    reviewInstructionsCount: countSchema,
  }),
]);
export type ConfigurationSummary = z.infer<typeof configurationSummarySchema>;

export const configurationsResponseSchema = z.object({
  configurations: page(configurationSummarySchema),
  nextCursor: cursorSchema.optional(),
});
export type ConfigurationsResponse = z.infer<
  typeof configurationsResponseSchema
>;

export const repositoryConfigurationImportedSchema = z.object({
  imported: z.literal(true),
});

export const repositoryConfigurationRefusalSchema = z.object({
  path: z.string().min(1),
  fault: z.enum(repositoryConfigurationFaults),
  configurationFault: identitySchema.optional(),
});

export const repositoryConfigurationRefusalsSchema = z.object({
  faults: page(repositoryConfigurationRefusalSchema),
});
export type RepositoryConfigurationRefusals = z.infer<
  typeof repositoryConfigurationRefusalsSchema
>;

export const draftResponseSchema = z.object({
  partition: partitionValueSchema,
  ticket: ticketNumberSchema,
  authoringVersion: countSchema,
  state: z.enum(draftStates),
  configurationRevision: identitySchema,
  authoring: authoringResponseSchema,
  brief: briefResponseSchema.optional(),
});
export type DraftResponse = z.infer<typeof draftResponseSchema>;

export const draftInitializationResponseSchema = z.object({
  configuration: configurationResponseSchema,
  fence: z.object({
    projectSequence: countSchema,
    configurationDigest: digestSchema,
  }),
  defaults: authoringResponseSchema,
  choices: z.object({
    stages: page(programStageResponseSchema),
    programStagesMax: countSchema,
    workFanouts: page(ticketNumberSchema),
    reworkPolicies: page(reworkPolicyResponseSchema),
    finalizationPricings: page(finalizationPricingResponseSchema),
    resumePricings: page(resumePricingSchema),
    finalizers: page(finalizerSchema),
  }),
  dependencyCandidates: page(ticketNumberSchema),
  dependencyCandidatesTruncated: z.boolean(),
});
export type DraftInitializationResponse = z.infer<
  typeof draftInitializationResponseSchema
>;
