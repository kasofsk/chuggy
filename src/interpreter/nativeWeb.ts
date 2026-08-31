/**
 * The authenticated native-web application boundary.
 *
 * Authorization answers with the audited authority rather than a boolean, so
 * no transport can authorize one subject and record another. Reads and
 * cancellation deliberately share the same not-found result for absent and
 * inaccessible resources. This layer coordinates ports; it neither loads the
 * project actor nor owns a database transaction.
 */

import type { EscalationReason } from "../contract/rosters.ts";
import { phaseTags, type Phase } from "../domain/generated/modelTypes.ts";
import type { TicketId } from "../domain/ids.ts";
import type {
  Accepted,
  Authority,
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
  DraftResource,
  DraftRevised,
} from "./authoring.ts";
import {
  checkedConfigurationPageQuery,
  draftInitializationPolicy,
  releaseConfigurationReadiness,
} from "./authoring.ts";
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
import type { SelectorOperationalContext } from "./selector.ts";
import type { SelectorOperationalContextRead } from "./selectorOperationalContext.ts";
import type { GitObjectId } from "./finalizer.ts";
import {
  importRepositoryConfigurations,
  type RepositoryConfigurationImportOutcome,
  type RepositoryConfigurationImportPorts,
} from "./repositoryConfiguration.ts";
export { asPublicInstant, type PublicInstant } from "./publicResource.ts";

declare const principalBrand: unique symbol;

/** An authenticated session subject, opaque to the application boundary. */
export type Principal = string & { readonly [principalBrand]: true };

export function asPrincipal(value: string): Principal {
  if (value.length === 0)
    throw new RangeError("principal: an identity is empty");
  return value as Principal;
}

/**
 * The principal an OIDC identity resolves to, length-prefixing the issuer so
 * that no issuer and subject pair encodes to the same string as another's.
 * Every side that names an identity derives it here.
 */
export function oidcPrincipal(issuer: string, subject: string): Principal {
  if (issuer.length === 0) throw new RangeError("OIDC issuer is empty");
  if (subject.length === 0) throw new RangeError("OIDC subject is empty");
  return asPrincipal(`${String(issuer.length)}:${issuer}${subject}`);
}

/** Every project access kind, and the declaration `ProjectAccessKind` derives from, so narrowing a supplied kind has one list to check. */
export const allProjectAccessKinds = [
  "Read",
  "Mutate",
  "DispatchTicket",
  "ProposeDispatch",
  "ManageProjectSelector",
] as const;

export type ProjectAccessKind = (typeof allProjectAccessKinds)[number];

/** Narrows text to the access kind it names, refusing anything `authorize_project_access` would not know. */
export function asProjectAccessKind(value: string): ProjectAccessKind {
  const kind = allProjectAccessKinds.find((known) => known === value);
  if (kind === undefined)
    throw new RangeError(`project access kind: ${value} is not a known kind`);
  return kind;
}

/** Current project access and the non-reassignable authority it resolves to. */
export interface ProjectAccess {
  authorize(
    principal: Principal,
    partition: Partition,
    access: ProjectAccessKind,
  ): Promise<Authority | undefined>;
}

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
 * The reason is present exactly when the ticket is parked on the desk, and the
 * brief exactly when the ticket was authored with one.
 */
export interface TicketResource {
  readonly ticket: TicketId;
  readonly phase: Phase;
  readonly sequence: number;
  readonly reason?: EscalationReason;
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

function nativeAuthoringMethods(
  access: ProjectAccess,
  authoring: AuthoringStore,
): NativeAuthoringMethods {
  return {
    draft: async (principal, partition, ticket) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : authoring.draft(partition, ticket),
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
): NativeWeb {
  return {
    ...nativeRunEvidenceMethods(access, runEvidenceReads, runEvidenceContents),
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
    operation: async (principal, partition, operation) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? undefined
        : reads.operation(partition, operation),
    project: async (principal, partition, query) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : reads.project(partition, checkedProjectReadQuery(query)),
    ...nativeTicketMethods(access, reads),
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
