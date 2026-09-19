import assert from "node:assert/strict";
import test from "node:test";

import {
  workerPoolPoll,
  workerPoolReconcile,
  type WorkerPoolAssignments,
  type WorkerPoolIdentity,
  type WorkerPoolPollSettings,
} from "../../src/interpreter/workerPool.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";

const identity: WorkerPoolIdentity = {
  partition: { tenant: "tenant", project: "project" } as Partition,
  pool: "pool-one",
  capabilities: [],
};

const settings: WorkerPoolPollSettings = {
  leaseSecs: 30,
  attemptsUnreportedMax: 3,
  assignmentsPerPollMax: 2,
  heldMax: 2,
  deadlineSecs: 600,
  callbackUrl: "https://plane.invalid/v1/ticket-execution",
  pollIntervalMs: 1,
  pollsMax: 3,
};

/** A durable side holding nothing, which is what a pool with no work to take meets. */
const idle: WorkerPoolAssignments = {
  claim: () => Promise.resolve(undefined),
  renew: () => Promise.resolve(true),
  refuse: () => Promise.resolve(false),
  release: () => Promise.resolve(false),
  held: () => Promise.resolve(false),
};

test("a claim is asked for only as far as the pool's remaining room", async () => {
  let asked = 0;
  const answered = await workerPoolReconcile(
    {
      ...idle,
      claim: () => {
        asked += 1;
        return Promise.resolve({ view: {}, capabilities: [] });
      },
    },
    identity,
    ["one"],
    settings,
    () => `minted-${String(asked)}`,
  );
  assert.equal(asked, 1);
  assert.equal(answered.assignments.length, 1);
});

test("a held list longer than the bound is a refusal rather than a truncation", async () => {
  await assert.rejects(
    () =>
      workerPoolReconcile(
        idle,
        identity,
        ["one", "two", "three"],
        settings,
        () => "minted",
      ),
    /holds more than its bound/u,
  );
});

test("a bound that is not a positive whole number refuses the poll", async () => {
  await assert.rejects(
    () =>
      workerPoolReconcile(
        idle,
        identity,
        [],
        { ...settings, pollIntervalMs: 0 },
        () => "minted",
      ),
    /pollIntervalMs must be a positive safe integer/u,
  );
});

test("a long poll reconciles to its bound and answers empty rather than waiting on", async () => {
  let passes = 0;
  const answered = await workerPoolPoll(
    {
      ...idle,
      claim: () => {
        passes += 1;
        return Promise.resolve(undefined);
      },
    },
    identity,
    [],
    settings,
    () => "minted",
  );
  assert.deepEqual(answered, { assignments: [], stop: [] });
  assert.equal(passes, settings.pollsMax);
});

test("a long poll stops at the first pass with a stop flag to deliver", async () => {
  let passes = 0;
  const answered = await workerPoolPoll(
    {
      ...idle,
      renew: () => {
        passes += 1;
        return Promise.resolve(false);
      },
    },
    identity,
    ["one"],
    settings,
    () => "minted",
  );
  assert.deepEqual(answered.stop, ["one"]);
  assert.equal(passes, 1);
});
