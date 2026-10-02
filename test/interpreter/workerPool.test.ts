import assert from "node:assert/strict";
import test from "node:test";

import {
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  asSessionId,
} from "../../src/interpreter/agentSession.ts";
import type { ExecutionRequirement } from "../../src/interpreter/executionRequirement.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asRecoveryEpoch,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  workerPoolHeldImages,
  workerPoolHeldNamedMax,
  workerPoolPoll,
  workerPoolReconcile,
  workerPoolReconciliationUnsessioned,
  workerPoolSessionsRead,
  workerPoolSettled,
  type WorkerPoolAssignments,
  type WorkerPoolAsked,
  type WorkerPoolClaimTerms,
  type WorkerPoolIdentity,
  type WorkerPoolPollSettings,
  type WorkerPoolPorts,
} from "../../src/interpreter/workerPool.ts";
import type {
  SessionLaunchFacts,
  WorkerPoolSessionCandidate,
  WorkerPoolSessionOpened,
  WorkerPoolSessionOpening,
  WorkerPoolSessions,
} from "../../src/interpreter/workerPoolSessions.ts";

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

/** A plane's settings naming no API a session could reach. */
const unaddressed: WorkerPoolPollSettings = {
  leaseSecs: 30,
  cpuMillis: 500,
  memoryMib: 256,
  assignmentsPerPollMax: 2,
  heldMax: 2,
  sessionsPerPollMax: 2,
  sessionsHeldMax: 2,
  deadlineSecs: 600,
  callbackUrl: "https://plane.invalid/v1/ticket-execution",
  pollIntervalMs: 1,
  pollsMax: 3,
  imageHosts: new Map([
    ["registry.chuggy.internal", "registry.public.invalid"],
  ]),
};

const settings: WorkerPoolPollSettings = {
  ...unaddressed,
  sessionApiUrl: "https://api.invalid/",
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

const launch: SessionLaunchFacts = {
  image: `registry.chuggy.internal/chuggy/session@sha256:${"c".repeat(64)}`,
  authority: {
    tools: ["Read"],
    credentials: [],
    network: true,
    filesystem: "ReadWorkspace",
    mayCompleteTask: false,
  },
  mirrors: {
    [asRepositoryId("github.com/owner/repo")]: asRepositoryId(
      "mirror.invalid/owner/repo",
    ),
  },
  bounds: {
    mailboxPollMs: 1,
    idleMs: 2,
    resultDrainMs: 3,
    loadTimeoutMs: 4,
    turnsMax: 5,
    budgetUsd: 6,
  },
  model: "session-model",
  deadlineSecs: 900,
  placementBackoffSecs: 7,
};

/** A session store holding no session attempt and offering none, under a published launch. */
const noSessions: WorkerPoolSessions = {
  launch: () => Promise.resolve(launch),
  among: () => Promise.resolve(new Set()),
  awaiting: () => Promise.resolve([]),
  open: () => Promise.resolve("NotClaimable"),
  renew: () => Promise.resolve(true),
  held: () => Promise.resolve(false),
  refuse: () => Promise.resolve(false),
  release: () => Promise.resolve(false),
  heldImages: () => Promise.resolve([]),
  polled: () => Promise.resolve(),
};

function ports(
  assignments: WorkerPoolAssignments = idle,
  store: WorkerPoolSessions = noSessions,
  mint: () => string = () => "minted",
): WorkerPoolPorts {
  let minted = 0;
  return {
    assignments,
    sessions: {
      store,
      bindings: {
        binding: (partition) =>
          Promise.resolve({
            partition,
            repository: asRepositoryId("github.com/owner/repo"),
            recoveryEpoch: asRecoveryEpoch("epoch"),
          }),
      },
      bearers: {
        mint: () => {
          minted += 1;
          return {
            attempt: asSessionAttemptId(`attempt-${String(minted)}`),
            bearer: {
              id: asSessionBearerId(`bearer-${String(minted)}`),
              secret: asSessionBearerSecret(
                `chgs_${String(minted).repeat(64)}`,
              ),
            },
            bearerSecretDigest: "d".repeat(64),
          };
        },
      },
    },
    mint,
  };
}

/** What a pool that reads sessions asks with, holding nothing and wanting nothing unless told. */
function asked(over: Partial<WorkerPoolAsked> = {}): WorkerPoolAsked {
  return {
    held: [],
    wanted: 0,
    wantedSessions: 0,
    readsSessions: true,
    ...over,
  };
}

const nothingHeld = { jobs: [], sessions: [] };

test("a claim is asked for only as far as the pool's remaining room", async () => {
  let asked = 0;
  const answered = await workerPoolReconcile(
    ports({
      ...idle,
      claim: () => {
        asked += 1;
        return Promise.resolve({ requirement: container });
      },
    }),
    identity,
    { jobs: ["one"], sessions: [] },
    { wanted: settings.assignmentsPerPollMax, wantedSessions: 0 },
    settings,
  );
  assert.equal(asked, 1);
  assert.equal(answered.assignments.length, 1);
});

test("a pool wanting none is claimed nothing and still renewed and told what to stop", async () => {
  let asked = 0;
  const renewed: string[] = [];
  const answered = await workerPoolReconcile(
    ports({
      ...idle,
      claim: () => {
        asked += 1;
        return Promise.resolve({ requirement: container });
      },
      renew: (_identity, assignment) => {
        renewed.push(assignment);
        return Promise.resolve(assignment === "live");
      },
    }),
    identity,
    { jobs: ["live", "gone"], sessions: [] },
    { wanted: 0, wantedSessions: 0 },
    { ...settings, heldMax: 4 },
  );
  assert.equal(asked, 0);
  assert.deepEqual(renewed, ["live", "gone"]);
  assert.deepEqual(answered, { assignments: [], sessions: [], stop: ["gone"] });
});

test("a pool wanting more than the plane allows is claimed the plane's bound", async () => {
  const claiming = ports({
    ...idle,
    claim: () => Promise.resolve({ requirement: container }),
  });
  const wanted = {
    wanted: settings.assignmentsPerPollMax + 5,
    wantedSessions: 0,
  };
  const perPoll = await workerPoolReconcile(
    claiming,
    identity,
    nothingHeld,
    wanted,
    { ...settings, heldMax: 10 },
  );
  assert.equal(perPoll.assignments.length, settings.assignmentsPerPollMax);
  const room = await workerPoolReconcile(
    claiming,
    identity,
    { jobs: ["one"], sessions: [] },
    wanted,
    { ...settings, assignmentsPerPollMax: 10 },
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
    ports({
      ...idle,
      claim: (_identity, held) => {
        terms.push(held);
        return Promise.resolve(
          terms.length === 1 ? { requirement } : undefined,
        );
      },
    }),
    identity,
    nothingHeld,
    { wanted: 1, wantedSessions: 0 },
    polled,
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
    for (const [over, refusal] of [
      [{ wanted: room }, /wanted must/u],
      [{ wantedSessions: room }, /wantedSessions must/u],
    ] as const)
      await assert.rejects(
        () => workerPoolPoll(ports(), identity, asked(over), settings),
        refusal,
        JSON.stringify(over),
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

/** A session store whose `among` names `sessions` as its own. */
function holdingSessions(
  sessions: readonly string[],
  over: Partial<WorkerPoolSessions> = {},
): WorkerPoolSessions {
  return {
    ...noSessions,
    among: (_identity, named) =>
      Promise.resolve(new Set(named.filter((one) => sessions.includes(one)))),
    ...over,
  };
}

test("a held list longer than either kind's bound is refused whole rather than cut, each kind against its own", async () => {
  const store = holdingSessions(["s1", "s2", "s3"]);
  for (const [held, refused] of [
    [["j1", "j2", "j3"], true],
    [["s1", "s2", "s3"], true],
    [["j1", "j2", "s1", "s2"], false],
  ] as const)
    assert.equal(
      (
        await workerPoolPoll(ports(idle, store), identity, asked({ held }), {
          ...settings,
          pollsMax: 1,
        })
      ).polled === "HeldOverBound",
      refused,
      held.join(","),
    );
  assert.equal(workerPoolHeldNamedMax(settings, true), 4);
  assert.equal(workerPoolHeldNamedMax(settings, false), 2);
});

test("a bound that is not a positive whole number refuses the poll", async () => {
  for (const bound of [
    "pollIntervalMs",
    "sessionsPerPollMax",
    "sessionsHeldMax",
  ] as const)
    await assert.rejects(
      () =>
        workerPoolPoll(ports(), identity, asked({ wanted: 1 }), {
          ...settings,
          [bound]: 0,
        }),
      new RegExp(`${bound} must be a positive safe integer`, "u"),
    );
});

test("a long poll reconciles to its bound and answers empty rather than waiting on", async () => {
  let passes = 0;
  const answered = await workerPoolPoll(
    ports({
      ...idle,
      claim: () => {
        passes += 1;
        return Promise.resolve(undefined);
      },
    }),
    identity,
    asked({ wanted: 1 }),
    settings,
  );
  assert.deepEqual(answered, {
    polled: "Answered",
    answer: { assignments: [], sessions: [], stop: [] },
  });
  assert.equal(passes, settings.pollsMax);
});

test("a long poll stops at the first pass with a stop flag to deliver", async () => {
  let passes = 0;
  const answered = await workerPoolPoll(
    ports({
      ...idle,
      renew: () => {
        passes += 1;
        return Promise.resolve(false);
      },
    }),
    identity,
    asked({ held: ["one"], wanted: 1 }),
    settings,
  );
  assert.equal(answered.polled, "Answered");
  assert.deepEqual(answered.polled === "Answered" ? answered.answer.stop : [], [
    "one",
  ]);
  assert.equal(passes, 1);
});

const candidate: WorkerPoolSessionCandidate = {
  session: asSessionId("session-one"),
  kind: "Thread",
  capabilities: ["RepositoryRead"],
  agentReference: "runtime-one",
};

/** A store offering `offered` and opening each as `answers` says in turn, recording what it was asked to open. */
function offering(
  offered: readonly WorkerPoolSessionCandidate[],
  answers: readonly WorkerPoolSessionOpened[] = [],
): {
  store: WorkerPoolSessions;
  opened: WorkerPoolSessionOpening[];
  asked: number[];
} {
  const opened: WorkerPoolSessionOpening[] = [];
  const awaited: number[] = [];
  return {
    opened,
    asked: awaited,
    store: {
      ...noSessions,
      awaiting: (_identity, _backoff, max) => {
        awaited.push(max);
        return Promise.resolve(offered.slice(0, max));
      },
      open: (_identity, opening) => {
        opened.push(opening);
        return Promise.resolve(answers[opened.length - 1] ?? "Opened");
      },
    },
  };
}

test("a claimed session is opened with its invocation and launch and handed out on the plane's own terms", async () => {
  const { store, opened } = offering([candidate]);
  const answered = await workerPoolReconcile(
    ports(idle, store, () => "assignment-one"),
    identity,
    nothingHeld,
    { wanted: 0, wantedSessions: 1 },
    settings,
  );
  assert.deepEqual(answered.sessions, [
    {
      assignment: "assignment-one",
      capabilities: [],
      image: `registry.public.invalid/chuggy/session@sha256:${"c".repeat(64)}`,
      cpuMillis: settings.cpuMillis,
      memoryMib: settings.memoryMib,
      deadlineSecs: launch.deadlineSecs,
      callbackUrl: settings.callbackUrl,
      bearer: `chgs_${"1".repeat(64)}`,
    },
  ]);
  assert.deepEqual(opened, [
    {
      candidate,
      attempt: "attempt-1",
      assignment: "assignment-one",
      bearer: "bearer-1",
      bearerSecretDigest: "d".repeat(64),
      leaseSecs: settings.leaseSecs,
      placementBackoffSecs: launch.placementBackoffSecs,
      heldMax: settings.sessionsHeldMax,
      invocation: {
        capabilities: ["RepositoryRead"],
        agentReference: "runtime-one",
        authority: launch.authority,
        repository: { reference: "mirror.invalid/owner/repo" },
      },
      image: launch.image,
      launch: {
        api: { url: settings.sessionApiUrl },
        bounds: launch.bounds,
        model: launch.model,
      },
    },
  ]);
});

test("a session is claimed only up to the least of the pool's room, the per-poll bound and what the held bound leaves", async () => {
  const many = ["a", "b", "c", "d", "e"].map((name) => ({
    ...candidate,
    session: asSessionId(name),
  }));
  for (const [wantedSessions, held, over, claimed] of [
    [1, [], {}, 1],
    [5, [], { sessionsHeldMax: 10 }, settings.sessionsPerPollMax],
    [5, ["s1"], { sessionsPerPollMax: 10 }, settings.sessionsHeldMax - 1],
    [5, ["s1", "s2"], { sessionsPerPollMax: 10 }, 0],
    [0, [], {}, 0],
  ] as const) {
    const { store } = offering(many);
    const answered = await workerPoolReconcile(
      ports(idle, store),
      identity,
      { jobs: [], sessions: held },
      { wanted: 0, wantedSessions },
      { ...settings, ...over },
    );
    assert.equal(
      answered.sessions.length,
      claimed,
      JSON.stringify({ wantedSessions, held, over }),
    );
  }
});

test("a session another claim took is skipped, and a pool the durable side finds full ends the claims", async () => {
  const two = [candidate, { ...candidate, session: asSessionId("two") }];
  const skipped = offering(two, ["NotClaimable", "Opened"]);
  const one = await workerPoolReconcile(
    ports(idle, skipped.store),
    identity,
    nothingHeld,
    { wanted: 0, wantedSessions: 2 },
    settings,
  );
  assert.equal(one.sessions.length, 1);
  assert.equal(skipped.opened.length, 2);
  const full = offering(two, ["PoolFull", "Opened"]);
  const none = await workerPoolReconcile(
    ports(idle, full.store),
    identity,
    nothingHeld,
    { wanted: 0, wantedSessions: 2 },
    settings,
  );
  assert.equal(none.sessions.length, 0);
  assert.equal(full.opened.length, 1);
});

test("a plane naming no session API, or with no launch published, claims no session and asks for none", async () => {
  const unnamed = offering([candidate]);
  assert.deepEqual(
    (
      await workerPoolReconcile(
        ports(idle, unnamed.store),
        identity,
        nothingHeld,
        { wanted: 0, wantedSessions: 1 },
        unaddressed,
      )
    ).sessions,
    [],
  );
  assert.deepEqual(unnamed.asked, []);
  const unpublished = offering([candidate]);
  assert.deepEqual(
    (
      await workerPoolReconcile(
        ports(idle, {
          ...unpublished.store,
          launch: () => Promise.resolve(undefined),
        }),
        identity,
        nothingHeld,
        { wanted: 0, wantedSessions: 1 },
        settings,
      )
    ).sessions,
    [],
  );
  assert.deepEqual(unpublished.asked, []);
});

test("each kind a pool holds is renewed through its own rows, and a session no longer live is on stop", async () => {
  const renewedJobs: string[] = [];
  const renewedSessions: string[] = [];
  const polled = await workerPoolPoll(
    ports(
      {
        ...idle,
        renew: (_identity, assignment) => {
          renewedJobs.push(assignment);
          return Promise.resolve(true);
        },
      },
      holdingSessions(["s-live", "s-gone"], {
        renew: (_identity, assignment) => {
          renewedSessions.push(assignment);
          return Promise.resolve(assignment === "s-live");
        },
      }),
    ),
    identity,
    asked({ held: ["job", "s-live", "s-gone"] }),
    settings,
  );
  assert.deepEqual(renewedJobs, ["job"]);
  assert.deepEqual(renewedSessions, ["s-live", "s-gone"]);
  assert.deepEqual(
    polled.polled === "Answered" ? polled.answer.stop : undefined,
    ["s-gone"],
  );
});

test("a pool whose release reads no sessions is asked nothing of sessions, claimed none, and not recorded as polling", async () => {
  const { store, asked: awaited } = offering([candidate]);
  let classified = 0;
  let recorded = 0;
  const polled = await workerPoolPoll(
    ports(idle, {
      ...store,
      among: () => {
        classified += 1;
        return Promise.resolve(new Set(["held"]));
      },
      polled: () => {
        recorded += 1;
        return Promise.resolve();
      },
    }),
    identity,
    asked({ held: ["held"], wantedSessions: 3, readsSessions: false }),
    { ...settings, pollsMax: 1 },
  );
  assert.equal(polled.polled, "Answered");
  assert.deepEqual(
    polled.polled === "Answered" ? polled.answer.sessions : undefined,
    [],
  );
  assert.equal(classified, 0);
  assert.deepEqual(awaited, []);
  assert.equal(recorded, 0);
});

test("only a poll from a pool able to take a session, to a plane able to hand one out, is recorded as one, once however long it waits", async () => {
  for (const [over, recordedOnce, terms] of [
    [{ wantedSessions: 1 }, true, settings],
    [{ held: ["s1"] }, true, settings],
    [{ wanted: 1 }, false, settings],
    [{ wantedSessions: 1, readsSessions: false }, false, settings],
    [{ wantedSessions: 2 }, false, unaddressed],
  ] as const) {
    let recorded = 0;
    await workerPoolPoll(
      ports(
        idle,
        holdingSessions(["s1"], {
          polled: () => {
            recorded += 1;
            return Promise.resolve();
          },
        }),
      ),
      identity,
      asked(over),
      terms,
    );
    assert.equal(recorded, recordedOnce ? 1 : 0, JSON.stringify(over));
  }
});

test("a settlement is made against the kind its assignment is", async () => {
  const calls: string[] = [];
  const recording = (
    kind: string,
  ): Pick<WorkerPoolAssignments, "held" | "refuse" | "release"> => {
    const answer = (name: string, assignment: string) => {
      calls.push(`${kind}.${name}(${assignment})`);
      return Promise.resolve(true);
    };
    return {
      held: (_identity, assignment) => answer("held", assignment),
      refuse: (_identity, assignment) => answer("refuse", assignment),
      release: (_identity, assignment) => answer("release", assignment),
    };
  };
  const settling = ports(
    { ...idle, ...recording("job") },
    holdingSessions(["s1"], recording("session")),
  );
  for (const assignment of ["s1", "j1"]) {
    await workerPoolSettled(settling, identity, assignment, {
      outcome: "Accepted",
    });
    await workerPoolSettled(settling, identity, assignment, {
      outcome: "Refused",
      evidence: "no",
    });
    await workerPoolSettled(settling, identity, assignment, {
      outcome: "Unavailable",
    });
  }
  assert.deepEqual(calls, [
    "session.held(s1)",
    "session.refuse(s1)",
    "session.release(s1)",
    "job.held(j1)",
    "job.refuse(j1)",
    "job.release(j1)",
  ]);
});

test("the images a pool may pull are those of what it holds of either kind, each kind to its own bound", async () => {
  const bounds: string[] = [];
  assert.deepEqual(
    await workerPoolHeldImages(
      ports(
        {
          ...idle,
          heldImages: (_identity, max) => {
            bounds.push(`job:${String(max)}`);
            return Promise.resolve(["job-image"]);
          },
        },
        {
          ...noSessions,
          heldImages: (_identity, max) => {
            bounds.push(`session:${String(max)}`);
            return Promise.resolve(["session-image"]);
          },
        },
      ),
      identity,
      { ...settings, heldMax: 3, sessionsHeldMax: 5 },
    ),
    ["job-image", "session-image"],
  );
  assert.deepEqual(bounds, ["job:3", "session:5"]);
});
