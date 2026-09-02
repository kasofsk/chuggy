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
  resultReportCharsMax,
  runModelCharsMax,
  runOutcomeLabelCharsMax,
  runTranscriptPageBatchesMax,
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
import { selectorProjectOverridesSchema } from "./requests.ts";
import {
  architectures,
  artifactRoles,
  attemptEvidences,
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
  resumePoints,
  runCostBases,
  schedulerFreshnesses,
  selectorDispatchModes,
  selectorModes,
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

/** Tokens by kind, as the agent runtime counts them. */
const runTokensSchema = z.object({
  tokensInput: countSchema,
  tokensOutput: countSchema,
  tokensCacheCreation: countSchema,
  tokensCacheRead: countSchema,
});

/** One model's share of a run, which is what a per-model breakdown is a page of. */
export const runModelUsageSchema = runTokensSchema.extend({
  model: z.string().min(1).max(runModelCharsMax),
  costUsdMicros: countSchema,
});

/**
 * What one run spent. `costUsdMicros` is the runtime's own list price in
 * millionths of a dollar, so a durable row holds an integer rather than a float.
 */
export const runTotalsSchema = runTokensSchema.extend({
  turns: countSchema,
  durationMs: countSchema,
  durationApiMs: countSchema,
  costUsdMicros: countSchema,
  costBasis: z.enum(runCostBases),
  models: page(runModelUsageSchema),
  permissionDenials: countSchema,
  resultSubtype: z.string().min(1).max(runOutcomeLabelCharsMax).optional(),
  stopReason: z.string().min(1).max(runOutcomeLabelCharsMax).optional(),
});
export type RunTotals = z.infer<typeof runTotalsSchema>;

/** One assistant turn's usage, folded so it outlives the transcript it came from. */
export const runTurnSchema = runTokensSchema.extend({
  ordinal: countSchema,
  model: z.string().min(1).max(runModelCharsMax),
  recordedAt: instantSchema,
});

/** Where the snapshot is and how much of it there is; its contents are their own read. */
const runConfigurationRefSchema = z.strictObject({
  digest: digestSchema,
  bytes: countSchema,
  recordedAt: instantSchema,
});

/**
 * How far the transcript has been written and when. `observedAt` is the
 * instant the newest batch was recorded, which is the pane's "as of".
 */
const runTranscriptRefSchema = z.strictObject({
  batches: countSchema,
  bytes: countSchema,
  highWaterBatch: countSchema,
  observedAt: instantSchema,
});

/** One run's evidence, which is what the attempt that produced it carries. */
export const executionRunSchema = z.object({
  startedAt: instantSchema,
  configuration: runConfigurationRefSchema.optional(),
  transcript: runTranscriptRefSchema.optional(),
  turnsRecorded: countSchema,
  totals: runTotalsSchema.optional(),
});
export type ExecutionRun = z.infer<typeof executionRunSchema>;

/**
 * What a ticket has left to spend, optional as a whole because a projection row
 * written before the machine's accounts reached it carries none of them.
 * `finalizationLeft` is present exactly when the ticket's pricing budgets a
 * finalization account at all — under `DeadlineOnly` a finalizer failure prices
 * from gas alone, so a zero would say "exhausted" of an account that never was.
 */
const ticketAccountsSchema = z.object({
  gasLeft: countSchema,
  gasMax: countSchema,
  reworkLeft: countSchema,
  finalizationLeft: countSchema.optional(),
});

/**
 * A ticket as the project table and its own read both carry it. The brief is
 * the ticket's own read alone: an intent is a paragraph, and a page of them is
 * a page of documents rather than a table.
 */
export const ticketResponseSchema = z.object({
  ticket: ticketNumberSchema,
  phase: z.enum(phaseRoster),
  sequence: countSchema,
  /**
   * When the entry `sequence` names committed, which is when the ticket entered
   * the phase and reason reported here. Nothing moves a Done or Revoked ticket
   * again, so on one of those this is when it completed and there is no second
   * field for that.
   */
  changedAt: instantSchema,
  /**
   * When the entry that released this ticket committed. It is optional because
   * which entry that is has to be read out of an encoded event, and the journal
   * admits an entry no reader can parse.
   */
  releasedAt: instantSchema.optional(),
  reason: z.enum(escalationReasons).optional(),
  resumeAt: z.enum(resumePoints).optional(),
  accounts: ticketAccountsSchema.optional(),
  brief: briefResponseSchema.optional(),
  runTotals: runTotalsSchema.optional(),
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

const selectorLimitsResponseSchema = z.object({
  tokensPerDecision: countSchema,
  millisecondsPerDecision: countSchema,
  toolCallsPerDecision: countSchema,
  inputBytesPerDecision: countSchema,
  candidatePagesPerDecision: countSchema,
  concurrentDecisions: countSchema,
  selectionsPerMinute: countSchema,
});

/**
 * What the selector actually runs a project under: every field is either the
 * project's own or the installation default, and both revisions are named
 * because a decision is fenced on the pair. `installationMode` is beside the
 * resolved `mode` so a reader can tell a project's own pause from the
 * installation-wide one it cannot lift.
 */
export const selectorEffectiveSettingsResponseSchema = z.strictObject({
  revision: countSchema,
  projectRevision: countSchema,
  mode: z.enum(selectorModes),
  installationMode: z.enum(selectorModes),
  dispatchMode: z.enum(selectorDispatchModes),
  basePrompt: z.string().min(1),
  northStar: z.string().min(1).optional(),
  modelAllowlist: z.array(z.string()),
  toolAllowlist: z.array(z.string()),
  limits: selectorLimitsResponseSchema,
  operationalContextMaxAgeMs: countSchema,
});

export const selectorProjectSettingsResponseSchema = z.strictObject({
  partition: partitionValueSchema,
  revision: countSchema,
  overrides: selectorProjectOverridesSchema,
  effective: selectorEffectiveSettingsResponseSchema,
});
export type SelectorProjectSettingsResponse = z.infer<
  typeof selectorProjectSettingsResponseSchema
>;

export const selectorSettingsRevisionResponseSchema = z.strictObject({
  revision: countSchema,
  overrides: selectorProjectOverridesSchema,
  administrator: z.strictObject({
    kind: identitySchema,
    subject: identitySchema,
  }),
  recordedAt: instantSchema,
});

export const selectorSettingsHistoryResponseSchema = z.strictObject({
  revisions: page(selectorSettingsRevisionResponseSchema),
});
export type SelectorSettingsHistoryResponse = z.infer<
  typeof selectorSettingsHistoryResponseSchema
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
 * A repository-imported configuration's label. Absent means no label is known,
 * which is what an authored revision carries.
 */
export const configurationVersionSchema = z.strictObject({
  name: identitySchema,
  number: ticketNumberSchema,
});

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
  configurationVersion: configurationVersionSchema.optional(),
  requirementIdentity: identitySchema,
  requirement: executionRequirementSchema,
  requirementDigest: digestSchema,
  requirementSource: z.enum(requirementSources),
  /**
   * The spawn request that made this execution, which is its fan-out set's
   * identity. Optional for the deployment window and not because a summary can
   * lack one: the console is its own artifact, so a bundle that already reads
   * this field can reach a server not yet sending it, and a required field
   * would fail the whole page rather than one cell.
   */
  request: identitySchema.optional(),
  worker: workerSchema.optional(),
  platformDefaultVersion: ticketNumberSchema,
  status: z.enum(executionStatuses),
  outcome: z.enum(executionOutcomes).optional(),
  retriesSpent: countSchema,
  registeredAt: instantSchema,
  /**
   * When this execution's first attempt opened, absent while it has none. It is
   * the same instant that attempt carries in the detail read, so a row that has
   * only the summary can still separate the wait from the run.
   */
  startedAt: instantSchema.optional(),
  terminalAt: instantSchema.optional(),
  runTotals: runTotalsSchema.optional(),
});
export type ExecutionSummary = z.infer<typeof executionSummarySchema>;

/**
 * One page of the project's executions, ordered by `(ticket, task)` ascending.
 * The cursor is a position in that order, so the `ticket` filter narrows the
 * same list rather than paging a different one.
 */
export const executionsResponseSchema = z.object({
  executions: page(executionSummarySchema),
  nextCursor: cursorSchema.optional(),
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
  evidence: z.enum(attemptEvidences).optional(),
  run: executionRunSchema.optional(),
});

const executionResultSchema = z.object({
  manifest: identitySchema,
  attempt: identitySchema,
  schemaVersion: countSchema,
  digest: z.string().min(1),
  verdict: z.enum(resultVerdicts),
  recordedAt: instantSchema,
  artifacts: page(resultArtifactSchema),
  report: z.string().min(1).max(resultReportCharsMax).optional(),
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

/** One page of a run's per-turn series, ascending, resumed by the last ordinal. */
export const runTurnsResponseSchema = z.object({
  turns: page(runTurnSchema),
  nextAfter: countSchema.optional(),
});
export type RunTurnsResponse = z.infer<typeof runTurnsResponseSchema>;

const runTranscriptBatchAt = {
  batch: countSchema,
  recordedAt: instantSchema,
  bytes: countSchema,
};

/**
 * One batch of a run's transcript: its characters, or the reason it has none.
 * A batch whose stored object is gone or fails its digest is marked rather than
 * refusing the batches around it, because a run that died never retries the
 * upload and those neighbours are the whole of what it left.
 */
const runTranscriptBatchSchema = z.discriminatedUnion("read", [
  z.object({
    ...runTranscriptBatchAt,
    read: z.literal("Content"),
    content: z.string(),
  }),
  z.object({ ...runTranscriptBatchAt, read: z.literal("Missing") }),
  z.object({ ...runTranscriptBatchAt, read: z.literal("Corrupt") }),
]);

/**
 * One page of a run's transcript. `complete` says the attempt is no longer
 * live, so no further batch can arrive; it is derived and never stored.
 */
export const runTranscriptResponseSchema = z.object({
  batches: z.array(runTranscriptBatchSchema).max(runTranscriptPageBatchesMax),
  observedAt: instantSchema,
  complete: z.boolean(),
  nextAfter: countSchema.optional(),
});
export type RunTranscriptResponse = z.infer<typeof runTranscriptResponseSchema>;

export const runConfigurationResponseSchema = z.object({
  read: z.literal("Content"),
  digest: digestSchema,
  bytes: countSchema,
  content: z.string(),
});
export type RunConfigurationResponse = z.infer<
  typeof runConfigurationResponseSchema
>;

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
  configurationVersion: configurationVersionSchema.optional(),
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
  version: configurationVersionSchema.optional(),
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
  version: configurationVersionSchema.optional(),
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
  configurationVersion: configurationVersionSchema.optional(),
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
  commandedCheckStage: countSchema.optional(),
});
export type DraftInitializationResponse = z.infer<
  typeof draftInitializationResponseSchema
>;
