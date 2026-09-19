import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import { inertWorkerPlane } from "./workerPlaneFixtures.ts";

const view = {
  workload: { runner: "script", command: ["just", "check"] },
  inputs: {},
  resultContract: { type: "object" },
  requiredCapabilities: [],
  context: [],
  repository: "https://git.invalid/owner/repository.git",
  commit: "0123456789012345678901234567890123456789",
  access: "ReadRepository",
};

/** A plane whose attempt half answers one bearer and nothing else. */
function attemptPlane(bearer: string): ReturnType<typeof createWorkerPlaneApp> {
  return createWorkerPlaneApp({
    ...inertWorkerPlane(1_024),
    ticketExecutions: {
      report: (secret) =>
        Promise.resolve(secret === bearer ? "Recorded" : "Fenced"),
      view: (secret) => Promise.resolve(secret === bearer ? view : undefined),
    },
  });
}

test("a harness fetches its own view under the bearer its terminal is written with", async () => {
  const app = attemptPlane("attempt-secret");
  const served = await app.inject({
    method: "GET",
    url: "/v1/ticket-execution/view",
    headers: { authorization: "Bearer attempt-secret" },
  });
  assert.equal(served.statusCode, 200);
  assert.deepEqual(served.json(), view);
  const reported = await app.inject({
    method: "POST",
    url: "/v1/ticket-execution/terminal",
    headers: { authorization: "Bearer attempt-secret" },
    payload: { taskKey: "work:1:1", outcome: { type: "result" } },
  });
  assert.equal(reported.statusCode, 204);
});

for (const [why, headers] of [
  ["no bearer at all", {}],
  ["a bearer no live attempt is bound to", { authorization: "Bearer other" }],
] as const)
  test(`a view is refused to ${why}`, async () => {
    const response = await attemptPlane("attempt-secret").inject({
      method: "GET",
      url: "/v1/ticket-execution/view",
      headers,
    });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { action: "stop" });
  });

test("a plane composed with no attempt half serves neither ticket route", async () => {
  const app = createWorkerPlaneApp(inertWorkerPlane(1_024));
  for (const [method, url] of [
    ["GET", "/v1/ticket-execution/view"],
    ["POST", "/v1/ticket-execution/terminal"],
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: "Bearer attempt-secret" },
    });
    assert.equal(response.statusCode, 404);
  }
});
