/**
 * The access plane's server over an authority held in memory: a body read as
 * the API's media type, a removal served, every refusal in the API's
 * envelope, and no request reaching a relation the role rosters do not name.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccessPlaneApp } from "../../src/adapters/http/accessPlaneServer.ts";
import type { BearerAuthentication } from "../../src/adapters/http/server.ts";
import {
  accessLastTenantAdministratorCode,
  accessPlanePath,
  accessPlaneRoutes,
  accessProjectPeopleSchema,
  accessProjectRoles,
  accessTenantPeopleSchema,
  accessTenantRoles,
  type AccessPlaneRouteName,
} from "../../src/contract/accessPlane.ts";
import {
  errorEnvelopeSchema,
  nativeHttpMediaType,
} from "../../src/contract/http.ts";
import { classify } from "../../src/contract/outcomes.ts";
import {
  accessProjectRoleRelations,
  accessTenantRoleRelations,
} from "../../src/interpreter/accessPlane.ts";
import { principalCharsMax } from "../../src/interpreter/principal.ts";
import {
  allProjectGrantRelations,
  allTenantGrantRelations,
  projectPrincipalGrant,
  projectTenantGrant,
  projectTenantRelation,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  accessFixtureIssuer,
  accessFixturePartition,
  accessFixturePrincipal,
  accessMemory,
  accessMemoryPlane,
  type AccessMemory,
} from "../interpreter/accessPlaneFixture.ts";

const web = accessFixturePartition("acme/co", "web");
const tenant = web.tenant;

/** The tokens the fake issuer knows, each the subject it names. */
const tokens: Readonly<Record<string, string>> = {
  "alice-token": "alice",
  "priya-token": "priya",
};

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const typed = { "content-type": nativeHttpMediaType };

/** A tenant alice administers with one linked project priya administers. */
async function served(ready = true) {
  const memory = accessMemory();
  for (const grant of [
    projectTenantGrant(web),
    tenantPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "alice",
      tenant,
      relation: "admins",
    }),
    projectPrincipalGrant({
      issuer: accessFixtureIssuer,
      subject: "priya",
      ...web,
      relation: "admins",
    }),
  ])
    await memory.grants.write(grant);
  memory.changes.length = 0;
  const app = createAccessPlaneApp({
    authentication: {
      authenticateBearer: (token): Promise<BearerAuthentication> => {
        const subject = tokens[token];
        return Promise.resolve(
          subject === undefined
            ? { authenticated: "InvalidToken" }
            : {
                authenticated: "Bearer",
                bearer: { principal: accessFixturePrincipal(subject) },
              },
        );
      },
    },
    plane: accessMemoryPlane(memory),
    ready: () => Promise.resolve(ready && !memory.unavailable),
  });
  return { memory, app };
}

/** The path one route is asked at for `web`, its subject and role where it names them. */
function pathOf(name: AccessPlaneRouteName, subject = "zed", role = "Member") {
  return accessPlanePath(name, { ...web, subject, role });
}

/** Asserts a refusal reads as the API's envelope under `classify`, naming `code` where given. */
function enveloped(
  answered: {
    statusCode: number;
    body: string;
    headers: Record<string, unknown>;
  },
  outcome: string,
  code?: string,
): void {
  const body: unknown = JSON.parse(answered.body);
  assert.ok(errorEnvelopeSchema.safeParse(body).success, answered.body);
  const classified = classify(
    answered.statusCode,
    (name) => {
      const value = answered.headers[name];
      return typeof value === "string" ? value : undefined;
    },
    body,
  );
  assert.equal(classified.outcome, outcome, answered.body);
  if (code !== undefined)
    assert.equal("code" in classified ? classified.code : undefined, code);
}

test("a grant sent as the API's media type is read, and a removal is served", async () => {
  const { memory, app } = await served();
  const granted = await app.inject({
    method: "POST",
    url: pathOf("tenantRoleGrant"),
    headers: { ...as("alice-token"), ...typed },
    payload: JSON.stringify({ role: "Member" }),
  });
  assert.equal(granted.statusCode, 204, granted.body);
  const removed = await app.inject({
    method: "DELETE",
    url: pathOf("tenantRoleRemoval"),
    headers: as("alice-token"),
  });
  assert.equal(removed.statusCode, 204, removed.body);
  assert.deepEqual(
    memory.changes.map(([verb, grant]) => [verb, grant.relation]),
    [
      ["write", "members"],
      ["remove", "members"],
    ],
  );
});

test("a list reads as its schema, the caller marked by the server", async () => {
  const { app } = await served();
  const tenantPeople = accessTenantPeopleSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: pathOf("tenantPeople"),
        headers: as("alice-token"),
      })
    ).json(),
  );
  assert.deepEqual(
    tenantPeople.people.map((person) => [person.subject, person.mine]),
    [
      ["alice", true],
      ["priya", false],
    ],
  );
  const projectPeople = accessProjectPeopleSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: pathOf("projectPeople"),
        headers: as("priya-token"),
      })
    ).json(),
  );
  assert.deepEqual(
    projectPeople.people.map((person) => [person.subject, person.mine]),
    [
      ["alice", false],
      ["priya", true],
    ],
  );
});

test("every refusal carries the API's envelope: unauthenticated, absent, rejected and the conflict by its own name", async () => {
  const { app } = await served();
  const missing = await app.inject({
    method: "GET",
    url: pathOf("tenantPeople"),
  });
  enveloped(missing, "Unauthenticated");
  assert.equal(missing.headers["www-authenticate"], "Bearer");
  const forged = await app.inject({
    method: "GET",
    url: pathOf("tenantPeople"),
    headers: as("forged"),
  });
  enveloped(forged, "Unauthenticated");
  enveloped(
    await app.inject({
      method: "GET",
      url: pathOf("tenantPeople"),
      headers: as("priya-token"),
    }),
    "Absent",
  );
  enveloped(
    await app.inject({
      method: "POST",
      url: pathOf("tenantRoleGrant"),
      headers: { ...as("alice-token"), ...typed },
      payload: JSON.stringify({ role: "Owner" }),
    }),
    "Rejected",
    "InvalidRequest",
  );
  enveloped(
    await app.inject({
      method: "POST",
      url: pathOf("tenantRoleGrant"),
      headers: { ...as("alice-token"), ...typed },
      payload: "{",
    }),
    "Rejected",
  );
  enveloped(
    await app.inject({
      method: "DELETE",
      url: pathOf("tenantRoleRemoval", "alice", "Admin"),
      headers: as("alice-token"),
    }),
    "Conflict",
    accessLastTenantAdministratorCode,
  );
  enveloped(
    await app.inject({ method: "GET", url: "/access/v1/nowhere" }),
    "Absent",
  );
});

test("an authority that cannot answer is retryable on every route and unready on readiness", async () => {
  const { memory, app } = await served();
  memory.unavailable = true;
  for (const name of Object.keys(accessPlaneRoutes) as AccessPlaneRouteName[]) {
    const route = accessPlaneRoutes[name];
    const answered = await app.inject({
      method: route.method,
      url: pathOf(name, "zed", "Admin"),
      headers: {
        ...as("alice-token"),
        ...(route.method === "POST" ? typed : {}),
      },
      ...(route.method === "POST"
        ? { payload: JSON.stringify({ role: "Admin" }) }
        : {}),
    });
    enveloped(answered, "Retryable", "AuthorityUnavailable");
    assert.equal(answered.headers["retry-after"], "1", name);
  }
  assert.equal(
    (await app.inject({ method: "GET", url: "/health/ready" })).statusCode,
    503,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/health/live" })).statusCode,
    200,
  );
});

test("a subject in the path is carried whole, granted at the principal's bound and rejected past it", async () => {
  const { memory, app } = await served();
  const grant = (subject: string) =>
    app.inject({
      method: "POST",
      url: pathOf("projectRoleGrant", subject),
      headers: { ...as("priya-token"), ...typed },
      payload: JSON.stringify({ role: "Developer" }),
    });
  assert.equal((await grant("a/b:c?d")).statusCode, 204);
  const [, written] = memory.changes[0] ?? [];
  assert.deepEqual(written?.holder, {
    subject: "Principal",
    principal: accessFixturePrincipal("a/b:c?d"),
  });
  const prefix = `${String(accessFixtureIssuer.length)}:${accessFixtureIssuer}`;
  const widest = "w".repeat(principalCharsMax - prefix.length);
  assert.equal((await grant(widest)).statusCode, 204);
  enveloped(await grant(`${widest}w`), "Rejected", "InvalidRequest");
});

/**
 * Every relation the model declares, spelled as a request could spell it: by
 * its own name, and by every role name, on every grant and removal route.
 */
function accessSpellings(): readonly string[] {
  return [
    ...new Set([
      ...allTenantGrantRelations,
      ...allProjectGrantRelations,
      projectTenantRelation,
      ...accessTenantRoles,
      ...accessProjectRoles,
    ]),
  ];
}

async function accessReached(
  memory: AccessMemory,
  app: Awaited<ReturnType<typeof served>>["app"],
) {
  for (const role of accessSpellings())
    for (const [grant, removal] of [
      ["tenantRoleGrant", "tenantRoleRemoval"],
      ["projectRoleGrant", "projectRoleRemoval"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: pathOf(grant),
        headers: { ...as("alice-token"), ...typed },
        payload: JSON.stringify({ role }),
      });
      await app.inject({
        method: "DELETE",
        url: pathOf(removal, "zed", role),
        headers: as("alice-token"),
      });
    }
  return new Set(
    memory.changes.map(
      ([verb, grant]) => `${verb} ${grant.namespace} ${grant.relation}`,
    ),
  );
}

test("no request reaches a relation but the ones the role rosters name", async () => {
  const { memory, app } = await served();
  const reached = await accessReached(memory, app);
  const expected = new Set(
    (["write", "remove"] as const).flatMap((verb) => [
      ...Object.values(accessTenantRoleRelations).map(
        (relation) => `${verb} Tenant ${relation}`,
      ),
      ...Object.values(accessProjectRoleRelations).map(
        (relation) => `${verb} Project ${relation}`,
      ),
    ]),
  );
  assert.deepEqual(reached, expected);
});
