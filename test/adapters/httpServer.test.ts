import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import type { WorkerPoolRegistrationService } from "../../src/interpreter/workerPoolRegistrationToken.ts";
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
import { adoptedTicketsSchema } from "../../src/contract/adoptedTickets.ts";
import { TicketId } from "../../src/domain/chuggernaut/task.js";
import {
  asPrincipal,
  type NativeWeb,
} from "../../src/interpreter/nativeWeb.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import type { TicketApplicationResult } from "../../src/interpreter/ticketApplication.ts";
import type { TicketExecutionReads } from "../../src/interpreter/ticketExecutionRead.ts";
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

/**
 * Registration as the routes see it: one token stands for one project, and the
 * capability bound is the interpreter's rather than the route's.
 */
function fakeWorkerPools(calls: string[]): WorkerPoolRegistrationService {
  return {
    mint: (_principal, partition, request) => {
      calls.push(
        `worker-pool-token:${partition.project}:${request.capabilities.join("+")}:${String(request.lifetimeSecs)}`,
      );
      return Promise.resolve(
        partition.project === "atlas"
          ? {
              result: "Minted",
              value: { token: "a-token", expiresAtMs: 1_757_500_000_000 },
            }
          : { result: "NotFound" },
      );
    },
    redeem: (offered) => {
      calls.push(`worker-pool-redeem:${offered.pool}`);
      if (offered.pool === "unpermitted")
        return Promise.resolve({ result: "CapabilityNotPermitted" });
      if (offered.pool === "spent")
        return Promise.resolve({ result: "NotFound" });
      return Promise.resolve({
        result: "Registered",
        value: { clientId: "chuggy-pool-one", clientSecret: "a-secret" },
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
    undefined,
    undefined,
    fakeWorkerPools(calls),
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
            ? {
                result: "Authorized",
                value: {
                  graph: new TicketGraph(new Map()),
                  reworkLimits: new Map(),
                },
              }
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

/** A read half that answers one project and conceals every other as one that is not there. */
function evidenceReads(permitted: string): TicketExecutionReads {
  const held = <Value>(
    partition: { project: string },
    value: Value,
  ): TicketApplicationResult<Value> =>
    partition.project === permitted
      ? { result: "Authorized", value }
      : { result: "NotFound" };
  return {
    admitted: (_principal, partition) =>
      Promise.resolve(held(partition, { admitted: true } as const)),
    executions: (_principal, partition) =>
      Promise.resolve(
        held(partition, [
          {
            taskKey: "work:1:1",
            state: "Terminal" as const,
            attempt: 2,
            attemptsUnreported: 0,
            queuedAt: "2026-09-19T00:00:00.000Z",
          },
        ]),
      ),
    execution: (_principal, partition, taskKey) =>
      Promise.resolve(
        held(
          partition,
          taskKey === "work:1:1"
            ? {
                taskKey,
                state: "Terminal" as const,
                attempt: 2,
                attemptsUnreported: 0,
                queuedAt: "2026-09-19T00:00:00.000Z",
              }
            : undefined,
        ),
      ),
    turns: (_principal, partition) =>
      Promise.resolve(held(partition, { turns: [] })),
    transcript: (_principal, partition) =>
      Promise.resolve(held(partition, { batches: [] })),
    configuration: (_principal, partition) =>
      Promise.resolve(held(partition, undefined)),
    operations: (_principal, partition) =>
      Promise.resolve(
        held(partition, [
          {
            identity: "op-1",
            sequence: 4,
            origin: "Author" as const,
            attribution: "member",
            command: "CreateTicket",
          },
        ]),
      ),
  };
}

test("the evidence reads answer a member and conceal a project it may not see", async () => {
  const service = retiredTicketApp("Fresh");
  await using app = adoptedTicketRouteApp({
    ...service,
    reads: evidenceReads("atlas"),
  });
  const get = (path: string) =>
    app.inject({
      method: "GET",
      url: path,
      headers: { authorization: "Bearer valid" },
    });
  const root = "/api/v1/tenants/acme/projects/atlas/ticket-machine";
  const admitted = await get(root);
  assert.equal(admitted.statusCode, 200, admitted.body);
  assert.deepEqual(admitted.json(), { admitted: true });
  const executions = await get(`${root}/executions`);
  assert.equal(executions.statusCode, 200, executions.body);
  assert.deepEqual(executions.json<{ executions: unknown[] }>().executions, [
    {
      taskKey: "work:1:1",
      state: "Terminal",
      attempt: 2,
      attemptsUnreported: 0,
      queuedAt: "2026-09-19T00:00:00.000Z",
    },
  ]);
  const operations = await get(`${root}/operations/recent`);
  assert.equal(operations.statusCode, 200, operations.body);
  assert.equal(
    operations.json<{ operations: unknown[] }>().operations.length,
    1,
  );
  const turns = await get(`${root}/executions/work%3A1%3A1/attempts/2/turns`);
  assert.equal(turns.statusCode, 200, turns.body);
  const missing = await get(`${root}/executions/work%3A9%3A9`);
  assert.equal(missing.statusCode, 404, missing.body);
  const configuration = await get(
    `${root}/executions/work%3A1%3A1/attempts/2/configuration`,
  );
  assert.equal(configuration.statusCode, 404, configuration.body);
  const concealed = await app.inject({
    method: "GET",
    url: "/api/v1/tenants/acme/projects/other/ticket-machine",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(concealed.statusCode, 404, concealed.body);
});

test("an executions listing forwards the ticket it was asked about", async () => {
  const asked: (number | undefined)[] = [];
  const reads: TicketExecutionReads = {
    ...evidenceReads("atlas"),
    executions: (_principal, _partition, _limit, ticket) => {
      asked.push(ticket);
      return Promise.resolve({ result: "Authorized", value: [] });
    },
  };
  await using app = adoptedTicketRouteApp({
    ...retiredTicketApp("Fresh"),
    reads,
  });
  const get = (query: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1/tenants/acme/projects/atlas/ticket-machine/executions${query}`,
      headers: { authorization: "Bearer valid" },
    });
  assert.equal((await get("")).statusCode, 200);
  assert.equal((await get("?ticket=7")).statusCode, 200);
  assert.deepEqual(asked, [undefined, 7]);
  assert.equal((await get("?ticket=seven")).statusCode, 400);
  assert.deepEqual(asked, [undefined, 7]);
});

test("a plane composed with no read half serves no evidence route", async () => {
  await using app = adoptedTicketRouteApp(retiredTicketApp("Fresh"));
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/tenants/acme/projects/atlas/ticket-machine/executions",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(response.statusCode, 404, response.body);
});

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
                value: { held, reworkLimit: 3, source: "title: kept\n" },
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
    reworkLimit: 3,
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

test("the ticket list carries each release's limit, and null where none bounds it", async () => {
  const service = retiredTicketApp("Fresh");
  const bounded = new Ticket(released(TicketId(4)), 1, 2, new Pending());
  const unbounded = new Ticket(released(TicketId(5)), 1, 9, new Pending());
  const application: NativeTicketApplication = {
    ...service,
    application: {
      ...service.application,
      graph: () =>
        Promise.resolve({
          result: "Authorized",
          value: {
            graph: new TicketGraph(
              new Map([
                [TicketId(4), bounded],
                [TicketId(5), unbounded],
              ]),
            ),
            reworkLimits: new Map([
              [TicketId(4), 3],
              [TicketId(5), null],
            ]),
          },
        }),
    },
  };
  await using app = adoptedTicketRouteApp(application);
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/tenants/acme/projects/atlas/ticket-machine/tickets",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(response.statusCode, 200, response.body);
  const read = adoptedTicketsSchema.parse(response.json());
  assert.deepEqual(
    read.tickets.map((held) => [held.ticket, held.reworkLimit]),
    [
      [4, 3],
      [5, null],
    ],
  );
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
            findings: [
              { path: "", message: "catalog document must be a mapping" },
            ],
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
    findings: [{ path: "", message: "catalog document must be a mapping" }],
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

const workerPoolTokenPath =
  "/api/v1/tenants/acme/projects/atlas/worker-pool-registration-tokens";
const workerPoolRedemptionPath = "/api/v1/worker-pool-registrations";
const versionedJson = { "content-type": "application/vnd.chuggy.v1+json" };

test("an owner mints a registration token and a project they may not administer is not found", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const minted = await app.inject({
    method: "POST",
    url: workerPoolTokenPath,
    headers: { authorization: "Bearer valid", ...versionedJson },
    payload: JSON.stringify({
      capabilities: ["linux-containers"],
      lifetimeSecs: 900,
    }),
  });
  assert.equal(minted.statusCode, 201);
  assert.deepEqual(minted.json(), {
    token: "a-token",
    expiresAtMs: 1_757_500_000_000,
  });
  const absent = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/acme/projects/other/worker-pool-registration-tokens",
    headers: { authorization: "Bearer valid", ...versionedJson },
    payload: JSON.stringify({ capabilities: [], lifetimeSecs: 900 }),
  });
  assert.equal(absent.statusCode, 404);
  assert.deepEqual(calls, [
    "worker-pool-token:atlas:linux-containers:900",
    "worker-pool-token:other::900",
  ]);
});

test("minting a registration token needs a bearer, and redeeming one needs none", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const unauthenticated = await app.inject({
    method: "POST",
    url: workerPoolTokenPath,
    headers: versionedJson,
    payload: JSON.stringify({ capabilities: [], lifetimeSecs: 60 }),
  });
  assert.equal(unauthenticated.statusCode, 401);
  const redeemed = await app.inject({
    method: "POST",
    url: workerPoolRedemptionPath,
    headers: versionedJson,
    payload: JSON.stringify({
      token: "a-token",
      pool: "pool-one",
      capabilities: ["linux-containers"],
    }),
  });
  assert.equal(redeemed.statusCode, 201);
  assert.deepEqual(redeemed.json(), {
    clientId: "chuggy-pool-one",
    clientSecret: "a-secret",
  });
  assert.deepEqual(calls, ["worker-pool-redeem:pool-one"]);
});

test("a capability the token does not permit is named, and a spent token is not found", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const redemption = (pool: string) => ({
    method: "POST" as const,
    url: workerPoolRedemptionPath,
    headers: versionedJson,
    payload: JSON.stringify({ token: "a-token", pool, capabilities: [] }),
  });
  const refused = await app.inject(redemption("unpermitted"));
  assert.equal(refused.statusCode, 403);
  assert.equal(
    refused.json<HttpErrorEnvelope>().error.code,
    "CapabilityNotPermitted",
  );
  const spent = await app.inject(redemption("spent"));
  assert.equal(spent.statusCode, 404);
});
