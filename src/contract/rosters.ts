/**
 * The closed sets the public wire names, each as a runtime list and the union
 * it induces.
 *
 * A roster here is a restatement of one the model or the interpreter owns, and
 * `test/contract/rosters.test.ts` holds each against its source — against a
 * runtime list where one exists, and otherwise against a record the compiler
 * rejects when the union gains or loses a member. `notificationKinds` and
 * `briefFinalizationModes` are the exceptions: the wire owns each outright and
 * the interpreter takes its union from here. What stands behind the first is
 * the relation to `projectChangeKinds` that the same suite pins; behind the
 * second, `test/contract/brief.test.ts` holding this list against the
 * finalization variants the wire publishes.
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

/**
 * Which wall a parked ticket hit, in the order the model declares them.
 * The model's `NoReason` is not among them: the machine holds a reason exactly
 * when a ticket is escalated, so the wire omits the field instead of naming it.
 */
export const escalationReasons = [
  "WorkFailed",
  "ReworkBudgetExhausted",
  "FinalizationBudgetExhausted",
  "GasExhausted",
  "DependencyRevoked",
  "ExecutionPolicyDenied",
  "TicketConfigIncompatible",
  "ExecutionProfileUnavailable",
  "RuntimeVersionUnsupported",
  "RequiredCapabilityUnavailable",
] as const;
export type EscalationReason = (typeof escalationReasons)[number];

/**
 * Where an operator resume re-enters a parked ticket, in the order the model
 * declares them. The model's `NoResume` is not among them: it is that union's
 * absent value, so the wire omits the field rather than naming a value that
 * would read as "not resumable" — a stronger claim than the machine makes,
 * because `retryableIn` wants affordable gas as well as a resume point.
 */
export const resumePoints = [
  "ResumeWorking",
  "ResumeReworking",
  "ResumeEvaluating",
  "ResumeFinalizing",
  "ResumePublishingHandoff",
] as const;
export type ResumePoint = (typeof resumePoints)[number];

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

/** The platform halves a container requirement names, and the native driver's. */
export const operatingSystems = ["Linux", "MacOS"] as const;
export type OperatingSystem = (typeof operatingSystems)[number];

export const architectures = ["Amd64", "Arm64"] as const;
export type Architecture = (typeof architectures)[number];

export const nativeDrivers = [
  "XcodeBuild",
  "XcodeTesting",
  "IosSimulatorTesting",
] as const;
export type NativeDriver = (typeof nativeDrivers)[number];

/**
 * What a capability requirement asks a site for in place of an exact image.
 * The site resolves it to a runtime that offers every capability named.
 */
export const executionCapabilities = ["Agent:Claude", "Agent:Codex"] as const;
export type ExecutionCapability = (typeof executionCapabilities)[number];

/** Which default a materialized requirement came from, narrowest first. */
export const requirementSources = [
  "ExplicitTask",
  "TaskKindDefault",
  "TicketDefault",
  "PlatformDefault",
] as const;
export type RequirementSource = (typeof requirementSources)[number];

export const attemptStates = [
  "Placing",
  "Running",
  "Reported",
  "Lost",
  "Withdrawn",
  "Superseded",
] as const;
export type AttemptState = (typeof attemptStates)[number];

/** Why an attempt ended without a result, restating the interpreter's own list. */
export const attemptEvidences = [
  "PolicyDenied",
  "PolicyUnavailable",
  "PlacementDenied",
  "PlacementUnavailable",
  "Evicted",
  "Vanished",
  "LeaseExpired",
  "ManifestInvalid",
  "Fenced",
  "RunFailed",
  "RunRateLimited",
  "RunTurnsExhausted",
  "RunUploadRefused",
] as const;
export type AttemptEvidence = (typeof attemptEvidences)[number];

/** What a cost figure is: the agent runtime's published list price, never a bill. */
export const runCostBases = ["List"] as const;
export type RunCostBasis = (typeof runCostBases)[number];

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
  "ExecutionSourceUnreadable",
  "ExecutionSourceDenied",
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

/** Whether the selector is running at all, at an installation or for one project. */
export const selectorModes = ["Running", "Paused"] as const;

/** Whether a selector proposal is dispatched or held for a reviewer. */
export const selectorDispatchModes = ["Automatic", "ApprovalRequired"] as const;

/** Where one of a decision's dispatches stands, which is what the log says landed. */
export const selectorDeliveryStates = [
  "AwaitingApproval",
  "Pending",
  "Submitted",
  "Terminal",
] as const;
export type SelectorDeliveryState = (typeof selectorDeliveryStates)[number];
export type SchedulerFreshness = (typeof schedulerFreshnesses)[number];

export const draftStates = ["Draft", "Released", "Deleted"] as const;
export type DraftState = (typeof draftStates)[number];

export const evaluationCombinators = ["UnanimousPass", "AnyPass"] as const;
export type EvaluationCombinator = (typeof evaluationCombinators)[number];

export const resumePricings = ["RetryCharged", "RetryFree"] as const;
export type ResumePricing = (typeof resumePricings)[number];

export const finalizers = ["NoFinalizer", "ManagedFinalizer"] as const;
export type FinalizerChoice = (typeof finalizers)[number];

/**
 * How a finalization lands one ticket's work on the reference its brief names:
 * by advancing that reference, or by opening a change proposal into it.
 * `src/interpreter/ticketBrief.ts` takes `BriefFinalizationMode` from here.
 */
export const briefFinalizationModes = ["Push", "PullRequest"] as const;
export type BriefFinalizationMode = (typeof briefFinalizationModes)[number];

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

/** The kinds of question a native action puts to a person. */
export const nativeActionKinds = [
  "TicketEscalation",
  "HandoffBlock",
  "FinalizationApproval",
] as const;
export type NativeActionKind = (typeof nativeActionKinds)[number];

/**
 * The answers each kind may ask for. One open action offers a subset of its
 * kind's — an escalation with no modeled resumption offers only the revoke —
 * so a read answers with what that action admits rather than with this.
 */
export const nativeActionKindResolutions = {
  TicketEscalation: ["Resume", "Revoke"],
  HandoffBlock: ["RetryHandoff", "AbandonHandoff"],
  FinalizationApproval: ["Approve", "Decline"],
} as const;

/** Every resolution the wire names, which is every kind's flattened in kind order. */
export const nativeActionResolutions = [
  ...nativeActionKindResolutions.TicketEscalation,
  ...nativeActionKindResolutions.HandoffBlock,
  ...nativeActionKindResolutions.FinalizationApproval,
] as const;
export type NativeActionResolution = (typeof nativeActionResolutions)[number];

/** How closely the lead says a project needs watching, which one decision may move. */
export const selectorAttentions = [
  "Monitoring",
  "Attention",
  "Stopped",
] as const;
export type SelectorAttention = (typeof selectorAttentions)[number];

/**
 * Which end of the decision log a page is read from. The log is appended to, so
 * a reader following it forward pages from `oldest` with a cursor, and a reader
 * showing what the lead just did asks for `newest` and gets one page.
 */
export const selectorHistoryOrders = ["oldest", "newest"] as const;
export type SelectorHistoryOrder = (typeof selectorHistoryOrders)[number];

/** What the lead did about one ticket, in the order it did it. */
export const agenticRefusalEvents = ["Refused", "Lifted"] as const;
export type AgenticRefusalEvent = (typeof agenticRefusalEvents)[number];

/** Whether a session still takes turns, which is the whole of its lifecycle. */
export const sessionStates = ["Open", "Closed"] as const;
export type SessionState = (typeof sessionStates)[number];

/**
 * Where one member thread stands, which is a session state or the membership it
 * acts under being gone. It is wider than `sessionStates` because a thread with
 * no owner is a thread a reader must still be told about.
 */
export const threadStandings = ["Open", "Closed", "Orphaned"] as const;
export type ThreadStanding = (typeof threadStandings)[number];

/**
 * Why the message door refused a member's message, kept apart from
 * `operationRefusalCodes` because the door answers through `nativeHttpError`
 * and never through the operation resource's `Refused` arm, so a member put
 * there would widen every operation's wire enum and its total switches for a
 * code that never arrives. It is a roster rather than literals at each end
 * because a reader's behaviour turns on one of them — a `NotYourThread` is
 * settled against the mailbox rather than reported, the door having resolved
 * that mailbox before it compared the URL — so a door that renamed the code
 * while a console compared the old spelling would report a message as refused
 * for a turn the mailbox already holds.
 */
export const threadMessageRefusalCodes = [
  "NotYourThread",
  "ThreadClosed",
  "ThreadOrphaned",
  "ThreadBacklogged",
  "ThreadTurnTooLarge",
] as const;
export type ThreadMessageRefusalCode =
  (typeof threadMessageRefusalCodes)[number];

/** Who or what put a turn in a session's mailbox. */
export const sessionTurnInputKinds = [
  "Observation",
  "UserMessage",
  "Wake",
  "Inquiry",
] as const;
export type SessionTurnInputKind = (typeof sessionTurnInputKinds)[number];

/** Where one turn stands. */
export const sessionTurnStates = [
  "Queued",
  "Claimed",
  "Answered",
  "Failed",
  "Abandoned",
] as const;
export type SessionTurnState = (typeof sessionTurnStates)[number];

/** Why one turn ended without an answer. */
export const sessionTurnFailures = [
  "AgentFailed",
  "AgentRateLimited",
  "AgentTurnsExhausted",
  "AgentBudgetExhausted",
  "StoreRefused",
  "AttemptLost",
  "SessionClosed",
  "TurnWithdrawn",
] as const;
export type SessionTurnFailure = (typeof sessionTurnFailures)[number];
