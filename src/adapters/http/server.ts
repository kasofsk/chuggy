import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import type { TicketId } from "../../domain/ids.ts";
import { phaseTags, type Phase } from "../../domain/generated/modelTypes.ts";
import {
  allExecutionStatuses,
  type ExecutionStatus,
} from "../../interpreter/executionScheduler.ts";
import type { Principal } from "../../interpreter/nativeWeb.ts";
import type { NativeWeb } from "../../interpreter/nativeWeb.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import { asExecutionId } from "../../interpreter/schedulerIdentity.ts";
import { asConfigurationRevisionId } from "../../interpreter/authoring.ts";
import {
  nativeHttpBodyBytesMax,
  nativeHttpContractDocument,
  nativeHttpError,
  nativeHttpHeaderBytesMax,
  nativeHttpMediaType,
  nativeHttpPathSegmentCharsMax,
  parseConfigurationCursor,
  parseInventoryCursor,
  parseTicketActivityCursor,
  parseConfigurationCreation,
  parseRepositoryConfigurationImport,
  parseDraftCreation,
  parseDraftRevision,
  parsePartition,
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
  draftDeletionResponse,
  draftResponse,
  draftRevisionResponse,
  failureResponse,
  inventoryResponse,
  notificationsResponse,
  operationResponse,
  projectResponse,
  ticketResponse,
  executionResponse,
  executionsResponse,
  operationalStatusResponse,
  selectorOperationalContextResponse,
  outputContentResponse,
  submissionResponse,
  type NativeHttpResponse,
} from "./outcomes.ts";

export interface PrincipalAuthentication {
  authenticateBearer(token: string): Promise<Principal | undefined>;
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
  | "execution"
  | "executions"
  | "operationalStatus"
  | "selectorOperationalContext"
  | "outputContent"
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
  }

  interface FastifyRequest {
    principal?: Principal;
  }
}

function registerAuthentication(
  app: FastifyInstance,
  authentication: PrincipalAuthentication,
): void {
  app.decorateRequest("principal");
  app.addHook("preHandler", async (request, reply) => {
    if (request.routeOptions.config.public === true) return;
    const token = bearer(request.headers.authorization);
    const principal =
      token === undefined
        ? undefined
        : await authentication.authenticateBearer(token).catch(() => undefined);
    if (principal === undefined) {
      void reply.header("www-authenticate", "Bearer");
      await reply
        .code(401)
        .type(nativeHttpMediaType)
        .send(
          nativeHttpError("Unauthenticated", "Authentication is required."),
        );
      return reply;
    }
    request.principal = principal;
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
  registerOperationalRoutes(app, web, root);
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
    const query = fieldsOnly(request.query, [
      "after",
      "limit",
      "state",
      "ticket",
    ]);
    const after = query["after"];
    send(
      reply,
      executionsResponse(
        await web.executions(principalOf(request), partitionOf(request), {
          ...(after === undefined
            ? {}
            : { after: asExecutionId(textField(query, "after")) }),
          limit: integerField(query, "limit", 50),
          ...(query["ticket"] === undefined
            ? {}
            : { ticket: asTicketIdField(query, "ticket") }),
          ...executionSelection(query["state"]),
        }),
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
      const result = await web.submit(principalOf(request), {
        partition,
        ...parsed,
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

export function createNativeHttpApp(
  web: InitialNativeWeb,
  authentication: PrincipalAuthentication,
  readiness: NativeHttpReadiness,
  limits: NativeHttpLimits = nativeHttpLimitsDefault,
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
  registerCapacity(app, limits.concurrentRequestsMax);
  registerAuthentication(app, authentication);
  registerHealth(app, readiness);
  registerContract(app);
  registerInventory(app, web);
  registerProject(app, web);
  registerSelectorContext(app, web);
  registerOperations(app, web);
  registerNotifications(app, web);
  registerConfigurations(app, web);
  registerDrafts(app, web);
  registerDispatchView(app, web);
  app.setErrorHandler((failure, _request, reply) => {
    send(reply, failureResponse(failure));
  });
  return app;
}
