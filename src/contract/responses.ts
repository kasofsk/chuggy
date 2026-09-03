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
  agenticRefusalLedgerAnsweredMax,
  agenticRefusalReasonCharsMax,
  agenticRefusalsAnsweredMax,
  countSchema,
  cursorSchema,
  digestSchema,
  dispatchViewSchemaVersion,
  identitySchema,
  inquiriesAnsweredMax,
  inquiryQuestionCharsMax,
  instantSchema,
  leadTurnsAnsweredMax,
  nativeHttpPageItemsMax,
  partitionSchema,
  resultReportCharsMax,
  runModelCharsMax,
  runOutcomeLabelCharsMax,
  runTranscriptPageBatchesMax,
  selectorHandoffNoteBytesMax,
  selectorHandoffNotePreviewCharsMax,
  selectorHistoryLimitMax,
  sessionStoreStreamCharsMax,
  sessionStoreStreamsAnswered,
  sessionTranscriptEntriesMax,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
  threadMessageCharsMax,
  threadSeedingCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
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
  executionCapabilities,
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
  selectorAttentions,
  selectorDispatchModes,
  selectorModes,
  agenticRefusalEvents,
  sessionStates,
  sessionTurnFailures,
  sessionTurnInputKinds,
  sessionTurnStates,
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
 * What a task was required to run on, as the scheduler materialized it: an
 * exact image, the capabilities a site must offer, or a native toolchain
 * floor. The arms are strict because the interpreter refuses a requirement
 * carrying a key outside the mode it names, and `test/contract/rosters.test.ts`
 * holds the modes against the interpreter's own union.
 */
export const executionRequirementSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("Container"),
    operatingSystem: z.enum(operatingSystems),
    architecture: z.enum(architectures),
    image: z.string().min(1),
  }),
  z.strictObject({
    mode: z.literal("ContainerCapability"),
    operatingSystem: z.enum(operatingSystems),
    architecture: z.enum(architectures),
    capabilities: z.array(z.enum(executionCapabilities)).min(1),
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

/**
 * One page of the drafts a project still holds open, ascending by ticket, and a
 * released or deleted draft is neither: the first is a ticket and is read as
 * one, and the second is gone.
 * `nextCursor` is where the next page resumes and is absent exactly where
 * `more` is false, so a client reads one field or the other and never both.
 */
export const draftsResponseSchema = z.object({
  drafts: page(draftResponseSchema),
  nextCursor: cursorSchema.optional(),
  more: z.boolean(),
});
export type DraftsResponse = z.infer<typeof draftsResponseSchema>;

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

/**
 * How large the note a lead leaves its successor is, and as much of it as the
 * lead read carries. The note itself is opaque to everything but the lead, and
 * at its own ceiling it weighs a whole wire body, so the read that carries a
 * mailbox tail and a stream listing beside it carries this instead.
 */
const handoffNotePreviewSchema = z.strictObject({
  bytes: countSchema.max(selectorHandoffNoteBytesMax),
  preview: z.string().max(selectorHandoffNotePreviewCharsMax),
  truncated: z.boolean(),
});

/** One entry of one ticket's refusal ledger, as the ledger recorded it. */
export const agenticRefusalEntryResponseSchema = z.object({
  ordinal: countSchema,
  event: z.enum(agenticRefusalEvents),
  ticketVersion: countSchema,
  reason: z.string().min(1).max(agenticRefusalReasonCharsMax),
  decision: identitySchema,
  recordedAt: instantSchema,
});
export type AgenticRefusalEntryResponse = z.infer<
  typeof agenticRefusalEntryResponseSchema
>;

/**
 * One page of one ticket's refusal ledger, oldest first, `more` saying whether
 * the page ends the ledger. `standing` is present exactly where this page holds
 * the ledger's latest entry and that entry is a refusal, which is what standing
 * means and is why no entry carries it: a page that stops short of the latest
 * entry says nothing about what stands.
 */
export const ticketAgenticRefusalsResponseSchema = z.object({
  ticket: ticketNumberSchema,
  entries: z
    .array(agenticRefusalEntryResponseSchema)
    .max(agenticRefusalLedgerAnsweredMax),
  more: z.boolean(),
  standing: z
    .object({
      ticketVersion: countSchema,
      reason: z.string().min(1).max(agenticRefusalReasonCharsMax),
      recordedAt: instantSchema,
    })
    .optional(),
});
export type TicketAgenticRefusalsResponse = z.infer<
  typeof ticketAgenticRefusalsResponseSchema
>;

/** One standing refusal across a project, with the ticket as its identity. */
export const agenticRefusalResponseSchema = z.object({
  ticket: ticketNumberSchema,
  ticketVersion: countSchema,
  reason: z.string().min(1).max(agenticRefusalReasonCharsMax),
  decision: identitySchema,
  recordedAt: instantSchema,
  /** Whether the ticket has been authored again since the refusal was made. */
  superseded: z.boolean(),
});
export type AgenticRefusalResponse = z.infer<
  typeof agenticRefusalResponseSchema
>;

export const agenticRefusalsResponseSchema = z.object({
  refusals: z
    .array(agenticRefusalResponseSchema)
    .max(agenticRefusalsAnsweredMax),
  more: z.boolean(),
});
export type AgenticRefusalsResponse = z.infer<
  typeof agenticRefusalsResponseSchema
>;

/**
 * What a pod measured of one turn and which batches it wrote, on a lead's turn
 * and a member's alike. It is one shape rather than two copies, because a turn
 * is measured the same way whatever kind of session took it.
 */
const sessionTurnMeasureShape = {
  model: z.string().min(1).max(sessionTurnModelCharsMax).optional(),
  tokens: countSchema.optional(),
  costMicros: countSchema.optional(),
  durationMs: countSchema.optional(),
  tools: z
    .array(z.string().min(1).max(sessionTurnToolNameCharsMax))
    .max(sessionTurnToolsMax)
    .optional(),
  batchFirst: countSchema.optional(),
  batchLast: countSchema.optional(),
};

/**
 * One turn of the lead's mailbox and what the pod measured of it. The turn's
 * input is absent: it is the observation document, the decision log already
 * holds it, and shipping it twice would double the page for nothing.
 */
export const leadTurnResponseSchema = z.object({
  turn: identitySchema,
  ordinal: countSchema,
  inputKind: z.enum(sessionTurnInputKinds),
  state: z.enum(sessionTurnStates),
  decision: identitySchema.optional(),
  failure: z.enum(sessionTurnFailures).optional(),
  ...sessionTurnMeasureShape,
});
export type LeadTurnResponse = z.infer<typeof leadTurnResponseSchema>;

/** One stream a session's store holds, and how many batches stand under it. */
export const leadStoreStreamResponseSchema = z.object({
  stream: z.string().min(1).max(sessionStoreStreamCharsMax),
  batches: countSchema,
});

/** The project's lead session: what it is, what it decided under, and its mailbox tail. */
export const leadResponseSchema = z.object({
  session: identitySchema,
  state: z.enum(sessionStates),
  attention: z.enum(selectorAttentions),
  agentReference: identitySchema.optional(),
  notificationCursor: countSchema,
  handoffNote: handoffNotePreviewSchema,
  turns: z.array(leadTurnResponseSchema).max(leadTurnsAnsweredMax),
  streams: z
    .array(leadStoreStreamResponseSchema)
    .max(sessionStoreStreamsAnswered),
});
export type LeadResponse = z.infer<typeof leadResponseSchema>;

/** One entry of a session's transcript, parsed no further than a reader draws it. */
export const leadTranscriptEntryResponseSchema = z.object({
  uuid: identitySchema.optional(),
  type: identitySchema,
  timestamp: instantSchema.optional(),
  message: z.unknown(),
});

/**
 * The chain over the batches read, with `held` naming the entries of this page
 * the lead still holds, decided by the last compaction in the whole stream and
 * absent only where that walk could not reach the stream's end. An elided batch
 * is one whose row exists and whose object cannot be drawn, which is what a run
 * that died leaves behind.
 */
export const leadTranscriptResponseSchema = z.object({
  stream: z.string().min(1).max(sessionStoreStreamCharsMax),
  entries: z
    .array(leadTranscriptEntryResponseSchema)
    .max(sessionTranscriptEntriesMax),
  held: z.array(identitySchema).max(sessionTranscriptEntriesMax).optional(),
  /**
   * The batch the stream's last cut fell in, beside the `held` it decided and
   * absent where the stream has never compacted. A reader that sees a `cut` it
   * has not seen before has been paging across a compaction, and every held set
   * it holds is stale.
   */
  cut: countSchema.optional(),
  /** The last cut among the entries sent, which need not be the one `held` was decided by. */
  compaction: z
    .object({ boundary: identitySchema, at: instantSchema.optional() })
    .optional(),
  elided: countSchema,
  /** Whether this page falls short: its entries were cut, or `held` is undecided. */
  truncated: z.boolean(),
  nextAfter: countSchema.optional(),
});
export type LeadTranscriptResponse = z.infer<
  typeof leadTranscriptResponseSchema
>;

/** What one decision did, which is what the decision log draws and not what it saw. */
export const selectorDecisionResponseSchema = z.object({
  ordinal: countSchema,
  decision: identitySchema,
  instructionsVersion: identitySchema,
  dispatched: z.array(ticketNumberSchema).max(nativeHttpPageItemsMax),
  refused: z.array(ticketNumberSchema).max(nativeHttpPageItemsMax),
  lifted: z.array(ticketNumberSchema).max(nativeHttpPageItemsMax),
  attention: z.enum(selectorAttentions).optional(),
  outcome: identitySchema.optional(),
  modelRevision: identitySchema,
  policyRevision: identitySchema,
  tokens: countSchema.optional(),
  costMicros: countSchema.optional(),
  durationMs: countSchema.optional(),
  startedAt: instantSchema,
  completedAt: instantSchema,
});
export type SelectorDecisionResponse = z.infer<
  typeof selectorDecisionResponseSchema
>;

export const selectorHistoryResponseSchema = z.object({
  decisions: z
    .array(selectorDecisionResponseSchema)
    .max(selectorHistoryLimitMax),
  nextAfter: countSchema.optional(),
});
export type SelectorHistoryResponse = z.infer<
  typeof selectorHistoryResponseSchema
>;

/**
 * One member thread as a listing names it, `owner` being the membership's own
 * authority subject and absent where that membership has been revoked — a
 * thread its owner must still see and close rather than one to hide. `mine` is
 * computed against the request's own principal, which is what lets a browser
 * name "my thread" without ever decoding a token.
 */
export const threadEntryResponseSchema = z.object({
  session: identitySchema,
  owner: identitySchema.optional(),
  state: z.enum(sessionStates),
  mine: z.boolean(),
  turns: countSchema,
  agentReference: identitySchema.optional(),
});
export type ThreadEntryResponse = z.infer<typeof threadEntryResponseSchema>;

export const threadsResponseSchema = z.object({
  threads: z.array(threadEntryResponseSchema).max(threadsAnsweredMax),
});
export type ThreadsResponse = z.infer<typeof threadsResponseSchema>;

/**
 * One turn of a thread's mailbox, carrying its `input` and its `result` where
 * `leadTurnResponseSchema` carries neither: a lead's are the observation and
 * the decision its log already holds, and a member's are what they typed and
 * the answer they are waiting for. Each is bounded by the column that holds it.
 */
export const threadTurnResponseSchema = z.object({
  turn: identitySchema,
  ordinal: countSchema,
  inputKind: z.enum(sessionTurnInputKinds),
  state: z.enum(sessionTurnStates),
  input: z.string().max(threadMessageCharsMax + threadSeedingCharsMax),
  result: z.string().max(sessionTurnResultCharsMax).optional(),
  failure: z.enum(sessionTurnFailures).optional(),
  ...sessionTurnMeasureShape,
});
export type ThreadTurnResponse = z.infer<typeof threadTurnResponseSchema>;

/**
 * One member thread: what it is, whose it is, and its mailbox tail. It is its
 * own shape rather than the lead's reused, because `attention` and
 * `notificationCursor` are facts about the project's selector state and neither
 * is a fact about a thread.
 */
export const threadResponseSchema = z.object({
  session: identitySchema,
  owner: identitySchema.optional(),
  state: z.enum(sessionStates),
  mine: z.boolean(),
  agentReference: identitySchema.optional(),
  turns: z.array(threadTurnResponseSchema).max(threadTurnsAnsweredMax),
  streams: z
    .array(leadStoreStreamResponseSchema)
    .max(sessionStoreStreamsAnswered),
});
export type ThreadResponse = z.infer<typeof threadResponseSchema>;

/**
 * A thread's transcript is the lead's page over a different session: the same
 * walk, over the same store, answering the same chain. It is aliased rather
 * than forked so the two cannot drift; the rename that makes the name
 * session-keyed rather than lead-keyed belongs with the walk it renames.
 */
export const threadTranscriptResponseSchema = leadTranscriptResponseSchema;
export type ThreadTranscriptResponse = LeadTranscriptResponse;

/** What the message door answers: the turn it took, and where it sits in the mailbox. */
export const threadMessageAcceptedSchema = z.object({
  turn: identitySchema,
  ordinal: countSchema,
});
export type ThreadMessageAccepted = z.infer<typeof threadMessageAcceptedSchema>;
/**
 * What the pod measured of the one turn an inquiry takes, reused from the
 * lead's own turn shape rather than respelled: a turn is measured the same way
 * whatever kind of session took it.
 */
const inquiryMeasureShape = leadTurnResponseSchema.pick({
  model: true,
  tokens: true,
  costMicros: true,
  durationMs: true,
}).shape;

/**
 * One inquiry against the project's lead, carrying its `question` and its
 * `answer` where `leadTurnResponseSchema` carries neither: a lead's input is
 * the observation its decision log already holds, and an inquiry's is what the
 * member typed and the answer they are waiting for.
 */
export const leadInquiryResponseSchema = z.object({
  session: identitySchema,
  asker: identitySchema,
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

/** A lead's inquiries, newest first, because one is read right after it is asked. */
export const leadInquiriesResponseSchema = z.object({
  inquiries: z.array(leadInquiryResponseSchema).max(inquiriesAnsweredMax),
});
export type LeadInquiriesResponse = z.infer<typeof leadInquiriesResponseSchema>;

/** What the ask door answers: the fork it opened, its one turn, and where that turn sits. */
export const leadInquiryAcceptedSchema = z.object({
  session: identitySchema,
  turn: identitySchema,
  ordinal: countSchema,
});
export type LeadInquiryAccepted = z.infer<typeof leadInquiryAcceptedSchema>;
