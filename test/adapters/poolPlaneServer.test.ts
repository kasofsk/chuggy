import assert from "node:assert/strict";
import { test } from "node:test";

import { planeBodyBytesDefault } from "../../src/adapters/http/planeRoutes.ts";
import {
  createPoolPlaneApp,
  poolPlaneSettlementBytesMax,
} from "../../src/adapters/http/poolPlaneServer.ts";
import type { PoolPlaneService } from "../../src/adapters/http/poolPlaneServer.ts";
import {
  contractVersionRefusalSchema,
  contractVersionRefusalStatus,
  workerContractHeader,
  workerContractRelease,
  workerContractVersionText,
} from "../../src/contract/workerContract.ts";
import {
  workerPoolEvidenceCharsMax,
  workerPoolPollQuery,
  workerPoolPollRoute,
  workerPoolReconciliationSchema,
  workerPoolSettlementPath,
  workerRunnerCapabilitiesHeader,
  workerRunnerHeader,
  workerRunnerMemoryCeilingHeader,
  workerRunnerMemoryRoomHeader,
  workerRunnerPollWaitHeader,
} from "../../src/contract/workerPool.ts";
import {
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  asSessionId,
} from "../../src/interpreter/agentSession.ts";
import { workerContractAccepted } from "../../src/interpreter/workerPlane.ts";
import type {
  PersonalRunnerIdentity,
  PoolPlaneIdentity,
  WorkerPoolAssignments,
  WorkerPoolIdentity,
  WorkerPoolRunners,
} from "../../src/interpreter/workerPool.ts";
import { workerRunnerReleasesRead } from "../../src/interpreter/workerRunnerRelease.ts";
import type {
  SessionLaunchFacts,
  WorkerPoolSessions,
} from "../../src/interpreter/workerPoolSessions.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  ProjectAccessUnavailable,
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  workerContractOptionalsSeen,
  workerContractReleasePool,
  workerContractReplayed,
  type WorkerContractReleasePool,
} from "../contract/workerContractReleases.ts";
import {
  planeChunkedAnswered,
  planeJsonHeaviest,
  planeListening,
  planeTextHeaviest,
  planeUnendingAnswered,
} from "./planeBodies.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";

const issuer = "https://issuer.invalid";

/** The one client the fake issuer knows, and the principal its subject resolves to. */
const poolToken = "pool-token";
const poolPrincipal = oidcPrincipal(issuer, "client-one");

const partition = { tenant: "tenant", project: "project" } as Partition;
const identity: WorkerPoolIdentity = {
  partition,
  pool: "pool-one",
  principal: poolPrincipal,
};

/** A member's personal runner in the same tenant, known by a token of its own. */
const runnerToken = "runner-token";
const runner: PersonalRunnerIdentity = {
  tenant: partition.tenant,
  owner: oidcPrincipal(issuer, "a-member"),
  principal: oidcPrincipal(issuer, "chuggy-personal-one"),
};

/** The image the one claimed execution pinned, and the name a pool is handed it by. */
const pinned = `registry.invalid/worker@sha256:${"a".repeat(64)}`;
const published = `registry.public.invalid/worker@sha256:${"a".repeat(64)}`;

/** A pool's token and the release it speaks, which is this plane's own. */
const speaking = {
  authorization: `Bearer ${poolToken}`,
  [workerContractHeader]: workerContractRelease,
};

/** A personal runner's token and the release it speaks. */
const runnerSpeaking = {
  authorization: `Bearer ${runnerToken}`,
  [workerContractHeader]: workerContractRelease,
};

/** The poll's address carrying one `held` per assignment and the room asked for, of sessions only where it is said. */
function polling(
  held: readonly string[],
  wanted = 1,
  wantedSessions?: number,
): string {
  const query = new URLSearchParams([
    ...held.map((assignment) => [workerPoolPollQuery.held, assignment]),
    [workerPoolPollQuery.wanted, String(wanted)],
    ...(wantedSessions === undefined
      ? []
      : [[workerPoolPollQuery.wantedSessions, String(wantedSessions)]]),
  ]).toString();
  return `${workerPoolPollRoute}?${query}`;
}

/** Records every call a route made, so the route's mapping is what the case reads, the pool holding `pinning`. */
function calls(pinning: readonly string[] = []): {
  readonly made: unknown[];
  readonly ports: WorkerPoolAssignments;
} {
  const made: unknown[] = [];
  let claims = 0;
  return {
    made,
    ports: {
      claim: (_identity, _terms, assignment) => {
        made.push(["claim", assignment]);
        claims += 1;
        return Promise.resolve(
          claims === 1
            ? {
                requirement: {
                  mode: "Container",
                  operatingSystem: "Linux",
                  architecture: "Amd64",
                  image: pinned,
                },
              }
            : undefined,
        );
      },
      ownersDeferredTo: () => Promise.resolve([]),
      claimPersonal: () => Promise.resolve(undefined),
      waiting: () => Promise.resolve(false),
      waitingPersonal: () => Promise.resolve(false),
      allowlisted: () => Promise.resolve([]),
      polled: () => Promise.resolve(),
      renew: (_identity, assignment) =>
        Promise.resolve(
          (made.push(["renew", assignment]), assignment === "live"),
        ),
      refuse: (_identity, assignment, evidence, fault) =>
        Promise.resolve(
          (made.push([
            "refuse",
            assignment,
            evidence,
            ...(fault === undefined ? [] : [fault]),
          ]),
          true),
        ),
      release: (_identity, assignment) =>
        Promise.resolve((made.push(["release", assignment]), true)),
      held: (_identity, assignment) =>
        Promise.resolve((made.push(["held", assignment]), true)),
      heldImages: (_identity, heldMax) =>
        Promise.resolve((made.push(["heldImages", heldMax]), pinning)),
    },
  };
}

/** The image every session of this site runs, and the name a pool is handed it by. */
const sessionImage = `registry.invalid/session@sha256:${"c".repeat(64)}`;
const sessionPublished = `registry.public.invalid/session@sha256:${"c".repeat(64)}`;
const sessionSecret = `chgs_${"e".repeat(64)}`;

const launch: SessionLaunchFacts = {
  image: sessionImage,
  authority: {
    tools: [],
    credentials: [],
    network: false,
    filesystem: "None",
    mayCompleteTask: false,
  },
  mirrors: {},
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

/**
 * Records every call a route made of the session side, which holds `holding`
 * and offers `offered`, each opened as the claim asks.
 */
function sessionCalls(
  holding: readonly string[] = [],
  offered: readonly string[] = [],
): { readonly made: unknown[]; readonly store: WorkerPoolSessions } {
  const made: unknown[] = [];
  const answer = <T>(call: unknown[], value: T): Promise<T> =>
    Promise.resolve((made.push(call), value));
  return {
    made,
    store: {
      launch: () => answer(["launch"], launch),
      among: (_identity, named) =>
        answer(
          ["among", [...named]],
          new Set(named.filter((one) => holding.includes(one))),
        ),
      awaiting: (_identity, _backoff, max) =>
        answer(
          ["awaiting", max],
          offered.slice(0, max).map((session) => ({
            project: partition.project,
            session: asSessionId(session),
            kind: "Lead" as const,
            capabilities: [],
          })),
        ),
      open: (_identity, opening) =>
        answer(
          ["open", opening.candidate.session, opening.assignment],
          "Opened",
        ),
      renew: (_identity, assignment) =>
        answer(["renew", assignment], assignment === "session-live"),
      held: (_identity, assignment) => answer(["held", assignment], true),
      refuse: (_identity, assignment, evidence) =>
        answer(["refuse", assignment, evidence], true),
      release: (_identity, assignment) => answer(["release", assignment], true),
      heldImages: (_identity, max) =>
        answer(["heldImages", max], holding.length > 0 ? [sessionImage] : []),
      polled: () => answer(["polled"], undefined),
    },
  };
}

/** An issuer that knows one token, refuses one and cannot answer for a third. */
const issuing = {
  authenticateBearer: (token: string) =>
    Promise.resolve(
      token === poolToken || token === runnerToken
        ? ({
            authenticated: "Bearer",
            bearer: {
              principal: token === poolToken ? poolPrincipal : runner.principal,
            },
          } as const)
        : token === "issuer-down"
          ? ({ authenticated: "AuthorityUnavailable" } as const)
          : ({ authenticated: "InvalidToken" } as const),
    ),
};

/** An authority that permits every principal on a project and in a tenant, unless the case asks it to fail. */
function authority(answer: "Allow" | "Refuse" | "Outage"): ProjectAccess {
  const answered = (principal: Principal) => {
    if (answer === "Outage")
      throw new ProjectAccessUnavailable("the authority is unreachable");
    return Promise.resolve(
      answer === "Allow" ? memberAuthority(principal) : undefined,
    );
  };
  return {
    authorize: answered,
    authorizeTenant: answered,
    authorizeSite: projectAccessSiteRefused,
  };
}

/** The one release this site pins, for the Linux runner. */
const linuxPin = {
  version: "0.14.1",
  url: "https://github.com/kasofsk/chuggy-linux/releases/download/v0.14.1/chuggy-linux-0.14.1.tgz",
  integrity: `sha512-${"A".repeat(85)}g==`,
};

/** Records the runner and the capabilities each poll named, by the kind of caller that named them. */
function runnerCalls(): {
  readonly named: unknown[];
  readonly advertised: unknown[];
  readonly ceilings: unknown[];
  readonly runners: WorkerPoolRunners;
} {
  const named: unknown[] = [];
  const advertised: unknown[] = [];
  const ceilings: unknown[] = [];
  return {
    named,
    advertised,
    ceilings,
    runners: {
      named: (caller: PoolPlaneIdentity, runner, capabilities, ceiling) => {
        named.push([caller.kind, runner]);
        advertised.push([caller.kind, capabilities]);
        ceilings.push([caller.kind, ceiling]);
        return Promise.resolve();
      },
    },
  };
}

function plane(
  ports: WorkerPoolAssignments,
  access: ProjectAccess = authority("Allow"),
  sessions: WorkerPoolSessions = sessionCalls().store,
  runners: WorkerPoolRunners = runnerCalls().runners,
): PoolPlaneService {
  let minted = 0;
  return {
    authentication: issuing,
    access,
    registry: {
      register: () => Promise.resolve(true),
      clientOf: () => Promise.resolve(undefined),
      deregister: () => Promise.resolve(false),
      identify: (principal) =>
        Promise.resolve(principal === poolPrincipal ? identity : undefined),
    },
    personal: {
      identify: (principal) =>
        Promise.resolve(principal === runner.principal ? runner : undefined),
    },
    assignments: ports,
    sessions: {
      store: sessions,
      bindings: { binding: () => Promise.resolve(undefined) },
      bearers: {
        mint: () => ({
          attempt: asSessionAttemptId("attempt-one"),
          bearer: {
            id: asSessionBearerId("bearer-one"),
            secret: asSessionBearerSecret(sessionSecret),
          },
          bearerSecretDigest: "d".repeat(64),
        }),
      },
    },
    runners,
    releases: workerRunnerReleasesRead({ "chuggy-linux": linuxPin }),
    mint: () => `minted-${String((minted += 1))}`,
    settings: {
      leaseSecs: 30,
      cpuMillis: 500,
      memoryMib: 256,
      assignmentsPerPollMax: 1,
      heldMax: 3,
      sessionsPerPollMax: 1,
      sessionsHeldMax: 2,
      deadlineSecs: 600,
      callbackUrl: "https://plane.invalid/v1/ticket-execution",
      sessionApiUrl: "https://api.invalid/",
      pollIntervalMs: 1,
      pollsMax: 1,
      imageHosts: new Map([["registry.invalid", "registry.public.invalid"]]),
    },
    ready: () => Promise.resolve(true),
  };
}

test("one poll renews what is held, says what must stop and hands over what it claimed", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: polling(["live", "gone"]),
    headers: speaking,
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), {
    assignments: [
      {
        assignment: "minted-2",
        capabilities: ["Platform:Linux:Amd64"],
        image: published,
        cpuMillis: 500,
        memoryMib: 256,
        deadlineSecs: 600,
        callbackUrl: "https://plane.invalid/v1/ticket-execution",
        bearer: "minted-3",
      },
    ],
    sessions: [],
    stop: ["gone"],
  });
  assert.deepEqual(recorded.made, [
    ["renew", "live"],
    ["renew", "gone"],
    ["claim", "minted-2"],
  ]);
});

test("a poll naming its runner keeps it, and is answered with the release pinned for its package where its release reads one", async () => {
  for (const [why, headers, kept, release] of [
    [
      "a pinned package",
      { ...speaking, [workerRunnerHeader]: "chuggy-linux/0.14.0" },
      ["Dedicated", { package: "chuggy-linux", version: "0.14.0" }],
      { package: "chuggy-linux", ...linuxPin },
    ],
    [
      "a package already past its pin",
      { ...speaking, [workerRunnerHeader]: "chuggy-linux/0.15.0" },
      ["Dedicated", { package: "chuggy-linux", version: "0.15.0" }],
      { package: "chuggy-linux", ...linuxPin },
    ],
    [
      "a package nothing pins",
      { ...speaking, [workerRunnerHeader]: "chuggy-darwin/0.14.0" },
      ["Dedicated", { package: "chuggy-darwin", version: "0.14.0" }],
      undefined,
    ],
    [
      "a release that reads no release",
      {
        ...speaking,
        [workerContractHeader]: "1.10.0",
        [workerRunnerHeader]: "chuggy-linux/0.14.0",
      },
      ["Dedicated", { package: "chuggy-linux", version: "0.14.0" }],
      undefined,
    ],
    ["no runner named", speaking, ["Dedicated", undefined], undefined],
    [
      "a runner named in no grammar",
      { ...speaking, [workerRunnerHeader]: "chuggy-linux@0.14.0" },
      ["Dedicated", undefined],
      undefined,
    ],
    [
      "a personal runner",
      { ...runnerSpeaking, [workerRunnerHeader]: "chuggy-linux/0.14.0" },
      ["Personal", { package: "chuggy-linux", version: "0.14.0" }],
      { package: "chuggy-linux", ...linuxPin },
    ],
  ] as const) {
    const recorded = runnerCalls();
    const answered = await createPoolPlaneApp(
      plane(calls().ports, authority("Allow"), undefined, recorded.runners),
    ).inject({ method: "GET", url: polling([], 0), headers });
    assert.equal(answered.statusCode, 200, why);
    assert.deepEqual(
      answered.json(),
      {
        assignments: [],
        sessions: [],
        stop: [],
        ...(release === undefined ? {} : { release }),
      },
      why,
    );
    assert.deepEqual(recorded.named, [kept], why);
  }
});

test("a runner named twice names none, and its poll is served", async () => {
  const recorded = runnerCalls();
  const answered = await createPoolPlaneApp(
    plane(calls().ports, authority("Allow"), undefined, recorded.runners),
  ).inject({
    method: "GET",
    url: polling([], 0),
    headers: {
      ...speaking,
      [workerRunnerHeader]: ["chuggy-linux/0.14.0", "chuggy-linux/0.14.0"],
    },
  });
  assert.equal(answered.statusCode, 200);
  assert.equal("release" in answered.json<object>(), false);
  assert.deepEqual(recorded.named, [["Dedicated", undefined]]);
});

test("a poll naming its capabilities has them kept as one list however its header spells them, and a poll naming none keeps none", async () => {
  const bazel = ["Platform:Linux:Amd64", "Tool:Bazel"];
  for (const [why, headers, kept] of [
    [
      "a list",
      {
        ...speaking,
        [workerRunnerCapabilitiesHeader]: " Platform:Linux:Amd64,Tool:Bazel ",
      },
      ["Dedicated", bazel],
    ],
    [
      "a list sent on two lines",
      {
        ...speaking,
        [workerRunnerCapabilitiesHeader]: [
          "Platform:Linux:Amd64",
          "Tool:Bazel",
        ] as string[],
      },
      ["Dedicated", bazel],
    ],
    [
      "an empty list",
      { ...speaking, [workerRunnerCapabilitiesHeader]: "" },
      ["Dedicated", []],
    ],
    ["no list", speaking, ["Dedicated", undefined]],
    [
      "a personal runner",
      {
        ...runnerSpeaking,
        [workerRunnerCapabilitiesHeader]: "Platform:Linux:Amd64, Tool:Bazel",
      },
      ["Personal", bazel],
    ],
  ] as const) {
    const recorded = runnerCalls();
    const answered = await createPoolPlaneApp(
      plane(calls().ports, authority("Allow"), undefined, recorded.runners),
    ).inject({ method: "GET", url: polling([], 0), headers });
    assert.equal(answered.statusCode, 200, why);
    assert.deepEqual(recorded.advertised, [kept], why);
  }
});

test("a poll naming capabilities this side cannot read is refused whole, with nothing kept, renewed or claimed", async () => {
  for (const capabilities of [
    "Tool Bazel",
    "Tool:Bazel, Tool:Bazel",
    ["Tool:Bazel", "Tool:Bazel"],
  ]) {
    const recorded = runnerCalls();
    const made = calls();
    const answered = await createPoolPlaneApp(
      plane(made.ports, authority("Allow"), undefined, recorded.runners),
    ).inject({
      method: "GET",
      url: polling(["live"], 1),
      headers: { ...speaking, [workerRunnerCapabilitiesHeader]: capabilities },
    });
    assert.equal(answered.statusCode, 400, String(capabilities));
    assert.equal(answered.body, "", String(capabilities));
    assert.deepEqual(recorded.named, [], String(capabilities));
    assert.deepEqual(made.made, [], String(capabilities));
  }
});

test("a poll naming its memory ceiling has it kept, and a poll naming none keeps none", async () => {
  for (const [why, headers, kept] of [
    [
      "a ceiling",
      { ...speaking, [workerRunnerMemoryCeilingHeader]: "8192" },
      ["Dedicated", 8_192],
    ],
    [
      "a ceiling of nothing",
      { ...speaking, [workerRunnerMemoryCeilingHeader]: "0" },
      ["Dedicated", 0],
    ],
    ["no ceiling", speaking, ["Dedicated", undefined]],
    [
      "a personal runner",
      { ...runnerSpeaking, [workerRunnerMemoryCeilingHeader]: "16384" },
      ["Personal", 16_384],
    ],
  ] as const) {
    const recorded = runnerCalls();
    const answered = await createPoolPlaneApp(
      plane(calls().ports, authority("Allow"), undefined, recorded.runners),
    ).inject({ method: "GET", url: polling([], 0), headers });
    assert.equal(answered.statusCode, 200, why);
    assert.deepEqual(recorded.ceilings, [kept], why);
  }
});

test("a poll naming a memory ceiling, a memory room or a wait this side cannot read is refused whole, with nothing kept, renewed or claimed", async () => {
  for (const header of [
    workerRunnerMemoryCeilingHeader,
    workerRunnerMemoryRoomHeader,
    workerRunnerPollWaitHeader,
  ])
    for (const count of [
      "-1",
      "4096 MiB",
      "1.5",
      "08",
      "99999999999999999999",
      ["4096", "4096"],
    ]) {
      const recorded = runnerCalls();
      const made = calls();
      const answered = await createPoolPlaneApp(
        plane(made.ports, authority("Allow"), undefined, recorded.runners),
      ).inject({
        method: "GET",
        url: polling(["live"], 1),
        headers: { ...speaking, [header]: count },
      });
      const why = `${header} ${String(count)}`;
      assert.equal(answered.statusCode, 400, why);
      assert.equal(answered.body, "", why);
      assert.deepEqual(recorded.named, [], why);
      assert.deepEqual(made.made, [], why);
    }
});

/** The plane `plane` builds, long-polling for `pollsMax` passes. */
function planePolling(
  ports: WorkerPoolAssignments,
  pollsMax: number,
): PoolPlaneService {
  const built = plane(ports);
  return { ...built, settings: { ...built.settings, pollsMax } };
}

test("a poll naming its memory room has every claim held to it and one naming none is claimed by count, and a poll naming its wait is answered within it", async () => {
  for (const [why, headers, rooms] of [
    [
      "a room",
      { ...speaking, [workerRunnerMemoryRoomHeader]: "4096" },
      [4_096, 4_096, 4_096],
    ],
    [
      "a wait of nothing",
      { ...speaking, [workerRunnerPollWaitHeader]: "0" },
      [undefined],
    ],
    ["neither", speaking, [undefined, undefined, undefined]],
  ] as const) {
    const claimed: unknown[] = [];
    const answered = await createPoolPlaneApp(
      planePolling(
        {
          ...calls().ports,
          claim: (_identity, terms) =>
            Promise.resolve(void claimed.push(terms.memoryRoomMib)),
        },
        3,
      ),
    ).inject({ method: "GET", url: polling([], 1), headers });
    assert.equal(answered.statusCode, 200, why);
    assert.deepEqual(claimed, rooms, why);
  }
});

test("a poll of this release naming its room is told a job it fits is waiting, and one of 1.20.0 naming a room is not and reads its answer", async () => {
  const earlier = await workerContractReleasePool("1.20.0");
  for (const [why, headers, reconciliation, waiting] of [
    [
      "this release",
      { ...speaking, [workerRunnerMemoryRoomHeader]: "4096" },
      workerPoolReconciliationSchema,
      true,
    ],
    [
      "1.20.0",
      {
        ...speaking,
        [workerContractHeader]: earlier.release,
        [workerRunnerMemoryRoomHeader]: "4096",
      },
      earlier.reconciliation,
      undefined,
    ],
  ] as const) {
    const asked: unknown[] = [];
    const answered = await createPoolPlaneApp(
      plane({
        ...calls().ports,
        waiting: (_identity, terms) =>
          Promise.resolve((asked.push(terms.memoryRoomMib), true)),
      }),
    ).inject({ method: "GET", url: polling([], 0), headers });
    assert.equal(answered.statusCode, 200, why);
    const body = answered.json<Record<string, unknown>>();
    assert.deepEqual(reconciliation.parse(body), body, why);
    assert.equal(body["jobsWaiting"], waiting, why);
    assert.deepEqual(asked, waiting === undefined ? [] : [4_096], why);
  }
});

test("a pool wanting none is renewed, told what to stop and claimed nothing", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: polling(["live", "gone"], 0),
    headers: speaking,
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), {
    assignments: [],
    sessions: [],
    stop: ["gone"],
  });
  assert.deepEqual(recorded.made, [
    ["renew", "live"],
    ["renew", "gone"],
  ]);
});

test("a pool wanting more than the plane hands out per poll is claimed the plane's bound", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: polling([], 5),
    headers: speaking,
  });
  assert.equal(answered.statusCode, 200);
  assert.equal(
    workerPoolReconciliationSchema.parse(answered.json()).assignments.length,
    1,
  );
  assert.deepEqual(recorded.made, [["claim", "minted-2"]]);
});

test("a poll that does not say its room, or says it as no count, is refused", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const query of ["", "?wanted=-1", "?wanted=two", "?wanted=1&wanted=2"]) {
    const answered = await app.inject({
      method: "GET",
      url: `${workerPoolPollRoute}${query}`,
      headers: speaking,
    });
    assert.equal(answered.statusCode, 400, query);
    assert.equal(answered.body, "");
  }
  assert.deepEqual(recorded.made, []);
});

test("a poll that says its room for sessions as no count is refused, and one that does not say it has none", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const query of [
    "wantedSessions=-1",
    "wantedSessions=two",
    "wantedSessions=1&wantedSessions=2",
  ]) {
    const answered = await app.inject({
      method: "GET",
      url: `${polling([], 0)}&${query}`,
      headers: speaking,
    });
    assert.equal(answered.statusCode, 400, query);
    assert.equal(answered.body, "");
  }
  assert.deepEqual(recorded.made, []);
  for (const url of [polling([], 0), `${polling([], 0)}&wantedSessions=2`]) {
    const answered = await app.inject({
      method: "GET",
      url,
      headers: speaking,
    });
    assert.deepEqual(
      answered.json(),
      { assignments: [], sessions: [], stop: [] },
      url,
    );
  }
});

test("a pool already at its bound still polls and is answered with control alone", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: polling(["live", "live", "live"]),
    headers: speaking,
  });
  assert.deepEqual(answered.json(), {
    assignments: [],
    sessions: [],
    stop: [],
  });
  assert.deepEqual(recorded.made, [
    ["renew", "live"],
    ["renew", "live"],
    ["renew", "live"],
  ]);
});

test("a list longer than the bound is refused rather than cut", async () => {
  const answered = await createPoolPlaneApp(plane(calls().ports)).inject({
    method: "GET",
    url: polling(["one", "two", "three", "four"]),
    headers: speaking,
  });
  assert.equal(answered.statusCode, 400);
  assert.equal(answered.body, "");
});

for (const [why, headers, status] of [
  ["no token at all", {}, 401],
  [
    "a token the issuer does not vouch for",
    { authorization: "Bearer other" },
    401,
  ],
  [
    "an issuer that could not answer",
    { authorization: "Bearer issuer-down" },
    503,
  ],
] as const)
  test(`a poll carrying ${why} is answered ${String(status)} and nothing else`, async () => {
    const answered = await createPoolPlaneApp(plane(calls().ports)).inject({
      method: "GET",
      url: polling([]),
      headers: { ...headers, [workerContractHeader]: workerContractRelease },
    });
    assert.equal(answered.statusCode, status);
    assert.equal(answered.body, "");
  });

test("a pool the authority refuses is told it is not there rather than told to retry", async () => {
  const answered = await createPoolPlaneApp(
    plane(calls().ports, authority("Refuse")),
  ).inject({
    method: "GET",
    url: polling([]),
    headers: speaking,
  });
  assert.equal(answered.statusCode, 404);
  assert.equal(answered.body, "");
});

test("a pool polling through an authority outage is told to retry", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(
    plane(recorded.ports, authority("Outage")),
  ).inject({
    method: "GET",
    url: polling([]),
    headers: speaking,
  });
  assert.equal(answered.statusCode, 503);
  assert.equal(answered.body, "");
  assert.deepEqual(
    recorded.made,
    [],
    "an undecided question claims no work at all",
  );
});

test("each settlement route reaches the one port its own path names", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const [outcome, payload] of [
    ["Accepted", {}],
    ["Refused", { evidence: "no runner" }],
    ["Unavailable", {}],
  ] as const) {
    const url = workerPoolSettlementPath(outcome, "one");
    const answered = await app.inject({
      method: "POST",
      url,
      headers: speaking,
      payload,
    });
    assert.equal(answered.statusCode, 204, url);
  }
  assert.deepEqual(recorded.made, [
    ["held", "one"],
    ["refuse", "one", "no runner"],
    ["release", "one"],
  ]);
});

test("a refusal naming an image fault reaches the port with it, and one naming no fault the contract has is refused before any port", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const [fault, status] of [
    ["ImageWorkspaceUnwritable", 204],
    ["ImageLacksSed", 400],
  ] as const) {
    const answered = await app.inject({
      method: "POST",
      url: workerPoolSettlementPath("Refused", "one"),
      headers: speaking,
      payload: { evidence: "/workspace is not writable", fault },
    });
    assert.equal(answered.statusCode, status, fault);
  }
  assert.deepEqual(recorded.made, [
    ["refuse", "one", "/workspace is not writable", "ImageWorkspaceUnwritable"],
  ]);
});

test("a settlement whose body does not carry what its path needs is refused", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "POST",
    url: workerPoolSettlementPath("Refused", "one"),
    headers: speaking,
    payload: {},
  });
  assert.equal(answered.statusCode, 400);
  assert.equal(answered.body, "");
  assert.deepEqual(recorded.made, []);
});

/** A later minor than the one this plane was built with, which it cannot serve. */
const unreleased = `${String(workerContractAccepted.max.major)}.${String(workerContractAccepted.max.minor + 1)}.0`;

test("a pool naming no release, one below the plane's floor or one later than the plane's is refused at the poll and at every settlement, before any port", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const offered of [undefined, "1.0.0", "1.2.0", "1.6.0", unreleased]) {
    const headers = {
      authorization: `Bearer ${poolToken}`,
      ...(offered === undefined ? {} : { [workerContractHeader]: offered }),
    };
    for (const [method, url] of [
      ["GET", polling(["live"])],
      ["POST", workerPoolSettlementPath("Accepted", "one")],
      ["POST", workerPoolSettlementPath("Refused", "one")],
      ["POST", workerPoolSettlementPath("Unavailable", "one")],
    ] as const) {
      const refused = await app.inject({ method, url, headers, payload: {} });
      assert.equal(
        refused.statusCode,
        contractVersionRefusalStatus,
        `${String(offered)} ${url}`,
      );
      assert.deepEqual(contractVersionRefusalSchema.parse(refused.json()), {
        action: "stop",
        reason: "UnsupportedContractVersion",
        accepted: {
          min: "1.7",
          max: workerContractVersionText(workerContractAccepted.max),
        },
      });
    }
  }
  assert.deepEqual(recorded.made, []);
});

/** The runtime a claimed attempt was opened under, and the name a pool reading one is handed it by. */
const runtime = `registry.invalid/worker-runtime@sha256:${"e".repeat(64)}`;
const runtimePublished = `registry.public.invalid/worker-runtime@sha256:${"e".repeat(64)}`;

/**
 * What a claim returns: an image pinned on a published host, and a capability
 * requirement, which is handed out with no image; each beside the runtime its
 * attempt was opened under, which a release that reads none is never handed;
 * a pinned image whose attempt kept no runtime, which is handed none; and a
 * personal runner's pinned image, beside the project its attempt is in.
 */
const claims = {
  pinned: {
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: pinned,
    },
    runtime,
  },
  capable: {
    requirement: {
      mode: "Capability",
      operatingSystem: "Linux",
      architecture: "Amd64",
      capabilities: ["Agent:Codex"],
    },
    runtime,
  },
  unkept: {
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: pinned,
    },
  },
  personal: {
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: pinned,
    },
    runtime,
    project: asProjectId("project"),
  },
} as const;

test("a pool is handed the runtime its claim's attempt was opened under, on the public host", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(
    plane({ ...recorded.ports, claim: () => Promise.resolve(claims.pinned) }),
  ).inject({ method: "GET", url: polling([]), headers: speaking });
  assert.equal(answered.statusCode, 200);
  const [assignment] = workerPoolReconciliationSchema.parse(
    answered.json(),
  ).assignments;
  assert.equal(assignment?.runtime, runtimePublished);
  assert.equal(assignment?.image, published);
});

test("a personal runner's poll naming this release is handed its job's project, and an earlier release's or a pool's none", async () => {
  for (const [what, headers, project] of [
    ["a runner of this release", runnerSpeaking, "project"],
    [
      "a runner of 1.14.0",
      { ...runnerSpeaking, [workerContractHeader]: "1.14.0" },
      undefined,
    ],
    ["a pool of this release", speaking, undefined],
  ] as const) {
    const answered = await createPoolPlaneApp(
      plane({
        ...calls().ports,
        claim: () => Promise.resolve(claims.pinned),
        claimPersonal: () => Promise.resolve(claims.personal),
        allowlisted: () => Promise.resolve([asProjectId("project")]),
      }),
    ).inject({ method: "GET", url: polling([]), headers });
    assert.equal(answered.statusCode, 200, what);
    const [assignment] = workerPoolReconciliationSchema.parse(
      answered.json(),
    ).assignments;
    assert.equal(assignment?.image, published, what);
    assert.equal(
      assignment !== undefined && "project" in assignment
        ? assignment.project
        : undefined,
      project,
      what,
    );
  }
});

/** Every poll a replayed pool makes: whose token it polls with, what it holds, how many executions and sessions it has room for, what a claim returns it, and the runner and the memory room it names where its release names them. */
const poolReplayPolls = [
  [
    "a pinned image",
    poolToken,
    ["live", "gone"],
    1,
    0,
    claims.pinned,
    undefined,
    undefined,
  ],
  [
    "a capability requirement",
    poolToken,
    [],
    1,
    0,
    claims.capable,
    undefined,
    undefined,
  ],
  [
    "an attempt that kept no runtime",
    poolToken,
    [],
    1,
    0,
    claims.unkept,
    undefined,
    undefined,
  ],
  ["no room", poolToken, ["live"], 0, 0, claims.pinned, undefined, undefined],
  [
    "nothing to claim",
    poolToken,
    [],
    1,
    0,
    undefined,
    "chuggy-linux/0.14.0",
    "4096",
  ],
  ["room for a session", poolToken, [], 0, 1, undefined, undefined, undefined],
  [
    "a personal runner's job",
    runnerToken,
    [],
    1,
    0,
    claims.personal,
    "chuggy-linux/0.18.0",
    undefined,
  ],
  [
    "a personal runner's session",
    runnerToken,
    [],
    0,
    1,
    undefined,
    undefined,
    undefined,
  ],
] as const;

/**
 * Every poll a pool built with `older` makes, through the names its own
 * release exports, read by its own reconciliation schema. That schema is
 * strict, so an answer naming a field it does not is one such a pool refuses
 * whole.
 */
function poolReplayPolled(older: WorkerContractReleasePool): void {
  test(`a ${older.release} pool reads every reconciliation a poll answers it with, and is handed the session it has room for`, async () => {
    const seen = new Map<string, Set<boolean>>();
    for (const [
      what,
      token,
      held,
      wanted,
      sessions,
      claimed,
      named,
      room,
    ] of poolReplayPolls) {
      const recorded = calls();
      const ports = {
        ...recorded.ports,
        claim: () => Promise.resolve(claimed),
        claimPersonal: () =>
          Promise.resolve(
            claimed !== undefined && "project" in claimed ? claimed : undefined,
          ),
        allowlisted: () => Promise.resolve([asProjectId("project")]),
      };
      const offering = sessionCalls([], ["session-waiting"]);
      const query = new URLSearchParams([
        ...held.map((assignment) => [older.pollQuery.held, assignment]),
        [older.pollQuery.wanted, String(wanted)],
        [older.pollQuery.wantedSessions, String(sessions)],
      ]);
      const answered = await createPoolPlaneApp(
        plane(ports, authority("Allow"), offering.store),
      ).inject({
        method: "GET",
        url: `${older.pollRoute}?${query.toString()}`,
        headers: {
          authorization: `Bearer ${token}`,
          [workerContractHeader]: older.release,
          ...(older.runnerHeader === undefined || named === undefined
            ? {}
            : { [older.runnerHeader]: named }),
          ...(older.memoryRoomHeader === undefined || room === undefined
            ? {}
            : { [older.memoryRoomHeader]: room }),
        },
      });
      assert.equal(answered.statusCode, 200, what);
      const body: unknown = answered.json();
      assert.deepEqual(older.reconciliation.parse(body), body, what);
      assert.deepEqual(
        offering.made.filter((call) => (call as unknown[])[0] === "open"),
        Array(sessions).fill(["open", "session-waiting", "minted-1"]),
        what,
      );
      workerContractOptionalsSeen(older.reconciliation, body, "answer", seen);
    }
    for (const [field, held] of seen)
      assert.equal(held.size, 2, `${field} is seen only one way`);
  });
}

test("a pool of this release with room for a session is handed the one waiting, on the plane's terms, and is recorded as polling", async () => {
  const recorded = calls();
  const offering = sessionCalls([], ["session-waiting"]);
  const answered = await createPoolPlaneApp(
    plane(recorded.ports, authority("Allow"), offering.store),
  ).inject({
    method: "GET",
    url: polling([], 0, 3),
    headers: speaking,
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), {
    assignments: [],
    sessions: [
      {
        assignment: "minted-1",
        capabilities: [],
        image: sessionPublished,
        cpuMillis: 500,
        memoryMib: 256,
        deadlineSecs: launch.deadlineSecs,
        callbackUrl: "https://plane.invalid/v1/ticket-execution",
        bearer: sessionSecret,
      },
    ],
    stop: [],
  });
  assert.deepEqual(offering.made, [
    ["among", []],
    ["polled"],
    ["launch"],
    ["awaiting", 1],
    ["open", "session-waiting", "minted-1"],
  ]);
  assert.deepEqual(recorded.made, []);
});

test("what a pool holds is renewed through the rows of its own kind, each kind held to its own bound", async () => {
  const recorded = calls();
  const holding = sessionCalls(["session-live", "session-gone"]);
  const app = createPoolPlaneApp(
    plane(recorded.ports, authority("Allow"), holding.store),
  );
  const answered = await app.inject({
    method: "GET",
    url: polling(["live", "live", "live", "session-live", "session-gone"], 0),
    headers: speaking,
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), {
    assignments: [],
    sessions: [],
    stop: ["session-gone"],
  });
  assert.deepEqual(recorded.made, Array(3).fill(["renew", "live"]));
  assert.deepEqual(holding.made.slice(2), [
    ["renew", "session-live"],
    ["renew", "session-gone"],
  ]);
  const overSessions = await createPoolPlaneApp(
    plane(
      calls().ports,
      authority("Allow"),
      sessionCalls(["s1", "s2", "s3"]).store,
    ),
  ).inject({
    method: "GET",
    url: polling(["s1", "s2", "s3"], 0),
    headers: speaking,
  });
  assert.equal(overSessions.statusCode, 400);
});

test("a settlement of a held session reaches the session side and never the executions'", async () => {
  const recorded = calls();
  const holding = sessionCalls(["session-one"]);
  const app = createPoolPlaneApp(
    plane(recorded.ports, authority("Allow"), holding.store),
  );
  for (const [outcome, payload] of [
    ["Accepted", {}],
    ["Refused", { evidence: "no runner" }],
    ["Unavailable", {}],
  ] as const) {
    const answered = await app.inject({
      method: "POST",
      url: workerPoolSettlementPath(outcome, "session-one"),
      headers: speaking,
      payload,
    });
    assert.equal(answered.statusCode, 204, outcome);
  }
  assert.deepEqual(recorded.made, []);
  assert.deepEqual(
    holding.made.filter((call) => (call as unknown[])[0] !== "among"),
    [
      ["held", "session-one"],
      ["refuse", "session-one", "no runner"],
      ["release", "session-one"],
    ],
  );
});

/** Every settlement a pool built with `older` makes, at the paths and with the bodies its own release builds, each reaching its port. */
function poolReplaySettled(older: WorkerContractReleasePool): void {
  test(`a ${older.release} pool settles an assignment with every outcome its release names`, async () => {
    const recorded = calls();
    const app = createPoolPlaneApp(plane(recorded.ports));
    for (const outcome of Object.keys(older.settlementRoutes)) {
      const [body, ...more] = [{}, { evidence: "no runner" }].filter(
        (offered) => older.outcome.safeParse({ outcome, ...offered }).success,
      );
      assert.ok(body !== undefined && more.length === 0, outcome);
      const answered = await app.inject({
        method: "POST",
        url: older.settlementPath(outcome, "one"),
        headers: {
          authorization: `Bearer ${poolToken}`,
          [workerContractHeader]: older.release,
        },
        payload: body,
      });
      assert.equal(answered.statusCode, 204, outcome);
    }
    assert.deepEqual(recorded.made, [
      ["held", "one"],
      ["refuse", "one", "no runner"],
      ["release", "one"],
    ]);
  });
}

for (const release of workerContractReplayed("pool")) {
  const older = await workerContractReleasePool(release);
  poolReplayPolled(older);
  poolReplaySettled(older);
}

test("every answer names the plane's release, the probes' and the framework's own among them", async () => {
  const ports = calls().ports;
  const failing = {
    ...plane(ports),
    registry: {
      ...plane(ports).registry,
      identify: () => Promise.reject(new Error("down")),
    },
    ready: () => Promise.resolve(false),
  };
  const token = speaking;
  for (const [service, method, url, headers, status] of [
    [plane(ports), "GET", polling(["live"]), token, 200],
    [plane(ports), "GET", polling(["a", "b", "c", "d"]), token, 400],
    [
      plane(ports),
      "GET",
      polling([]),
      { [workerContractHeader]: workerContractRelease },
      401,
    ],
    [plane(ports), "GET", polling([]), {}, contractVersionRefusalStatus],
    [plane(ports, authority("Refuse")), "GET", polling([]), token, 404],
    [plane(ports, authority("Outage")), "GET", polling([]), token, 503],
    [failing, "GET", polling([]), token, 500],
    [
      plane(ports),
      "POST",
      workerPoolSettlementPath("Accepted", "one"),
      token,
      204,
    ],
    [
      plane(ports),
      "GET",
      "/health/live",
      { [workerContractHeader]: "2.0.0" },
      200,
    ],
    [failing, "GET", "/health/ready", {}, 503],
    [plane(ports), "GET", "/v1/nothing", {}, 404],
  ] as const) {
    const answered = await createPoolPlaneApp(service).inject({
      method,
      url,
      headers,
      ...(method === "POST" ? { payload: {} } : {}),
    });
    assert.equal(answered.statusCode, status, url);
    assert.equal(
      answered.headers[workerContractHeader],
      workerContractRelease,
      `${method} ${url} answered ${String(status)} naming no release`,
    );
  }
});

test("every settlement refuses a caller it does not serve before the body it sent ends", async () => {
  const recorded = calls();
  for (const [caller, service, token, status] of [
    ["no bearer", plane(recorded.ports), undefined, 401],
    ["a token the issuer rejects", plane(recorded.ports), "stranger", 401],
    [
      "a pool the authority refuses",
      plane(recorded.ports, authority("Refuse")),
      poolToken,
      404,
    ],
    ["an issuer that cannot answer", plane(recorded.ports), "issuer-down", 503],
  ] as const) {
    await using app = createPoolPlaneApp(service);
    const port = await planeListening(app);
    for (const outcome of ["Accepted", "Refused", "Unavailable"] as const) {
      const answered = await planeUnendingAnswered(
        port,
        "POST",
        workerPoolSettlementPath(outcome, "one"),
        {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          [workerContractHeader]: workerContractRelease,
          "content-type": "application/json",
        },
      );
      assert.equal(answered.status, status, `${caller} at ${outcome}`);
      assert.equal(answered.body, "");
    }
  }
  assert.deepEqual(recorded.made, []);
});

test("a settlement's empty body sent chunked with no media type is answered as none", async () => {
  const service = plane(calls().ports);
  const path = workerPoolSettlementPath("Accepted", "one");
  const headers = {
    authorization: `Bearer ${poolToken}`,
    [workerContractHeader]: workerContractRelease,
  };
  const bodyless = await createPoolPlaneApp(service).inject({
    method: "POST",
    url: path,
    headers,
  });
  await using app = createPoolPlaneApp(service);
  const chunked = await planeChunkedAnswered(
    await planeListening(app),
    "POST",
    path,
    headers,
  );
  assert.deepEqual(chunked, {
    status: bodyless.statusCode,
    body: bodyless.body,
  });
});

test("each call a pool makes is authenticated once", async () => {
  const asked = { tokens: 0, pools: 0 };
  const served = plane(calls().ports);
  const app = createPoolPlaneApp({
    ...served,
    authentication: {
      authenticateBearer: (token) => {
        asked.tokens += 1;
        return served.authentication.authenticateBearer(token);
      },
    },
    registry: {
      ...served.registry,
      identify: (principal) => {
        asked.pools += 1;
        return served.registry.identify(principal);
      },
    },
  });
  const made = [
    ["GET", polling(["live"]), undefined],
    ["POST", workerPoolSettlementPath("Accepted", "one"), {}],
    [
      "POST",
      workerPoolSettlementPath("Refused", "one"),
      { evidence: "no runner" },
    ],
    ["POST", workerPoolSettlementPath("Unavailable", "one"), {}],
  ] as const;
  for (const [method, url, payload] of made) {
    const answered = await app.inject({
      method,
      url,
      headers: speaking,
      ...(payload === undefined ? {} : { payload }),
    });
    assert.ok(answered.statusCode < 300, `${url} ${answered.body}`);
  }
  assert.deepEqual(asked, { tokens: made.length, pools: made.length });
});

test("a refusal carrying the heaviest evidence a pool may send is taken, and a byte past the bound is refused", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  const url = workerPoolSettlementPath("Refused", "one");
  const headers = { ...speaking, "content-type": "application/json" };
  const evidence = planeTextHeaviest(workerPoolEvidenceCharsMax);
  const taken = await app.inject({
    method: "POST",
    url,
    headers,
    payload: planeJsonHeaviest({ evidence }),
  });
  assert.equal(taken.statusCode, 204);
  const past = await app.inject({
    method: "POST",
    url,
    headers,
    payload: Buffer.alloc(poolPlaneSettlementBytesMax + 1, " "),
  });
  assert.equal(past.statusCode, 413);
  assert.deepEqual(recorded.made, [["refuse", "one", evidence]]);
});

test("a request no route names is read no further than the plane's own bound", async () => {
  const app = createPoolPlaneApp(plane(calls().ports));
  for (const [bytes, status] of [
    [planeBodyBytesDefault, 404],
    [planeBodyBytesDefault + 1, 413],
  ] as const) {
    const answered = await app.inject({
      method: "POST",
      url: "/v1/nothing",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify("x".repeat(bytes - '""'.length)),
    });
    assert.equal(answered.statusCode, status, String(bytes));
  }
});

/** The address the registry's front asks at, which the fabric names exactly. */
const authorizing = "/registry/authorize";

/** A Basic credential whose password is `token`, under any user. */
function basic(token: string, user = "anyone"): string {
  return `Basic ${Buffer.from(`${user}:${token}`, "utf8").toString("base64")}`;
}

/** What the front forwards of one registry request, under the pool's own token unless the case names another credential or none. */
function forwarded(
  method: string,
  address: string,
  authorization: string | null = basic(poolToken),
): Record<string, string> {
  return {
    ...(authorization === null ? {} : { authorization }),
    "x-forwarded-method": method,
    "x-forwarded-uri": address,
  };
}

const heldDigest = `sha256:${"a".repeat(64)}`;

test("a pool is allowed the base, the manifest it holds by digest and that repository's blobs, naming no release", async () => {
  const recorded = calls([pinned]);
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const [method, address] of [
    ["GET", "/v2/"],
    ["GET", `/v2/worker/manifests/${heldDigest}`],
    ["HEAD", `/v2/worker/manifests/${heldDigest}`],
    ["GET", `/v2/worker/blobs/sha256:${"b".repeat(64)}`],
  ] as const) {
    const answered = await app.inject({
      method: "GET",
      url: authorizing,
      headers: forwarded(method, address),
    });
    assert.equal(answered.statusCode, 200, `${method} ${address}`);
    assert.equal(answered.body, "");
    assert.equal(answered.headers["www-authenticate"], undefined);
  }
  assert.deepEqual(recorded.made, Array(4).fill(["heldImages", 3]));
});

test("a Basic credential names any user, and only its password is the pool's token", async () => {
  const app = createPoolPlaneApp(plane(calls([pinned]).ports));
  for (const user of ["", "pool-one", "someone else"]) {
    const answered = await app.inject({
      method: "GET",
      url: authorizing,
      headers: forwarded("GET", "/v2/", basic(poolToken, user)),
    });
    assert.equal(answered.statusCode, 200, JSON.stringify(user));
  }
});

for (const [why, authorization] of [
  ["no credential", null],
  ["the pool's token as a bearer", `Bearer ${poolToken}`],
  ["a scheme and nothing else", "Basic "],
  ["a credential that is not base64", "Basic !!!!"],
  [
    "base64 cut short of its padding",
    `Basic ${Buffer.from(`anyone:${poolToken}`).toString("base64").replace(/=+$/u, "")}`,
  ],
  [
    "a credential with no password",
    `Basic ${Buffer.from("anyone").toString("base64")}`,
  ],
  ["an empty password", basic("")],
  ["a token the issuer does not vouch for", basic("stranger")],
] as const)
  test(`a registry request carrying ${why} is challenged for a Basic credential`, async () => {
    const recorded = calls([pinned]);
    const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
      method: "GET",
      url: authorizing,
      headers: forwarded("GET", "/v2/", authorization),
    });
    assert.equal(answered.statusCode, 401);
    assert.equal(
      answered.headers["www-authenticate"],
      'Basic realm="chuggy-registry"',
    );
    assert.equal(answered.body, "");
    assert.deepEqual(recorded.made, []);
  });

test("a request the grammar refuses is 403 before anything held is read", async () => {
  const recorded = calls([pinned]);
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const [method, address] of [
    ["GET", "/v2/_catalog"],
    ["GET", "/v2/worker/tags/list"],
    ["GET", "/v2/worker/manifests/latest"],
    ["PUT", `/v2/worker/manifests/${heldDigest}`],
    ["POST", "/v2/worker/blobs/uploads/"],
    ["DELETE", `/v2/worker/blobs/${heldDigest}`],
    ["GET", `/v2/worker/manifests/${heldDigest}?digest=x`],
    ["GET", `/v2/%2e%2e/worker/blobs/${heldDigest}`],
  ] as const) {
    const answered = await app.inject({
      method: "GET",
      url: authorizing,
      headers: forwarded(method, address),
    });
    assert.equal(answered.statusCode, 403, `${method} ${address}`);
    assert.equal(answered.body, "");
    assert.equal(answered.headers["www-authenticate"], undefined);
  }
  const unforwarded = await app.inject({
    method: "GET",
    url: authorizing,
    headers: { authorization: basic(poolToken) },
  });
  assert.equal(unforwarded.statusCode, 403);
  assert.deepEqual(recorded.made, []);
});

test("a pool holding a session may pull its session's image, and one holding none may not", async () => {
  const address = `/v2/session/manifests/sha256:${"c".repeat(64)}`;
  for (const [holding, status] of [
    [["session-one"], 200],
    [[], 403],
  ] as const) {
    const answered = await createPoolPlaneApp(
      plane(calls().ports, authority("Allow"), sessionCalls(holding).store),
    ).inject({
      method: "GET",
      url: authorizing,
      headers: forwarded("GET", address),
    });
    assert.equal(answered.statusCode, status, holding.join(","));
  }
});

test("a pull of an image the pool holds no assignment for is 403", async () => {
  const app = createPoolPlaneApp(plane(calls([pinned]).ports));
  for (const address of [
    `/v2/worker/manifests/sha256:${"b".repeat(64)}`,
    `/v2/api/manifests/${heldDigest}`,
    `/v2/api/blobs/${heldDigest}`,
  ]) {
    const answered = await app.inject({
      method: "GET",
      url: authorizing,
      headers: forwarded("GET", address),
    });
    assert.equal(answered.statusCode, 403, address);
  }
  const holdingNothing = await createPoolPlaneApp(plane(calls().ports)).inject({
    method: "GET",
    url: authorizing,
    headers: forwarded("GET", `/v2/worker/manifests/${heldDigest}`),
  });
  assert.equal(holdingNothing.statusCode, 403);
});

test("a caller that is no admitted pool is 403, and an outage of the issuer, the authority or the store is 503", async () => {
  const ports = calls([pinned]).ports;
  const served = plane(ports);
  for (const [why, service, token, status] of [
    [
      "a pool the authority refuses",
      plane(ports, authority("Refuse")),
      poolToken,
      403,
    ],
    [
      "a principal no registration names",
      {
        ...served,
        registry: {
          ...served.registry,
          identify: () => Promise.resolve(undefined),
        },
      },
      poolToken,
      403,
    ],
    ["an issuer that cannot answer", served, "issuer-down", 503],
    ["an authority outage", plane(ports, authority("Outage")), poolToken, 503],
    [
      "a registry that cannot be read",
      {
        ...served,
        registry: {
          ...served.registry,
          identify: () => Promise.reject(new Error("down")),
        },
      },
      poolToken,
      503,
    ],
    [
      "held assignments that cannot be read",
      {
        ...served,
        assignments: {
          ...ports,
          heldImages: () => Promise.reject(new Error("down")),
        },
      },
      poolToken,
      503,
    ],
  ] as const) {
    const answered = await createPoolPlaneApp(service).inject({
      method: "GET",
      url: authorizing,
      headers: forwarded(
        "GET",
        `/v2/worker/manifests/${heldDigest}`,
        basic(token),
      ),
    });
    assert.equal(answered.statusCode, status, why);
    assert.equal(answered.body, "");
    assert.equal(answered.headers["www-authenticate"], undefined, why);
  }
});

test("a personal runner is admitted by its owner's permit and renews the executions it names", async () => {
  const recorded = calls();
  const sessions = sessionCalls([], ["thread-one"]);
  const answered = await createPoolPlaneApp(
    plane(recorded.ports, authority("Allow"), sessions.store),
  ).inject({
    method: "GET",
    url: polling(["live"], 1, 1),
    headers: runnerSpeaking,
  });
  assert.equal(answered.statusCode, 200);
  const body = workerPoolReconciliationSchema.parse(answered.json());
  assert.deepEqual(body.assignments, []);
  assert.deepEqual(body.stop, []);
  assert.equal(body.sessions.length, 1);
  assert.deepEqual(recorded.made, [["renew", "live"]]);
});

test("a personal runner whose owner lost the permit to register one is told it is not there", async () => {
  const recorded = calls();
  const sessions = sessionCalls([], ["thread-one"]);
  const answered = await createPoolPlaneApp(
    plane(recorded.ports, authority("Refuse"), sessions.store),
  ).inject({
    method: "GET",
    url: polling([], 1, 1),
    headers: runnerSpeaking,
  });
  assert.equal(answered.statusCode, 404);
  assert.deepEqual(sessions.made, [], "a refused runner reached sessions");
});

test("a personal runner's settlement of an execution reaches the executions it holds", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "POST",
    url: workerPoolSettlementPath("Accepted", "live"),
    headers: runnerSpeaking,
  });
  assert.equal(answered.statusCode, 204);
  assert.deepEqual(recorded.made, [["held", "live"]]);
});

test("a personal runner's session is opened only in a project its owner may still read", async () => {
  const read: unknown[] = [];
  const sessions = sessionCalls([], ["thread-one"]);
  const refusing: ProjectAccess = {
    ...authority("Allow"),
    authorize: (principal, asked, access) => {
      read.push([principal, asked.project, access]);
      return Promise.resolve(undefined);
    },
  };
  const answered = await createPoolPlaneApp(
    plane(calls().ports, refusing, sessions.store),
  ).inject({
    method: "GET",
    url: polling([], 0, 1),
    headers: runnerSpeaking,
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(
    workerPoolReconciliationSchema.parse(answered.json()).sessions,
    [],
  );
  assert.deepEqual(read, [[runner.owner, asProjectId("project"), "Read"]]);
  assert.ok(
    !sessions.made.some((call) => Array.isArray(call) && call[0] === "open"),
    "a session was opened in a project its owner may not read",
  );
});

test("a personal runner polling while its owner's read cannot be answered is told to retry", async () => {
  const sessions = sessionCalls([], ["thread-one"]);
  const unanswered: ProjectAccess = {
    ...authority("Allow"),
    authorize: () =>
      Promise.reject(
        new ProjectAccessUnavailable("the authority is unreachable"),
      ),
  };
  const answered = await createPoolPlaneApp(
    plane(calls().ports, unanswered, sessions.store),
  ).inject({
    method: "GET",
    url: polling([], 0, 1),
    headers: runnerSpeaking,
  });
  assert.equal(answered.statusCode, 503);
  assert.equal(answered.body, "");
});
