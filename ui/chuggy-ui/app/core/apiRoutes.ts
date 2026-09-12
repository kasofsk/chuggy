/**
 * One function per public route, each returning the route's own parsed
 * response or the outcome that replaced it.
 *
 * Every path is built from `partitionPath` and every body is read by the
 * schema `src/contract/responses.ts` publishes for that route, so nothing about
 * the wire is restated here. A submission carries an idempotency key because
 * the route refuses one that does not.
 */

import { partitionPath } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import {
  agenticRefusalsResponseSchema,
  configurationResponseSchema,
  configurationsResponseSchema,
  dispatchViewResponseSchema,
  draftInitializationResponseSchema,
  draftResponseSchema,
  executionResponseSchema,
  executionsResponseSchema,
  forgeAppsResponseSchema,
  forgeInstallationClaimedSchema,
  forgeInstallationsResponseSchema,
  forgeRepositoriesResponseSchema,
  installationResponseSchema,
  leadInquiriesResponseSchema,
  leadInquiryAcceptedSchema,
  leadInquiryResponseSchema,
  leadResponseSchema,
  leadTranscriptResponseSchema,
  notificationsResponseSchema,
  operationAcceptanceSchema,
  operationResponseSchema,
  operationalStatusResponseSchema,
  outputContentResponseSchema,
  projectInventoryResponseSchema,
  projectNativeActionsResponseSchema,
  projectRepositoriesResponseSchema,
  projectRepositoryAlreadyBoundSchema,
  projectRepositoryBoundSchema,
  projectRepositoryCreatedSchema,
  projectRepositoryResponseSchema,
  projectResponseSchema,
  repositoryConfigurationImportedSchema,
  runConfigurationResponseSchema,
  runTranscriptResponseSchema,
  runTurnsResponseSchema,
  selectorHistoryResponseSchema,
  selectorProjectSettingsResponseSchema,
  selectorSettingsHistoryResponseSchema,
  threadEntryResponseSchema,
  threadHideResponseSchema,
  threadRenameResponseSchema,
  threadMessageAcceptedSchema,
  threadResponseSchema,
  threadTranscriptResponseSchema,
  threadsResponseSchema,
  ticketNativeActionsResponseSchema,
  ticketResponseSchema,
} from "../../../../src/contract/responses.ts";
import type {
  AgenticRefusalsResponse,
  ConfigurationResponse,
  ConfigurationsResponse,
  DispatchViewResponse,
  DraftInitializationResponse,
  DraftResponse,
  ExecutionResponse,
  ExecutionsResponse,
  ForgeAppsResponse,
  ForgeInstallationClaimedResponse,
  ForgeInstallationsResponse,
  ForgeRepositoriesResponse,
  InstallationResponse,
  LeadInquiriesResponse,
  LeadInquiryAccepted,
  LeadInquiryResponse,
  LeadResponse,
  LeadTranscriptResponse,
  NotificationsResponse,
  OperationAcceptance,
  OperationResponse,
  OperationalStatusResponse,
  OutputContentResponse,
  ProjectInventoryResponse,
  ProjectNativeActionsResponse,
  ProjectRepositoriesResponse,
  ProjectRepositoryAlreadyBoundResponse,
  ProjectRepositoryBoundResponse,
  ProjectRepositoryCreatedResponse,
  ProjectRepositoryResponse,
  ProjectResponse,
  RunConfigurationResponse,
  RunTranscriptResponse,
  RunTurnsResponse,
  SelectorHistoryResponse,
  SelectorProjectSettingsResponse,
  SelectorSettingsHistoryResponse,
  ThreadEntryResponse,
  ThreadMessageAccepted,
  ThreadResponse,
  ThreadTranscriptResponse,
  ThreadsResponse,
  TicketNativeActionsResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type {
  configurationCreationSchema,
  draftCreationSchema,
  draftRevisionSchema,
  forgeInstallationClaimSchema,
  leadInquirySchema,
  projectRepositoryBindSchema,
  projectRepositoryCreateSchema,
  projectRepositoryLandingSchema,
  repositoryConfigurationImportSchema,
  selectorProjectSettingsSchema,
  submissionSchema,
  threadMessageSchema,
} from "../../../../src/contract/requests.ts";
import type { z } from "zod";

import { apiRead } from "./apiRequest.ts";
import type { ApiPorts, ApiRequest, ApiResult } from "./apiRequest.ts";

export const projectInventoryPagesMax = 32;

/** How many pages of a project's configurations the ticket form and a
 * repository's page read before they stop and say what they read. */
export const configurationPagesMax = 8;

type QueryValue = string | number | readonly string[] | undefined;

type Query = Readonly<Record<string, QueryValue>>;

/** A parameter the route reads repeatedly is given as a list and appended once
 * per member, because that is the only way the wire says two of them. */
function apiPath(base: string, query: Query = {}): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number")
      search.set(name, String(value));
    else for (const member of value) search.append(name, member);
  }
  const rendered = search.toString();
  return rendered === "" ? base : `${base}?${rendered}`;
}

function apiSegments(
  partition: PartitionIdentity,
  ...segments: readonly (string | number)[]
): string {
  return [
    partitionPath(partition),
    ...segments.map((segment) => encodeURIComponent(String(segment))),
  ].join("/");
}

function apiGet<T>(
  ports: ApiPorts,
  path: string,
  parse: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  const request: ApiRequest = {
    method: "GET",
    path,
    ...(signal ? { signal } : {}),
  };
  return apiRead(ports, request, parse);
}

export function apiInstallation(
  ports: ApiPorts,
): Promise<ApiResult<InstallationResponse>> {
  return apiGet(ports, nativeHttpRoutes.installation, (value) =>
    installationResponseSchema.parse(value),
  );
}

/**
 * One route template with its named segments filled. A project-scoped path is
 * `partitionPath`'s; a tenant-scoped one has no builder on the wire, so the
 * template the wire publishes is what is filled here rather than a second
 * spelling of the path beside it.
 */
function apiFilled(
  route: string,
  params: Readonly<Record<string, string>>,
): string {
  let path = route;
  for (const [name, value] of Object.entries(params))
    path = path.replace(`:${name}`, encodeURIComponent(value));
  return path;
}

/** Every app this deployment holds a key for, and the address each is installed from. */
export function apiForgeApps(
  ports: ApiPorts,
): Promise<ApiResult<ForgeAppsResponse>> {
  return apiGet(ports, nativeHttpRoutes.forgeApps, (value) =>
    forgeAppsResponseSchema.parse(value),
  );
}

/** Every installation one tenant has claimed, oldest first. */
export function apiForgeInstallations(
  ports: ApiPorts,
  tenant: string,
): Promise<ApiResult<ForgeInstallationsResponse>> {
  return apiGet(
    ports,
    apiFilled(nativeHttpRoutes.forgeInstallations, { tenant }),
    (value) => forgeInstallationsResponseSchema.parse(value),
  );
}

/** The claim a setup landing makes for the app the person went to install. */
export function apiClaimForgeInstallation(
  ports: ApiPorts,
  tenant: string,
  claim: z.infer<typeof forgeInstallationClaimSchema>,
): Promise<ApiResult<ForgeInstallationClaimedResponse>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiFilled(nativeHttpRoutes.forgeInstallations, { tenant }),
      body: claim,
    },
    (value) => forgeInstallationClaimedSchema.parse(value),
  );
}

/** What one claimed installation grants, and whether the listing is all of it. */
export function apiForgeInstallationRepositories(
  ports: ApiPorts,
  tenant: string,
  installationId: string,
): Promise<ApiResult<ForgeRepositoriesResponse>> {
  return apiGet(
    ports,
    apiFilled(nativeHttpRoutes.forgeInstallationRepositories, {
      tenant,
      installationId,
    }),
    (value) => forgeRepositoriesResponseSchema.parse(value),
  );
}

/** Every repository one project binds, oldest first. */
export function apiProjectRepositories(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<ProjectRepositoriesResponse>> {
  return apiGet(ports, apiSegments(partition, "repositories"), (value) =>
    projectRepositoriesResponseSchema.parse(value),
  );
}

/**
 * What a bind answers, which is one of two bodies. The route answers `201`
 * with the configurations the new binding found and `200` with the repository
 * alone, and `classify` keeps neither status, so the two are told apart by the
 * shape the wire gave them.
 */
export type ProjectRepositoryBindAnswer =
  ProjectRepositoryBoundResponse | ProjectRepositoryAlreadyBoundResponse;

const projectRepositoryBindAnswerSchema = projectRepositoryBoundSchema.or(
  projectRepositoryAlreadyBoundSchema,
);

/** One binding, under the operation identity the route refuses a bind without. */
export function apiBindProjectRepository(
  ports: ApiPorts,
  partition: PartitionIdentity,
  bind: z.infer<typeof projectRepositoryBindSchema>,
  operation: string,
): Promise<ApiResult<ProjectRepositoryBindAnswer>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "repositories"),
      body: bind,
      idempotencyKey: operation,
    },
    (value) => projectRepositoryBindAnswerSchema.parse(value),
  );
}

/**
 * One repository made on the forge and bound here, under the same operation
 * identity a bind is made under. The answer reports every step it took,
 * because a step that did not take leaves a repository that stands.
 */
export function apiCreateProjectRepository(
  ports: ApiPorts,
  partition: PartitionIdentity,
  create: z.infer<typeof projectRepositoryCreateSchema>,
  operation: string,
): Promise<ApiResult<ProjectRepositoryCreatedResponse>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "repositories", "new"),
      body: create,
      idempotencyKey: operation,
    },
    (value) => projectRepositoryCreatedSchema.parse(value),
  );
}

/**
 * One binding's landing default, written against the one the writer read. A
 * write the landing moved under is a `Conflict` carrying the binding as it
 * stands, which is the caller's to draw and never this function's to retry.
 */
export function apiWriteProjectRepositoryLanding(
  ports: ApiPorts,
  partition: PartitionIdentity,
  written: z.infer<typeof projectRepositoryLandingSchema>,
): Promise<ApiResult<ProjectRepositoryResponse>> {
  return apiRead(
    ports,
    {
      method: "PUT",
      path: apiSegments(partition, "repositories", "landing"),
      body: written,
    },
    (value) => projectRepositoryResponseSchema.parse(value),
  );
}

export function apiProjectInventory(
  ports: ApiPorts,
  page: { readonly cursor?: string | undefined } = {},
): Promise<ApiResult<ProjectInventoryResponse>> {
  return apiGet(
    ports,
    apiPath(nativeHttpRoutes.projects, { cursor: page.cursor }),
    (value) => projectInventoryResponseSchema.parse(value),
  );
}

/**
 * The inventory read to exhaustion, with a page budget: a server that keeps
 * answering with a cursor stops this walk rather than the tab.
 */
export async function apiProjectInventoryAll(
  ports: ApiPorts,
): Promise<ApiResult<readonly PartitionIdentity[]>> {
  const partitions: PartitionIdentity[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < projectInventoryPagesMax; page += 1) {
    const answered = await apiProjectInventory(ports, { cursor });
    if (answered.outcome !== "Ok") return answered;
    partitions.push(...answered.value.projects);
    cursor = answered.value.nextCursor;
    if (cursor === undefined) return { outcome: "Ok", value: partitions };
  }
  return { outcome: "Ok", value: partitions };
}

export interface ProjectPage {
  readonly after?: number | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
  readonly minimumSequence?: number | undefined;
  readonly order?: "RecentActivity" | undefined;
  readonly phase?: readonly string[] | undefined;
}

export function apiProject(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: ProjectPage = {},
  signal?: AbortSignal,
): Promise<ApiResult<ProjectResponse>> {
  return apiGet(
    ports,
    apiPath(partitionPath(partition), {
      after: page.after,
      cursor: page.cursor,
      limit: page.limit,
      minimumSequence: page.minimumSequence,
      order: page.order,
      phase: page.phase,
    }),
    (value) => projectResponseSchema.parse(value),
    signal,
  );
}

export function apiTicket(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
): Promise<ApiResult<TicketResponse>> {
  return apiGet(ports, apiSegments(partition, "tickets", ticket), (value) =>
    ticketResponseSchema.parse(value),
  );
}

export function apiDispatchView(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: { readonly after?: number; readonly limit?: number } = {},
): Promise<ApiResult<DispatchViewResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "dispatch-view"), page),
    (value) => dispatchViewResponseSchema.parse(value),
  );
}

/** Every question this one ticket has open, which the ticket read omits. */
export function apiTicketNativeActions(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
): Promise<ApiResult<TicketNativeActionsResponse>> {
  return apiGet(
    ports,
    apiSegments(partition, "tickets", ticket, "native-actions"),
    (value) => ticketNativeActionsResponseSchema.parse(value),
  );
}

export interface NativeActionsPage {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

/** The same questions across a project, where the ticket is not the path. */
export function apiNativeActions(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: NativeActionsPage = {},
): Promise<ApiResult<ProjectNativeActionsResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "native-actions"), {
      cursor: page.cursor,
      limit: page.limit,
    }),
    (value) => projectNativeActionsResponseSchema.parse(value),
  );
}

export function apiOperationalStatus(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<OperationalStatusResponse>> {
  return apiGet(ports, apiSegments(partition, "operational-status"), (value) =>
    operationalStatusResponseSchema.parse(value),
  );
}

export interface ExecutionsPage {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
  readonly ticket?: number | undefined;
  readonly state?: string | undefined;
}

/** The list is `(ticket, task)` ascending, and the cursor is a position in it. */
export function apiExecutions(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: ExecutionsPage = {},
): Promise<ApiResult<ExecutionsResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "executions"), {
      cursor: page.cursor,
      limit: page.limit,
      ticket: page.ticket,
      state: page.state,
    }),
    (value) => executionsResponseSchema.parse(value),
  );
}

export function apiExecution(
  ports: ApiPorts,
  partition: PartitionIdentity,
  execution: string,
): Promise<ApiResult<ExecutionResponse>> {
  return apiGet(
    ports,
    apiSegments(partition, "executions", execution),
    (value) => executionResponseSchema.parse(value),
  );
}

export function apiOutputContent(
  ports: ApiPorts,
  partition: PartitionIdentity,
  execution: string,
  ordinal: number,
): Promise<ApiResult<OutputContentResponse>> {
  return apiGet(
    ports,
    apiSegments(partition, "executions", execution, "artifacts", ordinal),
    (value) => outputContentResponseSchema.parse(value),
  );
}

export interface RunTurnsPage {
  readonly after?: number | undefined;
  readonly limit?: number | undefined;
}

function apiAttemptSegments(
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
  read: string,
): string {
  return apiSegments(
    partition,
    "executions",
    execution,
    "attempts",
    attempt,
    read,
  );
}

/** One run's per-turn series, ascending, resumed by the ordinal already held. */
export function apiRunTurns(
  ports: ApiPorts,
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
  page: RunTurnsPage = {},
): Promise<ApiResult<RunTurnsResponse>> {
  return apiGet(
    ports,
    apiPath(apiAttemptSegments(partition, execution, attempt, "turns"), {
      after: page.after,
      limit: page.limit,
    }),
    (value) => runTurnsResponseSchema.parse(value),
  );
}

/** The batches above the one named, which is the highest a pane already holds. */
export function apiRunTranscript(
  ports: ApiPorts,
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
  after: number,
): Promise<ApiResult<RunTranscriptResponse>> {
  return apiGet(
    ports,
    apiPath(apiAttemptSegments(partition, execution, attempt, "transcript"), {
      after,
    }),
    (value) => runTranscriptResponseSchema.parse(value),
  );
}

export function apiRunConfiguration(
  ports: ApiPorts,
  partition: PartitionIdentity,
  execution: string,
  attempt: string,
): Promise<ApiResult<RunConfigurationResponse>> {
  return apiGet(
    ports,
    apiAttemptSegments(partition, execution, attempt, "configuration"),
    (value) => runConfigurationResponseSchema.parse(value),
  );
}

export function apiOperation(
  ports: ApiPorts,
  partition: PartitionIdentity,
  operation: string,
  signal?: AbortSignal,
): Promise<ApiResult<OperationResponse>> {
  return apiGet(
    ports,
    apiSegments(partition, "operations", operation),
    (value) => operationResponseSchema.parse(value),
    signal,
  );
}

export function apiNotifications(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: { readonly after?: number | undefined } = {},
): Promise<ApiResult<NotificationsResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "notifications"), { after: page.after }),
    (value) => notificationsResponseSchema.parse(value),
  );
}

export function apiConfigurations(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: { readonly cursor?: string | undefined } = {},
): Promise<ApiResult<ConfigurationsResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "configurations"), { cursor: page.cursor }),
    (value) => configurationsResponseSchema.parse(value),
  );
}

export function apiConfiguration(
  ports: ApiPorts,
  partition: PartitionIdentity,
  revision: string,
): Promise<ApiResult<ConfigurationResponse>> {
  return apiGet(
    ports,
    apiSegments(partition, "configurations", revision),
    (value) => configurationResponseSchema.parse(value),
  );
}

export function apiDraftInitialization(
  ports: ApiPorts,
  partition: PartitionIdentity,
  revision: string,
): Promise<ApiResult<DraftInitializationResponse>> {
  return apiGet(
    ports,
    apiSegments(partition, "draft-initializations", revision),
    (value) => draftInitializationResponseSchema.parse(value),
  );
}

export function apiDraft(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
): Promise<ApiResult<DraftResponse>> {
  return apiGet(ports, apiSegments(partition, "drafts", ticket), (value) =>
    draftResponseSchema.parse(value),
  );
}

/** The project's lead session, its mailbox tail and the streams its store holds. */
export function apiLead(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<LeadResponse>> {
  return apiGet(ports, apiSegments(partition, "lead"), (value) =>
    leadResponseSchema.parse(value),
  );
}

export interface LeadTranscriptPage {
  readonly stream?: string | undefined;
  readonly after?: number | undefined;
  readonly limit?: number | undefined;
}

/** The chain over the batches above the one named, with the held subset marked. */
export function apiLeadTranscript(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: LeadTranscriptPage = {},
): Promise<ApiResult<LeadTranscriptResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "lead", "transcript"), {
      stream: page.stream,
      after: page.after,
      limit: page.limit,
    }),
    (value) => leadTranscriptResponseSchema.parse(value),
  );
}

/**
 * The project's member threads, each saying whether it is the caller's own.
 * `mine` is the server's answer and never this browser's: nothing here decodes
 * a token, so who is signed in is a question only the API can be asked.
 */
export function apiThreads(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<ThreadsResponse>> {
  return apiGet(ports, apiSegments(partition, "threads"), (value) =>
    threadsResponseSchema.parse(value),
  );
}

/** The caller's own thread, opened where they have none and answered where they
 * have: the route is idempotent, so this is safe to press twice. The body is
 * an empty object rather than nothing, because the door takes only versioned
 * JSON and a request with no body carries no media type to be versioned. */
export function apiOpenThread(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<ThreadEntryResponse>> {
  return apiRead(
    ports,
    { method: "POST", path: apiSegments(partition, "threads"), body: {} },
    (value) => threadEntryResponseSchema.parse(value),
  );
}

/**
 * One thread: whose it is, where it stands, and a page of its mailbox. The
 * unparameterised read is the newest page; `before` walks backwards from a
 * cursor the read before it answered.
 */
export function apiThread(
  ports: ApiPorts,
  partition: PartitionIdentity,
  session: string,
  page: { readonly before?: number; readonly limit?: number } = {},
): Promise<ApiResult<ThreadResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "threads", session), {
      before: page.before,
      limit: page.limit,
    }),
    (value) => threadResponseSchema.parse(value),
  );
}

/** One thread's store, paged exactly as the lead's is and by the same walk. */
export function apiThreadTranscript(
  ports: ApiPorts,
  partition: PartitionIdentity,
  session: string,
  page: LeadTranscriptPage = {},
): Promise<ApiResult<ThreadTranscriptResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "threads", session, "transcript"), {
      stream: page.stream,
      after: page.after,
      limit: page.limit,
    }),
    (value) => threadTranscriptResponseSchema.parse(value),
  );
}

/**
 * Every inquiry against this project's lead, newest first and bounded by the
 * route. There is no page and no limit: the listing takes neither, so asking
 * for one would be a query arm the route rejects the whole read for.
 */
export function apiLeadInquiries(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<LeadInquiriesResponse>> {
  return apiGet(ports, apiSegments(partition, "lead", "inquiries"), (value) =>
    leadInquiriesResponseSchema.parse(value),
  );
}

/** One inquiry: what was asked, and the answer where the fork has given one. */
export function apiLeadInquiry(
  ports: ApiPorts,
  partition: PartitionIdentity,
  session: string,
): Promise<ApiResult<LeadInquiryResponse>> {
  return apiGet(
    ports,
    apiSegments(partition, "lead", "inquiries", session),
    (value) => leadInquiryResponseSchema.parse(value),
  );
}

/**
 * A message into the caller's own thread. The turn identity is in the body
 * rather than an idempotency header because enqueuing is idempotent on it, so a
 * retried post answers the ordinal it already has instead of a second turn.
 */
export function apiSendThreadMessage(
  ports: ApiPorts,
  partition: PartitionIdentity,
  session: string,
  message: z.infer<typeof threadMessageSchema>,
): Promise<ApiResult<ThreadMessageAccepted>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "threads", session, "messages"),
      body: message,
    },
    (value) => threadMessageAcceptedSchema.parse(value),
  );
}

/**
 * Closes one thread, whoever's it is: the door is the project's `Mutate` and
 * not the thread's owner. It is terminal and idempotent, so a second press is
 * answered the closed thread rather than refused; the body is an empty object
 * for the reason `apiOpenThread`'s is.
 */
export function apiCloseThread(
  ports: ApiPorts,
  partition: PartitionIdentity,
  session: string,
): Promise<ApiResult<ThreadEntryResponse>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "threads", session, "close"),
      body: {},
    },
    (value) => threadEntryResponseSchema.parse(value),
  );
}

/**
 * Names one thread. An empty title clears the member's name and leaves the
 * title derived from the first message, so a rail row never goes blank.
 */
export function apiRenameThread(
  ports: ApiPorts,
  partition: PartitionIdentity,
  session: string,
  title: string,
): Promise<ApiResult<ThreadEntryResponse>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "threads", session, "rename"),
      body: { title },
    },
    (value) => threadRenameResponseSchema.parse(value),
  );
}

/** Takes one thread off the reader's rail, or puts it back. Nothing is deleted. */
export function apiHideThread(
  ports: ApiPorts,
  partition: PartitionIdentity,
  session: string,
  hidden: boolean,
): Promise<ApiResult<ThreadEntryResponse>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "threads", session, "hide"),
      body: { hidden },
    },
    (value) => threadHideResponseSchema.parse(value),
  );
}

/**
 * A question asked aside, which opens one fork and one turn.
 *
 * The two identities are minted by the caller, the way an operation id is, and
 * the door is idempotent on them — so a retried post answers the ordinal it
 * already has rather than forking the lead again, which is why this is the one
 * write here with no idempotency key: the key is in the body, and a header
 * carrying a third identity would be a second account of one fact.
 */
export function apiAskLead(
  ports: ApiPorts,
  partition: PartitionIdentity,
  asked: z.infer<typeof leadInquirySchema>,
): Promise<ApiResult<LeadInquiryAccepted>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "lead", "inquiries"),
      body: asked,
    },
    (value) => leadInquiryAcceptedSchema.parse(value),
  );
}

/** Every ticket in the project whose latest refusal entry still stands. */
export function apiAgenticRefusals(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: { readonly limit?: number | undefined } = {},
): Promise<ApiResult<AgenticRefusalsResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "agentic-refusals"), { limit: page.limit }),
    (value) => agenticRefusalsResponseSchema.parse(value),
  );
}

/**
 * Which end of the decision log a read starts at: `oldest` pages forward with
 * `after`, and `newest` answers the last `limit` decisions as one bounded page
 * with no cursor.
 */
export const selectorHistoryOrders = ["oldest", "newest"] as const;

export type SelectorHistoryOrder = (typeof selectorHistoryOrders)[number];

export interface SelectorHistoryPage {
  readonly after?: number | undefined;
  readonly limit?: number | undefined;
  readonly order?: SelectorHistoryOrder | undefined;
}

/** What the lead decided, from whichever end of the log the caller named. */
export function apiSelectorHistory(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: SelectorHistoryPage = {},
): Promise<ApiResult<SelectorHistoryResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "selector-history"), {
      after: page.after,
      limit: page.limit,
      order: page.order,
    }),
    (value) => selectorHistoryResponseSchema.parse(value),
  );
}

/** The project's own selector settings and what they resolve to. */
export function apiSelectorSettings(
  ports: ApiPorts,
  partition: PartitionIdentity,
): Promise<ApiResult<SelectorProjectSettingsResponse>> {
  return apiGet(ports, apiSegments(partition, "selector-settings"), (value) =>
    selectorProjectSettingsResponseSchema.parse(value),
  );
}

/**
 * The overrides written whole under the revision they were read at. A write the
 * revision moved under is a `Conflict` carrying the settings that moved, which
 * is the caller's to draw and never this function's to retry.
 */
export function apiWriteSelectorSettings(
  ports: ApiPorts,
  partition: PartitionIdentity,
  written: z.infer<typeof selectorProjectSettingsSchema>,
): Promise<ApiResult<SelectorProjectSettingsResponse>> {
  return apiRead(
    ports,
    {
      method: "PUT",
      path: apiSegments(partition, "selector-settings"),
      body: written,
    },
    (value) => selectorProjectSettingsResponseSchema.parse(value),
  );
}

export function apiSelectorSettingsHistory(
  ports: ApiPorts,
  partition: PartitionIdentity,
  page: SelectorHistoryPage = {},
): Promise<ApiResult<SelectorSettingsHistoryResponse>> {
  return apiGet(
    ports,
    apiPath(apiSegments(partition, "selector-settings", "history"), {
      after: page.after,
      limit: page.limit,
    }),
    (value) => selectorSettingsHistoryResponseSchema.parse(value),
  );
}

export function apiSubmitOperation(
  ports: ApiPorts,
  partition: PartitionIdentity,
  submission: z.infer<typeof submissionSchema>,
  signal?: AbortSignal,
): Promise<ApiResult<OperationAcceptance>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "operations"),
      body: submission,
      idempotencyKey: submission.operation,
      ...(signal ? { signal } : {}),
    },
    (value) => operationAcceptanceSchema.parse(value),
  );
}

export function apiCancelOperation(
  ports: ApiPorts,
  partition: PartitionIdentity,
  operation: string,
  signal?: AbortSignal,
): Promise<ApiResult<OperationAcceptance>> {
  return apiRead(
    ports,
    {
      method: "DELETE",
      path: apiSegments(partition, "operations", operation),
      ...(signal ? { signal } : {}),
    },
    (value) => operationAcceptanceSchema.parse(value),
  );
}

export function apiCreateConfiguration(
  ports: ApiPorts,
  partition: PartitionIdentity,
  creation: z.infer<typeof configurationCreationSchema>,
): Promise<ApiResult<ConfigurationResponse>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "configurations"),
      body: creation,
    },
    (value) => configurationResponseSchema.parse(value),
  );
}

/** A refused import is a rejection, so its faults arrive in `Rejected`'s body. */
export function apiImportRepositoryConfigurations(
  ports: ApiPorts,
  partition: PartitionIdentity,
  request: z.infer<typeof repositoryConfigurationImportSchema>,
): Promise<ApiResult<{ readonly imported: true }>> {
  return apiRead(
    ports,
    {
      method: "POST",
      path: apiSegments(partition, "configurations", "imports"),
      body: request,
    },
    (value) => repositoryConfigurationImportedSchema.parse(value),
  );
}

export function apiCreateDraft(
  ports: ApiPorts,
  partition: PartitionIdentity,
  creation: z.infer<typeof draftCreationSchema>,
): Promise<ApiResult<DraftResponse>> {
  return apiRead(
    ports,
    { method: "POST", path: apiSegments(partition, "drafts"), body: creation },
    (value) => draftResponseSchema.parse(value),
  );
}

export function apiReviseDraft(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
  revision: z.infer<typeof draftRevisionSchema>,
): Promise<ApiResult<DraftResponse>> {
  return apiRead(
    ports,
    {
      method: "PUT",
      path: apiSegments(partition, "drafts", ticket),
      body: revision,
    },
    (value) => draftResponseSchema.parse(value),
  );
}
