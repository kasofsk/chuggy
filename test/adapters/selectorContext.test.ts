import assert from "node:assert/strict";
import { test } from "node:test";

import { selectorContextHttp } from "../../src/adapters/http/selectorContext.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const body = Object.freeze({
  version: 2,
  observedAt: "2026-08-23T12:00:00.000Z",
  observedAtEpochMs: 1_777_000_000_000,
  reviewFeedback: [],
  activeWork: {
    running: 4,
    launching: 3,
    admitted: 2,
    queued: 1,
  },
  capacity: {
    account: "account",
    accountMaximum: 8,
    accountActive: 5,
    accountReservationDeficit: 1,
    clusterSlotsMax: 20,
    clusterActive: 9,
  },
  backlog: {
    project: { queued: 6, ceiling: 100 },
    installation: { queued: 12, ceiling: 1_000 },
  },
});

test("selector context client authenticates and strictly parses the response", async () => {
  let authorization: string | null = null;
  const source = selectorContextHttp(
    {
      baseUrl: "https://native.example/",
      bearerToken: "token",
      requestTimeoutMs: 1_000,
      responseBytesMax: 10_000,
      responseReadsMax: 100,
    },
    (request, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      assert.ok(request instanceof URL);
      assert.equal(
        request.href,
        "https://native.example/api/v1/tenants/tenant/projects/project/selector-context",
      );
      return Promise.resolve(Response.json(body));
    },
  );
  assert.deepEqual(
    await source.context({
      tenant: asTenantId("tenant"),
      project: asProjectId("project"),
    }),
    body,
  );
  assert.equal(authorization, "Bearer token");
});

test("selector context client refuses oversized responses", async () => {
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled = true;
    },
  });
  const source = selectorContextHttp(
    {
      baseUrl: "https://native.example/",
      bearerToken: "token",
      requestTimeoutMs: 1_000,
      responseBytesMax: 1,
      responseReadsMax: 10,
    },
    () => Promise.resolve(new Response(stream)),
  );
  await assert.rejects(
    source.context({
      tenant: asTenantId("tenant"),
      project: asProjectId("project"),
    }),
    /byte bound/u,
  );
  const stoppedAt = reads;
  await Promise.resolve();
  assert.equal(reads, stoppedAt);
  assert.equal(cancelled, true);
});

test("selector context client cancels an endless empty response", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array());
    },
    cancel() {
      cancelled = true;
    },
  });
  const source = selectorContextHttp(
    {
      baseUrl: "https://native.example/",
      bearerToken: "token",
      requestTimeoutMs: 1_000,
      responseBytesMax: 1_000,
      responseReadsMax: 3,
    },
    () => Promise.resolve(new Response(stream)),
  );
  await assert.rejects(
    source.context({
      tenant: asTenantId("tenant"),
      project: asProjectId("project"),
    }),
    /read bound/u,
  );
  assert.equal(cancelled, true);
});
