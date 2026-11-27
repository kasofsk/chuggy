/**
 * The tool server's root: what it says about an environment it cannot start
 * under, that it listens and is ready with no issuer reachable, and that its
 * composition serves the core's tools to a verified bearer.
 *
 * IT IS DRIVEN AS A PROCESS BECAUSE NOTHING MAY IMPORT ONE. The composition is
 * imported inside a child program, where `.dependency-cruiser.cjs` does not
 * look, and no case reaches an issuer, an API or a database.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { planeRootRan } from "./harness.ts";

/** Every variable the root refuses to start without, each naming nothing that answers. */
const required: Readonly<Record<string, string>> = {
  CHUG_TOOL_SERVER_PUBLIC_ORIGIN: "https://tools.invalid",
  CHUG_TOOL_SERVER_API_URL: "http://127.0.0.1:1",
  CHUG_TOOL_SERVER_API_AUDIENCE: "chuggy",
  CHUG_TOOL_SERVER_OIDC_ISSUER: "https://issuer.invalid",
  CHUG_TOOL_SERVER_OIDC_ALGORITHMS: "RS256",
  CHUG_TOOL_SERVER_CLIENTS: "claude",
};

/** What a child program reported on its own line, apart from the lines the server logged. */
function reported(stdout: string): unknown {
  const line = stdout.split("\n").find((said) => said.startsWith("result "));
  return JSON.parse(line?.slice("result ".length) ?? "null");
}

function ran(argv: readonly string[], named: Readonly<Record<string, string>>) {
  return planeRootRan("CHUG_TOOL_SERVER_", argv, named);
}

test("a start missing any required variable is refused naming it", async () => {
  for (const missing of Object.keys(required)) {
    const named = Object.fromEntries(
      Object.entries(required).filter(([name]) => name !== missing),
    );
    const answered = await ran(["src/roots/toolServer.ts"], named);
    assert.equal(answered.code, 1, missing);
    assert.equal(answered.stderr, `tool server: ${missing} is required\n`);
  }
});

test("a malformed value refuses the start naming what it refused", async () => {
  for (const [variable, value, refusal] of [
    ["CHUG_TOOL_SERVER_PUBLIC_ORIGIN", "http://tools.invalid", undefined],
    ["CHUG_TOOL_SERVER_PUBLIC_ORIGIN", "https://tools.invalid/mcp", undefined],
    ["CHUG_TOOL_SERVER_PUBLIC_ORIGIN", "https://tools.invalid/", undefined],
    ["CHUG_TOOL_SERVER_API_URL", "http://user:secret@127.0.0.1:1", undefined],
    ["CHUG_TOOL_SERVER_API_URL", "file:///api", undefined],
    ["CHUG_TOOL_SERVER_CLIENTS", "claude,,other", undefined],
    ["CHUG_TOOL_SERVER_OIDC_ISSUER", "http://issuer.invalid", "OIDC issuer"],
    ["CHUG_TOOL_SERVER_OIDC_ALGORITHMS", "HS256", "OIDC algorithms"],
    ["CHUG_TOOL_SERVER_PORT", "zero", undefined],
  ] as const) {
    const answered = await ran(["src/roots/toolServer.ts"], {
      ...required,
      [variable]: value,
    });
    assert.equal(answered.code, 1, value);
    assert.ok(
      answered.stderr.startsWith(`tool server: ${refusal ?? variable} `),
      `${value}: ${answered.stderr}`,
    );
  }
});

/** The server composed as `main` composes it, listening on a port of its own, asked whether it is ready. */
const listening = `
  const { toolServerEnvironment, toolServerComposed } = await import('./src/roots/toolServer.ts');
  const app = toolServerComposed(toolServerEnvironment());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const ready = await fetch(address + '/health/ready');
  process.stdout.write('\\nresult ' + JSON.stringify({ ready: ready.status }) + '\\n');
  await app.close();
`;

test("the server listens and is ready from its variables alone, with no issuer reachable", async () => {
  const answered = await ran(
    ["--input-type=module", "--eval", listening],
    required,
  );
  assert.equal(answered.code, 0, answered.stderr);
  assert.deepEqual(reported(answered.stdout), { ready: 200 });
});

/** The composition over an issuer double that verifies one bearer, asked for its tools under it. */
const composed = `
  const { toolServerEnvironment, toolServerComposed } = await import('./src/roots/toolServer.ts');
  const app = toolServerComposed(toolServerEnvironment(), () => Promise.resolve({
    authorizationEndpoint: 'https://issuer.invalid/oauth2/auth',
    tokenEndpoint: 'https://issuer.invalid/oauth2/token',
    revocationEndpoint: 'https://issuer.invalid/oauth2/revoke',
    authentication: {
      authenticateBearer: (token) => Promise.resolve(token === bearer
        ? { authenticated: 'Bearer', bearer: { principal: 'alice' } }
        : { authenticated: 'InvalidToken' }),
    },
  }));
  const bearer = 'e30.' + Buffer.from('{}').toString('base64url') + '.';
  const listed = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: 'Bearer ' + bearer,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  process.stdout.write('\\nresult ' + JSON.stringify({
    status: listed.statusCode,
    tools: listed.json().result.tools.map(({ name }) => name),
  }) + '\\n');
  await app.close();
`;

test("a verified bearer is served the core's tools, bound to no project", async () => {
  const answered = await ran(
    ["--input-type=module", "--eval", composed],
    required,
  );
  assert.equal(answered.code, 0, answered.stderr);
  const read = reported(answered.stdout) as {
    status: number;
    tools: string[];
  };
  assert.equal(read.status, 200);
  assert.equal(read.tools[0], "list_projects");
  assert.ok(read.tools.includes("list_tickets"), read.tools.join(","));
  assert.ok(!read.tools.includes("fetch_image"), read.tools.join(","));
});
