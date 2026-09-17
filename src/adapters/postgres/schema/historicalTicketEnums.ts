/** Enum values used by historical ticket schema migrations. */

export const finalizationOutcomeTags = [
  "FinalizationSucceeded",
  "FinalizationFailed",
  "PromotionAccepted",
  "HandoffPublicationUnproven",
] as const;

export const phaseTags = [
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

export const reasonTags = [
  "NoReason",
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

export const resumeTags = [
  "NoResume",
  "ResumeWorking",
  "ResumeReworking",
  "ResumeEvaluating",
  "ResumeFinalizing",
  "ResumePublishingHandoff",
] as const;

export const verdictTags = ["Pass", "Fail"] as const;

export const allRefusalCodes = [
  "NotEnabled",
  "AuthoringChanged",
  "ConfigurationInvalid",
  "TicketChanged",
  "SelectionChanged",
  "ExecutionSourceUnreadable",
  "ExecutionSourceDenied",
  "BriefNamesNoRepository",
];

export const inputBundleIdentityKind = "InputBundle";

export const allFinalizationRequestKinds = [
  "RunFinalizer",
  "PromoteForHandoff",
  "PublishHandoff",
] as const;
export const allFinalizationAttemptOutcomes = ["Prepared", "Failed"] as const;
export const allFinalizationFailureKinds = [
  "MergeConflict",
  "PreparationFailed",
] as const;
export const allCommitPermitStates = ["Granted", "Concluded"] as const;
export const allReconciliationVerdicts = [
  "Promoted",
  "NotPromoted",
  "Unreadable",
] as const;

export const allIntegrationStrategies = ["Merge"] as const;
export const inputBundleReferencesMax = 1_024;
export const finalizerAuthorityKind = "Finalizer";
export const finalizerKeyVersion = "finalizer-v1";
export const finalizerIdentityCharsMax = 256;

export const spawnRequestKinds = ["SpawnWork", "SpawnEvaluation"];

export const allAttemptStates = [
  "Placing",
  "Running",
  "Reported",
  "Lost",
  "Withdrawn",
  "Superseded",
];

export const allBlockedReasons = [
  "ExecutionPolicyDenied",
  "TicketConfigIncompatible",
  "ExecutionProfileUnavailable",
  "RuntimeVersionUnsupported",
  "RequiredCapabilityUnavailable",
];

export const allExecutionOutcomes = ["Passed", "Failed", "Blocked"];

export const allExecutionStatuses = [
  "Queued",
  "Admitted",
  "Launching",
  "Running",
  "Terminal",
  "Cancelled",
];

export const allSchedulerIncidentKinds = [
  "ConflictingResult",
  "ConflictingRegistration",
  "ImpossibleState",
  "CrossProjectReference",
];

export const executionCapacityDefaults = {
  cluster: "default",
  clusterSlotsMax: 64,
  accountReserved: 1,
  accountMaximum: 8,
} as const;

export const executionSchedulerAuthorityKind = "ExecutionScheduler";

export const schedulerEvidenceCharsMax = 1_024;

export const authorityCharsMax = 256;

export const operationCommandCharsMax = 65_536;

export const operationIdentityCharsMax = 256;

export const repositoryBindingsPerImportMax = 1_000;

export const allNativeActionKinds = [
  "TicketEscalation",
  "HandoffBlock",
  "FinalizationApproval",
] as const;

export const allAgenticRefusalEvents = ["Refused", "Lifted"] as const;

export const allNativeActionResolutions = [
  "Resume",
  "Revoke",
  "RetryHandoff",
  "AbandonHandoff",
  "Approve",
  "Decline",
] as const;

export const nativeActionResolutions = {
  TicketEscalation: ["Resume", "Revoke"],
  HandoffBlock: ["RetryHandoff", "AbandonHandoff"],
  FinalizationApproval: ["Approve", "Decline"],
} as const;

export const safetyResolution = "Revoke";

export const finalizationDigestFormat = "chuggy:finalization:v1";

export const inputBundleCanonicalPart = "bundle";

export const briefFinalizationDefault = { mode: "Push" };

export const handoffOutputBytesMaxLimit = 262_144;

export const handoffPathCharsMax = 512;

export const allArtifactRoles = ["Handoff", "Diagnostic"] as const;
export const artifactBytesMax = 1_073_741_824;
export const artifactDigestChars = 64;
export const artifactPathCharsMax = 256;
export const manifestArtifactsMax = 256;
export const manifestBytesMax = 5_368_709_120;
export const resultDigestFoldHexChars = 13;
export const resultReportCharsMax = 8_192;

export const allThreadWakeReasons = [
  "TicketRefused",
  "RefusalLifted",
  "DraftDeleted",
  "TicketEscalated",
  "TicketCompleted",
  "TicketAbandoned",
] as const;

export const admittedWorkerNameCharsMax = 128;

export const historicalRunCostBases = ["List"] as const;

export const briefLineCharsMax = 512;
export const briefTitleCharsMax = 256;
export const briefIntentCharsMax = 16_384;
export const briefLinksMax = 8;
export const briefChecksMax = 8;
export const briefBranchCharsMax = 256;
export const briefLinkScheme = "https://";
export const briefBranchPrefix = "refs/heads/";

export const allSessionCapabilities = [
  "RepositoryRead",
  "RepositoryWrite",
  "RunCommands",
  "ProjectRead",
  "DraftAuthor",
  "DraftOriginate",
  "LeadDecision",
] as const;
export const leadSessionCapabilities = [
  "RepositoryRead",
  "ProjectRead",
  "DraftAuthor",
  "LeadDecision",
] as const;
export const leadToolAllowlist = [
  "Glob",
  "Grep",
  "Read",
  "mcp__chuggy__list_tickets",
  "mcp__chuggy__read_ticket",
  "mcp__chuggy__read_decision_log",
  "mcp__chuggy__read_refusals",
  "mcp__chuggy__read_ticket_refusals",
  "mcp__chuggy__read_projects",
  "mcp__chuggy__read_lead",
  "mcp__chuggy__read_lead_transcript",
  "mcp__chuggy__list_executions",
  "mcp__chuggy__read_execution",
  "mcp__chuggy__read_run_transcript",
  "mcp__chuggy__read_operation",
  "mcp__chuggy__list_threads",
  "mcp__chuggy__read_thread",
  "mcp__chuggy__read_thread_transcript",
  "mcp__chuggy__update_ticket",
  "mcp__chuggy__dispatch_ticket",
  "mcp__chuggy__revoke_ticket",
  "mcp__chuggy__resume_ticket",
  "mcp__chuggy__dispatch",
  "mcp__chuggy__refuse",
  "mcp__chuggy__lift",
  "mcp__chuggy__set_attention",
  "mcp__chuggy__set_handoff_note",
  "mcp__chuggy__set_planning_intent",
] as const;
export const allInputBundleReferenceKinds = [
  "ResultManifest",
  "ConfigurationRevision",
  "Repository",
  "FinalizationAttempt",
  "ConflictManifest",
  "TargetCommit",
] as const;
