/** Closed sets carried by the surviving public repository and session APIs. */

export const notificationKinds = [
  "Operation",
  "Ticket",
  "Draft",
  "Configuration",
  "Project",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export const forgeCredentialPermissions = ["read", "write", "propose"] as const;
export type ForgeCredentialPermission =
  (typeof forgeCredentialPermissions)[number];

export const forgeIds = ["github"] as const;
export type ForgeIdentity = (typeof forgeIds)[number];

export const forgeApps = ["portal", "worker"] as const;
export type ForgeAppName = (typeof forgeApps)[number];

export const forgeAccountKinds = ["User", "Organization"] as const;
export type ForgeAccountKindName = (typeof forgeAccountKinds)[number];

export const forgeRepositoryVisibilities = ["private", "public"] as const;
export type ForgeRepositoryVisibilityName =
  (typeof forgeRepositoryVisibilities)[number];

export const briefFinalizationModes = [
  "Push",
  "PullRequest",
  "PullRequestMerge",
] as const;
export type BriefFinalizationMode = (typeof briefFinalizationModes)[number];

export function briefFinalizationProposes(mode: string | undefined): boolean {
  return mode === "PullRequest" || mode === "PullRequestMerge";
}

export const sessionStates = ["Open", "Closed"] as const;
export type SessionState = (typeof sessionStates)[number];

export const threadStandings = ["Open", "Closed", "Orphaned"] as const;
export type ThreadStanding = (typeof threadStandings)[number];

export const threadMessageRefusalCodes = [
  "NotYourThread",
  "ThreadClosed",
  "ThreadBacklogged",
  "ThreadTurnTooLarge",
] as const;
export type ThreadMessageRefusalCode =
  (typeof threadMessageRefusalCodes)[number];

export const sessionTurnInputKinds = [
  "Observation",
  "UserMessage",
  "Wake",
  "Inquiry",
] as const;
export type SessionTurnInputKind = (typeof sessionTurnInputKinds)[number];

export const sessionTurnStates = [
  "Queued",
  "Claimed",
  "Answered",
  "Failed",
  "Abandoned",
] as const;
export type SessionTurnState = (typeof sessionTurnStates)[number];

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
