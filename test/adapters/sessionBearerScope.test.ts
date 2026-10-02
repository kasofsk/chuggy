/**
 * A session bearer confined to its own session's partition, driven through the
 * whole app, so what is under test is what a caller is sent rather than the
 * rule beneath it.
 *
 * THE ROUTER IS WALKED, NOT THE SOURCE. Every route the app serves is asked
 * without a bearer, and one answering `401` reads a bearer and so must have a
 * class; then each classified route is asked under a session bearer from
 * elsewhere and must refuse before any port is reached. A route registered
 * without a class fails here, and so does a class left for a route nobody
 * serves.
 *
 * EVERY PORT RECORDS THAT IT WAS REACHED, so a refusal the hook sent is told
 * apart from a `404` some port answered.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { twoBearerAuthentication } from "../../src/adapters/http/sessionBearer.ts";
import {
  sessionBearerAdmission,
  sessionBearerRouteScopes,
} from "../../src/adapters/http/sessionBearerScope.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import { sessionBearerPrefix } from "../../src/contract/sessionPlane.ts";
import { asSessionId } from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { routerServed } from "./routerFixtures.ts";
import { unservedNativeWeb } from "./threadFixtures.ts";

type ServedNativeWeb = Parameters<typeof createNativeHttpApp>[0];

/** The one principal both bearers name, readable in every project these cases ask about. */
const principal = asPrincipal("issuer subject");

/** The partition the session authority answers for the session bearer. */
const own: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

/** Another project of the same tenant, and the same project name under another tenant. */
const elsewhere: readonly Partition[] = [
  { tenant: own.tenant, project: asProjectId("other") },
  { tenant: asTenantId("other"), project: own.project },
];

const sessionToken = `${sessionBearerPrefix}${randomUUID()}${randomUUID()}`;
const oidcToken = "issued";

/** A port no case writes, recording each call and failing it. */
function recorded(reached: string[], port: string): never {
  return new Proxy(
    {},
    {
      get: (_target, method) => () => {
        reached.push(`${port}.${String(method)}`);
        return Promise.reject(new Error(`${port} is not served here`));
      },
    },
  ) as never;
}

/** The app as a deployment composes it, every optional port present so every route is served. */
function scopedApp(reached: string[], web?: ServedNativeWeb) {
  return createNativeHttpApp(
    web ?? recorded(reached, "web"),
    twoBearerAuthentication(
      {
        authenticateBearer: (token) =>
          Promise.resolve(
            token === oidcToken
              ? { authenticated: "Bearer" as const, bearer: { principal } }
              : { authenticated: "InvalidToken" as const },
          ),
      },
      {
        authenticate: (secret) =>
          Promise.resolve(
            secret === sessionToken
              ? {
                  partition: own,
                  session: asSessionId("lead"),
                  kind: "Lead" as const,
                  principal,
                }
              : undefined,
          ),
      },
    ),
    recorded(reached, "readiness"),
    recorded(reached, "installation"),
    undefined,
    recorded(reached, "events"),
    recorded(reached, "selectorSettings"),
    recorded(reached, "forgeCredentials"),
    recorded(reached, "onboarding"),
    recorded(reached, "workerPools"),
    recorded(reached, "creation"),
    recorded(reached, "placement"),
    recorded(reached, "sessionPlacement"),
    recorded(reached, "proposalReviews"),
  );
}

/** One parameter of a route's pattern, filled with a value its handler parses. */
function routeParameter(partition: Partition, name: string): string {
  if (name === "tenant") return partition.tenant;
  if (name === "project") return partition.project;
  return name === "ticket" || name === "ordinal" ? "1" : "x";
}

/** One request to a served `METHOD /pattern`, in `partition`, a write carrying the least a versioned write reads. */
function routeRequest(route: string, partition: Partition, token?: string) {
  const [method = "", pattern = ""] = route.split(" ");
  const writes = method === "POST" || method === "PUT";
  return {
    method: method as "GET" | "POST" | "PUT" | "DELETE",
    url: pattern.replace(/:([A-Za-z]+)/gu, (_whole, name: string) =>
      routeParameter(partition, name),
    ),
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(writes
        ? { "content-type": nativeHttpMediaType, "idempotency-key": "key" }
        : {}),
    },
    ...(writes ? { payload: {} } : {}),
  };
}

/** Whether an answer is the hook's refusal of a route no session may reach. */
function scopeRefused(answered: {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, unknown>>;
  json(): unknown;
}): boolean {
  return (
    answered.statusCode === 403 &&
    answered.headers["www-authenticate"] ===
      'Bearer error="insufficient_scope"' &&
    JSON.stringify(answered.json()).includes('"code":"InsufficientScope"')
  );
}

test("every served route that reads a bearer is classified, and every class is served", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached);
  await app.ready();
  const served = routerServed(app).filter((route) => !route.startsWith("HEAD"));
  for (const route of served) {
    const answered = await app.inject(routeRequest(route, own));
    const classified = sessionBearerRouteScopes.has(route);
    assert.equal(
      answered.statusCode === 401,
      classified,
      classified
        ? `${route} is classified and reads no bearer`
        : `${route} reads a bearer and has no class`,
    );
  }
  for (const route of sessionBearerRouteScopes.keys())
    assert.ok(served.includes(route), `${route} is classified and not served`);
});

test("under a session bearer from elsewhere, every classified route refuses before any port", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached);
  for (const partition of elsewhere)
    for (const [route, scope] of sessionBearerRouteScopes) {
      reached.length = 0;
      const answered = await app.inject(
        routeRequest(route, partition, sessionToken),
      );
      const where = `${route} in ${partition.tenant}/${partition.project}`;
      assert.deepEqual(reached, [], `${where} reached a port`);
      if (scope === "Refused")
        assert.ok(scopeRefused(answered), `${where} was not refused`);
      else {
        assert.equal(answered.statusCode, 404, where);
        assert.deepEqual(answered.json(), {
          error: { code: "NotFound", message: "Resource not found." },
        });
      }
    }
});

test("in its own partition a session bearer passes every partition route and no refused one", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached);
  for (const [route, scope] of sessionBearerRouteScopes) {
    reached.length = 0;
    const answered = await app.inject(routeRequest(route, own, sessionToken));
    if (scope === "Refused") {
      assert.ok(scopeRefused(answered), `${route} was not refused`);
      assert.deepEqual(reached, [], `${route} reached a port`);
    } else
      assert.ok(
        !scopeRefused(answered) &&
          !(answered.statusCode === 404 && reached.length === 0),
        `${route} was refused in its own partition: ${String(answered.statusCode)}`,
      );
  }
});

/** A project read that finds every project but one, recording each partition it was asked for. */
function projectWeb(asked: string[]): ServedNativeWeb {
  return {
    ...unservedNativeWeb,
    project: (_principal, partition) => {
      asked.push(`${partition.tenant}/${partition.project}`);
      return Promise.resolve(
        partition.project === "unreadable"
          ? { result: "NotFound" }
          : {
              result: "Found",
              project: { partition, sequence: 1, tickets: [] },
            },
      );
    },
    projectInventory: (_principal, _after, limit) => {
      asked.push(`inventory:${String(limit)}`);
      return Promise.resolve({ projects: [] });
    },
  };
}

function projectPath(partition: Partition): string {
  return `/api/v1/tenants/${partition.tenant}/projects/${partition.project}`;
}

test("a session bearer reads its own project, and another of its principal's answers as one it cannot read", async () => {
  const asked: string[] = [];
  await using app = scopedApp([], projectWeb(asked));
  const read = (partition: Partition, token: string) =>
    app.inject({
      url: projectPath(partition),
      headers: { authorization: `Bearer ${token}` },
    });
  const ownRead = await read(own, sessionToken);
  assert.equal(ownRead.statusCode, 200);
  assert.deepEqual(asked, ["acme/atlas"]);
  const [other = own] = elsewhere;
  const confined = await read(other, sessionToken);
  assert.deepEqual(asked, ["acme/atlas"]);
  const unreadable = await read(
    { tenant: own.tenant, project: asProjectId("unreadable") },
    oidcToken,
  );
  assert.equal(confined.statusCode, unreadable.statusCode);
  assert.equal(confined.body, unreadable.body);
  assert.equal(
    confined.headers["content-type"],
    unreadable.headers["content-type"],
  );
});

test("an OIDC bearer for the same principal reads every project it may and lists them", async () => {
  const asked: string[] = [];
  await using app = scopedApp([], projectWeb(asked));
  for (const partition of elsewhere) {
    const read = await app.inject({
      url: projectPath(partition),
      headers: { authorization: `Bearer ${oidcToken}` },
    });
    assert.equal(read.statusCode, 200);
  }
  const listed = await app.inject({
    url: nativeHttpRoutes.projects,
    headers: { authorization: `Bearer ${oidcToken}` },
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(asked, ["acme/other", "other/atlas", "inventory:50"]);
});

test("a session bearer is refused a route addressed to no partition, and one that enrols a machine in its own", async () => {
  const reached: string[] = [];
  const asked: string[] = [];
  await using app = scopedApp(reached, projectWeb(asked));
  for (const request of [
    { method: "GET" as const, url: nativeHttpRoutes.projects },
    { method: "GET" as const, url: "/api/v1/tenants/acme/forge-installations" },
    {
      method: "POST" as const,
      url: `${projectPath(own)}/worker-pool-registration-tokens`,
      headers: { "content-type": nativeHttpMediaType },
      payload: { capabilities: ["linux-containers"], lifetimeSecs: 900 },
    },
  ]) {
    const answered = await app.inject({
      ...request,
      headers: {
        ...("headers" in request ? request.headers : {}),
        authorization: `Bearer ${sessionToken}`,
      },
    });
    assert.ok(scopeRefused(answered), request.url);
  }
  assert.deepEqual(reached, []);
  assert.deepEqual(asked, []);
});

test("a session bearer reads its own project's held proposals and may not answer one", async () => {
  const reached: string[] = [];
  await using app = scopedApp(reached);
  const answered = await app.inject({
    method: "POST",
    url: `${projectPath(own)}/selector-proposals/decision/review`,
    headers: {
      authorization: `Bearer ${sessionToken}`,
      "content-type": nativeHttpMediaType,
    },
    payload: { outcome: "Approved" },
  });
  assert.ok(scopeRefused(answered));
  assert.deepEqual(reached, []);
  await app.inject({
    url: `${projectPath(own)}/selector-proposals`,
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  assert.deepEqual(reached, ["proposalReviews.pending"]);
});

test("the admission reads the matched route, folds HEAD into GET and refuses what it cannot place", () => {
  const params = { tenant: own.tenant, project: own.project };
  assert.equal(
    sessionBearerAdmission(own, "HEAD", nativeHttpRoutes.project, params),
    "Admitted",
  );
  assert.equal(
    sessionBearerAdmission(own, "GET", undefined, params),
    "Refused",
  );
  assert.equal(
    sessionBearerAdmission(own, "PATCH", nativeHttpRoutes.project, params),
    "Refused",
  );
  assert.equal(
    sessionBearerAdmission(own, "GET", nativeHttpRoutes.project, {
      tenant: own.tenant,
    }),
    "Refused",
  );
  assert.equal(
    sessionBearerAdmission(own, "GET", nativeHttpRoutes.project, {
      ...params,
      project: "other",
    }),
    "OtherPartition",
  );
});
