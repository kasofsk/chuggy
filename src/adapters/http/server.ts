import {
  record,
  fieldsOnly,
  textField,
  integerField,
} from "../../contract/fields.ts";
import type { z } from "zod";
import { nativeHttpEndpoints } from "../../contract/endpoints.ts";

import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import type { TicketId } from "../../domain/ids.ts";
import {
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
  memberScopePartition,
  type SessionBearerIdentity,
  type SessionId,
} from "../../interpreter/agentSession.ts";
import type { MemberChat } from "../../interpreter/memberChat.ts";
import type { InstallationAuthorityRead } from "../../interpreter/installationAuthority.ts";
import { phaseTags, type Phase } from "../../domain/phase.ts";
import {
  allExecutionStatuses,
  type ExecutionStatus,
} from "../../interpreter/executionScheduler.ts";
import type { ForgeInstallationId } from "../../interpreter/forgeInstallation.ts";
import type { Principal } from "../../interpreter/nativeWeb.ts";
import type { ExecutionListQuery } from "../../interpreter/operationsView.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type ProjectId,
  type TenantId,
} from "../../interpreter/projectStore.ts";
import type { NativeWeb } from "../../interpreter/nativeWeb.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import {
  asAttemptId,
  asExecutionId,
  type AttemptId,
  type ExecutionId,
} from "../../interpreter/schedulerIdentity.ts";
import {
  asConfigurationRevisionId,
  draftPageLimitDefault,
} from "../../interpreter/authoring.ts";
import type {
  ProjectStream,
  ProjectStreamHub,
} from "../../interpreter/projectStream.ts";
import type { SelectorProjectSettingsAdministration } from "../../interpreter/selectorProjectSettings.ts";
import type { SelectorProposalReviews } from "../../interpreter/selectorReview.ts";
import type { ForgeCredentialMinting } from "../../interpreter/forgeCredentials.ts";
import type { RepositoryOnboarding } from "../../interpreter/repositoryOnboarding.ts";
import type {
  ThreadLiveConnection,
  ThreadLiveHub,
} from "../../interpreter/threadLive.ts";
import { projectStreamSocket, threadLiveSocket } from "./eventStream.ts";
import {
  configurationDocumentJsonSchema,
  configurationDocumentSchemaMediaType,
} from "../../contract/configurationDocument.ts";
import { nativeHttpContractDocument } from "../../contract/document.ts";
import {
  selectorHistoryOrders,
  type SelectorHistoryOrder,
} from "../../contract/rosters.ts";
import {
  agenticRefusalsAnsweredMax,
  imageMediaTypes,
  nativeHttpBodyBytesMax,
  nativeHttpError,
  nativeHttpHeaderBytesMax,
  nativeHttpMediaType,
  nativeHttpPathSegmentCharsMax,
  nativeHttpRoutes,
  projectArtifactUploadBytesMax,
  selectorHistoryLimitMax,
  selectorProposalDispatchesAnsweredMax,
} from "../../contract/http.ts";
import { asProjectArtifactId } from "../../interpreter/finalizerPreparation.ts";
import {
  parseConfigurationCursor,
  parseDraftCursor,
  parseExecutionCursor,
  parseInventoryCursor,
  parseNativeActionCursor,
  parseTicketActivityCursor,
  parseForgeAuthorization,
  parseForgeCredentialRequest,
  parseForgeInstallationId,
  parseProjectCreation,
  parseProjectRepositoryBind,
  parseProjectRepositoryLanding,
  parseExecutionPlacement,
  parseProjectOwnerFallback,
  parseThreadLimit,
  parseSessionPlacement,
  parseProjectRepositoryRetirement,
  parseProjectRepositoryConfigure,
  parseRepositoryConfigurationHead,
  parseRepositoryConfigurationImport,
  parseConfigurationSelection,
  parseDraftCreation,
  parseDraftRevision,
  parsePartition,
  parseSelectorProjectSettings,
  parseSelectorProposalReview,
  parseSubmission,
  parseLeadInquiry,
  parseThreadHide,
  parseThreadMessage,
  parseThreadOpen,
  parseThreadRename,
  parsePersonalRunnerRedemption,
  parseWorkerPoolRedemption,
  parseRegistrationTokenRequest,
} from "./contract.ts";
import {
  cancellationResponse,
  repositoryConfigurationHeadResponse,
  repositoryConfigurationImportResponse,
  configurationResponse,
  configurationsResponse,
  dispatchViewResponse,
  draftCreationResponse,
  draftInitializationResponse,
  draftDeletionResponse,
  draftResponse,
  draftRevisionResponse,
  draftsResponse,
  failureResponse,
  forgeAppsResponse,
  forgeAuthorizationResponse,
  forgeCredentialResponse,
  forgeInstallationsResponse,
  forgeInstallationPermissionsResponse,
  forgeRepositoriesResponse,
  projectRepositoriesResponse,
  projectCreationResponse,
  projectRepositoryBindResponse,
  projectRepositoryConfigureResponse,
  projectRepositoryLandingResponse,
  projectRepositoryRetirementResponse,
  inventoryResponse,
  nativeActionsResponse,
  notificationsResponse,
  operationResponse,
  projectResponse,
  projectEntryResponse,
  ticketNativeActionsResponse,
  ticketResponse,
  executionResponse,
  executionsResponse,
  operationalStatusResponse,
  agenticRefusalsResponse,
  hostedRunsResponse,
  projectAbilitiesResponse,
  leadResponse,
  leadTranscriptResponse,
  selectorHistoryResponse,
  selectorProposalReviewResponse,
  selectorProposalsResponse,
  ticketAgenticRefusalsResponse,
  selectorOperationalContextResponse,
  selectorProjectSettingsResponse,
  selectorProjectSettingsWriteResponse,
  selectorSettingsHistoryResponse,
  outputContentResponse,
  projectArtifactReadResponse,
  projectArtifactTooLargeResponse,
  projectArtifactUploadResponse,
  runConfigurationResponse,
  runErrorResponse,
  runTranscriptResponse,
  runTurnsResponse,
  submissionResponse,
  askLeadResponse,
  leadInquiriesResponse,
  leadInquiryResponse,
  closeThreadResponse,
  hideThreadResponse,
  renameThreadResponse,
  openThreadResponse,
  chatAbilitiesResponse,
  chatProjectsResponse,
  chatThreadsResponse,
  chatThreadMessageResponse,
  openChatThreadResponse,
  threadMessageResponse,
  threadResponse,
  threadTurnStopResponse,
  threadsResponse,
  type NativeHttpResponse,
  authorityRetryAfterSeconds,
  workerPoolRedemptionResponse,
  workerPoolTokenResponse,
  workerPoolsResponse,
  personalRunnerAllowedResponse,
  personalRunnerDeregisteredResponse,
  personalRunnerDisallowedResponse,
  personalRunnerPermitResponse,
  personalRunnerRedemptionResponse,
  personalRunnerResponse,
  personalRunnerTokenResponse,
  chatHostDeregisteredResponse,
  chatHostResponse,
  executionPlacementBody,
  ownerFallbackBody,
  threadLimitBody,
  placementReadResponse,
  placementWriteResponse,
  sessionPlacementBody,
  notFound,
  sessionBearerRefusedResponse,
  actionReportResponse,
  ticketActionReachResponse,
  ticketLandingsResponse,
} from "./outcomes.ts";
import type { ActionReports } from "../../interpreter/actionReport.ts";
import type { TicketActionReaches } from "../../interpreter/ticketActionReach.ts";
import type { TicketLandingReads } from "../../interpreter/ticketLandings.ts";
import type { WorkerPoolRegistrationService } from "../../interpreter/workerPoolRegistrationToken.ts";
import type { PersonalRunnerService } from "../../interpreter/personalRunnerRegistration.ts";
import type { ExecutionPlacementAdministration } from "../../interpreter/executionPlacement.ts";
import type { PlacementAdministration } from "../../interpreter/placementRoute.ts";
import type { ProjectOwnerFallbackAdministration } from "../../interpreter/projectOwnerFallback.ts";
import type { ThreadLimitAdministration } from "../../interpreter/threadLimit.ts";
import type { SessionPlacementAdministration } from "../../interpreter/sessionPlacement.ts";
import type { ProjectCreation } from "../../interpreter/projectCreation.ts";
import {
  sessionBearerAdmission,
  type SessionBearerConfinement,
} from "./sessionBearerScope.ts";

/** Who the bearer is, and when it stops saying so, for a route that outlives one request. */
export interface AuthenticatedBearer {
  readonly principal: Principal;
  readonly expiresAtMs?: number | undefined;
  /** The session a session bearer carried, which a command records, and the partition and scope it is confined to. */
  readonly viaSession?: Pick<
    SessionBearerIdentity,
    "partition" | "session" | "scope"
  >;
}

/**
 * What one attempt to authenticate a bearer decided, which is three answers
 * and not two: who the bearer is, a token this server can say is bad, and a
 * verification it was unable to carry out.
 */
export type BearerAuthentication =
  | { readonly authenticated: "Bearer"; readonly bearer: AuthenticatedBearer }
  | { readonly authenticated: "InvalidToken" }
  | { readonly authenticated: "AuthorityUnavailable" };

export interface PrincipalAuthentication {
  authenticateBearer(token: string): Promise<BearerAuthentication>;
}

export interface NativeHttpReadiness {
  ready(): Promise<boolean>;
}

export interface NativeHttpLimits {
  readonly concurrentRequestsMax: number;
  readonly requestTimeoutMs: number;
  /** The largest body the project-artifact upload route takes, over the global media type's own. */
  readonly projectArtifactUploadBytesMax: number;
}

export const nativeHttpLimitsDefault: NativeHttpLimits = {
  concurrentRequestsMax: 64,
  requestTimeoutMs: 15_000,
  projectArtifactUploadBytesMax,
};

type InitialNativeWeb = Pick<
  NativeWeb,
  | "cancel"
  | "configuration"
  | "configurations"
  | "importRepositoryConfigurations"
  | "repositoryConfigurationHead"
  | "createDraft"
  | "initializeDraft"
  | "deleteDraft"
  | "dispatchView"
  | "draft"
  | "drafts"
  | "notifications"
  | "operation"
  | "project"
  | "projectInventory"
  | "reviseDraft"
  | "submit"
  | "ticket"
  | "ticketNativeActions"
  | "nativeActions"
  | "execution"
  | "executions"
  | "operationalStatus"
  | "selectorOperationalContext"
  | "hostedRuns"
  | "abilities"
  | "lead"
  | "leadTranscript"
  | "agenticRefusals"
  | "ticketAgenticRefusals"
  | "selectorHistory"
  | "outputContent"
  | "uploadProjectArtifact"
  | "projectArtifact"
  | "runTurns"
  | "runTranscript"
  | "runConfiguration"
  | "runError"
  | "threads"
  | "thread"
  | "threadTranscript"
  | "openThread"
  | "sendThreadMessage"
  | "stopThreadTurn"
  | "closeThread"
  | "renameThread"
  | "hideThread"
  | "leadInquiries"
  | "leadInquiry"
  | "askLead"
>;

/** Sends one response the outcome mappers built, headers and all. */
export function nativeHttpSend(
  reply: FastifyReply,
  result: NativeHttpResponse,
): void {
  for (const [name, value] of Object.entries(result.headers)) {
    void reply.header(name, value);
  }
  void reply.code(result.status).send(result.body);
}

/** The refusal a server with no room answers, which names how soon to ask again. */
function serverBusy(reply: FastifyReply): FastifyReply {
  return reply
    .code(503)
    .header("retry-after", "1")
    .type(nativeHttpMediaType)
    .send(nativeHttpError("ServerBusy", "The server is at capacity."));
}

function bearer(authorization: string | undefined): string | undefined {
  if (authorization === undefined) return undefined;
  const matched = /^Bearer ([^ ]+)$/iu.exec(authorization);
  return matched?.[1];
}

function requireVersionedJson(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (failure?: Error) => void,
): void {
  if (
    request.headers["content-type"]?.split(";", 1)[0] === nativeHttpMediaType
  ) {
    done();
    return;
  }
  void reply
    .code(415)
    .type(nativeHttpMediaType)
    .send(
      nativeHttpError(
        "UnsupportedMediaType",
        "The request media type is unsupported.",
      ),
    );
}

function principalOf(request: FastifyRequest): Principal {
  const principal = request.principal;
  if (principal === undefined)
    throw new Error("authenticated route has no principal");
  return principal;
}

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
    streaming?: boolean;
  }

  interface FastifyRequest {
    principal?: Principal;
    bearerExpiresAtMs?: number;
    viaSession?: SessionId;
  }
}

/**
 * RFC 6750's two challenges. A request that offered nothing is told what to
 * offer; a request whose token this server verified and rejected is told that,
 * so a client can tell a credential it must replace from one it need not.
 */
async function unauthenticated(
  reply: FastifyReply,
  invalidToken: boolean,
): Promise<void> {
  void reply.header(
    "www-authenticate",
    invalidToken ? 'Bearer error="invalid_token"' : "Bearer",
  );
  await reply
    .code(401)
    .type(nativeHttpMediaType)
    .send(nativeHttpError("Unauthenticated", "Authentication is required."));
}

/**
 * A key set this server could not reach or read is this server failing, and
 * answering it as a refusal of the token would tell every caller to replace a
 * credential that is not the problem.
 */
async function authorityUnavailable(reply: FastifyReply): Promise<void> {
  await reply
    .code(503)
    .header("retry-after", String(authorityRetryAfterSeconds))
    .type(nativeHttpMediaType)
    .send(
      nativeHttpError(
        "AuthorityUnavailable",
        "The token could not be verified.",
      ),
    );
}

/**
 * The bearer a request carries as the authentication decided it, or nothing
 * once the refusal it met has been answered: no token or a rejected one as
 * unauthenticated, and a verification that could not be made as a wait.
 */
export async function nativeHttpBearerAuthenticated(
  authentication: PrincipalAuthentication,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedBearer | undefined> {
  const token = bearer(request.headers.authorization);
  if (token === undefined) {
    await unauthenticated(reply, false);
    return undefined;
  }
  const decided = await authentication
    .authenticateBearer(token)
    .catch(() => ({ authenticated: "AuthorityUnavailable" }) as const);
  if (decided.authenticated === "AuthorityUnavailable") {
    await authorityUnavailable(reply);
    return undefined;
  }
  if (decided.authenticated === "InvalidToken") {
    await unauthenticated(reply, true);
    return undefined;
  }
  return decided.bearer;
}

function registerAuthentication(
  app: FastifyInstance,
  authentication: PrincipalAuthentication,
  chat?: MemberChat,
): void {
  app.decorateRequest("principal");
  app.decorateRequest("bearerExpiresAtMs");
  app.decorateRequest("viaSession");
  app.addHook("preHandler", async (request, reply) => {
    if (request.routeOptions.config.public === true) return;
    const authenticated = await nativeHttpBearerAuthenticated(
      authentication,
      request,
      reply,
    );
    if (authenticated === undefined) return reply;
    const session = authenticated.viaSession;
    if (
      session !== undefined &&
      !(await registerAuthenticationSession(request, reply, chat, {
        ...session,
        principal: authenticated.principal,
      }))
    )
      return reply;
    request.principal = authenticated.principal;
    if (authenticated.expiresAtMs !== undefined)
      request.bearerExpiresAtMs = authenticated.expiresAtMs;
    if (session !== undefined) request.viaSession = session.session;
  });
}

/**
 * Whether a session bearer may reach the route this request matched, having
 * answered it when it may not: another partition, or a member's own session
 * whose owner may no longer open unscoped chat, as an unauthorized read is
 * answered, and a route no session may reach as `insufficient_scope`.
 */
async function registerAuthenticationSession(
  request: FastifyRequest,
  reply: FastifyReply,
  chat: MemberChat | undefined,
  session: SessionBearerConfinement,
): Promise<boolean> {
  const admission = sessionBearerAdmission(
    session,
    request.method,
    request.routeOptions.url,
    request.params,
  );
  switch (admission) {
    case "Admitted":
      if (
        session.scope === "Project" ||
        (chat !== undefined &&
          (await chat.opens(session.principal, session.partition.tenant)))
      )
        return true;
      nativeHttpSend(reply, notFound());
      return false;
    case "OtherPartition":
      nativeHttpSend(reply, notFound());
      return false;
    case "Refused":
      nativeHttpSend(reply, sessionBearerRefusedResponse());
      return false;
  }
}

function registerCapacity(app: FastifyInstance, requestsMax: number): void {
  let active = 0;
  const admitted = new WeakSet<FastifyRequest>();
  const capacityRelease = (request: FastifyRequest): Promise<void> => {
    if (admitted.delete(request)) active -= 1;
    return Promise.resolve();
  };
  app.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions.config.streaming === true) return;
    if (active >= requestsMax) {
      await serverBusy(reply);
      return reply;
    }
    active += 1;
    admitted.add(request);
  });
  app.addHook("onResponse", capacityRelease);
  app.addHook("onRequestAbort", capacityRelease);
}

function registerHealth(
  app: FastifyInstance,
  readiness: NativeHttpReadiness,
): void {
  app.get("/health/live", { config: { public: true } }, (_request, reply) => {
    void reply.code(200).send({ status: "live" });
  });
  app.get(
    "/health/ready",
    { config: { public: true } },
    async (_request, reply) => {
      const ready = await readiness.ready().catch(() => false);
      void reply
        .code(ready ? 200 : 503)
        .send({ status: ready ? "ready" : "unready" });
    },
  );
}

function registerContract(app: FastifyInstance): void {
  app.get(
    "/api/v1/contract",
    { config: { public: true } },
    (_request, reply) => {
      void reply
        .header("cache-control", "no-cache")
        .type(nativeHttpMediaType)
        .send(nativeHttpContractDocument());
    },
  );
  app.get(
    "/api/v1/configuration-schema",
    { config: { public: true } },
    (_request, reply) => {
      void reply
        .header("cache-control", "no-cache")
        .type(configurationDocumentSchemaMediaType)
        .send(configurationDocumentJsonSchema());
    },
  );
}

function registerInstallation(
  app: FastifyInstance,
  authority: InstallationAuthorityRead,
): void {
  app.get(
    "/api/v1/installation",
    { config: { public: true } },
    async (_request, reply) => {
      void reply
        .type(nativeHttpMediaType)
        .send({ installation: await authority.installationAuthority() });
    },
  );
}

function registerInventory(app: FastifyInstance, web: InitialNativeWeb): void {
  app.get("/api/v1/projects", async (request, reply) => {
    const query = fieldsOnly(request.query, ["cursor", "limit"]);
    const cursor = query["cursor"];
    const after =
      cursor === undefined
        ? undefined
        : parseInventoryCursor(textField(query, "cursor"));
    const page = await web.projectInventory(
      principalOf(request),
      after,
      integerField(query, "limit", 50),
    );
    nativeHttpSend(reply, inventoryResponse(page));
  });
}

function registerProjectCreation(
  app: FastifyInstance,
  creation: ProjectCreation,
): void {
  app.post(
    "/api/v1/projects",
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string")
        throw new TypeError("idempotency key is absent");
      nativeHttpSend(
        reply,
        projectCreationResponse(
          await creation.create(
            principalOf(request),
            parseProjectCreation(request.body, key),
          ),
        ),
      );
    },
  );
}

function partitionOf(
  request: FastifyRequest,
): ReturnType<typeof parsePartition> {
  const params = record(request.params);
  return parsePartition(
    textField(params, "tenant"),
    textField(params, "project"),
  );
}

function registerProject(app: FastifyInstance, web: InitialNativeWeb): void {
  const root = "/api/v1/tenants/:tenant/projects/:project";
  const projectRead = async (request: FastifyRequest, reply: FastifyReply) => {
    const query = fieldsOnly(request.query, [
      "after",
      "cursor",
      "limit",
      "minimumSequence",
      "order",
      "phase",
    ]);
    const after = query["after"];
    const order = query["order"];
    if (order !== undefined && order !== "RecentActivity")
      throw new TypeError("order is invalid");
    if (query["cursor"] !== undefined && order !== "RecentActivity")
      throw new TypeError("cursor requires recent activity order");
    if (after !== undefined && order === "RecentActivity")
      throw new TypeError("after cannot order recent activity");
    const partition = partitionOf(request);
    const result = await web.project(principalOf(request), partition, {
      ...(after === undefined
        ? {}
        : { after: asTicketIdField(query, "after") }),
      limit: integerField(query, "limit", 50),
      ...(order === undefined ? {} : { order }),
      ...(query["cursor"] === undefined
        ? {}
        : {
            recentActivityAfter: parseTicketActivityCursor(
              textField(query, "cursor"),
              partition,
            ),
          }),
      ...(query["minimumSequence"] === undefined
        ? {}
        : { minimumSequence: integerField(query, "minimumSequence") }),
      ...phaseFilter(query["phase"]),
    });
    nativeHttpSend(reply, projectResponse(result));
  };
  app.get(root, projectRead);
  app.get(`${root}/tickets`, projectRead);
  app.get(`${root}/tickets/:ticket`, async (request, reply) => {
    const params = record(request.params);
    const resource = await web.ticket(
      principalOf(request),
      partitionOf(request),
      asTicketIdField(params, "ticket"),
    );
    nativeHttpSend(reply, ticketResponse(resource));
  });
  registerNativeActions(app, web, root);
  registerAgenticRefusals(app, web, root);
  registerOperationalRoutes(app, web, root);
  registerRunEvidenceRoutes(app, web);
}

function registerHostedRuns(app: FastifyInstance, web: InitialNativeWeb): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.hostedRuns,
    (_request, principal, partition) => web.hostedRuns(principal, partition),
    hostedRunsResponse,
  );
}

function registerProjectAbilities(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.abilities,
    (_request, principal, partition) => web.abilities(principal, partition),
    projectAbilitiesResponse,
  );
}

function registerLead(app: FastifyInstance, web: InitialNativeWeb): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.lead,
    (_request, principal, partition) => web.lead(principal, partition),
    leadResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.leadTranscript,
    (request, principal, partition) => {
      const query = nativeHttpEndpoints.leadTranscript.query.parse(
        request.query,
      );
      return web.leadTranscript(principal, partition, {
        ...(query.stream === undefined
          ? {}
          : { stream: asSessionStoreStream(query.stream) }),
        after: query.after,
        limit: query.limit,
      });
    },
    leadTranscriptResponse,
  );
}

/** The lead's refusals, across a project and under the one ticket each names. */
function registerAgenticRefusals(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.get(`${root}/agentic-refusals`, async (request, reply) => {
    const query = fieldsOnly(request.query, ["limit"]);
    nativeHttpSend(
      reply,
      agenticRefusalsResponse(
        await web.agenticRefusals(
          principalOf(request),
          partitionOf(request),
          integerField(query, "limit", agenticRefusalsAnsweredMax),
        ),
      ),
    );
  });
  app.get(
    `${root}/tickets/:ticket/agentic-refusals`,
    async (request, reply) => {
      const params = record(request.params);
      nativeHttpSend(
        reply,
        ticketAgenticRefusalsResponse(
          await web.ticketAgenticRefusals(
            principalOf(request),
            partitionOf(request),
            asTicketIdField(params, "ticket"),
          ),
        ),
      );
    },
  );
}

/** Which end of the decision log a request asked for, defaulting to the oldest. */
function selectorHistoryOrder(value: unknown): SelectorHistoryOrder {
  if (value === undefined) return "oldest";
  const order = selectorHistoryOrders.find((known) => known === value);
  if (order === undefined)
    throw new TypeError("selector history order is not a known order");
  return order;
}

/** The decision log, beside the settings the decisions were made under. */
function registerSelectorHistory(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.get(`${root}/selector-history`, async (request, reply) => {
    const query = fieldsOnly(request.query, ["after", "limit", "order"]);
    nativeHttpSend(
      reply,
      selectorHistoryResponse(
        await web.selectorHistory(principalOf(request), partitionOf(request), {
          ...(query["after"] === undefined
            ? {}
            : { after: integerField(query, "after") }),
          limit: integerField(query, "limit", selectorHistoryLimitMax),
          order: selectorHistoryOrder(query["order"]),
        }),
      ),
    );
  });
}

/** The lead's held decisions, read and answered by a principal who may dispatch. */
function registerSelectorProposals(
  app: FastifyInstance,
  reviews: SelectorProposalReviews,
): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.selectorProposals,
    (_request, principal, partition) =>
      reviews.pending(
        principal,
        partition,
        selectorProposalDispatchesAnsweredMax,
      ),
    selectorProposalsResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.reviewSelectorProposal,
    async (request, principal, partition) => {
      const review = parseSelectorProposalReview(
        textField(record(request.params), "decision"),
        request.body,
      );
      const result =
        review.outcome === "Approved"
          ? await reviews.approve(
              principal,
              partition,
              review.decision,
              review.feedback,
            )
          : await reviews.reject(
              principal,
              partition,
              review.decision,
              review.feedback,
            );
      return { review, result };
    },
    ({ review, result }) =>
      selectorProposalReviewResponse(result, review.decision, review.outcome),
  );
}

function registerRunEvidenceRoutes(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.runTurns,
    (request, principal, partition) => {
      const params = record(request.params);
      const query = nativeHttpEndpoints.runTurns.query.parse(request.query);
      return web.runTurns(
        principal,
        partition,
        asExecutionId(textField(params, "execution")),
        asAttemptId(textField(params, "attempt")),
        {
          ...(query.after === undefined ? {} : { after: query.after }),
          limit: query.limit,
        },
      );
    },
    runTurnsResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.runTranscript,
    (request, principal, partition) => {
      const params = record(request.params);
      const query = nativeHttpEndpoints.runTranscript.query.parse(
        request.query,
      );
      return web.runTranscript(
        principal,
        partition,
        asExecutionId(textField(params, "execution")),
        asAttemptId(textField(params, "attempt")),
        query.after,
      );
    },
    runTranscriptResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.runConfiguration,
    (request, principal, partition) =>
      web.runConfiguration(
        principal,
        partition,
        ...registerRunEvidenceAttempt(request),
      ),
    runConfigurationResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.runError,
    (request, principal, partition) =>
      web.runError(
        principal,
        partition,
        ...registerRunEvidenceAttempt(request),
      ),
    runErrorResponse,
  );
}

/** The execution and the attempt a run-evidence route names in its path. */
function registerRunEvidenceAttempt(
  request: FastifyRequest,
): [ExecutionId, AttemptId] {
  const params = record(request.params);
  return [
    asExecutionId(textField(params, "execution")),
    asAttemptId(textField(params, "attempt")),
  ];
}

function registerNativeActions(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.get(`${root}/tickets/:ticket/native-actions`, async (request, reply) => {
    const params = record(request.params);
    const actions = await web.ticketNativeActions(
      principalOf(request),
      partitionOf(request),
      asTicketIdField(params, "ticket"),
    );
    nativeHttpSend(reply, ticketNativeActionsResponse(actions));
  });
  app.get(`${root}/native-actions`, async (request, reply) => {
    const query = fieldsOnly(request.query, ["cursor", "limit"]);
    const partition = partitionOf(request);
    const result = await web.nativeActions(principalOf(request), partition, {
      ...(query["cursor"] === undefined
        ? {}
        : {
            after: parseNativeActionCursor(
              textField(query, "cursor"),
              partition,
            ),
          }),
      limit: integerField(query, "limit", 50),
    });
    nativeHttpSend(reply, nativeActionsResponse(partition, result));
  });
}

function registerOperationalRoutes(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.operationalStatus,
    (_request, principal, partition) =>
      web.operationalStatus(principal, partition),
    operationalStatusResponse,
  );
  app.get(`${root}/executions`, async (request, reply) => {
    const partition = partitionOf(request);
    nativeHttpSend(
      reply,
      executionsResponse(
        partition,
        await web.executions(
          principalOf(request),
          partition,
          executionListQuery(request.query, partition),
        ),
      ),
    );
  });
  registerEndpoint(
    app,
    nativeHttpEndpoints.execution,
    (request, principal, partition) =>
      web.execution(
        principal,
        partition,
        asExecutionId(textField(record(request.params), "execution")),
      ),
    executionResponse,
  );
  app.get(
    `${root}/executions/:execution/artifacts/:ordinal`,
    async (request, reply) => {
      const params = record(request.params);
      nativeHttpSend(
        reply,
        outputContentResponse(
          await web.outputContent(
            principalOf(request),
            partitionOf(request),
            asExecutionId(textField(params, "execution")),
            integerField(params, "ordinal"),
          ),
        ),
      );
    },
  );
}

/**
 * Giving a project an image, and reading it back as base64 in a JSON body
 * rather than a bytes route, because the console's CSP admits a `data:` URI
 * and not this API's own origin. The upload is its own scope, adding rather
 * than replacing the inherited parsers, so a request already readable there
 * still reaches the session-bearer hook before this route's own media-type
 * refusal does, and every other route's parser and body ceiling stand exactly
 * where they were.
 */
function registerProjectArtifacts(
  app: FastifyInstance,
  web: InitialNativeWeb,
  uploadBytesMax: number,
): void {
  app.get(nativeHttpRoutes.projectArtifact, async (request, reply) => {
    const params = record(request.params);
    nativeHttpSend(
      reply,
      projectArtifactReadResponse(
        await web.projectArtifact(
          principalOf(request),
          partitionOf(request),
          asProjectArtifactId(textField(params, "artifact")),
        ),
      ),
    );
  });
  void app.register((scope, _options, registered) => {
    for (const mediaType of imageMediaTypes) {
      scope.addContentTypeParser(
        mediaType,
        { parseAs: "buffer", bodyLimit: uploadBytesMax },
        (_request, body, done) => {
          done(null, body);
        },
      );
    }
    scope.setErrorHandler((failure, _request, reply) => {
      if ((failure as { statusCode?: unknown }).statusCode === 413) {
        nativeHttpSend(reply, projectArtifactTooLargeResponse(uploadBytesMax));
        return;
      }
      nativeHttpSend(reply, failureResponse(failure));
    });
    scope.post(nativeHttpRoutes.projectArtifacts, async (request, reply) => {
      const mediaType = request.headers["content-type"]?.split(";", 1)[0];
      nativeHttpSend(
        reply,
        projectArtifactUploadResponse(
          await web.uploadProjectArtifact(
            principalOf(request),
            partitionOf(request),
            mediaType ?? "",
            Buffer.isBuffer(request.body) ? request.body : new Uint8Array(),
          ),
        ),
      );
    });
    registered();
  });
}

function registerSelectorContext(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  app.get(
    "/api/v1/tenants/:tenant/projects/:project/selector-context",
    async (request, reply) => {
      nativeHttpSend(
        reply,
        selectorOperationalContextResponse(
          await web.selectorOperationalContext(
            principalOf(request),
            partitionOf(request),
          ),
        ),
      );
    },
  );
}

/**
 * A project's own selector settings, read and written whole under the
 * `ManageProjectSelector` access the administration itself checks. The history
 * is beside them because a rollback is a write of a revision this read named.
 */
function registerSelectorSettings(
  app: FastifyInstance,
  settings: SelectorProjectSettingsAdministration,
): void {
  const root = "/api/v1/tenants/:tenant/projects/:project/selector-settings";
  app.get(root, async (request, reply) => {
    nativeHttpSend(
      reply,
      selectorProjectSettingsResponse(
        await settings.read(principalOf(request), partitionOf(request)),
      ),
    );
  });
  app.put(
    root,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const written = parseSelectorProjectSettings(request.body);
      nativeHttpSend(
        reply,
        selectorProjectSettingsWriteResponse(
          await settings.write(
            principalOf(request),
            partitionOf(request),
            written.expectedRevision,
            written.overrides,
          ),
        ),
      );
    },
  );
  app.get(`${root}/history`, async (request, reply) => {
    const query = fieldsOnly(request.query, ["before", "limit"]);
    nativeHttpSend(
      reply,
      selectorSettingsHistoryResponse(
        await settings.history(
          principalOf(request),
          partitionOf(request),
          query["before"] === undefined
            ? undefined
            : integerField(query, "before"),
          integerField(query, "limit", 50),
        ),
      ),
    );
  });
}

/**
 * A credential for one repository this project binds, minted per request under
 * `Execute`. The answer is the token and its expiry and nothing else, so
 * nothing a caller stores can outlive what the forge will honour.
 */
function registerForgeCredentials(
  app: FastifyInstance,
  minting: ForgeCredentialMinting,
): void {
  app.post(
    "/api/v1/tenants/:tenant/projects/:project/forge-credentials",
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      nativeHttpSend(
        reply,
        forgeCredentialResponse(
          await minting.mint(
            principalOf(request),
            partitionOf(request),
            parseForgeCredentialRequest(request.body),
          ),
        ),
      );
    },
  );
}

/**
 * The two doors a pool is registered through: an owner with `Administer` on the
 * project mints a single-use token for it, and whoever holds that token redeems
 * it once for a client and its secret. The redemption carries no bearer and is
 * declared `public` because it is authenticated by the token in its body — a
 * machine being configured has no principal yet, which is the whole reason an
 * owner had to mint the token for it.
 */
function registerWorkerPools(
  app: FastifyInstance,
  pools: WorkerPoolRegistrationService,
  partitionRoot: string,
): void {
  app.get(`${partitionRoot}/worker-pools`, async (request, reply) => {
    nativeHttpSend(
      reply,
      workerPoolsResponse(
        await pools.registered(principalOf(request), partitionOf(request)),
      ),
    );
  });
  app.post(
    `${partitionRoot}/worker-pool-registration-tokens`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      nativeHttpSend(
        reply,
        workerPoolTokenResponse(
          await pools.mint(
            principalOf(request),
            partitionOf(request),
            parseRegistrationTokenRequest(request.body),
          ),
        ),
      );
    },
  );
  app.post(
    "/api/v1/worker-pool-registrations",
    { config: { public: true }, preValidation: requireVersionedJson },
    async (request, reply) => {
      nativeHttpSend(
        reply,
        workerPoolRedemptionResponse(
          await pools.redeem(parseWorkerPoolRedemption(request.body)),
        ),
      );
    },
  );
}

/** The project one allowlist route names, read beside its tenant. */
function personalRunnerProjectOf(request: FastifyRequest): ProjectId {
  return asProjectId(textField(record(request.params), "project"));
}

/**
 * A member's own runners taken off: the caller's own, one by its id or all at
 * once, and a member's by their subject, which the tenant's administrators may
 * do for anyone and a member for themselves.
 */
function registerPersonalRunnerRemovals(
  app: FastifyInstance,
  runners: PersonalRunnerService,
): void {
  app.delete(nativeHttpRoutes.personalRunner, async (request, reply) => {
    nativeHttpSend(
      reply,
      personalRunnerDeregisteredResponse(
        await runners.deregister(principalOf(request), tenantOf(request)),
      ),
    );
  });
  app.delete(nativeHttpRoutes.personalRunnerRunner, async (request, reply) => {
    nativeHttpSend(
      reply,
      personalRunnerDeregisteredResponse(
        await runners.deregisterRunner(
          principalOf(request),
          tenantOf(request),
          textField(record(request.params), "runner"),
        ),
      ),
    );
  });
  app.delete(nativeHttpRoutes.personalRunnerMember, async (request, reply) => {
    nativeHttpSend(
      reply,
      personalRunnerDeregisteredResponse(
        await runners.deregisterMember(
          principalOf(request),
          tenantOf(request),
          textField(record(request.params), "subject"),
        ),
      ),
    );
  });
}

/**
 * A member's own runners: the token they mint for one in a tenant, its public
 * redemption, which the token in its body authenticates as a pool's does, the
 * caller's own runners read, their allowlist narrowed or widened by a project,
 * and their removal.
 */
function registerPersonalRunners(
  app: FastifyInstance,
  runners: PersonalRunnerService,
): void {
  app.post(
    nativeHttpRoutes.personalRunnerRegistrationTokens,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      nativeHttpSend(
        reply,
        personalRunnerTokenResponse(
          await runners.mint(
            principalOf(request),
            tenantOf(request),
            parseRegistrationTokenRequest(request.body),
          ),
        ),
      );
    },
  );
  app.post(
    nativeHttpRoutes.personalRunnerRegistrations,
    { config: { public: true }, preValidation: requireVersionedJson },
    async (request, reply) => {
      nativeHttpSend(
        reply,
        personalRunnerRedemptionResponse(
          await runners.redeem(parsePersonalRunnerRedemption(request.body)),
        ),
      );
    },
  );
  app.get(nativeHttpRoutes.personalRunnerPermit, async (request, reply) => {
    nativeHttpSend(
      reply,
      personalRunnerPermitResponse(
        await runners.permitted(principalOf(request), tenantOf(request)),
      ),
    );
  });
  app.get(nativeHttpRoutes.personalRunner, async (request, reply) => {
    nativeHttpSend(
      reply,
      personalRunnerResponse(
        await runners.runners(principalOf(request), tenantOf(request)),
      ),
    );
  });
  registerPersonalRunnerProjects(app, runners);
  registerPersonalRunnerRemovals(app, runners);
  registerChatHost(app, runners);
}

/**
 * A member's chat host: the token they mint for it, redeemed at the same
 * public route a runner's is, the caller's own host read, and its removal.
 */
function registerChatHost(
  app: FastifyInstance,
  runners: PersonalRunnerService,
): void {
  app.post(
    nativeHttpRoutes.chatHostRegistrationTokens,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      nativeHttpSend(
        reply,
        personalRunnerTokenResponse(
          await runners.mintChatHost(
            principalOf(request),
            tenantOf(request),
            parseRegistrationTokenRequest(request.body),
          ),
        ),
      );
    },
  );
  app.get(nativeHttpRoutes.chatHost, async (request, reply) => {
    nativeHttpSend(
      reply,
      chatHostResponse(
        await runners.chatHost(principalOf(request), tenantOf(request)),
      ),
    );
  });
  app.delete(nativeHttpRoutes.chatHost, async (request, reply) => {
    nativeHttpSend(
      reply,
      chatHostDeregisteredResponse(
        await runners.deregisterChatHost(
          principalOf(request),
          tenantOf(request),
        ),
      ),
    );
  });
}

/**
 * Registers routes that take no body in a scope that reads none. A client or a
 * proxy may send a bodyless write under a media type or as an empty chunked
 * body, and a parser refusing that would refuse the write before it is seen.
 */
function registerBodylessRoutes(
  app: FastifyInstance,
  routes: (scope: FastifyInstance) => void,
): void {
  void app.register((scope, _options, registered) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer" },
      (_request, _body, parsed) => {
        parsed(null, undefined);
      },
    );
    routes(scope);
    registered();
  });
}

function registerPersonalRunnerProjects(
  app: FastifyInstance,
  runners: PersonalRunnerService,
): void {
  registerBodylessRoutes(app, (scope) => {
    registerPersonalRunnerProjectRoutes(scope, runners);
  });
}

function registerPersonalRunnerProjectRoutes(
  app: FastifyInstance,
  runners: PersonalRunnerService,
): void {
  app.put(nativeHttpRoutes.personalRunnerProject, async (request, reply) => {
    nativeHttpSend(
      reply,
      personalRunnerAllowedResponse(
        await runners.allow(
          principalOf(request),
          tenantOf(request),
          personalRunnerProjectOf(request),
        ),
      ),
    );
  });
  app.delete(nativeHttpRoutes.personalRunnerProject, async (request, reply) => {
    nativeHttpSend(
      reply,
      personalRunnerDisallowedResponse(
        await runners.disallow(
          principalOf(request),
          tenantOf(request),
          personalRunnerProjectOf(request),
        ),
      ),
    );
  });
}

/**
 * What a system outside this one reports of a declared action, `public`
 * because each reporter proves itself by its own scheme. It is registered in a
 * scope of its own so that its parsers are its own: a scheme may verify a
 * signature over the body as sent, so the body is handed over as bytes under
 * either media type and read by nobody first.
 */
function registerActionReports(
  app: FastifyInstance,
  reports: ActionReports,
): void {
  void app.register((scope, _options, registered) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      [nativeHttpMediaType, "application/json"],
      { parseAs: "buffer" },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );
    scope.post(
      nativeHttpRoutes.actionReports,
      { config: { public: true } },
      async (request, reply) => {
        const address = record(request.params);
        nativeHttpSend(
          reply,
          actionReportResponse(
            await reports.report({
              tenant: textField(address, "tenant"),
              project: textField(address, "project"),
              action: textField(address, "action"),
              headers: request.headers,
              body: Buffer.isBuffer(request.body)
                ? request.body
                : new Uint8Array(),
            }),
          ),
        );
      },
    );
    registered();
  });
}

/**
 * Where a project's executions run: read under `Read` and written whole under
 * `Administer`, a hosted route needing the tenant's grant besides.
 */
function registerPlacement<Routes, View>(
  app: FastifyInstance,
  path: string,
  placement: PlacementAdministration<Routes, View>,
  parse: (body: unknown) => Routes,
  body: (view: View) => unknown,
): void {
  app.get(path, async (request, reply) => {
    nativeHttpSend(
      reply,
      placementReadResponse(
        await placement.read(principalOf(request), partitionOf(request)),
        body,
      ),
    );
  });
  app.put(
    path,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const written = parse(request.body);
      nativeHttpSend(
        reply,
        placementWriteResponse(
          await placement.write(
            principalOf(request),
            partitionOf(request),
            written,
          ),
          body,
        ),
      );
    },
  );
}

/**
 * How many threads one member may hold open in a project: read under `Read`
 * and written whole under `Administer`, the member named by their subject.
 */
function registerThreadLimits(
  app: FastifyInstance,
  limits: ThreadLimitAdministration,
): void {
  const subjectOf = (request: FastifyRequest) =>
    textField(record(request.params), "subject");
  app.get(nativeHttpRoutes.threadLimit, async (request, reply) => {
    nativeHttpSend(
      reply,
      placementReadResponse(
        await limits.read(
          principalOf(request),
          partitionOf(request),
          subjectOf(request),
        ),
        threadLimitBody,
      ),
    );
  });
  app.put(
    nativeHttpRoutes.threadLimit,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const threadsMax = parseThreadLimit(request.body);
      nativeHttpSend(
        reply,
        placementWriteResponse(
          await limits.write(
            principalOf(request),
            partitionOf(request),
            subjectOf(request),
            threadsMax,
          ),
          threadLimitBody,
        ),
      );
    },
  );
}

function tenantOf(request: FastifyRequest): TenantId {
  return asTenantId(textField(record(request.params), "tenant"));
}

function installationIdOf(request: FastifyRequest): ForgeInstallationId {
  return parseForgeInstallationId(
    textField(record(request.params), "installationId"),
  );
}

/**
 * The apps a tenant installs, the accounts a person's authorization claims, the
 * installations claimed, what each of them grants, and whether each has
 * accepted what its app asks for. THE APPS ROUTE IS AUTHENTICATED AND NOTHING
 * ELSE: it says nothing about any tenant, so every bearer reads it, and it is
 * not public because an unauthenticated route would make this deployment's
 * forge rate limit spendable by anyone who can reach the port.
 */
function registerForgeInstallations(
  app: FastifyInstance,
  onboarding: RepositoryOnboarding,
): void {
  app.get("/api/v1/forge/github", async (_request, reply) => {
    nativeHttpSend(reply, forgeAppsResponse(await onboarding.forgeApps()));
  });
  app.post(
    "/api/v1/tenants/:tenant/forge-authorizations",
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      nativeHttpSend(
        reply,
        forgeAuthorizationResponse(
          await onboarding.authorizeForge(
            principalOf(request),
            tenantOf(request),
            parseForgeAuthorization(request.body),
          ),
        ),
      );
    },
  );
  app.get(
    "/api/v1/tenants/:tenant/forge-installations",
    async (request, reply) => {
      nativeHttpSend(
        reply,
        forgeInstallationsResponse(
          await onboarding.installations(
            principalOf(request),
            tenantOf(request),
          ),
        ),
      );
    },
  );
  app.get(
    "/api/v1/tenants/:tenant/forge-installations/:installationId/repositories",
    async (request, reply) => {
      nativeHttpSend(
        reply,
        forgeRepositoriesResponse(
          await onboarding.installationRepositories(
            principalOf(request),
            tenantOf(request),
            installationIdOf(request),
          ),
        ),
      );
    },
  );
  app.get(
    "/api/v1/tenants/:tenant/forge-installations/:installationId/permissions",
    async (request, reply) => {
      nativeHttpSend(
        reply,
        forgeInstallationPermissionsResponse(
          await onboarding.installationPermissions(
            principalOf(request),
            tenantOf(request),
            installationIdOf(request),
          ),
        ),
      );
    },
  );
}

/**
 * What a project binds, and what it has bound already.
 *
 * THE IDENTITY OF A BIND IS THE HEADER'S, as it is for every other write that
 * spends one: a body carrying its own would let two requests differ in what
 * they bind while agreeing on what they are.
 */
function registerProjectRepositories(
  app: FastifyInstance,
  onboarding: RepositoryOnboarding,
): void {
  app.post(
    "/api/v1/tenants/:tenant/projects/:project/repositories",
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const partition = partitionOf(request);
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string")
        throw new TypeError("idempotency key is absent");
      nativeHttpSend(
        reply,
        projectRepositoryBindResponse(
          partition,
          await onboarding.bindRepository(
            principalOf(request),
            partition,
            parseProjectRepositoryBind(request.body, key),
          ),
        ),
      );
    },
  );
  app.get(
    "/api/v1/tenants/:tenant/projects/:project/repositories",
    async (request, reply) => {
      nativeHttpSend(
        reply,
        projectRepositoriesResponse(
          await onboarding.projectRepositories(
            principalOf(request),
            partitionOf(request),
          ),
        ),
      );
    },
  );
}

/**
 * Where a project's bound repository lands its work. It is a write against the
 * landing the caller last read rather than a plain replacement, so a console
 * that read a stale row moves nothing and is told which one stands.
 */
function registerProjectRepositoryLanding(
  app: FastifyInstance,
  onboarding: RepositoryOnboarding,
): void {
  app.put(
    "/api/v1/tenants/:tenant/projects/:project/repositories/landing",
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const written = parseProjectRepositoryLanding(request.body);
      nativeHttpSend(
        reply,
        projectRepositoryLandingResponse(
          await onboarding.setLanding(
            principalOf(request),
            partitionOf(request),
            written,
          ),
        ),
      );
    },
  );
}

/**
 * One binding retired. It is a PUT rather than a DELETE because the binding
 * stays: what the call writes is a fact on the row, and a caller repeating it
 * gets the same answer.
 */
function registerProjectRepositoryRetirement(
  app: FastifyInstance,
  onboarding: RepositoryOnboarding,
): void {
  app.put(
    "/api/v1/tenants/:tenant/projects/:project/repositories/retirement",
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      nativeHttpSend(
        reply,
        projectRepositoryRetirementResponse(
          await onboarding.retireRepository(
            principalOf(request),
            partitionOf(request),
            parseProjectRepositoryRetirement(request.body),
          ),
        ),
      );
    },
  );
}

/**
 * One binding's configuration step asked for again. It is a PUT for the reason
 * retirement is: a caller repeating it is answered what the first one left,
 * and the bootstrap it may author is the repository's one revision however
 * many ask.
 */
function registerProjectRepositoryConfigurations(
  app: FastifyInstance,
  onboarding: RepositoryOnboarding,
): void {
  app.put(
    "/api/v1/tenants/:tenant/projects/:project/repositories/configurations",
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      nativeHttpSend(
        reply,
        projectRepositoryConfigureResponse(
          await onboarding.configureRepository(
            principalOf(request),
            partitionOf(request),
            parseProjectRepositoryConfigure(request.body),
          ),
        ),
      );
    },
  );
}

/** The executions read's own parameters: its cursor, its size and what it narrows to. */
function executionListQuery(
  value: unknown,
  partition: Partition,
): ExecutionListQuery {
  const query = fieldsOnly(value, ["cursor", "limit", "state", "ticket"]);
  return {
    ...(query["cursor"] === undefined
      ? {}
      : {
          after: parseExecutionCursor(textField(query, "cursor"), partition),
        }),
    limit: integerField(query, "limit", 50),
    ...(query["ticket"] === undefined
      ? {}
      : { ticket: asTicketIdField(query, "ticket") }),
    ...executionSelection(query["state"]),
  };
}

function executionSelection(value: unknown): {
  readonly selection?:
    | { readonly selection: "NonTerminal" }
    | {
        readonly selection: "Selected";
        readonly states: readonly ExecutionStatus[];
      };
} {
  if (value === undefined) return {};
  const values = Array.isArray(value) ? value : [value];
  if (values.some((state) => typeof state !== "string"))
    throw new TypeError("state is not text");
  if (values.length === 1 && values[0] === "NonTerminal")
    return { selection: { selection: "NonTerminal" } };
  if (
    values.length < 1 ||
    values.some(
      (state) =>
        state === "NonTerminal" ||
        !allExecutionStatuses.includes(state as ExecutionStatus),
    )
  )
    throw new RangeError("execution state selection is invalid");
  return {
    selection: {
      selection: "Selected",
      states: values as ExecutionStatus[],
    },
  };
}

function phaseFilter(value: unknown): {
  readonly phaseFilter?:
    | { readonly selection: "NonTerminal" }
    | { readonly selection: "Selected"; readonly phases: readonly Phase[] };
} {
  if (value === undefined) return {};
  const values = Array.isArray(value) ? value : [value];
  if (values.some((phase) => typeof phase !== "string"))
    throw new TypeError("phase is not text");
  if (values.length === 1 && values[0] === "NonTerminal")
    return { phaseFilter: { selection: "NonTerminal" } };
  if (
    values.length < 1 ||
    values.some(
      (phase) => phase === "NonTerminal" || !phaseTags.includes(phase as Phase),
    )
  )
    throw new RangeError("phase selection is invalid");
  return {
    phaseFilter: { selection: "Selected", phases: values as Phase[] },
  };
}

function asTicketIdField(
  fields: Readonly<Record<string, unknown>>,
  name: string,
): TicketId {
  const value = integerField(fields, name);
  if (value < 1) throw new RangeError(`${name} is below the first ticket`);
  return value as TicketId;
}

function registerOperations(app: FastifyInstance, web: InitialNativeWeb): void {
  const root = "/api/v1/tenants/:tenant/projects/:project/operations";
  app.post(
    root,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const partition = partitionOf(request);
      const fields = fieldsOnly(request.body, ["operation", "mutation"]);
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string")
        throw new TypeError("idempotency key is absent");
      const parsed = parseSubmission(
        textField(fields, "operation"),
        key,
        fields["mutation"],
      );
      const session = request.viaSession;
      const result = await web.submit(principalOf(request), {
        partition,
        ...parsed,
        ...(session === undefined ? {} : { viaSession: session }),
      });
      nativeHttpSend(reply, submissionResponse(partition, result));
    },
  );
  app.get(`${root}/:operation`, async (request, reply) => {
    const params = record(request.params);
    const result = await web.operation(
      principalOf(request),
      partitionOf(request),
      asOperationId(textField(params, "operation")),
    );
    nativeHttpSend(reply, operationResponse(result));
  });
  app.delete(`${root}/:operation`, async (request, reply) => {
    const params = record(request.params);
    const result = await web.cancel(
      principalOf(request),
      partitionOf(request),
      asOperationId(textField(params, "operation")),
    );
    nativeHttpSend(reply, cancellationResponse(result));
  });
}

function registerConfigurationsLatest(value: unknown): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError("latest is not true or false");
}

function registerConfigurations(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  const root = "/api/v1/tenants/:tenant/projects/:project/configurations";
  app.get(root, async (request, reply) => {
    const query = fieldsOnly(request.query, ["cursor", "latest", "limit"]);
    const cursor = query["cursor"];
    const latest = query["latest"];
    const partition = partitionOf(request);
    const result = await web.configurations(principalOf(request), partition, {
      ...(cursor === undefined
        ? {}
        : {
            after: parseConfigurationCursor(
              textField(query, "cursor"),
              partition,
            ),
          }),
      limit: integerField(query, "limit", 50),
      ...(latest === undefined
        ? {}
        : { latest: registerConfigurationsLatest(latest) }),
    });
    nativeHttpSend(reply, configurationsResponse(result));
  });
  app.post(
    `${root}/imports`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const result = await web.importRepositoryConfigurations(
        principalOf(request),
        partitionOf(request),
        parseRepositoryConfigurationImport(request.body),
      );
      nativeHttpSend(reply, repositoryConfigurationImportResponse(result));
    },
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.configurationHead,
    (request, principal, partition) =>
      web.repositoryConfigurationHead(
        principal,
        partition,
        parseRepositoryConfigurationHead(request.query),
      ),
    repositoryConfigurationHeadResponse,
  );
  app.get(`${root}/:revision`, async (request, reply) => {
    const params = record(request.params);
    const result = await web.configuration(
      principalOf(request),
      partitionOf(request),
      asConfigurationRevisionId(textField(params, "revision")),
    );
    nativeHttpSend(reply, configurationResponse(result));
  });
}

function registerDraftInitialization(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  app.get(
    "/api/v1/tenants/:tenant/projects/:project/draft-initializations/:revision",
    async (request, reply) => {
      const selection = parseConfigurationSelection(
        fieldsOnly(request.query, ["work", "evaluation", "finalization"]),
      );
      const result = await web.initializeDraft(
        principalOf(request),
        partitionOf(request),
        asConfigurationRevisionId(
          textField(record(request.params), "revision"),
        ),
        selection,
      );
      nativeHttpSend(reply, draftInitializationResponse(result));
    },
  );
}

function registerDrafts(app: FastifyInstance, web: InitialNativeWeb): void {
  const root = "/api/v1/tenants/:tenant/projects/:project/drafts";
  app.get(root, async (request, reply) => {
    const query = fieldsOnly(request.query, ["cursor", "limit"]);
    const cursor = query["cursor"];
    const partition = partitionOf(request);
    const result = await web.drafts(principalOf(request), partition, {
      ...(cursor === undefined
        ? {}
        : { cursor: parseDraftCursor(textField(query, "cursor"), partition) }),
      limit: integerField(query, "limit", draftPageLimitDefault),
    });
    nativeHttpSend(reply, draftsResponse(result));
  });
  app.post(
    root,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const session = request.viaSession;
      const result = await web.createDraft(principalOf(request), {
        partition: partitionOf(request),
        ...parseDraftCreation(request.body),
        ...(session === undefined ? {} : { originSession: session }),
      });
      nativeHttpSend(reply, draftCreationResponse(result));
    },
  );
  app.get(`${root}/:ticket`, async (request, reply) => {
    const result = await web.draft(
      principalOf(request),
      partitionOf(request),
      asTicketIdField(record(request.params), "ticket"),
    );
    nativeHttpSend(reply, draftResponse(result));
  });
  app.put(
    `${root}/:ticket`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const result = await web.reviseDraft(principalOf(request), {
        partition: partitionOf(request),
        ticket: asTicketIdField(record(request.params), "ticket"),
        ...parseDraftRevision(request.body),
      });
      nativeHttpSend(reply, draftRevisionResponse(result));
    },
  );
  registerDraftDeletion(app, web);
}

/** A draft is deleted by its address and the version in its query, never by a body. */
function registerDraftDeletion(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  registerBodylessRoutes(app, (scope) => {
    scope.delete(nativeHttpRoutes.draft, async (request, reply) => {
      const query = fieldsOnly(request.query, ["expectedVersion"]);
      const result = await web.deleteDraft(principalOf(request), {
        partition: partitionOf(request),
        ticket: asTicketIdField(record(request.params), "ticket"),
        expectedVersion: integerField(query, "expectedVersion"),
      });
      nativeHttpSend(reply, draftDeletionResponse(result));
    });
  });
}

function registerEndpoint<Value>(
  app: FastifyInstance,
  endpoint: {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly body?: z.ZodType;
  },
  read: (
    request: FastifyRequest,
    principal: Principal,
    partition: Partition,
  ) => Promise<Value>,
  respond: (value: Value, partition: Partition) => NativeHttpResponse,
): void {
  app.route({
    method: endpoint.method,
    url: endpoint.path,
    ...(endpoint.body === undefined
      ? {}
      : { preValidation: requireVersionedJson }),
    handler: async (request, reply) => {
      const partition = partitionOf(request);
      nativeHttpSend(
        reply,
        respond(
          await read(request, principalOf(request), partition),
          partition,
        ),
      );
    },
  });
}

function registerActionReach(
  app: FastifyInstance,
  reach: TicketActionReaches,
): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.ticketActionReach,
    (request, principal, partition) =>
      reach.read(
        principal,
        partition,
        asTicketIdField(record(request.params), "ticket"),
      ),
    ticketActionReachResponse,
  );
}

function registerTicketLandings(
  app: FastifyInstance,
  landings: TicketLandingReads,
): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.ticketLandings,
    (request, principal, partition) =>
      landings.read(
        principal,
        partition,
        asTicketIdField(record(request.params), "ticket"),
      ),
    ticketLandingsResponse,
  );
}

function registerEndpointSession(request: FastifyRequest): SessionId {
  return asSessionId(textField(record(request.params), "session"));
}

function registerThreadReads(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.threads,
    (_request, principal, partition) => web.threads(principal, partition),
    threadsResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.thread,
    (request, principal, partition) => {
      const query = nativeHttpEndpoints.thread.query.parse(request.query);
      return web.thread(
        principal,
        partition,
        registerEndpointSession(request),
        {
          ...(query.before === undefined ? {} : { before: query.before }),
          limit: query.limit,
        },
      );
    },
    threadResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.threadTranscript,
    (request, principal, partition) => {
      const query = nativeHttpEndpoints.threadTranscript.query.parse(
        request.query,
      );
      return web.threadTranscript(
        principal,
        partition,
        registerEndpointSession(request),
        {
          ...(query.stream === undefined
            ? {}
            : { stream: asSessionStoreStream(query.stream) }),
          after: query.after,
          limit: query.limit,
        },
      );
    },
    leadTranscriptResponse,
  );
}

function registerThreadWrites(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.openThread,
    (request, principal, partition) =>
      web.openThread(principal, partition, parseThreadOpen(request.body)),
    (result, partition) => openThreadResponse(partition, result),
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.sendThreadMessage,
    (request, principal, partition) =>
      web.sendThreadMessage(principal, partition, {
        session: registerEndpointSession(request),
        ...parseThreadMessage(request.body),
      }),
    threadMessageResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.stopThreadTurn,
    (request, principal, partition) => {
      nativeHttpEndpoints.stopThreadTurn.body.parse(request.body);
      return web.stopThreadTurn(principal, partition, {
        session: registerEndpointSession(request),
        turn: asSessionTurnId(textField(record(request.params), "turn")),
      });
    },
    threadTurnStopResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.closeThread,
    (request, principal, partition) => {
      nativeHttpEndpoints.closeThread.body.parse(request.body);
      return web.closeThread(
        principal,
        partition,
        registerEndpointSession(request),
      );
    },
    closeThreadResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.renameThread,
    (request, principal, partition) =>
      web.renameThread(principal, partition, {
        session: registerEndpointSession(request),
        ...parseThreadRename(request.body),
      }),
    renameThreadResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.hideThread,
    (request, principal, partition) =>
      web.hideThread(principal, partition, {
        session: registerEndpointSession(request),
        ...parseThreadHide(request.body),
      }),
    hideThreadResponse,
  );
}

function registerLeadInquiries(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  registerEndpoint(
    app,
    nativeHttpEndpoints.leadInquiries,
    (_request, principal, partition) => web.leadInquiries(principal, partition),
    leadInquiriesResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.leadInquiry,
    (request, principal, partition) =>
      web.leadInquiry(principal, partition, registerEndpointSession(request)),
    leadInquiryResponse,
  );
  registerEndpoint(
    app,
    nativeHttpEndpoints.askLead,
    (request, principal, partition) =>
      web.askLead(principal, partition, parseLeadInquiry(request.body)),
    (result, partition) => askLeadResponse(partition, result),
  );
}

function registerDispatchView(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  app.get(
    "/api/v1/tenants/:tenant/projects/:project/dispatch-view",
    async (request, reply) => {
      const query = fieldsOnly(request.query, ["after", "limit", "watermark"]);
      const result = await web.dispatchView(
        principalOf(request),
        partitionOf(request),
        {
          ...(query["after"] === undefined
            ? {}
            : { after: asTicketIdField(query, "after") }),
          limit: integerField(query, "limit", 50),
          ...(query["watermark"] === undefined
            ? {}
            : { watermark: integerField(query, "watermark") }),
        },
      );
      nativeHttpSend(reply, dispatchViewResponse(result));
    },
  );
}

function registerNotifications(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  app.get(
    "/api/v1/tenants/:tenant/projects/:project/notifications",
    async (request, reply) => {
      const query = fieldsOnly(request.query, ["after", "limit"]);
      const result = await web.notifications(
        principalOf(request),
        partitionOf(request),
        {
          after: integerField(query, "after", 0),
          limit: integerField(query, "limit", 50),
        },
      );
      nativeHttpSend(reply, notificationsResponse(result));
    },
  );
}

/** Where a reconnecting stream says it got to, by header or by the fetch client's query. */
function streamCursor(request: FastifyRequest): number | undefined {
  const query = fieldsOnly(request.query, ["after"]);
  if (query["after"] !== undefined) return integerField(query, "after");
  const header = request.headers["last-event-id"];
  if (header === undefined) return undefined;
  if (typeof header !== "string")
    throw new TypeError("last event id is not text");
  return integerField({ "last-event-id": header }, "last-event-id");
}

/**
 * Nothing here is hijacked until the stream has read everything it opens with,
 * because a refusal that had already sent a head would be a refusal a browser
 * reads as a stream. The socket may go away during those reads, so the handler
 * that gives the slot back is attached before they begin.
 */
async function serveProjectEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  web: InitialNativeWeb,
  hub: ProjectStreamHub,
): Promise<void> {
  const partition = partitionOf(request);
  const principal = principalOf(request);
  const after = streamCursor(request);
  const standing = await web.project(principal, partition, { limit: 1 });
  if (standing.result !== "Found") {
    nativeHttpSend(reply, projectEntryResponse(standing));
    return;
  }
  const watching: { stream?: ProjectStream; abandoned: boolean } = {
    abandoned: false,
  };
  request.raw.on("close", () => {
    watching.abandoned = true;
    watching.stream?.close();
  });
  const opened = await hub.open({
    partition,
    principal,
    after,
    expiresAtMs: request.bearerExpiresAtMs,
  });
  if (opened.opened === "AtCapacity") {
    await serverBusy(reply);
    return;
  }
  watching.stream = opened.stream;
  if (watching.abandoned) {
    opened.stream.close();
    return;
  }
  reply.hijack();
  opened.stream.begin(projectStreamSocket(reply));
}

function registerProjectEvents(
  app: FastifyInstance,
  web: InitialNativeWeb,
  hub: ProjectStreamHub,
): void {
  app.get(
    "/api/v1/tenants/:tenant/projects/:project/events",
    { config: { streaming: true } },
    (request, reply) => serveProjectEvents(request, reply, web, hub),
  );
}

/**
 * Who may listen to a thread is who may read it, so the thread read is what
 * admits, and the hub asks it again for as long as the stream is open. Every
 * refusal is answered before the reply is hijacked, and the handler that gives
 * the slot back is attached before the read, which the socket may not outlast.
 */
async function serveThreadLive(
  request: FastifyRequest,
  reply: FastifyReply,
  web: InitialNativeWeb,
  hub: ThreadLiveHub,
): Promise<void> {
  const partition = partitionOf(request);
  const session = registerEndpointSession(request);
  const listening: { connection?: ThreadLiveConnection; abandoned: boolean } = {
    abandoned: false,
  };
  request.raw.on("close", () => {
    listening.abandoned = true;
    listening.connection?.close();
  });
  const principal = principalOf(request);
  const read = () => web.thread(principal, partition, session, { limit: 1 });
  const standing = await read();
  if (standing.result !== "Found") {
    nativeHttpSend(reply, threadResponse(standing));
    return;
  }
  if (listening.abandoned) return;
  const opened = hub.open({
    partition,
    session,
    expiresAtMs: request.bearerExpiresAtMs,
    admitted: async () => (await read()).result === "Found",
  });
  if (opened.opened === "AtCapacity") {
    await serverBusy(reply);
    return;
  }
  listening.connection = opened.connection;
  reply.hijack();
  opened.connection.begin(threadLiveSocket(reply));
}

/**
 * A tenant-level door of a member's own chat, which `registerEndpoint` is for a
 * project's: the tenant the path names, and the caller, are all it is given.
 */
function registerChatEndpoint<Value>(
  app: FastifyInstance,
  endpoint: {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly body?: z.ZodType;
  },
  read: (
    request: FastifyRequest,
    principal: Principal,
    tenant: TenantId,
  ) => Promise<Value>,
  respond: (value: Value, tenant: TenantId) => NativeHttpResponse,
): void {
  app.route({
    method: endpoint.method,
    url: endpoint.path,
    ...(endpoint.body === undefined
      ? {}
      : { preValidation: requireVersionedJson }),
    handler: async (request, reply) => {
      const tenant = tenantOf(request);
      nativeHttpSend(
        reply,
        respond(await read(request, principalOf(request), tenant), tenant),
      );
    },
  });
}

function registerChatReads(app: FastifyInstance, chat: MemberChat): void {
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.chatAbilities,
    (_request, principal, tenant) => chat.abilities(principal, tenant),
    chatAbilitiesResponse,
  );
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.chatProjects,
    (request, principal, tenant) => {
      const query = nativeHttpEndpoints.chatProjects.query.parse(request.query);
      return chat.projects(principal, tenant, {
        ...(query.after === undefined
          ? {}
          : { after: asProjectId(query.after) }),
        limit: query.limit,
      });
    },
    chatProjectsResponse,
  );
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.chatThreads,
    (_request, principal, tenant) => chat.threads(principal, tenant),
    chatThreadsResponse,
  );
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.chatThread,
    (request, principal, tenant) => {
      const query = nativeHttpEndpoints.chatThread.query.parse(request.query);
      return chat.thread(principal, tenant, registerEndpointSession(request), {
        ...(query.before === undefined ? {} : { before: query.before }),
        limit: query.limit,
      });
    },
    threadResponse,
  );
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.chatThreadTranscript,
    (request, principal, tenant) => {
      const query = nativeHttpEndpoints.chatThreadTranscript.query.parse(
        request.query,
      );
      return chat.threadTranscript(
        principal,
        tenant,
        registerEndpointSession(request),
        {
          ...(query.stream === undefined
            ? {}
            : { stream: asSessionStoreStream(query.stream) }),
          after: query.after,
          limit: query.limit,
        },
      );
    },
    leadTranscriptResponse,
  );
}

function registerChatWrites(app: FastifyInstance, chat: MemberChat): void {
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.openChatThread,
    (request, principal, tenant) =>
      chat.openThread(principal, tenant, parseThreadOpen(request.body)),
    (result, tenant) => openChatThreadResponse(tenant, result),
  );
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.sendChatThreadMessage,
    (request, principal, tenant) =>
      chat.sendThreadMessage(principal, tenant, {
        session: registerEndpointSession(request),
        ...parseThreadMessage(request.body),
      }),
    chatThreadMessageResponse,
  );
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.stopChatThreadTurn,
    (request, principal, tenant) => {
      nativeHttpEndpoints.stopChatThreadTurn.body.parse(request.body);
      return chat.stopThreadTurn(principal, tenant, {
        session: registerEndpointSession(request),
        turn: asSessionTurnId(textField(record(request.params), "turn")),
      });
    },
    threadTurnStopResponse,
  );
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.closeChatThread,
    (request, principal, tenant) => {
      nativeHttpEndpoints.closeChatThread.body.parse(request.body);
      return chat.closeThread(
        principal,
        tenant,
        registerEndpointSession(request),
      );
    },
    closeThreadResponse,
  );
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.renameChatThread,
    (request, principal, tenant) =>
      chat.renameThread(principal, tenant, {
        session: registerEndpointSession(request),
        ...parseThreadRename(request.body),
      }),
    renameThreadResponse,
  );
  registerChatEndpoint(
    app,
    nativeHttpEndpoints.hideChatThread,
    (request, principal, tenant) =>
      chat.hideThread(principal, tenant, {
        session: registerEndpointSession(request),
        ...parseThreadHide(request.body),
      }),
    hideThreadResponse,
  );
}

/**
 * A member's own thread is listened to as a project's is, admitted by the
 * read of it, which is its owner's alone, and keyed by the partition reserved
 * for them.
 */
async function serveChatThreadLive(
  request: FastifyRequest,
  reply: FastifyReply,
  chat: MemberChat,
  hub: ThreadLiveHub,
): Promise<void> {
  const tenant = tenantOf(request);
  const session = registerEndpointSession(request);
  const listening: { connection?: ThreadLiveConnection; abandoned: boolean } = {
    abandoned: false,
  };
  request.raw.on("close", () => {
    listening.abandoned = true;
    listening.connection?.close();
  });
  const principal = principalOf(request);
  const read = () => chat.thread(principal, tenant, session, { limit: 1 });
  const standing = await read();
  if (standing.result !== "Found") {
    nativeHttpSend(reply, threadResponse(standing));
    return;
  }
  if (listening.abandoned) return;
  const opened = hub.open({
    partition: memberScopePartition(tenant, principal),
    session,
    expiresAtMs: request.bearerExpiresAtMs,
    admitted: async () => (await read()).result === "Found",
  });
  if (opened.opened === "AtCapacity") {
    await serverBusy(reply);
    return;
  }
  listening.connection = opened.connection;
  reply.hijack();
  opened.connection.begin(threadLiveSocket(reply));
}

/** Every door of a member's own chat, its live stream where threads are streamed. */
function registerMemberChat(
  app: FastifyInstance,
  chat: MemberChat,
  hub: ThreadLiveHub | undefined,
): void {
  registerChatReads(app, chat);
  registerChatWrites(app, chat);
  if (hub !== undefined)
    app.get(
      nativeHttpRoutes.chatThreadLive,
      { config: { streaming: true } },
      (request, reply) => serveChatThreadLive(request, reply, chat, hub),
    );
}

function registerThreadLive(
  app: FastifyInstance,
  web: InitialNativeWeb,
  hub: ThreadLiveHub,
): void {
  app.get(
    nativeHttpRoutes.threadLive,
    { config: { streaming: true } },
    (request, reply) => serveThreadLive(request, reply, web, hub),
  );
}

/** The server every route is registered on: its bounds, its media type, and no response cached. */
function nativeHttpServer(limits: NativeHttpLimits): FastifyInstance {
  const app = fastify({
    bodyLimit: nativeHttpBodyBytesMax,
    requestTimeout: limits.requestTimeoutMs,
    routerOptions: { maxParamLength: nativeHttpPathSegmentCharsMax },
    forceCloseConnections: "idle",
    http: { maxHeaderSize: nativeHttpHeaderBytesMax },
  });
  nativeHttpMediaTypeServed(app);
  return app;
}

/** Reads a body sent as the API's media type, and lets no answer be cached that does not say it may be. */
export function nativeHttpMediaTypeServed(app: FastifyInstance): void {
  app.addContentTypeParser(
    nativeHttpMediaType,
    { parseAs: "string", bodyLimit: nativeHttpBodyBytesMax },
    app.getDefaultJsonParser("error", "error"),
  );
  app.addHook("onSend", (_request, reply) => {
    if (!reply.hasHeader("cache-control")) {
      void reply.header("cache-control", "no-store");
    }
    return Promise.resolve();
  });
}

/** The registrations of both kinds of runner, each where its service is composed. */
function registerRunners(
  app: FastifyInstance,
  partitionRoot: string,
  workerPools: WorkerPoolRegistrationService | undefined,
  personalRunners: PersonalRunnerService | undefined,
): void {
  if (workerPools !== undefined)
    registerWorkerPools(app, workerPools, partitionRoot);
  if (personalRunners !== undefined)
    registerPersonalRunners(app, personalRunners);
}

function registerPlacements(
  app: FastifyInstance,
  placement: ExecutionPlacementAdministration | undefined,
  sessionPlacement: SessionPlacementAdministration | undefined,
  ownerFallback: ProjectOwnerFallbackAdministration | undefined,
): void {
  if (ownerFallback !== undefined)
    registerPlacement(
      app,
      nativeHttpRoutes.ownerFallback,
      ownerFallback,
      parseProjectOwnerFallback,
      ownerFallbackBody,
    );
  if (placement !== undefined)
    registerPlacement(
      app,
      nativeHttpRoutes.executionPlacement,
      placement,
      parseExecutionPlacement,
      executionPlacementBody,
    );
  if (sessionPlacement !== undefined)
    registerPlacement(
      app,
      nativeHttpRoutes.sessionPlacement,
      sessionPlacement,
      parseSessionPlacement,
      sessionPlacementBody,
    );
}

/** A tenant's forge accounts and a project's repositories, bound and configured. */
function registerOnboarding(
  app: FastifyInstance,
  onboarding: RepositoryOnboarding,
): void {
  registerForgeInstallations(app, onboarding);
  registerProjectRepositories(app, onboarding);
  registerProjectRepositoryLanding(app, onboarding);
  registerProjectRepositoryRetirement(app, onboarding);
  registerProjectRepositoryConfigurations(app, onboarding);
}

export function createNativeHttpApp(
  web: InitialNativeWeb,
  authentication: PrincipalAuthentication,
  readiness: NativeHttpReadiness,
  authority: InstallationAuthorityRead,
  limits: NativeHttpLimits = nativeHttpLimitsDefault,
  hub?: ProjectStreamHub,
  selectorSettings?: SelectorProjectSettingsAdministration,
  forgeCredentials?: ForgeCredentialMinting,
  onboarding?: RepositoryOnboarding,
  workerPools?: WorkerPoolRegistrationService,
  creation?: ProjectCreation,
  placement?: ExecutionPlacementAdministration,
  sessionPlacement?: SessionPlacementAdministration,
  proposalReviews?: SelectorProposalReviews,
  threadLive?: ThreadLiveHub,
  actionReports?: ActionReports,
  actionReach?: TicketActionReaches,
  landings?: TicketLandingReads,
  personalRunners?: PersonalRunnerService,
  ownerFallback?: ProjectOwnerFallbackAdministration,
  threadLimits?: ThreadLimitAdministration,
  chat?: MemberChat,
): FastifyInstance {
  const app = nativeHttpServer(limits);
  const partitionRoot = "/api/v1/tenants/:tenant/projects/:project";
  registerCapacity(app, limits.concurrentRequestsMax);
  registerAuthentication(app, authentication, chat);
  registerHealth(app, readiness);
  registerContract(app);
  registerInstallation(app, authority);
  registerInventory(app, web);
  if (creation !== undefined) registerProjectCreation(app, creation);
  registerProject(app, web);
  registerHostedRuns(app, web);
  registerProjectAbilities(app, web);
  registerLead(app, web);
  registerSelectorContext(app, web);
  registerSelectorHistory(app, web, partitionRoot);
  if (selectorSettings !== undefined)
    registerSelectorSettings(app, selectorSettings);
  if (proposalReviews !== undefined)
    registerSelectorProposals(app, proposalReviews);
  if (forgeCredentials !== undefined)
    registerForgeCredentials(app, forgeCredentials);
  if (onboarding !== undefined) registerOnboarding(app, onboarding);
  registerOperations(app, web);
  registerProjectArtifacts(app, web, limits.projectArtifactUploadBytesMax);
  registerNotifications(app, web);
  if (hub !== undefined) registerProjectEvents(app, web, hub);
  registerConfigurations(app, web);
  registerDraftInitialization(app, web);
  registerDrafts(app, web);
  registerThreadReads(app, web);
  if (threadLive !== undefined) registerThreadLive(app, web, threadLive);
  registerThreadWrites(app, web);
  if (threadLimits !== undefined) registerThreadLimits(app, threadLimits);
  if (chat !== undefined) registerMemberChat(app, chat, threadLive);
  registerLeadInquiries(app, web);
  registerDispatchView(app, web);
  registerRunners(app, partitionRoot, workerPools, personalRunners);
  registerPlacements(app, placement, sessionPlacement, ownerFallback);
  if (actionReports !== undefined) registerActionReports(app, actionReports);
  if (actionReach !== undefined) registerActionReach(app, actionReach);
  if (landings !== undefined) registerTicketLandings(app, landings);
  app.setErrorHandler((failure, _request, reply) => {
    nativeHttpSend(reply, failureResponse(failure));
  });
  return app;
}
