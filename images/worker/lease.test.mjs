import assert from "node:assert/strict";
import test from "node:test";

import { heartbeatIntervalMilliseconds, keepWorkerLease } from "./lease.mjs";

test("a running worker renews its attempt lease without overlapping heartbeats", async () => {
  const calls = [];
  let tick;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const stop = keepWorkerLease(
    { workerPlane: { url: "http://worker-plane" } },
    "bearer",
    {
      request: async (...args) => {
        calls.push(args);
        await pending;
      },
      setInterval: (callback, milliseconds) => {
        assert.equal(milliseconds, heartbeatIntervalMilliseconds);
        tick = callback;
        return "timer";
      },
      clearInterval: (timer) => assert.equal(timer, "timer"),
    },
  );

  tick();
  tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(1), [
    "bearer",
    "/v1/heartbeat",
    { method: "POST" },
  ]);
  release();
  await stop();
});

test("a heartbeat refusal fails the worker when its work finishes", async () => {
  let tick;
  const stop = keepWorkerLease({}, "bearer", {
    request: async () => {
      throw new Error("fenced");
    },
    setInterval: (callback) => {
      tick = callback;
      return "timer";
    },
    clearInterval: () => undefined,
  });
  tick();
  await assert.rejects(stop(), /fenced/);
});
