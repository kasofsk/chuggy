import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionRequirement } from "../../src/interpreter/executionRequirement.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  workerPoolPoll,
  workerPoolReconcile,
  workerPoolReconciliationUnsessioned,
  workerPoolSessionsRead,
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
  imageHosts: new Map([
    ["registry.chuggy.internal", "registry.public.invalid"],
  ]),
};

/** A durable side holding nothing, which is what a pool with no work to take meets. */
const idle: WorkerPoolAssignments = {
  claim: () => Promise.resolve(undefined),
  renew: () => Promise.resolve(true),
  refuse: () => Promise.resolve(false),
  release: () => Promise.resolve(false),
  held: () => Promise.resolve(false),
  heldImages: () => Promise.resolve([]),
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
    {
      held: ["one"],
      wanted: settings.assignmentsPerPollMax,
      wantedSessions: 0,
    },
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
    { held: ["live", "gone"], wanted: 0, wantedSessions: 0 },
    { ...settings, heldMax: 4 },
    () => "minted",
  );
  assert.equal(asked, 0);
  assert.deepEqual(renewed, ["live", "gone"]);
  assert.deepEqual(answered, { assignments: [], sessions: [], stop: ["gone"] });
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
    {
      held: [],
      wanted: settings.assignmentsPerPollMax + 5,
      wantedSessions: 0,
    },
    { ...settings, heldMax: 10 },
    () => `minted-${String(asked)}`,
  );
  assert.equal(perPoll.assignments.length, settings.assignmentsPerPollMax);
  asked = 0;
  const room = await workerPoolReconcile(
    claiming,
    identity,
    {
      held: ["one"],
      wanted: settings.assignmentsPerPollMax + 5,
      wantedSessions: 0,
    },
    { ...settings, assignmentsPerPollMax: 10 },
    () => `minted-${String(asked)}`,
  );
  assert.equal(room.assignments.length, settings.heldMax - 1);
});

/** The one assignment a poll hands out when the durable side claims `requirement`, and the terms the claim was held to. */
async function reconciledOne(
  requirement: ExecutionRequirement,
  polled: WorkerPoolPollSettings = settings,
): Promise<{
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
    { held: [], wanted: 1, wantedSessions: 0 },
    polled,
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

test("an image pinned on a published host is handed out under the public host, its path and digest unchanged", async () => {
  const digest = `sha256:${"b".repeat(64)}`;
  const internal = {
    ...container,
    image: `registry.chuggy.internal/chuggy/worker@${digest}`,
  };
  const { assignment } = await reconciledOne(internal);
  assert.equal(
    assignment["image"],
    `registry.public.invalid/chuggy/worker@${digest}`,
  );
  const unpublished = await reconciledOne(internal, {
    ...settings,
    imageHosts: new Map(),
  });
  assert.equal(unpublished.assignment["image"], internal.image);
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

test("a room that is not a whole count refuses the poll", async () => {
  for (const room of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    for (const [asked, refusal] of [
      [{ held: [], wanted: room, wantedSessions: 0 }, /wanted must/u],
      [{ held: [], wanted: 0, wantedSessions: room }, /wantedSessions must/u],
    ] as const)
      await assert.rejects(
        () => workerPoolReconcile(idle, identity, asked, settings, () => "m"),
        refusal,
        JSON.stringify(asked),
      );
});

test("a pool reads sessions from the release that names them, and one from before is never handed one", () => {
  for (const [release, read] of [
    ["1.2.0", false],
    ["1.3.0", true],
    ["1.3.7", true],
    [undefined, false],
  ] as const)
    assert.equal(workerPoolSessionsRead(release), read, String(release));
  const reconciled = { assignments: [], sessions: [], stop: ["gone"] };
  assert.deepEqual(workerPoolReconciliationUnsessioned(reconciled), {
    assignments: [],
    stop: ["gone"],
  });
  assert.throws(
    () =>
      workerPoolReconciliationUnsessioned({
        ...reconciled,
        sessions: [
          {
            assignment: "session-1",
            capabilities: [],
            image: "registry.invalid/worker:1",
            cpuMillis: 1,
            memoryMib: 1,
            deadlineSecs: 1,
            callbackUrl: "https://plane.invalid",
            bearer: "chgs_session",
          },
        ],
      }),
    /reads no sessions/u,
  );
});

test("a held list longer than the bound is a refusal rather than a truncation", async () => {
  await assert.rejects(
    () =>
      workerPoolReconcile(
        idle,
        identity,
        { held: ["one", "two", "three"], wanted: 1, wantedSessions: 0 },
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
        { held: [], wanted: 1, wantedSessions: 0 },
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
    { held: [], wanted: 1, wantedSessions: 0 },
    settings,
    () => "minted",
  );
  assert.deepEqual(answered, { assignments: [], sessions: [], stop: [] });
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
    { held: ["one"], wanted: 1, wantedSessions: 0 },
    settings,
    () => "minted",
  );
  assert.deepEqual(answered.stop, ["one"]);
  assert.equal(passes, 1);
});
