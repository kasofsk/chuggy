import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { HttpErrorEnvelope } from "../../src/adapters/http/contract.ts";
import {
  createNativeHttpApp,
  type NativeHttpLimits,
} from "../../src/adapters/http/server.ts";
import {
  asPrincipal,
  asPublicInstant,
  type NativeWeb,
} from "../../src/interpreter/nativeWeb.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";

type ServedNativeWeb = Pick<
  NativeWeb,
  | "cancel"
  | "configuration"
  | "createConfiguration"
  | "createDraft"
  | "deleteDraft"
  | "dispatchView"
  | "draft"
  | "executionContext"
  | "notifications"
  | "operation"
  | "project"
  | "projectInventory"
  | "reviseDraft"
  | "submit"
>;

/** The authoring half of the fake, which every case reaches through `fakeWeb`. */
function fakeWebAuthoring(
  calls: string[],
): Pick<
  ServedNativeWeb,
  | "configuration"
  | "createConfiguration"
  | "createDraft"
  | "deleteDraft"
  | "draft"
  | "reviseDraft"
> {
  return {
    configuration: (_principal, _partition, revision) => {
      calls.push(`configuration:${revision}`);
      return Promise.resolve(undefined);
    },
    createConfiguration: (_principal, input) => {
      calls.push(`createConfiguration:${input.revision}`);
      return Promise.resolve({ result: "NotFound" });
    },
    createDraft: () => {
      calls.push("createDraft");
      return Promise.resolve({ result: "NotFound" });
    },
    deleteDraft: (_principal, input) => {
      calls.push(`deleteDraft:${String(input.expectedVersion)}`);
      return Promise.resolve({ result: "NotFound" });
    },
    draft: (_principal, _partition, ticket) => {
      calls.push(`draft:${String(ticket)}`);
      return Promise.resolve(undefined);
    },
    reviseDraft: (_principal, input) => {
      calls.push(`reviseDraft:${String(input.expectedVersion)}`);
      return Promise.resolve({ result: "NotFound" });
    },
  };
}

function fakeWeb(calls: string[]): ServedNativeWeb {
  return {
    ...fakeWebAuthoring(calls),
    cancel: (_principal, _partition, operation) => {
      calls.push(`cancel:${operation}`);
      return Promise.resolve({ result: "NotFound" });
    },
    dispatchView: (_principal, _partition, query) => {
      calls.push(`dispatchView:${String(query.limit)}`);
      return Promise.resolve({ result: "NotFound" });
    },
    executionContext: (_principal, partition) => {
      calls.push(`executionContext:${partition.project}`);
      return Promise.resolve({ result: "NotFound" });
    },
    notifications: (_principal, _partition, cursor) => {
      calls.push(
        `notifications:${String(cursor.after)}:${String(cursor.limit)}`,
      );
      return Promise.resolve({
        result: "Authorized",
        value: { result: "Events", cursor: cursor.after, events: [] },
      });
    },
    operation: (_principal, _partition, operation) => {
      calls.push(`operation:${operation}`);
      return Promise.resolve({
        operation,
        acceptedAt: asPublicInstant("2026-01-01T00:00:00Z"),
        state: "Pending",
      });
    },
    project: (_principal, _partition, query) => {
      calls.push(`project:${String(query.limit)}`);
      return Promise.resolve({ result: "NotFound" });
    },
    projectInventory: (_principal, _after, limit) => {
      calls.push(`inventory:${String(limit)}`);
      return Promise.resolve({ projects: [] });
    },
    submit: (_principal, submission) => {
      calls.push(`submit:${submission.command.command}`);
      return Promise.resolve({
        result: "Authorized",
        acceptance: { accepted: "InvalidCommand" },
      });
    },
  };
}

function appOf(
  calls: string[],
  authenticated = true,
  limits?: NativeHttpLimits,
) {
  return createNativeHttpApp(
    fakeWeb(calls),
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          authenticated && token === "valid"
            ? asPrincipal("issuer\u0000subject")
            : undefined,
        ),
    },
    { ready: () => Promise.resolve(true) },
    limits,
  );
}

test("authentication failure never reaches NativeWeb", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({ method: "GET", url: "/api/v1/projects" });
  assert.equal(found.statusCode, 401);
  assert.equal(found.headers["www-authenticate"], "Bearer");
  assert.equal(found.headers["cache-control"], "no-store");
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

test("valid submission reaches only the NativeWeb submission method", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/tenant/projects/project/operations",
    headers: {
      authorization: "Bearer valid",
      "idempotency-key": "key",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    body: {
      operation: "operation",
      mutation: { mutation: "ResumeTicket", ticket: 1 },
    },
  });
  assert.equal(found.statusCode, 422);
  assert.deepEqual(calls, ["submit:Decide"]);
});

test("malformed mutation is rejected before NativeWeb", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/tenant/projects/project/operations",
    headers: {
      authorization: "Bearer valid",
      "idempotency-key": "key",
      "content-type": "application/vnd.chuggy.v1+json",
    },
    body: {
      operation: asOperationId("operation"),
      mutation: { mutation: "TaskDone", ticket: 1 },
    },
  });
  assert.equal(found.statusCode, 400);
  assert.deepEqual(calls, []);
});

test("mutation submission requires the versioned request media type", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/tenant/projects/project/operations",
    headers: {
      authorization: "Bearer valid",
      "idempotency-key": "key",
      "content-type": "application/json",
    },
    body: {
      operation: "operation",
      mutation: { mutation: "ResumeTicket", ticket: 1 },
    },
  });
  assert.equal(found.statusCode, 415);
  assert.deepEqual(calls, []);
});

test("polling queries apply defaults and reject noncanonical integers", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const root = "/api/v1/tenants/tenant/projects/project/notifications";
  assert.equal(
    (
      await app.inject({
        url: root,
        headers: { authorization: "Bearer valid" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: `${root}?after=01`,
        headers: { authorization: "Bearer valid" },
      })
    ).statusCode,
    400,
  );
  assert.deepEqual(calls, ["notifications:0:50"]);
});

test("unknown query fields and oversized bodies fail before NativeWeb", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const headers = { authorization: "Bearer valid" };
  assert.equal(
    (await app.inject({ url: "/api/v1/projects?offset=1", headers }))
      .statusCode,
    400,
  );
  const found = await app.inject({
    method: "POST",
    url: "/api/v1/tenants/tenant/projects/project/operations",
    headers: {
      ...headers,
      "content-type": "application/vnd.chuggy.v1+json",
    },
    payload: JSON.stringify({ padding: "x".repeat(70_000) }),
  });
  assert.equal(found.statusCode, 413);
  assert.deepEqual(calls, []);
});

const publicAuthoring = {
  dependencies: [],
  program: [{ fanout: 1, combinator: "UnanimousPass" }],
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 1 },
  finalizationPricing: { type: "Budgeted", value: 1 },
  resumePricing: "RetryCharged",
  finalizer: "ManagedFinalizer",
};

test("authoring and dispatch routes remain thin NativeWeb adapters", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const project = "/api/v1/tenants/tenant/projects/project";
  const headers = {
    authorization: "Bearer valid",
    "content-type": "application/vnd.chuggy.v1+json",
  };
  await app.inject({
    method: "POST",
    url: `${project}/configurations`,
    headers,
    body: {
      revision: "revision",
      canonical: '{"image":"worker:v1","version":1}',
    },
  });
  await app.inject({
    url: `${project}/configurations/revision`,
    headers: { authorization: "Bearer valid" },
  });
  await app.inject({
    method: "POST",
    url: `${project}/drafts`,
    headers,
    body: { configurationRevision: "revision", authoring: publicAuthoring },
  });
  await app.inject({
    method: "PUT",
    url: `${project}/drafts/1`,
    headers,
    body: {
      expectedVersion: 2,
      configurationRevision: "revision",
      authoring: publicAuthoring,
    },
  });
  await app.inject({
    method: "DELETE",
    url: `${project}/drafts/1?expectedVersion=3`,
    headers: { authorization: "Bearer valid" },
  });
  await app.inject({
    url: `${project}/dispatch-view?limit=4`,
    headers: { authorization: "Bearer valid" },
  });
  assert.deepEqual(calls, [
    "createConfiguration:revision",
    "configuration:revision",
    "createDraft",
    "reviseDraft:2",
    "deleteDraft:3",
    "dispatchView:4",
  ]);
});

test("the execution context route takes no query and reaches the boundary once", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const url = "/api/v1/tenants/tenant/projects/project/execution-context";
  const authorization = { authorization: "Bearer valid" };
  const found = await app.inject({ url, headers: authorization });
  assert.equal(found.statusCode, 404);
  assert.equal(found.headers["cache-control"], "no-store");
  const contentType = found.headers["content-type"];
  assert.ok(
    typeof contentType === "string" &&
      contentType.startsWith("application/vnd.chuggy.v1+json"),
  );
  assert.deepEqual(calls, ["executionContext:project"]);
  assert.equal(
    (await app.inject({ url: `${url}?limit=1`, headers: authorization }))
      .statusCode,
    400,
  );
  assert.equal((await app.inject({ url })).statusCode, 401);
  assert.deepEqual(calls, ["executionContext:project"]);
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

test("a failing NativeWeb call is a server fault, not a client fault", async () => {
  const calls: string[] = [];
  const failing = {
    ...fakeWeb(calls),
    projectInventory: () =>
      Promise.reject(new Error("the pool is unreachable")),
  };
  await using app = createNativeHttpApp(
    failing,
    {
      authenticateBearer: () => Promise.resolve(asPrincipal("issuer subject")),
    },
    { ready: () => Promise.resolve(true) },
  );
  const found = await app.inject({
    url: "/api/v1/projects",
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(found.statusCode, 500);
  assert.equal(found.json<HttpErrorEnvelope>().error.code, "InternalError");
  assert.ok(!found.body.includes("pool"));
});

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
        "POST /api/v1/tenants/tenant/projects/project/operations HTTP/1.1\r\n" +
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
