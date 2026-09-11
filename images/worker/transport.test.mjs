import assert from "node:assert/strict";
import test from "node:test";

import { workerRequest } from "./transport.mjs";

const task = { workerPlane: { url: "http://worker-plane.test:3001" } };

test("a refused connection is retried in the same worker", async () => {
  const requests = [];
  const waits = [];
  const response = { ok: true, status: 200 };
  const received = await workerRequest(
    task,
    "secret",
    "/v1/input",
    {},
    {
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        if (requests.length < 3) throw new TypeError("fetch failed");
        return response;
      },
      wait: async (milliseconds) => waits.push(milliseconds),
    },
  );

  assert.equal(received, response);
  assert.equal(requests.length, 3);
  assert.deepEqual(waits, [2_000, 2_000]);
  assert.equal(requests[0].url, "http://worker-plane.test:3001/v1/input");
  assert.equal(requests[0].init.headers.authorization, "Bearer secret");
});

/**
 * A refusal the caller settles for is an answer, not a fault: without the list
 * every non-ok status is a throw, and a not-found a caller means to read would
 * be retried to the bound before reaching it.
 */
test("a status the caller settles for is handed back, and every other is a fault", async () => {
  let requests = 0;
  const refused = { ok: false, status: 404 };
  const received = await workerRequest(
    task,
    "secret",
    "/v1/credential",
    {},
    {
      fetch: async () => {
        requests += 1;
        return refused;
      },
      wait: async () => undefined,
      settled: [404],
    },
  );

  assert.equal(received, refused);
  assert.equal(requests, 1);

  await assert.rejects(
    workerRequest(
      task,
      "secret",
      "/v1/credential",
      {},
      {
        fetch: async () => ({ ok: false, status: 500 }),
        wait: async () => undefined,
        settled: [404],
      },
    ),
    /answered 500/u,
  );
});

test("worker-plane retries are bounded", async () => {
  let requests = 0;
  let waits = 0;
  await assert.rejects(
    workerRequest(
      task,
      "secret",
      "/v1/input",
      {},
      {
        fetch: async () => {
          requests += 1;
          throw new TypeError("fetch failed");
        },
        wait: async () => {
          waits += 1;
        },
      },
    ),
    /fetch failed/,
  );
  assert.equal(requests, 15);
  assert.equal(waits, 14);
});
