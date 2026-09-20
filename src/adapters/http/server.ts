import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {
  asSessionId,
  asSessionStoreStream,
  type SessionId,
} from "../../interpreter/agentSession.ts";
import type { InstallationAuthorityRead } from "../../interpreter/installationAuthority.ts";
import type { Principal } from "../../interpreter/nativeWeb.ts";
import {
  asTenantId,
  type Partition,
  type TenantId,
} from "../../interpreter/projectStore.ts";
import type { NativeWeb } from "../../interpreter/nativeWeb.ts";
import type { ForgeCredentialMinting } from "../../interpreter/forgeCredentials.ts";
import type { WorkerPoolRegistrationService } from "../../interpreter/workerPoolRegistrationToken.ts";
import type { RepositoryOnboarding } from "../../interpreter/repositoryOnboarding.ts";
import type {
  TicketApplication,
  TicketApplicationResult,
  TicketCatalogWrite,
  TicketDefinitionRead,
} from "../../interpreter/ticketApplication.ts";
import { TicketId as AdoptedTicketId } from "../../domain/chuggernaut/task.js";
import type { Ticket as AdoptedTicket } from "../../domain/chuggernaut/ticket.js";
import { asGitObjectId, asRepositoryId } from "../../interpreter/finalizer.ts";
import { encode as encodeChuggernaut } from "../../interpreter/codec.ts";
import type { TicketExecutionReads } from "../../interpreter/ticketExecutionRead.ts";
import type { ProjectStreamHub } from "../../interpreter/projectStream.ts";
import { projectStreamSocket, type ProjectStreamReads } from "./eventStream.ts";
import { projectStreamCursorHeader } from "../../contract/events.ts";
import { nativeHttpContractDocument } from "../../contract/document.ts";
import { integerField, textField } from "../../contract/fields.ts";
import {
  nativeHttpBodyBytesMax,
  nativeHttpError,
  nativeHttpHeaderBytesMax,
  nativeHttpMediaType,
  nativeHttpPageItemsDefault,
  nativeHttpPageItemsMax,
  nativeHttpPathSegmentCharsMax,
  nativeHttpRoutes,
  sessionStorePageBatchesMax,
  threadTurnsAnsweredMax,
} from "../../contract/http.ts";
import {
  parseInventoryCursor,
  parseForgeCredentialRequest,
  parseWorkerPoolRedemption,
  parseWorkerPoolTokenRequest,
  parseForgeInstallationClaim,
  parseForgeInstallationId,
  parseProjectRepositoryBind,
  parseProjectRepositoryCreate,
  parseProjectRepositoryLanding,
  parseProjectRepositoryRetirement,
  parsePartition,
  parseLeadInquiry,
  parseThreadHide,
  parseThreadMessage,
  parseThreadRename,
} from "./contract.ts";
import {
  failureResponse,
  forgeAppsResponse,
  forgeCredentialResponse,
  workerPoolRedemptionResponse,
  workerPoolTokenResponse,
  forgeInstallationClaimResponse,
  forgeInstallationsResponse,
  forgeRepositoriesResponse,
  projectRepositoriesResponse,
  projectRepositoryBindResponse,
  projectRepositoryCreateResponse,
  projectRepositoryLandingResponse,
  projectRepositoryRetirementResponse,
  inventoryResponse,
  leadResponse,
  leadTranscriptResponse,
  askLeadResponse,
  leadInquiriesResponse,
  leadInquiryResponse,
  closeThreadResponse,
  hideThreadResponse,
  renameThreadResponse,
  openThreadResponse,
  threadMessageResponse,
  threadResponse,
  threadsResponse,
  type NativeHttpResponse,
  authorityRetryAfterSeconds,
} from "./outcomes.ts";

/** Who the bearer is, and when it stops saying so, for a route that outlives one request. */
export interface AuthenticatedBearer {
  readonly principal: Principal;
  readonly expiresAtMs?: number | undefined;
  /** The session a command came through, where a session bearer is what carried it. */
  readonly viaSession?: SessionId;
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
}

export const nativeHttpLimitsDefault: NativeHttpLimits = {
  concurrentRequestsMax: 64,
  requestTimeoutMs: 15_000,
};

type InitialNativeWeb = NativeWeb;

function send(reply: FastifyReply, result: NativeHttpResponse): void {
  for (const [name, value] of Object.entries(result.headers)) {
    void reply.header(name, value);
  }
  void reply.code(result.status).send(result.body);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("request fields are not an object");
  return value as Readonly<Record<string, unknown>>;
}

function fieldsOnly(
  value: unknown,
  allowed: readonly string[],
): Readonly<Record<string, unknown>> {
  const found = record(value);
  if (Object.keys(found).some((name) => !allowed.includes(name)))
    throw new TypeError("request has an unknown field");
  return found;
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

function registerAuthentication(
  app: FastifyInstance,
  authentication: PrincipalAuthentication,
): void {
  app.decorateRequest("principal");
  app.decorateRequest("bearerExpiresAtMs");
  app.decorateRequest("viaSession");
  app.addHook("preHandler", async (request, reply) => {
    if (request.routeOptions.config.public === true) return;
    const token = bearer(request.headers.authorization);
    if (token === undefined) {
      await unauthenticated(reply, false);
      return reply;
    }
    const decided = await authentication
      .authenticateBearer(token)
      .catch(() => ({ authenticated: "AuthorityUnavailable" }) as const);
    if (decided.authenticated === "AuthorityUnavailable") {
      await authorityUnavailable(reply);
      return reply;
    }
    if (decided.authenticated === "InvalidToken") {
      await unauthenticated(reply, true);
      return reply;
    }
    request.principal = decided.bearer.principal;
    if (decided.bearer.expiresAtMs !== undefined)
      request.bearerExpiresAtMs = decided.bearer.expiresAtMs;
    if (decided.bearer.viaSession !== undefined)
      request.viaSession = decided.bearer.viaSession;
  });
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
      await reply
        .code(503)
        .header("retry-after", "1")
        .type(nativeHttpMediaType)
        .send(nativeHttpError("ServerBusy", "The server is at capacity."));
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
    send(reply, inventoryResponse(page));
  });
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

async function legacyTicketEndpoint(
  service: NativeTicketApplication,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const model = await service.application.graph(
    principalOf(request),
    partitionOf(request),
  );
  if (model.result === "NotFound") {
    adoptedTicketReply(reply, model);
    return;
  }
  void reply
    .code(409)
    .send(
      nativeHttpError(
        model.result === "LegacyModelUnsupported"
          ? "LegacyModelUnsupported"
          : "EndpointUnsupported",
        model.result === "LegacyModelUnsupported"
          ? "This project uses the legacy ticket model."
          : "Use the ticket-machine ticket API for this project.",
      ),
    );
}

/**
 * The lead's own read and a page of its transcript. The transcript defaults to
 * the session's own stream, because a reader who has not asked for one wants
 * the conversation rather than a subagent's.
 */
function registerLead(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.get(`${root}/lead`, async (request, reply) => {
    send(
      reply,
      leadResponse(await web.lead(principalOf(request), partitionOf(request))),
    );
  });
  app.get(`${root}/lead/transcript`, async (request, reply) => {
    const query = fieldsOnly(request.query, ["stream", "after", "limit"]);
    const stream = query["stream"];
    send(
      reply,
      leadTranscriptResponse(
        await web.leadTranscript(principalOf(request), partitionOf(request), {
          ...(stream === undefined
            ? {}
            : { stream: asSessionStoreStream(textField(query, "stream")) }),
          after: integerField(query, "after", 0),
          limit: integerField(query, "limit", sessionStorePageBatchesMax),
        }),
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
      send(
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
 * The two ends of registering a pool: an owner mints a short-lived single-use
 * token for one project, and whoever holds that token redeems it once for a
 * client and its secret. The redemption carries no bearer and is declared
 * `public` because it is authenticated by the token in its body — a machine
 * being configured has no principal yet, which is the whole reason an owner had
 * to mint the token for it.
 */
function registerWorkerPools(
  app: FastifyInstance,
  pools: WorkerPoolRegistrationService,
  partitionRoot: string,
): void {
  app.post(
    `${partitionRoot}/worker-pool-registration-tokens`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      send(
        reply,
        workerPoolTokenResponse(
          await pools.mint(
            principalOf(request),
            partitionOf(request),
            parseWorkerPoolTokenRequest(request.body),
          ),
        ),
      );
    },
  );
  app.post(
    "/api/v1/worker-pool-registrations",
    { config: { public: true }, preValidation: requireVersionedJson },
    async (request, reply) => {
      send(
        reply,
        workerPoolRedemptionResponse(
          await pools.redeem(parseWorkerPoolRedemption(request.body)),
        ),
      );
    },
  );
}

function tenantOf(request: FastifyRequest): TenantId {
  return asTenantId(textField(record(request.params), "tenant"));
}

/**
 * The apps a tenant installs, the installations it has claimed, and what each of
 * them grants. THE APPS ROUTE IS AUTHENTICATED AND NOTHING ELSE: it says nothing
 * about any tenant, so every bearer reads it, and it is not public because an
 * unauthenticated route would make this deployment's forge rate limit spendable
 * by anyone who can reach the port.
 */
function registerForgeInstallations(
  app: FastifyInstance,
  onboarding: RepositoryOnboarding,
): void {
  app.get("/api/v1/forge/github", async (_request, reply) => {
    send(reply, forgeAppsResponse(await onboarding.forgeApps()));
  });
  app.post(
    "/api/v1/tenants/:tenant/forge-installations",
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const tenant = tenantOf(request);
      send(
        reply,
        forgeInstallationClaimResponse(
          tenant,
          await onboarding.claimInstallation(
            principalOf(request),
            tenant,
            parseForgeInstallationClaim(request.body),
          ),
        ),
      );
    },
  );
  app.get(
    "/api/v1/tenants/:tenant/forge-installations",
    async (request, reply) => {
      send(
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
      send(
        reply,
        forgeRepositoriesResponse(
          await onboarding.installationRepositories(
            principalOf(request),
            tenantOf(request),
            parseForgeInstallationId(
              textField(record(request.params), "installationId"),
            ),
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
      send(
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
  app.post(
    "/api/v1/tenants/:tenant/projects/:project/repositories/new",
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const partition = partitionOf(request);
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string")
        throw new TypeError("idempotency key is absent");
      send(
        reply,
        projectRepositoryCreateResponse(
          partition,
          await onboarding.createRepository(
            principalOf(request),
            partition,
            parseProjectRepositoryCreate(request.body, key),
          ),
        ),
      );
    },
  );
  app.get(
    "/api/v1/tenants/:tenant/projects/:project/repositories",
    async (request, reply) => {
      send(
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
      send(
        reply,
        projectRepositoryLandingResponse(
          await onboarding.setLanding(
            principalOf(request),
            partitionOf(request),
            written.repository,
            written.expected,
            written.landing,
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
      send(
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
 * The project's threads and one thread's own pages, every bound checked at this
 * door so a bad cursor or a bad stream is a status rather than a raise from a
 * store.
 */
function registerThreadReads(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.get(`${root}/threads`, async (request, reply) => {
    send(
      reply,
      threadsResponse(
        await web.threads(principalOf(request), partitionOf(request)),
      ),
    );
  });
  app.get(`${root}/threads/:session`, async (request, reply) => {
    const query = fieldsOnly(request.query, ["before", "limit"]);
    const before = query["before"];
    send(
      reply,
      threadResponse(
        await web.thread(
          principalOf(request),
          partitionOf(request),
          asSessionId(textField(record(request.params), "session")),
          {
            ...(before === undefined
              ? {}
              : { before: integerField(query, "before") }),
            limit: integerField(query, "limit", threadTurnsAnsweredMax),
          },
        ),
      ),
    );
  });
  app.get(`${root}/threads/:session/transcript`, async (request, reply) => {
    const query = fieldsOnly(request.query, ["stream", "after", "limit"]);
    const stream = query["stream"];
    send(
      reply,
      leadTranscriptResponse(
        await web.threadTranscript(
          principalOf(request),
          partitionOf(request),
          asSessionId(textField(record(request.params), "session")),
          {
            ...(stream === undefined
              ? {}
              : { stream: asSessionStoreStream(textField(query, "stream")) }),
            after: integerField(query, "after", 0),
            limit: integerField(query, "limit", sessionStorePageBatchesMax),
          },
        ),
      ),
    );
  });
}

/**
 * The five thread doors, each behind the versioned media type. Opening takes an
 * empty body because a thread is the caller's own, a message takes the turn
 * identity the caller minted because that identity is the idempotency, closing
 * takes an empty body because the URL already names the thread, and renaming
 * and hiding take the one field each writes.
 */
function registerThreadWrites(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.post(
    `${root}/threads`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      fieldsOnly(request.body ?? {}, []);
      send(
        reply,
        openThreadResponse(
          partitionOf(request),
          await web.openThread(principalOf(request), partitionOf(request)),
        ),
      );
    },
  );
  app.post(
    `${root}/threads/:session/messages`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      send(
        reply,
        threadMessageResponse(
          await web.sendThreadMessage(
            principalOf(request),
            partitionOf(request),
            {
              session: asSessionId(
                textField(record(request.params), "session"),
              ),
              ...parseThreadMessage(request.body),
            },
          ),
        ),
      );
    },
  );
  app.post(
    `${root}/threads/:session/close`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      fieldsOnly(request.body ?? {}, []);
      send(
        reply,
        closeThreadResponse(
          await web.closeThread(
            principalOf(request),
            partitionOf(request),
            asSessionId(textField(record(request.params), "session")),
          ),
        ),
      );
    },
  );
  registerThreadWritesMemberView(app, web, root);
}

/** The two doors that write a member's own view of a thread: its name and whether it is on their rail. */
function registerThreadWritesMemberView(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.post(
    `${root}/threads/:session/rename`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      send(
        reply,
        renameThreadResponse(
          await web.renameThread(principalOf(request), partitionOf(request), {
            session: asSessionId(textField(record(request.params), "session")),
            ...parseThreadRename(request.body),
          }),
        ),
      );
    },
  );
  app.post(
    `${root}/threads/:session/hide`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      send(
        reply,
        hideThreadResponse(
          await web.hideThread(principalOf(request), partitionOf(request), {
            session: asSessionId(textField(record(request.params), "session")),
            ...parseThreadHide(request.body),
          }),
        ),
      );
    },
  );
}

/**
 * The lead's inquiries: the listing, one of them, and the door that asks. All
 * three are gated on `Read` inside the boundary, so nothing about the gate is
 * decided here; what IS decided here is that the ask door sits behind the
 * versioned media type like every other write, and that the two identities come
 * off the body because they are the idempotency.
 */
function registerLeadInquiries(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.get(`${root}/lead/inquiries`, async (request, reply) => {
    send(
      reply,
      leadInquiriesResponse(
        await web.leadInquiries(principalOf(request), partitionOf(request)),
      ),
    );
  });
  app.get(`${root}/lead/inquiries/:session`, async (request, reply) => {
    send(
      reply,
      leadInquiryResponse(
        await web.leadInquiry(
          principalOf(request),
          partitionOf(request),
          asSessionId(textField(record(request.params), "session")),
        ),
      ),
    );
  });
  app.post(
    `${root}/lead/inquiries`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      send(
        reply,
        askLeadResponse(
          partitionOf(request),
          await web.askLead(
            principalOf(request),
            partitionOf(request),
            parseLeadInquiry(request.body),
          ),
        ),
      );
    },
  );
}

export interface NativeTicketApplication {
  readonly application: TicketApplication;
  readonly reads?: TicketExecutionReads;
  identity(input: {
    readonly principal: Principal;
    readonly partition: Partition;
    readonly key: string;
    readonly operation: string;
  }): string;
}

function adoptedTicketNumber(
  request: FastifyRequest,
): ReturnType<typeof AdoptedTicketId> {
  return AdoptedTicketId(integerField(record(request.params), "ticket"));
}

function adoptedTicketIdentity(
  service: NativeTicketApplication,
  request: FastifyRequest,
  operation: string,
): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length === 0)
    throw new TypeError("Idempotency-Key is required");
  return service.identity({
    principal: principalOf(request),
    partition: partitionOf(request),
    key,
    operation,
  });
}

function adoptedTicketReply(reply: FastifyReply, result: unknown): void {
  const value = result as { readonly result: string; readonly value?: unknown };
  if (value.result === "NotFound") {
    void reply
      .code(404)
      .send(nativeHttpError("NotFound", "Resource not found."));
    return;
  }
  if (value.result === "LegacyModelUnsupported") {
    void reply
      .code(409)
      .send(
        nativeHttpError(
          "LegacyModelUnsupported",
          "This project uses the legacy ticket model.",
        ),
      );
    return;
  }
  const accepted = (value.value as { readonly accepted?: string } | undefined)
    ?.accepted;
  if (accepted === "InputConflict") {
    void reply
      .code(409)
      .send(nativeHttpError("InputConflict", "Idempotency input conflicts."));
    return;
  }
  if (accepted === "AuthoringRefused") {
    const refusal = value.value as { readonly message?: string };
    void reply
      .code(400)
      .send(
        nativeHttpError(
          "AuthoringRefused",
          refusal.message ?? "The ticket definition was refused.",
        ),
      );
    return;
  }
  if (accepted === "Backpressure") {
    void reply
      .code(503)
      .send(nativeHttpError("ServerBusy", "The server is at capacity."));
    return;
  }
  void reply.code(202).send(value.value);
}

function adoptedTicketMutationReply(
  reply: FastifyReply,
  identity: string,
  result: unknown,
): void {
  const value = result as { readonly result: string; readonly value?: unknown };
  const acceptance = value.value as { readonly accepted?: string } | undefined;
  if (
    value.result === "Authorized" &&
    (acceptance?.accepted === "Accepted" ||
      acceptance?.accepted === "AlreadyAccepted")
  ) {
    void reply.code(202).send({ identity, accepted: acceptance.accepted });
    return;
  }
  adoptedTicketReply(reply, result);
}

function registerAdoptedTicketReads(
  app: FastifyInstance,
  service: NativeTicketApplication,
): void {
  const root = nativeHttpRoutes.tickets;
  app.get(nativeHttpRoutes.ticketOperation, async (request, reply) => {
    const query = fieldsOnly(request.query, ["identity"]);
    const result = await service.application.outcome(
      principalOf(request),
      partitionOf(request),
      textField(query, "identity"),
    );
    if (result.result !== "Authorized") {
      adoptedTicketReply(reply, result);
      return;
    }
    if (result.value === undefined) {
      void reply
        .code(404)
        .send(nativeHttpError("NotFound", "Operation not found."));
      return;
    }
    void reply.code(200).send({
      sequence: result.value.sequence,
      decision: JSON.parse(encodeChuggernaut(result.value.decision)) as unknown,
    });
  });
  app.get(root, async (request, reply) => {
    const result = await service.application.graph(
      principalOf(request),
      partitionOf(request),
    );
    if (result.result !== "Authorized") {
      adoptedTicketReply(reply, result);
      return;
    }
    const { graph, reworkLimits } = result.value;
    void reply.code(200).send({
      tickets: [...graph.tickets.values()]
        .map((held) =>
          adoptedTicketView(held, reworkLimits.get(held.definition.id) ?? null),
        )
        .sort((left, right) => left.ticket - right.ticket),
    });
  });
  app.get(`${root}/:ticket`, async (request, reply) => {
    const result = await service.application.definition(
      principalOf(request),
      partitionOf(request),
      adoptedTicketNumber(request),
    );
    if (result.result !== "Authorized") {
      adoptedTicketReply(reply, result);
      return;
    }
    if (result.value === undefined) {
      void reply
        .code(404)
        .send(nativeHttpError("NotFound", "Ticket not found."));
      return;
    }
    void reply.code(200).send(adoptedTicketBody(result.value));
  });
}

/**
 * One ticket as every reader of one receives it: the GET, and the frame the
 * stream sends when that ticket moves. A second assembly beside this one is how
 * a frame and a read of the same ticket come to disagree.
 */
function adoptedTicketBody(read: TicketDefinitionRead) {
  return {
    ...adoptedTicketView(read.held, read.reworkLimit),
    /** Null rather than absent, so a release predating source retention still reads. */
    source: read.source ?? null,
  };
}

function adoptedTicketView(held: AdoptedTicket, reworkLimit: number | null) {
  return {
    ticket: held.definition.id,
    revision: held.revision,
    workCyclesStarted: held.work_cycles_started,
    /** Null is unbounded rework, which is what an unreleased limit also runs as. */
    reworkLimit,
    state: held.state.kind,
    dependencies: [...held.definition.dependencies].sort(
      (left, right) => left - right,
    ),
  };
}

/**
 * Which catalog a request works against. The server resolves the bound
 * repository's tip itself; `X-Chug-Repository` names which binding when a
 * project holds more than one, and `If-Catalog-Match` is the commit the caller
 * last saw, which a write is refused against when the tree has moved.
 */
function adoptedCatalogRequest(request: FastifyRequest) {
  const query = record(request.query);
  const repository =
    query["repository"] ?? request.headers["x-chug-repository"];
  const expected = request.headers["if-catalog-match"];
  return {
    partition: partitionOf(request),
    ...(typeof repository === "string"
      ? { repository: asRepositoryId(repository) }
      : {}),
    ...(typeof expected === "string"
      ? { expectedCatalogCommit: asGitObjectId(expected) }
      : {}),
  };
}

function registerAdoptedTicketCatalog(
  app: FastifyInstance,
  service: NativeTicketApplication,
): void {
  const root = nativeHttpRoutes.ticketCatalog;
  const answer = (
    reply: FastifyReply,
    result: TicketApplicationResult<object | undefined>,
  ): void => {
    if (result.result !== "Authorized") {
      adoptedTicketReply(reply, result);
      return;
    }
    if (result.value === undefined) {
      void reply
        .code(404)
        .send(nativeHttpError("NotFound", "Catalog not found."));
      return;
    }
    void reply.code(200).send(result.value);
  };
  /** An absent path asks what the catalog holds, a present one asks for that file. */
  app.get(root, async (request, reply) => {
    const path = record(request.query)["path"];
    const catalog = adoptedCatalogRequest(request);
    answer(
      reply,
      typeof path === "string"
        ? await service.application.catalogFile(
            principalOf(request),
            catalog,
            path,
          )
        : await service.application.catalog(principalOf(request), catalog),
    );
  });
  /** A runtime fragment is written and removed by the reference it is read under. */
  app.put(root, async (request, reply) => {
    if (typeof request.body !== "string")
      throw new TypeError("catalog fragment body must be text");
    adoptedCatalogWriteReply(
      reply,
      await service.application.writeCatalogFile(
        principalOf(request),
        adoptedCatalogRequest(request),
        textField(record(request.query), "path"),
        request.body,
      ),
    );
  });
  app.delete(root, async (request, reply) => {
    adoptedCatalogWriteReply(
      reply,
      await service.application.removeCatalogFile(
        principalOf(request),
        adoptedCatalogRequest(request),
        textField(record(request.query), "path"),
      ),
    );
  });
}

/** A refused fragment is a conflict with the repository, which the caller resolves there. */
function adoptedCatalogWriteReply(
  reply: FastifyReply,
  result: TicketApplicationResult<TicketCatalogWrite | undefined>,
): void {
  if (result.result !== "Authorized") {
    adoptedTicketReply(reply, result);
    return;
  }
  if (result.value === undefined) {
    void reply
      .code(404)
      .send(nativeHttpError("NotFound", "Catalog not found."));
    return;
  }
  if (result.value.written === "Refused") {
    void reply
      .code(409)
      .send(nativeHttpError("CatalogFragmentRefused", result.value.message));
    return;
  }
  if (result.value.written === "NotHeld") {
    void reply
      .code(404)
      .send(nativeHttpError("NotFound", "Catalog fragment not found."));
    return;
  }
  void reply.code(200).send({ written: result.value.written });
}

function registerAdoptedTicketValidation(
  app: FastifyInstance,
  service: NativeTicketApplication,
): void {
  app.post(nativeHttpRoutes.ticketValidation, async (request, reply) => {
    if (typeof request.body !== "string")
      throw new TypeError("ticket body must be YAML text");
    const result = await service.application.validate(principalOf(request), {
      ...adoptedCatalogRequest(request),
      source: request.body,
    });
    if (result.result !== "Authorized") {
      adoptedTicketReply(reply, result);
      return;
    }
    void reply.code(200).send(result.value);
  });
}

function registerAdoptedTicketAuthoring(
  app: FastifyInstance,
  service: NativeTicketApplication,
): void {
  const root = nativeHttpRoutes.tickets;
  app.post(root, async (request, reply) => {
    if (typeof request.body !== "string")
      throw new TypeError("ticket body must be YAML text");
    const identity = adoptedTicketIdentity(service, request, "CreateTicket");
    adoptedTicketMutationReply(
      reply,
      identity,
      await service.application.create(principalOf(request), {
        ...adoptedCatalogRequest(request),
        identity,
        source: request.body,
      }),
    );
  });
  app.put(`${root}/:ticket`, async (request, reply) => {
    if (typeof request.body !== "string")
      throw new TypeError("ticket body must be YAML text");
    const revision = request.headers["if-match"];
    if (typeof revision !== "string" || !/^[1-9][0-9]*$/u.test(revision))
      throw new TypeError("If-Match must be a positive ticket revision");
    const identity = adoptedTicketIdentity(service, request, "UpdateTicket");
    adoptedTicketMutationReply(
      reply,
      identity,
      await service.application.update(principalOf(request), {
        ...adoptedCatalogRequest(request),
        identity,
        ticket: adoptedTicketNumber(request),
        expectedRevision: Number(revision),
        source: request.body,
      }),
    );
  });
}

function registerAdoptedTicketActions(
  app: FastifyInstance,
  service: NativeTicketApplication,
): void {
  const root = nativeHttpRoutes.tickets;
  for (const action of ["revoke", "resume"] as const)
    app.post(`${root}/:ticket/${action}`, async (request, reply) => {
      const operation = action === "revoke" ? "RevokeTicket" : "ResumeTicket";
      const identity = adoptedTicketIdentity(service, request, operation);
      adoptedTicketMutationReply(
        reply,
        identity,
        await service.application[action](principalOf(request), {
          partition: partitionOf(request),
          identity,
          ticket: adoptedTicketNumber(request),
        }),
      );
    });
  app.post(`${root}/:ticket/dispatch`, async (request, reply) => {
    const body = fieldsOnly(request.body, ["repository", "commit"]);
    const identity = adoptedTicketIdentity(service, request, "DispatchTicket");
    adoptedTicketMutationReply(
      reply,
      identity,
      await service.application.dispatch(principalOf(request), {
        partition: partitionOf(request),
        identity,
        ticket: adoptedTicketNumber(request),
        repository: textField(body, "repository"),
        commit: textField(body, "commit"),
      }),
    );
  });
}

/** One task key as a path segment, which is opaque text this tree never interprets. */
function adoptedTaskKey(request: FastifyRequest): string {
  return textField(record(request.params), "task");
}

/** The attempt one read names, which is a whole count and nothing else. */
function adoptedAttempt(request: FastifyRequest): number {
  return integerField(record(request.params), "attempt");
}

/** A page size the caller may narrow but never widen past the wire's own bound. */
/** Which ticket a listing is about, and undefined for the project-wide one. */
function adoptedExecutionTicket(
  request: FastifyRequest,
): ReturnType<typeof AdoptedTicketId> | undefined {
  const asked = record(request.query)["ticket"];
  return asked === undefined
    ? undefined
    : AdoptedTicketId(integerField({ ticket: asked }, "ticket"));
}

function adoptedPageLimit(request: FastifyRequest): number {
  const asked = record(request.query)["limit"];
  const held =
    typeof asked === "string" ? integerField({ limit: asked }, "limit") : 0;
  return held > 0
    ? Math.min(held, nativeHttpPageItemsMax)
    : nativeHttpPageItemsDefault;
}

/**
 * What one attempt ran, spent and left behind, and the record of what people
 * asked of this project. Every one conceals a project the caller may not see as
 * a project that is not there, which is why the bare admission read exists at
 * all: the path it replaces is retired and answers a conflict.
 */
function registerAdoptedTicketEvidence(
  app: FastifyInstance,
  reads: TicketExecutionReads,
): void {
  const answer = (
    reply: FastifyReply,
    result: TicketApplicationResult<unknown>,
  ): void => {
    if (result.result !== "Authorized") {
      adoptedTicketReply(reply, result);
      return;
    }
    if (result.value === undefined) {
      void reply.code(404).send(nativeHttpError("NotFound", "Not found."));
      return;
    }
    void reply.code(200).send(result.value);
  };
  app.get(nativeHttpRoutes.ticketMachineAdmission, async (request, reply) => {
    answer(
      reply,
      await reads.admitted(principalOf(request), partitionOf(request)),
    );
  });
  app.get(nativeHttpRoutes.ticketExecutions, async (request, reply) => {
    const found = await reads.executions(
      principalOf(request),
      partitionOf(request),
      adoptedPageLimit(request),
      adoptedExecutionTicket(request),
    );
    answer(
      reply,
      found.result === "Authorized"
        ? { result: "Authorized", value: { executions: found.value } }
        : found,
    );
  });
  app.get(nativeHttpRoutes.ticketOperations, async (request, reply) => {
    const found = await reads.operations(
      principalOf(request),
      partitionOf(request),
      adoptedPageLimit(request),
    );
    answer(
      reply,
      found.result === "Authorized"
        ? { result: "Authorized", value: { operations: found.value } }
        : found,
    );
  });
  app.get(nativeHttpRoutes.ticketExecution, async (request, reply) => {
    answer(
      reply,
      await reads.execution(
        principalOf(request),
        partitionOf(request),
        adoptedTaskKey(request),
      ),
    );
  });
  registerAdoptedTicketRunReads(app, reads, answer);
}

/**
 * One attempt's own measure and the bytes it left, each read by the attempt
 * number the execution read named.
 */
function registerAdoptedTicketRunReads(
  app: FastifyInstance,
  reads: TicketExecutionReads,
  answer: (
    reply: FastifyReply,
    result: TicketApplicationResult<unknown>,
  ) => void,
): void {
  app.get(nativeHttpRoutes.ticketExecutionTurns, async (request, reply) => {
    answer(
      reply,
      await reads.turns(
        principalOf(request),
        partitionOf(request),
        adoptedTaskKey(request),
        adoptedAttempt(request),
        adoptedCursor(request),
        adoptedPageLimit(request),
      ),
    );
  });
  app.get(
    nativeHttpRoutes.ticketExecutionTranscript,
    async (request, reply) => {
      answer(
        reply,
        await reads.transcript(
          principalOf(request),
          partitionOf(request),
          adoptedTaskKey(request),
          adoptedAttempt(request),
          adoptedCursor(request),
        ),
      );
    },
  );
  app.get(
    nativeHttpRoutes.ticketExecutionConfiguration,
    async (request, reply) => {
      answer(
        reply,
        await reads.configuration(
          principalOf(request),
          partitionOf(request),
          adoptedTaskKey(request),
          adoptedAttempt(request),
        ),
      );
    },
  );
}

/** Where a page resumes, which is absent on the first page and a count after that. */
function adoptedCursor(request: FastifyRequest): number {
  const asked = record(request.query)["after"];
  return typeof asked === "string"
    ? integerField({ after: asked }, "after")
    : 0;
}

function registerAdoptedTickets(
  app: FastifyInstance,
  service: NativeTicketApplication,
): void {
  registerAdoptedTicketReads(app, service);
  registerAdoptedTicketValidation(app, service);
  registerAdoptedTicketCatalog(app, service);
  registerAdoptedTicketAuthoring(app, service);
  registerAdoptedTicketActions(app, service);
}

function registerRetiredLegacyTicketRoutes(
  app: FastifyInstance,
  service: NativeTicketApplication,
): void {
  const root = "/api/v1/tenants/:tenant/projects/:project";
  const guard = (request: FastifyRequest, reply: FastifyReply) =>
    legacyTicketEndpoint(service, request, reply);
  for (const route of [
    { method: ["GET"] as const, url: root },
    { method: ["GET"] as const, url: `${root}/tickets` },
    { method: ["GET"] as const, url: `${root}/tickets/:ticket` },
    { method: ["GET", "POST"] as const, url: `${root}/configurations` },
    { method: ["POST"] as const, url: `${root}/configurations/imports` },
    { method: ["GET"] as const, url: `${root}/configurations/:revision` },
    {
      method: ["GET"] as const,
      url: `${root}/draft-initializations/:revision`,
    },
    { method: ["GET", "POST"] as const, url: `${root}/drafts` },
    {
      method: ["GET", "PUT", "DELETE"] as const,
      url: `${root}/drafts/:ticket`,
    },
    {
      method: ["GET", "POST", "DELETE"] as const,
      url: `${root}/operations/:operation`,
    },
    { method: ["POST"] as const, url: `${root}/operations` },
    { method: ["GET"] as const, url: `${root}/selector-context` },
    { method: ["GET"] as const, url: `${root}/selector-history` },
    { method: ["GET", "PUT"] as const, url: `${root}/selector-settings` },
    { method: ["GET"] as const, url: `${root}/selector-settings/history` },
    { method: ["GET"] as const, url: `${root}/dispatch-view` },
    { method: ["GET"] as const, url: `${root}/native-actions` },
    { method: ["GET"] as const, url: `${root}/tickets/:ticket/native-actions` },
    { method: ["GET"] as const, url: `${root}/agentic-refusals` },
    {
      method: ["GET"] as const,
      url: `${root}/tickets/:ticket/agentic-refusals`,
    },
  ])
    app.route({ method: [...route.method], url: route.url, handler: guard });
}

/**
 * The reads a change row is turned into a frame by, each answering the body its
 * own route answers with, so a route whose body moves takes the stream with it.
 * A project holding no ticket service answers every ticket and execution row as
 * a tombstone, which is what a resource no route can read already means.
 */
export function nativeProjectStreamReads(
  web: NativeWeb,
  service?: NativeTicketApplication,
): ProjectStreamReads {
  const gone: NativeHttpResponse = { status: 404, headers: {} };
  return {
    ticket: async (principal, partition, ticket) => {
      if (service === undefined) return gone;
      const found = await service.application.definition(
        principal,
        partition,
        AdoptedTicketId(ticket),
      );
      if (found.result !== "Authorized" || found.value === undefined)
        return gone;
      return { status: 200, headers: {}, body: adoptedTicketBody(found.value) };
    },
    execution: async (principal, partition, task) => {
      const reads = service?.reads;
      if (reads === undefined) return gone;
      const found = await reads.execution(principal, partition, task);
      if (found.result !== "Authorized" || found.value === undefined)
        return gone;
      return { status: 200, headers: {}, body: found.value };
    },
    lead: async (principal, partition) =>
      leadResponse(await web.lead(principal, partition)),
    thread: async (principal, partition, session) =>
      threadResponse(
        await web.thread(principal, partition, session, {
          limit: threadTurnsAnsweredMax,
        }),
      ),
    inquiry: async (principal, partition, session) =>
      leadInquiryResponse(await web.leadInquiry(principal, partition, session)),
  };
}

/** Where a stream resumes from, which is a consumer's own cursor or nothing. */
function streamCursor(request: FastifyRequest): number | undefined {
  const held = request.headers[projectStreamCursorHeader];
  if (typeof held !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(held))
    return undefined;
  const cursor = Number(held);
  return Number.isSafeInteger(cursor) ? cursor : undefined;
}

/**
 * The live stream over the durable change log. Every refusal is decided and
 * answered before the reply is hijacked, because a socket handed over has
 * already written a 200 and a browser reads that as a stream that said nothing.
 */
function registerProjectEventStream(
  app: FastifyInstance,
  hub: ProjectStreamHub,
): void {
  app.get(
    nativeHttpRoutes.events,
    { config: { streaming: true } },
    async (request, reply) => {
      const opened = await hub.open({
        partition: partitionOf(request),
        principal: principalOf(request),
        after: streamCursor(request),
        expiresAtMs: request.bearerExpiresAtMs,
      });
      if (opened.opened === "AtCapacity") {
        await reply
          .code(503)
          .header("retry-after", "1")
          .type(nativeHttpMediaType)
          .send(nativeHttpError("ServerBusy", "The server is at capacity."));
        return reply;
      }
      reply.hijack();
      request.raw.on("close", () => {
        opened.stream.close();
      });
      opened.stream.begin(projectStreamSocket(reply));
      return reply;
    },
  );
}

function configureNativeHttpApp(
  app: FastifyInstance,
  ticketService?: NativeTicketApplication,
): void {
  app.addContentTypeParser(
    nativeHttpMediaType,
    { parseAs: "string", bodyLimit: nativeHttpBodyBytesMax },
    app.getDefaultJsonParser("error", "error"),
  );
  if (ticketService !== undefined)
    app.addContentTypeParser(
      ["application/yaml", "text/yaml"],
      { parseAs: "string", bodyLimit: nativeHttpBodyBytesMax },
      (_request, body, done) => {
        done(null, body);
      },
    );
  app.addHook("onSend", (_request, reply) => {
    if (!reply.hasHeader("cache-control"))
      void reply.header("cache-control", "no-store");
    return Promise.resolve();
  });
}

export function createNativeHttpApp(
  web: NativeWeb,
  authentication: PrincipalAuthentication,
  readiness: NativeHttpReadiness,
  authority: InstallationAuthorityRead,
  limits: NativeHttpLimits = nativeHttpLimitsDefault,
  forgeCredentials?: ForgeCredentialMinting,
  onboarding?: RepositoryOnboarding,
  ticketService?: NativeTicketApplication,
  workerPools?: WorkerPoolRegistrationService,
  stream?: ProjectStreamHub,
): FastifyInstance {
  const app = fastify({
    bodyLimit: nativeHttpBodyBytesMax,
    requestTimeout: limits.requestTimeoutMs,
    routerOptions: { maxParamLength: nativeHttpPathSegmentCharsMax },
    forceCloseConnections: "idle",
    http: { maxHeaderSize: nativeHttpHeaderBytesMax },
  });
  configureNativeHttpApp(app, ticketService);
  const partitionRoot = "/api/v1/tenants/:tenant/projects/:project";
  registerCapacity(app, limits.concurrentRequestsMax);
  registerAuthentication(app, authentication);
  registerHealth(app, readiness);
  registerContract(app);
  registerInstallation(app, authority);
  registerInventory(app, web);
  if (ticketService !== undefined) {
    registerAdoptedTickets(app, ticketService);
    if (ticketService.reads !== undefined)
      registerAdoptedTicketEvidence(app, ticketService.reads);
    registerRetiredLegacyTicketRoutes(app, ticketService);
  }
  registerLead(app, web, partitionRoot);
  if (forgeCredentials !== undefined)
    registerForgeCredentials(app, forgeCredentials);
  if (workerPools !== undefined)
    registerWorkerPools(app, workerPools, partitionRoot);
  if (onboarding !== undefined) {
    registerForgeInstallations(app, onboarding);
    registerProjectRepositories(app, onboarding);
    registerProjectRepositoryLanding(app, onboarding);
    registerProjectRepositoryRetirement(app, onboarding);
  }
  if (stream !== undefined) registerProjectEventStream(app, stream);
  registerThreadReads(app, web, partitionRoot);
  registerThreadWrites(app, web, partitionRoot);
  registerLeadInquiries(app, web, partitionRoot);
  app.setErrorHandler((failure, _request, reply) => {
    send(reply, failureResponse(failure));
  });
  return app;
}
