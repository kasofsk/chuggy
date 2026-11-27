/**
 * The process that serves chuggy's tools to a remote MCP client, such as
 * Claude's apps, over Streamable HTTP at one public origin.
 *
 * IT IS A CLIENT OF THE API AND HOLDS NO DATABASE. Every tool call is the
 * API's to answer under the caller's own bearer, so `.dependency-cruiser.cjs`
 * holds this root clear of every PostgreSQL adapter, and of every other root
 * reaching the core it serves the tools from.
 *
 * IT STARTS FROM ITS VARIABLES ALONE. Each is read and checked before the
 * process listens, and the issuer is discovered at the first request that
 * needs it. The composition is exported taking the issuer, which is what lets
 * a suite start it without one.
 */
import { pathToFileURL } from "node:url";

import {
  hostedToolContext,
  hostedToolServer,
} from "@chuggy/worker-core/hostedTools.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  oidcConfigurationChecked,
  type OidcAuthenticationConfig,
} from "../adapters/http/oidc.ts";
import {
  createToolServerApp,
  toolServerIssuerDiscovered,
  toolServerIssuerOnce,
  toolServerResource,
  type ToolServerIssuer,
} from "../adapters/http/toolServer.ts";
import { workerContractRelease } from "../contract/workerContract.ts";
import {
  planeEnvironmentPositive,
  planeEnvironmentRequired,
} from "./planeEnvironment.ts";
import { planeStopping } from "./planeStopping.ts";

/** Everything the server is composed from, read before anything is reached. */
export interface ToolServerEnvironment {
  readonly origin: string;
  readonly apiUrl: string;
  readonly apiAudience: string;
  readonly oidc: OidcAuthenticationConfig;
  readonly clients: ReadonlySet<string>;
  readonly host: string;
  readonly port: number;
}

const originVariable = "CHUG_TOOL_SERVER_PUBLIC_ORIGIN";
const apiUrlVariable = "CHUG_TOOL_SERVER_API_URL";
const clientsVariable = "CHUG_TOOL_SERVER_CLIENTS";

/** The public origin, which must be HTTPS with nothing after it. */
function toolServerOrigin(): string {
  const value = planeEnvironmentRequired(originVariable);
  const url = URL.parse(value);
  if (url?.protocol !== "https:" || value !== url.origin)
    throw new Error(
      `${originVariable} must be an HTTPS origin with nothing after it`,
    );
  return url.origin;
}

/** The API's base URL, HTTP or HTTPS and carrying no credentials. */
function toolServerApiUrl(): string {
  const value = planeEnvironmentRequired(apiUrlVariable);
  const url = URL.parse(value);
  if (
    url === null ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== ""
  )
    throw new Error(
      `${apiUrlVariable} must be an HTTP or HTTPS URL carrying no credentials`,
    );
  return url.href;
}

/** The OAuth clients `/authorize` answers, none of them empty. */
function toolServerClients(): ReadonlySet<string> {
  const clients = planeEnvironmentRequired(clientsVariable)
    .split(",")
    .map((client) => client.trim());
  if (clients.includes(""))
    throw new Error(`${clientsVariable} must name no empty client`);
  return new Set(clients);
}

export function toolServerEnvironment(): ToolServerEnvironment {
  const origin = toolServerOrigin();
  return {
    origin,
    apiUrl: toolServerApiUrl(),
    apiAudience: planeEnvironmentRequired("CHUG_TOOL_SERVER_API_AUDIENCE"),
    oidc: oidcConfigurationChecked({
      issuer: planeEnvironmentRequired("CHUG_TOOL_SERVER_OIDC_ISSUER"),
      audience: toolServerResource(origin),
      algorithms: planeEnvironmentRequired("CHUG_TOOL_SERVER_OIDC_ALGORITHMS")
        .split(",")
        .map((algorithm) => algorithm.trim()),
      discoveryTimeoutMs: planeEnvironmentPositive(
        "CHUG_TOOL_SERVER_OIDC_DISCOVERY_TIMEOUT_MS",
        5_000,
      ),
      jwksTimeoutMs: planeEnvironmentPositive(
        "CHUG_TOOL_SERVER_OIDC_JWKS_TIMEOUT_MS",
        5_000,
      ),
    }),
    clients: toolServerClients(),
    host: process.env["CHUG_TOOL_SERVER_HOST"] ?? "127.0.0.1",
    port: planeEnvironmentPositive("CHUG_TOOL_SERVER_PORT", 3_007),
  };
}

/** The server `environment` names, its issuer `issuer` and each request's tools the core's under that request's bearer. */
export function toolServerComposed(
  environment: ToolServerEnvironment,
  issuer: () => Promise<ToolServerIssuer> = toolServerIssuerOnce(() =>
    toolServerIssuerDiscovered(environment.oidc),
  ),
): FastifyInstance {
  return createToolServerApp({
    origin: environment.origin,
    apiAudience: environment.apiAudience,
    clients: environment.clients,
    issuer,
    served: (bearer) =>
      hostedToolServer(
        hostedToolContext({
          site: environment.apiUrl,
          api: environment.apiUrl,
          version: workerContractRelease,
          bearer,
        }),
        { McpServer, z },
      ),
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
}

async function main(): Promise<void> {
  const environment = toolServerEnvironment();
  const app = toolServerComposed(environment);
  planeStopping(app, "tool server");
  await app.listen({ host: environment.host, port: environment.port });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main().catch((failure: unknown) => {
    process.stderr.write(
      `tool server: ${failure instanceof Error ? failure.message : "startup failed"}\n`,
    );
    process.exitCode = 1;
  });
