import assert from "node:assert/strict";
import test from "node:test";

import {
  workerContractHeader,
  workerContractRelease,
} from "../../src/contract/workerContract.ts";
import { poolSessionPlaneClient } from "../../src/adapters/http/poolSessionPlaneClient.ts";
import type { WorkerPoolSessionEnd } from "../../src/interpreter/workerPoolClient.ts";

const ended: WorkerPoolSessionEnd = {
  kind: "Session",
  session: {
    assignment: "session-one",
    callbackUrl: "https://worker-plane.invalid/v1/ticket-execution",
    bearer: "chgs_session",
  },
  phase: "Failed",
};

test("an end is told to the session's own plane under its own bearer, once, with only its phase", async () => {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const plane = poolSessionPlaneClient({ timeoutMs: 1_000 }, (input, init) => {
    assert.ok(input instanceof URL);
    sent.push({ url: input.href, init });
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  assert.equal(await plane.end(ended), "Ended");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.url, "https://worker-plane.invalid/v1/session/ended");
  assert.equal(sent[0]?.init?.method, "POST");
  const headers = new Headers(sent[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer chgs_session");
  assert.equal(headers.get(workerContractHeader), workerContractRelease);
  assert.equal(sent[0]?.init?.body, JSON.stringify({ phase: "Failed" }));
});

test("a refusal is final and anything else is an outage", async () => {
  for (const [status, answer] of [
    [400, "Refused"],
    [401, "Refused"],
    [409, "Refused"],
    [500, "Unavailable"],
    [503, "Unavailable"],
  ] as const)
    assert.equal(
      await poolSessionPlaneClient({ timeoutMs: 1_000 }, () =>
        Promise.resolve(new Response("{}", { status })),
      ).end(ended),
      answer,
      String(status),
    );
  assert.equal(
    await poolSessionPlaneClient({ timeoutMs: 1_000 }, () =>
      Promise.reject(new TypeError("fetch failed")),
    ).end(ended),
    "Unavailable",
  );
});

test("a timeout that is not a positive whole number is refused", () => {
  for (const timeoutMs of [0, -1, 1.5])
    assert.throws(
      () => poolSessionPlaneClient({ timeoutMs }),
      /positive integer/u,
    );
});
