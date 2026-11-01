/**
 * The authenticated native-web application boundary.
 *
 * Authorization answers with the audited authority rather than a boolean, so
 * no transport can authorize one subject and record another. Reads and
 * cancellation deliberately share the same not-found result for absent and
 * inaccessible resources. This layer coordinates ports; it neither loads the
 * project actor nor owns a database transaction.
 */

import { isSessionStoreStream } from "../contract/sessionPlane.ts";
import {
  asSessionStoreStream,
  type SessionId,
  type SessionStoreStream,
  type SessionTurnId,
} from "./agentSession.ts";
import {
  authorizedProjectMutation,
  authorizedProjectRead,
  authorizedProjectValue,
  type AuthorizedResult,
} from "./authorizedProject.ts";
import {
  overridesAccess,
  overridesNamed,
  overridesRevisionAccess,
} from "./overridesAccess.ts";
export type { AuthorizedResult } from "./authorizedProject.ts";

import type { Principal } from "./principal.ts";
import type { ReleaseAuthoringProgram } from "../contract/authoring.ts";
import type { ConfigurationOverrides } from "../contract/configurationOverrides.ts";
import type { EscalationKind, ResumePoint } from "../contract/rosters.ts";
import { assertNever } from "../domain/assertNever.ts";
import { phaseTags, type Phase } from "../domain/phase.ts";
import { asTicketId, type TicketId } from "../domain/ids.ts";
import type {
  Accepted,
  Cancelled,
  IdempotencyKey,
  OperationId,
  OperationState,
  Submission,
} from "./operationInbox.ts";
import type { OperationInbox } from "./operationInbox.ts";
import {
  leadInquiryAsked,
  leadInquiryEntry,
  leadInquiryTurnInput,
  type LeadInquiriesRead,
  type LeadInquiryAsked,
  type LeadInquiryEntry,
  type LeadInquiryRead,
  type LeadInquiryRecord,
  type LeadInquiryStore,
} from "./leadInquiry.ts";
import type { Partition } from "./projectStore.ts";
import type {
  NativeActionKind,
  NativeActionResolution,
  ProjectCommand,
} from "./projectCommand.ts";
import type { Refusal } from "./refusal.ts";
import type {
  AuthoringStore,
  ConfigurationPage,
  ConfigurationPageQuery,
  ConfigurationRevisionResource,
  ConfigurationRevisionId,
  DraftCreated,
  DraftInitializationRead,
  DraftDeleted,
  DraftLanding,
  DraftPage,
  DraftPageQuery,
  DraftResource,
  DraftRevised,
  ReleaseAuthoring,
} from "./authoring.ts";
import {
  checkedConfigurationPageQuery,
  checkedDraftPageQuery,
  draftInitializationPolicy,
  ticketCommandedCheckStage,
  ticketCommandedCheckStageNote,
  ticketConfigurationReadiness,
  ticketProgramShort,
} from "./authoring.ts";
import type { ConfigurationSelection } from "../contract/configurationSelection.ts";
import { asBriefFinalization, type DraftBrief } from "./ticketBrief.ts";
import { catalogSelectedFinalizer } from "./workloadConfiguration.ts";
import type { ConfigurationVersion } from "./repositoryConfigurationIdentity.ts";
import {
  dispatchNeedsExecutionHeadroom,
  type BacklogScope,
  type ExecutionBacklogGuard,
} from "./schedulerContext.ts";
import {
  checkedNotificationCursor,
  type NotificationBatch,
  type NotificationCursor,
  type NotificationStore,
} from "./notifications.ts";
import type {
  DispatchViewPage,
  DispatchViewQuery,
  DispatchViewStore,
} from "./dispatchView.ts";
import { checkedDispatchViewQuery } from "./dispatchView.ts";
import {
  checkedExecutionListQuery,
  checkedLatestExecutionListQuery,
  type ExecutionListQuery,
  type ExecutionPage,
  type ExecutionResource,
  type ExecutionSummary,
  type LatestExecutionListQuery,
  type LatestExecutionPage,
  type OperationalReadStore,
  type OutputContentPort,
  type OutputContentRead,
  type ProjectOperationalStatus,
  type TicketLatestExecution,
  ticketLatestExecution,
} from "./operationsView.ts";
import {
  checkedRunTranscriptAfter,
  checkedRunTurnsQuery,
  runConfigurationPath,
  type RunConfigurationRead,
  type RunEvidenceContentPort,
  type RunEvidenceContentRead,
  type RunEvidenceReadStore,
  type RunTotals,
  type RunTranscriptBatch,
  type RunTranscriptRead,
  type RunTurnsPage,
  type RunTurnsQuery,
} from "./runEvidence.ts";
import type { AttemptId, ExecutionId } from "./schedulerIdentity.ts";
import type { AttemptEvidence } from "./executionScheduler.ts";
import type { RunStepEvidence } from "./runEvidence.ts";
import { type PublicInstant } from "./publicResource.ts";
import { hostedRunsGranted, memberAuthorities } from "./projectAccess.ts";
import { projectAbilities } from "./projectAbilities.ts";
import type {
  ProjectAbilitiesResponse,
  TicketFollowing,
} from "../contract/responses.ts";
import type { ProjectAccess, ProjectAccessKind } from "./projectAccess.ts";
import type { Authority } from "./operationInbox.ts";
import type {
  SelectorOperationalContext,
  SelectorRuntimeSettingsSource,
} from "./selector.ts";
import {
  sessionSpendRoute,
  type SessionRouteReads,
} from "./sessionPlacement.ts";
import type { SelectorOperationalContextRead } from "./selectorOperationalContext.ts";
import {
  agenticRefusals,
  checkedAgenticRefusalsLimit,
  type AgenticRefusalRead,
  type AgenticRefusalsRead,
  type TicketAgenticRefusalsRead,
} from "./agenticRefusal.ts";
import {
  checkedLeadTranscriptQuery,
  leadNotNeeded,
  leadAwaitingSelector,
  leadPaused,
  leadSelectorNotGranted,
  leadSelectorUnnamed,
  leadTranscriptPage,
  sessionHeldWalk,
  sessionHeldWalkAsks,
  type LeadAbsence,
  type LeadRead,
  type LeadReadStore,
  type LeadTranscriptQuery,
  type LeadTranscriptRead,
  type SessionHeldWalk,
  type SessionStoreRowsRead,
  type SessionTranscriptSubject,
} from "./leadRead.ts";
import {
  selectorHistory,
  type SelectorHistoryQuery,
  type SelectorHistoryRead,
  type SelectorHistoryStore,
} from "./selectorHistory.ts";
import type { SessionStoreReadPort, SessionStoreRead } from "./sessionStore.ts";
import {
  agenticRefusalLedgerAnsweredMax,
  leadTurnsAnsweredMax,
  sessionStoreStreamsAnswered,
  workerErrorPath,
} from "../contract/http.ts";
import type { RepositoryId } from "./finalizer.ts";
import type { ProjectRepositoryLandingStore } from "./repositoryBinding.ts";
import {
  importRepositoryConfigurationsAtHead,
  readRepositoryConfigurationHead,
  type RepositoryConfigurationHeadImportPorts,
  type RepositoryConfigurationHeadOutcome,
  type RepositoryConfigurationImportOutcome,
} from "./repositoryConfiguration.ts";
import {
  threadSystemPrompt,
  threadTurnInput,
  threadTurnInputCharsMax,
  type ThreadSeededImage,
} from "./thread.ts";
import {
  checkedThreadMailboxQuery,
  checkedThreadMessage,
  checkedThreadMessageImages,
  checkedThreadsLimit,
  threadEntry,
  threadMessageImages,
  threadMessageSent,
  threadSeeding,
  threadTurnStopping,
  type ThreadClosing,
  type ThreadEntry,
  type ThreadHiding,
  type ThreadRenaming,
  type ThreadMailboxQuery,
  type ThreadMessageImagesChecked,
  type ThreadMessageSent,
  type ThreadOpenKey,
  type ThreadOpening,
  type ThreadRead,
  type ThreadRecord,
  type ThreadSeedingRead,
  type ThreadSessionMint,
  type ThreadTurnStopping,
  type ThreadStore,
  type ThreadsRead,
} from "./threadRead.ts";
import {
  inquiriesAnsweredMax,
  isBoundedText,
  threadsAnsweredMax,
  ticketSearchCharsMax,
} from "../contract/http.ts";
import { resolvedThreadStandingRules } from "../contract/threadSeeding.ts";
import {
  projectArtifactFetched,
  projectArtifactUploaded,
  type ProjectArtifactFetched,
  type ProjectArtifactMinting,
  type ProjectArtifactUploaded,
} from "./projectArtifact.ts";
import type {
  ProjectArtifactId,
  ProjectArtifactPort,
} from "./finalizerPreparation.ts";
export { asPublicInstant, type PublicInstant } from "./publicResource.ts";
export { asPrincipal, oidcPrincipal, type Principal } from "./principal.ts";
export {
  allProjectAccessKinds,
  asProjectAccessKind,
  type ProjectAccess,
  type ProjectAccessKind,
} from "./projectAccess.ts";

export interface ProjectInventory {
  projects(
    principal: Principal,
    after: Partition | undefined,
    limit: number,
  ): Promise<ProjectInventoryPage>;
}

export interface ProjectInventoryPage {
  readonly projects: readonly Partition[];
  readonly nextAfter?: Partition;
}

interface OperationResourceBase {
  readonly operation: OperationId;
  readonly acceptedAt: PublicInstant;
  readonly state: OperationState;
}

/** The safe public operation shape; stored commands and authority never cross it. */
export type OperationResource =
  | (OperationResourceBase & { readonly state: "Pending" })
  | (OperationResourceBase & {
      readonly state: "Succeeded";
      readonly decidedSequence: number;
    })
  | (OperationResourceBase & {
      readonly state: "Refused";
      /** What refused it: the machine's refusal whole, or the boundary's code. */
      readonly refusal: Refusal;
      readonly refusedHead: number;
      readonly refusedLifecycleGeneration: number;
    })
  | (OperationResourceBase & { readonly state: "Answered" })
  | (OperationResourceBase & { readonly state: "Cancelled" });

/** A runner a job ran on: one of the project's pools by its name, or a member's own runner by the member it is. */
export type RunnerResource =
  | { readonly kind: "Pool"; readonly pool: string }
  | { readonly kind: "Personal"; readonly owner: Principal };

/**
 * The job a parked ticket waits on where every task it waits on was lost on
 * the runner that claimed it: the newest such attempt, how many times the job
 * was lost where it stands in the ticket, and how many of those the scheduler
 * resumed by itself.
 */
export interface RunnerLossResource {
  readonly runner: RunnerResource;
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
  readonly evidence: AttemptEvidence;
  /** The text its worker kept, which is read on the attempt's own route. */
  readonly error?: { readonly bytes: number };
  readonly losses: number;
  readonly resumed: number;
}

/** The task a parked ticket waits on where its run stopped at a failed step, and the attempt it stopped on. */
export interface RunStepFailureResource {
  readonly evidence: RunStepEvidence;
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
  /** The text its worker kept, which is read on the attempt's own route. */
  readonly error?: { readonly bytes: number };
}

/**
 * Where a parked ticket stands, as its own read and a project's page both carry
 * it: the wall, what the fabric said about that wall, and where a resume
 * re-enters. The resume is derived from the wall at the read and stored
 * nowhere, so this object cannot name a point the wall does not imply.
 */
export interface TicketEscalationResource {
  readonly kind: EscalationKind;
  readonly evidence?: string;
  readonly resumeAt: ResumePoint;
  /** Present where the wall is a job lost on its runner. */
  readonly lost?: RunnerLossResource;
  /** Present where the wall is a task whose run stopped at a failed step. */
  readonly failed?: RunStepFailureResource;
}

/**
 * Where a resume at this wall re-enters: the domain's `resumeOf` of every
 * state parked at it, which the stored row names by its kind alone.
 */
export function ticketEscalationResumeAt(kind: EscalationKind): ResumePoint {
  switch (kind) {
    case "WorkFailureEscalated":
    case "WorkExecutionUnavailableEscalated":
      return "ResumeWork";
    case "EvaluationFailureEscalated":
      return "ResumeRework";
    case "EvaluationBlockedEscalated":
      return "ResumeEvaluation";
    case "FinalizationUnavailableEscalated":
      return "ResumeFinalization";
    default:
      return assertNever(kind);
  }
}

/** The escalation the desk offers for one wall. */
export function ticketEscalationResource(
  kind: EscalationKind,
  evidence?: string,
  waiting: {
    readonly lost?: RunnerLossResource | undefined;
    readonly failed?: RunStepFailureResource | undefined;
  } = {},
): TicketEscalationResource {
  const resumeAt = ticketEscalationResumeAt(kind);
  return {
    kind,
    ...(evidence === undefined ? {} : { evidence }),
    resumeAt,
    ...(waiting.lost === undefined ? {} : { lost: waiting.lost }),
    ...(waiting.failed === undefined ? {} : { failed: waiting.failed }),
  };
}

/** A dependency a ticket waits on, and the phase that dependency is at. */
export interface TicketDependencyResource {
  readonly ticket: TicketId;
  readonly phase: Phase;
}

/**
 * The escalation is present exactly when the ticket is parked on the desk, and
 * the brief exactly when it was authored with one. Its two
 * instants are the journal's:
 * `changedAt` is when the entry `sequence` names committed, and `releasedAt`
 * when the entry releasing this ticket did — absent when no entry the reader can
 * parse says it released this ticket.
 */
export interface TicketResource {
  readonly ticket: TicketId;
  readonly title?: string;
  /** The repository the ticket's released brief names. */
  readonly repository?: string;
  /** Which revision of its definition the ticket is at: one at release, one more per update. */
  readonly revision: number;
  /** The authority subject of the member whose first authoring revision filed the ticket. */
  readonly creator?: string;
  readonly phase: Phase;
  readonly sequence: number;
  readonly changedAt: PublicInstant;
  readonly releasedAt?: PublicInstant;
  readonly escalation?: TicketEscalationResource;
  /**
   * Which of this ticket's own dependencies their authors revoked, ascending.
   * Nothing ever completes one, so a Pending ticket listing any is waiting on
   * a dependency that will never be Done; only a Pending ticket is read for
   * them, because a ticket in any other phase — including one revoked out of
   * the same wait — is waiting on nothing.
   */
  readonly revokedDependencies: readonly TicketId[];
  /**
   * Which of this ticket's own dependencies are neither Done nor Revoked,
   * each with its phase, ascending: the wait that can still end, where
   * `revokedDependencies` is the wait that cannot, so no dependency is in both.
   * Only a Pending ticket is read for them, because a ticket in any other
   * phase had every dependency Done before it was dispatched.
   */
  readonly openDependencies: readonly TicketDependencyResource[];
  readonly brief?: DraftBrief;
  /** The configuration the ticket's last release or update pinned, which is what it runs under. */
  readonly configurationRevision?: ConfigurationRevisionId;
  readonly configurationVersion?: ConfigurationVersion;
  /** What the ticket's last release or update replaced of that configuration. */
  readonly overrides?: ConfigurationOverrides;
  /** What the ticket's last release or update selected of that configuration. */
  readonly selection?: ConfigurationSelection;
  /**
   * The evaluation program the ticket's last release or update was resolved
   * from, which is what its evaluation runs; its draft may since hold another.
   */
  readonly program?: ReleaseAuthoringProgram;
  /** The dependencies that same release or update named, ascending; its draft may since name others. */
  readonly dependencies?: readonly TicketId[];
  /** Where a Pending ticket that follows stands against the revision its repository's newest import declares under the same name. */
  readonly following?: TicketFollowing;
  readonly runTotals?: RunTotals;
  /** The execution `latestExecutions` answers for the ticket, where one has run; only the tickets list carries it. */
  readonly latestExecution?: TicketLatestExecution;
}

/**
 * One question a ticket has open, with the fence a resolution must name and the
 * answers this action offered. Those are what was recorded when the action was
 * opened, which is a subset of what its kind may ask for.
 */
export interface TicketNativeAction {
  readonly action: string;
  readonly kind: NativeActionKind;
  readonly authorizingSequence: number;
  readonly admits: readonly NativeActionResolution[];
}

/** The same action listed across a project, where the ticket is not the path. */
export interface ProjectNativeAction extends TicketNativeAction {
  readonly ticket: TicketId;
}

/** Where a page of open actions resumes: the fence, and the identity that breaks its tie. */
export interface NativeActionPosition {
  readonly authorizingSequence: number;
  readonly action: string;
}

export interface NativeActionPageQuery {
  readonly after?: NativeActionPosition;
  readonly limit: number;
}

export interface NativeActionPage {
  readonly actions: readonly ProjectNativeAction[];
  readonly nextAfter?: NativeActionPosition;
}

export const nativeActionPageLimitMax = 100;

export function checkedNativeActionPageQuery(
  query: NativeActionPageQuery,
): NativeActionPageQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > nativeActionPageLimitMax
  )
    throw new RangeError(
      `native action page limit must be between 1 and ${String(nativeActionPageLimitMax)}`,
    );
  if (
    query.after !== undefined &&
    (!Number.isSafeInteger(query.after.authorizingSequence) ||
      query.after.authorizingSequence < 1 ||
      query.after.action.length === 0)
  )
    throw new RangeError("native action page cursor is invalid");
  return query;
}

export interface ProjectResource {
  readonly partition: Partition;
  readonly sequence: number;
  readonly tickets: readonly TicketResource[];
  readonly nextAfter?: TicketId;
  readonly nextRecentActivityAfter?: TicketActivityPosition;
  readonly nextNumberAfter?: TicketNumberPosition;
  /** How many tickets the search matched across the project, where the read named one. */
  readonly matched?: number;
}

export interface TicketActivityPosition {
  readonly sequence: number;
  readonly ticket: TicketId;
}

/** A position in one of the two orders by ticket number, which names its order so the other refuses it. */
export interface TicketNumberPosition {
  readonly order: TicketNumberOrder;
  readonly ticket: TicketId;
}

export type TicketNumberOrder = "Newest" | "Oldest";

export type TicketListOrder = "Identity" | "RecentActivity" | TicketNumberOrder;

export interface ProjectReadQuery {
  readonly after?: TicketId;
  readonly recentActivityAfter?: TicketActivityPosition;
  readonly numberAfter?: TicketNumberPosition;
  readonly order?: TicketListOrder;
  readonly limit: number;
  readonly minimumSequence?: number;
  readonly phaseFilter?: TicketPhaseFilter;
  /** Trimmed text a ticket's title holds, ignoring case, or its number, with or without a leading `#`. */
  readonly search?: string;
  /** Only the tickets `ticketActiveFinishedHours` names active. */
  readonly active?: boolean;
}

export type TicketPhaseFilter =
  | { readonly selection: "NonTerminal" }
  | { readonly selection: "Selected"; readonly phases: readonly Phase[] };

export type ProjectRead =
  | { readonly result: "NotFound" }
  | { readonly result: "Behind"; readonly observedSequence: number }
  | { readonly result: "Found"; readonly project: ProjectResource };

export const projectPageLimitMax = 100;

export function checkedProjectReadQuery(
  query: ProjectReadQuery,
): ProjectReadQuery {
  if (
    query.order !== undefined &&
    query.order !== "Identity" &&
    query.order !== "RecentActivity" &&
    query.order !== "Newest" &&
    query.order !== "Oldest"
  )
    throw new RangeError("ticket list order is invalid");
  if (
    query.order !== undefined &&
    query.order !== "Identity" &&
    query.after !== undefined
  )
    throw new RangeError("ticket identity cursor orders identity alone");
  if (
    query.numberAfter !== undefined &&
    query.numberAfter.order !== query.order
  )
    throw new RangeError("ticket number cursor belongs to another order");
  if (
    query.search !== undefined &&
    (query.search.trim() !== query.search ||
      !isBoundedText(query.search, ticketSearchCharsMax))
  )
    throw new RangeError(
      `ticket search must be from 1 to ${String(ticketSearchCharsMax)} characters, trimmed`,
    );
  if (
    query.order !== "RecentActivity" &&
    query.recentActivityAfter !== undefined
  )
    throw new RangeError(
      "ticket activity cursor requires recent activity order",
    );
  if (
    query.recentActivityAfter !== undefined &&
    (!Number.isSafeInteger(query.recentActivityAfter.sequence) ||
      query.recentActivityAfter.sequence < 0)
  )
    throw new RangeError("ticket activity sequence is invalid");
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > projectPageLimitMax
  )
    throw new RangeError(
      `project page limit must be between 1 and ${String(projectPageLimitMax)}`,
    );
  if (
    query.minimumSequence !== undefined &&
    (!Number.isSafeInteger(query.minimumSequence) || query.minimumSequence < 0)
  )
    throw new RangeError(
      "minimum project sequence must be a non-negative safe integer",
    );
  if (query.phaseFilter?.selection === "Selected") {
    const phases = query.phaseFilter.phases;
    if (
      phases.length < 1 ||
      phases.length > phaseTags.length ||
      new Set(phases).size !== phases.length ||
      phases.some((phase) => !phaseTags.includes(phase))
    )
      throw new RangeError("ticket phase selection is invalid");
  }
  return query;
}

/** The ticket a search names by number, where it is a whole number with or without a leading `#`. */
export function ticketSearchNumber(search: string): TicketId | undefined {
  const digits = /^#?(\d+)$/u.exec(search)?.[1];
  if (digits === undefined) return undefined;
  const number = Number(digits);
  return Number.isSafeInteger(number) && number >= 1
    ? asTicketId(number)
    : undefined;
}

/** Projection and operation reads answered without activating a project writer. */
export interface NativeReadStore {
  operation(
    partition: Partition,
    operation: OperationId,
  ): Promise<OperationResource | undefined>;
  project(partition: Partition, query: ProjectReadQuery): Promise<ProjectRead>;
  ticket(
    partition: Partition,
    ticket: TicketId,
  ): Promise<TicketResource | undefined>;
  ticketNativeActions(
    partition: Partition,
    ticket: TicketId,
  ): Promise<readonly TicketNativeAction[] | undefined>;
  nativeActions(
    partition: Partition,
    query: NativeActionPageQuery,
  ): Promise<NativeActionPage>;
}

export interface NativeSubmission {
  readonly partition: Partition;
  readonly operation: OperationId;
  readonly key: IdempotencyKey;
  readonly command: ProjectCommand;
  /** The session a command came through, where a session bearer is what carried it. */
  readonly viaSession?: SessionId;
}

/**
 * `ProgramSkipsPlannedEvaluations` is a release or an update whose program runs
 * less than its configuration plans, submitted by a caller not holding
 * `SkipPlannedEvaluations`; nothing was accepted.
 */
export type NativeSubmissionResult =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Backlogged";
      readonly scope: BacklogScope;
      readonly retryAfterSeconds: number;
    }
  | { readonly result: "ProgramSkipsPlannedEvaluations" }
  | { readonly result: "Authorized"; readonly acceptance: Accepted };

export type NativeCancellation =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly cancellation: Cancelled };

/** What creating a draft answers: the store's answer, a created draft beside the landing its brief was stored with. */
export type NativeDraftCreated =
  | Exclude<DraftCreated, { readonly created: "Created" }>
  | {
      readonly created: "Created";
      readonly draft: DraftResource;
      readonly landing: DraftLanding;
    };

/** What revising a draft answers: the store's answer, a revised draft beside the landing its brief was stored with. */
export type NativeDraftRevised =
  | Exclude<DraftRevised, { readonly revised: "Revised" }>
  | {
      readonly revised: "Revised";
      readonly draft: DraftResource;
      readonly landing: DraftLanding;
    };

export interface NativeWeb {
  submit(
    principal: Principal,
    submission: NativeSubmission,
  ): Promise<NativeSubmissionResult>;
  operation(
    principal: Principal,
    partition: Partition,
    operation: OperationId,
  ): Promise<OperationResource | undefined>;
  project(
    principal: Principal,
    partition: Partition,
    query: ProjectReadQuery,
  ): Promise<ProjectRead>;
  ticket(
    principal: Principal,
    partition: Partition,
    ticket: TicketId,
  ): Promise<TicketResource | undefined>;
  ticketNativeActions(
    principal: Principal,
    partition: Partition,
    ticket: TicketId,
  ): Promise<readonly TicketNativeAction[] | undefined>;
  nativeActions(
    principal: Principal,
    partition: Partition,
    query: NativeActionPageQuery,
  ): Promise<AuthorizedResult<NativeActionPage>>;
  operationalStatus(
    principal: Principal,
    partition: Partition,
  ): Promise<AuthorizedResult<ProjectOperationalStatus>>;
  selectorOperationalContext(
    principal: Principal,
    partition: Partition,
  ): Promise<AuthorizedResult<SelectorOperationalContext>>;
  hostedRuns(
    principal: Principal,
    partition: Partition,
  ): Promise<AuthorizedResult<boolean>>;
  abilities(
    principal: Principal,
    partition: Partition,
  ): Promise<AuthorizedResult<ProjectAbilitiesResponse>>;
  lead(principal: Principal, partition: Partition): Promise<LeadRead>;
  leadTranscript(
    principal: Principal,
    partition: Partition,
    query: LeadTranscriptQuery,
  ): Promise<LeadTranscriptRead>;
  agenticRefusals(
    principal: Principal,
    partition: Partition,
    limit: number,
  ): Promise<AgenticRefusalsRead>;
  ticketAgenticRefusals(
    principal: Principal,
    partition: Partition,
    ticket: TicketId,
  ): Promise<TicketAgenticRefusalsRead>;
  selectorHistory(
    principal: Principal,
    partition: Partition,
    query: SelectorHistoryQuery,
  ): Promise<SelectorHistoryRead>;
  executions(
    principal: Principal,
    partition: Partition,
    query: ExecutionListQuery,
  ): Promise<AuthorizedResult<ExecutionPage>>;
  latestExecutions(
    principal: Principal,
    partition: Partition,
    query: LatestExecutionListQuery,
  ): Promise<AuthorizedResult<LatestExecutionPage>>;
  execution(
    principal: Principal,
    partition: Partition,
    execution: ExecutionId,
  ): Promise<ExecutionResource | undefined>;
  executionSummary(
    principal: Principal,
    partition: Partition,
    execution: ExecutionId,
  ): Promise<ExecutionSummary | undefined>;
  outputContent(
    principal: Principal,
    partition: Partition,
    execution: ExecutionId,
    ordinal: number,
  ): Promise<OutputContentRead>;
  /** Mints an identity and writes the bytes behind it, asking `Mutate` because giving a project an image is a developer's act. */
  uploadProjectArtifact(
    principal: Principal,
    partition: Partition,
    mediaType: string,
    content: Uint8Array,
  ): Promise<AuthorizedResult<ProjectArtifactUploaded>>;
  /** Reads one project-owned artifact back, asking `Read` alone. */
  projectArtifact(
    principal: Principal,
    partition: Partition,
    artifact: ProjectArtifactId,
  ): Promise<ProjectArtifactFetched>;
  runTurns(
    principal: Principal,
    partition: Partition,
    execution: ExecutionId,
    attempt: AttemptId,
    query: RunTurnsQuery,
  ): Promise<RunTurnsPage | undefined>;
  runTranscript(
    principal: Principal,
    partition: Partition,
    execution: ExecutionId,
    attempt: AttemptId,
    after: number,
  ): Promise<RunTranscriptRead>;
  runConfiguration(
    principal: Principal,
    partition: Partition,
    execution: ExecutionId,
    attempt: AttemptId,
  ): Promise<RunConfigurationRead>;
  runError(
    principal: Principal,
    partition: Partition,
    execution: ExecutionId,
    attempt: AttemptId,
  ): Promise<RunEvidenceContentRead>;
  cancel(
    principal: Principal,
    partition: Partition,
    operation: OperationId,
  ): Promise<NativeCancellation>;
  configurations(
    principal: Principal,
    partition: Partition,
    query: ConfigurationPageQuery,
  ): Promise<AuthorizedResult<ConfigurationPage>>;
  /** Imports where the repository's default branch points now, and at no other commit. */
  importRepositoryConfigurations(
    principal: Principal,
    partition: Partition,
    source: { readonly repository: RepositoryId },
  ): Promise<RepositoryConfigurationImportOutcome>;
  repositoryConfigurationHead(
    principal: Principal,
    partition: Partition,
    repository: RepositoryId,
  ): Promise<RepositoryConfigurationHeadOutcome>;
  createDraft(
    principal: Principal,
    input: {
      readonly partition: Partition;
      readonly configurationRevision: ConfigurationRevisionId;
      readonly configurationDigest: string;
      readonly expectedProjectSequence: number;
      readonly authoring: ReleaseAuthoring;
      readonly brief: DraftBrief;
      readonly overrides?: ConfigurationOverrides;
      readonly selection?: ConfigurationSelection;
      /** The session whose bearer carried the request, which the draft keeps as the thread its events wake. */
      readonly originSession?: SessionId;
    },
  ): Promise<AuthorizedResult<NativeDraftCreated>>;
  initializeDraft(
    principal: Principal,
    partition: Partition,
    revision: ConfigurationRevisionId,
    selection?: ConfigurationSelection,
  ): Promise<AuthorizedResult<DraftInitializationRead>>;
  reviseDraft(
    principal: Principal,
    input: {
      readonly partition: Partition;
      readonly ticket: TicketId;
      readonly expectedVersion: number;
      readonly configurationRevision: ConfigurationRevisionId;
      readonly authoring: ReleaseAuthoring;
      readonly brief: DraftBrief;
      readonly overrides?: ConfigurationOverrides;
      readonly selection?: ConfigurationSelection;
    },
  ): Promise<AuthorizedResult<NativeDraftRevised>>;
  deleteDraft(
    principal: Principal,
    input: {
      readonly partition: Partition;
      readonly ticket: TicketId;
      readonly expectedVersion: number;
    },
  ): Promise<AuthorizedResult<DraftDeleted>>;
  notifications(
    principal: Principal,
    partition: Partition,
    cursor: NotificationCursor,
  ): Promise<AuthorizedResult<NotificationBatch>>;
  dispatchView(
    principal: Principal,
    partition: Partition,
    query: DispatchViewQuery,
  ): Promise<AuthorizedResult<DispatchViewPage>>;
  projectInventory(
    principal: Principal,
    after: Partition | undefined,
    limit: number,
  ): Promise<ProjectInventoryPage>;
  configuration(
    principal: Principal,
    partition: Partition,
    revision: ConfigurationRevisionId,
  ): Promise<ConfigurationRevisionResource | undefined>;
  draft(
    principal: Principal,
    partition: Partition,
    ticket: TicketId,
  ): Promise<DraftResource | undefined>;
  drafts(
    principal: Principal,
    partition: Partition,
    query: DraftPageQuery,
  ): Promise<AuthorizedResult<DraftPage>>;
  threads(principal: Principal, partition: Partition): Promise<ThreadsRead>;
  thread(
    principal: Principal,
    partition: Partition,
    session: SessionId,
    query: ThreadMailboxQuery,
  ): Promise<ThreadRead>;
  threadTranscript(
    principal: Principal,
    partition: Partition,
    session: SessionId,
    query: LeadTranscriptQuery,
  ): Promise<LeadTranscriptRead>;
  openThread(
    principal: Principal,
    partition: Partition,
    key: ThreadOpenKey,
  ): Promise<ThreadOpening>;
  sendThreadMessage(
    principal: Principal,
    partition: Partition,
    input: {
      readonly session: SessionId;
      readonly turn: SessionTurnId;
      readonly message: string;
      readonly images?: readonly string[];
    },
  ): Promise<ThreadMessageSent>;
  stopThreadTurn(
    principal: Principal,
    partition: Partition,
    input: { readonly session: SessionId; readonly turn: SessionTurnId },
  ): Promise<ThreadTurnStopping>;
  closeThread(
    principal: Principal,
    partition: Partition,
    session: SessionId,
  ): Promise<ThreadClosing>;
  renameThread(
    principal: Principal,
    partition: Partition,
    input: { readonly session: SessionId; readonly title: string },
  ): Promise<ThreadRenaming>;
  hideThread(
    principal: Principal,
    partition: Partition,
    input: { readonly session: SessionId; readonly hidden: boolean },
  ): Promise<ThreadHiding>;
  leadInquiries(
    principal: Principal,
    partition: Partition,
  ): Promise<LeadInquiriesRead>;
  leadInquiry(
    principal: Principal,
    partition: Partition,
    session: SessionId,
  ): Promise<LeadInquiryRead>;
  askLead(
    principal: Principal,
    partition: Partition,
    input: {
      readonly session: SessionId;
      readonly turn: SessionTurnId;
      readonly question: string;
    },
  ): Promise<LeadInquiryAsked>;
}

function submissionAccess(command: ProjectCommand): ProjectAccessKind {
  if (command.command === "ChangeTicketOverrides")
    return overridesAccess(command.overrides);
  if (command.command === "ManualDispatch") return "DispatchTicket";
  if (command.command === "ProposeDispatch") return "ProposeDispatch";
  return "Mutate";
}

function checkedInventoryLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("project inventory limit must be between 1 and 100");
  return limit;
}

type NativeAuthoringMethods = Pick<
  NativeWeb,
  "draft" | "drafts" | "createDraft" | "reviseDraft" | "deleteDraft"
>;

function nativeDraftInitializationMethod(
  access: ProjectAccess,
  authoring: AuthoringStore,
): Pick<NativeWeb, "initializeDraft"> {
  return {
    initializeDraft: async (principal, partition, revision, selection) => {
      const authority = await access.authorize(principal, partition, "Mutate");
      if (authority === undefined) return { result: "NotFound" };
      const snapshot = await authoring.initializeDraft(
        partition,
        revision,
        100,
      );
      if (snapshot === undefined)
        return {
          result: "Authorized",
          value: { initialized: "ConfigurationNotFound" },
        };
      if (snapshot === "PolicyUnavailable")
        return {
          result: "Authorized",
          value: { initialized: "PolicyUnavailable" },
        };
      const readiness = ticketConfigurationReadiness(
        snapshot.configuration.canonical,
        undefined,
        undefined,
        selection,
      );
      if (readiness.readiness === "Incomplete")
        return {
          result: "Authorized",
          value: {
            initialized:
              readiness.fault === "SelectionUnknown" ||
              readiness.fault === "SelectionUnsupported"
                ? "SelectionUnknown"
                : "ConfigurationIncomplete",
          },
        };
      const commandedCheckStage = ticketCommandedCheckStage(readiness.ticket);
      return {
        result: "Authorized",
        value: {
          initialized: "Initialized",
          value: {
            configuration: snapshot.configuration,
            projectSequence: snapshot.projectSequence,
            dependencyCandidates: snapshot.dependencyCandidates,
            dependencyCandidatesTruncated:
              snapshot.dependencyCandidatesTruncated,
            ...(commandedCheckStage === undefined
              ? {}
              : { commandedCheckStage }),
            commandedCheckStageNote: ticketCommandedCheckStageNote(
              readiness.ticket,
            ),
            ...draftInitializationPolicy(snapshot.domain, readiness.ticket),
          },
        },
      };
    },
  };
}

function nativeConfigurationMethods(
  access: ProjectAccess,
  authoring: AuthoringStore,
): Pick<NativeWeb, "configuration" | "configurations"> {
  return {
    configurations: authorizedProjectValue(access, (partition, query) =>
      authoring.configurations(partition, checkedConfigurationPageQuery(query)),
    ),
    configuration: authorizedProjectRead(access, (partition, revision) =>
      authoring.configuration(partition, revision),
    ),
  };
}

/**
 * What a member's import and head read are composed from: the import's own
 * ports with the default branch it reads, and
 * the binding door that answers a binding's retirement, which the import's
 * binding read does not.
 */
export interface NativeRepositoryConfigurationImportPorts extends RepositoryConfigurationHeadImportPorts {
  readonly landing: Pick<ProjectRepositoryLandingStore, "landing">;
}

/**
 * Imports only from a repository this project binds live, so a member cannot
 * read one their project retired, which another may since have bound, and only
 * at its default branch, so what a member imports is what was checked in.
 */
function nativeRepositoryConfigurationImportMethod(
  access: ProjectAccess,
  ports?: NativeRepositoryConfigurationImportPorts,
): NativeWeb["importRepositoryConfigurations"] {
  return async (principal, partition, source) => {
    const authority = await access.authorize(principal, partition, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    if (ports === undefined)
      return { result: "Unavailable", unavailable: "Repository" };
    const bound = await ports.landing.landing(partition, source.repository);
    if (bound === undefined || bound.retiredAt !== undefined)
      return { result: "RepositoryAbsent" };
    return importRepositoryConfigurationsAtHead({
      partition,
      repository: source.repository,
      authority,
      ports,
    });
  };
}

/**
 * Reads a repository's head for any member who may read the project, since it
 * stores nothing, and only from a repository the project binds live, as the
 * import does.
 */
function nativeRepositoryConfigurationHeadMethod(
  access: ProjectAccess,
  ports?: NativeRepositoryConfigurationImportPorts,
): NativeWeb["repositoryConfigurationHead"] {
  return async (principal, partition, repository) => {
    const authority = await access.authorize(principal, partition, "Read");
    if (authority === undefined) return { result: "NotFound" };
    if (ports === undefined)
      return { result: "Unavailable", unavailable: "Repository" };
    const bound = await ports.landing.landing(partition, repository);
    if (bound === undefined || bound.retiredAt !== undefined)
      return { result: "RepositoryAbsent" };
    return readRepositoryConfigurationHead({ partition, repository, ports });
  };
}

/** The two reads a draft has: one by its ticket, and one page of the open ones. */
function nativeDraftReadMethods(
  access: ProjectAccess,
  authoring: AuthoringStore,
): Pick<NativeWeb, "draft" | "drafts"> {
  return {
    draft: authorizedProjectRead(access, (partition, ticket) =>
      authoring.draft(partition, ticket),
    ),
    drafts: authorizedProjectValue(access, (partition, query) =>
      authoring.drafts(partition, checkedDraftPageQuery(query)),
    ),
  };
}

/**
 * Whether every image a brief names is one this project's own store holds, a
 * claim the store itself may fail to answer: `Unavailable` keeps that fault
 * distinguishable from `NotBound`, so a store blip is never reported to a
 * caller as its image not existing. A brief naming none asks the store
 * nothing, which is what keeps a brief written before this ticket answering
 * exactly as it did.
 */
type BriefImagesBound =
  | { readonly bound: "Bound" }
  | { readonly bound: "NotBound" }
  | { readonly bound: "Unavailable"; readonly retryAfterSeconds: number };

async function nativeBriefImagesBound(
  artifacts: ProjectArtifactPort | undefined,
  partition: Partition,
  images: readonly ProjectArtifactId[],
): Promise<BriefImagesBound> {
  if (images.length === 0) return { bound: "Bound" };
  if (artifacts === undefined)
    throw new Error("native web: no project artifact store was composed");
  for (const artifact of images) {
    const read = await artifacts.readArtifact({ partition, artifact });
    if (read.read === "NotFound") return { bound: "NotBound" };
    if (read.read === "Unavailable")
      return {
        bound: "Unavailable",
        retryAfterSeconds: read.retryAfterSeconds,
      };
  }
  return { bound: "Bound" };
}

/** What an unbound or unreachable image refuses `createDraft` with. */
function draftCreationImagesRefusal(
  bound: Exclude<BriefImagesBound, { bound: "Bound" }>,
): Extract<DraftCreated, { created: "ArtifactNotBound" | "Unavailable" }> {
  return bound.bound === "NotBound"
    ? { created: "ArtifactNotBound" }
    : { created: "Unavailable", retryAfterSeconds: bound.retryAfterSeconds };
}

/** What an unbound or unreachable image refuses `reviseDraft` with. */
function draftRevisionImagesRefusal(
  bound: Exclude<BriefImagesBound, { bound: "Bound" }>,
): Extract<DraftRevised, { revised: "ArtifactNotBound" | "Unavailable" }> {
  return bound.bound === "NotBound"
    ? { revised: "ArtifactNotBound" }
    : { revised: "Unavailable", retryAfterSeconds: bound.retryAfterSeconds };
}

/** The brief a draft is stored with, and who named its landing where that is known before the store writes it. */
interface NativeDraftBriefLanded {
  readonly brief: DraftBrief;
  readonly source?: Extract<DraftLanding["source"], "Brief" | "Finalizer">;
}

/**
 * The brief a draft is stored with: as written, or, where it names no landing
 * and the finalizer its catalog selection lands with names one, with that
 * landing in place of the repository's the store would otherwise resolve.
 */
async function nativeDraftBriefLanded(
  authoring: AuthoringStore,
  input: {
    readonly partition: Partition;
    readonly configurationRevision: ConfigurationRevisionId;
    readonly brief: DraftBrief;
    readonly selection?: ConfigurationSelection;
  },
): Promise<NativeDraftBriefLanded> {
  if (input.brief.finalization !== undefined)
    return { brief: input.brief, source: "Brief" };
  const configuration = await authoring.configuration(
    input.partition,
    input.configurationRevision,
  );
  const landing =
    configuration === undefined
      ? undefined
      : catalogSelectedFinalizer(
          JSON.parse(configuration.canonical),
          input.selection,
        )?.finalizer?.landing;
  return landing === undefined
    ? { brief: input.brief }
    : {
        brief: {
          ...input.brief,
          finalization: asBriefFinalization(
            "target" in landing && landing.target !== undefined
              ? { mode: landing.mode, target: landing.target }
              : { mode: landing.mode },
          ),
        },
        source: "Finalizer",
      };
}

/**
 * The landing a written draft's brief was stored with, as the store read it
 * back, and who named it. A landing neither the brief nor its finalizer named is
 * the store's to resolve: the repository's where the brief names one, and
 * `briefFinalizationDefault` where it names none.
 */
function nativeDraftLanding(
  landed: NativeDraftBriefLanded,
  draft: DraftResource,
): DraftLanding {
  const stored = draft.brief?.finalization;
  if (stored === undefined)
    throw new Error("native web: a written draft answered no landing");
  return {
    ...stored,
    source:
      landed.source ??
      (landed.brief.repository === undefined ? "Default" : "Repository"),
  };
}

/** `createDraft`, refusing an image the project does not hold before the store is asked. */
function nativeDraftCreationMethod(
  access: ProjectAccess,
  authoring: AuthoringStore,
  projectArtifacts?: ProjectArtifactPort,
): NativeWeb["createDraft"] {
  return (principal, input) =>
    authorizedProjectMutation(
      access,
      principal,
      input.partition,
      async (authority): Promise<NativeDraftCreated> => {
        const bound = await nativeBriefImagesBound(
          projectArtifacts,
          input.partition,
          input.brief.images,
        );
        if (bound.bound !== "Bound") return draftCreationImagesRefusal(bound);
        const landed = await nativeDraftBriefLanded(authoring, input);
        const created = await authoring.createDraft({
          ...input,
          brief: landed.brief,
          authority,
        });
        return created.created === "Created"
          ? { ...created, landing: nativeDraftLanding(landed, created.draft) }
          : created;
      },
      overridesAccess(input.overrides),
    );
}

/** `reviseDraft`, refusing an image the project does not hold before the store is asked. */
function nativeDraftRevisionMethod(
  access: ProjectAccess,
  authoring: AuthoringStore,
  projectArtifacts?: ProjectArtifactPort,
): NativeWeb["reviseDraft"] {
  return async (principal, input) =>
    authorizedProjectMutation(
      access,
      principal,
      input.partition,
      async (authority): Promise<NativeDraftRevised> => {
        const bound = await nativeBriefImagesBound(
          projectArtifacts,
          input.partition,
          input.brief.images,
        );
        if (bound.bound !== "Bound") return draftRevisionImagesRefusal(bound);
        const landed = await nativeDraftBriefLanded(authoring, input);
        const revised = await authoring.reviseDraft({
          ...input,
          brief: landed.brief,
          authority,
        });
        return revised.revised === "Revised"
          ? { ...revised, landing: nativeDraftLanding(landed, revised.draft) }
          : revised;
      },
      overridesNamed(input.overrides)
        ? overridesRevisionAccess(
            await authoring.draft(input.partition, input.ticket),
            input,
          )
        : "Mutate",
    );
}

function nativeAuthoringMethods(
  access: ProjectAccess,
  authoring: AuthoringStore,
  projectArtifacts?: ProjectArtifactPort,
): NativeAuthoringMethods {
  return {
    ...nativeDraftReadMethods(access, authoring),
    createDraft: nativeDraftCreationMethod(access, authoring, projectArtifacts),
    reviseDraft: nativeDraftRevisionMethod(access, authoring, projectArtifacts),
    deleteDraft: (principal, input) =>
      authorizedProjectMutation(
        access,
        principal,
        input.partition,
        (authority) => authoring.deleteDraft({ ...input, authority }),
      ),
  };
}

/**
 * Whether a release or an update runs less than its configuration plans,
 * judged on the revision it names, which is never rewritten and which its
 * decision resolves or refuses, so what this answers is what the decision
 * releases. `Unretained` is a revision the project does not hold; a
 * configuration that makes no ticket is refused at the decision, so it runs
 * nothing and is not short.
 */
async function nativeSubmitRunsLessThanPlan(
  authoring: AuthoringStore,
  partition: Partition,
  command: Extract<
    ProjectCommand,
    { readonly command: "ReleaseDraft" | "UpdateTicket" }
  >,
): Promise<boolean | "Unretained"> {
  const revision = await authoring.draftRevision(partition, command);
  if (revision === undefined) return "Unretained";
  const readiness = ticketConfigurationReadiness(
    revision.canonical,
    undefined,
    revision.overrides,
    revision.selection,
  );
  return (
    readiness.readiness === "Ready" &&
    ticketProgramShort(readiness.ticket, revision.program)
  );
}

/**
 * What a release or an update is answered before the inbox, if anything: one
 * running less than its plan, by a caller not holding `SkipPlannedEvaluations`,
 * is refused for it; one naming a revision the project does not hold is refused
 * as an invalid command, so a revision written after this read is never
 * released unasked.
 */
async function nativeSubmitPlanRefusal(
  access: ProjectAccess,
  authoring: AuthoringStore,
  principal: Principal,
  submission: NativeSubmission,
): Promise<NativeSubmissionResult | undefined> {
  const command = submission.command;
  if (command.command !== "ReleaseDraft" && command.command !== "UpdateTicket")
    return undefined;
  const short = await nativeSubmitRunsLessThanPlan(
    authoring,
    submission.partition,
    command,
  );
  if (short === "Unretained")
    return {
      result: "Authorized",
      acceptance: { accepted: "InvalidCommand" },
    };
  if (!short) return undefined;
  const skips = await access.authorize(
    principal,
    submission.partition,
    "SkipPlannedEvaluations",
  );
  return skips === undefined
    ? { result: "ProgramSkipsPlannedEvaluations" }
    : undefined;
}

/**
 * A release or an update that runs less than its plan asks
 * `SkipPlannedEvaluations` beside `Mutate`, before anything is accepted.
 */
function nativeSubmitMethod(
  access: ProjectAccess,
  inbox: OperationInbox,
  backlog: ExecutionBacklogGuard,
  authoring: AuthoringStore,
): NativeWeb["submit"] {
  return async (principal, submission) => {
    const authority = await access.authorize(
      principal,
      submission.partition,
      submissionAccess(submission.command),
    );
    if (authority === undefined) return { result: "NotFound" };
    const refused = await nativeSubmitPlanRefusal(
      access,
      authoring,
      principal,
      submission,
    );
    if (refused !== undefined) return refused;
    if (dispatchNeedsExecutionHeadroom(submission.command)) {
      const verdict = await backlog.admitsDispatch(submission.partition);
      if (verdict.admits === "Backlogged")
        return {
          result: "Backlogged",
          scope: verdict.scope,
          retryAfterSeconds: verdict.retryAfterSeconds,
        };
    }
    const accepted: Submission = { ...submission, authority };
    return { result: "Authorized", acceptance: await inbox.accept(accepted) };
  };
}

type NativeOperationalMethods = Pick<
  NativeWeb,
  | "operationalStatus"
  | "executions"
  | "latestExecutions"
  | "execution"
  | "executionSummary"
  | "outputContent"
>;

/** An output's bytes, found by its ordinal among the artifacts of the execution's result. */
function nativeOperationalOutputContent(
  access: ProjectAccess,
  operations: () => OperationalReadStore,
  contents: () => OutputContentPort,
): NativeWeb["outputContent"] {
  return async (principal, partition, execution, ordinal) => {
    if ((await access.authorize(principal, partition, "Read")) === undefined)
      return { read: "NotFound" };
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 256)
      throw new RangeError("artifact ordinal is invalid");
    const resource = await operations().execution(
      partition,
      execution,
      principal,
    );
    const artifact = resource?.result?.artifacts.find(
      (candidate) => candidate.ordinal === ordinal,
    );
    if (resource?.result === undefined || artifact === undefined)
      return { read: "NotFound" };
    return contents().read({
      partition,
      execution,
      attempt: resource.result.attempt,
      artifact,
    });
  };
}

function nativeOperationalMethods(
  access: ProjectAccess,
  operationalReads?: OperationalReadStore,
  outputContents?: OutputContentPort,
): NativeOperationalMethods {
  const operations = () => {
    if (operationalReads === undefined)
      throw new Error("native web: no operational read store was composed");
    return operationalReads;
  };
  const contents = () => {
    if (outputContents === undefined)
      throw new Error("native web: no output content store was composed");
    return outputContents;
  };
  return {
    operationalStatus: authorizedProjectValue(access, (partition) =>
      operations().status(partition),
    ),
    executions: async (principal, partition, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await operations().executions(
              partition,
              checkedExecutionListQuery(query),
              principal,
            ),
          },
    latestExecutions: async (principal, partition, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await operations().latestExecutions(
              partition,
              checkedLatestExecutionListQuery(query),
              principal,
            ),
          },
    execution: async (principal, partition, execution) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : operations().execution(partition, execution, principal),
    executionSummary: async (principal, partition, execution) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : operations().executionSummary(partition, execution, principal),
    outputContent: nativeOperationalOutputContent(access, operations, contents),
  };
}

type NativeProjectArtifactMethods = Pick<
  NativeWeb,
  "uploadProjectArtifact" | "projectArtifact"
>;

/**
 * Giving a project an image, and reading it back, both over one store and one
 * minting port composed together: a deployment that composed neither throws
 * the way `nativeOperationalMethods`' own guard does for every other
 * optionally-composed port.
 */
function nativeProjectArtifactMethods(
  access: ProjectAccess,
  store?: ProjectArtifactPort,
  minting?: ProjectArtifactMinting,
): NativeProjectArtifactMethods {
  const composed = () => {
    if (store === undefined || minting === undefined) {
      throw new Error("native web: no project artifact store was composed");
    }
    return { store, minting };
  };
  return {
    uploadProjectArtifact: (principal, partition, mediaType, content) =>
      authorizedProjectMutation(access, principal, partition, () => {
        const { store: artifacts, minting: mint } = composed();
        return projectArtifactUploaded(
          mint,
          artifacts,
          partition,
          mediaType,
          content,
        );
      }),
    projectArtifact: async (principal, partition, artifact) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { fetched: "NotFound" };
      return projectArtifactFetched(composed().store, partition, artifact);
    },
  };
}

type NativeRunEvidenceMethods = Pick<
  NativeWeb,
  "runTurns" | "runTranscript" | "runConfiguration" | "runError"
>;

/**
 * One page of batches with the bytes each one has. Only an outage refuses the
 * page: a batch that is gone or fails its digest is marked, because a run that
 * died leaves exactly that and the batches beside it are what a reader came for.
 */
async function nativeRunTranscriptBatches(
  contents: RunEvidenceContentPort,
  stored: Awaited<ReturnType<RunEvidenceReadStore["transcript"]>>,
): Promise<RunTranscriptRead> {
  if (stored === undefined) return { read: "NotFound" };
  const batches: RunTranscriptBatch[] = [];
  for (const object of stored.objects) {
    const drawn = await contents.readEvidence(object);
    if (drawn.read === "Unavailable") return drawn;
    const at = {
      batch: object.batch,
      recordedAt: object.recordedAt,
      bytes: object.bytes,
    };
    batches.push(
      drawn.read === "Content"
        ? { ...at, read: "Content", content: drawn.content }
        : { ...at, read: drawn.read === "NotFound" ? "Missing" : "Corrupt" },
    );
  }
  return {
    read: "Page",
    page: {
      batches,
      observedAt: stored.observedAt,
      complete: stored.complete,
      ...(stored.nextAfter === undefined
        ? {}
        : { nextAfter: stored.nextAfter }),
    },
  };
}

/** The run-evidence reads, each reauthorizing before it reaches a store. */
function nativeRunEvidenceMethods(
  access: ProjectAccess,
  evidenceReads?: RunEvidenceReadStore,
  evidenceContents?: RunEvidenceContentPort,
): NativeRunEvidenceMethods {
  const reads = () => {
    if (evidenceReads === undefined)
      throw new Error("native web: no run evidence read store was composed");
    return evidenceReads;
  };
  const contents = () => {
    if (evidenceContents === undefined)
      throw new Error("native web: no run evidence content store was composed");
    return evidenceContents;
  };
  return {
    runTurns: authorizedProjectRead(
      access,
      (partition, execution, attempt, query) =>
        reads().turns(
          partition,
          execution,
          attempt,
          checkedRunTurnsQuery(query),
        ),
    ),
    runTranscript: async (principal, partition, execution, attempt, after) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { read: "NotFound" };
      return nativeRunTranscriptBatches(
        contents(),
        await reads().transcript(
          partition,
          execution,
          attempt,
          checkedRunTranscriptAfter(after),
        ),
      );
    },
    runConfiguration: async (principal, partition, execution, attempt) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { read: "NotFound" };
      const stored = await reads().configuration(partition, execution, attempt);
      if (stored === undefined) return { read: "NotFound" };
      if (stored.object.path !== runConfigurationPath())
        throw new Error("native web: a snapshot is stored off its own path");
      const drawn = await contents().readEvidence(stored.object);
      return drawn.read === "Content"
        ? {
            read: "Content",
            digest: stored.object.digest,
            bytes: stored.object.bytes,
            content: drawn.content,
          }
        : drawn;
    },
    runError: async (principal, partition, execution, attempt) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { read: "NotFound" };
      const stored = await reads().error(partition, execution, attempt);
      if (stored === undefined) return { read: "NotFound" };
      if (stored.path !== workerErrorPath)
        throw new Error("native web: an error text is stored off its own path");
      return contents().readEvidence(stored);
    },
  };
}

/** The ticket reads, each reauthorizing before it reaches the projection. */
function nativeTicketMethods(
  access: ProjectAccess,
  reads: NativeReadStore,
): Pick<NativeWeb, "ticket" | "ticketNativeActions" | "nativeActions"> {
  return {
    ticket: authorizedProjectRead(access, (partition, ticket) =>
      reads.ticket(partition, ticket),
    ),
    ticketNativeActions: authorizedProjectRead(access, (partition, ticket) =>
      reads.ticketNativeActions(partition, ticket),
    ),
    nativeActions: authorizedProjectValue(access, (partition, query) =>
      reads.nativeActions(partition, checkedNativeActionPageQuery(query)),
    ),
  };
}

/**
 * The ports the lead's read side needs. They arrive together because the lead
 * page needs every one, and a deployment that composed only some would answer a
 * page partly blank without saying which part.
 */
export interface NativeLeadPorts {
  readonly leads: LeadReadStore;
  readonly store: SessionStoreReadPort;
  readonly refusals: AgenticRefusalRead;
  readonly history: SelectorHistoryStore;
  /** The project's settings as the selector resolves them, which say whether it is paused. */
  readonly settings: Pick<SelectorRuntimeSettingsSource, "projectSettings">;
  /** The tickets a dispatch is enabled at, which say whether one waits on a decision. */
  readonly candidates: DispatchViewStore;
  /** The site's selector, whose read of a project is what its sweep lists it by, where the deployment names one. */
  readonly selector?: Principal;
}

function composedLeadPorts(ports?: NativeLeadPorts): NativeLeadPorts {
  if (ports === undefined)
    throw new Error("native web: no lead read ports were composed");
  return ports;
}

/** The stream a transcript read defaults to, which is the session's own agent reference. */
function nativeSessionStream(
  subject: SessionTranscriptSubject,
): SessionStoreStream | undefined {
  const reference = subject.agentReference;
  return reference !== undefined && isSessionStoreStream(reference)
    ? asSessionStoreStream(reference)
    : undefined;
}

/**
 * What the whole stream says the session holds, or `Undecided` where the walk
 * could not reach the stream's end. An outage on a batch outside the page is one
 * of those: the page's own batches drew, so the page is answered, and only what
 * the walk was for goes unanswered.
 */
async function nativeSessionHeldWalk(
  rows: SessionStoreRowsRead,
  store: SessionStoreReadPort,
  partition: Partition,
  subject: SessionTranscriptSubject,
  stream: SessionStoreStream,
): Promise<SessionHeldWalk | "Undecided"> {
  const texts: { readonly batch: number; readonly content: string }[] = [];
  let after = 0;
  let batchesRead = 0;
  for (;;) {
    const asks = sessionHeldWalkAsks(batchesRead);
    if (asks === 0) return "Undecided";
    const page = await rows.batches({
      partition,
      session: subject.session,
      stream,
      after,
      limit: asks,
    });
    for (const row of page) {
      const read = await store.readBatch({
        partition,
        session: subject.session,
        stream,
        batch: row.batch,
      });
      if (read.read !== "Content") return "Undecided";
      texts.push({ batch: row.batch, content: read.content });
    }
    batchesRead += page.length;
    const last = page.at(-1)?.batch;
    if (page.length < asks || last === undefined) return sessionHeldWalk(texts);
    after = last;
  }
}

/**
 * One page of a stream, drawn batch by batch. An outage on a batch of the page
 * refuses it, because that is a page nobody can answer; an outage the walk meets
 * beyond the page answers the page with no held set, and a batch that is gone or
 * fails its digest is elided and counted.
 */
async function nativeSessionTranscriptPage(
  rows: SessionStoreRowsRead,
  store: SessionStoreReadPort,
  partition: Partition,
  subject: SessionTranscriptSubject,
  query: LeadTranscriptQuery,
): Promise<LeadTranscriptRead> {
  const stream = query.stream ?? nativeSessionStream(subject);
  if (stream === undefined) return { read: "NotFound" };
  const page = await rows.batches({
    partition,
    session: subject.session,
    stream,
    after: query.after,
    limit: query.limit,
  });
  const drawn: SessionStoreRead[] = [];
  for (const row of page) {
    const read = await store.readBatch({
      partition,
      session: subject.session,
      stream,
      batch: row.batch,
    });
    if (read.read === "Unavailable") return read;
    drawn.push(read);
  }
  const held = await nativeSessionHeldWalk(
    rows,
    store,
    partition,
    subject,
    stream,
  );
  const last = page.at(-1)?.batch;
  return {
    read: "Page",
    page: leadTranscriptPage({
      stream,
      drawn,
      ...(held === "Undecided" ? {} : { walk: held }),
      ...(page.length < query.limit || last === undefined
        ? {}
        : { nextAfter: last }),
    }),
  };
}

type NativeLeadMethods = Pick<
  NativeWeb,
  | "lead"
  | "leadTranscript"
  | "agenticRefusals"
  | "ticketAgenticRefusals"
  | "selectorHistory"
>;

/**
 * Why a project holds no lead, where a selector paused, by the installation or
 * the project, or one that may not read the project outranks the refusal it
 * keeps, since neither asks admission and a kept refusal may have stopped being
 * true. With neither and no refusal, a released ticket the selector has not yet
 * taken up is `AwaitingSelector`, or `SelectorUnnamed` where no selector is
 * named whose reach could be read, and only a project where none waits is
 * `NotNeeded`.
 */
async function nativeLeadSessionAbsence(
  access: ProjectAccess,
  ports: NativeLeadPorts,
  partition: Partition,
): Promise<LeadAbsence> {
  if ((await ports.settings.projectSettings(partition)).mode === "Paused")
    return leadPaused;
  if (
    ports.selector !== undefined &&
    (await access.authorize(ports.selector, partition, "Read")) === undefined
  )
    return leadSelectorNotGranted;
  const refused = await ports.leads.leadRefusal(partition);
  if (refused !== undefined) return refused;
  if (!(await nativeLeadDispatchWaits(ports.candidates, partition)))
    return leadNotNeeded;
  return ports.selector === undefined
    ? leadSelectorUnnamed
    : leadAwaitingSelector;
}

/**
 * Whether a released ticket waits on a dispatch decision. A view being rebuilt
 * answers no candidates, so it says none waits until it stands again.
 */
async function nativeLeadDispatchWaits(
  candidates: DispatchViewStore,
  partition: Partition,
): Promise<boolean> {
  const page = await candidates.read(partition, { limit: 1 });
  return page.result === "Page" && page.candidates.length > 0;
}

/**
 * The lead's own two reads, each reauthorizing before it reaches a store. A
 * readable project holding no lead is answered `None` by the head, which is
 * how the project stands, with why as the reason; its transcript has nothing to
 * page and is not found.
 */
function nativeLeadSessionMethods(
  access: ProjectAccess,
  leads?: NativeLeadPorts,
): Pick<NativeWeb, "lead" | "leadTranscript"> {
  return {
    lead: async (principal, partition) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const ports = composedLeadPorts(leads);
      const standing = await ports.leads.standing(
        partition,
        leadTurnsAnsweredMax,
      );
      if (standing === undefined)
        return {
          result: "None",
          absence: await nativeLeadSessionAbsence(access, ports, partition),
        };
      return {
        result: "Found",
        lead: standing,
        streams: await ports.leads.streams(
          partition,
          standing.session,
          sessionStoreStreamsAnswered,
        ),
      };
    },
    leadTranscript: async (principal, partition, query) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { read: "NotFound" };
      const ports = composedLeadPorts(leads);
      const standing = await ports.leads.standing(
        partition,
        leadTurnsAnsweredMax,
      );
      if (standing === undefined) return { read: "NotFound" };
      return nativeSessionTranscriptPage(
        ports.leads,
        ports.store,
        partition,
        standing,
        checkedLeadTranscriptQuery(query),
      );
    },
  };
}

/**
 * The ports one project's threads are read and written through, arriving
 * together because a thread page needs all of them and a deployment that
 * composed some would answer a page that is part blank without saying which
 * part. `rows` and `store` are the lead's own two, session-keyed — a thread's
 * transcript is drawn by the SAME walk over the SAME bytes, so one transcript
 * has one page type and one wire answer — and `credentialSlot` is the
 * installation's named mount for a member's thread, configuration rather than a
 * port because what a thread speaks through is decided where a deployment is
 * described and never by a caller.
 */
export interface NativeThreadPorts {
  readonly threads: ThreadStore;
  readonly sessions: ThreadSessionMint;
  readonly seeding: ThreadSeedingRead;
  readonly rows: SessionStoreRowsRead;
  readonly store: SessionStoreReadPort;
  readonly credentialSlot: string;
}

function composedThreadPorts(ports?: NativeThreadPorts): NativeThreadPorts {
  if (ports === undefined)
    throw new Error("native web: no thread ports were composed");
  return ports;
}

function composedSessionRoutes(routes?: SessionRouteReads): SessionRouteReads {
  if (routes === undefined)
    throw new Error("native web: no session route port was composed");
  return routes;
}

/**
 * What the member's turn carries: the seeding block on a first turn and no
 * later turn's, the images section on any turn that named one, and the
 * message itself — or the ceiling the three would not fit under. The overflow
 * is a refusal rather than a raise because it is the project's texts or the
 * images that are too long and not the member's request: a bare
 * `InvalidRequest` would tell them their message was malformed, which is the
 * one thing it was not.
 */
async function nativeThreadTurnInput(
  ports: NativeThreadPorts,
  partition: Partition,
  authority: Authority,
  seeded: boolean,
  message: string,
  images: readonly ThreadSeededImage[] | undefined,
): Promise<string | { readonly charsMax: number }> {
  const seeding = seeded
    ? await threadSeeding(ports.seeding, partition, authority)
    : undefined;
  try {
    return threadTurnInput(message, seeding, images);
  } catch (failure) {
    if (failure instanceof RangeError)
      return { charsMax: threadTurnInputCharsMax };
    throw failure;
  }
}

/**
 * The `owner` one thread is named by: the authority its principal acts under,
 * and nothing where the project no longer admits them. Its absence is what
 * `threadStanding` reads as `Orphaned`.
 */
async function nativeThreadOwner(
  access: ProjectAccess,
  partition: Partition,
  record: ThreadRecord,
): Promise<string | undefined> {
  return (await access.authorize(record.principal, partition, "Read"))?.subject;
}

/** One page of threads as the wire names it, asking the authority once per distinct owner. */
async function nativeThreadEntries(
  access: ProjectAccess,
  partition: Partition,
  records: readonly ThreadRecord[],
  reader: Principal,
): Promise<readonly ThreadEntry[]> {
  const owners = await memberAuthorities(
    access,
    partition,
    records.map((record) => record.principal),
    threadsAnsweredMax,
  );
  return records.map((record) =>
    threadEntry(record, reader, owners.get(record.principal)?.subject),
  );
}

/** One page of inquiries as the wire names it, asking the authority once per distinct asker. */
async function nativeInquiryEntries(
  access: ProjectAccess,
  partition: Partition,
  records: readonly LeadInquiryRecord[],
  reader: Principal,
): Promise<readonly LeadInquiryEntry[]> {
  const askers = await memberAuthorities(
    access,
    partition,
    records.map((record) => record.principal),
    inquiriesAnsweredMax,
  );
  return records.map((record) =>
    leadInquiryEntry(record, reader, askers.get(record.principal)?.subject),
  );
}

/**
 * Opening a thread of the caller's own, which is `Mutate` and takes the key its
 * client minted rather than a session: the definer is idempotent on the key,
 * holds the member to their limit, and writes the roster itself. It is refused
 * where its first turn would be: in cluster without the tenant's hosted grant,
 * and on a runner with none of the member's registered.
 */
function nativeOpenThreadMethod(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
  routes?: SessionRouteReads,
): NativeWeb["openThread"] {
  return async (principal, partition, key) => {
    const authority = await access.authorize(principal, partition, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    const spend = await sessionSpendRoute(
      access,
      composedSessionRoutes(routes),
      principal,
      partition,
      "Thread",
    );
    if (spend.spend !== "Admitted") return { result: spend.spend };
    const ports = composedThreadPorts(threads);
    const texts = await ports.seeding.projectTexts(partition);
    const opened = await ports.threads.open({
      partition,
      principal,
      session: ports.sessions.session(),
      key,
      systemPrompt: threadSystemPrompt({
        partition,
        owner: authority.subject,
        ...(texts.northStar === undefined
          ? {}
          : { northStar: texts.northStar }),
        standingRules: resolvedThreadStandingRules(texts.standingRules),
      }),
      credentialSlot: ports.credentialSlot,
    });
    if (opened.opened === "ThreadLimitReached")
      return { result: opened.opened, threadsMax: opened.threadsMax };
    return {
      result: opened.opened,
      thread: threadEntry(opened.thread, principal, authority.subject),
    };
  };
}

/**
 * Whether the project's tenant grants the caller hosted runs, asked of the
 * predicate every hosted refusal asks, so a member is told before they type
 * what a send would answer. It is the caller's own grant and a reader's
 * question, so it is `Read`.
 */
function nativeHostedRunsMethod(
  access: ProjectAccess,
): NativeWeb["hostedRuns"] {
  return async (principal, partition) =>
    (await access.authorize(principal, partition, "Read")) === undefined
      ? { result: "NotFound" }
      : {
          result: "Authorized",
          value: await hostedRunsGranted(access, principal, partition.tenant),
        };
}

/** The project artifact store a send asks of, where a message names an image, thrown for the reason every other optionally-composed port is. */
function composedThreadArtifactStore(
  store?: ProjectArtifactPort,
): ProjectArtifactPort {
  if (store === undefined)
    throw new Error("native web: no project artifact store was composed");
  return store;
}

/**
 * The message door, which is `Mutate` and reaches the caller's own threads
 * alone: the session the URL names is the mailbox, and the durable door refuses
 * it where it is another member's, so the page a member is reading and the
 * mailbox their message lands in cannot come apart. Each turn is stamped with
 * the route it was admitted on and runs there, so the route and what it needs
 * of the member are asked at every send, not only when the thread opened, and
 * an image the message names is checked against this project's own artifacts
 * only once the thread is confirmed open and the caller's own.
 */
function nativeSendThreadMessageMethod(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
  routes?: SessionRouteReads,
  projectArtifacts?: ProjectArtifactPort,
): NativeWeb["sendThreadMessage"] {
  return async (principal, partition, input) => {
    const authority = await access.authorize(principal, partition, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    const spend = await sessionSpendRoute(
      access,
      composedSessionRoutes(routes),
      principal,
      partition,
      "Thread",
    );
    if (spend.spend !== "Admitted") return { result: spend.spend };
    const ports = composedThreadPorts(threads);
    const message = checkedThreadMessage(input.message);
    const named = checkedThreadMessageImages(input.images ?? []);
    const mine = await ports.threads.standing({
      partition,
      session: input.session,
      query: { limit: 1 },
    });
    if (mine === undefined) return { result: "NotFound" };
    if (mine.thread.principal !== principal) return { result: "NotYourThread" };
    if (mine.thread.state === "Closed") return { result: "Closed" };
    const checked: ThreadMessageImagesChecked =
      named.length === 0
        ? { checked: "Images", images: [] }
        : await threadMessageImages(
            composedThreadArtifactStore(projectArtifacts),
            partition,
            named,
          );
    if (checked.checked === "Unknown") return { result: "ImageUnknown" };
    if (checked.checked === "Unavailable")
      return {
        result: "ImagesUnavailable",
        retryAfterSeconds: checked.retryAfterSeconds,
      };
    const turnInput = await nativeThreadTurnInput(
      ports,
      partition,
      authority,
      mine.thread.agentReference === undefined,
      message,
      checked.images.length === 0 ? undefined : checked.images,
    );
    if (typeof turnInput !== "string")
      return { result: "TooLarge", charsMax: turnInput.charsMax };
    return threadMessageSent(
      await ports.threads.enqueueMessage({
        partition,
        principal,
        session: input.session,
        turn: input.turn,
        input: turnInput,
        route: spend.route,
      }),
      input.turn,
    );
  };
}

/**
 * The stop door, which is `Mutate` and asks for no route and no grant: a stop
 * spends nothing, so a member whose runner has gone or whose grant was taken
 * can still end the turn they started. Whose thread it is, whether it is open
 * and whether the turn is there are the durable door's to answer, in the
 * transaction that ends the turn.
 */
function nativeStopThreadTurnMethod(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): NativeWeb["stopThreadTurn"] {
  return async (principal, partition, input) => {
    if ((await access.authorize(principal, partition, "Mutate")) === undefined)
      return { result: "NotFound" };
    return threadTurnStopping(
      await composedThreadPorts(threads).threads.stopTurn({
        partition,
        principal,
        session: input.session,
        turn: input.turn,
      }),
    );
  };
}

/**
 * The close door, which is `Mutate` and reaches any thread the project holds:
 * a thread files drafts and does nothing else, so ending one takes nothing its
 * owner cannot file again from a new one, and the durable side is what refuses
 * a session that is not a thread. The turns it still held are abandoned, the
 * lead is told nothing, and the thread stays readable.
 */
function nativeCloseThreadMethod(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): NativeWeb["closeThread"] {
  return async (principal, partition, session) => {
    if ((await access.authorize(principal, partition, "Mutate")) === undefined)
      return { result: "NotFound" };
    const ports = composedThreadPorts(threads);
    const closed = await ports.threads.close({ partition, session });
    if (closed.closed === "NoThread") return { result: "NotFound" };
    return {
      result: closed.closed,
      thread: threadEntry(
        closed.thread,
        principal,
        await nativeThreadOwner(access, partition, closed.thread),
      ),
    };
  };
}

/**
 * The gate rename and hide share: `Mutate`, the ports behind it, and a thread
 * of the caller's own — or the refusal that stands in for all three.
 */
async function nativeOwnedThread(
  access: ProjectAccess,
  threads: NativeThreadPorts | undefined,
  principal: Principal,
  partition: Partition,
  session: SessionId,
): Promise<
  | {
      readonly owned: true;
      readonly ports: NativeThreadPorts;
      readonly authority: Authority;
    }
  | { readonly owned: false; readonly result: "NotFound" | "NotYourThread" }
> {
  const authority = await access.authorize(principal, partition, "Mutate");
  if (authority === undefined) return { owned: false, result: "NotFound" };
  const ports = composedThreadPorts(threads);
  const mine = await ports.threads.standing({
    partition,
    session,
    query: { limit: 1 },
  });
  if (mine === undefined) return { owned: false, result: "NotFound" };
  if (mine.thread.principal !== principal)
    return { owned: false, result: "NotYourThread" };
  return { owned: true, ports, authority };
}

/** Renaming and hiding are each the owner's alone, as the message door is. */
function nativeThreadViewMethods(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): Pick<NativeWeb, "renameThread" | "hideThread"> {
  return {
    renameThread: async (principal, partition, input) => {
      const owned = await nativeOwnedThread(
        access,
        threads,
        principal,
        partition,
        input.session,
      );
      if (!owned.owned) return { result: owned.result };
      const renamed = await owned.ports.threads.rename({
        partition,
        session: input.session,
        title: input.title,
      });
      if (renamed.renamed === "NoThread") return { result: "NotFound" };
      return {
        result: renamed.renamed,
        thread: threadEntry(renamed.thread, principal, owned.authority.subject),
      };
    },
    hideThread: async (principal, partition, input) => {
      const owned = await nativeOwnedThread(
        access,
        threads,
        principal,
        partition,
        input.session,
      );
      if (!owned.owned) return { result: owned.result };
      const hidden = await owned.ports.threads.hide({
        partition,
        session: input.session,
        hidden: input.hidden,
      });
      if (hidden.hidden === "NoThread") return { result: "NotFound" };
      return {
        result: hidden.hidden,
        thread: threadEntry(hidden.thread, principal, owned.authority.subject),
      };
    },
  };
}

/**
 * The three reads every member of the project may make of every thread in it,
 * each reauthorizing before it reaches a store. A thread that is not this
 * project's own, and a session that is not a thread at all, answer alike:
 * `standing` refuses both, and neither is a fact a reader is owed.
 */
function nativeThreadReadMethods(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): Pick<NativeWeb, "threads" | "thread" | "threadTranscript"> {
  return {
    threads: async (principal, partition) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const ports = composedThreadPorts(threads);
      const found = await ports.threads.threads(
        partition,
        principal,
        checkedThreadsLimit(threadsAnsweredMax),
      );
      return {
        result: "Found",
        threads: await nativeThreadEntries(access, partition, found, principal),
      };
    },
    thread: async (principal, partition, session, query) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const ports = composedThreadPorts(threads);
      const found = await ports.threads.standing({
        partition,
        session,
        query: checkedThreadMailboxQuery(query),
      });
      if (found === undefined) return { result: "NotFound" };
      return {
        result: "Found",
        thread: threadEntry(
          found.thread,
          principal,
          await nativeThreadOwner(access, partition, found.thread),
        ),
        turns: found.turns,
        ...(found.nextBefore === undefined
          ? {}
          : { nextBefore: found.nextBefore }),
        streams: found.streams,
      };
    },
    threadTranscript: async (principal, partition, session, query) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { read: "NotFound" };
      const ports = composedThreadPorts(threads);
      const found = await ports.threads.standing({
        partition,
        session,
        query: { limit: 1 },
      });
      if (found === undefined) return { read: "NotFound" };
      return nativeSessionTranscriptPage(
        ports.rows,
        ports.store,
        partition,
        found.thread,
        checkedLeadTranscriptQuery(query),
      );
    },
  };
}

/**
 * The refusals and the decision log, each reauthorizing before it reaches a
 * store, and each refusal read asking for one past its page so `more` can be
 * true at all.
 */
function nativeLeadRecordMethods(
  access: ProjectAccess,
  leads?: NativeLeadPorts,
): Pick<
  NativeWeb,
  "agenticRefusals" | "ticketAgenticRefusals" | "selectorHistory"
> {
  return {
    agenticRefusals: async (principal, partition, limit) => {
      const ports = composedLeadPorts(leads);
      const asked = checkedAgenticRefusalsLimit(limit);
      const found = await agenticRefusals(access, ports.refusals).standing(
        principal,
        partition,
        asked + 1,
      );
      if (found.result === "NotFound") return { result: "NotFound" };
      const page = found.refusals.slice(0, asked);
      return {
        result: "Found",
        refusals: page,
        more: found.refusals.length > asked,
      };
    },
    ticketAgenticRefusals: async (principal, partition, ticket) => {
      const ports = composedLeadPorts(leads);
      const found = await agenticRefusals(access, ports.refusals).ledger(
        principal,
        partition,
        ticket,
        agenticRefusalLedgerAnsweredMax + 1,
      );
      if (found.result === "NotFound") return { result: "NotFound" };
      const more = found.entries.length > agenticRefusalLedgerAnsweredMax;
      return {
        result: "Found",
        ticket,
        entries: found.entries.slice(0, agenticRefusalLedgerAnsweredMax),
        more,
        ...(more || found.standing === undefined
          ? {}
          : { standing: found.standing }),
      };
    },
    selectorHistory: (principal, partition, query) =>
      selectorHistory(access, composedLeadPorts(leads).history).read(
        principal,
        partition,
        query,
      ),
  };
}

/** The lead's read side, whose two halves reach the boundary as one. */
function nativeLeadReadMethods(
  access: ProjectAccess,
  leads?: NativeLeadPorts,
): NativeLeadMethods {
  return {
    ...nativeLeadSessionMethods(access, leads),
    ...nativeLeadRecordMethods(access, leads),
  };
}

/**
 * The three ways a member reaches the lead's inquiries: the two reads gated on
 * `Read`, and asking on `Mutate`, because an inquiry is a turn, and on what the
 * inquiry's route needs of the asker too — `./leadInquiry.ts`'s header carries
 * the argument. THE ASKER IS THE AUTHORITY'S OWN SUBJECT and comes from the
 * authorization this door already did, never from the body: a question whose
 * asker the caller chose would name whoever they liked on a document the lead
 * reads.
 */
function nativeLeadInquiryMethods(
  access: ProjectAccess,
  inquiries?: LeadInquiryStore,
  routes?: SessionRouteReads,
): Pick<NativeWeb, "leadInquiries" | "leadInquiry" | "askLead"> {
  const composed = (): LeadInquiryStore => {
    if (inquiries === undefined)
      throw new Error("native web: no lead inquiry port was composed");
    return inquiries;
  };
  return {
    leadInquiries: async (principal, partition) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const found = await composed().inquiries(partition, inquiriesAnsweredMax);
      return {
        result: "Found",
        inquiries: await nativeInquiryEntries(
          access,
          partition,
          found,
          principal,
        ),
      };
    },
    leadInquiry: async (principal, partition, session) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const found = await composed().inquiry(partition, session);
      if (found === undefined) return { result: "NotFound" };
      const [inquiry] = await nativeInquiryEntries(
        access,
        partition,
        [found],
        principal,
      );
      if (inquiry === undefined) return { result: "NotFound" };
      return { result: "Found", inquiry };
    },
    askLead: async (principal, partition, input) => {
      const authority = await access.authorize(principal, partition, "Mutate");
      if (authority === undefined) return { result: "NotFound" };
      const spend = await sessionSpendRoute(
        access,
        composedSessionRoutes(routes),
        principal,
        partition,
        "Inquiry",
      );
      if (spend.spend !== "Admitted") return { result: spend.spend };
      return leadInquiryAsked(
        await composed().open({
          partition,
          principal,
          session: input.session,
          turn: input.turn,
          question: leadInquiryTurnInput({
            question: input.question,
            asker: authority.subject,
          }),
          route: spend.route,
        }),
        input.session,
        input.turn,
      );
    },
  };
}

/**
 * The thread side of the boundary, whose reads and whose doors reach it as one.
 * A member's own chat reaches the same doors through an access of its own.
 */
export function nativeThreadMethods(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
  routes?: SessionRouteReads,
  projectArtifacts?: ProjectArtifactPort,
): Pick<
  NativeWeb,
  | "threads"
  | "thread"
  | "threadTranscript"
  | "openThread"
  | "sendThreadMessage"
  | "stopThreadTurn"
  | "closeThread"
  | "renameThread"
  | "hideThread"
> {
  return {
    ...nativeThreadReadMethods(access, threads),
    ...nativeThreadViewMethods(access, threads),
    openThread: nativeOpenThreadMethod(access, threads, routes),
    sendThreadMessage: nativeSendThreadMessageMethod(
      access,
      threads,
      routes,
      projectArtifacts,
    ),
    stopThreadTurn: nativeStopThreadTurnMethod(access, threads),
    closeThread: nativeCloseThreadMethod(access, threads),
  };
}

/** Tickets with each one's latest execution beside it, read for all of them at once. */
export async function ticketsWithLatestExecutions(
  operationalReads:
    Pick<OperationalReadStore, "ticketLatestExecutions"> | undefined,
  partition: Partition,
  tickets: readonly TicketResource[],
  reader: Principal,
): Promise<readonly TicketResource[]> {
  if (tickets.length === 0) return tickets;
  if (operationalReads === undefined)
    throw new Error("native web: no operational read store was composed");
  const latest = new Map<TicketId, TicketLatestExecution>();
  for (const summary of await operationalReads.ticketLatestExecutions(
    partition,
    tickets.map((ticket) => ticket.ticket),
    reader,
  )) {
    if (latest.has(summary.ticket))
      throw new Error("native web: a ticket has two latest executions");
    latest.set(summary.ticket, ticketLatestExecution(summary));
  }
  return tickets.map((ticket) => {
    const execution = latest.get(ticket.ticket);
    return execution === undefined
      ? ticket
      : { ...ticket, latestExecution: execution };
  });
}

/**
 * The reads answered from the projection rather than from a service, each
 * reauthorizing before it reaches the store. They are one group because they
 * are one store's reads and because a boundary listing them inline is a
 * boundary nobody can see the shape of; the tickets list alone reaches past
 * the projection, for each row's latest execution.
 */
function nativeProjectionMethods(
  access: ProjectAccess,
  reads: NativeReadStore,
  operationalReads?: OperationalReadStore,
): Pick<
  NativeWeb,
  "operation" | "project" | "ticket" | "ticketNativeActions" | "nativeActions"
> {
  return {
    operation: authorizedProjectRead(access, (partition, operation) =>
      reads.operation(partition, operation),
    ),
    project: async (principal, partition, query) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { result: "NotFound" };
      const read = await reads.project(
        partition,
        checkedProjectReadQuery(query),
      );
      return read.result === "Found"
        ? {
            ...read,
            project: {
              ...read.project,
              tickets: await ticketsWithLatestExecutions(
                operationalReads,
                partition,
                read.project.tickets,
                principal,
              ),
            },
          }
        : read;
    },
    ...nativeTicketMethods(access, reads),
  };
}

/**
 * Cancelling one operation, which is `Mutate` and answers `NotFound` alike for
 * a project the caller may not write and an operation that is not there: which
 * of the two it was is not a fact a caller who may not write is owed.
 */
function nativeCancelMethod(
  access: ProjectAccess,
  reads: NativeReadStore,
  inbox: OperationInbox,
): NativeWeb["cancel"] {
  return async (principal, partition, operation) => {
    const authority = await access.authorize(principal, partition, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    const resource = await reads.operation(partition, operation);
    if (resource === undefined) return { result: "NotFound" };
    return {
      result: "Found",
      cancellation: await inbox.cancel({ partition, operation, authority }),
    };
  };
}

/** Builds the application boundary from authorization, read, and inbox ports. */
export function nativeWeb(
  access: ProjectAccess,
  reads: NativeReadStore,
  inbox: OperationInbox,
  authoring: AuthoringStore,
  notifications: NotificationStore,
  backlog: ExecutionBacklogGuard,
  dispatchViews?: DispatchViewStore,
  inventory?: ProjectInventory,
  operationalReads?: OperationalReadStore,
  outputContents?: OutputContentPort,
  selectorContexts?: SelectorOperationalContextRead,
  repositoryConfigurationImports?: NativeRepositoryConfigurationImportPorts,
  runEvidenceReads?: RunEvidenceReadStore,
  runEvidenceContents?: RunEvidenceContentPort,
  leads?: NativeLeadPorts,
  threads?: NativeThreadPorts,
  inquiries?: LeadInquiryStore,
  sessionRoutes?: SessionRouteReads,
  projectArtifacts?: ProjectArtifactPort,
  projectArtifactMinting?: ProjectArtifactMinting,
): NativeWeb {
  return {
    ...nativeRunEvidenceMethods(access, runEvidenceReads, runEvidenceContents),
    ...nativeLeadReadMethods(access, leads),
    ...nativeThreadMethods(access, threads, sessionRoutes, projectArtifacts),
    hostedRuns: nativeHostedRunsMethod(access),
    abilities: (principal, partition) =>
      projectAbilities(access, principal, partition),
    ...nativeLeadInquiryMethods(access, inquiries, sessionRoutes),
    importRepositoryConfigurations: nativeRepositoryConfigurationImportMethod(
      access,
      repositoryConfigurationImports,
    ),
    repositoryConfigurationHead: nativeRepositoryConfigurationHeadMethod(
      access,
      repositoryConfigurationImports,
    ),
    ...nativeConfigurationMethods(access, authoring),
    ...nativeDraftInitializationMethod(access, authoring),
    ...nativeAuthoringMethods(access, authoring, projectArtifacts),
    ...nativeOperationalMethods(access, operationalReads, outputContents),
    ...nativeProjectArtifactMethods(
      access,
      projectArtifacts,
      projectArtifactMinting,
    ),
    selectorOperationalContext: nativeSelectorContextMethod(
      access,
      selectorContexts,
    ),
    submit: nativeSubmitMethod(access, inbox, backlog, authoring),
    ...nativeProjectionMethods(access, reads, operationalReads),
    cancel: nativeCancelMethod(access, reads, inbox),
    notifications: authorizedProjectValue(access, (partition, cursor) =>
      notifications.read(partition, checkedNotificationCursor(cursor)),
    ),
    dispatchView: nativeDispatchViewMethod(access, dispatchViews),
    projectInventory: async (principal, after, limit) => {
      if (inventory === undefined)
        throw new Error("native web: no project inventory was composed");
      return inventory.projects(principal, after, checkedInventoryLimit(limit));
    },
  };
}

function nativeDispatchViewMethod(
  access: ProjectAccess,
  views?: DispatchViewStore,
): NativeWeb["dispatchView"] {
  return authorizedProjectValue(access, (partition, query) => {
    if (views === undefined)
      throw new Error("native web: no dispatch-view store was composed");
    return views.read(partition, checkedDispatchViewQuery(query));
  });
}

function nativeSelectorContextMethod(
  access: ProjectAccess,
  contexts?: SelectorOperationalContextRead,
): NativeWeb["selectorOperationalContext"] {
  return authorizedProjectValue(access, (partition) => {
    if (contexts === undefined)
      throw new Error("native web: no selector context source was composed");
    return contexts.context(partition);
  });
}
