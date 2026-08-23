import assert from "node:assert/strict";
import { test } from "node:test";

import {
  trustedSelectorPolicyHttpClient,
  trustedSelectorPolicyMediaType,
  trustedSelectorPolicyProtocolVersion,
  trustedSelectorPolicyTerminationProofCharsMax,
} from "../../src/adapters/http/trustedSelectorPolicy.ts";
import type { SelectorPolicyRequest } from "../../src/interpreter/selector.ts";

const request: SelectorPolicyRequest = {
  attempt: "attempt-1",
  observation: {
    token: {
      tenant: "tenant",
      project: "project",
      recoveryEpoch: "epoch",
      schemaVersion: 1,
      watermark: 2,
      digest: "a".repeat(64),
    },
    candidates: [],
    notificationCursor: 3,
    operationalContext: {
      observedAt: "2026-08-23T00:00:00.000Z",
      observedAtEpochMs: 1,
      reviewFeedback: [],
      activeWork: [],
      projectCapacity: {
        account: "project",
        allocated: 0,
        limit: 1,
        available: 1,
      },
      clusterCapacity: {
        visibility: "AuthorizedAggregate",
        allocated: 0,
        limit: 1,
        available: 1,
        pressure: "Normal",
      },
      executionBacklog: { queued: 0, ceiling: 1, dispatchAllowed: true },
    },
    workingMemory: {},
    nextCandidateScan: {
      state: "Exhausted",
      token: {
        tenant: "tenant",
        project: "project",
        recoveryEpoch: "epoch",
        schemaVersion: 1,
        watermark: 2,
        digest: "a".repeat(64),
      },
    },
  },
  instructions: { revision: 1, content: "select" },
  constraints: {
    models: ["model"],
    tools: [],
    limits: {
      tokensPerDecision: 100,
      millisecondsPerDecision: 1_000,
      toolCallsPerDecision: 1,
      inputBytesPerDecision: 10_000,
      candidatePagesPerDecision: 1,
      concurrentDecisions: 1,
      selectionsPerMinute: 1,
    },
  },
};

const config = {
  baseUrl: "https://policy.example/service/",
  bearerToken: "secret",
  requestDeadlineMs: 1_000,
  responseBytesMax: 1_024,
};

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": trustedSelectorPolicyMediaType },
  });
}

const execution = {
  result: { attention: "Monitoring", workingMemory: {} },
  implementationRevision: "implementation-1",
  modelRevision: "model-1",
  policyRevision: "policy-1",
  toolActivity: [],
  accounting: { tokens: 1, durationMs: 1 },
  startedAt: "2026-08-23T00:00:00.000Z",
  completedAt: "2026-08-23T00:00:00.001Z",
};

test("execute sends the authenticated versioned contract", async () => {
  let called: { readonly url: string; readonly init: RequestInit } | undefined;
  const client = trustedSelectorPolicyHttpClient(config, (url, init) => {
    called = { url, init };
    return Promise.resolve(
      response({
        version: trustedSelectorPolicyProtocolVersion,
        execution,
      }),
    );
  });
  const found = await client.execute(request, new AbortController().signal);
  assert.deepEqual(found, execution);
  assert.equal(called?.url, "https://policy.example/service/v1/execute");
  assert.equal(
    called?.init.headers !== undefined &&
      new Headers(called.init.headers).get("authorization"),
    "Bearer secret",
  );
  const body = called?.init.body;
  if (typeof body !== "string") throw new TypeError("request body is absent");
  assert.deepEqual(JSON.parse(body), {
    version: trustedSelectorPolicyProtocolVersion,
    request,
  });
});

test("termination operations preserve proof and attempt identity", async () => {
  const paths: string[] = [];
  const client = trustedSelectorPolicyHttpClient(config, (url) => {
    paths.push(url);
    return Promise.resolve(
      response({
        version: trustedSelectorPolicyProtocolVersion,
        termination: {
          status: "Terminated",
          attempt: "attempt-1",
          proof: "settled",
        },
      }),
    );
  });
  assert.deepEqual(
    await client.cancel("attempt-1", new AbortController().signal),
    {
      status: "Terminated",
      attempt: "attempt-1",
      proof: "settled",
    },
  );
  await client.inspect("attempt-1", new AbortController().signal);
  assert.deepEqual(paths, [
    "https://policy.example/service/v1/cancel",
    "https://policy.example/service/v1/inspect",
  ]);
});

test("termination proof uses the selector host's evidence bound", async () => {
  const proof = "p".repeat(trustedSelectorPolicyTerminationProofCharsMax);
  let extra = false;
  const client = trustedSelectorPolicyHttpClient(
    { ...config, responseBytesMax: 2_048 },
    () =>
      Promise.resolve(
        response({
          version: 1,
          termination: {
            status: "Terminated",
            attempt: "attempt-1",
            proof: extra ? `${proof}p` : proof,
          },
        }),
      ),
  );
  assert.equal(
    (await client.inspect("attempt-1", new AbortController().signal)).status,
    "Terminated",
  );
  extra = true;
  await assert.rejects(
    client.inspect("attempt-1", new AbortController().signal),
    /too big/i,
  );
});

test("readiness is authenticated and strictly decoded", async () => {
  const client = trustedSelectorPolicyHttpClient(config, (_url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer secret",
    );
    return Promise.resolve(response({ version: 1, ready: true }));
  });
  assert.equal(await client.ready(), true);
});

test("unknown response fields and malformed requests are refused", async () => {
  const client = trustedSelectorPolicyHttpClient(config, () =>
    Promise.resolve(response({ version: 1, ready: true, extra: true })),
  );
  await assert.rejects(client.ready(), /unrecognized key/i);
  await assert.rejects(
    client.execute(
      {
        ...request,
        observation: { ...request.observation, extra: true },
      } as SelectorPolicyRequest,
      new AbortController().signal,
    ),
    /unrecognized key/i,
  );
});

test("response bytes are bounded before JSON decoding", async () => {
  const client = trustedSelectorPolicyHttpClient(
    { ...config, responseBytesMax: 8 },
    () => Promise.resolve(response({ version: 1, ready: true })),
  );
  await assert.rejects(client.ready(), /byte bound/);
});

test("caller cancellation reaches the in-flight request", async () => {
  let observed: AbortSignal | undefined;
  const client = trustedSelectorPolicyHttpClient(config, (_url, init) => {
    observed = init.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new Error("caller aborted"));
      });
    });
  });
  const control = new AbortController();
  const pending = client.execute(request, control.signal);
  control.abort();
  assert.equal(observed?.aborted, true);
  await assert.rejects(pending, /caller aborted/);
});

test("the client aborts calls at its deadline", async () => {
  let observed: AbortSignal | undefined;
  const client = trustedSelectorPolicyHttpClient(
    { ...config, requestDeadlineMs: 1 },
    (_url, init) => {
      observed = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new Error("transport aborted"));
        });
      });
    },
  );
  await assert.rejects(client.ready(), /deadline exceeded/);
  assert.equal(observed?.aborted, true);
});
