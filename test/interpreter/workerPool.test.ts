import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionRequirement } from "../../src/interpreter/executionRequirement.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  workerPoolPoll,
  workerPoolReconcile,
  type WorkerPoolAssignments,
  type WorkerPoolClaimTerms,
  type WorkerPoolIdentity,
  type WorkerPoolPollSettings,
} from "../../src/interpreter/workerPool.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";

const identity: WorkerPoolIdentity = {
  partition: { tenant: "tenant", project: "project" } as Partition,
  pool: "pool-one",
  principal: asPrincipal("principal-one"),
};

const container: ExecutionRequirement = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Arm64",
  image: `registry.invalid/worker@sha256:${"a".repeat(64)}`,
};

const settings: WorkerPoolPollSettings = {
  leaseSecs: 30,
  cpuMillis: 500,
  memoryMib: 256,
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
        return Promise.resolve({ requirement: container });
      },
    },
    identity,
    ["one"],
    settings.assignmentsPerPollMax,
    settings,
    () => `minted-${String(asked)}`,
  );
  assert.equal(asked, 1);
  assert.equal(answered.assignments.length, 1);
});

test("a pool wanting none is claimed nothing and still renewed and told what to stop", async () => {
  let asked = 0;
  const renewed: string[] = [];
  const answered = await workerPoolReconcile(
    {
      ...idle,
      claim: () => {
        asked += 1;
        return Promise.resolve({ requirement: container });
      },
      renew: (_identity, assignment) => {
        renewed.push(assignment);
        return Promise.resolve(assignment === "live");
      },
    },
    identity,
    ["live", "gone"],
    0,
    { ...settings, heldMax: 4 },
    () => "minted",
  );
  assert.equal(asked, 0);
  assert.deepEqual(renewed, ["live", "gone"]);
  assert.deepEqual(answered, { assignments: [], stop: ["gone"] });
});

test("a pool wanting more than the plane allows is claimed the plane's bound", async () => {
  let asked = 0;
  const claiming = {
    ...idle,
    claim: () => {
      asked += 1;
      return Promise.resolve({ requirement: container });
    },
  };
  const perPoll = await workerPoolReconcile(
    claiming,
    identity,
    [],
    settings.assignmentsPerPollMax + 5,
    { ...settings, heldMax: 10 },
    () => `minted-${String(asked)}`,
  );
  assert.equal(perPoll.assignments.length, settings.assignmentsPerPollMax);
  asked = 0;
  const room = await workerPoolReconcile(
    claiming,
    identity,
    ["one"],
    settings.assignmentsPerPollMax + 5,
    { ...settings, assignmentsPerPollMax: 10 },
    () => `minted-${String(asked)}`,
  );
  assert.equal(room.assignments.length, settings.heldMax - 1);
});

/** The one assignment a poll hands out when the durable side claims `requirement`, and the terms the claim was held to. */
async function reconciledOne(requirement: ExecutionRequirement): Promise<{
  readonly assignment: Record<string, unknown>;
  readonly terms: WorkerPoolClaimTerms[];
}> {
  const terms: WorkerPoolClaimTerms[] = [];
  const answered = await workerPoolReconcile(
    {
      ...idle,
      claim: (_identity, held) => {
        terms.push(held);
        return Promise.resolve(
          terms.length === 1 ? { requirement } : undefined,
        );
      },
    },
    identity,
    [],
    1,
    settings,
    () => "minted",
  );
  assert.equal(answered.assignments.length, 1);
  return {
    assignment: answered.assignments[0] as Record<string, unknown>,
    terms,
  };
}

test("a container is handed out with its platform and the image its requirement pinned", async () => {
  const { assignment, terms } = await reconciledOne(container);
  assert.deepEqual(assignment["capabilities"], ["Platform:Linux:Arm64"]);
  assert.equal(
    assignment["image"],
    `registry.invalid/worker@sha256:${"a".repeat(64)}`,
  );
  assert.deepEqual(
    terms.map(({ leaseSecs, heldMax }) => ({ leaseSecs, heldMax })),
    [{ leaseSecs: settings.leaseSecs, heldMax: settings.heldMax }],
  );
});

test("a capability requirement is handed out with its platform and capabilities and no image", async () => {
  const { assignment } = await reconciledOne({
    mode: "ContainerCapability",
    operatingSystem: "Linux",
    architecture: "Amd64",
    capabilities: ["Agent:Codex"],
  });
  assert.deepEqual(assignment["capabilities"], [
    "Platform:Linux:Amd64",
    "Agent:Codex",
  ]);
  assert.equal("image" in assignment, false);
});

test("a native requirement a claim returned is refused rather than handed to a pool", async () => {
  await assert.rejects(
    reconciledOne({
      mode: "Native",
      architecture: "Arm64",
      driver: "XcodeBuild",
      xcodeVersionMin: 17,
      sdkVersionMin: 18,
    }),
    /claimed a native requirement/u,
  );
});

test("a wanted that is not a whole count refuses the poll", async () => {
  for (const wanted of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    await assert.rejects(
      () =>
        workerPoolReconcile(idle, identity, [], wanted, settings, () => "m"),
      /wanted must be a non-negative integer/u,
    );
});

test("a held list longer than the bound is a refusal rather than a truncation", async () => {
  await assert.rejects(
    () =>
      workerPoolReconcile(
        idle,
        identity,
        ["one", "two", "three"],
        1,
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
        1,
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
    1,
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
    1,
    settings,
    () => "minted",
  );
  assert.deepEqual(answered.stop, ["one"]);
  assert.equal(passes, 1);
});
