/**
 * The closed sets the public wire names, each as a runtime list and the union
 * it induces.
 *
 * A roster here is a restatement of one the model or the interpreter owns, and
 * `test/contract/rosters.test.ts` holds each against its source — against a
 * runtime list where one exists, and otherwise against a record the compiler
 * rejects when the union gains or loses a member. `notificationKinds` is the
 * exception and the only one: the wire owns it outright, `src/interpreter/
 * notifications.ts` takes `NotificationKind` from here, and what stands behind
 * it instead is the relation to `projectChangeKinds` that the same suite pins.
 */

export const phaseRoster = [
  "Pending",
  "Working",
  "Evaluating",
  "Finalizing",
  "PublishingHandoff",
  "HandoffBlocked",
  "Done",
  "Abandoned",
  "Escalated",
  "Revoked",
] as const;
export type TicketPhase = (typeof phaseRoster)[number];

export const executionStatuses = [
  "Queued",
  "Admitted",
  "Launching",
  "Running",
  "Terminal",
  "Cancelled",
] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];

export const executionOutcomes = ["Passed", "Failed", "Blocked"] as const;
export type ExecutionOutcome = (typeof executionOutcomes)[number];

export const executionTaskKinds = ["Work", "Evaluation"] as const;
export type ExecutionTaskKind = (typeof executionTaskKinds)[number];

export const attemptStates = [
  "Placing",
  "Running",
  "Reported",
  "Lost",
  "Withdrawn",
  "Superseded",
] as const;
export type AttemptState = (typeof attemptStates)[number];

export const artifactRoles = ["Handoff", "Diagnostic"] as const;
export type ArtifactRole = (typeof artifactRoles)[number];

export const outputRenderers = [
  "UnifiedDiff",
  "Markdown",
  "Json",
  "Text",
] as const;
export type OutputRenderer = (typeof outputRenderers)[number];

export const resultVerdicts = ["Pass", "Fail"] as const;
export type ResultVerdict = (typeof resultVerdicts)[number];

export const operationStates = [
  "Pending",
  "Succeeded",
  "Refused",
  "Answered",
  "Cancelled",
] as const;
export type OperationState = (typeof operationStates)[number];

export const operationRefusalCodes = [
  "NotEnabled",
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
  "CommandUnreadable",
] as const;
export type OperationRefusalCode = (typeof operationRefusalCodes)[number];

/**
 * Which resource a polled notification says has moved. Owned here rather than
 * restated: the durable log's rows are this list, and the interpreter imports
 * it.
 */
export const notificationKinds = [
  "Operation",
  "Ticket",
  "Draft",
  "Configuration",
  "Project",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export const notificationResults = ["Events", "Reset"] as const;
export type NotificationResult = (typeof notificationResults)[number];

export const dispatchViewResults = ["Page", "Reset"] as const;
export type DispatchViewResult = (typeof dispatchViewResults)[number];

/** What the scheduler is willing to claim about the counts it reports. */
export const schedulerFreshnesses = ["Unknown"] as const;
export type SchedulerFreshness = (typeof schedulerFreshnesses)[number];

export const draftStates = ["Draft", "Released", "Deleted"] as const;
export type DraftState = (typeof draftStates)[number];

export const evaluationCombinators = ["UnanimousPass", "AnyPass"] as const;
export type EvaluationCombinator = (typeof evaluationCombinators)[number];

export const resumePricings = ["RetryCharged", "RetryFree"] as const;
export type ResumePricing = (typeof resumePricings)[number];

export const finalizers = ["NoFinalizer", "ManagedFinalizer"] as const;
export type FinalizerChoice = (typeof finalizers)[number];

export const configurationReadinesses = ["Ready", "Incomplete"] as const;
export type ConfigurationReadiness = (typeof configurationReadinesses)[number];

export const configurationProvenanceSources = [
  "Authored",
  "Repository",
] as const;
export type ConfigurationProvenanceSource =
  (typeof configurationProvenanceSources)[number];

export const repositoryConfigurationFaults = [
  "TooManyDeclarations",
  "PathInvalid",
  "SymlinkRefused",
  "ContentTooLarge",
  "DocumentUnreadable",
  "EnvelopeInvalid",
  "NameInvalid",
  "ConfigurationInvalid",
  "DuplicateName",
  "DuplicatePath",
] as const;
export type RepositoryConfigurationFault =
  (typeof repositoryConfigurationFaults)[number];

/** The resolutions a native escalation action accepts. */
export const nativeActionResolutions = [
  "Resume",
  "Revoke",
  "RetryHandoff",
  "AbandonHandoff",
  "Approve",
  "Decline",
] as const;
export type NativeActionResolution = (typeof nativeActionResolutions)[number];
