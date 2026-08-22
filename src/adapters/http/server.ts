import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import type { TicketId } from "../../domain/ids.ts";
import type { Principal } from "../../interpreter/nativeWeb.ts";
import type { NativeWeb } from "../../interpreter/nativeWeb.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import {
  nativeHttpBodyBytesMax,
  nativeHttpError,
  nativeHttpHeaderBytesMax,
  nativeHttpMediaType,
  parseInventoryCursor,
  parsePartition,
  parseSubmission,
} from "./contract.ts";
import {
  cancellationResponse,
  inventoryResponse,
  notificationsResponse,
  operationResponse,
  projectResponse,
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
  | "notifications"
  | "operation"
  | "project"
  | "projectInventory"
  | "submit"
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

function failureCode(failure: unknown): string | undefined {
  if (typeof failure !== "object" || failure === null) return undefined;
  const code = (failure as Readonly<Record<string, unknown>>)["code"];
  return typeof code === "string" ? code : undefined;
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
  const matched = /^Bearer ([^ ]+)$/u.exec(authorization);
  return matched?.[1];
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
  app.addHook("onResponse", (request) => {
    if (admitted.delete(request)) active -= 1;
    return Promise.resolve();
  });
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
  app.get(
    "/api/v1/tenants/:tenant/projects/:project",
    async (request, reply) => {
      const query = fieldsOnly(request.query, [
        "after",
        "limit",
        "minimumSequence",
      ]);
      const after = query["after"];
      const result = await web.project(
        principalOf(request),
        partitionOf(request),
        {
          ...(after === undefined
            ? {}
            : { after: asTicketIdField(query, "after") }),
          limit: integerField(query, "limit", 50),
          ...(query["minimumSequence"] === undefined
            ? {}
            : { minimumSequence: integerField(query, "minimumSequence") }),
        },
      );
      send(reply, projectResponse(result));
    },
  );
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
    {
      preValidation: (request, reply, done) => {
        if (
          request.headers["content-type"]?.split(";", 1)[0] !==
          nativeHttpMediaType
        ) {
          void reply
            .code(415)
            .type(nativeHttpMediaType)
            .send(
              nativeHttpError(
                "UnsupportedMediaType",
                "The request media type is unsupported.",
              ),
            );
          return;
        }
        done();
      },
    },
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
      send(reply, submissionResponse(partition, parsed.operation, result));
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
    routerOptions: { maxParamLength: 256 },
    forceCloseConnections: "idle",
    http: { maxHeaderSize: nativeHttpHeaderBytesMax },
  });
  app.addContentTypeParser(
    nativeHttpMediaType,
    { parseAs: "string", bodyLimit: nativeHttpBodyBytesMax },
    app.getDefaultJsonParser("error", "error"),
  );
  registerCapacity(app, limits.concurrentRequestsMax);
  registerAuthentication(app, authentication);
  registerHealth(app, readiness);
  registerInventory(app, web);
  registerProject(app, web);
  registerOperations(app, web);
  registerNotifications(app, web);
  app.setErrorHandler((failure, _request, reply) => {
    const oversized = failureCode(failure) === "FST_ERR_CTP_BODY_TOO_LARGE";
    void reply
      .code(oversized ? 413 : 400)
      .type(nativeHttpMediaType)
      .send(
        oversized
          ? nativeHttpError("BodyTooLarge", "The request body is too large.")
          : nativeHttpError("InvalidRequest", "The request is invalid."),
      );
  });
  return app;
}
