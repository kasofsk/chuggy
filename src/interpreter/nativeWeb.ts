/**
 * The authenticated native-web application boundary.
 *
 * Authorization answers with the audited authority rather than a boolean, so
 * no transport can authorize one subject and record another. Reads and
 * cancellation deliberately share the same not-found result for absent and
 * inaccessible resources. This layer coordinates ports; it neither loads the
 * project actor nor owns a database transaction.
 */

import {
  asSessionStoreStream,
  isSessionStoreStream,
  type SessionId,
  type SessionStoreStream,
  type SessionTurnId,
} from "./agentSession.ts";
import type { Principal } from "./principal.ts";
import type { EscalationReason, ResumePoint } from "../contract/rosters.ts";
import { phaseTags, type Phase } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import type {
  Accepted,
  Cancelled,
  IdempotencyKey,
  OperationId,
  OperationState,
  Submission,
} from "./operationInbox.ts";
import type { OperationInbox } from "./operationInbox.ts";
import type { Partition } from "./projectStore.ts";
import type {
  NativeActionKind,
  NativeActionResolution,
  TicketCommand,
} from "./ticketCommand.ts";
import type {
  AuthoringStore,
  CanonicalConfiguration,
  ConfigurationPage,
  ConfigurationPageQuery,
  ConfigurationCreated,
  ConfigurationRevisionResource,
  ConfigurationRevisionId,
  DraftCreated,
  DraftInitializationRead,
  DraftDeleted,
  DraftPage,
  DraftPageQuery,
  DraftResource,
  DraftRevised,
} from "./authoring.ts";
import {
  checkedConfigurationPageQuery,
  checkedDraftPageQuery,
  draftInitializationPolicy,
  releaseConfigurationReadiness,
} from "./authoring.ts";
import { firstCommandedCheckStage } from "./taskConfiguration.ts";
import type { ReleaseAuthoring } from "../actor/decisionEvent.ts";
import type { DraftBrief } from "./ticketBrief.ts";
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
  type ExecutionListQuery,
  type ExecutionPage,
  type ExecutionResource,
  type OperationalReadStore,
  type OutputContentPort,
  type OutputContentRead,
  type ProjectOperationalStatus,
} from "./operationsView.ts";
import {
  checkedRunTranscriptAfter,
  checkedRunTurnsQuery,
  runConfigurationPath,
  type RunConfigurationRead,
  type RunEvidenceContentPort,
  type RunEvidenceReadStore,
  type RunTotals,
  type RunTranscriptBatch,
  type RunTranscriptRead,
  type RunTurnsPage,
  type RunTurnsQuery,
} from "./runEvidence.ts";
import type { AttemptId, ExecutionId } from "./schedulerIdentity.ts";
import { type PublicInstant } from "./publicResource.ts";
import type { ProjectAccess, ProjectAccessKind } from "./projectAccess.ts";
import type { Authority } from "./operationInbox.ts";
import type { SelectorOperationalContext } from "./selector.ts";
import type { SelectorOperationalContextRead } from "./selectorOperationalContext.ts";
import {
  agenticRefusalIsSuperseded,
  agenticRefusals,
  checkedAgenticRefusalsLimit,
  type AgenticRefusalRead,
  type AgenticRefusalsRead,
  type AgenticRefusalStanding,
  type TicketAgenticRefusalsRead,
} from "./agenticRefusal.ts";
import {
  checkedLeadTranscriptQuery,
  leadTranscriptPage,
  sessionHeldWalk,
  sessionHeldWalkAsks,
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
} from "../contract/http.ts";
import type { GitObjectId } from "./finalizer.ts";
import {
  importRepositoryConfigurations,
  type RepositoryConfigurationImportOutcome,
  type RepositoryConfigurationImportPorts,
} from "./repositoryConfiguration.ts";
import {
  threadStanding,
  threadSystemPrompt,
  threadTurnInput,
  threadTurnInputCharsMax,
} from "./thread.ts";
import {
  checkedThreadMailboxQuery,
  checkedThreadMessage,
  checkedThreadsLimit,
  threadEntry,
  threadMessageSent,
  threadSeeding,
  type ThreadMailboxQuery,
  type ThreadMessageSent,
  type ThreadOpening,
  type ThreadRead,
  type ThreadSeedingRead,
  type ThreadSessionMint,
  type ThreadStore,
  type ThreadsRead,
} from "./threadRead.ts";
import { threadsAnsweredMax } from "../contract/http.ts";
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

export type OperationRefusalCode =
  | "NotEnabled"
  | "AuthoringChanged"
  | "ConfigurationInvalid"
  | "TicketChanged"
  | "SelectionChanged"
  | "CommandUnreadable"
  | "ExecutionSourceUnreadable"
  | "ExecutionSourceDenied";

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
      readonly code: OperationRefusalCode;
      readonly refusedHead: number;
      readonly refusedLifecycleGeneration: number;
    })
  | (OperationResourceBase & { readonly state: "Answered" })
  | (OperationResourceBase & { readonly state: "Cancelled" });

/**
 * What a ticket has left to spend. `finalizationLeft` is absent under a pricing
 * that budgets no finalization account, which is not the same fact as an
 * account standing at zero.
 */
export interface TicketAccounts {
  readonly gasLeft: number;
  readonly gasMax: number;
  readonly reworkLeft: number;
  readonly finalizationLeft?: number;
}

/**
 * The reason and the resume point are present exactly when the ticket is parked
 * on the desk, the brief exactly when it was authored with one, and the accounts
 * only where the store holds them. Its two instants are the journal's:
 * `changedAt` is when the entry `sequence` names committed, and `releasedAt`
 * when the entry releasing this ticket did — absent when no entry the reader can
 * parse says it released this ticket.
 */
export interface TicketResource {
  readonly ticket: TicketId;
  readonly phase: Phase;
  readonly sequence: number;
  readonly changedAt: PublicInstant;
  readonly releasedAt?: PublicInstant;
  readonly reason?: EscalationReason;
  readonly resumeAt?: ResumePoint;
  readonly accounts?: TicketAccounts;
  readonly brief?: DraftBrief;
  readonly runTotals?: RunTotals;
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
}

export interface TicketActivityPosition {
  readonly sequence: number;
  readonly ticket: TicketId;
}

export type TicketListOrder = "Identity" | "RecentActivity";

export interface ProjectReadQuery {
  readonly after?: TicketId;
  readonly recentActivityAfter?: TicketActivityPosition;
  readonly order?: TicketListOrder;
  readonly limit: number;
  readonly minimumSequence?: number;
  readonly phaseFilter?: TicketPhaseFilter;
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
    query.order !== "RecentActivity"
  )
    throw new RangeError("ticket list order is invalid");
  if (query.order === "RecentActivity" && query.after !== undefined)
    throw new RangeError("ticket identity cursor cannot order recent activity");
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
  readonly command: TicketCommand;
  /** The session a command came through, where a session bearer is what carried it. */
  readonly viaSession?: SessionId;
}

export type NativeSubmissionResult =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Backlogged";
      readonly scope: BacklogScope;
      readonly retryAfterSeconds: number;
    }
  | { readonly result: "Authorized"; readonly acceptance: Accepted };

export type NativeCancellation =
  | { readonly result: "NotFound" }
  | { readonly result: "Found"; readonly cancellation: Cancelled };

export type AuthorizedResult<Value> =
  | { readonly result: "NotFound" }
  | { readonly result: "Authorized"; readonly value: Value };

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
  execution(
    principal: Principal,
    partition: Partition,
    execution: ExecutionId,
  ): Promise<ExecutionResource | undefined>;
  outputContent(
    principal: Principal,
    partition: Partition,
    execution: ExecutionId,
    ordinal: number,
  ): Promise<OutputContentRead>;
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
  cancel(
    principal: Principal,
    partition: Partition,
    operation: OperationId,
  ): Promise<NativeCancellation>;
  createConfiguration(
    principal: Principal,
    input: {
      readonly partition: Partition;
      readonly revision: ConfigurationRevisionId;
      readonly parent?: ConfigurationRevisionId;
      readonly canonical: CanonicalConfiguration;
    },
  ): Promise<AuthorizedResult<ConfigurationCreated>>;
  configurations(
    principal: Principal,
    partition: Partition,
    query: ConfigurationPageQuery,
  ): Promise<AuthorizedResult<ConfigurationPage>>;
  importRepositoryConfigurations(
    principal: Principal,
    partition: Partition,
    commit: GitObjectId,
  ): Promise<RepositoryConfigurationImportOutcome>;
  createDraft(
    principal: Principal,
    input: {
      readonly partition: Partition;
      readonly configurationRevision: ConfigurationRevisionId;
      readonly configurationDigest: string;
      readonly expectedProjectSequence: number;
      readonly authoring: ReleaseAuthoring;
      readonly brief: DraftBrief;
    },
  ): Promise<AuthorizedResult<DraftCreated>>;
  initializeDraft(
    principal: Principal,
    partition: Partition,
    revision: ConfigurationRevisionId,
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
    },
  ): Promise<AuthorizedResult<DraftRevised>>;
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
  ): Promise<ThreadOpening>;
  sendThreadMessage(
    principal: Principal,
    partition: Partition,
    input: {
      readonly session: SessionId;
      readonly turn: SessionTurnId;
      readonly message: string;
    },
  ): Promise<ThreadMessageSent>;
}

function submissionAccess(command: TicketCommand): ProjectAccessKind {
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
  | "draft"
  | "drafts"
  | "createConfiguration"
  | "createDraft"
  | "reviseDraft"
  | "deleteDraft"
>;

function nativeDraftInitializationMethod(
  access: ProjectAccess,
  authoring: AuthoringStore,
): Pick<NativeWeb, "initializeDraft"> {
  return {
    initializeDraft: async (principal, partition, revision) => {
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
      const readiness = releaseConfigurationReadiness(
        snapshot.configuration.canonical,
      );
      if (readiness.readiness === "Incomplete")
        return {
          result: "Authorized",
          value: { initialized: "ConfigurationIncomplete" },
        };
      const commandedCheckStage = firstCommandedCheckStage(
        readiness.configuration,
      );
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
            ...draftInitializationPolicy(
              snapshot.domain,
              readiness.configuration,
            ),
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
    configurations: async (principal, partition, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.configurations(
              partition,
              checkedConfigurationPageQuery(query),
            ),
          },
    configuration: async (principal, partition, revision) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : authoring.configuration(partition, revision),
  };
}

function nativeRepositoryConfigurationImportMethod(
  access: ProjectAccess,
  ports?: RepositoryConfigurationImportPorts,
): NativeWeb["importRepositoryConfigurations"] {
  return async (principal, partition, commit) => {
    const authority = await access.authorize(principal, partition, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    if (ports === undefined)
      return { result: "Unavailable", unavailable: "Repository" };
    return importRepositoryConfigurations({
      partition,
      commit,
      authority,
      ports,
    });
  };
}

/** The two reads a draft has: one by its ticket, and one page of the open ones. */
function nativeDraftReadMethods(
  access: ProjectAccess,
  authoring: AuthoringStore,
): Pick<NativeWeb, "draft" | "drafts"> {
  return {
    draft: async (principal, partition, ticket) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : authoring.draft(partition, ticket),
    drafts: async (principal, partition, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.drafts(
              partition,
              checkedDraftPageQuery(query),
            ),
          },
  };
}

function nativeAuthoringMethods(
  access: ProjectAccess,
  authoring: AuthoringStore,
): NativeAuthoringMethods {
  return {
    ...nativeDraftReadMethods(access, authoring),
    createConfiguration: async (principal, input) => {
      const authority = await access.authorize(
        principal,
        input.partition,
        "Mutate",
      );
      return authority === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.createConfiguration({ ...input, authority }),
          };
    },
    createDraft: async (principal, input) => {
      const authority = await access.authorize(
        principal,
        input.partition,
        "Mutate",
      );
      return authority === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.createDraft({ ...input, authority }),
          };
    },
    reviseDraft: async (principal, input) => {
      const authority = await access.authorize(
        principal,
        input.partition,
        "Mutate",
      );
      return authority === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.reviseDraft({ ...input, authority }),
          };
    },
    deleteDraft: async (principal, input) => {
      const authority = await access.authorize(
        principal,
        input.partition,
        "Mutate",
      );
      return authority === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await authoring.deleteDraft({ ...input, authority }),
          };
    },
  };
}

function nativeSubmitMethod(
  access: ProjectAccess,
  inbox: OperationInbox,
  backlog: ExecutionBacklogGuard,
): NativeWeb["submit"] {
  return async (principal, submission) => {
    const authority = await access.authorize(
      principal,
      submission.partition,
      submissionAccess(submission.command),
    );
    if (authority === undefined) return { result: "NotFound" };
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
  "operationalStatus" | "executions" | "execution" | "outputContent"
>;

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
    operationalStatus: async (principal, partition) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : { result: "Authorized", value: await operations().status(partition) },
    executions: async (principal, partition, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await operations().executions(
              partition,
              checkedExecutionListQuery(query),
            ),
          },
    execution: async (principal, partition, execution) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : operations().execution(partition, execution),
    outputContent: async (principal, partition, execution, ordinal) => {
      if ((await access.authorize(principal, partition, "Read")) === undefined)
        return { read: "NotFound" };
      if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 256)
        throw new RangeError("artifact ordinal is invalid");
      const resource = await operations().execution(partition, execution);
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
    },
  };
}

type NativeRunEvidenceMethods = Pick<
  NativeWeb,
  "runTurns" | "runTranscript" | "runConfiguration"
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

/** The three run-evidence reads, each reauthorizing before it reaches a store. */
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
    runTurns: async (principal, partition, execution, attempt, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : reads().turns(
            partition,
            execution,
            attempt,
            checkedRunTurnsQuery(query),
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
  };
}

/** The ticket reads, each reauthorizing before it reaches the projection. */
function nativeTicketMethods(
  access: ProjectAccess,
  reads: NativeReadStore,
): Pick<NativeWeb, "ticket" | "ticketNativeActions" | "nativeActions"> {
  return {
    ticket: async (principal, partition, ticket) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : reads.ticket(partition, ticket),
    ticketNativeActions: async (principal, partition, ticket) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : reads.ticketNativeActions(partition, ticket),
    nativeActions: async (principal, partition, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await reads.nativeActions(
              partition,
              checkedNativeActionPageQuery(query),
            ),
          },
  };
}

/**
 * The four ports the lead's read side needs. They arrive together because the
 * lead page needs all four and a deployment that composed three of them would
 * answer a page that is a quarter blank without saying which quarter.
 */
export interface NativeLeadPorts {
  readonly leads: LeadReadStore;
  readonly store: SessionStoreReadPort;
  readonly refusals: AgenticRefusalRead;
  readonly history: SelectorHistoryStore;
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
 * beyond the page answers the page with no held set and `truncated`, and a batch
 * that is gone or fails its digest is elided and counted.
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

/** Whether each standing refusal has been cleared by its ticket being authored again. */
async function nativeStandingRefusals(
  reads: NativeReadStore,
  partition: Partition,
  refusals: readonly Omit<AgenticRefusalStanding, "superseded">[],
): Promise<readonly AgenticRefusalStanding[]> {
  return Promise.all(
    refusals.map(async (refusal) => {
      const held = await reads.ticket(partition, refusal.ticket);
      return {
        ...refusal,
        superseded:
          held !== undefined &&
          agenticRefusalIsSuperseded(refusal, held.sequence),
      };
    }),
  );
}

type NativeLeadMethods = Pick<
  NativeWeb,
  | "lead"
  | "leadTranscript"
  | "agenticRefusals"
  | "ticketAgenticRefusals"
  | "selectorHistory"
>;

/** The lead's own two reads, each reauthorizing before it reaches a store. */
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
      if (standing === undefined) return { result: "NotFound" };
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

/**
 * What the member's first turn carries, which is the seeding block and no later
 * turn's, or the ceiling it would not fit under. The overflow is a refusal
 * rather than a raise because it is the project's North Star that is too long
 * and not the member's request: a bare `InvalidRequest` would tell them their
 * message was malformed, which is the one thing it was not.
 */
async function nativeThreadTurnInput(
  ports: NativeThreadPorts,
  partition: Partition,
  authority: Authority,
  seeded: boolean,
  message: string,
): Promise<string | { readonly charsMax: number }> {
  if (!seeded) return threadTurnInput(message);
  const seeding = await threadSeeding(ports.seeding, partition, authority);
  try {
    return threadTurnInput(message, seeding);
  } catch (failure) {
    if (failure instanceof RangeError)
      return { charsMax: threadTurnInputCharsMax };
    throw failure;
  }
}

/**
 * Opening the caller's own thread, which is `Mutate` and takes no session: a
 * member has one thread per project, the definer is idempotent on that, and the
 * roster it is opened with is the definer's own.
 */
function nativeOpenThreadMethod(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): NativeWeb["openThread"] {
  return async (principal, partition) => {
    const authority = await access.authorize(principal, partition, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    const ports = composedThreadPorts(threads);
    const northStar = await ports.seeding.northStar(partition);
    const opened = await ports.threads.open({
      partition,
      principal,
      session: ports.sessions.session(),
      systemPrompt: threadSystemPrompt({
        partition,
        owner: authority.subject,
        ...(northStar === undefined ? {} : { northStar }),
      }),
      credentialSlot: ports.credentialSlot,
    });
    return {
      result: opened.opened,
      thread: threadEntry(opened.thread, principal),
    };
  };
}

/**
 * The message door, which is `Mutate` and reaches the caller's own mailbox
 * alone: the session the URL names is checked against the one the caller's
 * principal resolves to, so the page a member is reading and the mailbox their
 * message lands in cannot come apart.
 */
function nativeSendThreadMessageMethod(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): NativeWeb["sendThreadMessage"] {
  return async (principal, partition, input) => {
    const authority = await access.authorize(principal, partition, "Mutate");
    if (authority === undefined) return { result: "NotFound" };
    const ports = composedThreadPorts(threads);
    const message = checkedThreadMessage(input.message);
    const mine = await ports.threads.standing({
      partition,
      session: input.session,
      query: { limit: 1 },
    });
    if (mine === undefined) return { result: "NotFound" };
    if (mine.thread.principal !== principal) return { result: "NotYourThread" };
    const standing = threadStanding(mine.thread);
    if (standing !== "Open") return { result: standing };
    const turnInput = await nativeThreadTurnInput(
      ports,
      partition,
      authority,
      mine.thread.agentReference === undefined,
      message,
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
      }),
      input.session,
      input.turn,
    );
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
        checkedThreadsLimit(threadsAnsweredMax),
      );
      return {
        result: "Found",
        threads: found.map((record) => threadEntry(record, principal)),
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
        thread: threadEntry(found.thread, principal),
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
  reads: NativeReadStore,
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
        refusals: await nativeStandingRefusals(reads, partition, page),
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
  reads: NativeReadStore,
  leads?: NativeLeadPorts,
): NativeLeadMethods {
  return {
    ...nativeLeadSessionMethods(access, leads),
    ...nativeLeadRecordMethods(access, reads, leads),
  };
}

/** The thread side of the boundary, whose reads and whose two doors reach it as one. */
function nativeThreadMethods(
  access: ProjectAccess,
  threads?: NativeThreadPorts,
): Pick<
  NativeWeb,
  "threads" | "thread" | "threadTranscript" | "openThread" | "sendThreadMessage"
> {
  return {
    ...nativeThreadReadMethods(access, threads),
    openThread: nativeOpenThreadMethod(access, threads),
    sendThreadMessage: nativeSendThreadMessageMethod(access, threads),
  };
}

/**
 * The reads answered from the projection rather than from a service, each
 * reauthorizing before it reaches the store. They are one group because they
 * are one store's reads and because a boundary listing them inline is a
 * boundary nobody can see the shape of.
 */
function nativeProjectionMethods(
  access: ProjectAccess,
  reads: NativeReadStore,
): Pick<
  NativeWeb,
  "operation" | "project" | "ticket" | "ticketNativeActions" | "nativeActions"
> {
  return {
    operation: async (principal, partition, operation) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : reads.operation(partition, operation),
    project: async (principal, partition, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : reads.project(partition, checkedProjectReadQuery(query)),
    ...nativeTicketMethods(access, reads),
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
  repositoryConfigurationImports?: RepositoryConfigurationImportPorts,
  runEvidenceReads?: RunEvidenceReadStore,
  runEvidenceContents?: RunEvidenceContentPort,
  leads?: NativeLeadPorts,
  threads?: NativeThreadPorts,
): NativeWeb {
  return {
    ...nativeRunEvidenceMethods(access, runEvidenceReads, runEvidenceContents),
    ...nativeLeadReadMethods(access, reads, leads),
    ...nativeThreadMethods(access, threads),
    importRepositoryConfigurations: nativeRepositoryConfigurationImportMethod(
      access,
      repositoryConfigurationImports,
    ),
    ...nativeConfigurationMethods(access, authoring),
    ...nativeDraftInitializationMethod(access, authoring),
    ...nativeAuthoringMethods(access, authoring),
    ...nativeOperationalMethods(access, operationalReads, outputContents),
    selectorOperationalContext: nativeSelectorContextMethod(
      access,
      selectorContexts,
    ),
    submit: nativeSubmitMethod(access, inbox, backlog),
    ...nativeProjectionMethods(access, reads),
    cancel: async (principal, partition, operation) => {
      const authority = await access.authorize(principal, partition, "Mutate");
      if (authority === undefined) return { result: "NotFound" };
      const resource = await reads.operation(partition, operation);
      if (resource === undefined) return { result: "NotFound" };
      return {
        result: "Found",
        cancellation: await inbox.cancel({ partition, operation, authority }),
      };
    },
    notifications: async (principal, partition, cursor) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : {
            result: "Authorized",
            value: await notifications.read(
              partition,
              checkedNotificationCursor(cursor),
            ),
          },
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
  return async (principal, partition, query) => {
    if ((await access.authorize(principal, partition, "Read")) === undefined)
      return { result: "NotFound" };
    if (views === undefined)
      throw new Error("native web: no dispatch-view store was composed");
    return {
      result: "Authorized",
      value: await views.read(partition, checkedDispatchViewQuery(query)),
    };
  };
}

function nativeSelectorContextMethod(
  access: ProjectAccess,
  contexts?: SelectorOperationalContextRead,
): NativeWeb["selectorOperationalContext"] {
  return async (principal, partition) => {
    if ((await access.authorize(principal, partition, "Read")) === undefined)
      return { result: "NotFound" };
    if (contexts === undefined)
      throw new Error("native web: no selector context source was composed");
    return { result: "Authorized", value: await contexts.context(partition) };
  };
}
