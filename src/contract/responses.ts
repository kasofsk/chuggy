/**
 * Every public response body, as a schema a browser can run over `unknown`.
 *
 * A representation the server assembles by hand is parsed leniently — the
 * named fields are guaranteed and anything further is dropped — while the
 * shapes the server itself pins before sending are strict here too, because
 * those are the ones a missing field would be a server fault in.
 */

import {
  approvalApproversSchema,
  approvalWorkloadSchema,
  configurationFollowingSchema,
  configurationReferencePathSchema,
  configurationRequirementCapabilitiesMax,
} from "./configurationDocument.ts";
import { configurationSelectionSchema } from "./configurationSelection.ts";
import {
  epicRevisionFields,
  epicTicketsMax,
  epicVisibilitySchema,
} from "./epics.ts";
import { z } from "zod";

import {
  agentAccountCredentialsMax,
  imageMediaTypes,
  projectArtifactEncoding,
  agentSessionPromptCharsMax,
  countSchema,
  cursorSchema,
  forgeAuthorizationAccountsAnsweredMax,
  forgeInstallationsAnsweredMax,
  proposalForgeFailureCharsMax,
  proposalForgeMessageCharsMax,
  proposalMergeStateCharsMax,
  proposalQueueWordCharsMax,
  forgeRepositoriesAnsweredMax,
  projectRepositoriesAnsweredMax,
  repositoryConfigurationImportRefusalsKeptMax,
  repositoryConfigurationIgnoredAnsweredMax,
  digestSchema,
  dispatchViewSchemaVersion,
  identitySchema,
  instantSchema,
  isBoundedText,
  nativeHttpDraftDependenciesMax,
  nativeHttpPageItemsMax,
  partitionSchema,
  personalRunnerHeldAnsweredMax,
  personalRunnerProjectsMax,
  personalRunnersMax,
  personalRunnerWaitingCountedMax,
  resultReportCharsMax,
  approvalFeedbackCharsMax,
  principalCharsMax,
  runContextItemsMax,
  runContextNameCharsMax,
  runContextPageReadingsMax,
  runContextPathCharsMax,
  runContextReadingsMax,
  runModelCharsMax,
  runOutcomeLabelCharsMax,
  runToolUseIdCharsMax,
  runTranscriptPageBatchesMax,
  runTurnSeriesMax,
  sessionContextPageTurnsMax,
  sessionStoreStreamCharsMax,
  sessionStoreStreamsAnswered,
  sessionTranscriptEntriesMax,
  sessionTurnContextReadingsMax,
  sessionTurnModelCharsMax,
  sessionTurnResultCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
  threadTitleCharsMax,
  threadTurnRecordedCharsMax,
  threadTurnsAnsweredMax,
  threadsAnsweredMax,
  ticketLandingsAnsweredMax,
  ticketLandingStackDepthMax,
  ticketLandingStacksAnsweredMax,
  ticketNumberSchema,
  landingQueueHolderSinceDigits,
  landingQueueTicketsAnsweredMax,
  workerRunCredentialSchema,
} from "./http.ts";
import { actionReportDocumentSchema } from "./actionReport.ts";
import { authoringResponseSchema, programStageSchema } from "./authoring.ts";
import {
  briefBranchSchema,
  briefFinalizationResponseSchema,
  briefRepositorySchema,
  briefResponseSchema,
  briefTitleCharsMax,
} from "./brief.ts";
import { configurationOverridesSchema } from "./configurationOverrides.ts";
import {
  workerPoolCapabilitiesSchema,
  workerPoolCapabilitySchema,
  workerPoolEvidenceCharsMax,
  workerRunnerSchema,
  workerRunnerVersionSchema,
} from "./workerPool.ts";
import {
  agentAccountSettingsSchema,
  projectDisplayNameCharsMax,
  repositoryFinalizationSchema,
  repositoryLandingSchema,
  selectorProjectOverridesSchema,
} from "./requests.ts";
import {
  accountAgents,
  agentPauseReasons,
  architectures,
  artifactRoles,
  attemptEvidences,
  attemptStates,
  blockedReasons,
  briefingCarriers,
  changeProposalCreations,
  changeProposalMergeabilities,
  changeProposalMergeReasons,
  changeProposalMergeWaits,
  changeProposalStatuses,
  changeProposalMergeOutcomes,
  changeProposalMerges,
  draftLandingSources,
  draftReleaseRefusalCodes,
  draftStates,
  escalationKinds,
  executionOutcomes,
  executionStatuses,
  executionTaskKinds,
  finalizationAttemptOutcomes,
  finalizationFailureKinds,
  finalizationRecheckReasons,
  evaluationUnstackedReasons,
  finalizationUnavailableKinds,
  gitEvidences,
  nativeActionKindResolutions,
  nativeActionKinds,
  nativeActionResolutions,
  nativeActionStates,
  notificationKinds,
  type NativeActionKind,
  type NativeActionResolution,
  operatingSystems,
  operationBoundaryRefusalCodes,
  type OperationTicketRefusalCode,
  operationStates,
  outputContentEncodings,
  outputRenderers,
  personalRunnerWaits,
  personalRunnerPriorities,
  phaseRoster,
  placementRouteSources,
  leadOfferings,
  placementRoutes,
  repositoryConfigurationFaults,
  requirementSources,
  resultVerdicts,
  resumePoints,
  runCompactionTriggers,
  runContextCategoryKinds,
  runCostBases,
  runStepEvidences,
  runUsageWindows,
  schedulerFreshnesses,
  sessionCapabilities,
  sessionRunnerStandings,
  sessionScopes,
  projectLifecycles,
  sessionTurnFailures,
  sessionTurnInputKinds,
  sessionTurnStates,
  threadStandings,
  threadTurnStops,
  ticketLandingStates,
  forgeAccountKinds,
  forgeAccountProofs,
  forgeAppClaims,
  forgeInstallationPermissions,
  forgeRepositorySelections,
  forgeApps,
  projectRepositoryConfigurationDeferrals,
  repositoryConfigurationImportAbsences,
  repositoryConfigurationImportResults,
  workerHeldCredentialAbsences,
  ticketTakeOutcomes,
  proposalMergeRefusals,
} from "./rosters.ts";
import { accessProjectRoles } from "./accessPlane.ts";
import {
  themeChoiceSchema,
  themeDocumentSchema,
  themeLayers,
  themeNumberSchema,
  themesOwnedMax,
} from "./appearance.ts";

const page = <T extends z.ZodType>(item: T) =>
  z.array(item).max(nativeHttpPageItemsMax);

/** The partition inside a hand-assembled representation, which drops rather
 * than refuses. */
const partitionValueSchema = partitionSchema.strip();

export const installationResponseSchema = z.object({
  installation: identitySchema,
});
export type InstallationResponse = z.infer<typeof installationResponseSchema>;

/** A project as it is listed and created: the partition that addresses it, and what it is called. */
export const namedProjectSchema = z.strictObject({
  ...partitionSchema.shape,
  name: z.string().min(1).max(projectDisplayNameCharsMax),
});
export type NamedProject = z.infer<typeof namedProjectSchema>;

/** A project as the inventory lists it: named, and the artifact it names its icon where it names one. */
export const inventoryProjectSchema = z.strictObject({
  ...namedProjectSchema.shape,
  icon: identitySchema.optional(),
});
export type InventoryProject = z.infer<typeof inventoryProjectSchema>;

export const projectInventoryResponseSchema = z.strictObject({
  projects: page(inventoryProjectSchema),
  nextCursor: z.string().optional(),
});
export type ProjectInventoryResponse = z.infer<
  typeof projectInventoryResponseSchema
>;

/** A project created, or the one the same request already created, named as its creation named it. */
export const projectCreatedSchema = namedProjectSchema;
export type ProjectCreatedResponse = z.infer<typeof projectCreatedSchema>;

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
  credential: workerRunCredentialSchema.optional(),
});
export type RunTotals = z.infer<typeof runTotalsSchema>;

/** The tool-use id of the subagent call a turn was made under, which the main conversation's turns name none of. */
export const runToolUseIdSchema = z
  .string()
  .refine((value) => isBoundedText(value, runToolUseIdCharsMax));

/** One assistant turn's usage, folded so it outlives the transcript it came from. */
export const runTurnSchema = runTokensSchema.extend({
  ordinal: countSchema,
  model: z.string().min(1).max(runModelCharsMax),
  parentToolUseId: runToolUseIdSchema.optional(),
  recordedAt: instantSchema,
});

const runContextNameSchema = z
  .string()
  .refine((value) => isBoundedText(value, runContextNameCharsMax));

const runContextList = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.array(z.strictObject(shape)).max(runContextItemsMax);

const runContextNamedTokens = {
  name: runContextNameSchema,
  tokens: countSchema,
};

/**
 * What one run's context window held when it was read, as the agent runtime
 * breaks it down: the whole, each category, and what each list put in it.
 */
export const runContextWindowSchema = z.strictObject({
  model: z.string().min(1).max(runModelCharsMax),
  totalTokens: countSchema,
  maxTokens: countSchema,
  autoCompactThreshold: countSchema.optional(),
  categories: runContextList({
    ...runContextNamedTokens,
    kind: z.enum(runContextCategoryKinds),
  }),
  memoryFiles: runContextList({
    path: z
      .string()
      .refine((value) => isBoundedText(value, runContextPathCharsMax)),
    tokens: countSchema,
  }),
  mcpTools: runContextList({
    server: runContextNameSchema,
    ...runContextNamedTokens,
  }),
  systemTools: runContextList(runContextNamedTokens),
  systemPromptSections: runContextList(runContextNamedTokens),
  skills: z
    .strictObject({
      total: countSchema,
      included: countSchema,
      tokens: countSchema,
      items: runContextList(runContextNamedTokens),
    })
    .optional(),
  agents: runContextList({ type: runContextNameSchema, tokens: countSchema }),
  messages: z
    .strictObject({
      toolCalls: countSchema,
      toolResults: countSchema,
      attachments: countSchema,
      assistant: countSchema,
      user: countSchema,
      byTool: runContextList({
        name: runContextNameSchema,
        callTokens: countSchema,
        resultTokens: countSchema,
      }),
    })
    .optional(),
});
export type RunContextWindow = z.infer<typeof runContextWindowSchema>;

/** What set one compaction off, and how many tokens the window held before it and after it where the runtime said. */
export const runCompactionSchema = z.strictObject({
  trigger: z.enum(runCompactionTriggers),
  tokensBefore: countSchema,
  tokensAfter: countSchema.optional(),
});
export type RunCompaction = z.infer<typeof runCompactionSchema>;

/**
 * One reading of a run's context window, `shape` the fields its side of the
 * wire adds, and only a compaction's reading carrying the compaction's facts.
 */
export function runContextReadingSchemaOf<Shape extends z.ZodRawShape>(
  shape: Shape,
) {
  const reading = {
    ordinal: z.number().int().positive().max(runContextReadingsMax),
    afterTurn: z.number().int().nonnegative().max(runTurnSeriesMax),
    window: runContextWindowSchema.optional(),
    ...shape,
  };
  return z.discriminatedUnion("cause", [
    z.strictObject({
      ...reading,
      cause: z.literal("Compaction"),
      compaction: runCompactionSchema.optional(),
    }),
    z.strictObject({ ...reading, cause: z.enum(["Start", "End"]) }),
  ]);
}

/** A reading as a worker offers it, before the server dates it. */
export const runContextOfferedSchema = runContextReadingSchemaOf({});
export type RunContextOffered = z.infer<typeof runContextOfferedSchema>;

/** A reading as a reader is answered with it, dated by the server that stored it. */
export const runContextReadingSchema = runContextReadingSchemaOf({
  recordedAt: instantSchema,
});
export type RunContextReading = z.infer<typeof runContextReadingSchema>;

/**
 * One reading of a session's context window during one of its turns, `shape`
 * the fields its side of the wire adds: the window a run's reading holds, and
 * only a compaction's reading carrying the compaction's facts.
 */
export function sessionContextReadingSchemaOf<Shape extends z.ZodRawShape>(
  shape: Shape,
) {
  const reading = { window: runContextWindowSchema.optional(), ...shape };
  return z.discriminatedUnion("cause", [
    z.strictObject({
      ...reading,
      cause: z.literal("Compaction"),
      compaction: runCompactionSchema.optional(),
    }),
    z.strictObject({ ...reading, cause: z.literal("End") }),
  ]);
}

/** A session's reading as its pod offers it with a turn's answer, before the server dates it. */
export const sessionContextOfferedSchema = sessionContextReadingSchemaOf({});
export type SessionContextOffered = z.infer<typeof sessionContextOfferedSchema>;

/** A session's reading as a reader is answered with it, dated by the server that stored it. */
export const sessionContextReadingSchema = sessionContextReadingSchemaOf({
  recordedAt: instantSchema,
});
export type SessionContextReading = z.infer<typeof sessionContextReadingSchema>;

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
  readingsRecorded: countSchema.optional(),
  totals: runTotalsSchema.optional(),
});
export type ExecutionRun = z.infer<typeof executionRunSchema>;

/**
 * Until when an agent is paused, or `off` where only credentials its owner
 * turned off hold it and it never ends by itself, exactly one of the two
 * present, and each reason holding it, as `agent_account_pause` answers it of
 * an account, or `agent_account_named_pause` of the credentials a runner named;
 * `pressed` is whether a press of the account's owner still lets one claim
 * through the limit.
 */
export const agentPauseSchema = z
  .strictObject({
    until: instantSchema.optional(),
    off: z.literal(true).optional(),
    reasons: z
      .array(z.enum(agentPauseReasons))
      .min(1)
      .max(agentPauseReasons.length),
    pressed: z.boolean(),
  })
  .refine(
    (pause) => (pause.until === undefined) !== (pause.off === undefined),
    {
      message: "a pause names exactly one of until and off",
    },
  );
export type AgentPause = z.infer<typeof agentPauseSchema>;

/** A runner a job ran on: a pool, by the name it had, or a member's own runner by the member it is. */
export const runnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("Pool"), pool: identitySchema }),
  z.strictObject({ kind: z.literal("Personal"), owner: identitySchema }),
]);
export type Runner = z.infer<typeof runnerSchema>;

/**
 * The job a parked ticket waits on where every task it waits on was lost on
 * the runner that claimed it: the runner, the newest such attempt, how it
 * ended and the size of the text its worker kept, which is read on that
 * attempt's own route, how many times the job was lost where it stands in the
 * ticket, and how many of those losses the scheduler resumed by itself.
 */
export const runnerLossSchema = z.strictObject({
  runner: runnerSchema,
  execution: identitySchema,
  attempt: identitySchema,
  evidence: z.enum(attemptEvidences),
  error: z.object({ bytes: countSchema }).optional(),
  losses: countSchema,
  resumed: countSchema,
});
export type RunnerLoss = z.infer<typeof runnerLossSchema>;

/**
 * The task a parked ticket waits on where its run stopped at a failed step:
 * the step, the attempt it stopped on, the size of the text its worker kept,
 * which is read on that attempt's own route, and, with `RunCredentialAbsent`
 * and no other step, the credential its job lists that was not delivered and
 * why.
 */
export const runStepFailureSchema = z
  .strictObject({
    evidence: z.enum(runStepEvidences),
    execution: identitySchema,
    attempt: identitySchema,
    error: z.object({ bytes: countSchema }).optional(),
    absent: z
      .strictObject({
        credential: identitySchema,
        reason: z.enum(workerHeldCredentialAbsences),
      })
      .optional(),
  })
  .refine(
    (failed) =>
      (failed.evidence === "RunCredentialAbsent") ===
      (failed.absent !== undefined),
  );
export type RunStepFailure = z.infer<typeof runStepFailureSchema>;

/**
 * Where a parked ticket stands: which wall parked it, what the fabric said
 * about that wall, and where a resume would re-enter it — present exactly when
 * the ticket is Escalated, which is why it is one object rather than three
 * optional fields a reader has to check against each other. The evidence is
 * absent where the escalation explains itself, and is drawn from three disjoint
 * rosters no ticket is at two of at once; `resumeAt` is derived from the kind
 * at the read and stored nowhere.
 */
export const ticketEscalationSchema = z.object({
  kind: z.enum(escalationKinds),
  evidence: z
    .union([
      z.enum(blockedReasons),
      z.enum(gitEvidences),
      z.enum(finalizationUnavailableKinds),
    ])
    .optional(),
  resumeAt: z.enum(resumePoints),
  /** Present where the wall is a job lost on its runner rather than one that failed. */
  lost: runnerLossSchema.optional(),
  /** Present where the wall is a task whose run stopped at a failed step. */
  failed: runStepFailureSchema.optional(),
  /**
   * Present where usage pauses hold its rate-limited tasks: `until` the latest
   * of them, which the scheduler resumes it by itself at, or `off` where a task
   * waits only on credentials its owner turned off, which it never resumes by
   * itself while they stay off. Both absent means none holds any longer.
   */
  usageResume: z
    .strictObject({
      until: instantSchema.optional(),
      off: z.literal(true).optional(),
    })
    .refine(
      (resume) => resume.until === undefined || resume.off === undefined,
      {
        message: "a usage resume names at most one of until and off",
      },
    )
    .optional(),
});
export type TicketEscalation = z.infer<typeof ticketEscalationSchema>;

/**
 * A repository-imported configuration's label. Absent means no label is known,
 * which is what an authored revision carries.
 */
export const configurationVersionSchema = z.strictObject({
  name: identitySchema,
  number: ticketNumberSchema,
});

/** An epic as a ticket names it. */
export const ticketEpicSchema = z.strictObject({
  number: ticketNumberSchema,
  title: z.string(),
  visibility: epicVisibilitySchema,
});

/**
 * Whether a Pending ticket following its configuration's newest revision
 * would move to the revision its repository's newest import declares under the
 * same name, as the importer decides it. `Moves` is judged against the released
 * ticket, though a person's unreleased revision of its draft still stops the
 * move; `Held` carries the code a release would be refused with, and `Trimmed`
 * is a program running less than its plan.
 */
export const ticketFollowingSchema = z.discriminatedUnion("verdict", [
  z.strictObject({ verdict: z.literal("Current") }),
  z.strictObject({ verdict: z.literal("Moves") }),
  z.strictObject({
    verdict: z.literal("Held"),
    code: z.enum(draftReleaseRefusalCodes),
  }),
  z.strictObject({ verdict: z.literal("Trimmed") }),
]);
export type TicketFollowing = z.infer<typeof ticketFollowingSchema>;

/**
 * A ticket as the project table and its own read both carry it. The table
 * carries the brief's title, because a table of documents needs a heading, and
 * its repository, because a project spans several; the rest of the brief is
 * the ticket's own read alone, an intent being a paragraph and a page of them
 * a page of documents.
 */
export const ticketResponseSchema = z.object({
  ticket: ticketNumberSchema,
  /**
   * What this ticket is called: the title its brief names, or the first line
   * of its intent where the brief named none.
   */
  title: z.string().max(briefTitleCharsMax).optional(),
  /** The repository the released brief names, absent where that brief names none. */
  repository: briefRepositorySchema.optional(),
  /** Which revision of its definition the ticket is at, which an update names as the one it expects. */
  revision: ticketNumberSchema,
  /**
   * The authority subject of the member who filed the ticket, which is who
   * its first authoring revision was written under. It is absent where that
   * revision carries no member's authority.
   */
  creator: identitySchema.optional(),
  /**
   * The member the ticket's next execution is placed for, encoded as
   * `creator` is: the member who took it, else its creator. It is absent
   * where neither is a member.
   */
  owner: identitySchema.optional(),
  phase: z.enum(phaseRoster),
  sequence: countSchema,
  /**
   * When the entry `sequence` names committed, which is when the ticket entered
   * the phase and the escalation reported here. Nothing moves a Done or Revoked ticket
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
  escalation: ticketEscalationSchema.optional(),
  /**
   * Which of this ticket's dependencies their own authors revoked, ascending.
   * It is empty for every ticket but a Pending one waiting on such a
   * dependency: nothing ever completes that dependency, so the wait ends only
   * when an update drops it or this ticket is revoked too.
   */
  revokedDependencies: page(ticketNumberSchema),
  /**
   * Which of this ticket's dependencies are neither Done nor Revoked, each
   * with the phase it is at, ascending: the wait that can still end, where
   * `revokedDependencies` is the wait that cannot, so the two never name one
   * dependency. Only a Pending ticket carries any, because a ticket in any
   * other phase had every dependency Done before it was dispatched.
   */
  openDependencies: page(
    z.strictObject({ ticket: ticketNumberSchema, phase: z.enum(phaseRoster) }),
  ),
  brief: briefResponseSchema.optional(),
  /**
   * The configuration the ticket's last release or update pinned, which is
   * what it runs under. Like the brief, only the ticket's own read carries it.
   */
  configurationRevision: identitySchema.optional(),
  configurationVersion: configurationVersionSchema.optional(),
  /**
   * What the ticket overrides of that configuration: what its last release or
   * update replaced, or what it took since while escalated, and absent where
   * it overrides nothing. Only the ticket's own read carries it.
   */
  overrides: configurationOverridesSchema.optional(),
  /**
   * What the ticket selected of that configuration's catalog at its last
   * release or update, absent where it took every default. Only the ticket's
   * own read carries it.
   */
  selection: configurationSelectionSchema.optional(),
  /**
   * The evaluation program the ticket's last release or update was resolved
   * from, which its draft may since have been revised past. Only the ticket's
   * own read carries it, and only where a draft revision records it.
   */
  program: authoringResponseSchema.shape.program.optional(),
  /**
   * The dependencies that same release or update named, ascending, which its
   * draft may since have been revised past. Only the ticket's own read carries
   * it, and only where a draft revision records it.
   */
  dependencies: page(ticketNumberSchema).optional(),
  /**
   * Where the ticket stands against its configuration's newest revision, as of
   * the newest import of the repository it holds one from. Only the ticket's
   * own read carries it, and only for a Pending ticket that follows and whose
   * repository's newest import declares that revision's name.
   */
  following: ticketFollowingSchema.optional(),
  runTotals: runTotalsSchema.optional(),
  /** The epics the ticket belongs to, archived ones included, at most a page of the lowest-numbered, in epic order, and absent where it belongs to none. */
  epics: page(ticketEpicSchema).optional(),
});
export type TicketResponse = z.infer<typeof ticketResponseSchema>;

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
  approval: z
    .strictObject({
      execution: identitySchema,
      workCycle: ticketNumberSchema,
      stage: ticketNumberSchema.describe(
        "The stage's positive key, as a task identity names it.",
      ),
      generation: ticketNumberSchema,
      evaluator: ticketNumberSchema,
      instructions: approvalWorkloadSchema.shape.instructions,
      approvers: approvalApproversSchema,
    })
    .optional()
    .describe(
      "What an EvaluationApproval asks, present on that kind alone: the execution it stands for, which reads Awaiting until it is answered or no longer owed, where that execution stands in the ticket's evaluation, and its workload's instructions and approvers as the ticket was released with them.",
    ),
  answerable: z
    .boolean()
    .describe(
      "Whether the caller of this read may answer this action: for an EvaluationApproval, whether its approvers name them and they are a person rather than an agent or a session.",
    ),
};

function nativeActionKindAdmits(
  kind: NativeActionKind,
): readonly NativeActionResolution[] {
  return nativeActionKindResolutions[kind];
}

const nativeActionAdmitsItsKind = (value: {
  readonly kind: NativeActionKind;
  readonly admits: readonly NativeActionResolution[];
  readonly approval?: unknown;
}) =>
  value.admits.every((resolution) =>
    nativeActionKindAdmits(value.kind).includes(resolution),
  ) && (value.kind === "EvaluationApproval") === (value.approval !== undefined);

const nativeActionPairing =
  "a native action admits an answer its kind does not ask for, or asks what only an EvaluationApproval asks";

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

/**
 * One action a ticket has had, in whatever state it stands: its resolution
 * where it was answered, the execution an EvaluationApproval asked about, and
 * who answered it and when where that is recorded, which is on an answered
 * EvaluationApproval alone.
 */
export const nativeActionRecordResponseSchema = z
  .strictObject({
    action: identitySchema,
    kind: z.enum(nativeActionKinds),
    authorizingSequence: countSchema,
    state: z.enum(nativeActionStates),
    resolution: z.enum(nativeActionResolutions).optional(),
    execution: identitySchema.optional(),
    answeredBy: z.string().min(1).max(principalCharsMax).optional(),
    answeredAt: instantSchema.optional(),
  })
  .refine(
    (value) =>
      (value.state === "Resolved") === (value.resolution !== undefined) &&
      (value.resolution === undefined ||
        nativeActionKindResolutions[value.kind].some(
          (resolution) => resolution === value.resolution,
        )) &&
      (value.answeredBy === undefined) === (value.answeredAt === undefined) &&
      (value.answeredBy === undefined || value.state === "Resolved"),
    "a native action's resolution, or who answered it, disagrees with its state or its kind",
  );
export type NativeActionRecordResponse = z.infer<
  typeof nativeActionRecordResponseSchema
>;

/** Every action a ticket has had, open and settled, oldest fence first, one bounded page at a time. */
export const ticketNativeActionHistoryResponseSchema = z.object({
  actions: page(nativeActionRecordResponseSchema),
  nextCursor: cursorSchema.optional(),
});
export type TicketNativeActionHistoryResponse = z.infer<
  typeof ticketNativeActionHistoryResponseSchema
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
 * What a project's threads run under: its North Star where it set one, and the
 * standing rules, which are the project's own or the default.
 */
export const selectorEffectiveSettingsResponseSchema = z.strictObject({
  northStar: z.string().min(1).optional(),
  threadStandingRules: z.string().min(1),
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

/** Who a settings revision is recorded against, as the authorization named them. */
const selectorAdministratorResponseSchema = z.strictObject({
  kind: identitySchema,
  subject: identitySchema,
});

export const selectorSettingsRevisionResponseSchema = z.strictObject({
  revision: countSchema,
  overrides: selectorProjectOverridesSchema,
  administrator: selectorAdministratorResponseSchema,
  recordedAt: instantSchema,
});

/**
 * What a write that lost the revision fence answers with beside its error code:
 * the settings standing in its place, and who moved them. `movedBy` is absent
 * only where the standing revision is zero, which nobody wrote.
 */
export const selectorSettingsConflictResponseSchema = z.object({
  settings: selectorProjectSettingsResponseSchema,
  movedBy: z
    .strictObject({
      administrator: selectorAdministratorResponseSchema,
      recordedAt: instantSchema,
    })
    .optional(),
});
export type SelectorSettingsConflictResponse = z.infer<
  typeof selectorSettingsConflictResponseSchema
>;

export const selectorSettingsHistoryResponseSchema = z.strictObject({
  revisions: page(selectorSettingsRevisionResponseSchema),
});
export type SelectorSettingsHistoryResponse = z.infer<
  typeof selectorSettingsHistoryResponseSchema
>;

/**
 * What a task was required to run on, as the scheduler materialized it: an
 * exact image, or the capabilities a runner must meet. The arms are strict because the interpreter refuses a requirement
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
    mode: z.literal("Capability"),
    operatingSystem: z.enum(operatingSystems),
    architecture: z.enum(architectures),
    capabilities: z
      .array(workerPoolCapabilitySchema)
      .min(1)
      .max(configurationRequirementCapabilitiesMax),
  }),
]);

/**
 * The label the catalog holds for an offered image. It sits beside the
 * requirement rather than inside it, because the requirement is the digested
 * value and a label is not part of what an execution is.
 */
export const workerSchema = z.strictObject({
  name: identitySchema,
  version: identitySchema,
});

/**
 * What a task IS, as the model's own codec spells it: the constructor under
 * `type` and its record under `value`, with each arm's work cycle under the
 * name that arm gives it. `src/contract/` reaches neither the model's mirror
 * nor the layers that own it, so the sum is written again here and
 * `test/contract/rosters.test.ts` holds this copy to that one.
 */
export const taskIdentitySchema = z.union([
  z.object({
    type: z.literal("WorkTask"),
    value: z.object({ ticket: ticketNumberSchema, cycle: ticketNumberSchema }),
  }),
  z.object({
    type: z.literal("EvaluationTask"),
    value: z.object({
      ticket: ticketNumberSchema,
      workCycle: ticketNumberSchema,
      stage: ticketNumberSchema,
      generation: ticketNumberSchema,
      evaluator: ticketNumberSchema,
    }),
  }),
]);
export type TaskIdentity = z.infer<typeof taskIdentitySchema>;

export const executionSummarySchema = z.object({
  execution: identitySchema,
  ticket: ticketNumberSchema,
  /**
   * The wire's name for the task this execution runs, which is what the page
   * orders by and what the cursor is a position in. `identity` beside it is
   * what the task is; neither is derivable from the other.
   */
  task: countSchema,
  taskKind: z.enum(executionTaskKinds),
  identity: taskIdentitySchema,
  cluster: identitySchema,
  configurationRevision: identitySchema,
  configurationVersion: configurationVersionSchema.optional(),
  requirementIdentity: identitySchema,
  /**
   * What a runner must offer to take it. This, its digest, its source and
   * `platformDefaultVersion` are absent together, and only for an approval
   * evaluator's execution, which a person answers and no runner takes.
   */
  requirement: executionRequirementSchema.optional(),
  requirementDigest: digestSchema.optional(),
  requirementSource: z.enum(requirementSources).optional(),
  /**
   * The spawn request that made this execution, which is its spawn set's
   * identity. Optional for the deployment window and not because a summary can
   * lack one: the console is its own artifact, so a bundle that already reads
   * this field can reach a server not yet sending it, and a required field
   * would fail the whole page rather than one cell.
   */
  request: identitySchema.optional(),
  worker: workerSchema.optional(),
  platformDefaultVersion: ticketNumberSchema.optional(),
  /**
   * The CPUs, in millis, and the memory, in MiB, its task was released with.
   * A field absent is the deployment's own size, which this read cannot see.
   */
  resources: z
    .object({
      cpuMillis: countSchema.optional(),
      memoryMib: countSchema.optional(),
    })
    .optional(),
  /**
   * `Running` once the open attempt's run has started, though a runner's
   * placement stores it `Launching` until it ends. `Awaiting` is an approval
   * evaluator's execution waiting on a person, which no runner takes and no
   * slot is held for until it is answered or `Cancelled`; the open
   * `EvaluationApproval` action naming it is what that person answers.
   */
  status: z.enum(executionStatuses),
  outcome: z.enum(executionOutcomes).optional(),
  retriesSpent: countSchema,
  /**
   * How many times the fabric opened another attempt after losing one, which
   * `retriesSpent` is not: a loss spends a retry whether or not anything
   * followed it. Optional for the deployment window, as `request` is.
   */
  relaunches: countSchema.optional(),
  registeredAt: instantSchema,
  /**
   * When this execution's first attempt opened, absent while it has none: the
   * instant that attempt carries in the detail read, which is before anything
   * takes it and so is not where a wait ends.
   */
  startedAt: instantSchema.optional(),
  /**
   * When something first took one of its attempts to run, absent while nothing
   * has: a runner's claim, or an opening in cluster or of an attempt that ended
   * unclaimed with its run recorded. Its wait runs from `registeredAt` to here.
   */
  takenAt: instantSchema.optional(),
  /**
   * When the worker of the attempt now open recorded its run, absent until it
   * does: an attempt opens before its worker's image is pulled.
   */
  runStartedAt: instantSchema.optional(),
  /**
   * What carries out this execution's stage, absent for a revision no briefing
   * can read and for the deployment window. A command list records its run
   * only as it ends, so `runStartedAt` marks a start only under an agent.
   */
  carrier: z.enum(briefingCarriers).optional(),
  terminalAt: instantSchema.optional(),
  runTotals: runTotalsSchema.optional(),
  /**
   * Whether the reader is the member who owns it, computed against the
   * request's own principal. Optional for the deployment window, as `request`
   * is.
   */
  mine: z.boolean().optional(),
  /**
   * What the reader's own execution, its attempt waiting unclaimed, waits on of
   * their runners, absent where nothing of theirs holds it. Optional for the
   * deployment window.
   */
  personalRunnerWait: z.enum(personalRunnerWaits).optional(),
  /**
   * The pause that ends first of those holding every `Live` runner it waits
   * on, each runner's by the credentials it named, present only where every
   * one of them is held.
   */
  paused: agentPauseSchema.optional(),
  /**
   * The largest memory room, in MiB, of the `Live` runners it waits on and the
   * memory it needs, present only where every one of them named a room above
   * nothing and below that, and none is paused.
   */
  personalRunnerRoom: z
    .strictObject({ freeMib: countSchema, neededMib: countSchema })
    .optional(),
  /**
   * The earlier execution of the same ticket whose passing verdict settled
   * this one, its task and the work cycle it ran in, present only on an
   * execution settled that way rather than run: its one attempt is `Carried`,
   * and never placed or ran.
   */
  carriedFrom: z
    .strictObject({
      execution: identitySchema,
      task: countSchema,
      workCycle: ticketNumberSchema,
    })
    .optional(),
});
export type ExecutionSummary = z.infer<typeof executionSummarySchema>;

/**
 * What a row of the tickets list draws of its ticket's latest execution, the
 * one `latest=true` answers for it: how it stands, what it runs on, and when.
 */
export const ticketLatestExecutionSchema = executionSummarySchema.pick({
  execution: true,
  task: true,
  identity: true,
  status: true,
  outcome: true,
  carrier: true,
  runStartedAt: true,
  requirement: true,
  worker: true,
  registeredAt: true,
  terminalAt: true,
});
export type TicketLatestExecution = z.infer<typeof ticketLatestExecutionSchema>;

/** A row of the tickets list: the ticket, and its latest execution where one has run. */
export const projectTicketSchema = ticketResponseSchema.extend({
  latestExecution: ticketLatestExecutionSchema.optional(),
});
export type ProjectTicket = z.infer<typeof projectTicketSchema>;

export const projectResponseSchema = z.object({
  partition: partitionValueSchema,
  sequence: countSchema,
  tickets: page(projectTicketSchema),
  nextAfter: ticketNumberSchema.optional(),
  nextCursor: cursorSchema.optional(),
  /** How many tickets a search, creator or owner matched across the project, its phases and activity included; only a read naming `q`, `creator` or `owner` carries it. */
  matched: countSchema.optional(),
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

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
  /** `Running` once its run has started, though a runner's attempt is stored `Placing` until it ends. */
  state: z.enum(attemptStates),
  openedAt: instantSchema,
  /**
   * When a runner claimed it, absent where none has: a `Placing` attempt
   * without one is still waiting for a runner. Absent too on an attempt that
   * ended before claims were recorded.
   */
  claimedAt: instantSchema.optional(),
  endedAt: instantSchema.optional(),
  evidence: z.enum(attemptEvidences).optional(),
  run: executionRunSchema.optional(),
  /** The text this attempt's worker left saying why it ended, which is read on its own route. */
  error: z.object({ bytes: countSchema }).optional(),
  /** What the pool that claimed this attempt said in refusing to run it, in its own words. */
  refusal: z.string().min(1).max(workerPoolEvidenceCharsMax).optional(),
});

/** Who answered an evaluation approval, when, how and with what feedback, which is the whole of what that answer's result was written from. */
const executionResultApprovalSchema = z.strictObject({
  action: identitySchema,
  principal: z.string().min(1).max(principalCharsMax),
  resolution: z.enum(nativeActionKindResolutions.EvaluationApproval),
  answeredAt: instantSchema,
  feedback: z.string().min(1).max(approvalFeedbackCharsMax).optional(),
});

const executionResultSchema = z
  .object({
    manifest: identitySchema,
    /** The attempt whose worker reported this result, absent on one a person's answer to an approval wrote. */
    attempt: identitySchema.optional(),
    approval: executionResultApprovalSchema.optional(),
    schemaVersion: countSchema,
    digest: z.string().min(1),
    verdict: z.enum(resultVerdicts),
    recordedAt: instantSchema,
    artifacts: page(resultArtifactSchema),
    report: z.string().min(1).max(resultReportCharsMax).optional(),
  })
  .refine(
    (value) => (value.attempt === undefined) !== (value.approval === undefined),
    "a result is a worker attempt's or an approval's answer, and never both",
  );

export const executionResponseSchema = executionSummarySchema.extend({
  attempts: page(executionAttemptSchema),
  result: executionResultSchema.optional(),
});
export type ExecutionResponse = z.infer<typeof executionResponseSchema>;

export const outputContentResponseSchema = z.object({
  read: z.literal("Content"),
  mediaType: z.string().min(1),
  renderer: z.enum(outputRenderers),
  encoding: z.enum(outputContentEncodings),
  content: z.string(),
});
export type OutputContentResponse = z.infer<typeof outputContentResponseSchema>;

/** What a project-artifact upload answered: the identity a message names it by. */
export const projectArtifactUploadedResponseSchema = z.object({
  artifact: z.string().min(1),
  digest: z.string().min(1),
});
export type ProjectArtifactUploadedResponse = z.infer<
  typeof projectArtifactUploadedResponseSchema
>;

/** One project artifact read back, base64 for the reason its route gives. */
export const projectArtifactResponseSchema = z.object({
  content: z.string(),
  mediaType: z.enum(imageMediaTypes),
  encoding: z.literal(projectArtifactEncoding),
});
export type ProjectArtifactResponse = z.infer<
  typeof projectArtifactResponseSchema
>;

/** One page of a run's per-turn series, ascending, resumed by the last ordinal. */
export const runTurnsResponseSchema = z.object({
  turns: page(runTurnSchema),
  nextAfter: countSchema.optional(),
});
export type RunTurnsResponse = z.infer<typeof runTurnsResponseSchema>;

/** One page of a run's context readings, ascending, resumed by the last ordinal. */
export const runContextResponseSchema = z.object({
  readings: z.array(runContextReadingSchema).max(runContextPageReadingsMax),
  nextAfter: countSchema.optional(),
});
export type RunContextResponse = z.infer<typeof runContextResponseSchema>;

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

/** The worker's own text, as untrusted as anything a run wrote. */
export const runErrorResponseSchema = z.object({
  read: z.literal("Content"),
  content: z.string(),
});
export type RunErrorResponse = z.infer<typeof runErrorResponseSchema>;

const operationIdentitySchema = {
  operation: identitySchema,
  acceptedAt: z.iso.datetime({ offset: true }),
};

/**
 * What each refusal the machine decides carries, as the model's codec spells
 * it: the code again under `type` and the record under `value`. A set of
 * dependencies is an array of distinct tickets, as the codec writes a set.
 */
const ticketRefusalValueSchemas = {
  TicketAlreadyExists: ticketNumberSchema,
  DependenciesNotFound: z.strictObject({
    ticket: ticketNumberSchema,
    dependencies: page(ticketNumberSchema).min(1),
  }),
  DependenciesRevoked: z.strictObject({
    ticket: ticketNumberSchema,
    dependencies: page(ticketNumberSchema).min(1),
  }),
  DependencyCycle: z.strictObject({
    ticket: ticketNumberSchema,
    dependencies: page(ticketNumberSchema).min(1),
  }),
  SelfDependency: ticketNumberSchema,
  TicketNotFound: ticketNumberSchema,
  TicketNotPending: ticketNumberSchema,
  TicketIdentityMismatch: ticketNumberSchema,
  TicketRevisionStale: z.strictObject({
    ticket: ticketNumberSchema,
    expected: ticketNumberSchema,
    current: ticketNumberSchema,
  }),
  DependenciesIncomplete: z.strictObject({
    ticket: ticketNumberSchema,
    dependencies: page(ticketNumberSchema).min(1),
  }),
  TicketNotRevocable: ticketNumberSchema,
  TicketNotResumable: ticketNumberSchema,
  TaskNotCurrent: z.strictObject({
    ticket: ticketNumberSchema,
    task: taskIdentitySchema,
  }),
  EvaluationNotCurrent: z.strictObject({
    ticket: ticketNumberSchema,
    workCycle: ticketNumberSchema,
  }),
  FinalizationNotCurrent: z.strictObject({
    ticket: ticketNumberSchema,
    workCycle: ticketNumberSchema,
    generation: ticketNumberSchema,
  }),
} satisfies Record<OperationTicketRefusalCode, z.ZodType>;

const operationRefusedSchema = {
  ...operationIdentitySchema,
  state: z.literal("Refused"),
  refusedHead: countSchema,
  refusedLifecycleGeneration: countSchema,
};

/** A refusal the machine decided, with the refusal beside its code. */
function operationTicketRefusedSchema<Code extends OperationTicketRefusalCode>(
  code: Code,
) {
  return z.strictObject({
    ...operationRefusedSchema,
    code: z.literal(code),
    refusal: z.strictObject({
      type: z.literal(code),
      value: ticketRefusalValueSchemas[code],
    }),
  });
}

/**
 * A refused operation: a code the machine decided carries its `refusal`, and
 * one the boundary decided carries none, because it names no more than rows
 * or a remote that moved.
 */
const operationRefusedResponseSchema = z.discriminatedUnion("code", [
  operationTicketRefusedSchema("TicketAlreadyExists"),
  operationTicketRefusedSchema("DependenciesNotFound"),
  operationTicketRefusedSchema("DependenciesRevoked"),
  operationTicketRefusedSchema("DependencyCycle"),
  operationTicketRefusedSchema("SelfDependency"),
  operationTicketRefusedSchema("TicketNotFound"),
  operationTicketRefusedSchema("TicketNotPending"),
  operationTicketRefusedSchema("TicketIdentityMismatch"),
  operationTicketRefusedSchema("TicketRevisionStale"),
  operationTicketRefusedSchema("DependenciesIncomplete"),
  operationTicketRefusedSchema("TicketNotRevocable"),
  operationTicketRefusedSchema("TicketNotResumable"),
  operationTicketRefusedSchema("TaskNotCurrent"),
  operationTicketRefusedSchema("EvaluationNotCurrent"),
  operationTicketRefusedSchema("FinalizationNotCurrent"),
  z.strictObject({
    ...operationRefusedSchema,
    code: z.enum(operationBoundaryRefusalCodes),
  }),
]);

export const operationResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...operationIdentitySchema, state: z.literal("Pending") }),
  z.strictObject({
    ...operationIdentitySchema,
    state: z.literal("Succeeded"),
    decidedSequence: countSchema,
  }),
  operationRefusedResponseSchema,
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

export const notificationSchema = z.strictObject({
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
  program: page(programStageSchema),
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
  workloadPaths: z
    .record(z.string().min(1), configurationReferencePathSchema)
    .optional()
    .describe(
      "The repository file each catalog workload named by path was read from, by the name the catalog holds it under. Absent for an authored revision, and for one imported before imports kept it.",
    ),
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
    workInstructionsCount: countSchema.optional(),
    reviewInstructionsCount: countSchema.optional(),
    evaluationStagesCount: countSchema,
    catalog: z
      .object({
        workloads: page(z.string().min(1)),
        plans: page(z.string().min(1)),
        finalizers: page(z.string().min(1)),
        defaults: z.object({
          work: z.string().min(1),
          evaluation: z.string().min(1),
          finalization: z.string().min(1).optional(),
          configuration: configurationFollowingSchema.optional(),
        }),
      })
      .optional(),
  }),
]);
export type ConfigurationSummary = z.infer<typeof configurationSummarySchema>;

/**
 * A page of a project's configuration revisions, newest first. Asked with
 * `latest=true`, it holds only the newest revision of each repository and name,
 * beside each revision imported from no repository, a bootstrap among them.
 */
export const configurationsResponseSchema = z.object({
  configurations: page(configurationSummarySchema),
  nextCursor: cursorSchema.optional(),
});
export type ConfigurationsResponse = z.infer<
  typeof configurationsResponseSchema
>;

/**
 * What under `.chug/` an import that found no configuration read none of, a
 * directory named once with its trailing slash. `truncated` says there is more
 * than `paths` names.
 */
export const repositoryConfigurationIgnoredSchema = z.object({
  paths: z
    .array(z.string().min(1))
    .max(repositoryConfigurationIgnoredAnsweredMax),
  truncated: z.boolean(),
});
export type RepositoryConfigurationIgnoredResponse = z.infer<
  typeof repositoryConfigurationIgnoredSchema
>;

/** The field an answer names what it ignored in, which is absent where it ignored nothing. */
const repositoryConfigurationIgnoredShape = {
  ignored: repositoryConfigurationIgnoredSchema.optional(),
};

export const repositoryConfigurationImportedSchema = z.object({
  imported: z.literal(true),
});

/** A commit declaring no configurations, refused beside what its `.chug/` holds instead. */
export const repositoryConfigurationsAbsentSchema = z.object({
  ...repositoryConfigurationIgnoredShape,
});

export const repositoryConfigurationRefusalSchema = z.object({
  path: z.string().min(1),
  fault: z.enum(repositoryConfigurationFaults),
  configurationFault: identitySchema.optional(),
  /** The file the refused one names by reference, where that file is what was refused. */
  reference: z.string().min(1).optional(),
  /** A `ConfigurationTooLong` configuration's canonical length in UTF-16 code units, and the longest one may be. */
  chars: z.number().int().positive().optional(),
  charsMax: z.number().int().positive().optional(),
});

export type RepositoryConfigurationRefusalResponse = z.infer<
  typeof repositoryConfigurationRefusalSchema
>;

export const repositoryConfigurationRefusalsSchema = z.object({
  faults: page(repositoryConfigurationRefusalSchema),
});
export type RepositoryConfigurationRefusals = z.infer<
  typeof repositoryConfigurationRefusalsSchema
>;

/** One configuration a repository's head declares, as an import of it would store it. */
export const repositoryConfigurationHeadDeclarationSchema = z.object({
  name: identitySchema,
  path: configurationReferencePathSchema,
  revision: identitySchema,
  canonical: z.string().min(1),
  digest: z.string().min(1),
  workloadPaths: z
    .record(z.string().min(1), configurationReferencePathSchema)
    .optional(),
});

export type RepositoryConfigurationHeadDeclaration = z.infer<
  typeof repositoryConfigurationHeadDeclarationSchema
>;

const repositoryConfigurationHeadAt = {
  branch: identitySchema,
  commit: identitySchema,
};

/**
 * What a repository's default branch declares where it points now, read as an
 * import would and stored nowhere: the configurations an import would store,
 * or what it would be refused with.
 */
export const repositoryConfigurationHeadResponseSchema = z.object({
  head: z.discriminatedUnion("state", [
    z.object({ state: z.literal("BranchAbsent") }),
    z.object({
      state: z.literal("CommitAbsent"),
      ...repositoryConfigurationHeadAt,
    }),
    z.object({
      state: z.literal("ConfigurationsAbsent"),
      ...repositoryConfigurationHeadAt,
      ...repositoryConfigurationIgnoredShape,
    }),
    z.object({
      state: z.literal("SnapshotRefused"),
      ...repositoryConfigurationHeadAt,
      refused: z.enum(["Credential", "Snapshot"]),
    }),
    z.object({
      state: z.literal("ConfigurationsRefused"),
      ...repositoryConfigurationHeadAt,
      faults: page(repositoryConfigurationRefusalSchema),
    }),
    z.object({
      state: z.literal("Ready"),
      ...repositoryConfigurationHeadAt,
      configurations: z.array(repositoryConfigurationHeadDeclarationSchema),
    }),
  ]),
});
export type RepositoryConfigurationHeadResponse = z.infer<
  typeof repositoryConfigurationHeadResponseSchema
>;

export const draftResponseSchema = z.object({
  partition: partitionValueSchema,
  ticket: ticketNumberSchema,
  authoringVersion: countSchema,
  state: z.enum(draftStates),
  /**
   * The authoring version the ticket's live revision was released from,
   * present exactly on a released draft; where it is behind `authoringVersion`
   * the draft holds changes an update has still to release.
   */
  releasedAuthoringVersion: countSchema.optional(),
  configurationRevision: identitySchema,
  configurationVersion: configurationVersionSchema.optional(),
  authoring: authoringResponseSchema,
  brief: briefResponseSchema.optional(),
  overrides: configurationOverridesSchema.optional(),
  selection: configurationSelectionSchema.optional(),
});
export type DraftResponse = z.infer<typeof draftResponseSchema>;

/**
 * The landing a write stored a draft's brief with, and who named it: the brief,
 * the finalizer its catalog selection lands with, the repository it names, or
 * `Default` where none of them does, which is a brief naming no repository.
 */
export const draftLandingResponseSchema = briefFinalizationResponseSchema.and(
  z.object({ source: z.enum(draftLandingSources) }),
);

/**
 * What creating or revising a draft answers: the draft, and the landing that
 * write stored its brief with. `landing` is absent from a server that predates
 * it.
 */
export const draftWrittenResponseSchema = draftResponseSchema.extend({
  landing: draftLandingResponseSchema.optional(),
});
export type DraftWrittenResponse = z.infer<typeof draftWrittenResponseSchema>;

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
    programStagesMax: countSchema,
    evaluatorsMax: countSchema,
  }),
  /** The newest dependable tickets, newest first; truncated where older ones are left out. */
  dependencyCandidates: page(ticketNumberSchema),
  dependencyCandidatesTruncated: z.boolean(),
  /** The program stage key a brief's checks join, counted from one, absent where no stage takes them. */
  commandedCheckStage: ticketNumberSchema.optional(),
  /**
   * Where a brief's checks run, in words, naming the plan for a catalog, or
   * that they are refused. It is absent from a server that predates it.
   */
  commandedCheckStageNote: z.string().min(1).optional(),
});
export type DraftInitializationResponse = z.infer<
  typeof draftInitializationResponseSchema
>;

/**
 * What a pod measured of one turn and which batches it wrote, whatever kind of
 * session took it.
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

/** One stream a session's store holds, and how many batches stand under it. */
export const sessionStoreStreamResponseSchema = z.object({
  stream: z.string().min(1).max(sessionStoreStreamCharsMax),
  batches: countSchema,
});
export type SessionStoreStreamResponse = z.infer<
  typeof sessionStoreStreamResponseSchema
>;

/** One entry of a session's transcript, parsed no further than a reader draws it. */
export const sessionTranscriptEntryResponseSchema = z.object({
  uuid: identitySchema.optional(),
  type: identitySchema,
  timestamp: instantSchema.optional(),
  message: z.unknown(),
});

/** One compaction boundary of a session's transcript, with the facts its store kept of it where it kept them. */
export const sessionTranscriptCompactionResponseSchema = z.object({
  boundary: identitySchema,
  at: instantSchema.optional(),
  trigger: z.enum(runCompactionTriggers).optional(),
  tokensBefore: countSchema.optional(),
  tokensAfter: countSchema.optional(),
});

/**
 * The chain over the batches read, with `held` naming the entries of this page
 * the session still holds, decided by the last compaction in the whole stream and
 * absent only where that walk could not reach the stream's end. An elided batch
 * is one whose row exists and whose object cannot be drawn, which is what a run
 * that died leaves behind.
 */
export const sessionTranscriptResponseSchema = z.object({
  stream: z.string().min(1).max(sessionStoreStreamCharsMax),
  entries: z
    .array(sessionTranscriptEntryResponseSchema)
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
  /**
   * Every cut among the entries sent, in the order they were appended, each
   * with what the store says set it off and how many tokens the window held
   * before and after it; absent where the page holds none.
   */
  compactions: z
    .array(sessionTranscriptCompactionResponseSchema)
    .min(1)
    .max(sessionTranscriptEntriesMax)
    .optional(),
  elided: countSchema,
  /** Whether this page's own entries, or its cuts, were cut at their bound. A
   * walk that could not decide what is held says that by omitting `held`, not
   * by this. */
  truncated: z.boolean(),
  nextAfter: countSchema.optional(),
});
export type SessionTranscriptResponse = z.infer<
  typeof sessionTranscriptResponseSchema
>;

/** One turn's readings of its session's context window, in the order the turn took them. */
export const sessionContextTurnResponseSchema = z.object({
  turn: identitySchema,
  ordinal: countSchema,
  readings: z
    .array(sessionContextReadingSchema)
    .min(1)
    .max(sessionTurnContextReadingsMax),
});

/**
 * One page of a session's context readings, by turn ascending and resumed by
 * the last turn's ordinal. The first page alone carries what the session was
 * opened under: the text it appends to the agent runtime's own system prompt,
 * where it has one.
 */
export const sessionContextResponseSchema = z.object({
  turns: z
    .array(sessionContextTurnResponseSchema)
    .max(sessionContextPageTurnsMax),
  systemPrompt: z.string().min(1).max(agentSessionPromptCharsMax).optional(),
  nextAfter: countSchema.optional(),
});
export type SessionContextResponse = z.infer<
  typeof sessionContextResponseSchema
>;

/** One ticket the inbox holds: the row the tickets list answers for it, and its open actions. */
export const inboxEntryResponseSchema = z.object({
  ticket: projectTicketSchema,
  actions: page(projectNativeActionResponseSchema),
});
export type InboxEntryResponse = z.infer<typeof inboxEntryResponseSchema>;

/** One page of the inbox, last activity first; `count` is every ticket it holds, on every page. */
export const inboxResponseSchema = z.object({
  entries: page(inboxEntryResponseSchema),
  count: countSchema,
  more: z.boolean(),
  nextCursor: cursorSchema.optional(),
});
export type InboxResponse = z.infer<typeof inboxResponseSchema>;

/**
 * One member thread as a listing names it, `owner` being the authority its
 * member acts under and absent where the project no longer admits them — a
 * thread its owner must still see and close rather than one to hide. `mine` is
 * computed against the request's own principal, which is what lets a browser
 * name a thread as its reader's own without ever decoding a token.
 */
export const threadEntryResponseSchema = z.object({
  session: identitySchema,
  owner: identitySchema.optional(),
  state: z.enum(threadStandings),
  mine: z.boolean(),
  turns: countSchema,
  agentReference: identitySchema.optional(),
  /** What the thread is about: the member's own name for it where they gave
   * one, else the title derived from its first message, and absent until one of
   * those exists. */
  title: z.string().max(threadTitleCharsMax).optional(),
  openedAt: instantSchema,
  /** When the thread last moved: it opened, a turn was enqueued or ended, or it
   * closed. It is what a rail groups by. */
  lastActivityAt: instantSchema,
  /** Off its owner's rail. Nothing is deleted, so a hidden thread is still
   * listed here and still readable. */
  hidden: z.boolean(),
});
export type ThreadEntryResponse = z.infer<typeof threadEntryResponseSchema>;

export const threadsResponseSchema = z.object({
  threads: z.array(threadEntryResponseSchema).max(threadsAnsweredMax),
});
export type ThreadsResponse = z.infer<typeof threadsResponseSchema>;

/**
 * One of a member's threads as their own chat lists it: whose it is, and the
 * project it is kept in, which a thread of their own scope has none of.
 */
export const chatThreadEntryResponseSchema = threadEntryResponseSchema.extend({
  scope: z.enum(sessionScopes),
  project: identitySchema.optional(),
});
export type ChatThreadEntryResponse = z.infer<
  typeof chatThreadEntryResponseSchema
>;

export const chatThreadsResponseSchema = z.object({
  threads: z.array(chatThreadEntryResponseSchema).max(threadsAnsweredMax),
});
export type ChatThreadsResponse = z.infer<typeof chatThreadsResponseSchema>;

/**
 * One turn of a thread's mailbox, carrying its `input` and its `result`: what
 * the member typed and the answer they are waiting for. Each is bounded by the
 * column that holds it.
 */
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

/**
 * One member thread: what it is, whose it is, and its mailbox tail.
 */
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
  /** The cursor an older page is asked for with, absent where this page holds the first turn. */
  nextBefore: countSchema.optional(),
  streams: z
    .array(sessionStoreStreamResponseSchema)
    .max(sessionStoreStreamsAnswered),
  /**
   * Present where the thread holds jobs its chat host restarts with each
   * attempt, so the plane keeps an attempt placed for it until its owner
   * closes it or its jobs stop.
   */
  jobsStanding: z.literal(true).optional(),
  /** The capabilities in force while its owner's chat host holds it, which is its roster less whatever that host's setting leaves out; absent while no chat host holds it. */
  chatHostCapabilities: z.array(z.enum(sessionCapabilities)).optional(),
});
export type ThreadResponse = z.infer<typeof threadResponseSchema>;

/**
 * A thread's transcript is a session's transcript page. It is aliased rather
 * than forked so the two cannot drift.
 */
export const threadTranscriptResponseSchema = sessionTranscriptResponseSchema;
export type ThreadTranscriptResponse = SessionTranscriptResponse;

/**
 * What the rename and the hide doors answer: the entry as it now stands, which
 * is what the close door answers and for its reason — a caller is given the
 * thread it wrote rather than sent to read it again. They are two names over one
 * shape because the two doors are two writes, and a shape that split later
 * would split under one of the names.
 */
export const threadRenameResponseSchema = threadEntryResponseSchema;
export type ThreadRenameResponse = ThreadEntryResponse;
export const threadHideResponseSchema = threadEntryResponseSchema;
export type ThreadHideResponse = ThreadEntryResponse;

/** What the message door answers: the turn it took, and where it sits in the mailbox. */
export const threadMessageAcceptedSchema = z.object({
  turn: identitySchema,
  ordinal: countSchema,
});
export type ThreadMessageAccepted = z.infer<typeof threadMessageAcceptedSchema>;

/** What the stop door answers: whether this call ended the turn or found it ended. */
export const threadTurnStopResponseSchema = z.object({
  stopped: z.enum(threadTurnStops),
});
export type ThreadTurnStopResponse = z.infer<
  typeof threadTurnStopResponseSchema
>;

/** One app this deployment holds the key of, and the address a tenant's administrator installs it from. */
export const forgeAppResponseSchema = z.object({
  app: z.enum(forgeApps),
  id: identitySchema,
  slug: identitySchema,
  installUrl: z.string().min(1),
});
export type ForgeAppResponse = z.infer<typeof forgeAppResponseSchema>;

/** The client a person authorizes to prove which accounts are theirs, and where they are sent to do it. */
export const forgeAuthorizationClientSchema = z.object({
  clientId: identitySchema,
  authorizeUrl: z.string().min(1),
});
export type ForgeAuthorizationClientResponse = z.infer<
  typeof forgeAuthorizationClientSchema
>;

/**
 * Every app this deployment holds a key for, which every bearer reads because
 * it names no tenant, only the deployment's own apps that onboarding installs.
 * `authorization` is absent where this deployment cannot redeem one.
 */
export const forgeAppsResponseSchema = z.object({
  apps: z.array(forgeAppResponseSchema).max(forgeApps.length),
  authorization: forgeAuthorizationClientSchema.optional(),
});
export type ForgeAppsResponse = z.infer<typeof forgeAppsResponseSchema>;

/** One installation a tenant has claimed, and the moment it was claimed. */
export const forgeInstallationResponseSchema = z.object({
  forge: identitySchema,
  app: z.enum(forgeApps),
  account: identitySchema,
  accountKind: z.enum(forgeAccountKinds),
  installationId: identitySchema,
  claimedAt: instantSchema,
});
export type ForgeInstallationResponse = z.infer<
  typeof forgeInstallationResponseSchema
>;

/**
 * Every installation one tenant holds, oldest first. `truncated` says the tenant
 * holds more than this deployment answers, so a reader that cannot find one
 * knows the listing is partial rather than that the claim is absent.
 */
export const forgeInstallationsResponseSchema = z.object({
  installations: z
    .array(forgeInstallationResponseSchema)
    .max(forgeInstallationsAnsweredMax),
  truncated: z.boolean(),
});
export type ForgeInstallationsResponse = z.infer<
  typeof forgeInstallationsResponseSchema
>;

/** One account a person's authorization reaches, whether it is theirs, and what claiming each app on it came to. */
export const forgeAuthorizedAccountResponseSchema = z.object({
  account: identitySchema,
  accountKind: z.enum(forgeAccountKinds),
  proof: z.enum(forgeAccountProofs),
  apps: z
    .array(z.object({ app: z.enum(forgeApps), claim: z.enum(forgeAppClaims) }))
    .max(forgeApps.length),
});
export type ForgeAuthorizedAccountResponse = z.infer<
  typeof forgeAuthorizedAccountResponseSchema
>;

/**
 * What redeeming one person's authorization for a tenant came to, per account
 * it reaches. `truncated` says the person reaches more than one answer holds.
 */
export const forgeAuthorizationResponseSchema = z.object({
  accounts: z
    .array(forgeAuthorizedAccountResponseSchema)
    .max(forgeAuthorizationAccountsAnsweredMax),
  truncated: z.boolean(),
});
export type ForgeAuthorizationResponse = z.infer<
  typeof forgeAuthorizationResponseSchema
>;

/** A number the forge names something by, written as its digits. */
const forgeNumberSchema = identitySchema.regex(/^[1-9][0-9]*$/u);

/** One repository an installation grants, `url` being the address a binding names it by and `id` the forge's own number for it. */
export const forgeRepositoryResponseSchema = z.object({
  id: forgeNumberSchema,
  name: identitySchema,
  fullName: z.string().min(1),
  url: z.string().min(1),
  defaultBranch: z.string().min(1),
  private: z.boolean(),
});
export type ForgeRepositoryResponse = z.infer<
  typeof forgeRepositoryResponseSchema
>;

/**
 * What one installation grants, whether it was given every repository on its
 * account or chosen ones, and the forge's number for that account where a
 * listed repository names it. `truncated` says the installation holds more than
 * this deployment pages for, so a reader that cannot find a repository knows
 * the listing is partial rather than that the repository is absent.
 */
export const forgeRepositoriesResponseSchema = z.object({
  repositories: z
    .array(forgeRepositoryResponseSchema)
    .max(forgeRepositoriesAnsweredMax),
  truncated: z.boolean(),
  selection: z.enum(forgeRepositorySelections),
  accountId: forgeNumberSchema.optional(),
});
export type ForgeRepositoriesResponse = z.infer<
  typeof forgeRepositoriesResponseSchema
>;

/** Whether one installation has accepted what its app asks for, and the forge's own page where an owner of the account accepts it. */
export const forgeInstallationPermissionsResponseSchema = z.object({
  permissions: z.enum(forgeInstallationPermissions),
  settingsUrl: z.string().min(1),
});
export type ForgeInstallationPermissionsResponse = z.infer<
  typeof forgeInstallationPermissionsResponseSchema
>;

/** The name a bootstrap configuration is declared under. */
export const bootstrapConfigurationName = "bootstrap";

/**
 * What the revision of every bootstrap authored for a repository begins with.
 * The rest is the hex SHA-256 of the repository it was authored for, so each
 * repository's bootstrap is its own revision.
 */
export const bootstrapConfigurationRevisionPrefix = `${bootstrapConfigurationName}:`;

const projectRepositoryImportedSchema = z.object({
  result: z.literal("Imported"),
  count: countSchema,
});
const projectRepositoryBootstrappedSchema = z.object({
  result: z.literal("Bootstrapped"),
  revision: identitySchema,
});
/**
 * What a project holds for one bound repository: the names the repository
 * declared into it, or the bootstrap revision its tickets are released under
 * while it declares none.
 */
export const projectRepositoryConfigurationsHeldSchema = z.discriminatedUnion(
  "result",
  [projectRepositoryImportedSchema, projectRepositoryBootstrappedSchema],
);
export type ProjectRepositoryConfigurationsHeldResponse = z.infer<
  typeof projectRepositoryConfigurationsHeldSchema
>;

/**
 * What a bound repository's own configurations came to, and beside a bootstrap
 * what under `.chug/` the head held instead. It is beside the binding and not
 * part of it, so a `Deferred` is a step to run again through the configuration
 * route rather than a repository that is not bound.
 */
export const projectRepositoryConfigurationsSchema = z.discriminatedUnion(
  "result",
  [
    projectRepositoryImportedSchema,
    projectRepositoryBootstrappedSchema.extend(
      repositoryConfigurationIgnoredShape,
    ),
    z.object({
      result: z.literal("Deferred"),
      reason: z.enum(projectRepositoryConfigurationDeferrals),
    }),
  ],
);
export type ProjectRepositoryConfigurationsResponse = z.infer<
  typeof projectRepositoryConfigurationsSchema
>;

/**
 * Why the worker App cannot be said to reach a bound repository: the
 * installation on its owner does not select it, beside the forge's page where an
 * owner changes that; no installation of the worker App is claimed on its
 * owner; or the forge could not say. It is beside the binding and not part of
 * it, and is read afresh on every answer.
 */
export const projectRepositoryWorkerReachSchema = z.discriminatedUnion(
  "reach",
  [
    z.object({
      reach: z.literal("Unselected"),
      installationId: identitySchema,
      settingsUrl: z.string().min(1),
    }),
    z.object({ reach: z.literal("Unclaimed"), account: identitySchema }),
    z.object({ reach: z.literal("Unknown") }),
  ],
);
export type ProjectRepositoryWorkerReachResponse = z.infer<
  typeof projectRepositoryWorkerReachSchema
>;

/**
 * What binding one repository came to. It names the repository and what it
 * carries: the binding privileges no repository over another, so an answer
 * carrying a position or a count would be saying something the row does not.
 */
export const projectRepositoryBoundSchema = z.object({
  repository: z.string().min(1),
  landing: repositoryLandingSchema,
  finalization: repositoryFinalizationSchema,
  configurations: projectRepositoryConfigurationsSchema,
  /** Absent where the worker App reaches the repository, or this deployment holds no worker App key to ask with. */
  workerReach: projectRepositoryWorkerReachSchema.optional(),
});
export type ProjectRepositoryBoundResponse = z.infer<
  typeof projectRepositoryBoundSchema
>;

/** The same repository already bound, which carries nothing this request did. */
export const projectRepositoryAlreadyBoundSchema = z.object({
  repository: z.string().min(1),
});
export type ProjectRepositoryAlreadyBoundResponse = z.infer<
  typeof projectRepositoryAlreadyBoundSchema
>;

/**
 * One repository a project binds, when it was bound, how a ticket in it lands,
 * as its `finalization` and as the mode alone in `landing`, whether its jobs
 * may write its pipeline definitions, and whether they may start and read its
 * pipeline runs. `retiredAt` is
 * present only on a binding that has been retired, which is one no longer
 * bound or elected, kept so its history reads by name.
 */
export const projectRepositoryResponseSchema = z.object({
  repository: z.string().min(1),
  boundAt: instantSchema,
  landing: repositoryLandingSchema,
  finalization: repositoryFinalizationSchema,
  pipelinesWritable: z.boolean(),
  pipelinesRunnable: z.boolean(),
  retiredAt: instantSchema.optional(),
});
export type ProjectRepositoryResponse = z.infer<
  typeof projectRepositoryResponseSchema
>;

/**
 * The configuration import of one binding that finished last: when it was
 * recorded, the commit it was read at where one was, and how it came out. `absent` is what a
 * `SnapshotAbsent` lacked, and a `DeclarationsRefused` carries its first
 * refusals and `refusalCount`, how many there were, except one kept before
 * refusals were.
 */
export const repositoryConfigurationImportAttemptSchema = z.object({
  attemptedAt: instantSchema,
  commit: actionReportDocumentSchema.shape.commit.optional(),
  outcome: z.discriminatedUnion("result", [
    z.object({
      result: z.literal("SnapshotAbsent"),
      absent: z.enum(repositoryConfigurationImportAbsences),
    }),
    z.object({
      result: z.literal("DeclarationsRefused"),
      refusals: z
        .array(repositoryConfigurationRefusalSchema)
        .min(1)
        .max(repositoryConfigurationImportRefusalsKeptMax)
        .optional(),
      refusalCount: z.number().int().positive().optional(),
    }),
    z.object({
      result: z
        .enum(repositoryConfigurationImportResults)
        .exclude(["SnapshotAbsent", "DeclarationsRefused"]),
    }),
  ]),
});
export type RepositoryConfigurationImportAttemptResponse = z.infer<
  typeof repositoryConfigurationImportAttemptSchema
>;

/**
 * One binding as the listing answers it. `configurationsHeld` is what the
 * project holds for the repository, and `configured` is its presence; one
 * holding nothing is what the configuration route runs the step again for.
 */
export const projectRepositoryListedSchema =
  projectRepositoryResponseSchema.extend({
    configured: z.boolean(),
    configurationsHeld: projectRepositoryConfigurationsHeldSchema.optional(),
    /** Absent on a binding no import was attempted of. */
    lastImport: repositoryConfigurationImportAttemptSchema.optional(),
    /** Absent on a retired binding, as at the bind, and on every binding a `reach=false` read answers. */
    workerReach: projectRepositoryWorkerReachSchema.optional(),
  });
export type ProjectRepositoryListedResponse = z.infer<
  typeof projectRepositoryListedSchema
>;

/** What asking for one binding's configuration step came to, beside the repository it was asked for. */
export const projectRepositoryConfiguredSchema = z.object({
  repository: z.string().min(1),
  configurations: projectRepositoryConfigurationsSchema,
});
export type ProjectRepositoryConfiguredResponse = z.infer<
  typeof projectRepositoryConfiguredSchema
>;

/** The row the write left, which is the newest read of it a writer holds. */
export const projectRepositoryLandingWrittenSchema = z.object({
  repository: projectRepositoryResponseSchema,
});
export type ProjectRepositoryLandingWrittenResponse = z.infer<
  typeof projectRepositoryLandingWrittenSchema
>;

/** The landing another write moved first, and the row as it stands. */
export const projectRepositoryLandingConflictSchema = z.object({
  repository: projectRepositoryResponseSchema,
});
export type ProjectRepositoryLandingConflictResponse = z.infer<
  typeof projectRepositoryLandingConflictSchema
>;

/** The row the retirement left, which is how a caller sees that it landed. */
export const projectRepositoryRetiredSchema = z.object({
  repository: projectRepositoryResponseSchema,
});
export type ProjectRepositoryRetiredResponse = z.infer<
  typeof projectRepositoryRetiredSchema
>;

/** Every repository one project binds, oldest first, which privileges none of them. */
export const projectRepositoriesResponseSchema = z.object({
  repositories: z
    .array(projectRepositoryListedSchema)
    .max(projectRepositoriesAnsweredMax),
});
export type ProjectRepositoriesResponse = z.infer<
  typeof projectRepositoriesResponseSchema
>;

const placementRouteResolvedSchema = z.object({
  route: z.enum(placementRoutes),
  source: z.enum(placementRouteSources),
});

/**
 * Where a project's work and evaluations run and what decided each, and the
 * routes this caller may choose, which are none where it cannot administer.
 */
export const executionPlacementResponseSchema = z.object({
  work: placementRouteResolvedSchema,
  evaluation: placementRouteResolvedSchema,
  choices: z.array(z.enum(placementRoutes)).max(placementRoutes.length),
});
export type ExecutionPlacementResponse = z.infer<
  typeof executionPlacementResponseSchema
>;

/**
 * Where a project's threads run and what decided it, the routes this caller
 * may choose, and the runners a thread would run on: `mine` the caller's chat
 * host for the project's threads and `inquiry` theirs for their own chat's.
 * `project` is always `Unregistered`, and `lead`, `leadOffering` and
 * `leadOfferings` fixed values too, for older clients: there is no project
 * pool and no lead.
 */
export const sessionPlacementResponseSchema = z.object({
  thread: placementRouteResolvedSchema,
  lead: placementRouteResolvedSchema,
  leadOffering: z.enum(leadOfferings),
  leadOfferings: z.array(z.enum(leadOfferings)).max(leadOfferings.length),
  choices: z.array(z.enum(placementRoutes)).max(placementRoutes.length),
  runners: z.object({
    mine: z.enum(sessionRunnerStandings),
    inquiry: z.enum(sessionRunnerStandings).optional(),
    project: z.enum(sessionRunnerStandings),
  }),
});
export type SessionPlacementResponse = z.infer<
  typeof sessionPlacementResponseSchema
>;

/** What keeps a project from deletion: a released ticket, or work run in it. */
export const projectDeletionHoldings = [
  "ReleasedTicket",
  "Execution",
  "Session",
  "WorkerPool",
  "ActionObservation",
] as const;

/** What keeps a workspace from deletion: a project, or a member's runner, chat host or session in it. */
export const tenantDeletionHoldings = [
  "Project",
  "PersonalRunner",
  "ChatHost",
  "Session",
] as const;

/** The code a deletion refused because of what it holds is answered under, beside `held`. */
export const deletionHeldCode = "DeletionHeld";

/** What holds a project its tenant's administrator asks to delete, nothing where it may be deleted now; a refused deletion answers the same. */
export const projectDeletionResponseSchema = z.strictObject({
  held: z.array(z.enum(projectDeletionHoldings)),
});
export type ProjectDeletionResponse = z.infer<
  typeof projectDeletionResponseSchema
>;

/** What holds a workspace the site's administrator asks to delete, nothing where it may be deleted now; a refused deletion answers the same. */
export const tenantDeletionResponseSchema = z.strictObject({
  held: z.array(z.enum(tenantDeletionHoldings)),
});
export type TenantDeletionResponse = z.infer<
  typeof tenantDeletionResponseSchema
>;

/** How many threads one member may hold open in the project, and whether this caller may change it. */
export const threadLimitResponseSchema = z.strictObject({
  threadsMax: z.number().int().min(1),
  administers: z.boolean(),
});
export type ThreadLimitResponse = z.infer<typeof threadLimitResponseSchema>;

/** Whether the project's tenant grants the caller the hosted runs a thread spends in cluster. */
export const hostedRunsResponseSchema = z.strictObject({
  granted: z.boolean(),
});
export type HostedRunsResponse = z.infer<typeof hostedRunsResponseSchema>;

/** The members of an epic counted by phase, a draft not yet released apart, Revoked left out of `total`. */
export const epicProgressSchema = z.strictObject({
  byPhase: z.strictObject(
    Object.fromEntries(phaseRoster.map((phase) => [phase, countSchema])) as {
      readonly [Phase in (typeof phaseRoster)[number]]: typeof countSchema;
    },
  ),
  drafts: countSchema,
  done: countSchema,
  total: countSchema,
});

export const epicStatusRoster = [
  "empty",
  "done",
  "attention",
  "not_started",
  "in_progress",
] as const;

/** An epic as a list carries it, with the figures derived from its members' phases. */
export const epicSummaryResponseSchema = z.strictObject({
  number: ticketNumberSchema,
  revision: ticketNumberSchema,
  title: z.string(),
  summary: z.string().optional(),
  visibility: epicVisibilitySchema,
  progress: epicProgressSchema,
  status: z.enum(epicStatusRoster),
  /** Tickets outside the epic that a Pending member depends on and that are not Done, at most a page of the lowest, ascending. */
  waitingOnOutside: page(ticketNumberSchema),
});
export type EpicSummaryResponse = z.infer<typeof epicSummaryResponseSchema>;

export const epicListResponseSchema = z.strictObject({
  epics: page(epicSummaryResponseSchema),
  /** The `after` the next page is asked with, absent at the last. */
  nextAfter: ticketNumberSchema.optional(),
});
export type EpicListResponse = z.infer<typeof epicListResponseSchema>;

export const epicViewResponseSchema = epicSummaryResponseSchema.extend({
  description: z.string(),
  tickets: z.array(ticketNumberSchema).max(epicTicketsMax),
});
export type EpicViewResponse = z.infer<typeof epicViewResponseSchema>;

export const epicHistoryResponseSchema = z.strictObject({
  /** Newest first. */
  revisions: page(
    z.strictObject({
      revision: ticketNumberSchema,
      changedAt: instantSchema,
      actor: z.strictObject({ kind: identitySchema, subject: identitySchema }),
      title: z.string(),
      visibility: epicVisibilitySchema,
      /** What the revision changed from the one before it; `fields` in the order `epicRevisionFields` names them. */
      changes: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("Created") }),
        z.strictObject({
          kind: z.literal("Revised"),
          fields: z
            .array(z.enum(epicRevisionFields))
            .max(epicRevisionFields.length),
          /** Member tickets gained, ascending. */
          added: z.array(ticketNumberSchema).max(epicTicketsMax),
          /** Member tickets lost, ascending. */
          removed: z.array(ticketNumberSchema).max(epicTicketsMax),
        }),
      ]),
    }),
  ),
  nextAfter: ticketNumberSchema.optional(),
});
export type EpicHistoryResponse = z.infer<typeof epicHistoryResponseSchema>;

/**
 * The members of an epic and the tickets outside it that they depend on, with
 * an edge from each dependency to the member. A member that is a draft not yet
 * released has no phase and no edge.
 */
export const epicGraphResponseSchema = z.strictObject({
  nodes: z
    .array(
      z.strictObject({
        ticket: ticketNumberSchema,
        title: z.string().optional(),
        phase: z.enum(phaseRoster).optional(),
        member: z.boolean(),
      }),
    )
    .max(epicTicketsMax * (1 + nativeHttpDraftDependenciesMax)),
  edges: z
    .array(z.strictObject({ from: ticketNumberSchema, to: ticketNumberSchema }))
    .max(epicTicketsMax * nativeHttpDraftDependenciesMax),
});
export type EpicGraphResponse = z.infer<typeof epicGraphResponseSchema>;

/** What a saved write answers: the epic and the revision it is now at. */
export const epicWriteResponseSchema = z.strictObject({
  epic: ticketNumberSchema,
  revision: ticketNumberSchema,
});
export type EpicWriteResponse = z.infer<typeof epicWriteResponseSchema>;

/**
 * What a take or a return of a ticket answers where it was not refused: what
 * it did, and the member the ticket's next execution is placed for now,
 * encoded as a ticket's `owner` is, absent where none is.
 */
export const ticketTakeResponseSchema = z.strictObject({
  outcome: z.enum(ticketTakeOutcomes),
  owner: identitySchema.optional(),
});
export type TicketTakeResponse = z.infer<typeof ticketTakeResponseSchema>;

/** The error envelope a refused write answers with, carrying what the reason names. */
export const epicRefusalResponseSchema = z.strictObject({
  error: z.strictObject({ code: identitySchema, message: z.string() }),
  current: ticketNumberSchema.optional(),
  tickets: page(ticketNumberSchema).optional(),
});
export type EpicRefusalResponse = z.infer<typeof epicRefusalResponseSchema>;

/** Which of a project's doors its reader may press, each by the kind that door asks. */
export const projectAbilitiesResponseSchema = z.strictObject({
  /** The reader's own principal, encoded as a ticket's `creator` is. */
  principal: identitySchema,
  mutate: z.boolean(),
  dispatch: z.boolean(),
  manageSelector: z.boolean(),
  overrideTicketConfig: z.boolean(),
  skipPlannedEvaluations: z.boolean(),
  /** Whether the reader may have chuggy merge a pull request one of the project's tickets opened. */
  mergeProposals: z.boolean(),
  /** Whether the reader may make an access token for the project. */
  makeAccessTokens: z.boolean(),
  administer: z.boolean(),
  /** Whether the reader may create and revise epics, which is the `Mutate` kind. */
  writeEpic: z.boolean(),
});
export type ProjectAbilitiesResponse = z.infer<
  typeof projectAbilitiesResponseSchema
>;

/** What a member may do in their tenant, as their own chat is told it, each read live. */
export const chatAbilitiesResponseSchema = z.strictObject({
  /** The reader's own principal, encoded as a ticket's `creator` is. */
  principal: identitySchema,
  openUnscopedChat: z.boolean(),
  executeHosted: z.boolean(),
  registerPersonalRunner: z.boolean(),
  administerTenant: z.boolean(),
});
export type ChatAbilitiesResponse = z.infer<typeof chatAbilitiesResponseSchema>;

/** One project a member's own chat may see, how it stands, and the strongest role they hold on it. */
export const chatProjectResponseSchema = z.object({
  project: identitySchema,
  lifecycle: z.enum(projectLifecycles),
  role: z.enum(accessProjectRoles),
});
export type ChatProjectResponse = z.infer<typeof chatProjectResponseSchema>;

/** A page of those projects, and the project an older page is asked after, absent at the last. */
export const chatProjectsResponseSchema = z.object({
  projects: page(chatProjectResponseSchema),
  nextAfter: identitySchema.optional(),
});
export type ChatProjectsResponse = z.infer<typeof chatProjectsResponseSchema>;

/** What a registration-token mint answers: the token, once, and the instant it stops being redeemable. */
export const workerPoolTokenResponseSchema = z.object({
  token: z.string().min(1),
  expiresAtMs: z.number().int().nonnegative().safe(),
});
export type WorkerPoolTokenResponse = z.infer<
  typeof workerPoolTokenResponseSchema
>;

/** Whether a runner sends its credential to this URL: https, or http to its own loopback, and carrying no credential of its own. */
function workerPoolEndpointAllowed(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(url.hostname);
  return url.protocol === "http:" && loopback;
}

/** A URL a runner sends its credential to. */
export const workerPoolEndpointSchema = z
  .string()
  .refine(workerPoolEndpointAllowed, {
    error:
      "is not an https URL, or an http URL on the loopback, carrying no credentials",
  });

/** A registry a runner presents its token to: a lowercase DNS name, and a port where it names one. */
export const workerPoolRegistryHostSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::[0-9]{1,5})?$/u,
  );

/** @deprecated No endpoint answers this. */
export const workerPoolCredentialsSchema = z.strictObject({
  tenant: identitySchema,
  project: identitySchema,
  pool: identitySchema,
  capabilities: workerPoolCapabilitiesSchema,
  tokenUrl: workerPoolEndpointSchema,
  audience: z.string().min(1),
  planeUrl: workerPoolEndpointSchema,
  registryHost: workerPoolRegistryHostSchema.optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type WorkerPoolCredentialsResponse = z.infer<
  typeof workerPoolCredentialsSchema
>;

/** The runner a member's runner's or chat host's newest poll named, and the version chuggy pins for its package where it pins one. */
export const runnerListedSchema = workerRunnerSchema.extend({
  pinned: workerRunnerVersionSchema.optional(),
});
export type RunnerListedResponse = z.infer<typeof runnerListedSchema>;

/**
 * What a personal redemption answers, once: the file a member's runner keeps,
 * naming its tenant and the member it serves, `kind` telling it apart from a
 * file of `workerPoolCredentialsSchema`, which carries none. `registryHost` is
 * absent where the deployment names no registry of its own.
 */
export const personalRunnerCredentialsSchema = z.strictObject({
  kind: z.literal("Personal"),
  tenant: identitySchema,
  owner: identitySchema,
  capabilities: workerPoolCapabilitiesSchema,
  tokenUrl: workerPoolEndpointSchema,
  audience: z.string().min(1),
  planeUrl: workerPoolEndpointSchema,
  registryHost: workerPoolRegistryHostSchema.optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type PersonalRunnerCredentialsResponse = z.infer<
  typeof personalRunnerCredentialsSchema
>;

/** One attempt a member's runner claimed and still holds, placing or running: its project, its ticket, and what its execution is. */
const personalRunnerHeldSchema = z.strictObject({
  project: identitySchema,
  ticket: ticketNumberSchema,
  identity: taskIdentitySchema,
});

/**
 * One of a member's runners, named by `id`, the client its registration made.
 * `polledAt` is its newest poll, absent until it polls, and `live` whether that
 * poll is recent enough for the runner to be taking work; `executionsLive` is
 * the same of its newest poll for executions alone; `held` is what it holds,
 * the earliest claimed first, and `heldTruncated` says it holds more than one
 * read answers.
 */
const personalRunnerListedSchema = z.strictObject({
  id: identitySchema,
  capabilities: z.array(z.string().min(1)),
  registeredAt: instantSchema,
  polledAt: instantSchema.optional(),
  live: z.boolean(),
  executionsLive: z.boolean(),
  /** What its newest poll named, absent where it named none. */
  runner: runnerListedSchema.optional(),
  held: z.array(personalRunnerHeldSchema).max(personalRunnerHeldAnsweredMax),
  heldTruncated: z.boolean(),
});

/**
 * A member's own runners in one tenant, oldest first, and the projects every
 * one of them may serve, in project order, each at its priority. `waiting` is
 * how many of a project's attempts one of the runners could take now, room
 * and slots aside, and none where the member may no longer read it;
 * `waitingTruncated` says more wait than one read counts.
 */
export const personalRunnerResponseSchema = z.strictObject({
  runners: z.array(personalRunnerListedSchema).min(1).max(personalRunnersMax),
  projects: z
    .array(
      z.strictObject({
        project: identitySchema,
        priority: z.enum(personalRunnerPriorities),
        waiting: countSchema.max(personalRunnerWaitingCountedMax),
        waitingTruncated: z.boolean(),
      }),
    )
    .max(personalRunnerProjectsMax),
  /**
   * Each agent, in roster order, that every runner offered it is paused for by
   * the credentials it named, of those polling for executions where any is,
   * with the pause that ends first. Optional for the deployment window, and
   * absent reads as none.
   */
  pauses: z
    .array(
      z.strictObject({
        agent: z.enum(accountAgents),
        pause: agentPauseSchema,
      }),
    )
    .max(accountAgents.length)
    .optional(),
});
export type PersonalRunnerResponse = z.infer<
  typeof personalRunnerResponseSchema
>;

/** One window's reading, of one credential or the newest across an agent's: how much of it was used, the whole window being one, when it reopens and when it was read. */
const agentAccountReadingSchema = z.strictObject({
  window: z.enum(runUsageWindows),
  utilization: z.number().nonnegative(),
  resetsAt: instantSchema,
  observedAt: instantSchema,
});

/** One credential of an agent of the caller's account by its name, held a reading or a limit of or turned off: each window's reading of it, and the pause holding it alone, absent where none holds. */
const agentAccountCredentialSchema = z.strictObject({
  name: workerRunCredentialSchema,
  readings: z.array(agentAccountReadingSchema).max(runUsageWindows.length),
  pause: agentPauseSchema.optional(),
});

/** The pause an agent of the caller's account comes to, `off` where only credentials turned off hold it, and the names of the credentials holding it, in the order `credentials` lists them; optional for the deployment window. */
const agentAccountPauseSchema = agentPauseSchema.extend({
  credentials: z
    .array(workerRunCredentialSchema)
    .min(1)
    .max(agentAccountCredentialsMax)
    .optional(),
});

/**
 * One agent of the caller's own account: their settings, each window's newest
 * reading across its credentials, the newest limit a provider stopped it at
 * across them with the window and the reopening where the run named them, the
 * pause they come to, absent where none holds and holding only while every
 * credential its live runners name is paused, or while any is where they name
 * none, and each credential it holds a reading or a limit of or turned off,
 * by name. `credentials` is optional for the deployment window, and absent
 * reads as none.
 */
const agentAccountSchema = z.strictObject({
  agent: z.enum(accountAgents),
  settings: agentAccountSettingsSchema,
  readings: z.array(agentAccountReadingSchema).max(runUsageWindows.length),
  limit: z
    .strictObject({
      window: z.enum(runUsageWindows).optional(),
      resetsAt: instantSchema.optional(),
      observedAt: instantSchema,
    })
    .optional(),
  pause: agentAccountPauseSchema.optional(),
  credentials: z
    .array(agentAccountCredentialSchema)
    .max(agentAccountCredentialsMax)
    .optional(),
});
export type AgentAccount = z.infer<typeof agentAccountSchema>;
export type AgentAccountCredential = z.infer<
  typeof agentAccountCredentialSchema
>;

/** Every agent of the caller's own account, in roster order. */
export const agentAccountsResponseSchema = z.strictObject({
  accounts: z.array(agentAccountSchema).length(accountAgents.length),
});
export type AgentAccountsResponse = z.infer<typeof agentAccountsResponseSchema>;

/** One theme of the caller's own: the number it is known by and its document. */
export const ownedThemeSchema = z.strictObject({
  theme: themeNumberSchema,
  document: themeDocumentSchema,
});
export type OwnedThemeResponse = z.infer<typeof ownedThemeSchema>;

/** Every theme of the caller's own, by number ascending. */
export const ownedThemesResponseSchema = z.strictObject({
  themes: z.array(ownedThemeSchema).max(themesOwnedMax),
});
export type OwnedThemesResponse = z.infer<typeof ownedThemesResponseSchema>;

/** The caller's own global theme choice, absent where they hold none. */
export const themeChoiceResponseSchema = z.strictObject({
  choice: themeChoiceSchema.optional(),
});
export type ThemeChoiceResponse = z.infer<typeof themeChoiceResponseSchema>;

/** A project's default theme, absent where it names none, and whether this caller may change it. */
export const projectThemeResponseSchema = z.strictObject({
  document: themeDocumentSchema.optional(),
  administers: z.boolean(),
});
export type ProjectThemeResponse = z.infer<typeof projectThemeResponseSchema>;

/**
 * The theme a project wears for the caller, the layer it came from, and each
 * layer's own value, absent where it names none or names a theme that no
 * longer exists, which resolves as that layer unset.
 */
export const projectAppearanceResponseSchema = z.strictObject({
  theme: themeDocumentSchema,
  layer: z.enum(themeLayers),
  layers: z.strictObject({
    override: themeChoiceSchema.optional(),
    projectDefault: themeDocumentSchema.optional(),
    global: themeChoiceSchema.optional(),
  }),
});
export type ProjectAppearanceResponse = z.infer<
  typeof projectAppearanceResponseSchema
>;

/** The artifacts a project names its icon and its banner, each absent where it names none, and whether this caller may change them. */
export const projectImagesResponseSchema = z.strictObject({
  icon: identitySchema.optional(),
  banner: identitySchema.optional(),
  administers: z.boolean(),
});
export type ProjectImagesResponse = z.infer<typeof projectImagesResponseSchema>;

/**
 * What retiring a credential of the caller's own account is refused with while
 * a live runner of theirs still names it, whose next run would report it
 * again. It is named once because a console tells the member so in words of
 * its own.
 */
export const agentAccountCredentialInUseCode = "CredentialInUse";

/**
 * What turning a credential of the caller's own account off is refused with
 * while as many of that agent's credentials as the account holds off are
 * already off. It is named once because a console tells the member so in
 * words of its own.
 */
export const agentAccountCredentialsOffFullCode = "OffFull";

/**
 * What redeeming a chat host's token answers, once: a runner's file with no
 * capabilities, since a chat host takes sessions alone, and `kind` telling it
 * apart from a runner's.
 */
export const chatHostCredentialsSchema = z.strictObject({
  kind: z.literal("ChatHost"),
  tenant: identitySchema,
  owner: identitySchema,
  tokenUrl: workerPoolEndpointSchema,
  audience: z.string().min(1),
  planeUrl: workerPoolEndpointSchema,
  registryHost: workerPoolRegistryHostSchema.optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type ChatHostCredentialsResponse = z.infer<
  typeof chatHostCredentialsSchema
>;

/**
 * A member's chat host in one tenant, named by `id`, the client its
 * registration made. `polledAt` is its newest poll, absent until it polls, and
 * `live` whether that poll is recent enough for the host to be taking chats.
 */
export const chatHostResponseSchema = z.strictObject({
  id: identitySchema,
  registeredAt: instantSchema,
  polledAt: instantSchema.optional(),
  live: z.boolean(),
  /** What its newest poll named, absent where it named none. */
  runner: runnerListedSchema.optional(),
  /** The capabilities its newest poll named for the threads it hosts, each of which holds no more of its roster; absent where it named none, and each keeps its roster. */
  sessionCapabilities: z.array(z.enum(sessionCapabilities)).optional(),
});
export type ChatHostResponse = z.infer<typeof chatHostResponseSchema>;

/** Whether a tenant permits the caller to register a personal runner there. */
export const personalRunnerPermitResponseSchema = z.strictObject({
  granted: z.boolean(),
});
export type PersonalRunnerPermitResponse = z.infer<
  typeof personalRunnerPermitResponseSchema
>;

/** A commit, at either width git addresses an object at. */
const landingCommitSchema = actionReportDocumentSchema.shape.commit;

/**
 * Why the newest attempt was sent back to re-check, where it recorded why, and
 * the ref of the base it was read against where its target is a proposal's
 * head.
 */
const ticketLandingRecheckSchema = z.strictObject({
  reason: z.enum(finalizationRecheckReasons),
  baseRef: z.string().min(1).optional(),
});

/** The newest attempt one landing recorded. */
const ticketLandingAttemptSchema = z.strictObject({
  outcome: z.enum(finalizationAttemptOutcomes),
  failureKind: z.enum(finalizationFailureKinds).optional(),
  recheck: ticketLandingRecheckSchema.optional(),
  targetRef: z.string().min(1),
  targetCommit: landingCommitSchema,
  candidateCommit: landingCommitSchema.optional(),
  preparedAt: instantSchema,
});

/**
 * The paths the newest attempt's conflict manifest names, as many as one
 * landing answers, and `truncated` where the manifest or that bound cut them.
 */
const ticketLandingConflictSchema = z.strictObject({
  paths: z.array(z.string().min(1)).readonly(),
  truncated: z.boolean(),
});

/** Text a forge answered with, bounded as the row keeps it. */
function ticketLandingForgeTextSchema(charsMax: number) {
  return z.string().refine((value) => isBoundedText(value, charsMax));
}

/**
 * What the forge answered the newest merge it was asked for: when it was asked
 * and, once heard, when it answered, what that came to, and its status and
 * message, cut where `messageCut` says so, or the failure that reached no forge.
 */
const ticketLandingMergeAnswerSchema = z.strictObject({
  askedAt: instantSchema,
  answeredAt: instantSchema.optional(),
  outcome: z.enum(changeProposalMergeOutcomes).optional(),
  status: countSchema.optional(),
  failure: ticketLandingForgeTextSchema(
    proposalForgeFailureCharsMax,
  ).optional(),
  message: ticketLandingForgeTextSchema(
    proposalForgeMessageCharsMax,
  ).optional(),
  messageCut: z.literal(true).optional(),
});

/**
 * The pull request one landing opened at `headCommit`, each other field present
 * where its row holds it. `url` is absent where none was recorded or the one
 * recorded is not a link a report could carry; `creation` is absent where the
 * proposal was found by reading it back; `status` and `mergeability` are what
 * the forge last said of it, and `mergeState` its own word for the second;
 * `mergedHead` is the head the forge merged, present only where it is not the
 * one this landing opened it at; and `mergesAsked` is how many merges of it the
 * forge was asked for, absent where none was, and `mergeAnswer` what the forge
 * answered the newest of them.
 */
const ticketLandingProposalSchema = z.strictObject({
  url: actionReportDocumentSchema.shape.link,
  headRef: z.string().min(1),
  headCommit: landingCommitSchema,
  baseRef: z.string().min(1),
  creation: z.enum(changeProposalCreations).optional(),
  status: z.enum(changeProposalStatuses).optional(),
  merge: z.enum(changeProposalMerges).optional(),
  mergeReason: z.enum(changeProposalMergeReasons).optional(),
  mergeability: z.enum(changeProposalMergeabilities).optional(),
  mergeState: z.string().min(1).max(proposalMergeStateCharsMax).optional(),
  mergeCommit: landingCommitSchema.optional(),
  mergedHead: landingCommitSchema.optional(),
  mergesAsked: countSchema.optional(),
  mergeAnswer: ticketLandingMergeAnswerSchema.optional(),
});

const ticketLandingFields = {
  cycle: ticketNumberSchema,
  generation: ticketNumberSchema,
  attempts: countSchema,
  attempt: ticketLandingAttemptSchema.optional(),
  conflict: ticketLandingConflictSchema.optional(),
  proposal: ticketLandingProposalSchema.optional(),
};

/**
 * A hold a landing was recorded at, with the forge's reason and the login it
 * names where it escalates a removal from a merge queue, and at
 * `TargetPathsRefused` the files a job may not push that the target changed.
 */
const ticketLandingHoldSchema = z.strictObject({
  kind: z.enum(finalizationUnavailableKinds),
  passes: ticketNumberSchema,
  since: instantSchema,
  removal: z
    .strictObject({
      reason: z.string().min(1).max(proposalQueueWordCharsMax),
      actor: z.string().min(1).max(proposalQueueWordCharsMax).optional(),
    })
    .optional(),
  refused: ticketLandingConflictSchema.optional(),
});

/**
 * One finalization of a ticket, as what is recorded of it. A `Held` landing
 * carries the hold it was last recorded at, and an `Unavailable` one the hold
 * it escalated from where one is recorded; an
 * `AwaitingMerge` one what its merge waits on and when the forge was last
 * heard about it; and only a `Landed` one the commit it landed at.
 */
export const ticketLandingSchema = z.discriminatedUnion("state", [
  z.strictObject({
    ...ticketLandingFields,
    state: z.literal("Held"),
    hold: ticketLandingHoldSchema,
  }),
  z.strictObject({
    ...ticketLandingFields,
    state: z.literal("Unavailable"),
    hold: ticketLandingHoldSchema.optional(),
  }),
  z.strictObject({
    ...ticketLandingFields,
    state: z.literal("AwaitingMerge"),
    wait: z.strictObject({
      reason: z.enum(changeProposalMergeWaits),
      checkedAt: instantSchema,
    }),
  }),
  z.strictObject({
    ...ticketLandingFields,
    state: z.literal("Landed"),
    landedCommit: landingCommitSchema,
  }),
  z.strictObject({
    ...ticketLandingFields,
    state: z
      .enum(ticketLandingStates)
      .exclude(["Held", "Unavailable", "AwaitingMerge", "Landed"]),
  }),
]);
export type TicketLandingResponse = z.infer<typeof ticketLandingSchema>;

/**
 * What the finalizer prepared one work cycle's evaluation over: a stack, with
 * the tickets beneath it bottom first, each with the commit it must land, the
 * reference it was built on and that reference's tip; or the decision to
 * evaluate it unstacked, with why. `restacked` marks a cycle whose previous
 * cycle was sent back to re-stack over the queue ahead of it.
 */
export const ticketLandingStackSchema = z.discriminatedUnion("prepared", [
  z.strictObject({
    cycle: ticketNumberSchema,
    restacked: z.literal(true).optional(),
    prepared: z.literal("Stacked"),
    beneath: z
      .array(
        z.strictObject({
          ticket: ticketNumberSchema,
          commit: landingCommitSchema,
        }),
      )
      .min(1)
      .max(ticketLandingStackDepthMax),
    reference: z.string().min(1),
    tip: landingCommitSchema,
  }),
  z.strictObject({
    cycle: ticketNumberSchema,
    restacked: z.literal(true).optional(),
    prepared: z.literal("Unstacked"),
    reason: z.enum(evaluationUnstackedReasons),
  }),
]);
export type TicketLandingStackResponse = z.infer<
  typeof ticketLandingStackSchema
>;

/**
 * A ticket's newest landings, oldest first, `truncated` where it has had more
 * than one read answers; and for a Stacked ticket, its newest work cycles the
 * finalizer prepared, oldest first, absent where it prepared none.
 */
export const ticketLandingsResponseSchema = z.strictObject({
  landings: z.array(ticketLandingSchema).max(ticketLandingsAnsweredMax),
  truncated: z.boolean(),
  stacks: z
    .strictObject({
      cycles: z
        .array(ticketLandingStackSchema)
        .min(1)
        .max(ticketLandingStacksAnsweredMax),
      truncated: z.boolean(),
    })
    .optional(),
});
export type TicketLandingsResponse = z.infer<
  typeof ticketLandingsResponseSchema
>;

/**
 * What a merge of a ticket's pull request answers where the pull request is
 * merged, by this press or before it: the commit the merge left, absent where
 * the forge named none, and the pull request's link where a report could
 * carry it.
 */
export const ticketProposalMergeResponseSchema = z.strictObject({
  outcome: z.literal("Merged"),
  mergeCommit: landingCommitSchema.optional(),
  url: actionReportDocumentSchema.shape.link,
});
export type TicketProposalMergeResponse = z.infer<
  typeof ticketProposalMergeResponseSchema
>;

/** What a merge of a ticket's pull request the forge did not make answers: why, and the pull request's link where a report could carry it. */
export const ticketProposalMergeRefusedResponseSchema = z.strictObject({
  error: z.strictObject({ code: identitySchema, message: z.string() }),
  refused: z.enum(proposalMergeRefusals),
  url: actionReportDocumentSchema.shape.link,
});
export type TicketProposalMergeRefusedResponse = z.infer<
  typeof ticketProposalMergeRefusedResponseSchema
>;

/**
 * One reference's landing queue: its repository, the target its briefs name,
 * absent where they name none, the ticket holding it, since when it has held
 * it and in what phase it is, and the tickets waiting on it in rank order.
 * `holderSince` is the later of when the holder took its rank and when the
 * ticket ranked ahead of it last stopped holding, in UTC.
 */
export const landingQueueSchema = z.strictObject({
  repository: briefRepositorySchema,
  target: briefBranchSchema.optional(),
  holder: ticketNumberSchema,
  holderSince: z.iso.datetime({ precision: landingQueueHolderSinceDigits }),
  holderPhase: z.enum(phaseRoster),
  waiting: z.array(ticketNumberSchema).max(landingQueueTicketsAnsweredMax - 1),
});

/** A project's landing queues, `truncated` where more tickets were ranked than one read answers. */
export const landingQueuesResponseSchema = z.strictObject({
  queues: z.array(landingQueueSchema).max(landingQueueTicketsAnsweredMax),
  truncated: z.boolean(),
});
export type LandingQueuesResponse = z.infer<typeof landingQueuesResponseSchema>;
