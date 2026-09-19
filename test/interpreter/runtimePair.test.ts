import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimePair } from "../../src/interpreter/runtimePair.ts";
import type {
  ServiceRuntime,
  ServiceHealth,
  ServiceStartResult,
  ServiceStopResult,
} from "../../src/interpreter/serviceRuntime.ts";

function member(started: ServiceStartResult = { started: "Started" }) {
  let health: ServiceHealth = { live: true, ready: false };
  let finish: (value: ServiceHealth) => void = () => undefined;
  const settled = new Promise<ServiceHealth>((resolve) => {
    finish = resolve;
  });
  let stops = 0;
  let starts = 0;
  const runtime: ServiceRuntime = {
    start: () => {
      starts += 1;
      health = { live: true, ready: started.started === "Started" };
      return Promise.resolve(started);
    },
    stop: () => {
      stops += 1;
      health = { live: true, ready: false };
      finish(health);
      return Promise.resolve({
        stopped: "Stopped",
      } satisfies ServiceStopResult);
    },
    health: () => health,
    settled: () => settled,
  };
  return {
    runtime,
    stops: () => stops,
    starts: () => starts,
    fail: () => {
      health = { live: false, ready: false, failure: "lost lease" };
      finish(health);
    },
  };
}

test("paired runtimes expose either loop failing without waiting for the other", async () => {
  const left = member();
  const right = member();
  const paired = runtimePair(left.runtime, right.runtime);
  assert.deepEqual(await paired.start(), { started: "Started" });
  assert.deepEqual(paired.health(), { live: true, ready: true });
  right.fail();
  assert.deepEqual(await paired.settled(), {
    live: false,
    ready: false,
    failure: "lost lease",
  });
  await paired.stop();
  assert.equal(left.stops(), 1);
  assert.equal(right.stops(), 1);
});

test("a refused paired startup shuts down its successfully started sibling", async () => {
  const refusal: ServiceStartResult = {
    started: "CouldNotRun",
    precondition: "schema",
    verdict: "Refused",
    why: "incompatible",
  };
  const left = member();
  const right = member(refusal);
  assert.deepEqual(
    await runtimePair(left.runtime, right.runtime).start(),
    refusal,
  );
  assert.equal(left.stops(), 1);
  assert.equal(right.stops(), 1);
});

test("a refused first startup never starts its sibling loop", async () => {
  const refusal: ServiceStartResult = {
    started: "CouldNotRun",
    precondition: "schema",
    verdict: "Refused",
    why: "incompatible",
  };
  const left = member(refusal);
  const right = member();
  assert.deepEqual(
    await runtimePair(left.runtime, right.runtime).start(),
    refusal,
  );
  assert.equal(right.starts(), 0);
});
