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
  "Work",
  "Evaluation",
  "Finalization",
  "Done",
  "Escalated",
  "Revoked",
] as const;
export type TicketPhase = (typeof phaseRoster)[number];

/**
 * Which wall a parked ticket is escalated at, in the order the model declares
 * them. The wire omits the whole object for a ticket that is not escalated.
 */
export const escalationKinds = [
  "WorkFailureEscalated",
  "WorkExecutionUnavailableEscalated",
  "EvaluationFailureEscalated",
  "EvaluationBlockedEscalated",
  "FinalizationUnavailableEscalated",
] as const;
export type EscalationKind = (typeof escalationKinds)[number];

/**
 * Which wall the fabric hit, restating the interpreter's `allBlockedReasons`.
 * It is evidence and not an escalation kind — a wall parks a ticket at
 * `WorkExecutionUnavailableEscalated` or `EvaluationBlockedEscalated`, and a
 * ticket carries a wall only beside one of those two.
 */
export const blockedReasons = [
  "ExecutionPolicyDenied",
  "TicketConfigIncompatible",
  "ExecutionProfileUnavailable",
  "RuntimeVersionUnsupported",
  "RequiredCapabilityUnavailable",
] as const;
export type BlockedReason = (typeof blockedReasons)[number];

/**
 * Which finalization holds the machine reports `FinalizationResultUnavailable`
 * for — the ones a resume could clear, re-running the same operation against
 * the same pinned input, reaching the repository, the target, the proposal or
 * its base a second time and counting the finalizer's own budgets afresh; the
 * wire owns the list outright as `notificationKinds` is owned here, so the
 * finalizer recording a hold, the door admitting a result and the desk reading
 * one all name the same thirteen, and `test/contract/rosters.test.ts` holds it
 * against the interpreter's `allFinalizationHoldKinds` as
 * `test/postgres/migration.test.ts` holds it against the column that mirrors
 * it. The five left out stay holds, each for its own reason:
 * `ApprovalDeclined` is a human's answer, which a resume would put to the same
 * human again; `ProposalRefused` is that answer or a pin the rows contradict,
 * and neither is reachability; `ProposalHeadMoved` is a landing to rebuild
 * rather than one to retry; `ContradictoryEvidence` is durable rows
 * disagreeing, which is a defect for telemetry and not a desk item; and
 * `ProposalMergeBlocked` cannot be told apart from a merge no reviewer has
 * reached yet, so it must not park a ticket that is merely waiting on a human
 * at the forge.
 */
export const finalizationUnavailableKinds = [
  "RepositoryUnbound",
  "TargetUnreadable",
  "ProposalBaseUnreadable",
  "ProposalBaseIsHead",
  "ProposalDenied",
  "ReconciliationUnreadable",
  "ProposalEvidenceUnstorable",
  "ProposalAbsent",
  "ProposalUnaddressed",
  "ProposalUnavailable",
  "PreparationRestartsExhausted",
  "ProposalCreationsExhausted",
  "ProposalMergesExhausted",
] as const;
export type FinalizationUnavailableKind =
  (typeof finalizationUnavailableKinds)[number];

/**
 * What a git act reported instead of free text, restating the interpreter's
 * `allGitEvidence`. It is the third evidence roster, and the one with nowhere
 * else to be read from: a source no reader could reach leaves no execution row
 * behind, so the label the observation carried is the only account of the wall
 * and the escalation carries it itself.
 */
export const gitEvidences = [
  "RemoteUnreachable",
  "RemoteDenied",
  "RefUnreadable",
  "ObjectMissing",
  "IntegrationFailed",
  "PromotionTimedOut",
] as const;
export type GitEvidenceLabel = (typeof gitEvidences)[number];

/**
 * Where an operator resume re-enters a parked ticket, in the order the model
 * declares them. The model's `NoResume` is not among them: it is that union's
 * absent value, and the only escalation it answers for is the absent one, which
 * the wire omits the whole object for — so every escalation the wire does name
 * carries a point out of this list.
 */
export const resumePoints = [
  "ResumeWork",
  "ResumeRework",
  "ResumeEvaluation",
  "ResumeFinalization",
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

export const executionOutcomes = [
  "Passed",
  "Failed",
  "Blocked",
  "ProcessFailed",
] as const;
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

/**
 * The refusals the machine decides, in the model's spelling. Each arrives with
 * the refusal itself beside its code, which is what names the dependency, task
 * or attempt it was refused over.
 */
export const operationTicketRefusalCodes = [
  "TicketAlreadyExists",
  "DependenciesNotFound",
  "SelfDependency",
  "TicketNotFound",
  "TicketNotPending",
  "TicketIdentityMismatch",
  "TicketRevisionStale",
  "TicketDependenciesChanged",
  "DependenciesIncomplete",
  "TicketNotRevocable",
  "TicketNotResumable",
  "TaskNotCurrent",
  "FinalizationNotCurrent",
] as const;
export type OperationTicketRefusalCode =
  (typeof operationTicketRefusalCodes)[number];

/** The refusals the boundary decides about rows or a remote, which carry no more than their code. */
export const operationBoundaryRefusalCodes = [
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
  "ExecutionSourceUnreadable",
  "ExecutionSourceDenied",
  "BriefNamesNoRepository",
  "TicketCapacityReached",
  "FinalizationRequestClosed",
] as const;
export type OperationBoundaryRefusalCode =
  (typeof operationBoundaryRefusalCodes)[number];

export const operationRefusalCodes = [
  ...operationTicketRefusalCodes,
  ...operationBoundaryRefusalCodes,
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
export type SelectorMode = (typeof selectorModes)[number];

/** What a minted forge credential may do to the repository it is scoped to. */
export const forgeCredentialPermissions = ["read", "write", "propose"] as const;
export type ForgeCredentialPermission =
  (typeof forgeCredentialPermissions)[number];

/** Every forge a tenant may claim an installation on. */
export const forgeIds = ["github"] as const;
export type ForgeIdentity = (typeof forgeIds)[number];

/** Every app a tenant installs, the api holding a key for each it answers a claim on. */
export const forgeApps = ["portal", "worker"] as const;
export type ForgeAppName = (typeof forgeApps)[number];

/** Every kind of account a forge installs an app on. */
export const forgeAccountKinds = ["User", "Organization"] as const;
export type ForgeAccountKindName = (typeof forgeAccountKinds)[number];

/** Whether a repository this tree creates is its account's alone to read. */
export const forgeRepositoryVisibilities = ["private", "public"] as const;
export type ForgeRepositoryVisibilityName =
  (typeof forgeRepositoryVisibilities)[number];

/** Why a newly bound repository came away with no configurations of its own. */
export const projectRepositoryConfigurationDeferrals = [
  "NotConfigured",
  "NoBootstrapImage",
  "DefaultBranchAbsent",
  "DefaultBranchUnavailable",
  "RepositoryAbsent",
  "SnapshotAbsent",
  "SnapshotUnavailable",
  "SnapshotRefused",
  "DeclarationsRefused",
  "IdentityConflict",
  "StaleBinding",
  "NotFound",
  "ParentNotFound",
  "StepFailed",
] as const;
export type ProjectRepositoryConfigurationDeferralName =
  (typeof projectRepositoryConfigurationDeferrals)[number];

/** Whether a selector proposal is dispatched or held for a reviewer. */
export const selectorDispatchModes = ["Automatic", "ApprovalRequired"] as const;
export type SelectorDispatchMode = (typeof selectorDispatchModes)[number];

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

/**
 * How a finalization lands one ticket's work on the reference its brief names:
 * by advancing that reference, by opening a change proposal into it, or by
 * landing nothing at all — `None` being a landing like any other rather than a
 * finalizer that does not run, one that reports at once and touches no remote.
 * `src/interpreter/ticketBrief.ts` takes `BriefFinalizationMode` from here.
 */
export const briefFinalizationModes = [
  "Push",
  "PullRequest",
  "PullRequestMerge",
  "None",
] as const;
export type BriefFinalizationMode = (typeof briefFinalizationModes)[number];

/** Whether a mode lands by opening a change proposal rather than advancing a reference directly. */
export function briefFinalizationProposes(mode: string | undefined): boolean {
  return mode === "PullRequest" || mode === "PullRequestMerge";
}

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
  FinalizationApproval: ["Approve", "Decline"],
} as const;

/** Every resolution the wire names, which is every kind's flattened in kind order. */
export const nativeActionResolutions = [
  ...nativeActionKindResolutions.TicketEscalation,
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
