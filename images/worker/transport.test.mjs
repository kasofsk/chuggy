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
