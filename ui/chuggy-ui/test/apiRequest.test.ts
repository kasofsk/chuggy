/**
 * One request, from the headers it sends to the outcome it hands back.
 *
 * The two things a browser owns and the contract cannot are checked here: that
 * every request carries a deadline and that `retry-after` is honoured a bounded
 * number of times.
 */

import { expect, test } from "vitest";

import { nativeHttpMediaType } from "../../../src/contract/http.ts";
import { retryAfterSecondsMax } from "../../../src/contract/outcomes.ts";
import { apiAttemptsMax, apiRead, apiSend } from "../app/core/apiRequest.ts";
import type { ApiFetchInit, ApiPorts } from "../app/core/apiRequest.ts";

interface Answer {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

interface Harness {
  readonly ports: ApiPorts;
  readonly sent: { url: string; init: ApiFetchInit }[];
  readonly waitsMs: number[];
}

function harness(answers: readonly Answer[], bearer = "token"): Harness {
  const sent: { url: string; init: ApiFetchInit }[] = [];
  const waitsMs: number[] = [];
  let at = 0;
  return {
    sent,
    waitsMs,
    ports: {
      fetch: (url, init) => {
        sent.push({ url, init });
        const answer = answers[Math.min(at, answers.length - 1)] ?? {
          status: 500,
        };
        at += 1;
        const headers = answer.headers ?? {};
        return Promise.resolve({
          status: answer.status,
          headers: { get: (name: string) => headers[name] ?? null },
          text: () =>
            Promise.resolve(
              answer.body === undefined ? "" : JSON.stringify(answer.body),
            ),
        } as unknown as Response);
      },
      bearer: () => Promise.resolve(bearer),
      sleepMs: (ms) => {
        waitsMs.push(ms);
        return Promise.resolve();
      },
    },
  };
}

test("a request states the wire's media type and carries the bearer", async () => {
  const held = harness([{ status: 200, body: { installation: "one" } }]);
  await apiSend(held.ports, { method: "GET", path: "/api/v1/installation" });
  const headers = held.sent[0]?.init.headers ?? {};
  expect(headers["accept"]).toBe(nativeHttpMediaType);
  expect(headers["authorization"]).toBe("Bearer token");
  expect(headers["content-type"]).toBeUndefined();
});

test("a body brings the media type with it and an idempotency key travels", async () => {
  const held = harness([
    { status: 202, body: { operation: "o", state: "Pending" } },
  ]);
  await apiSend(held.ports, {
    method: "POST",
    path: "/api/v1/tenants/a/projects/b/operations",
    body: { operation: "o" },
    idempotencyKey: "o",
  });
  const headers = held.sent[0]?.init.headers ?? {};
  expect(headers["content-type"]).toBe(nativeHttpMediaType);
  expect(headers["idempotency-key"]).toBe("o");
});

test("every request is given a signal that can end it", async () => {
  const held = harness([{ status: 200, body: {} }]);
  await apiSend(held.ports, { method: "GET", path: "/api/v1/installation" });
  expect(held.sent[0]?.init.signal).toBeInstanceOf(AbortSignal);
});

test("a request that outlives its deadline is unreachable, not a hang", async () => {
  const ports: ApiPorts = {
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      }),
    bearer: () => Promise.resolve("token"),
    sleepMs: () => Promise.resolve(),
  };
  const outcome = await apiSend(ports, {
    method: "GET",
    path: "/api/v1/installation",
    timeoutMs: 1,
  });
  expect(outcome.outcome).toBe("Unreachable");
});

test("retry-after is honoured, bounded by the attempt count", async () => {
  const held = harness([
    {
      status: 503,
      headers: { "retry-after": "2" },
      body: { error: { code: "Busy" } },
    },
  ]);
  const outcome = await apiSend(held.ports, {
    method: "GET",
    path: "/api/v1/installation",
  });
  expect(held.sent.length).toBe(apiAttemptsMax);
  expect(held.waitsMs).toEqual([2_000, 2_000]);
  expect(outcome.outcome).toBe("Retryable");
});

test("a hostile retry-after arrives already capped by the wire", async () => {
  const held = harness([
    { status: 429, headers: { "retry-after": "99999" }, body: {} },
    { status: 200, body: { installation: "one" } },
  ]);
  await apiSend(held.ports, { method: "GET", path: "/api/v1/installation" });
  expect(held.waitsMs).toEqual([retryAfterSecondsMax * 1_000]);
});

test("a body the schema rejects is unreadable rather than cached", async () => {
  const held = harness([{ status: 200, body: { installation: 3 } }]);
  const result = await apiRead(
    held.ports,
    {
      method: "GET",
      path: "/api/v1/installation",
    },
    () => {
      throw new TypeError("not an installation");
    },
  );
  expect(result).toEqual({
    outcome: "Unreadable",
    reason: "not an installation",
  });
});

test("404 and 401 stay the outcomes the contract classified them as", async () => {
  const absent = await apiSend(harness([{ status: 404 }]).ports, {
    method: "GET",
    path: "/api/v1/installation",
  });
  const refused = await apiSend(harness([{ status: 401 }]).ports, {
    method: "GET",
    path: "/api/v1/installation",
  });
  expect(absent.outcome).toBe("Absent");
  expect(refused.outcome).toBe("Unauthenticated");
});
