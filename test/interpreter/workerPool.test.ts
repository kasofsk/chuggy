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
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  ProjectAccessUnavailable,
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { workerContractRelease } from "../../src/contract/workerContract.ts";
import {
  workerPoolHeldImages,
  workerPoolHeldNamedMax,
  workerPoolOwnersAskedMax,
  workerPoolPoll,
  workerPoolReconcile,
  workerPoolSettled,
  type WorkerPoolAssignments,
  type WorkerPoolAsked,
  type WorkerPoolClaimed,
  type WorkerPoolClaimTerms,
  type PoolPlaneIdentity,
  type WorkerPoolPollSettings,
  type WorkerPoolPorts,
  type WorkerPoolRunners,
} from "../../src/interpreter/workerPool.ts";
import {
  workerPoolSessionIdleSecs,
  type SessionLaunchFacts,
  type WorkerPoolSessionCandidate,
  type WorkerPoolSessionOpened,
  type WorkerPoolSessionOpening,
  type WorkerPoolSessions,
} from "../../src/interpreter/workerPoolSessions.ts";

const identity: PoolPlaneIdentity = {
  kind: "Dedicated",
  partition: { tenant: "tenant", project: "project" } as Partition,
  pool: "pool-one",
  principal: asPrincipal("principal-one"),
};

/** A member's personal runner in the same tenant, whose candidates span its allowlist. */
const runner: PoolPlaneIdentity = {
  kind: "Personal",
  tenant: asTenantId("tenant"),
  owner: asPrincipal("a-member"),
  principal: asPrincipal("chuggy-personal-one"),
};

/** The same member's chat host, whose candidates span every project of the tenant. */
const host: PoolPlaneIdentity = {
  kind: "ChatHost",
  tenant: asTenantId("tenant"),
  owner: asPrincipal("a-member"),
  principal: asPrincipal("chuggy-chat-host-one"),
};

/** An authority answering every project read for whoever asks. */
const reading: ProjectAccess = {
  authorize: (principal) => Promise.resolve(memberAuthority(principal)),
  authorizeTenant: () => Promise.resolve(undefined),
  authorizeSite: () => Promise.resolve(undefined),
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
  ownersDeferredTo: () => Promise.resolve([]),
  claimPersonal: () => Promise.resolve(undefined),
  waiting: () => Promise.resolve(false),
  waitingPersonal: () => Promise.resolve(false),
  allowlisted: () => Promise.resolve([]),
  polled: () => Promise.resolve(),
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

/** Where no runner a poll names is kept. */
const unkept: WorkerPoolRunners = { named: () => Promise.resolve() };

function ports(
  assignments: WorkerPoolAssignments = idle,
  store: WorkerPoolSessions = noSessions,
  mint: () => string = () => "minted",
  access: ProjectAccess = reading,
  runners: WorkerPoolRunners = unkept,
): WorkerPoolPorts {
  let minted = 0;
  return {
    assignments,
    access,
    runners,
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

/** What a pool asks with, holding nothing and wanting nothing unless told. */
function asked(over: Partial<WorkerPoolAsked> = {}): WorkerPoolAsked {
  return {
    held: [],
    wanted: 0,
    wantedSessions: 0,
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

/**
 * The one assignment a poll hands out when the durable side claims
 * `requirement`, beside the runtime and the size `claimed` names; and the
 * terms the claim was held to.
 */
async function reconciledOne(
  requirement: ExecutionRequirement,
  polled: WorkerPoolPollSettings = settings,
  claimed: Omit<WorkerPoolClaimed, "requirement"> = {},
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
          terms.length === 1 ? { requirement, ...claimed } : undefined,
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

/** The runtime an attempt kept, on the host the plane publishes under its public one. */
const runtime = `registry.chuggy.internal/chuggy/worker-runtime@sha256:${"e".repeat(64)}`;

test("a pool that reads a runtime is handed its attempt's, under the public host, beside the image and beside none", async () => {
  const hosted = `registry.public.invalid/chuggy/worker-runtime@sha256:${"e".repeat(64)}`;
  const pinned = await reconciledOne(container, settings, { runtime });
  assert.equal(pinned.assignment["runtime"], hosted);
  assert.equal(
    pinned.assignment["image"],
    `registry.invalid/worker@sha256:${"a".repeat(64)}`,
  );
  const capable = await reconciledOne(
    {
      mode: "Capability",
      operatingSystem: "Linux",
      architecture: "Amd64",
      capabilities: ["Agent:Codex"],
    },
    settings,
    { runtime },
  );
  assert.equal(capable.assignment["runtime"], hosted);
  assert.equal("image" in capable.assignment, false);
  const unpublished = await reconciledOne(
    container,
    { ...settings, imageHosts: new Map() },
    { runtime },
  );
  assert.equal(unpublished.assignment["runtime"], runtime);
});

test("an attempt that kept no runtime hands none to a pool", async () => {
  const unkept = await reconciledOne(container);
  assert.equal("runtime" in unkept.assignment, false);
  assert.equal(
    unkept.assignment["image"],
    `registry.invalid/worker@sha256:${"a".repeat(64)}`,
  );
});

test("an execution released with no size asks for the plane's box, and one released with a size asks for it field by field", async () => {
  const unsized = await reconciledOne(container);
  assert.deepEqual(
    [unsized.assignment["cpuMillis"], unsized.assignment["memoryMib"]],
    [settings.cpuMillis, settings.memoryMib],
  );
  const sized = await reconciledOne(container, settings, {
    resources: { cpuMillis: 8_000, memoryMib: 16_384 },
  });
  assert.deepEqual(
    [sized.assignment["cpuMillis"], sized.assignment["memoryMib"]],
    [8_000, 16_384],
  );
  const memoryOnly = await reconciledOne(container, settings, {
    resources: { memoryMib: 16_384 },
  });
  assert.deepEqual(
    [memoryOnly.assignment["cpuMillis"], memoryOnly.assignment["memoryMib"]],
    [settings.cpuMillis, 16_384],
  );
});

test("a capability requirement is handed out with its platform and capabilities and no image", async () => {
  const { assignment } = await reconciledOne({
    mode: "Capability",
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

test("capabilities a project named for itself reach the pool as it named them", async () => {
  const { assignment } = await reconciledOne({
    mode: "Capability",
    operatingSystem: "MacOS",
    architecture: "Arm64",
    capabilities: ["Tool:Xcode", "Simulator:iOS"],
  });
  assert.deepEqual(assignment["capabilities"], [
    "Platform:MacOS:Arm64",
    "Tool:Xcode",
    "Simulator:iOS",
  ]);
  assert.equal("image" in assignment, false);
});

test("a room, a memory ceiling, a memory room or a wait that is not a whole count refuses the poll", async () => {
  for (const room of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    for (const [over, refusal] of [
      [{ wanted: room }, /wanted must/u],
      [{ wantedSessions: room }, /wantedSessions must/u],
      [{ memoryCeilingMib: room }, /memoryCeilingMib must/u],
      [{ memoryRoomMib: room }, /memoryRoomMib must/u],
      [{ pollWaitSecs: room }, /pollWaitSecs must/u],
    ] as const)
      await assert.rejects(
        () => workerPoolPoll(ports(), identity, asked(over), settings),
        refusal,
        JSON.stringify(over),
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
  assert.equal(workerPoolHeldNamedMax(settings), 4);
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
  project: asProjectId("project"),
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

test("a chat host's declared idle bound is capped at the one the launch publishes, and none is read for a pool or a personal runner or under a launch publishing none", () => {
  const capped = { ...launch, idleSecsMax: 60 };
  assert.equal(workerPoolSessionIdleSecs(host, capped, 600), 60);
  assert.equal(workerPoolSessionIdleSecs(host, capped, 30), 30);
  assert.equal(workerPoolSessionIdleSecs(host, capped, undefined), undefined);
  assert.equal(workerPoolSessionIdleSecs(host, launch, 30), undefined);
  for (const other of [identity, runner])
    assert.equal(workerPoolSessionIdleSecs(other, capped, 30), undefined);
  assert.throws(() => workerPoolSessionIdleSecs(host, capped, 0), RangeError);
});

test("a chat host is claimed sessions alone, each in a project its owner may still read asked as its owner, and opened with its idle bound", async () => {
  const elsewhere = {
    ...candidate,
    project: asProjectId("elsewhere"),
    session: asSessionId("session-elsewhere"),
  };
  const { store, opened } = offering([candidate, elsewhere]);
  const reached: string[] = [];
  const answered = await workerPoolReconcile(
    ports(
      {
        ...idle,
        claim: () => Promise.resolve((reached.push("claim"), undefined)),
        claimPersonal: () =>
          Promise.resolve((reached.push("claimPersonal"), undefined)),
      },
      {
        ...store,
        launch: () => Promise.resolve({ ...launch, idleSecsMax: 60 }),
      },
      () => "assignment-host",
      {
        ...reading,
        authorize: (principal, partition, kind) => {
          reached.push(`${principal}:${partition.project}:${kind}`);
          return Promise.resolve(
            partition.project === "project"
              ? memberAuthority(principal)
              : undefined,
          );
        },
      },
    ),
    host,
    nothingHeld,
    { wanted: 1, wantedSessions: 2, idleSecs: 600 },
    settings,
  );
  assert.deepEqual(answered.assignments, []);
  assert.deepEqual(reached, [
    "a-member:project:Read",
    "a-member:elsewhere:Read",
  ]);
  assert.deepEqual(
    opened.map((opening) => [
      opening.candidate.session,
      opening.idleSecs,
      opening.launch.bounds.idleMs,
    ]),
    [[candidate.session, 60, 60_000]],
  );
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

test("only a poll from a pool able to take a session, to a plane able to hand one out, is recorded as one, once however long it waits", async () => {
  for (const [over, recordedOnce, terms] of [
    [{ wantedSessions: 1 }, true, settings],
    [{ held: ["s1"] }, true, settings],
    [{ wanted: 1 }, false, settings],
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

test("every poll the plane answers keeps the runner it named, or none where it named none, once however long it waits", async () => {
  const named = { package: "chuggy-linux", version: "0.14.0" };
  for (const [over, kept] of [
    [{ runner: named }, named],
    [{ wanted: 1, runner: named }, named],
    [{}, undefined],
  ] as const) {
    const recorded: unknown[] = [];
    await workerPoolPoll(
      ports(idle, noSessions, undefined, undefined, {
        named: (_identity, runner) => {
          recorded.push(runner);
          return Promise.resolve();
        },
      }),
      identity,
      asked(over),
      settings,
    );
    assert.deepEqual(recorded, [kept], JSON.stringify(over));
  }
  const refused: unknown[] = [];
  await workerPoolPoll(
    ports(idle, noSessions, undefined, undefined, {
      named: (_identity, runner) => {
        refused.push(runner);
        return Promise.resolve();
      },
    }),
    identity,
    asked({ held: ["j1", "j2", "j3"], runner: named }),
    settings,
  );
  assert.deepEqual(refused, [], "a poll refused whole keeps nothing");
});

test("a poll naming capabilities keeps them before anything is claimed, once however long it waits, and one naming none keeps none", async () => {
  const advertised = ["Platform:Linux:Amd64", "Tool:Bazel"];
  for (const [over, kept] of [
    [{ capabilities: advertised }, advertised],
    [{ capabilities: [] }, []],
    [{}, undefined],
  ] as const) {
    const made: unknown[] = [];
    await workerPoolPoll(
      ports(
        {
          ...idle,
          claim: () => {
            made.push("claim");
            return Promise.resolve(undefined);
          },
        },
        noSessions,
        undefined,
        undefined,
        {
          named: (_identity, _runner, capabilities) => {
            made.push(["named", capabilities]);
            return Promise.resolve();
          },
        },
      ),
      identity,
      asked({ wanted: 1, ...over }),
      settings,
    );
    assert.deepEqual(
      made,
      [["named", kept], "claim", "claim", "claim"],
      JSON.stringify(over),
    );
  }
});

test("a poll naming a memory ceiling keeps it before anything is claimed, and every claim is held to the plane's terms and its size for an execution naming none", async () => {
  for (const [over, kept] of [
    [{ memoryCeilingMib: 8_192 }, 8_192],
    [{ memoryCeilingMib: 0 }, 0],
    [{}, undefined],
  ] as const) {
    const made: unknown[] = [];
    await workerPoolPoll(
      ports(
        {
          ...idle,
          claim: (_identity, terms) => {
            made.push(["claim", terms]);
            return Promise.resolve(undefined);
          },
        },
        noSessions,
        undefined,
        undefined,
        {
          named: (_identity, _runner, _capabilities, ceiling) => {
            made.push(["named", ceiling]);
            return Promise.resolve();
          },
        },
      ),
      identity,
      asked({ wanted: 1, ...over }),
      { ...settings, pollsMax: 1 },
    );
    assert.deepEqual(
      made,
      [
        ["named", kept],
        [
          "claim",
          {
            leaseSecs: settings.leaseSecs,
            heldMax: settings.heldMax,
            memoryMibDefault: settings.memoryMib,
          },
        ],
      ],
      JSON.stringify(over),
    );
  }
});

/** A durable side holding jobs of `sizes` in MiB, or naming none, each claimed oldest first by a pool or by a runner in its one project where it fits the room the claim is given; and what it was asked. */
function sized(sizes: readonly (number | undefined)[]): {
  readonly reached: unknown[];
  readonly assignments: WorkerPoolAssignments;
} {
  const reached: unknown[] = [];
  const queue = [...sizes];
  const fits = (size: number | undefined, room: number | undefined) =>
    room === undefined || (size ?? settings.memoryMib) <= room;
  const claimed = ({ memoryRoomMib }: WorkerPoolClaimTerms) => {
    reached.push(["claim", memoryRoomMib]);
    const at = queue.findIndex((size) => fits(size, memoryRoomMib));
    if (at < 0) return undefined;
    const [size] = queue.splice(at, 1);
    return {
      requirement: container,
      ...(size === undefined ? {} : { resources: { memoryMib: size } }),
    };
  };
  const waiting = ({ memoryRoomMib }: WorkerPoolClaimTerms) => {
    reached.push(["waiting", memoryRoomMib]);
    return Promise.resolve(queue.some((size) => fits(size, memoryRoomMib)));
  };
  return {
    reached,
    assignments: {
      ...idle,
      claim: (_identity, terms) => Promise.resolve(claimed(terms)),
      waiting: (_identity, terms) => waiting(terms),
      allowlisted: () => Promise.resolve([asProjectId("project")]),
      claimPersonal: (_identity, terms) => {
        const row = claimed(terms);
        return Promise.resolve(
          row === undefined
            ? undefined
            : { ...row, project: asProjectId("project") },
        );
      },
      waitingPersonal: (_identity, terms) => waiting(terms),
    },
  };
}

/** The size an execution naming no memory is claimed at. */
const unsized = settings.memoryMib;

/** Jobs of each size, a room, and the sizes claimed, the claims and probe asked and the answer whether one more is waiting, for a poll wanting two. */
const roomCases = [
  [
    [3_000, 3_000],
    4_096,
    [3_000],
    [
      ["claim", 4_096],
      ["claim", 1_096],
    ],
    false,
  ],
  [
    [3_000, 3_000],
    6_000,
    [3_000, 3_000],
    [
      ["claim", 6_000],
      ["claim", 3_000],
      ["waiting", 0],
    ],
    false,
  ],
  [
    [3_000, 3_000, 3_000],
    9_000,
    [3_000, 3_000],
    [
      ["claim", 9_000],
      ["claim", 6_000],
      ["waiting", 3_000],
    ],
    true,
  ],
  [
    [undefined, undefined],
    2 * unsized - 1,
    [unsized],
    [
      ["claim", 2 * unsized - 1],
      ["claim", unsized - 1],
    ],
    false,
  ],
  [
    [3_000, 3_000],
    undefined,
    [3_000, 3_000],
    [
      ["claim", undefined],
      ["claim", undefined],
    ],
    undefined,
  ],
] as const;

test("each job a poll claims fits what the claims before it left of the room it named, a job naming no memory at the plane's size, and one naming no room is claimed by count, for a pool and for a personal runner", async () => {
  const callers: readonly PoolPlaneIdentity[] = [identity, runner];
  for (const [sizes, room, claimed, reached, waiting] of roomCases)
    for (const caller of callers) {
      const durable = sized(sizes);
      const answered = await workerPoolReconcile(
        ports(durable.assignments),
        caller,
        nothingHeld,
        {
          wanted: 2,
          wantedSessions: 0,
          ...(room === undefined ? {} : { memoryRoomMib: room }),
          contract: workerContractRelease,
        },
        settings,
      );
      const label = `${caller.kind} ${JSON.stringify(sizes)} in ${String(room)}`;
      assert.deepEqual(
        answered.assignments.map((taken) => taken.memoryMib),
        claimed,
        label,
      );
      assert.deepEqual(durable.reached, reached, label);
      assert.equal(answered.jobsWaiting, waiting, label);
    }
});

test("a claim that took a job larger than the room its poll named fails the poll rather than answering it", async () => {
  await assert.rejects(
    workerPoolReconcile(
      ports({
        ...idle,
        claim: () =>
          Promise.resolve({
            requirement: container,
            resources: { memoryMib: 4_097 },
          }),
      }),
      identity,
      nothingHeld,
      {
        wanted: 1,
        wantedSessions: 0,
        memoryRoomMib: 4_096,
        contract: workerContractRelease,
      },
      settings,
    ),
    /a worker pool claim took a job larger than its room/u,
  );
});

test("a poll wanting no job in a room of nothing is told none is waiting without a claim, a probe or a question of the authority, renews what it holds and waits out its poll, for a pool and for a personal runner", async () => {
  for (const caller of [identity, runner]) {
    const reached: string[] = [];
    let renewed = 0;
    const record =
      (step: string) =>
      <T>(value: T) =>
        Promise.resolve((reached.push(step), value));
    const answered = await workerPoolPoll(
      ports(
        {
          ...idle,
          ownersDeferredTo: () => record("owners")([asPrincipal("member")]),
          allowlisted: () => record("allowlisted")([asProjectId("project")]),
          claim: () => record("claim")(undefined),
          claimPersonal: () => record("claimPersonal")(undefined),
          waiting: () => record("waiting")(true),
          waitingPersonal: () => record("waitingPersonal")(true),
          renew: () => Promise.resolve((renewed += 1) > 0),
        },
        noSessions,
        () => "minted",
        {
          ...reading,
          authorize: () => record("authorize")(undefined),
          authorizeTenant: () => record("authorizeTenant")(undefined),
        },
      ),
      caller,
      asked({
        held: ["held-one"],
        memoryRoomMib: 0,
        contract: workerContractRelease,
      }),
      settings,
    );
    assert.deepEqual(
      answered,
      {
        polled: "Answered",
        answer: { assignments: [], jobsWaiting: false, sessions: [], stop: [] },
      },
      caller.kind,
    );
    assert.deepEqual(reached, [], caller.kind);
    assert.equal(renewed, settings.pollsMax, caller.kind);
  }
});

test("a poll naming its room whose release reads it is told whether a job it fits is waiting, a claim that took nothing answering no without asking, and any other poll is neither told nor asked", async () => {
  for (const [sizes, over, reached, waiting] of [
    [[3_000], { memoryRoomMib: 4_096 }, [["waiting", 4_096]], true],
    [[3_000], { memoryRoomMib: 2_048 }, [["waiting", 2_048]], false],
    [[3_000], {}, [], undefined],
    [[3_000], { memoryRoomMib: 4_096, contract: "1.20.0" }, [], undefined],
    [
      [3_000],
      { wanted: 1, memoryRoomMib: 4_096, contract: "1.20.0" },
      [["claim", 4_096]],
      undefined,
    ],
    [[5_000], { wanted: 1, memoryRoomMib: 4_096 }, [["claim", 4_096]], false],
  ] as const) {
    const durable = sized(sizes);
    const answered = await workerPoolReconcile(
      ports(durable.assignments),
      identity,
      nothingHeld,
      {
        wanted: 0,
        wantedSessions: 0,
        contract: workerContractRelease,
        ...over,
      },
      settings,
    );
    const label = JSON.stringify(over);
    assert.deepEqual(durable.reached, reached, label);
    assert.equal(answered.jobsWaiting, waiting, label);
    assert.equal("jobsWaiting" in answered, waiting !== undefined, label);
  }
});

test("a poll wanting no job is answered at once when one it fits is waiting, and waits out its bound when none is", async () => {
  for (const [room, passes, waiting] of [
    [4_096, 1, true],
    [2_048, settings.pollsMax, false],
  ] as const) {
    const durable = sized([3_000]);
    const answered = await workerPoolPoll(
      ports(durable.assignments),
      identity,
      asked({ memoryRoomMib: room, contract: workerContractRelease }),
      settings,
    );
    assert.deepEqual(answered, {
      polled: "Answered",
      answer: { assignments: [], jobsWaiting: waiting, sessions: [], stop: [] },
    });
    assert.equal(durable.reached.length, passes, String(room));
  }
});

test("a poll's wait bounds its passes: one where it is 0, those it leaves time for, and never more than the plane's own", async () => {
  const paced = { ...settings, pollIntervalMs: 400, pollsMax: 4 };
  for (const [over, polled, passes] of [
    [{ pollWaitSecs: 0 }, settings, 1],
    [{}, settings, settings.pollsMax],
    [{ pollWaitSecs: 1 }, settings, settings.pollsMax],
    [{ pollWaitSecs: 1 }, paced, 3],
  ] as const) {
    let claimed = 0;
    await workerPoolPoll(
      ports({
        ...idle,
        claim: () => Promise.resolve(void (claimed += 1)),
      }),
      identity,
      asked({ wanted: 1, ...over }),
      polled,
    );
    assert.equal(claimed, passes, JSON.stringify(over));
  }
});

test("a settlement is made against the kind its assignment is", async () => {
  const calls: string[] = [];
  const recording = (kind: string) => {
    const answer = (name: string, assignment: string) => {
      calls.push(`${kind}.${name}(${assignment})`);
      return Promise.resolve(true);
    };
    return {
      held: (_identity: unknown, assignment: string) =>
        answer("held", assignment),
      refuse: (_identity: unknown, assignment: string) =>
        answer("refuse", assignment),
      release: (_identity: unknown, assignment: string) =>
        answer("release", assignment),
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

test("an execution's refusal reaches its store with the image fault it names, and a session's with its evidence alone", async () => {
  const refusals: unknown[][] = [];
  const settling = ports(
    {
      ...idle,
      refuse: (_identity, assignment, evidence, fault) =>
        Promise.resolve(
          (refusals.push(["job", assignment, evidence, fault]), true),
        ),
    },
    holdingSessions(["s1"], {
      refuse: (...called: unknown[]) =>
        Promise.resolve((refusals.push(["session", ...called.slice(1)]), true)),
    }),
  );
  for (const assignment of ["j1", "s1"])
    assert.equal(
      await workerPoolSettled(settling, identity, assignment, {
        outcome: "Refused",
        evidence: "git: not found",
        fault: "ImageLacksGit",
      }),
      true,
    );
  assert.equal(
    await workerPoolSettled(settling, identity, "j2", {
      outcome: "Refused",
      evidence: "no node",
    }),
    true,
  );
  assert.deepEqual(refusals, [
    ["job", "j1", "git: not found", "ImageLacksGit"],
    ["session", "s1", "git: not found", undefined],
    ["job", "j2", "no node", undefined],
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

test("a chat host may pull the published session image while it holds nothing, and no other caller is given it", async () => {
  for (const [caller, images] of [
    [host, [launch.image]],
    [identity, []],
    [runner, []],
  ] as const)
    assert.deepEqual(
      await workerPoolHeldImages(ports(), caller, settings),
      images,
      caller.kind,
    );
  assert.deepEqual(await workerPoolHeldImages(ports(), host, unaddressed), []);
});

test("only a chat host's poll names the published session image, by the host it pulls it from, and none where no launch is published or no session is served", async () => {
  const chatImageOf = async (
    caller: PoolPlaneIdentity,
    store: WorkerPoolSessions = noSessions,
    terms: WorkerPoolPollSettings = settings,
  ): Promise<string | undefined> => {
    const polled = await workerPoolPoll(
      ports(idle, store),
      caller,
      asked(),
      terms,
    );
    if (polled.polled !== "Answered") throw new Error("a poll was refused");
    return polled.answer.chatImage;
  };
  assert.equal(
    await chatImageOf(host),
    `registry.public.invalid/chuggy/session@sha256:${"c".repeat(64)}`,
  );
  for (const other of [identity, runner])
    assert.equal(await chatImageOf(other), undefined, other.kind);
  assert.equal(
    await chatImageOf(host, {
      ...noSessions,
      launch: () => Promise.resolve(undefined),
    }),
    undefined,
  );
  assert.equal(await chatImageOf(host, noSessions, unaddressed), undefined);
});

test("a personal runner claims only in the projects it allowlists that its owner may still read, every one asked before any claim", async () => {
  const reached: string[] = [];
  const answered = await workerPoolReconcile(
    ports(
      {
        ...idle,
        claim: () => Promise.resolve((reached.push("pool"), undefined)),
        allowlisted: () =>
          Promise.resolve([asProjectId("project"), asProjectId("elsewhere")]),
        claimPersonal: (_identity, _terms, _assignment, _bearer, projects) => {
          reached.push(`claim:${projects.join(",")}`);
          return Promise.resolve({
            requirement: container,
            project: asProjectId("project"),
          });
        },
      },
      noSessions,
      () => "minted",
      {
        ...reading,
        authorize: (principal, partition, kind) => {
          reached.push(`${principal}:${partition.project}:${kind}`);
          return Promise.resolve(
            partition.project === "project"
              ? memberAuthority(principal)
              : undefined,
          );
        },
      },
    ),
    runner,
    nothingHeld,
    { wanted: 1, wantedSessions: 0 },
    settings,
  );
  assert.equal(answered.assignments.length, 1);
  assert.deepEqual(reached, [
    "a-member:project:Read",
    "a-member:elsewhere:Read",
    "claim:project",
  ]);
});

test("a personal runner's job names its own attempt's project to a poll whose release reads one, and a pool's session or an earlier release's poll none", async () => {
  /** What each poll's claims and sessions name of a project, by the release it offered. */
  const named = async (
    caller: PoolPlaneIdentity,
    contract: string | undefined,
  ) => {
    let claimed = 0;
    const { store } = offering([candidate]);
    const answered = await workerPoolReconcile(
      ports(
        {
          ...idle,
          claim: () => Promise.resolve({ requirement: container }),
          allowlisted: () =>
            Promise.resolve([asProjectId("project"), asProjectId("elsewhere")]),
          claimPersonal: () => {
            claimed += 1;
            return Promise.resolve({
              requirement: container,
              project: asProjectId(claimed === 1 ? "project" : "elsewhere"),
            });
          },
        },
        store,
      ),
      caller,
      nothingHeld,
      {
        wanted: 2,
        wantedSessions: 1,
        ...(contract === undefined ? {} : { contract }),
      },
      settings,
    );
    return [...answered.assignments, ...answered.sessions].map((assignment) =>
      "project" in assignment ? assignment.project : "none",
    );
  };
  assert.deepEqual(await named(runner, workerContractRelease), [
    "project",
    "elsewhere",
  ]);
  for (const contract of ["1.14.0", undefined])
    assert.deepEqual(await named(runner, contract), ["none", "none"]);
  assert.deepEqual(await named(identity, workerContractRelease), [
    "none",
    "none",
    "none",
  ]);
});

test("a personal runner whose owner may read nothing it allowlists claims nothing, and is told nothing is waiting without asking", async () => {
  for (const wanted of [1, 0]) {
    const reached: string[] = [];
    const answered = await workerPoolReconcile(
      ports(
        {
          ...idle,
          allowlisted: () => Promise.resolve([asProjectId("project")]),
          claimPersonal: () => {
            reached.push("claim");
            return Promise.resolve({
              requirement: container,
              project: asProjectId("project"),
            });
          },
          waitingPersonal: () => {
            reached.push("waiting");
            return Promise.resolve(true);
          },
        },
        noSessions,
        () => "minted",
        { ...reading, authorize: () => Promise.resolve(undefined) },
      ),
      runner,
      nothingHeld,
      {
        wanted,
        wantedSessions: 0,
        memoryRoomMib: 4_096,
        contract: workerContractRelease,
      },
      settings,
    );
    assert.deepEqual(answered.assignments, [], String(wanted));
    assert.equal(answered.jobsWaiting, false, String(wanted));
    assert.deepEqual(reached, [], String(wanted));
  }
});

test("a pool's claim and its probe name revoked each owner it would defer to who lost their permit or their Read, and ask of no more owners than its bound", async () => {
  const kept = asPrincipal("member-kept");
  const unpermitted = asPrincipal("member-unpermitted");
  const unreading = asPrincipal("member-unreading");
  const asked: unknown[] = [];
  await workerPoolReconcile(
    ports(
      {
        ...idle,
        ownersDeferredTo: (_identity, max) => {
          asked.push(max);
          return Promise.resolve([kept, unpermitted, unreading]);
        },
        claim: (_identity, _terms, _assignment, _bearer, revoked) => {
          asked.push(revoked);
          return Promise.resolve({ requirement: container });
        },
        waiting: (_identity, _terms, revoked) => {
          asked.push(revoked);
          return Promise.resolve(false);
        },
      },
      noSessions,
      () => "minted",
      {
        ...reading,
        authorizeTenant: (principal, _tenant, kind) =>
          Promise.resolve(
            principal !== unpermitted && kind === "RegisterPersonalRunner"
              ? memberAuthority(principal)
              : undefined,
          ),
        authorize: (principal, _partition, kind) =>
          Promise.resolve(
            principal !== unreading && kind === "Read"
              ? memberAuthority(principal)
              : undefined,
          ),
      },
    ),
    identity,
    nothingHeld,
    {
      wanted: 1,
      wantedSessions: 0,
      memoryRoomMib: 4_096,
      contract: workerContractRelease,
    },
    settings,
  );
  assert.deepEqual(asked, [
    workerPoolOwnersAskedMax,
    [unpermitted, unreading],
    [unpermitted, unreading],
  ]);
});

test("each poll asks the owners' window under a rotation it draws afresh, so a revoked owner outside one poll's window is named revoked by a later one", async () => {
  const kept = asPrincipal("member-kept");
  const revoked = asPrincipal("member-revoked");
  const rotations: string[] = [];
  const named: (readonly Principal[])[] = [];
  let drawn = 0;
  const polling = ports(
    {
      ...idle,
      ownersDeferredTo: (_identity, _max, rotation) => {
        rotations.push(rotation);
        return Promise.resolve(
          rotation === "draw-1" ? [kept] : [kept, revoked],
        );
      },
      claim: (_identity, _terms, _assignment, _bearer, ownersRevoked) => {
        named.push(ownersRevoked);
        return Promise.resolve(undefined);
      },
    },
    noSessions,
    () => {
      drawn += 1;
      return `draw-${String(drawn)}`;
    },
    {
      ...reading,
      authorizeTenant: (principal, _tenant, kind) =>
        Promise.resolve(
          principal !== revoked && kind === "RegisterPersonalRunner"
            ? memberAuthority(principal)
            : undefined,
        ),
    },
  );
  for (let poll = 0; poll < 2; poll += 1)
    await workerPoolReconcile(
      polling,
      identity,
      nothingHeld,
      { wanted: 1, wantedSessions: 0 },
      settings,
    );
  assert.equal(new Set(rotations).size, 2, "each poll drew its own rotation");
  assert.deepEqual(named, [[], [revoked]]);
});

test("a caller with no room asks the authority nothing and claims nothing", async () => {
  const reached: string[] = [];
  const access: ProjectAccess = {
    ...reading,
    authorize: () => Promise.resolve((reached.push("authorize"), undefined)),
    authorizeTenant: () =>
      Promise.resolve((reached.push("authorizeTenant"), undefined)),
  };
  for (const caller of [identity, runner])
    await workerPoolReconcile(
      ports(
        {
          ...idle,
          ownersDeferredTo: () =>
            Promise.resolve((reached.push("owners"), [asPrincipal("member")])),
          allowlisted: () =>
            Promise.resolve((reached.push("allowlisted"), [asProjectId("p")])),
        },
        noSessions,
        () => "minted",
        access,
      ),
      caller,
      nothingHeld,
      { wanted: 0, wantedSessions: 0 },
      settings,
    );
  assert.deepEqual(reached, []);
});

test("a personal runner renews, settles and pulls the images of its executions through its own identity, and asks the session store nothing", async () => {
  const reached: string[] = [];
  const asking = (call: string) => (): Promise<never> =>
    Promise.reject(new Error(`a personal runner asked sessions ${call}`));
  const sessions: WorkerPoolSessions = {
    ...noSessions,
    among: asking("among"),
    renew: asking("renew"),
    held: asking("held"),
    heldImages: asking("heldImages"),
    polled: asking("polled"),
  };
  const executions: WorkerPoolAssignments = {
    ...idle,
    renew: (caller, assignment) =>
      Promise.resolve(
        (reached.push(`renew:${caller.kind}:${assignment}`),
        assignment === "live"),
      ),
    held: (caller, assignment) =>
      Promise.resolve(
        (reached.push(`held:${caller.kind}:${assignment}`), true),
      ),
    heldImages: (caller) =>
      Promise.resolve((reached.push(`images:${caller.kind}`), ["job-image"])),
  };
  const polled = await workerPoolPoll(
    ports(executions, sessions),
    runner,
    asked({ held: ["live", "gone"], wantedSessions: 1 }),
    { ...settings, pollsMax: 1 },
  );
  assert.ok(polled.polled === "Answered");
  assert.deepEqual(polled.answer.stop, ["gone"]);
  assert.equal(
    await workerPoolSettled(ports(executions, sessions), runner, "live", {
      outcome: "Accepted",
    }),
    true,
  );
  assert.deepEqual(
    await workerPoolHeldImages(ports(executions, sessions), runner, settings),
    ["job-image"],
  );
  assert.deepEqual(reached, [
    "renew:Personal:live",
    "renew:Personal:gone",
    "held:Personal:live",
    "images:Personal",
  ]);
});

test("a personal runner's every poll is recorded, and a pool's or a personal runner's as one that could take an execution where it has room for one, holds one or names a memory room above nothing, a personal runner's never as one that could take a session, and a chat host's not at all", async () => {
  for (const [caller, over, recorded] of [
    [runner, { wanted: 1 }, ["executions"]],
    [runner, { held: ["j1"] }, ["executions"]],
    [runner, { memoryRoomMib: 1 }, ["executions"]],
    [runner, { memoryRoomMib: 0 }, ["polled"]],
    [identity, { memoryRoomMib: 4_096 }, ["executions"]],
    [identity, { memoryRoomMib: 0 }, []],
    [runner, {}, ["polled"]],
    [identity, {}, []],
    [runner, { wantedSessions: 1 }, ["polled"]],
    [runner, { wanted: 1, wantedSessions: 1 }, ["executions"]],
    [identity, { wanted: 1 }, ["executions"]],
    [identity, { held: ["j1"] }, ["executions"]],
    [host, { wanted: 1 }, []],
  ] as const) {
    const reached: string[] = [];
    await workerPoolPoll(
      ports(
        {
          ...idle,
          polled: (_, executions) =>
            Promise.resolve(
              void reached.push(executions ? "executions" : "polled"),
            ),
        },
        {
          ...noSessions,
          polled: () => Promise.resolve(void reached.push("sessions")),
        },
      ),
      caller,
      asked(over),
      { ...settings, pollsMax: 1 },
    );
    assert.deepEqual(
      reached,
      recorded,
      `${caller.kind} ${JSON.stringify(over)}`,
    );
  }
});

test("a personal runner is claimed no session, its poll reading none, asking the authority nothing and opening nothing, whatever room for one it names", async () => {
  const { store, opened, asked: awaited } = offering([candidate]);
  const asked: string[] = [];
  const access: ProjectAccess = {
    ...reading,
    authorize: (principal, partition, kind) => {
      asked.push(`${principal}:${partition.project}:${kind}`);
      return Promise.resolve(memberAuthority(principal));
    },
  };
  for (const contract of [workerContractRelease, undefined]) {
    const answered = await workerPoolReconcile(
      ports(idle, store, () => "minted", access),
      runner,
      nothingHeld,
      {
        wanted: 0,
        wantedSessions: 2,
        ...(contract === undefined ? {} : { contract }),
      },
      settings,
    );
    assert.deepEqual(answered.sessions, []);
  }
  assert.deepEqual(awaited, []);
  assert.deepEqual(asked, []);
  assert.deepEqual(opened, []);
});

test("a personal runner wanting a job and a session is claimed its job alone, where its owner's chat host asking the same is claimed the session alone", async () => {
  const claimedFor = async (caller: PoolPlaneIdentity) => {
    const { store } = offering([candidate]);
    const answered = await workerPoolReconcile(
      ports(
        {
          ...idle,
          allowlisted: () => Promise.resolve([asProjectId("project")]),
          claimPersonal: () =>
            Promise.resolve({
              requirement: container,
              project: asProjectId("project"),
            }),
        },
        store,
      ),
      caller,
      nothingHeld,
      { wanted: 1, wantedSessions: 1, contract: workerContractRelease },
      settings,
    );
    return [answered.assignments.length, answered.sessions.length];
  };
  assert.deepEqual(await claimedFor(runner), [1, 0]);
  assert.deepEqual(await claimedFor(host), [0, 1]);
});

test("a chat host whose owner's authority cannot answer opens nothing", async () => {
  const { store, opened } = offering([candidate]);
  const access: ProjectAccess = {
    ...reading,
    authorize: () => {
      throw new ProjectAccessUnavailable("the authority is unreachable");
    },
  };
  await assert.rejects(
    workerPoolReconcile(
      ports(idle, store, () => "minted", access),
      host,
      nothingHeld,
      { wanted: 0, wantedSessions: 1 },
      settings,
    ),
    ProjectAccessUnavailable,
  );
  assert.deepEqual(opened, []);
});
