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
} from "../../src/contract/workerPool.ts";
import {
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  asSessionId,
} from "../../src/interpreter/agentSession.ts";
import { workerContractAccepted } from "../../src/interpreter/workerPlane.ts";
import type {
  WorkerPoolAssignments,
  WorkerPoolIdentity,
} from "../../src/interpreter/workerPool.ts";
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
import type { Partition } from "../../src/interpreter/projectStore.ts";
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

/** The image the one claimed execution pinned, and the name a pool is handed it by. */
const pinned = `registry.invalid/worker@sha256:${"a".repeat(64)}`;
const published = `registry.public.invalid/worker@sha256:${"a".repeat(64)}`;

/** A pool's token and the release it speaks, which is this plane's own. */
const speaking = {
  authorization: `Bearer ${poolToken}`,
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
      renew: (_identity, assignment) =>
        Promise.resolve(
          (made.push(["renew", assignment]), assignment === "live"),
        ),
      refuse: (_identity, assignment, evidence) =>
        Promise.resolve((made.push(["refuse", assignment, evidence]), true)),
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
      token === poolToken
        ? ({
            authenticated: "Bearer",
            bearer: { principal: poolPrincipal },
          } as const)
        : token === "issuer-down"
          ? ({ authenticated: "AuthorityUnavailable" } as const)
          : ({ authenticated: "InvalidToken" } as const),
    ),
};

/** An authority that permits the one principal, unless the case asks it to fail. */
function authority(answer: "Allow" | "Refuse" | "Outage"): ProjectAccess {
  return {
    authorize: (principal: Principal) => {
      if (answer === "Outage")
        throw new ProjectAccessUnavailable("the authority is unreachable");
      return Promise.resolve(
        answer === "Allow" ? memberAuthority(principal) : undefined,
      );
    },
    authorizeTenant: () => Promise.resolve(undefined),
    authorizeSite: projectAccessSiteRefused,
  };
}

function plane(
  ports: WorkerPoolAssignments,
  access: ProjectAccess = authority("Allow"),
  sessions: WorkerPoolSessions = sessionCalls().store,
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
        assignment: "minted-1",
        capabilities: ["Platform:Linux:Amd64"],
        image: published,
        cpuMillis: 500,
        memoryMib: 256,
        deadlineSecs: 600,
        callbackUrl: "https://plane.invalid/v1/ticket-execution",
        bearer: "minted-2",
      },
    ],
    sessions: [],
    stop: ["gone"],
  });
  assert.deepEqual(recorded.made, [
    ["renew", "live"],
    ["renew", "gone"],
    ["claim", "minted-1"],
  ]);
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
  assert.deepEqual(recorded.made, [["claim", "minted-1"]]);
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

test("a pool naming a release from before sessions is answered without a list of them, whatever room it says it has", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: `${polling(["live", "gone"])}&wantedSessions=2`,
    headers: { ...speaking, [workerContractHeader]: "1.2.0" },
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), {
    assignments: [
      {
        assignment: "minted-1",
        capabilities: ["Platform:Linux:Amd64"],
        image: published,
        cpuMillis: 500,
        memoryMib: 256,
        deadlineSecs: 600,
        callbackUrl: "https://plane.invalid/v1/ticket-execution",
        bearer: "minted-2",
      },
    ],
    stop: ["gone"],
  });
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
  for (const offered of [undefined, "1.0.0", "1.1.0", unreleased]) {
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
          min: "1.2",
          max: workerContractVersionText(workerContractAccepted.max),
        },
      });
    }
  }
  assert.deepEqual(recorded.made, []);
});

/** What a claim returns: an image pinned on a published host, and a capability requirement, which is handed out with no image. */
const claims = {
  pinned: {
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: pinned,
    },
  },
  capable: {
    requirement: {
      mode: "ContainerCapability",
      operatingSystem: "Linux",
      architecture: "Amd64",
      capabilities: ["Agent:Codex"],
    },
  },
} as const;

/** Every poll a replayed pool makes: what it holds, how many executions and sessions it has room for, and what a claim returns it. */
const poolReplayPolls = [
  ["a pinned image", ["live", "gone"], 1, 0, claims.pinned],
  ["a capability requirement", [], 1, 0, claims.capable],
  ["no room", ["live"], 0, 0, claims.pinned],
  ["nothing to claim", [], 1, 0, undefined],
  ["room for a session", [], 0, 1, undefined],
] as const;

/**
 * Every poll a pool built with `older` makes, through the names its own
 * release exports, read by its own reconciliation schema. That schema is
 * strict, so an answer naming a field it does not is one such a pool refuses
 * whole, and `sessions` is answered only to a release whose poll can ask for
 * one.
 */
function poolReplayPolled(older: WorkerContractReleasePool): void {
  const { wantedSessions } = older.pollQuery;
  const polls = poolReplayPolls.filter(
    ([, , , sessions]) => sessions === 0 || wantedSessions !== undefined,
  );
  test(`a ${older.release} pool reads every reconciliation a poll answers it with, and is handed a session only where its release asked for one`, async () => {
    const seen = new Map<string, Set<boolean>>();
    for (const [what, held, wanted, sessions, claimed] of polls) {
      const recorded = calls();
      const ports = {
        ...recorded.ports,
        claim: () => Promise.resolve(claimed),
      };
      const offering = sessionCalls([], ["session-waiting"]);
      const query = new URLSearchParams([
        ...held.map((assignment) => [older.pollQuery.held, assignment]),
        [older.pollQuery.wanted, String(wanted)],
        ...(wantedSessions === undefined || sessions === 0
          ? []
          : [[wantedSessions, String(sessions)]]),
      ]);
      const answered = await createPoolPlaneApp(
        plane(ports, authority("Allow"), offering.store),
      ).inject({
        method: "GET",
        url: `${older.pollRoute}?${query.toString()}`,
        headers: {
          authorization: `Bearer ${poolToken}`,
          [workerContractHeader]: older.release,
        },
      });
      assert.equal(answered.statusCode, 200, what);
      const body: unknown = answered.json();
      assert.deepEqual(older.reconciliation.parse(body), body, what);
      assert.equal(
        Object.hasOwn(body as object, "sessions"),
        wantedSessions !== undefined,
        what,
      );
      if (wantedSessions === undefined)
        assert.deepEqual(offering.made, [], what);
      else
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
  const unsessioned = await app.inject({
    method: "GET",
    url: polling(["live", "live", "live", "session-live"], 0),
    headers: { ...speaking, [workerContractHeader]: "1.2.0" },
  });
  assert.equal(
    unsessioned.statusCode,
    400,
    "a pool reading no sessions is held to its executions' bound alone",
  );
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
