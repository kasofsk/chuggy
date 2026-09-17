/** Public route calls return their parsed response or the outcome that replaced it. */

import {
  nativeHttpEndpoints,
  endpointPath,
  type EndpointParameters,
} from "../../../../src/contract/endpoints.ts";

import { partitionPath } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { nativeHttpRoutes } from "../../../../src/contract/http.ts";
import {
  forgeAppsResponseSchema,
  forgeInstallationClaimedSchema,
  forgeInstallationsResponseSchema,
  forgeRepositoriesResponseSchema,
  installationResponseSchema,
  projectInventoryResponseSchema,
  projectRepositoriesResponseSchema,
  projectRepositoryAlreadyBoundSchema,
  projectRepositoryBoundSchema,
  projectRepositoryCreatedSchema,
  projectRepositoryLandingWrittenSchema,
} from "../../../../src/contract/responses.ts";
import type {
  ForgeAppsResponse,
  ForgeInstallationClaimedResponse,
  ForgeInstallationsResponse,
  ForgeRepositoriesResponse,
  InstallationResponse,
  ProjectInventoryResponse,
  ProjectRepositoriesResponse,
  ProjectRepositoryAlreadyBoundResponse,
  ProjectRepositoryBoundResponse,
  ProjectRepositoryCreatedResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import type {
  forgeInstallationClaimSchema,
  leadInquirySchema,
  projectRepositoryBindSchema,
  projectRepositoryCreateSchema,
  projectRepositoryLandingSchema,
  threadMessageSchema,
} from "../../../../src/contract/requests.ts";
import type { z } from "zod";

import { apiRead } from "./apiRequest.ts";
import type { ApiPorts, ApiRequest, ApiResult } from "./apiRequest.ts";

export const projectInventoryPagesMax = 32;

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

function apiProjectEndpoint<
  Value,
  Body,
  Path extends string,
  Arguments extends unknown[],
>(
  endpoint: {
    readonly method: "GET" | "POST";
    readonly path: Path;
    readonly response: z.ZodType<Value>;
    readonly body?: z.ZodType<Body>;
  },
  input: (
    partition: PartitionIdentity,
    ...args: Arguments
  ) => {
    readonly parameters: EndpointParameters<Path>;
    readonly query?: Query;
    readonly body?: Body;
  },
) {
  return (
    ports: ApiPorts,
    partition: PartitionIdentity,
    ...args: Arguments
  ): Promise<ApiResult<Value>> => {
    const request = input(partition, ...args);
    return apiRead(
      ports,
      {
        method: endpoint.method,
        path: apiPath(
          endpointPath(endpoint.path, request.parameters),
          request.query,
        ),
        ...(request.body === undefined ? {} : { body: request.body }),
      },
      (value) => endpoint.response.parse(value),
    );
  };
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
    (value) => projectRepositoryLandingWrittenSchema.parse(value).repository,
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

export interface NativeActionsPage {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ExecutionsPage {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
  readonly ticket?: number | undefined;
  readonly state?: string | undefined;
}

export interface RunTurnsPage {
  readonly after?: number | undefined;
  readonly limit?: number | undefined;
}

/** The project's lead session, its mailbox tail and the streams its store holds. */
export const apiLead = apiProjectEndpoint(
  nativeHttpEndpoints.lead,
  (partition) => ({ parameters: partition }),
);

export interface LeadTranscriptPage {
  readonly stream?: string | undefined;
  readonly after?: number | undefined;
  readonly limit?: number | undefined;
}

/** The chain over the batches above the one named, with the held subset marked. */
export const apiLeadTranscript = apiProjectEndpoint(
  nativeHttpEndpoints.leadTranscript,
  (partition, page: LeadTranscriptPage = {}) => ({
    parameters: partition,
    query: { stream: page.stream, after: page.after, limit: page.limit },
  }),
);

/**
 * The project's member threads, each saying whether it is the caller's own.
 * `mine` is the server's answer and never this browser's: nothing here decodes
 * a token, so who is signed in is a question only the API can be asked.
 */
export const apiThreads = apiProjectEndpoint(
  nativeHttpEndpoints.threads,
  (partition) => ({ parameters: partition }),
);

/** The caller's own thread, opened where they have none and answered where they
 * have: the route is idempotent, so this is safe to press twice. The body is
 * an empty object rather than nothing, because the door takes only versioned
 * JSON and a request with no body carries no media type to be versioned. */
export const apiOpenThread = apiProjectEndpoint(
  nativeHttpEndpoints.openThread,
  (partition) => ({ parameters: partition, body: {} }),
);

/**
 * One thread: whose it is, where it stands, and a page of its mailbox. The
 * unparameterised read is the newest page; `before` walks backwards from a
 * cursor the read before it answered.
 */
export const apiThread = apiProjectEndpoint(
  nativeHttpEndpoints.thread,
  (
    partition,
    session: string,
    page: { readonly before?: number; readonly limit?: number } = {},
  ) => ({
    parameters: { ...partition, session },
    query: { before: page.before, limit: page.limit },
  }),
);

/** One thread's store, paged exactly as the lead's is and by the same walk. */
export const apiThreadTranscript = apiProjectEndpoint(
  nativeHttpEndpoints.threadTranscript,
  (partition, session: string, page: LeadTranscriptPage = {}) => ({
    parameters: { ...partition, session },
    query: { stream: page.stream, after: page.after, limit: page.limit },
  }),
);

/**
 * Every inquiry against this project's lead, newest first and bounded by the
 * route. There is no page and no limit: the listing takes neither, so asking
 * for one would be a query arm the route rejects the whole read for.
 */
export const apiLeadInquiries = apiProjectEndpoint(
  nativeHttpEndpoints.leadInquiries,
  (partition) => ({ parameters: partition }),
);

/** One inquiry: what was asked, and the answer where the fork has given one. */
export const apiLeadInquiry = apiProjectEndpoint(
  nativeHttpEndpoints.leadInquiry,
  (partition, session: string) => ({ parameters: { ...partition, session } }),
);

/**
 * A message into the caller's own thread. The turn identity is in the body
 * rather than an idempotency header because enqueuing is idempotent on it, so a
 * retried post answers the ordinal it already has instead of a second turn.
 */
export const apiSendThreadMessage = apiProjectEndpoint(
  nativeHttpEndpoints.sendThreadMessage,
  (
    partition,
    session: string,
    message: z.infer<typeof threadMessageSchema>,
  ) => ({ parameters: { ...partition, session }, body: message }),
);

/**
 * Closes one thread, whoever's it is: the door is the project's `Mutate` and
 * not the thread's owner. It is terminal and idempotent, so a second press is
 * answered the closed thread rather than refused; the body is an empty object
 * for the reason `apiOpenThread`'s is.
 */
export const apiCloseThread = apiProjectEndpoint(
  nativeHttpEndpoints.closeThread,
  (partition, session: string) => ({
    parameters: { ...partition, session },
    body: {},
  }),
);

/**
 * Names one thread. An empty title clears the member's name and leaves the
 * title derived from the first message, so a rail row never goes blank.
 */
export const apiRenameThread = apiProjectEndpoint(
  nativeHttpEndpoints.renameThread,
  (partition, session: string, title: string) => ({
    parameters: { ...partition, session },
    body: { title },
  }),
);

/** Takes one thread off the reader's rail, or puts it back. Nothing is deleted. */
export const apiHideThread = apiProjectEndpoint(
  nativeHttpEndpoints.hideThread,
  (partition, session: string, hidden: boolean) => ({
    parameters: { ...partition, session },
    body: { hidden },
  }),
);

/**
 * A question asked aside, which opens one fork and one turn.
 *
 * The two identities are minted by the caller, the way an operation id is, and
 * the door is idempotent on them — so a retried post answers the ordinal it
 * already has rather than forking the lead again, which is why this is the one
 * write here with no idempotency key: the key is in the body, and a header
 * carrying a third identity would be a second account of one fact.
 */
export const apiAskLead = apiProjectEndpoint(
  nativeHttpEndpoints.askLead,
  (partition, asked: z.infer<typeof leadInquirySchema>) => ({
    parameters: partition,
    body: asked,
  }),
);
