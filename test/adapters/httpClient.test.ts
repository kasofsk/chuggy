import assert from "node:assert/strict";
import { test } from "node:test";

import { nativeHttpClient } from "../../src/adapters/http/client.ts";
import {
  dispatchViewResponseSchema,
  notificationsResponseSchema,
  operationResponseSchema,
  projectInventoryResponseSchema,
  proposalSubmissionResponseSchema,
} from "../../src/adapters/http/codecs.ts";
import type { AccessTokenSource } from "../../src/adapters/http/accessToken.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import {
  asIdempotencyKey,
  asOperationId,
} from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { id } from "../domain/fixtures.ts";

const principal = asPrincipal("selector");

function constantAccessToken(value: string): AccessTokenSource {
  return { token: () => Promise.resolve(value), invalidate: () => undefined };
}
const partition = {
  tenant: asTenantId("tenant/one"),
  project: asProjectId("project two"),
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Readonly<Record<string, string>>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    ...(headers === undefined ? {} : { headers }),
  });
}

test("V1 response codecs reject unknown and malformed fields", () => {
  assert.throws(() =>
    projectInventoryResponseSchema.parse({ projects: [], private: true }),
  );
  assert.throws(() =>
    notificationsResponseSchema.parse({ result: "Reset", cursor: -1 }),
  );
  assert.throws(() =>
    dispatchViewResponseSchema.parse({ result: "Reset", candidates: [] }),
  );
  assert.throws(() =>
    operationResponseSchema.parse({
      operation: "operation",
      acceptedAt: "not-an-instant",
      state: "Pending",
    }),
  );
  assert.throws(() =>
    proposalSubmissionResponseSchema.parse({
      operation: "operation",
      state: "Pending",
      ordinal: 1,
    }),
  );
});

test("the client authenticates and decodes inventory through its V1 codec", async () => {
  let request: Request | undefined;
  const client = nativeHttpClient({
    baseUrl: "https://ticket.example/",
    accessToken: constantAccessToken("token"),
    requestTimeoutMs: 1_000,
    responseBytesMax: 1_000,
    fetch: (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(jsonResponse({ projects: [partition] }));
    },
  });
  assert.deepEqual(await client.projectInventory(principal, undefined, 10), {
    projects: [partition],
  });
  assert.equal(request?.headers.get("authorization"), "Bearer token");
  assert.equal(
    request?.headers.get("accept"),
    "application/vnd.chuggy.v1+json",
  );
  assert.equal(request?.url, "https://ticket.example/api/v1/projects?limit=10");
});

test("proposal acceptance remains narrower than private operation standing", async () => {
  let request: Request | undefined;
  const client = nativeHttpClient({
    baseUrl: "https://ticket.example/",
    accessToken: constantAccessToken("token"),
    requestTimeoutMs: 1_000,
    responseBytesMax: 1_000,
    fetch: (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(
        jsonResponse({ operation: "operation", state: "Pending" }, 202),
      );
    },
  });
  const result = await client.submit(principal, {
    partition,
    operation: asOperationId("operation"),
    key: asIdempotencyKey("decision"),
    command: {
      version: 1,
      command: "ProposeDispatch",
      ticket: id(1),
      expectedTicketVersion: 2,
      observedViewToken: {
        tenant: partition.tenant,
        project: partition.project,
        recoveryEpoch: "epoch",
        schemaVersion: 1,
        watermark: 3,
        digest: "a".repeat(64),
      },
      selectorDecisionReference: "decision",
    },
  });
  assert.deepEqual(result, {
    result: "Authorized",
    acceptance: { accepted: "Accepted" },
  });
  assert.doesNotMatch(JSON.stringify(result), /ordinal|authority|lifecycle/u);
  assert.equal(request?.method, "POST");
  assert.equal(
    request?.url,
    "https://ticket.example/api/v1/tenants/tenant%2Fone/projects/project%20two/operations",
  );
  assert.deepEqual(JSON.parse((await request?.text()) ?? "null"), {
    operation: "operation",
    mutation: {
      mutation: "ProposeDispatch",
      ticket: 1,
      expectedTicketVersion: 2,
      observedViewToken: {
        tenant: "tenant/one",
        project: "project two",
        recoveryEpoch: "epoch",
        schemaVersion: 1,
        watermark: 3,
        digest: "a".repeat(64),
      },
      selectorDecisionReference: "decision",
    },
  });
});

test("inventory continuation uses the server cursor query", async () => {
  let request: Request | undefined;
  const client = nativeHttpClient({
    baseUrl: "https://ticket.example/",
    accessToken: constantAccessToken("token"),
    requestTimeoutMs: 1_000,
    responseBytesMax: 1_000,
    fetch: (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(jsonResponse({ projects: [] }));
    },
  });
  await client.projectInventory(principal, partition, 10);
  const url = new URL(request?.url ?? "");
  assert.equal(url.searchParams.has("cursor"), true);
  assert.equal(url.searchParams.has("after"), false);
});

test("response overflow cancels the stream before retaining more bytes", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"projects":['));
      controller.enqueue(new Uint8Array(32));
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = nativeHttpClient({
    baseUrl: "https://ticket.example/",
    accessToken: constantAccessToken("token"),
    requestTimeoutMs: 1_000,
    responseBytesMax: 16,
    fetch: () => Promise.resolve(new Response(body)),
  });
  await assert.rejects(
    client.projectInventory(principal, undefined, 10),
    /exceeds its byte limit/u,
  );
  assert.equal(cancelled, true);
});

test("an endless zero-byte response is bounded and cancelled", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array());
    },
    cancel() {
      cancelled = true;
    },
  });
  const client = nativeHttpClient({
    baseUrl: "https://ticket.example/",
    accessToken: constantAccessToken("token"),
    requestTimeoutMs: 1_000,
    responseBytesMax: 4,
    fetch: () => Promise.resolve(new Response(body)),
  });
  await assert.rejects(
    client.projectInventory(principal, undefined, 10),
    /exceeds its read limit/u,
  );
  assert.equal(cancelled, true);
});

test("the request deadline aborts an unresponsive transport", async () => {
  const client = nativeHttpClient({
    baseUrl: "https://ticket.example/",
    accessToken: constantAccessToken("token"),
    requestTimeoutMs: 5,
    responseBytesMax: 1_000,
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(
            init.signal?.reason instanceof Error
              ? init.signal.reason
              : new Error("request aborted"),
          );
        });
      }),
  });
  await assert.rejects(client.projectInventory(principal, undefined, 10), {
    name: "TimeoutError",
  });
});

test("the request deadline also bounds authentication", async () => {
  let fetched = false;
  const client = nativeHttpClient({
    baseUrl: "https://ticket.example/",
    accessToken: {
      token: () => new Promise<string>(() => undefined),
      invalidate: () => undefined,
    },
    requestTimeoutMs: 5,
    responseBytesMax: 1_000,
    fetch: () => {
      fetched = true;
      return Promise.resolve(jsonResponse({ projects: [] }));
    },
  });
  await assert.rejects(client.projectInventory(principal, undefined, 10), {
    name: "TimeoutError",
  });
  assert.equal(fetched, false);
});

test("a refused request tells the source which token it refused", async () => {
  const invalidated: string[] = [];
  const granted = ["first", "second"];
  const presented: (string | null)[] = [];
  const client = nativeHttpClient({
    baseUrl: "https://ticket.example/",
    accessToken: {
      token: () => Promise.resolve(granted[0] ?? "exhausted"),
      invalidate: (refused) => {
        invalidated.push(refused);
        granted.shift();
      },
    },
    requestTimeoutMs: 1_000,
    responseBytesMax: 1_000,
    fetch: (_input, init) => {
      presented.push(new Headers(init?.headers).get("authorization"));
      return Promise.resolve(
        presented.length === 1
          ? jsonResponse({ error: { code: "Unauthenticated" } }, 401)
          : jsonResponse({ projects: [] }),
      );
    },
  });
  await assert.rejects(client.projectInventory(principal, undefined, 10));
  await client.projectInventory(principal, undefined, 10);
  assert.deepEqual(invalidated, ["first"]);
  assert.deepEqual(presented, ["Bearer first", "Bearer second"]);
});

test("a token that could not be a header is refused before the request", async () => {
  let fetched = false;
  const client = nativeHttpClient({
    baseUrl: "https://ticket.example/",
    accessToken: constantAccessToken("first\r\nx-injected: yes"),
    requestTimeoutMs: 1_000,
    responseBytesMax: 1_000,
    fetch: () => {
      fetched = true;
      return Promise.resolve(jsonResponse({ projects: [] }));
    },
  });
  await assert.rejects(
    client.projectInventory(principal, undefined, 10),
    /bearer token is empty or malformed/u,
  );
  assert.equal(fetched, false);
});
