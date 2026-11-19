/**
 * An access token confined to its own project and its own access, driven
 * through the whole app where a caller's answer is what is under test.
 *
 * THE EXPECTED TABLE IS DERIVED FROM THE SESSION TABLE, so the two cannot
 * drift: a read a session may make of its own project is a token's `Read`,
 * the streams aside, a write a session may make there is its `Write`, and
 * everything else is `Refused`. The writes kept for a person at the keyboard
 * are refused on top of that, and asserted by name.
 *
 * EVERY PORT RECORDS THAT IT WAS REACHED, so a refusal the hook sent is told
 * apart from a `404` some port answered.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  accessTokenAdmission,
  accessTokenMethodClasses,
  accessTokenRouteClasses,
  type AccessTokenMethodClass,
} from "../../src/adapters/http/accessTokenScope.ts";
import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { threeBearerAuthentication } from "../../src/adapters/http/sessionBearer.ts";
import {
  sessionBearerRouteClasses,
  type SessionBearerMethodClass,
} from "../../src/adapters/http/sessionBearerScope.ts";
import {
  accessTokenExpiresHeader,
  accessTokenPrefix,
  type AccessTokenAccess,
} from "../../src/contract/accessToken.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
  type NativeHttpRoute,
} from "../../src/contract/http.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { recordedPort, recordedPorts } from "./recordedPortsFixture.ts";

const principal = asPrincipal("token maker");

const own: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};

/** Another project of the same tenant, and the same project name under another tenant. */
const elsewhere: readonly Partition[] = [
  { tenant: own.tenant, project: asProjectId("other") },
  { tenant: asTenantId("other"), project: own.project },
];

const secret = `${accessTokenPrefix}${"k".repeat(43)}`;
const expiresAt = "2027-02-03T04:05:06.000Z";

/** The writes a token never makes, whatever its access. */
const keptForAPerson = [
  "POST ticketProposalMerge",
  "PUT selectorSettings",
  "PUT sessionPlacement",
] as const;

/** The two streams, which would outlive a deletion of the token. */
const streams: ReadonlySet<NativeHttpRoute> = new Set(["events", "threadLive"]);

/** What the session table says a token's class of one method is. */
function derivedClass(
  route: NativeHttpRoute,
  method: string,
  session: SessionBearerMethodClass,
): AccessTokenMethodClass {
  if (session === "Refused" || session.scope === "Member") return "Refused";
  if (keptForAPerson.some((kept) => kept === `${method} ${route}`))
    return "Refused";
  if (method === "GET") return streams.has(route) ? "Refused" : "Read";
  return "Write";
}

test("each route's class is the session table's, narrowed to a project and its access", () => {
  for (const [name, classed] of Object.entries(sessionBearerRouteClasses)) {
    const route = name as NativeHttpRoute;
    const token = accessTokenRouteClasses[route];
    if (classed === "Public") {
      assert.equal(token, "Public", route);
      continue;
    }
    assert.notEqual(token, "Public", route);
    const sessionMethods = classed as Readonly<
      Record<string, SessionBearerMethodClass>
    >;
    const tokenMethods = token as Readonly<
      Record<string, AccessTokenMethodClass>
    >;
    assert.deepEqual(
      Object.keys(tokenMethods).sort(),
      Object.keys(sessionMethods).sort(),
      route,
    );
    for (const [method, session] of Object.entries(sessionMethods))
      assert.equal(
        tokenMethods[method],
        derivedClass(route, method, session),
        `${method} ${route}`,
      );
  }
});

test("the writes kept for a person, the streams, the project's own tokens and every route of no project are refused", () => {
  const classOf = (method: string, route: NativeHttpRoute) =>
    accessTokenMethodClasses.get(`${method} ${nativeHttpRoutes[route]}`);
  for (const kept of keptForAPerson) {
    const [method = "", route = ""] = kept.split(" ");
    assert.equal(classOf(method, route as NativeHttpRoute), "Refused", kept);
  }
  for (const route of streams) assert.equal(classOf("GET", route), "Refused");
  assert.equal(classOf("GET", "accessTokens"), "Refused");
  assert.equal(classOf("POST", "accessTokens"), "Refused");
  assert.equal(classOf("DELETE", "accessToken"), "Refused");
  assert.equal(classOf("POST", "operations"), "Write");
  for (const [route, admitted] of accessTokenMethodClasses)
    if (!route.includes("/:project")) assert.equal(admitted, "Refused", route);
});

test("a path or method no entry names is refused", () => {
  const token = { partition: own, access: "Write" as const };
  const params = { tenant: own.tenant, project: own.project };
  assert.equal(
    accessTokenAdmission(token, "GET", undefined, params),
    "Refused",
  );
  assert.equal(
    accessTokenAdmission(
      token,
      "GET",
      "/api/v1/tenants/:tenant/projects/:project/nowhere",
      params,
    ),
    "Refused",
  );
  assert.equal(
    accessTokenAdmission(token, "PATCH", nativeHttpRoutes.project, params),
    "Refused",
  );
  assert.equal(
    accessTokenAdmission(token, "HEAD", nativeHttpRoutes.project, params),
    "Admitted",
  );
});

/** The app as a deployment composes it, every optional port present, answering `secret` as a token of `access`. */
function tokenApp(reached: string[], access: AccessTokenAccess) {
  return createNativeHttpApp(
    recordedPort(reached, "web"),
    threeBearerAuthentication(
      {
        authenticateBearer: () =>
          Promise.resolve({ authenticated: "InvalidToken" as const }),
      },
      { authenticate: () => Promise.resolve(undefined) },
      {
        authenticate: (presented) =>
          Promise.resolve(
            presented === secret
              ? {
                  partition: own,
                  token: "token",
                  name: "nightly",
                  access,
                  principal,
                  expiresAt,
                }
              : undefined,
          ),
      },
    ),
    ...recordedPorts(reached),
  );
}

/** One request to a served `METHOD /pattern` in `partition` under the token, a write carrying the least a versioned write reads. */
function routeRequest(route: string, partition: Partition) {
  const [method = "", pattern = ""] = route.split(" ");
  const writes = method === "POST" || method === "PUT";
  return {
    method: method as "GET" | "HEAD" | "POST" | "PUT" | "DELETE",
    url: pattern.replace(/:([A-Za-z]+)/gu, (_whole, name: string) => {
      if (name === "tenant") return partition.tenant;
      if (name === "project") return partition.project;
      return name === "ticket" || name === "ordinal" ? "1" : "x";
    }),
    headers: {
      authorization: `Bearer ${secret}`,
      ...(writes
        ? { "content-type": nativeHttpMediaType, "idempotency-key": "key" }
        : {}),
    },
    ...(writes ? { payload: {} } : {}),
  };
}

interface Answered {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, unknown>>;
  json(): unknown;
}

/** Whether an answer is the hook's `insufficient_scope` refusal saying `message`. */
function scopeRefused(answered: Answered, message: string): boolean {
  return (
    answered.statusCode === 403 &&
    answered.headers["www-authenticate"] ===
      'Bearer error="insufficient_scope"' &&
    JSON.stringify(answered.json()) ===
      JSON.stringify({ error: { code: "InsufficientScope", message } })
  );
}

const refusedRoute = "An access token is not admitted to this route.";
const readOnly = "This access token may only read.";

test("in its own project a token passes what its access admits, and is refused the rest before any port", async () => {
  for (const access of ["Read", "Write"] as const) {
    const reached: string[] = [];
    await using app = tokenApp(reached, access);
    for (const [route, admitted] of accessTokenMethodClasses) {
      reached.length = 0;
      const answered = await app.inject(routeRequest(route, own));
      const where = `${route} under ${access}`;
      assert.equal(
        answered.headers[accessTokenExpiresHeader],
        expiresAt,
        `${where} named no expiry`,
      );
      if (admitted === "Refused") {
        assert.ok(scopeRefused(answered, refusedRoute), `${where} passed`);
        assert.deepEqual(reached, [], `${where} reached a port`);
      } else if (admitted === "Write" && access === "Read") {
        assert.ok(scopeRefused(answered, readOnly), `${where} passed`);
        assert.deepEqual(reached, [], `${where} reached a port`);
      } else
        assert.ok(
          answered.statusCode !== 403 &&
            !(answered.statusCode === 404 && reached.length === 0),
          `${where} was refused: ${String(answered.statusCode)}`,
        );
    }
  }
});

test("in another project every admitted route is not found, before any port", async () => {
  const reached: string[] = [];
  await using app = tokenApp(reached, "Write");
  for (const partition of elsewhere)
    for (const [route, admitted] of accessTokenMethodClasses) {
      if (admitted === "Refused") continue;
      reached.length = 0;
      const answered = await app.inject(routeRequest(route, partition));
      const where = `${route} in ${partition.tenant}/${partition.project}`;
      assert.equal(answered.statusCode, 404, where);
      assert.deepEqual(answered.json(), {
        error: { code: "NotFound", message: "Resource not found." },
      });
      assert.deepEqual(reached, [], `${where} reached a port`);
      assert.equal(answered.headers[accessTokenExpiresHeader], expiresAt);
    }
});

test("HEAD is answered as GET is: admitted on a read and refused on a stream", async () => {
  const reached: string[] = [];
  await using app = tokenApp(reached, "Read");
  const read = await app.inject(
    routeRequest(`HEAD ${nativeHttpRoutes.abilities}`, own),
  );
  assert.notEqual(read.statusCode, 403);
  assert.deepEqual(reached, ["web.abilities"]);
  reached.length = 0;
  const stream = await app.inject(
    routeRequest(`HEAD ${nativeHttpRoutes.events}`, own),
  );
  assert.equal(stream.statusCode, 403);
  assert.deepEqual(reached, []);
});

test("a path the router serves without an entry here is refused", async () => {
  const reached: string[] = [];
  await using app = tokenApp(reached, "Write");
  const answered = await app.inject(
    routeRequest("GET /api/v1/tenants/:tenant/projects/:project/nowhere", own),
  );
  assert.ok(scopeRefused(answered, refusedRoute));
  assert.deepEqual(reached, []);
});
