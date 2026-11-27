/**
 * The tool server's routes: chuggy's tools over MCP's Streamable HTTP at
 * `POST /mcp`, the OAuth metadata a remote client discovers its sign-in from,
 * the authorization endpoint that client is sent to, and the health probes.
 *
 * THE RESOURCE IS `<origin>/mcp`, and it is the audience a bearer must carry.
 * A token minted for the API alone is refused here, so a client holding the
 * API's token cannot spend it as this server's.
 *
 * THE AUTHORIZATION ENDPOINT IS THIS ORIGIN'S AND THE TOKEN ENDPOINT IS THE
 * ISSUER'S. The issuer reads its own `audience` parameter and never RFC 8707's
 * `resource`, so `/authorize` drops the `resource` a client sends and sets
 * `audience` to this server's resource and the API's before redirecting. The
 * issuer names no `iss` in its authorization response, which is what lets this
 * origin stand as the issuer the client was told of.
 *
 * THE ISSUER IS DISCOVERED ON FIRST USE AND NEVER AT START, so readiness is
 * listening and an issuer outage holds no release. A request that needs it
 * while it cannot be discovered is answered 503, and the next asks again.
 *
 * ONE LINE IS LOGGED PER REQUEST, naming its path without its query, the
 * principal and client once verified, and the JSON-RPC method or tool. A
 * token, a code and a query string are never written.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { decodeJwt } from "jose";
import { z } from "zod";

import { oidcAuthentication, type OidcAuthenticationConfig } from "./oidc.ts";
import { authorityRetryAfterSeconds } from "./outcomes.ts";
import {
  planeApp,
  planeBodyBytesDefault,
  planeHealthRoutes,
  planeRouteServed,
} from "./planeRoutes.ts";
import type { PrincipalAuthentication } from "./server.ts";

/** What the issuer's discovery names that this server serves, and its verifier. */
export interface ToolServerIssuer {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  readonly authentication: PrincipalAuthentication;
}

/** The MCP server one request is served by, connected to that request's transport alone. */
export interface ToolServerMcp {
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
}

export interface ToolServerAppOptions {
  /** The public HTTPS origin, with nothing after it. */
  readonly origin: string;
  /** The audience the API verifies its bearers against, set beside this server's resource. */
  readonly apiAudience: string;
  /** The OAuth clients `/authorize` answers. */
  readonly clients: ReadonlySet<string>;
  /** The issuer, rejecting while it cannot be discovered. */
  readonly issuer: () => Promise<ToolServerIssuer>;
  /** The server for one verified bearer. */
  readonly served: (bearer: string) => ToolServerMcp;
  readonly log: (line: string) => void;
}

/** The one scope a client is told of, which has the issuer mint a refresh token. */
const toolServerScope = "offline_access";

/** The resource this server is, which is the audience its bearers carry. */
export function toolServerResource(origin: string): string {
  return `${origin}/mcp`;
}

/** Where RFC 9728's metadata for the resource is served. */
export function toolServerResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/mcp`;
}

/** RFC 9728's protected-resource metadata. */
export function toolServerResourceMetadata(origin: string) {
  return {
    resource: toolServerResource(origin),
    authorization_servers: [origin],
    scopes_supported: [toolServerScope],
    bearer_methods_supported: ["header"],
  };
}

/** RFC 8414's authorization-server metadata, which names no registration endpoint because an operator registers every client. */
export function toolServerAuthorizationMetadata(
  origin: string,
  issuer: ToolServerIssuer,
) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: issuer.tokenEndpoint,
    revocation_endpoint: issuer.revocationEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
    scopes_supported: [toolServerScope],
  };
}

/** The issuer's own discovery, of which only the endpoints this server names are read. */
const toolServerDiscoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  revocation_endpoint: z.string(),
});

function toolServerIssuerEndpoint(value: string, what: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
    throw new RangeError(`the issuer's ${what} must be HTTPS`);
  return url.href;
}

/** The issuer `config` names, discovered: its endpoints and a verifier holding this server's resource as the audience. */
export async function toolServerIssuerDiscovered(
  config: OidcAuthenticationConfig,
  fetcher: typeof fetch = fetch,
): Promise<ToolServerIssuer> {
  const url = new URL(config.issuer);
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/.well-known/openid-configuration`;
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(config.discoveryTimeoutMs),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("the issuer's discovery failed");
  const discovered = toolServerDiscoverySchema.parse(await response.json());
  if (discovered.issuer !== config.issuer)
    throw new Error("the issuer's discovery named a different issuer");
  return {
    authorizationEndpoint: toolServerIssuerEndpoint(
      discovered.authorization_endpoint,
      "authorization endpoint",
    ),
    tokenEndpoint: toolServerIssuerEndpoint(
      discovered.token_endpoint,
      "token endpoint",
    ),
    revocationEndpoint: toolServerIssuerEndpoint(
      discovered.revocation_endpoint,
      "revocation endpoint",
    ),
    authentication: await oidcAuthentication(config, fetcher),
  };
}

/** `discover` asked once and its answer kept, a failure kept for no one so the next request asks again. */
export function toolServerIssuerOnce(
  discover: () => Promise<ToolServerIssuer>,
): () => Promise<ToolServerIssuer> {
  let held: Promise<ToolServerIssuer> | undefined;
  return () => {
    held ??= discover().catch((failure: unknown) => {
      held = undefined;
      throw failure;
    });
    return held;
  };
}

/** What one request's log line names beyond its method, path and status. */
interface ToolServerLogged {
  principal?: string;
  client?: string;
  rpc?: string;
  tool?: string;
}

function toolServerLogLine(
  request: FastifyRequest,
  status: number,
  logged: ToolServerLogged,
): string {
  const named = Object.entries(logged)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`);
  const path = request.url.split("?", 1)[0] ?? "";
  return [
    "tool server:",
    request.method,
    JSON.stringify(path),
    String(status),
    ...named,
  ].join(" ");
}

function toolServerBearer(authorization: string | undefined) {
  if (authorization === undefined) return undefined;
  return /^Bearer ([^ ]+)$/iu.exec(authorization)?.[1];
}

/** RFC 6750's challenge, naming where the resource's metadata is and, where a token was presented, that it was refused. */
function toolServerUnauthenticated(
  reply: FastifyReply,
  origin: string,
  presented: boolean,
): FastifyReply {
  const challenge = [
    `resource_metadata="${toolServerResourceMetadataUrl(origin)}"`,
    `scope="${toolServerScope}"`,
    ...(presented ? ['error="invalid_token"'] : []),
  ];
  return reply
    .code(401)
    .header("www-authenticate", `Bearer ${challenge.join(", ")}`)
    .send({ error: presented ? "invalid_token" : "unauthorized" });
}

/** A verification this server could not make, which says nothing of the token. */
function toolServerUndecided(reply: FastifyReply): FastifyReply {
  return reply
    .code(503)
    .header("retry-after", String(authorityRetryAfterSeconds))
    .send({ error: "temporarily_unavailable" });
}

/** The client a verified token names in its `client_id` claim, where it names one. */
function toolServerTokenClient(token: string): string | undefined {
  const client: unknown = decodeJwt(token)["client_id"];
  return typeof client === "string" ? client : undefined;
}

/** The method and tool a JSON-RPC body names, for the log line alone. */
function toolServerRpc(body: unknown): ToolServerLogged {
  const parsed = z
    .object({
      method: z.string(),
      params: z.object({ name: z.string() }).optional().catch(undefined),
    })
    .safeParse(body);
  if (!parsed.success) return {};
  const tool = parsed.data.params?.name;
  return {
    rpc: parsed.data.method,
    ...(parsed.data.method === "tools/call" && tool !== undefined
      ? { tool }
      : {}),
  };
}

/** One request served statelessly, by a server and a transport that both end with it. */
async function toolServerMcpServed(
  options: ToolServerAppOptions,
  request: FastifyRequest,
  reply: FastifyReply,
  bearer: string,
): Promise<void> {
  const server = options.served(bearer);
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  reply.hijack();
  reply.raw.once("close", () => {
    void server.close().catch((failure: unknown) => {
      options.log(
        `tool server: closing a request's server failed: ${failure instanceof Error ? failure.message : "unknown failure"}`,
      );
    });
  });
  try {
    // The SDK's class leaves the callbacks its own `Transport` declares
    // optional typed with `undefined`, which `exactOptionalPropertyTypes`
    // tells apart; they are the same object either way.
    await server.connect(transport as Transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  } catch (failure) {
    options.log(
      `tool server: a request was not served: ${failure instanceof Error ? failure.message : "unknown failure"}`,
    );
    if (!reply.raw.headersSent) reply.raw.writeHead(500);
    reply.raw.end();
  }
}

/** The issuer, or nothing once the 503 its absence is answered with has been sent. */
async function toolServerIssuerReached(
  options: ToolServerAppOptions,
  reply: FastifyReply,
): Promise<ToolServerIssuer | undefined> {
  try {
    return await options.issuer();
  } catch (failure) {
    options.log(
      `tool server: the issuer could not be discovered: ${failure instanceof Error ? failure.message : "unknown failure"}`,
    );
    toolServerUndecided(reply);
    return undefined;
  }
}

/** A caller whose bearer verified, as `POST /mcp` serves it. */
interface ToolServerCaller {
  readonly token: string;
  readonly principal: string;
  readonly client: string | undefined;
}

/** The caller a request's bearer verifies as, or nothing once its refusal has been answered. */
async function toolServerAdmitted(
  options: ToolServerAppOptions,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ToolServerCaller | undefined> {
  const token = toolServerBearer(request.headers.authorization);
  if (token === undefined) {
    await toolServerUnauthenticated(reply, options.origin, false);
    return undefined;
  }
  const issuer = await toolServerIssuerReached(options, reply);
  if (issuer === undefined) return undefined;
  const decided = await issuer.authentication
    .authenticateBearer(token)
    .catch(() => ({ authenticated: "AuthorityUnavailable" }) as const);
  if (decided.authenticated === "AuthorityUnavailable") {
    await toolServerUndecided(reply);
    return undefined;
  }
  if (decided.authenticated === "InvalidToken") {
    await toolServerUnauthenticated(reply, options.origin, true);
    return undefined;
  }
  return {
    token,
    principal: decided.bearer.principal,
    client: toolServerTokenClient(token),
  };
}

function toolServerMcpRoutes(
  app: FastifyInstance,
  options: ToolServerAppOptions,
  logged: WeakMap<FastifyRequest, ToolServerLogged>,
): void {
  planeRouteServed(
    app,
    { method: "POST", url: "/mcp", bodyBytesMax: planeBodyBytesDefault },
    (request, reply) => toolServerAdmitted(options, request, reply),
    async (request, reply, caller) => {
      Object.assign(logged.get(request) ?? {}, {
        principal: caller.principal,
        ...(caller.client === undefined ? {} : { client: caller.client }),
        ...toolServerRpc(request.body),
      });
      await toolServerMcpServed(options, request, reply, caller.token);
      return reply;
    },
  );
  for (const method of ["GET", "DELETE"] as const)
    app.route({
      method,
      url: "/mcp",
      handler: (_request, reply) =>
        reply.code(405).header("allow", "POST").send(),
    });
}

/** The parameters `/authorize` forwards, or nothing where it answers them 400. */
function toolServerAuthorizeForwarded(
  search: URLSearchParams,
  clients: ReadonlySet<string>,
): URLSearchParams | undefined {
  const client = search.getAll("client_id");
  const method = search.getAll("code_challenge_method");
  if (client.length !== 1 || !clients.has(client[0] ?? "")) return undefined;
  if (method.length !== 1 || method[0] !== "S256") return undefined;
  const forwarded = new URLSearchParams();
  for (const [name, value] of search)
    if (name !== "resource" && name !== "audience")
      forwarded.append(name, value);
  return forwarded;
}

function toolServerAuthorizeRoute(
  app: FastifyInstance,
  options: ToolServerAppOptions,
  logged: WeakMap<FastifyRequest, ToolServerLogged>,
): void {
  const audiences = [toolServerResource(options.origin), options.apiAudience];
  app.get("/authorize", async (request, reply) => {
    const search = new URL(request.url, options.origin).searchParams;
    const forwarded = toolServerAuthorizeForwarded(search, options.clients);
    if (forwarded === undefined)
      return reply.code(400).send({ error: "invalid_request" });
    Object.assign(logged.get(request) ?? {}, {
      client: search.get("client_id"),
    });
    const issuer = await toolServerIssuerReached(options, reply);
    if (issuer === undefined) return reply;
    const target = new URL(issuer.authorizationEndpoint);
    for (const [name, value] of forwarded)
      target.searchParams.append(name, value);
    target.searchParams.set("audience", audiences.join(" "));
    return reply.redirect(target.href, 302);
  });
}

function toolServerMetadataRoutes(
  app: FastifyInstance,
  options: ToolServerAppOptions,
): void {
  const resource = toolServerResourceMetadata(options.origin);
  for (const url of [
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource",
  ])
    app.get(url, () => resource);
  app.get(
    "/.well-known/oauth-authorization-server",
    async (_request, reply) => {
      const issuer = await toolServerIssuerReached(options, reply);
      if (issuer === undefined) return reply;
      return toolServerAuthorizationMetadata(options.origin, issuer);
    },
  );
}

export function createToolServerApp(
  options: ToolServerAppOptions,
): FastifyInstance {
  const app = planeApp();
  const logged = new WeakMap<FastifyRequest, ToolServerLogged>();
  app.addHook("onRequest", async (request, reply) => {
    const said: ToolServerLogged = {};
    logged.set(request, said);
    reply.raw.once("close", () => {
      options.log(toolServerLogLine(request, reply.raw.statusCode, said));
    });
  });
  planeHealthRoutes(app, () => Promise.resolve(true));
  toolServerMetadataRoutes(app, options);
  toolServerAuthorizeRoute(app, options, logged);
  toolServerMcpRoutes(app, options, logged);
  return app;
}
