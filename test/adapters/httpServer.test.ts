import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import {
  createNativeHttpApp,
  type NativeHttpLimits,
  type NativeTicketApplication,
} from "../../src/adapters/http/server.ts";
import {
  Pending,
  Ticket,
  TicketGraph,
} from "../../src/domain/chuggernaut/ticket.js";
import { released } from "../chuggernaut/domain/testing.js";
import { TicketId } from "../../src/domain/chuggernaut/task.js";
import {
  asPrincipal,
  type NativeWeb,
} from "../../src/interpreter/nativeWeb.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import {
  forgeCredentialMinting,
  type ForgeCredentialMinting,
} from "../../src/interpreter/forgeCredentials.ts";
import {
  asForgeId,
  asForgeInstallationId,
  asForgeInstallationToken,
} from "../../src/interpreter/forgeInstallation.ts";
import { mintedRepositoryTokens } from "../../src/adapters/forge/mintedCredentials.ts";
import { githubRepositoryHost } from "../../src/adapters/forge/githubAddress.ts";
import { memberAuthority } from "../../src/interpreter/projectAccess.ts";
import {
  asGitObjectId,
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";

const authority = {
  installationAuthority: () =>
    Promise.resolve(asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab")),
};

function fakeWeb(calls: string[]): NativeWeb {
  const unused = () => Promise.reject(new Error("unused interactive method"));
  return {
    projectInventory: (_principal, _after, limit) => {
      calls.push(`inventory:${String(limit)}`);
      return Promise.resolve({ projects: [] });
    },
    lead: unused,
    leadTranscript: unused,
    threads: unused,
    thread: unused,
    threadTranscript: unused,
    openThread: unused,
    sendThreadMessage: unused,
    closeThread: unused,
    renameThread: unused,
    hideThread: unused,
    leadInquiries: unused,
    leadInquiry: unused,
    askLead: unused,
  };
}

/**
 * The minting service the credential route answers from, refusing the
 * repository this suite treats as unbound and reporting the forge as down for
 * the one it treats as unreachable.
 */
function fakeForgeCredentials(calls: string[]): ForgeCredentialMinting {
  return {
    mint: (_principal, _partition, request) => {
      calls.push(
        `forge-credentials:${request.repository}:${request.permissions}`,
      );
      if (request.repository.endsWith("/unbound"))
        return Promise.resolve({ result: "NotFound" });
      if (request.repository.endsWith("/unreachable"))
        return Promise.resolve({ result: "Unavailable" });
      return Promise.resolve({
        result: "Authorized",
        value: {
          token: asForgeInstallationToken("ghs-minted-q4w5e6"),
          expiresAtMs: 1_757_500_000_000,
        },
      });
    },
  };
}

function appOf(
  calls: string[],
  authenticated = true,
  limits?: NativeHttpLimits,
  minting?: ForgeCredentialMinting,
) {
  return createNativeHttpApp(
    fakeWeb(calls),
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          authenticated && token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: { principal: asPrincipal("issuer-subject") },
              }
            : { authenticated: "InvalidToken" as const },
        ),
    },
    { ready: () => Promise.resolve(true) },
    authority,
    limits,
    minting ?? fakeForgeCredentials(calls),
  );
}

const forgeCredentialsPath =
  "/api/v1/tenants/acme/projects/atlas/forge-credentials";

/** One credential request, the repository being what each case is about. */
function forgeCredentialRequest(repository: string) {
  return {
    method: "POST" as const,
    url: forgeCredentialsPath,
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    payload: JSON.stringify({ repository, permissions: "write" }),
  };
}

test("a bound repository is answered with a token and when it stops working", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const minted = await app.inject(
    forgeCredentialRequest("https://github.com/kasofsk/chuggy"),
  );
  assert.equal(minted.statusCode, 200);
  assert.deepEqual(minted.json(), {
    token: "ghs-minted-q4w5e6",
    expiresAtMs: 1_757_500_000_000,
  });
  assert.deepEqual(calls, [
    "forge-credentials:https://github.com/kasofsk/chuggy:write",
  ]);
});

test("a repository this caller may not mint for is not found and a forge that is down is a wait", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const absent = await app.inject(
    forgeCredentialRequest("https://github.com/kasofsk/unbound"),
  );
  assert.equal(absent.statusCode, 404);
  const waiting = await app.inject(
    forgeCredentialRequest("https://github.com/kasofsk/unreachable"),
  );
  assert.equal(waiting.statusCode, 503);
  assert.equal(
    waiting.json<HttpErrorEnvelope>().error.code,
    "ForgeUnavailable",
  );
  assert.ok(waiting.headers["retry-after"] !== undefined);
});

/**
 * The route over the real minting stack, the store holding one claim: the
 * tenant in the path is what decides whether that claim may be read, so a
 * project of another tenant that has somehow bound the repository is answered
 * exactly as an unbound one is.
 */
function realForgeCredentials(claimedBy: string): ForgeCredentialMinting {
  return forgeCredentialMinting(
    {
      authorize: () => Promise.resolve(memberAuthority(asPrincipal("m"))),
      authorizeTenant: () => Promise.resolve(undefined),
    },
    {
      binding: (_partition, repository) =>
        Promise.resolve({
          partition: { tenant: asTenantId("elsewhere") },
          repository,
        } as RepositoryBinding),
    },
    mintedRepositoryTokens({
      forge: asForgeId("github"),
      app: "portal",
      repositoryHost: githubRepositoryHost,
      installations: {
        installation: (query) =>
          Promise.resolve(
            query.tenant === claimedBy
              ? {
                  forge: query.forge,
                  app: query.app,
                  account: query.account,
                  installationId: asForgeInstallationId("156333284"),
                }
              : undefined,
          ),
      },
      tokens: {
        mint: () =>
          Promise.resolve({
            minted: "Token",
            token: asForgeInstallationToken("ghs-minted-q4w5e6"),
            expiresAtMs: 1_757_500_000_000,
          }),
      },
    }),
  );
}

test("a repository whose account another tenant claimed is not found through the route", async () => {
  const repository = asRepositoryId(
    `https://${githubRepositoryHost}/kasofsk/chuggy`,
  );
  await using crossing = appOf(
    [],
    true,
    undefined,
    realForgeCredentials("elsewhere"),
  );
  assert.equal(
    (await crossing.inject(forgeCredentialRequest(repository))).statusCode,
    404,
  );
  await using held = appOf([], true, undefined, realForgeCredentials("acme"));
  const minted = await held.inject(forgeCredentialRequest(repository));
  assert.equal(
    minted.statusCode,
    200,
    "the tenant the path names holds the claim",
  );
});

test("a credential request presenting no bearer or no version reaches no minting", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const request = forgeCredentialRequest("https://github.com/kasofsk/chuggy");
  assert.equal(
    (
      await app.inject({
        ...request,
        headers: { "content-type": "application/vnd.chuggy.v1+json" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        ...request,
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
      })
    ).statusCode,
    415,
  );
  assert.equal(
    (
      await app.inject({
        ...request,
        payload: JSON.stringify({ repository: "r", permissions: "administer" }),
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(calls, []);
});

test("authentication failure never reaches NativeWeb", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({ method: "GET", url: "/api/v1/projects" });
  assert.equal(found.statusCode, 401);
  assert.equal(found.headers["www-authenticate"], "Bearer");
  assert.equal(found.headers["cache-control"], "no-store");
  assert.deepEqual(calls, []);
});

test("installation authority is a public read-only bootstrap resource", async () => {
  const calls: string[] = [];
  await using app = appOf(calls, false);
  const found = await app.inject({
    method: "GET",
    url: "/api/v1/installation",
  });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), {
    installation: "018f84a1-4c2b-7def-8abc-0123456789ab",
  });
  assert.deepEqual(calls, []);
});

test("health is separate from authenticated product routes", async () => {
  const calls: string[] = [];
  await using app = appOf(calls, false);
  assert.equal((await app.inject({ url: "/health/live" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/health/ready" })).statusCode, 200);
  const contract = await app.inject({ url: "/api/v1/contract" });
  assert.equal(contract.statusCode, 200);
  assert.equal(contract.headers["cache-control"], "no-cache");
  assert.deepEqual(calls, []);
});

test("the bearer scheme is matched without regard to its case", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "bearer valid" },
  });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(calls, ["inventory:50"]);
});

for (const failure of [
  new Error("the pool is unreachable"),
  new SyntaxError("Unexpected token } in JSON at position 7"),
]) {
  test(`stored read failure stays internal: ${failure.name}`, async () => {
    await using app = createNativeHttpApp(
      { ...fakeWeb([]), projectInventory: () => Promise.reject(failure) },
      {
        authenticateBearer: () =>
          Promise.resolve({
            authenticated: "Bearer",
            bearer: { principal: asPrincipal("issuer subject") },
          }),
      },
      { ready: () => Promise.resolve(true) },
      authority,
    );
    const found = await app.inject({
      url: "/api/v1/projects",
      headers: { authorization: "Bearer valid" },
    });
    assert.equal(found.statusCode, 500);
    assert.equal(found.json<HttpErrorEnvelope>().error.code, "InternalError");
    assert.ok(!found.body.includes(failure.message));
  });
}

const capacityPollAttemptsMax = 200;

const capacityPollIntervalMs = 10;

async function capacityLivenessReaches(
  port: number,
  status: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < capacityPollAttemptsMax; attempt += 1) {
    const found = await fetch(`http://127.0.0.1:${String(port)}/health/live`);
    await found.arrayBuffer();
    if (found.status === status) return true;
    await delay(capacityPollIntervalMs);
  }
  return false;
}

function capacityAbandonedRequest(port: number): Promise<net.Socket> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        "POST /api/v1/tenants/tenant/projects/project/threads HTTP/1.1\r\n" +
          "host: localhost\r\n" +
          "idempotency-key: key\r\n" +
          "content-type: application/vnd.chuggy.v1+json\r\n" +
          "content-length: 4096\r\n\r\n{",
      );
      resolve(socket);
    });
  });
}

test("an aborted request returns the capacity slot it took", async () => {
  const calls: string[] = [];
  await using app = appOf(calls, true, {
    concurrentRequestsMax: 1,
    requestTimeoutMs: 15_000,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address !== null && typeof address !== "string");
  const abandoned = await capacityAbandonedRequest(address.port);
  assert.ok(
    await capacityLivenessReaches(address.port, 503),
    "the abandoned request should hold the only slot",
  );
  abandoned.destroy();
  assert.ok(
    await capacityLivenessReaches(address.port, 200),
    "the aborted request should have returned its slot",
  );
  assert.deepEqual(calls, []);
});

test("a verification this server could not carry out is its own failure", async () => {
  const calls: string[] = [];
  await using app = createNativeHttpApp(
    fakeWeb(calls),
    {
      authenticateBearer: () =>
        Promise.resolve({ authenticated: "AuthorityUnavailable" as const }),
    },
    { ready: () => Promise.resolve(true) },
    authority,
  );
  const found = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(found.statusCode, 503);
  assert.equal(
    found.json<HttpErrorEnvelope>().error.code,
    "AuthorityUnavailable",
  );
  assert.equal(found.headers["retry-after"], "1");
  assert.equal(found.headers["www-authenticate"], undefined);
});

test("a port that throws is unavailable rather than a refusal of the token", async () => {
  const calls: string[] = [];
  await using app = createNativeHttpApp(
    fakeWeb(calls),
    {
      authenticateBearer: () =>
        Promise.reject(new Error("the key set is unreachable")),
    },
    { ready: () => Promise.resolve(true) },
    authority,
  );
  const found = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(found.statusCode, 503);
  assert.ok(!found.body.includes("key set"));
});

test("only a token this server rejected carries the invalid-token challenge", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const refused = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "Bearer stale" },
  });
  assert.equal(refused.statusCode, 401);
  assert.equal(
    refused.headers["www-authenticate"],
    'Bearer error="invalid_token"',
  );
  const offered = await app.inject({ url: "/api/v1/projects" });
  assert.equal(offered.statusCode, 401);
  assert.equal(offered.headers["www-authenticate"], "Bearer");
});

function retiredTicketApp(
  result: "LegacyModelUnsupported" | "Fresh" | "NotFound",
): NativeTicketApplication {
  const unavailable = () => Promise.reject(new Error("unused adopted method"));
  return {
    identity: () => "identity",
    application: {
      graph: () =>
        Promise.resolve(
          result === "Fresh"
            ? { result: "Authorized", value: new TicketGraph(new Map()) }
            : { result },
        ),
      definition: unavailable,
      validate: unavailable,
      catalog: unavailable,
      catalogFile: unavailable,
      writeCatalogFile: unavailable,
      removeCatalogFile: unavailable,
      outcome: unavailable,
      create: unavailable,
      update: unavailable,
      dispatch: unavailable,
      revoke: unavailable,
      resume: unavailable,
    },
  };
}

function adoptedTicketRouteApp(service: NativeTicketApplication) {
  return createNativeHttpApp(
    fakeWeb([]),
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer",
          bearer: { principal: asPrincipal("member") },
        }),
    },
    { ready: () => Promise.resolve(true) },
    authority,
    undefined,
    undefined,
    undefined,
    service,
  );
}

function retiredRouteApp(result: Parameters<typeof retiredTicketApp>[0]) {
  return adoptedTicketRouteApp(retiredTicketApp(result));
}

test("retired lifecycle routes authorize before refusing legacy and fresh projects", async () => {
  const requests = [
    ["GET", "/api/v1/tenants/acme/projects/atlas/configurations"],
    ["POST", "/api/v1/tenants/acme/projects/atlas/configurations"],
    ["POST", "/api/v1/tenants/acme/projects/atlas/drafts"],
    ["GET", "/api/v1/tenants/acme/projects/atlas/operations/old"],
    ["DELETE", "/api/v1/tenants/acme/projects/atlas/operations/old"],
    ["GET", "/api/v1/tenants/acme/projects/atlas/selector-context"],
    ["PUT", "/api/v1/tenants/acme/projects/atlas/selector-settings"],
  ] as const;
  for (const [model, code] of [
    ["LegacyModelUnsupported", "LegacyModelUnsupported"],
    ["Fresh", "EndpointUnsupported"],
  ] as const) {
    await using app = retiredRouteApp(model);
    for (const [method, path] of requests) {
      const response = await app.inject({
        method,
        url: path,
        headers: { authorization: "Bearer valid" },
      });
      assert.equal(response.statusCode, 409, path);
      assert.equal(response.json<HttpErrorEnvelope>().error.code, code, path);
    }
  }
});

test("retired lifecycle routes conceal an unauthorized project", async () => {
  await using app = retiredRouteApp("NotFound");
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/tenants/acme/projects/atlas/configurations",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(response.statusCode, 404);
});

test("adopted authoring forwards YAML, its binding and its catalog guard", async () => {
  const service = retiredTicketApp("Fresh");
  const sources: unknown[] = [];
  const application: NativeTicketApplication = {
    ...service,
    application: {
      ...service.application,
      create: (_principal, request) => {
        sources.push(request);
        return Promise.resolve({
          result: "Authorized",
          value: { accepted: "Accepted" },
        });
      },
    },
  };
  await using app = adoptedTicketRouteApp(application);
  const source = "title: Example\nwork: implement\n";
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/acme/projects/atlas/ticket-machine/tickets",
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/yaml",
      "idempotency-key": "create",
      "if-catalog-match": "a".repeat(40),
      "x-chug-repository": "github.com/acme/atlas",
    },
    payload: source,
  });
  assert.equal(response.statusCode, 202, response.body);
  assert.deepEqual(response.json(), {
    identity: "identity",
    accepted: "Accepted",
  });
  assert.deepEqual(sources, [
    {
      partition: { tenant: "acme", project: "atlas" },
      identity: "identity",
      source,
      expectedCatalogCommit: "a".repeat(40),
      repository: "github.com/acme/atlas",
    },
  ]);
});

test("a write against a catalog that has moved is refused by name", async () => {
  const service = retiredTicketApp("Fresh");
  const application: NativeTicketApplication = {
    ...service,
    application: {
      ...service.application,
      create: () =>
        Promise.resolve({
          result: "Authorized",
          value: {
            accepted: "AuthoringRefused",
            code: "CatalogCommitStale",
            message: `the catalog has moved from ${"a".repeat(40)} to ${"b".repeat(40)}`,
          },
        }),
    },
  };
  await using app = adoptedTicketRouteApp(application);
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/acme/projects/atlas/ticket-machine/tickets",
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/yaml",
      "idempotency-key": "create",
      "if-catalog-match": "a".repeat(40),
    },
    payload: "title: Example\n",
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.match(
    JSON.stringify(response.json()),
    /the catalog has moved from a+ to b+/u,
  );
});

test("a ticket point read carries the authored source beside its revision", async () => {
  const service = retiredTicketApp("Fresh");
  const held = new Ticket(released(TicketId(4)), 3, 0, new Pending());
  const application: NativeTicketApplication = {
    ...service,
    application: {
      ...service.application,
      definition: (_principal, _partition, ticket) =>
        Promise.resolve(
          ticket === 4
            ? {
                result: "Authorized",
                value: { held, source: "title: kept\n" },
              }
            : { result: "Authorized", value: undefined },
        ),
    },
  };
  await using app = adoptedTicketRouteApp(application);
  const found = await app.inject({
    method: "GET",
    url: "/api/v1/tenants/acme/projects/atlas/ticket-machine/tickets/4",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(found.statusCode, 200, found.body);
  assert.deepEqual(found.json(), {
    ticket: 4,
    revision: 3,
    workCyclesStarted: 0,
    state: "Pending",
    dependencies: [],
    source: "title: kept\n",
  });
  const missing = await app.inject({
    method: "GET",
    url: "/api/v1/tenants/acme/projects/atlas/ticket-machine/tickets/5",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(missing.statusCode, 404);
});

test("validation answers with findings and never reaches authoring", async () => {
  const service = retiredTicketApp("Fresh");
  const requests: unknown[] = [];
  const application: NativeTicketApplication = {
    ...service,
    application: {
      ...service.application,
      validate: (_principal, request) => {
        requests.push(request);
        return Promise.resolve({
          result: "Authorized",
          value: {
            valid: false,
            findings: ["catalog document must be a mapping"],
            commit: asGitObjectId("a".repeat(40)),
          },
        });
      },
    },
  };
  await using app = adoptedTicketRouteApp(application);
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/acme/projects/atlas/ticket-machine/tickets/validate",
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/yaml",
    },
    payload: "not a ticket",
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    valid: false,
    findings: ["catalog document must be a mapping"],
    commit: "a".repeat(40),
  });
  assert.deepEqual(requests, [
    { partition: { tenant: "acme", project: "atlas" }, source: "not a ticket" },
  ]);
});

test("the catalog routes name the binding alone and answer its tree", async () => {
  const service = retiredTicketApp("Fresh");
  const requests: unknown[] = [];
  const application: NativeTicketApplication = {
    ...service,
    application: {
      ...service.application,
      catalog: (_principal, request) => {
        requests.push(request);
        return Promise.resolve({
          result: "Authorized",
          value: {
            entries: [{ path: "workloads/work.yaml", origin: "Git" }],
          },
        });
      },
      catalogFile: (_principal, request, path) => {
        requests.push({ ...request, path });
        return Promise.resolve({
          result: "Authorized",
          value: { path, origin: "Git", content: "prompt: run\n" },
        });
      },
    },
  };
  await using app = adoptedTicketRouteApp(application);
  const root = "/api/v1/tenants/acme/projects/atlas/ticket-machine/catalog";
  const headers = { authorization: "Bearer valid" };
  const listed = await app.inject({
    method: "GET",
    url: `${root}?repository=github.com/acme/atlas`,
    headers,
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(listed.json(), {
    entries: [{ path: "workloads/work.yaml", origin: "Git" }],
  });
  const read = await app.inject({
    method: "GET",
    url: `${root}?path=workloads/work.yaml`,
    headers,
  });
  assert.equal(read.statusCode, 200, read.body);
  assert.deepEqual(read.json(), {
    path: "workloads/work.yaml",
    origin: "Git",
    content: "prompt: run\n",
  });
  assert.deepEqual(requests, [
    {
      partition: { tenant: "acme", project: "atlas" },
      repository: "github.com/acme/atlas",
    },
    {
      partition: { tenant: "acme", project: "atlas" },
      path: "workloads/work.yaml",
    },
  ]);
});

const adoptedCatalogRoot =
  "/api/v1/tenants/acme/projects/atlas/ticket-machine/catalog";
const adoptedCatalogCommit = "a".repeat(40);

/** A store whose one shadowed reference is refused and whose one held one removes. */
function adoptedFragmentApp(written: unknown[]): NativeTicketApplication {
  const service = retiredTicketApp("Fresh");
  return {
    ...service,
    application: {
      ...service.application,
      writeCatalogFile: (_principal, request, path, content) => {
        written.push({ ...request, path, content });
        return Promise.resolve(
          path === "workloads/work.yaml"
            ? {
                result: "Authorized",
                value: {
                  written: "Refused",
                  message: `the repository already holds ${path}; a runtime fragment may not shadow it`,
                },
              }
            : { result: "Authorized", value: { written: "Written" } },
        );
      },
      removeCatalogFile: (_principal, _request, path) =>
        Promise.resolve({
          result: "Authorized",
          value: {
            written: path === "workloads/held.yaml" ? "Removed" : "NotHeld",
          },
        }),
    },
  };
}

test("a runtime fragment write forwards its reference and refuses a shadow", async () => {
  const written: unknown[] = [];
  await using app = adoptedTicketRouteApp(adoptedFragmentApp(written));
  const headers = {
    authorization: "Bearer valid",
    "content-type": "application/yaml",
    "if-catalog-match": adoptedCatalogCommit,
  };
  const accepted = await app.inject({
    method: "PUT",
    url: `${adoptedCatalogRoot}?path=workloads/runtime.yaml`,
    headers,
    payload: "prompt: runtime\n",
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(accepted.json(), { written: "Written" });
  const refused = await app.inject({
    method: "PUT",
    url: `${adoptedCatalogRoot}?path=workloads/work.yaml`,
    headers,
    payload: "prompt: shadow\n",
  });
  assert.equal(refused.statusCode, 409, refused.body);
  assert.deepEqual(written, [
    {
      partition: { tenant: "acme", project: "atlas" },
      expectedCatalogCommit: adoptedCatalogCommit,
      path: "workloads/runtime.yaml",
      content: "prompt: runtime\n",
    },
    {
      partition: { tenant: "acme", project: "atlas" },
      expectedCatalogCommit: adoptedCatalogCommit,
      path: "workloads/work.yaml",
      content: "prompt: shadow\n",
    },
  ]);
});

test("removing a fragment the project does not hold is a not-found", async () => {
  await using app = adoptedTicketRouteApp(adoptedFragmentApp([]));
  const headers = { authorization: "Bearer valid" };
  const removed = await app.inject({
    method: "DELETE",
    url: `${adoptedCatalogRoot}?path=workloads/held.yaml`,
    headers,
  });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.deepEqual(removed.json(), { written: "Removed" });
  const absent = await app.inject({
    method: "DELETE",
    url: `${adoptedCatalogRoot}?path=workloads/absent.yaml`,
    headers,
  });
  assert.equal(absent.statusCode, 404);
});

test("a catalog guard that is not a commit is a bad request", async () => {
  await using app = adoptedTicketRouteApp(adoptedFragmentApp([]));
  const response = await app.inject({
    method: "DELETE",
    url: `${adoptedCatalogRoot}?path=workloads/held.yaml`,
    headers: {
      authorization: "Bearer valid",
      "if-catalog-match": "not-a-commit",
    },
  });
  assert.equal(response.statusCode, 400);
});
