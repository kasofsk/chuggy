import assert from "node:assert/strict";
import { test } from "node:test";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import {
  asPrincipal,
  asPublicInstant,
  type NativeWeb,
} from "../../src/interpreter/nativeWeb.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";

type ServedNativeWeb = Pick<
  NativeWeb,
  | "cancel"
  | "notifications"
  | "operation"
  | "project"
  | "projectInventory"
  | "submit"
>;

function fakeWeb(calls: string[]): ServedNativeWeb {
  return {
    cancel: (_principal, _partition, operation) => {
      calls.push(`cancel:${operation}`);
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

function appOf(calls: string[], authenticated = true) {
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
  );
}

test("authentication failure never reaches NativeWeb", async () => {
  const calls: string[] = [];
  await using app = appOf(calls);
  const found = await app.inject({ method: "GET", url: "/api/v1/projects" });
  assert.equal(found.statusCode, 401);
  assert.equal(found.headers["www-authenticate"], "Bearer");
  assert.deepEqual(calls, []);
});

test("health is separate from authenticated product routes", async () => {
  const calls: string[] = [];
  await using app = appOf(calls, false);
  assert.equal((await app.inject({ url: "/health/live" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/health/ready" })).statusCode, 200);
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
