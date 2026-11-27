/**
 * The API asking the agreement plane about a person before their route runs,
 * driven through the whole app against a plane's second listener this suite
 * starts, or a stand-in serving what a plane must not.
 *
 * EVERY ASK IS COUNTED WHERE IT ARRIVES, so a request let through without one
 * is told apart from one let through by the plane's answer.
 */

import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import {
  agreementPlaneStandings,
  agreementStandingBytesMax,
} from "../../src/adapters/agreements/standings.ts";
import { createAgreementPlaneServiceApp } from "../../src/adapters/http/agreementPlaneServer.ts";
import { authorityRetryAfterSeconds } from "../../src/adapters/http/outcomes.ts";
import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { threeBearerAuthentication } from "../../src/adapters/http/sessionBearer.ts";
import { accessTokenPrefix } from "../../src/contract/accessToken.ts";
import {
  agreementPoliciesMax,
  agreementStandingSchema,
  agreementTitleCharsMax,
  agreementUrlCharsMax,
  agreementVersionCharsMax,
  type AgreementPolicyEntry,
} from "../../src/contract/agreementPlane.ts";
import { agreementRequiredCode } from "../../src/contract/rosters.ts";
import type { AgreementStandings } from "../../src/interpreter/agreementStanding.ts";
import {
  asSessionId,
  type SessionBearerIdentity,
} from "../../src/interpreter/agentSession.ts";
import { agreementPlane } from "../../src/interpreter/agreementPlane.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  agreementFixtureEntry,
  agreementFixtureIssuer,
  agreementFixturePrincipal,
  agreementMemory,
} from "../interpreter/agreementPlaneFixture.ts";
import { recordedPort, recordedPorts } from "./recordedPortsFixture.ts";

const person = agreementFixturePrincipal("alice");
const own: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

const issuerToken = "issuer-token";
const sessionToken = `chgs_${"a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d".repeat(2)}`;
const accessToken = `${accessTokenPrefix}${"k".repeat(43)}`;

const sessionIdentity: SessionBearerIdentity = {
  partition: own,
  session: asSessionId("session"),
  kind: "Thread",
  principal: person,
  scope: "Project",
  capabilities: ["ProjectRead"],
};

/** The three bearers, each answered as `person`. */
const authentication = threeBearerAuthentication(
  {
    authenticateBearer: (token) =>
      Promise.resolve(
        token === issuerToken
          ? { authenticated: "Bearer", bearer: { principal: person } }
          : { authenticated: "InvalidToken" },
      ),
  },
  {
    authenticate: (secret) =>
      Promise.resolve(secret === sessionToken ? sessionIdentity : undefined),
  },
  {
    authenticate: (secret) =>
      Promise.resolve(
        secret === accessToken
          ? {
              partition: own,
              token: "token",
              name: "nightly",
              access: "Read",
              principal: person,
              expiresAt: "2027-02-03T04:05:06.000Z",
            }
          : undefined,
      ),
  },
);

/** A web whose inventory answers an empty page and records it ran, every other port recorded and failing. */
function inventoryWeb(reached: string[]): never {
  const others = recordedPort(reached, "web") as Record<string, unknown>;
  return new Proxy(
    {},
    {
      get: (_target, method) =>
        method === "projectInventory"
          ? () => {
              reached.push("web.projectInventory");
              return Promise.resolve({ projects: [] });
            }
          : others[method as string],
    },
  ) as never;
}

function apiApp(reached: string[], agreements?: AgreementStandings) {
  return createNativeHttpApp(
    inventoryWeb(reached),
    authentication,
    ...recordedPorts(reached, undefined, agreements),
  );
}

async function listening(t: TestContext, server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
}

/** A plane's second listener over a store in memory, its policies `settings.policies` as each ask finds them, counting every ask. */
async function servedPlane(
  t: TestContext,
  policies: readonly AgreementPolicyEntry[],
) {
  const memory = agreementMemory();
  const settings = { issuer: agreementFixtureIssuer, policies: [...policies] };
  const service = createAgreementPlaneServiceApp(
    agreementPlane(memory.store, settings),
  );
  const asked: string[] = [];
  service.addHook("onRequest", (request, _reply, done) => {
    asked.push(request.url);
    done();
  });
  const url = await service.listen({ port: 0, host: "127.0.0.1" });
  t.after(() => service.close());
  return { memory, settings, asked, url };
}

const inventory = (token: string) => ({
  method: "GET" as const,
  url: "/api/v1/projects",
  headers: { authorization: `Bearer ${token}` },
});

const projectRead = (token: string) => ({
  method: "GET" as const,
  url: `/api/v1/tenants/${own.tenant}/projects/${own.project}`,
  headers: { authorization: `Bearer ${token}` },
});

const terms = agreementFixtureEntry("terms", "2026-11");
const privacy = agreementFixtureEntry("privacy", "v3");

test("an API naming no plane answers the issuer's bearer as it does without one and asks nobody", async (t) => {
  const plane = await servedPlane(t, [terms]);
  const reached: string[] = [];
  const answer = await apiApp(reached).inject(inventory(issuerToken));
  assert.equal(answer.statusCode, 200);
  assert.deepEqual(reached, ["web.projectInventory"]);
  assert.deepEqual(plane.asked, []);
});

test("a person with a current policy unagreed is refused AgreementRequired before the route runs, and let through by the next request once every policy is agreed", async (t) => {
  const plane = await servedPlane(t, [terms, privacy]);
  await plane.memory.store.record(person, [terms], {});
  const reached: string[] = [];
  const app = apiApp(
    reached,
    agreementPlaneStandings({ url: plane.url, requestTimeoutMs: 5_000 }),
  );
  const refused = await app.inject(inventory(issuerToken));
  assert.equal(refused.statusCode, 403);
  assert.deepEqual(refused.json(), {
    error: {
      code: agreementRequiredCode,
      message: "This deployment's policies must be agreed to in the console.",
    },
  });
  assert.doesNotMatch(refused.body, /127\.0\.0\.1/u);
  assert.deepEqual(reached, []);
  assert.equal(plane.asked.length, 1);
  await plane.memory.store.record(person, [privacy], {});
  const admitted = await app.inject(inventory(issuerToken));
  assert.equal(admitted.statusCode, 200);
  assert.deepEqual(reached, ["web.projectInventory"]);
  assert.equal(plane.asked.length, 2);
});

test("a standing naming no policy lets the request through", async (t) => {
  const plane = await servedPlane(t, []);
  const reached: string[] = [];
  const answer = await apiApp(
    reached,
    agreementPlaneStandings({ url: plane.url, requestTimeoutMs: 5_000 }),
  ).inject(inventory(issuerToken));
  assert.equal(answer.statusCode, 200);
  assert.deepEqual(reached, ["web.projectInventory"]);
  assert.equal(plane.asked.length, 1);
});

test("a digest re-pinned refuses at the next request a person the previous one let through", async (t) => {
  const plane = await servedPlane(t, [terms]);
  await plane.memory.store.record(person, [terms], {});
  const reached: string[] = [];
  const app = apiApp(
    reached,
    agreementPlaneStandings({ url: plane.url, requestTimeoutMs: 5_000 }),
  );
  assert.equal((await app.inject(inventory(issuerToken))).statusCode, 200);
  plane.settings.policies = [agreementFixtureEntry("terms", "2026-11", "b")];
  const refused = await app.inject(inventory(issuerToken));
  assert.equal(refused.statusCode, 403);
  assert.equal(
    refused.json<{ error: { code: string } }>().error.code,
    agreementRequiredCode,
  );
  assert.deepEqual(reached, ["web.projectInventory"]);
});

test("a session bearer, an access token and a public route are answered as without a plane, and none is asked about", async (t) => {
  const plane = await servedPlane(t, [terms]);
  const agreements = agreementPlaneStandings({
    url: plane.url,
    requestTimeoutMs: 5_000,
  });
  for (const { why, request, runs } of [
    {
      why: "a session bearer",
      request: projectRead(sessionToken),
      runs: ["web.project"],
    },
    {
      why: "an access token",
      request: projectRead(accessToken),
      runs: ["web.project"],
    },
    {
      why: "a public route",
      request: { method: "GET" as const, url: "/health/live" },
      runs: [],
    },
  ]) {
    const without = await apiApp([]).inject(request);
    const reached: string[] = [];
    const answer = await apiApp(reached, agreements).inject(request);
    assert.equal(answer.statusCode, without.statusCode, why);
    assert.equal(answer.body, without.body, why);
    assert.deepEqual(reached, runs, why);
  }
  assert.deepEqual(plane.asked, []);
});

/** A stand-in for the plane answering every ask with `answer`. */
function standIn(answer: (response: ServerResponse) => void): Server {
  return createServer((_request, response) => {
    answer(response);
  });
}

const standing = (body: unknown) => (response: ServerResponse) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

test("a plane that does not answer is a 503 AuthorityUnavailable carrying retry-after, never a refusal and never a pass", async (t) => {
  const closed = createServer();
  const closedUrl = await listening(t, closed);
  closed.close();
  const silent = await listening(
    t,
    standIn(() => {}),
  );
  const status = (code: number) =>
    listening(
      t,
      standIn((response) => {
        response.writeHead(code, { "content-type": "application/json" });
        response.end(JSON.stringify({ policies: [] }));
      }),
    );
  const notStanding = await listening(
    t,
    standIn(standing({ policies: [{ policy: "terms" }] })),
  );
  const tooLarge = await listening(
    t,
    standIn(
      standing({
        policies: [],
        padding: "x".repeat(agreementStandingBytesMax),
      }),
    ),
  );
  const cases = [
    { why: "a closed port", url: closedUrl, timeoutMs: 5_000 },
    { why: "an ask past its time", url: silent, timeoutMs: 50 },
    { why: "a 500", url: await status(500), timeoutMs: 5_000 },
    { why: "a 404", url: await status(404), timeoutMs: 5_000 },
    { why: "a body that is no standing", url: notStanding, timeoutMs: 5_000 },
    { why: "an answer past the byte bound", url: tooLarge, timeoutMs: 5_000 },
  ];
  for (const { why, url, timeoutMs } of cases) {
    const reached: string[] = [];
    const answer = await apiApp(
      reached,
      agreementPlaneStandings({ url, requestTimeoutMs: timeoutMs }),
    ).inject(inventory(issuerToken));
    assert.equal(answer.statusCode, 503, why);
    assert.equal(
      answer.headers["retry-after"],
      String(authorityRetryAfterSeconds),
      why,
    );
    assert.equal(
      answer.json<{ error: { code: string } }>().error.code,
      "AuthorityUnavailable",
      why,
    );
    assert.deepEqual(reached, [], why);
  }
});

test("a standing of the most policies, every text at its widest and escaped, is read whole under the byte bound", async (t) => {
  const widest = Array.from({ length: agreementPoliciesMax }, (_, index) => ({
    policy: `policy-${String(index)}`,
    title: "\u0001".repeat(agreementTitleCharsMax),
    version: "\u0001".repeat(agreementVersionCharsMax),
    url: `https://site.example/${"a".repeat(agreementUrlCharsMax - "https://site.example/".length)}`,
    digest: `sha256:${"a".repeat(64)}`,
    agreedAt: new Date(0).toISOString(),
  }));
  const body = { policies: widest };
  assert.ok(agreementStandingSchema.safeParse(body).success);
  const url = await listening(t, standIn(standing(body)));
  const read = await agreementPlaneStandings({
    url,
    requestTimeoutMs: 5_000,
  }).standing(person);
  assert.equal(read.policies.length, agreementPoliciesMax);
});
