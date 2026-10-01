/**
 * The creation route, driven through the service over an in-memory door and
 * grant writer, so each status is the one the route answers for what the
 * service decided rather than for what a stub said.
 */

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import {
  nativeHttpMediaType,
  type HttpErrorEnvelope,
} from "../../src/contract/http.ts";
import { tenantNameReserved } from "../../src/contract/requests.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
import { ProjectAccessUnavailable } from "../../src/interpreter/projectAccess.ts";
import {
  projectCreation,
  type ProjectCreationAnswer,
  type ProjectCreationWrite,
} from "../../src/interpreter/projectCreation.ts";
import type { ProjectGrant } from "../../src/interpreter/projectGrant.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

const route = "/api/v1/projects";
const authorized = { authorization: "Bearer valid" };
const versioned = { ...authorized, "content-type": nativeHttpMediaType };
const keyed = { ...versioned, "idempotency-key": "create-chuggy-1" };
const body = { tenant: "vteng", project: "chuggy" };

const createdAnswer: ProjectCreationAnswer = {
  outcome: "Created",
  tenantCreated: true,
  grantsWritten: false,
  operation: asOperationId("create-chuggy-1"),
};

interface CreationCase {
  readonly app: ReturnType<typeof servedNativeHttpApp>;
  readonly writes: ProjectCreationWrite[];
  readonly grants: ProjectGrant[];
  readonly access: ReturnType<typeof memoryProjectAccess>;
}

function creationCase(
  t: TestContext,
  answer: ProjectCreationAnswer = createdAnswer,
  options: {
    readonly configured?: boolean;
    readonly grantFails?: boolean;
  } = {},
): CreationCase {
  const access = memoryProjectAccess();
  const writes: ProjectCreationWrite[] = [];
  const grants: ProjectGrant[] = [];
  const app = servedNativeHttpApp(
    unservedNativeWeb,
    undefined,
    projectCreation({
      access,
      claims: { claimed: () => Promise.resolve(false) },
      store: {
        create: (write) => {
          writes.push(write);
          return Promise.resolve(answer);
        },
        recordGrants: () => Promise.resolve(),
      },
      ...(options.configured === false
        ? {}
        : {
            grants: {
              write: (grant) => {
                if (options.grantFails === true)
                  return Promise.reject(
                    new ProjectAccessUnavailable("the write port refused"),
                  );
                grants.push(grant);
                return Promise.resolve();
              },
              remove: () => Promise.reject(new Error("never removed")),
            },
          }),
    }),
  );
  t.after(() => app.close());
  return { app, writes, grants, access };
}

function created(
  one: CreationCase,
  payload: Readonly<Record<string, string>> = body,
) {
  return one.app.inject({
    method: "POST",
    url: route,
    headers: keyed,
    payload,
  });
}

function code(served: { json: () => unknown }): string {
  return (served.json() as HttpErrorEnvelope).error.code;
}

test("a project is created at its own address, under the identity the caller keyed it with", async (t) => {
  const one = creationCase(t);
  const served = await created(one);
  assert.equal(served.statusCode, 201);
  assert.equal(
    served.headers.location,
    "/api/v1/tenants/vteng/projects/chuggy",
  );
  assert.deepEqual(served.json(), body);
  assert.equal(one.writes[0]?.operation, "create-chuggy-1");
  assert.equal(one.grants.length, 2);
});

test("a replay answers the project it already created", async (t) => {
  const served = await created(
    creationCase(t, { ...createdAnswer, outcome: "AlreadyCreated" }),
  );
  assert.equal(served.statusCode, 200);
  assert.deepEqual(served.json(), body);
});

test("each refusal the door answers reaches the wire as its own conflict", async (t) => {
  for (const outcome of [
    "ProjectExists",
    "TenantTaken",
    "OperationConflict",
  ] as const) {
    const one = creationCase(t, {
      ...createdAnswer,
      outcome,
      tenantCreated: false,
    });
    const served = await created(one);
    assert.equal(served.statusCode, 409, outcome);
    assert.equal(code(served), outcome);
    assert.deepEqual(one.grants, [], outcome);
  }
});

test("a name the rule refuses is the request's own fault and names its field", async (t) => {
  for (const [payload, expected] of [
    [{ tenant: "Vteng", project: "chuggy" }, "TenantNameInvalid"],
    [{ tenant: "vteng", project: "chuggy-" }, "ProjectNameInvalid"],
  ] as const) {
    const one = creationCase(t);
    const served = await created(one, payload);
    assert.equal(served.statusCode, 422, expected);
    assert.equal(code(served), expected);
    assert.deepEqual(one.writes, [], expected);
  }
});

test("a new tenant named for a path the service answers is the request's own fault", async (t) => {
  const one = creationCase(t, {
    ...createdAnswer,
    outcome: "TenantReserved",
    tenantCreated: false,
  });
  const served = await created(one, { tenant: "projects", project: "chuggy" });
  assert.equal(served.statusCode, 422);
  assert.equal(code(served), "TenantNameReserved");
  assert.equal(one.writes[0]?.reserved, true);
  assert.deepEqual(one.grants, []);
});

test("every path the API answers begins with a name no new tenant may take", async (t) => {
  const unreached = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("listing the routes reaches no port");
      },
    },
  ) as never;
  const app = createNativeHttpApp(
    unservedNativeWeb,
    unreached,
    unreached,
    unreached,
    undefined,
    unreached,
    unreached,
    unreached,
    unreached,
    unreached,
    unreached,
  );
  t.after(() => app.close());
  await app.ready();
  const segments = app
    .printRoutes({ commonPrefix: false })
    .split("\n")
    .flatMap((line) => /^[├└]── \/([^/ ]+)/u.exec(line)?.[1] ?? []);
  assert.ok(segments.includes("api"), segments.join(", "));
  for (const segment of segments)
    assert.ok(tenantNameReserved(segment), segment);
});

test("a deployment naming no authority to write to answers that it creates nothing", async (t) => {
  const one = creationCase(t, undefined, { configured: false });
  const served = await created(one);
  assert.equal(served.statusCode, 404);
  assert.equal(code(served), "ProjectCreationNotConfigured");
  assert.deepEqual(one.writes, []);
});

test("an authority that cannot answer, before the door or after it, is a wait", async (t) => {
  const unasked = creationCase(t);
  unasked.access.breaks();
  const unwritten = creationCase(t, undefined, { grantFails: true });
  for (const one of [unasked, unwritten]) {
    const served = await created(one);
    assert.equal(served.statusCode, 503);
    assert.equal(code(served), "AuthorityUnavailable");
    assert.ok(served.headers["retry-after"] !== undefined);
  }
});

test("a creation naming no operation identity is refused before the door", async (t) => {
  const one = creationCase(t);
  const served = await one.app.inject({
    method: "POST",
    url: route,
    headers: versioned,
    payload: body,
  });
  assert.equal(served.statusCode, 400);
  assert.deepEqual(one.writes, []);
});

test("a body the creation schema does not name is refused before the door", async (t) => {
  const one = creationCase(t);
  for (const payload of [
    { tenant: "vteng" },
    { ...body, owner: "alice" },
    { tenant: "", project: "chuggy" },
  ]) {
    const served = await created(one, payload);
    assert.equal(served.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual(one.writes, []);
});

test("a creation sent as plain json or without a bearer is refused before the door", async (t) => {
  const one = creationCase(t);
  const plain = await one.app.inject({
    method: "POST",
    url: route,
    headers: {
      ...authorized,
      "content-type": "application/json",
      "idempotency-key": "k",
    },
    payload: body,
  });
  assert.equal(plain.statusCode, 415);
  const anonymous = await one.app.inject({
    method: "POST",
    url: route,
    headers: {
      "content-type": nativeHttpMediaType,
      "idempotency-key": "k",
    },
    payload: body,
  });
  assert.equal(anonymous.statusCode, 401);
  assert.deepEqual(one.writes, []);
});
