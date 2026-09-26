import assert from "node:assert/strict";
import test from "node:test";

import {
  workerContractHeader,
  workerContractRelease,
} from "@chuggy/worker-contract/workerContract";

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

test("every request names the contract release the image was built with, whatever headers its caller sets", async () => {
  const requests = [];
  await workerRequest(
    task,
    "secret",
    "/v1/report",
    {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        [workerContractHeader]: "0.0.0",
      },
    },
    {
      fetch: async (_url, init) => {
        requests.push(init);
        return { ok: true, status: 202 };
      },
    },
  );

  assert.deepEqual(requests[0].headers, {
    authorization: "Bearer secret",
    "content-type": "text/plain",
    [workerContractHeader]: workerContractRelease,
  });
});

/**
 * A refusal the caller settles for is an answer, not a fault: without the list
 * every other failing status is a throw.
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

test("a refusal raises at the first answer, and a server error is asked again", async () => {
  for (const status of [400, 401, 404, 409, 413, 415, 503]) {
    let requests = 0;
    let waits = 0;
    await assert.rejects(
      workerRequest(
        task,
        "secret",
        "/v1/heartbeat",
        { method: "POST" },
        {
          fetch: async () => {
            requests += 1;
            return { ok: false, status };
          },
          wait: async () => {
            waits += 1;
          },
        },
      ),
      new RegExp(`answered ${String(status)}`, "u"),
    );
    assert.equal(requests, status === 503 ? 15 : 1, String(status));
    assert.equal(waits, requests - 1, String(status));
  }
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
