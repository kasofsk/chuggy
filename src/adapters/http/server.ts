import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import type { TicketId } from "../../domain/ids.ts";
import {
  asSessionStoreStream,
  type SessionId,
} from "../../interpreter/agentSession.ts";
import type { InstallationAuthorityRead } from "../../interpreter/installationAuthority.ts";
import { phaseTags, type Phase } from "../../domain/generated/modelTypes.ts";
import {
  allExecutionStatuses,
  type ExecutionStatus,
} from "../../interpreter/executionScheduler.ts";
import type { Principal } from "../../interpreter/nativeWeb.ts";
import type { ExecutionListQuery } from "../../interpreter/operationsView.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { NativeWeb } from "../../interpreter/nativeWeb.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import {
  asAttemptId,
  asExecutionId,
} from "../../interpreter/schedulerIdentity.ts";
import { asConfigurationRevisionId } from "../../interpreter/authoring.ts";
import type {
  ProjectStream,
  ProjectStreamHub,
} from "../../interpreter/projectStream.ts";
import type { SelectorProjectSettingsAdministration } from "../../interpreter/selectorProjectSettings.ts";
import { projectStreamSocket } from "./eventStream.ts";
import { nativeHttpContractDocument } from "../../contract/document.ts";
import {
  selectorHistoryOrders,
  type SelectorHistoryOrder,
} from "../../contract/rosters.ts";
import {
  agenticRefusalsAnsweredMax,
  nativeHttpBodyBytesMax,
  nativeHttpError,
  nativeHttpHeaderBytesMax,
  nativeHttpMediaType,
  nativeHttpPathSegmentCharsMax,
  selectorHistoryLimitMax,
  sessionStorePageBatchesMax,
} from "../../contract/http.ts";
import {
  parseConfigurationCursor,
  parseExecutionCursor,
  parseInventoryCursor,
  parseNativeActionCursor,
  parseTicketActivityCursor,
  parseConfigurationCreation,
  parseRepositoryConfigurationImport,
  parseDraftCreation,
  parseDraftRevision,
  parsePartition,
  parseSelectorProjectSettings,
  parseSubmission,
} from "./contract.ts";
import {
  cancellationResponse,
  configurationCreationResponse,
  repositoryConfigurationImportResponse,
  configurationResponse,
  configurationsResponse,
  dispatchViewResponse,
  draftCreationResponse,
  draftInitializationResponse,
  draftDeletionResponse,
  draftResponse,
  draftRevisionResponse,
  failureResponse,
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
  leadResponse,
  leadTranscriptResponse,
  selectorHistoryResponse,
  ticketAgenticRefusalsResponse,
  selectorOperationalContextResponse,
  selectorProjectSettingsResponse,
  selectorProjectSettingsWriteResponse,
  selectorSettingsHistoryResponse,
  outputContentResponse,
  runConfigurationResponse,
  runTranscriptResponse,
  runTurnsResponse,
  submissionResponse,
  type NativeHttpResponse,
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

type InitialNativeWeb = Pick<
  NativeWeb,
  | "cancel"
  | "configuration"
  | "configurations"
  | "createConfiguration"
  | "importRepositoryConfigurations"
  | "createDraft"
  | "initializeDraft"
  | "deleteDraft"
  | "dispatchView"
  | "draft"
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
  | "lead"
  | "leadTranscript"
  | "agenticRefusals"
  | "ticketAgenticRefusals"
  | "selectorHistory"
  | "outputContent"
  | "runTurns"
  | "runTranscript"
  | "runConfiguration"
>;

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

function textField(
  fields: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = fields[name];
  if (typeof value !== "string") throw new TypeError(`${name} is not text`);
  return value;
}

function integerField(
  fields: Readonly<Record<string, unknown>>,
  name: string,
  fallback?: number,
): number {
  const value = fields[name];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value))
    throw new TypeError(`${name} is not a canonical non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new RangeError(`${name} is too large`);
  return parsed;
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

/** How long a caller is told to wait before asking this server to verify again. */
const authorityRetryAfterSeconds = 1;

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
    send(reply, projectResponse(result));
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
    send(reply, ticketResponse(resource));
  });
  registerNativeActions(app, web, root);
  registerAgenticRefusals(app, web, root);
  registerOperationalRoutes(app, web, root);
  registerRunEvidenceRoutes(app, web, root);
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

/** The lead's refusals, across a project and under the one ticket each names. */
function registerAgenticRefusals(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.get(`${root}/agentic-refusals`, async (request, reply) => {
    const query = fieldsOnly(request.query, ["limit"]);
    send(
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
      send(
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
    send(
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

function registerRunEvidenceRoutes(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  const run = `${root}/executions/:execution/attempts/:attempt`;
  app.get(`${run}/turns`, async (request, reply) => {
    const params = record(request.params);
    const query = fieldsOnly(request.query, ["after", "limit"]);
    send(
      reply,
      runTurnsResponse(
        await web.runTurns(
          principalOf(request),
          partitionOf(request),
          asExecutionId(textField(params, "execution")),
          asAttemptId(textField(params, "attempt")),
          {
            ...(query["after"] === undefined
              ? {}
              : { after: integerField(query, "after") }),
            limit: integerField(query, "limit", 50),
          },
        ),
      ),
    );
  });
  app.get(`${run}/transcript`, async (request, reply) => {
    const params = record(request.params);
    const query = fieldsOnly(request.query, ["after"]);
    send(
      reply,
      runTranscriptResponse(
        await web.runTranscript(
          principalOf(request),
          partitionOf(request),
          asExecutionId(textField(params, "execution")),
          asAttemptId(textField(params, "attempt")),
          integerField(query, "after", 0),
        ),
      ),
    );
  });
  app.get(`${run}/configuration`, async (request, reply) => {
    const params = record(request.params);
    send(
      reply,
      runConfigurationResponse(
        await web.runConfiguration(
          principalOf(request),
          partitionOf(request),
          asExecutionId(textField(params, "execution")),
          asAttemptId(textField(params, "attempt")),
        ),
      ),
    );
  });
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
    send(reply, ticketNativeActionsResponse(actions));
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
    send(reply, nativeActionsResponse(partition, result));
  });
}

function registerOperationalRoutes(
  app: FastifyInstance,
  web: InitialNativeWeb,
  root: string,
): void {
  app.get(`${root}/operational-status`, async (request, reply) => {
    send(
      reply,
      operationalStatusResponse(
        await web.operationalStatus(principalOf(request), partitionOf(request)),
      ),
    );
  });
  app.get(`${root}/executions`, async (request, reply) => {
    const partition = partitionOf(request);
    send(
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
  app.get(`${root}/executions/:execution`, async (request, reply) => {
    const params = record(request.params);
    send(
      reply,
      executionResponse(
        await web.execution(
          principalOf(request),
          partitionOf(request),
          asExecutionId(textField(params, "execution")),
        ),
      ),
    );
  });
  app.get(
    `${root}/executions/:execution/artifacts/:ordinal`,
    async (request, reply) => {
      const params = record(request.params);
      send(
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

function registerSelectorContext(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  app.get(
    "/api/v1/tenants/:tenant/projects/:project/selector-context",
    async (request, reply) => {
      send(
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
    send(
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
      send(
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
    const query = fieldsOnly(request.query, ["after", "limit"]);
    send(
      reply,
      selectorSettingsHistoryResponse(
        await settings.history(
          principalOf(request),
          partitionOf(request),
          integerField(query, "after", 0),
          integerField(query, "limit", 50),
        ),
      ),
    );
  });
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
      send(reply, submissionResponse(partition, result));
    },
  );
  app.get(`${root}/:operation`, async (request, reply) => {
    const params = record(request.params);
    const result = await web.operation(
      principalOf(request),
      partitionOf(request),
      asOperationId(textField(params, "operation")),
    );
    send(reply, operationResponse(result));
  });
  app.delete(`${root}/:operation`, async (request, reply) => {
    const params = record(request.params);
    const result = await web.cancel(
      principalOf(request),
      partitionOf(request),
      asOperationId(textField(params, "operation")),
    );
    send(reply, cancellationResponse(result));
  });
}

function registerConfigurations(
  app: FastifyInstance,
  web: InitialNativeWeb,
): void {
  const root = "/api/v1/tenants/:tenant/projects/:project/configurations";
  app.get(root, async (request, reply) => {
    const query = fieldsOnly(request.query, ["cursor", "limit"]);
    const cursor = query["cursor"];
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
    });
    send(reply, configurationsResponse(result));
  });
  app.post(
    root,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const result = await web.createConfiguration(principalOf(request), {
        partition: partitionOf(request),
        ...parseConfigurationCreation(request.body),
      });
      send(reply, configurationCreationResponse(result));
    },
  );
  app.post(
    `${root}/imports`,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const result = await web.importRepositoryConfigurations(
        principalOf(request),
        partitionOf(request),
        parseRepositoryConfigurationImport(request.body),
      );
      send(reply, repositoryConfigurationImportResponse(result));
    },
  );
  app.get(`${root}/:revision`, async (request, reply) => {
    const params = record(request.params);
    const result = await web.configuration(
      principalOf(request),
      partitionOf(request),
      asConfigurationRevisionId(textField(params, "revision")),
    );
    send(reply, configurationResponse(result));
  });
}

function registerDrafts(app: FastifyInstance, web: InitialNativeWeb): void {
  const root = "/api/v1/tenants/:tenant/projects/:project/drafts";
  app.get(
    "/api/v1/tenants/:tenant/projects/:project/draft-initializations/:revision",
    async (request, reply) => {
      const result = await web.initializeDraft(
        principalOf(request),
        partitionOf(request),
        asConfigurationRevisionId(
          textField(record(request.params), "revision"),
        ),
      );
      send(reply, draftInitializationResponse(result));
    },
  );
  app.post(
    root,
    { preValidation: requireVersionedJson },
    async (request, reply) => {
      const result = await web.createDraft(principalOf(request), {
        partition: partitionOf(request),
        ...parseDraftCreation(request.body),
      });
      send(reply, draftCreationResponse(result));
    },
  );
  app.get(`${root}/:ticket`, async (request, reply) => {
    const result = await web.draft(
      principalOf(request),
      partitionOf(request),
      asTicketIdField(record(request.params), "ticket"),
    );
    send(reply, draftResponse(result));
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
      send(reply, draftRevisionResponse(result));
    },
  );
  app.delete(`${root}/:ticket`, async (request, reply) => {
    const query = fieldsOnly(request.query, ["expectedVersion"]);
    const result = await web.deleteDraft(principalOf(request), {
      partition: partitionOf(request),
      ticket: asTicketIdField(record(request.params), "ticket"),
      expectedVersion: integerField(query, "expectedVersion"),
    });
    send(reply, draftDeletionResponse(result));
  });
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
      send(reply, dispatchViewResponse(result));
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
      send(reply, notificationsResponse(result));
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
    send(reply, projectEntryResponse(standing));
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
    await reply
      .code(503)
      .header("retry-after", "1")
      .type(nativeHttpMediaType)
      .send(nativeHttpError("ServerBusy", "The server is at capacity."));
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

export function createNativeHttpApp(
  web: InitialNativeWeb,
  authentication: PrincipalAuthentication,
  readiness: NativeHttpReadiness,
  authority: InstallationAuthorityRead,
  limits: NativeHttpLimits = nativeHttpLimitsDefault,
  hub?: ProjectStreamHub,
  selectorSettings?: SelectorProjectSettingsAdministration,
): FastifyInstance {
  const app = fastify({
    bodyLimit: nativeHttpBodyBytesMax,
    requestTimeout: limits.requestTimeoutMs,
    routerOptions: { maxParamLength: nativeHttpPathSegmentCharsMax },
    forceCloseConnections: "idle",
    http: { maxHeaderSize: nativeHttpHeaderBytesMax },
  });
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
  const partitionRoot = "/api/v1/tenants/:tenant/projects/:project";
  registerCapacity(app, limits.concurrentRequestsMax);
  registerAuthentication(app, authentication);
  registerHealth(app, readiness);
  registerContract(app);
  registerInstallation(app, authority);
  registerInventory(app, web);
  registerProject(app, web);
  registerLead(app, web, partitionRoot);
  registerSelectorContext(app, web);
  registerSelectorHistory(app, web, partitionRoot);
  if (selectorSettings !== undefined)
    registerSelectorSettings(app, selectorSettings);
  registerOperations(app, web);
  registerNotifications(app, web);
  if (hub !== undefined) registerProjectEvents(app, web, hub);
  registerConfigurations(app, web);
  registerDrafts(app, web);
  registerDispatchView(app, web);
  app.setErrorHandler((failure, _request, reply) => {
    send(reply, failureResponse(failure));
  });
  return app;
}
