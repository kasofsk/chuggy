/**
 * The tool server's routes, driven in process: its bearers verified by the
 * API's own verifier against a key set this suite signs with, and each
 * verified request served by an MCP server of the SDK's that holds one tool.
 *
 * THE KEY SET IS FETCHED BY `jose` rather than by the adapter, so the
 * platform's own `fetch` answers for it and is put back after every case.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import {
  createToolServerApp,
  toolServerIssuerDiscovered,
  toolServerIssuerOnce,
  type ToolServerIssuer,
} from "../../src/adapters/http/toolServer.ts";

const origin = "https://tools.example.test";
const resource = `${origin}/mcp`;
const apiAudience = "chuggy-api";
const issuer = "https://accounts.example.test";
const client = "claude";

const discovery = {
  issuer,
  authorization_endpoint: `${issuer}/oauth2/auth`,
  token_endpoint: `${issuer}/oauth2/token`,
  revocation_endpoint: `${issuer}/oauth2/revoke`,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
};

const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="offline_access"`;

const keys = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(keys.publicKey)), alg: "RS256", kid: "one" };

const platformFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = platformFetch;
});

/** A token the suite's key signs, for `audience`, naming the client the issuer writes into an access token. */
function signed(audience: string | readonly string[]): Promise<string> {
  return new SignJWT({ sub: "alice", client_id: client })
    .setProtectedHeader({ alg: "RS256", kid: "one" })
    .setIssuer(issuer)
    .setAudience([...(typeof audience === "string" ? [audience] : audience)])
    .setExpirationTime("10m")
    .sign(keys.privateKey);
}

/** The issuer discovered through `discovered`, its key set answered by `jwks`. */
function discoveredIssuer(
  discovered: () => Promise<Response>,
  jwks: () => Promise<Response> = () =>
    Promise.resolve(Response.json({ keys: [jwk] })),
): () => Promise<ToolServerIssuer> {
  globalThis.fetch = jwks;
  return toolServerIssuerOnce(() =>
    toolServerIssuerDiscovered(
      {
        issuer,
        audience: resource,
        algorithms: ["RS256"],
        discoveryTimeoutMs: 1_000,
        jwksTimeoutMs: 1_000,
      },
      discovered,
    ),
  );
}

/** The server under `issued`, recording every bearer it served a request under and every line it logged. */
function served(
  issued: () => Promise<ToolServerIssuer> = discoveredIssuer(() =>
    Promise.resolve(Response.json(discovery)),
  ),
) {
  const bearers: string[] = [];
  const lines: string[] = [];
  let logged: (line: string) => void = () => undefined;
  const app = createToolServerApp({
    origin,
    apiAudience,
    clients: new Set([client]),
    issuer: issued,
    served: (bearer) => {
      bearers.push(bearer);
      const server = new McpServer({ name: "fixture", version: "1" });
      server.registerTool("echo", { description: "Echoes." }, () => ({
        content: [{ type: "text", text: "echoed" }],
      }));
      return server;
    },
    log: (line) => {
      lines.push(line);
      logged(line);
    },
  });
  /** Resolves on the next line logged. */
  const nextLine = () =>
    new Promise<string>((resolve) => {
      logged = resolve;
    });
  return { app, bearers, lines, nextLine };
}

function rpc(
  app: ReturnType<typeof served>["app"],
  token: string | undefined,
  body: object,
) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    payload: { jsonrpc: "2.0", id: 1, ...body },
  });
}

test("a request with no bearer is challenged to the resource's metadata and told no error", async () => {
  const { app, bearers } = served();
  const answered = await rpc(app, undefined, { method: "tools/list" });
  assert.equal(answered.statusCode, 401);
  assert.equal(answered.headers["www-authenticate"], challenge);
  assert.deepEqual(bearers, []);
});

test("a presented token that does not verify is challenged as invalid", async () => {
  const { app, bearers } = served();
  const answered = await rpc(app, "not-a-token", { method: "tools/list" });
  assert.equal(answered.statusCode, 401);
  assert.equal(
    answered.headers["www-authenticate"],
    `${challenge}, error="invalid_token"`,
  );
  assert.deepEqual(bearers, []);
});

test("a bearer carrying the API's audience alone is refused", async () => {
  const { app, bearers } = served();
  const answered = await rpc(app, await signed(apiAudience), {
    method: "tools/list",
  });
  assert.equal(answered.statusCode, 401);
  assert.equal(
    answered.headers["www-authenticate"],
    `${challenge}, error="invalid_token"`,
  );
  assert.deepEqual(bearers, []);
});

test("a verified bearer reaches a server of its own, which lists its tools, and is logged without its token", async () => {
  const { app, bearers, nextLine } = served();
  const token = await signed([resource, apiAudience]);
  const line = nextLine();
  const answered = await rpc(app, token, { method: "tools/list" });
  assert.equal(answered.statusCode, 200);
  const listed = answered.json<{ result: { tools: { name: string }[] } }>();
  assert.deepEqual(
    listed.result.tools.map(({ name }) => name),
    ["echo"],
  );
  assert.deepEqual(bearers, [token]);
  assert.equal(
    await line,
    `tool server: POST "/mcp" 200 principal="${String(issuer.length)}:${issuer}alice" client="${client}" rpc="tools/list"`,
  );
});

test("a tool call is logged by its tool's name", async () => {
  const { app, nextLine } = served();
  const line = nextLine();
  const answered = await rpc(app, await signed(resource), {
    method: "tools/call",
    params: { name: "echo", arguments: {} },
  });
  assert.equal(answered.statusCode, 200);
  assert.match(await line, / rpc="tools\/call" tool="echo"$/u);
});

test("a request past the body bound is refused before any server is made", async () => {
  const { app, bearers } = served();
  const answered = await rpc(app, await signed(resource), {
    method: "tools/call",
    params: { name: "echo", arguments: { text: "x".repeat(1 << 20) } },
  });
  assert.equal(answered.statusCode, 413);
  assert.deepEqual(bearers, []);
});

test("a bearer is refused before the body is read, however large the body", async () => {
  const { app } = served();
  const answered = await rpc(app, undefined, {
    method: "tools/call",
    params: { name: "echo", arguments: { text: "x".repeat(1 << 20) } },
  });
  assert.equal(answered.statusCode, 401);
  assert.equal(answered.headers["www-authenticate"], challenge);
});

test("a key set that cannot be read is undecided, never a refusal of the token", async () => {
  const { app, bearers } = served(
    discoveredIssuer(
      () => Promise.resolve(Response.json(discovery)),
      () => Promise.resolve(new Response("down", { status: 502 })),
    ),
  );
  const answered = await rpc(app, await signed(resource), {
    method: "tools/list",
  });
  assert.equal(answered.statusCode, 503);
  assert.equal(answered.headers["www-authenticate"], undefined);
  assert.deepEqual(bearers, []);
});

test("an issuer that cannot be discovered is undecided, and the next request asks it again", async () => {
  let reachable = false;
  const { app } = served(
    discoveredIssuer(() =>
      Promise.resolve(
        reachable
          ? Response.json(discovery)
          : new Response("down", { status: 502 }),
      ),
    ),
  );
  const token = await signed(resource);
  assert.equal(
    (await rpc(app, token, { method: "tools/list" })).statusCode,
    503,
  );
  assert.equal(
    (await app.inject({ url: "/.well-known/oauth-authorization-server" }))
      .statusCode,
    503,
  );
  reachable = true;
  assert.equal(
    (await rpc(app, token, { method: "tools/list" })).statusCode,
    200,
  );
});

test("the protected-resource metadata is served at both paths, field by field", async () => {
  const { app } = served();
  for (const url of [
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource",
  ]) {
    const answered = await app.inject({ url });
    assert.equal(answered.statusCode, 200, url);
    assert.deepEqual(
      answered.json(),
      {
        resource,
        authorization_servers: [origin],
        scopes_supported: ["offline_access"],
        bearer_methods_supported: ["header"],
      },
      url,
    );
  }
});

test("the authorization-server metadata names this origin's authorization endpoint and the issuer's token endpoints, and no registration", async () => {
  const { app } = served();
  const answered = await app.inject({
    url: "/.well-known/oauth-authorization-server",
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: discovery.token_endpoint,
    revocation_endpoint: discovery.revocation_endpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
    scopes_supported: ["offline_access"],
  });
});

/** An authorization request carrying every parameter `asked` names. */
function authorize(
  app: ReturnType<typeof served>["app"],
  asked: readonly (readonly [string, string])[],
) {
  return app.inject({
    url: `/authorize?${new URLSearchParams(asked.map(([name, value]) => [name, value])).toString()}`,
  });
}

const authorization = [
  ["response_type", "code"],
  ["client_id", client],
  ["redirect_uri", "https://claude.ai/api/mcp/auth_callback"],
  ["scope", "offline_access"],
  ["state", "opaque"],
  ["code_challenge", "challenge"],
  ["code_challenge_method", "S256"],
] as const;

test("an authorization request is redirected to the issuer, every parameter carried but the resource, and the audiences set", async () => {
  const { app } = served();
  const answered = await authorize(app, [
    ...authorization,
    ["resource", resource],
    ["audience", "somebody-else"],
  ]);
  assert.equal(answered.statusCode, 302);
  const location = new URL(answered.headers.location ?? "");
  assert.equal(
    `${location.origin}${location.pathname}`,
    discovery.authorization_endpoint,
  );
  assert.deepEqual(
    [...location.searchParams],
    [...authorization, ["audience", `${resource} ${apiAudience}`]],
  );
});

test("an authorization request from a client off the allow-list, or without S256, is refused and never forwarded", async () => {
  const { app } = served();
  const without = (name: string) =>
    authorization.filter(([named]) => named !== name);
  for (const asked of [
    without("client_id"),
    [...without("client_id"), ["client_id", "stranger"] as const],
    [...authorization, ["client_id", client] as const],
    without("code_challenge_method"),
    [
      ...without("code_challenge_method"),
      ["code_challenge_method", "plain"] as const,
    ],
  ]) {
    const answered = await authorize(app, asked);
    assert.equal(answered.statusCode, 400, JSON.stringify(asked));
    assert.equal(answered.headers.location, undefined);
  }
});

test("the stream and session methods are not served", async () => {
  const { app } = served();
  for (const method of ["GET", "DELETE"] as const) {
    const answered = await app.inject({ method, url: "/mcp" });
    assert.equal(answered.statusCode, 405, method);
    assert.equal(answered.headers.allow, "POST");
  }
});

test("both health routes answer while the issuer cannot be discovered", async () => {
  const { app } = served(
    discoveredIssuer(() => Promise.reject(new Error("unreachable"))),
  );
  assert.equal((await app.inject({ url: "/health/live" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/health/ready" })).statusCode, 200);
});
