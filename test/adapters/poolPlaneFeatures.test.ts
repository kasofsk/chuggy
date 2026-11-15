/**
 * The pool plane asked by feature. Each gate is driven by a poll whose
 * features header lists its feature, lists every other, or is not sent, and
 * one sending none is answered by its release exactly as
 * `contractVersionAccepted` answers for that feature's range. A chat host
 * listing features lists `ChatHost` beside them, since one that does not is
 * refused before any other gate is asked.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createPoolPlaneApp,
  type PoolPlaneService,
} from "../../src/adapters/http/poolPlaneServer.ts";
import {
  contractVersionRefusalStatus,
  workerContractFeatures,
  workerContractFeaturesHeader,
  workerContractFeaturesText,
  workerContractHeader,
  workerContractRelease,
  workerContractVersionText,
  type WorkerContractFeature,
} from "../../src/contract/workerContract.ts";
import {
  workerPoolPollQuery,
  workerPoolPollRoute,
  workerRunnerCredentialsHeader,
  workerRunnerHeader,
  workerRunnerMemoryRoomHeader,
} from "../../src/contract/workerPool.ts";
import {
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  asSessionId,
} from "../../src/interpreter/agentSession.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  contractVersionAccepted,
  workerContractChatHost,
  workerContractChatSessionThreads,
  workerContractChatThreadsClosed,
  workerContractRunnerAgents,
  workerContractRunnerCredentialOutcomes,
  workerContractRunnerCredentialPauses,
  workerContractRunnerJobsWaiting,
  workerContractRunnerProjects,
  workerContractRunnerReleases,
  workerContractUnscopedChat,
  type WorkerContractRange,
} from "../../src/interpreter/workerPlane.ts";
import {
  workerPoolContractAccepted,
  type ChatHostIdentity,
  type PersonalRunnerIdentity,
  type WorkerPoolAssignments,
  type WorkerPoolIdentity,
  type WorkerPoolRunners,
} from "../../src/interpreter/workerPool.ts";
import { workerPoolReports } from "../../src/interpreter/workerPoolReports.ts";
import type {
  SessionLaunchFacts,
  WorkerPoolSessionCandidate,
  WorkerPoolSessions,
} from "../../src/interpreter/workerPoolSessions.ts";
import { workerRunnerReleasesRead } from "../../src/interpreter/workerRunnerRelease.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";
import { workerPoolAssignmentsIdle } from "../interpreter/workerPoolFixture.ts";

/** The headers a probe sends beside its bearer, one of them sent more than once where its value is a list. */
type PoolPlaneFeatureHeaders = Readonly<Record<string, string | string[]>>;

/** One gate: the feature it asks for, the range whose floor is that feature's version, and whether a poll sending `headers` was given what the feature carries. */
interface PoolPlaneFeatureGate {
  readonly feature: WorkerContractFeature;
  readonly range: WorkerContractRange;
  readonly given: (headers: PoolPlaneFeatureHeaders) => Promise<boolean>;
}

const issuer = "https://issuer.invalid";
const partition = { tenant: "tenant", project: "project" } as Partition;
const pool: WorkerPoolIdentity = {
  partition,
  pool: "pool-one",
  principal: oidcPrincipal(issuer, "pool-client"),
};
const runner: PersonalRunnerIdentity = {
  tenant: partition.tenant,
  owner: oidcPrincipal(issuer, "a-member"),
  principal: oidcPrincipal(issuer, "chuggy-personal-one"),
};
const host: ChatHostIdentity = {
  tenant: partition.tenant,
  owner: oidcPrincipal(issuer, "a-member"),
  principal: oidcPrincipal(issuer, "chuggy-personal-host"),
};
const callers = new Map([
  ["pool-token", pool.principal],
  ["runner-token", runner.principal],
  ["host-token", host.principal],
]);
const poolBearer = { authorization: "Bearer pool-token" };
const runnerBearer = { authorization: "Bearer runner-token" };
const hostBearer = { authorization: "Bearer host-token" };

const pinned = `registry.invalid/worker@sha256:${"a".repeat(64)}`;
const personalClaimed = {
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: pinned,
  },
  project: asProjectId("project"),
} as const;

const launch: SessionLaunchFacts = {
  image: `registry.invalid/session@sha256:${"c".repeat(64)}`,
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

const threadWaiting: WorkerPoolSessionCandidate = {
  project: partition.project,
  session: asSessionId("thread-one"),
  kind: "Thread",
  capabilities: [],
};

/** Every authority question permitted. */
const allowing: ProjectAccess = {
  authorize: (principal) => Promise.resolve(memberAuthority(principal)),
  authorizeTenant: (principal) => Promise.resolve(memberAuthority(principal)),
  authorizeSite: projectAccessSiteRefused,
};

/** Offers no session and has closed no thread. */
const sessionsInert: WorkerPoolSessions = {
  launch: () => Promise.resolve(launch),
  threadsClosed: () => Promise.resolve([]),
  among: () => Promise.resolve(new Set()),
  awaiting: () => Promise.resolve([]),
  open: () => Promise.resolve("Opened"),
  renew: () => Promise.resolve(false),
  held: () => Promise.resolve(true),
  refuse: () => Promise.resolve(true),
  release: () => Promise.resolve(true),
  heldImages: () => Promise.resolve([]),
  polled: () => Promise.resolve(),
};

const runnersInert: WorkerPoolRunners = { named: () => Promise.resolve() };

/** An issuer that knows the three callers' tokens and refuses any other. */
const poolPlaneFeatureIssuer: PoolPlaneService["authentication"] = {
  authenticateBearer: (token: string) => {
    const principal = callers.get(token);
    return Promise.resolve(
      principal === undefined
        ? ({ authenticated: "InvalidToken" } as const)
        : ({ authenticated: "Bearer", bearer: { principal } } as const),
    );
  },
};

/** The one runner package this site pins. */
const poolPlaneFeatureReleases = workerRunnerReleasesRead({
  "chuggy-linux": {
    version: "0.14.1",
    url: "https://github.com/kasofsk/chuggy-linux/releases/download/v0.14.1/chuggy-linux-0.14.1.tgz",
    integrity: `sha512-${"A".repeat(85)}g==`,
  },
});

const poolPlaneFeatureSettings: PoolPlaneService["settings"] = {
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
};

/** The plane over the three callers, every port but those `over` names answering the least it can. */
function poolPlaneFeatureApp(
  over: {
    readonly assignments?: Partial<WorkerPoolAssignments>;
    readonly sessions?: Partial<WorkerPoolSessions>;
    readonly runners?: WorkerPoolRunners;
  } = {},
) {
  const service: PoolPlaneService = {
    authentication: poolPlaneFeatureIssuer,
    access: allowing,
    registry: {
      register: () => Promise.resolve(true),
      clientOf: () => Promise.resolve(undefined),
      deregister: () => Promise.resolve(false),
      identify: (principal) =>
        Promise.resolve(principal === pool.principal ? pool : undefined),
    },
    personal: {
      identify: (principal) =>
        Promise.resolve(principal === runner.principal ? runner : undefined),
    },
    chatHosts: {
      identify: (principal) =>
        Promise.resolve(principal === host.principal ? host : undefined),
    },
    assignments: { ...workerPoolAssignmentsIdle, ...over.assignments },
    sessions: {
      store: { ...sessionsInert, ...over.sessions },
      bindings: { binding: () => Promise.resolve(undefined) },
      bearers: {
        mint: () => ({
          attempt: asSessionAttemptId("attempt-one"),
          bearer: {
            id: asSessionBearerId("bearer-one"),
            secret: asSessionBearerSecret(`chgs_${"e".repeat(64)}`),
          },
          bearerSecretDigest: "d".repeat(64),
        }),
      },
    },
    runners: over.runners ?? runnersInert,
    releases: poolPlaneFeatureReleases,
    reports: workerPoolReports({
      issuer,
      runnersMax: 4,
      ageMsMax: 1_000,
      now: () => 0,
    }),
    mint: (() => {
      let minted = 0;
      return () => `minted-${String((minted += 1))}`;
    })(),
    settings: poolPlaneFeatureSettings,
    ready: () => Promise.resolve(true),
  };
  return createPoolPlaneApp(service);
}

/** The poll's address, holding `held` and with room for `wanted` executions and `wantedSessions` sessions. */
function poolPlaneFeaturePolling(
  held: readonly string[],
  wanted: number,
  wantedSessions: number,
): string {
  const query = new URLSearchParams([
    ...held.map((assignment) => [workerPoolPollQuery.held, assignment]),
    [workerPoolPollQuery.wanted, String(wanted)],
    [workerPoolPollQuery.wantedSessions, String(wantedSessions)],
  ]).toString();
  return `${workerPoolPollRoute}?${query}`;
}

/** The answer `app` gives one poll, which must be served, the app closed after it. */
async function poolPlaneFeaturePolled(
  app: ReturnType<typeof createPoolPlaneApp>,
  url: string,
  headers: PoolPlaneFeatureHeaders,
): Promise<Record<string, unknown>> {
  const answered = await app.inject({ method: "GET", url, headers });
  await app.close();
  assert.equal(answered.statusCode, 200, answered.body);
  return answered.json<Record<string, unknown>>();
}

/** `headers` as a chat host sends them: a list it sends names `ChatHost` too. */
function poolPlaneFeatureHosted(
  headers: PoolPlaneFeatureHeaders,
): PoolPlaneFeatureHeaders {
  const listed = headers[workerContractFeaturesHeader];
  if (listed === undefined) return { ...headers, ...hostBearer };
  const names = Array.isArray(listed) ? listed : [listed];
  return {
    ...headers,
    ...hostBearer,
    [workerContractFeaturesHeader]: [...names, "ChatHost"],
  };
}

const poolPlaneFeatureGates: readonly PoolPlaneFeatureGate[] = [
  {
    feature: "RunnerProjects",
    range: workerContractRunnerProjects,
    given: async (headers) => {
      const body = await poolPlaneFeaturePolled(
        poolPlaneFeatureApp({
          assignments: {
            allowlisted: () => Promise.resolve([asProjectId("project")]),
            claimPersonal: () => Promise.resolve(personalClaimed),
          },
        }),
        poolPlaneFeaturePolling([], 1, 0),
        { ...headers, ...runnerBearer },
      );
      const [assignment] = body["assignments"] as Record<string, unknown>[];
      assert.ok(assignment !== undefined);
      return "project" in assignment;
    },
  },
  {
    feature: "MemoryRoom",
    range: workerContractRunnerJobsWaiting,
    given: async (headers) => {
      const body = await poolPlaneFeaturePolled(
        poolPlaneFeatureApp({
          assignments: { waiting: () => Promise.resolve(true) },
        }),
        poolPlaneFeaturePolling([], 0, 0),
        { ...headers, ...poolBearer, [workerRunnerMemoryRoomHeader]: "4096" },
      );
      return body["jobsWaiting"] === true;
    },
  },
  {
    feature: "CredentialOutcome",
    range: workerContractRunnerCredentialOutcomes,
    given: async (headers) => {
      const body = await poolPlaneFeaturePolled(
        poolPlaneFeatureApp({
          assignments: {
            renew: () => Promise.resolve(false),
            credentialOutcomes: () =>
              Promise.resolve([
                { assignment: "benched", outcome: "CreditsExhausted" },
              ]),
          },
        }),
        poolPlaneFeaturePolling(["benched"], 0, 0),
        { ...headers, ...runnerBearer },
      );
      assert.deepEqual(body["stop"], ["benched"]);
      return body["credentialOutcomes"] !== undefined;
    },
  },
  {
    feature: "CredentialPauses",
    range: workerContractRunnerCredentialPauses,
    given: async (headers) => {
      const body = await poolPlaneFeaturePolled(
        poolPlaneFeatureApp({
          assignments: {
            credentialPauses: () =>
              Promise.resolve([
                {
                  agent: "Claude",
                  credential: "work",
                  pausedUntil: 1_800_000_000,
                },
              ]),
          },
        }),
        poolPlaneFeaturePolling([], 0, 0),
        {
          ...headers,
          ...poolBearer,
          [workerRunnerCredentialsHeader]: "Claude:work",
        },
      );
      return body["credentialPauses"] !== undefined;
    },
  },
  {
    feature: "RunnerAgentsAdvertised",
    range: workerContractRunnerAgents,
    given: async (headers) => {
      const advertised: (boolean | undefined)[] = [];
      await poolPlaneFeaturePolled(
        poolPlaneFeatureApp({
          runners: {
            named: (_caller, _runner, _capabilities, _ceiling, agents) =>
              Promise.resolve(void advertised.push(agents)),
          },
        }),
        poolPlaneFeaturePolling([], 0, 0),
        { ...headers, ...runnerBearer },
      );
      assert.equal(advertised.length, 1);
      return advertised[0] === true;
    },
  },
  {
    feature: "ChatThreadsClosed",
    range: workerContractChatThreadsClosed,
    given: async (headers) => {
      const body = await poolPlaneFeaturePolled(
        poolPlaneFeatureApp({
          sessions: {
            threadsClosed: () =>
              Promise.resolve([
                { project: partition.project, session: "closed-one" },
              ]),
          },
        }),
        poolPlaneFeaturePolling([], 0, 0),
        poolPlaneFeatureHosted(headers),
      );
      return body["threadsClosed"] !== undefined;
    },
  },
  {
    feature: "UnscopedChat",
    range: workerContractUnscopedChat,
    given: async (headers) => {
      const scoped: boolean[] = [];
      await poolPlaneFeaturePolled(
        poolPlaneFeatureApp({
          sessions: {
            awaiting: (_identity, _backoff, _max, memberScope) =>
              Promise.resolve((scoped.push(memberScope), [])),
          },
        }),
        poolPlaneFeaturePolling([], 0, 1),
        poolPlaneFeatureHosted(headers),
      );
      assert.equal(scoped.length, 1);
      return scoped[0] === true;
    },
  },
  {
    feature: "ChatSessionThreads",
    range: workerContractChatSessionThreads,
    given: async (headers) => {
      const body = await poolPlaneFeaturePolled(
        poolPlaneFeatureApp({
          sessions: { awaiting: () => Promise.resolve([threadWaiting]) },
        }),
        poolPlaneFeaturePolling([], 0, 1),
        poolPlaneFeatureHosted(headers),
      );
      const [session] = body["sessions"] as Record<string, unknown>[];
      assert.ok(session !== undefined);
      return "thread" in session;
    },
  },
  {
    feature: "RunnerReleases",
    range: workerContractRunnerReleases,
    given: async (headers) => {
      const body = await poolPlaneFeaturePolled(
        poolPlaneFeatureApp(),
        poolPlaneFeaturePolling([], 0, 0),
        {
          ...headers,
          ...poolBearer,
          [workerRunnerHeader]: "chuggy-linux/0.14.0",
        },
      );
      return body["release"] !== undefined;
    },
  },
  {
    feature: "ChatHost",
    range: workerContractChatHost,
    given: async (headers) => {
      const app = poolPlaneFeatureApp();
      const answered = await app.inject({
        method: "GET",
        url: poolPlaneFeaturePolling([], 0, 1),
        headers: { ...headers, ...hostBearer },
      });
      await app.close();
      assert.ok(
        [200, contractVersionRefusalStatus].includes(answered.statusCode),
      );
      return answered.statusCode === 200;
    },
  },
];

const poolPlaneFeaturesAll = Object.keys(
  workerContractFeatures,
) as WorkerContractFeature[];

/** The release a version names, patch zero. */
function poolPlaneFeatureRelease(version: {
  readonly major: number;
  readonly minor: number;
}): string {
  return `${workerContractVersionText(version)}.0`;
}

/** The first release the pool plane serves. */
const poolPlaneFeatureFloor = poolPlaneFeatureRelease(
  workerPoolContractAccepted.min,
);

test("every gate the pool plane asks a feature of is driven here, each once", () => {
  const driven = poolPlaneFeatureGates.map((gate) => gate.feature);
  assert.equal(new Set(driven).size, driven.length);
  assert.deepEqual([...driven].sort(), [
    "ChatHost",
    "ChatSessionThreads",
    "ChatThreadsClosed",
    "CredentialOutcome",
    "CredentialPauses",
    "MemoryRoom",
    "RunnerAgentsAdvertised",
    "RunnerProjects",
    "RunnerReleases",
    "UnscopedChat",
  ]);
});

for (const { feature, range, given } of poolPlaneFeatureGates) {
  const first = workerContractFeatures[feature];
  if (first === undefined)
    throw new Error(
      `${feature} first shipped in no release, so no range floors at it`,
    );
  const below = poolPlaneFeatureRelease({
    major: first.major,
    minor: first.minor - 1,
  });
  const exactly = poolPlaneFeatureRelease(first);

  test(`a poll listing no features is given ${feature} from the release its range admitted, and not one minor before`, async () => {
    for (const [release, expected] of [
      [below, false],
      [exactly, true],
      [workerContractRelease, true],
    ] as const) {
      assert.equal(
        await given({ [workerContractHeader]: release }),
        expected,
        `${feature} at ${release}`,
      );
      assert.equal(
        contractVersionAccepted(range, release),
        expected,
        `${feature}'s range at ${release}`,
      );
    }
  });

  test(`a poll listing ${feature} is given it whatever accepted release it names, and one listing every other feature is not`, async () => {
    const others = workerContractFeaturesText(
      poolPlaneFeaturesAll.filter((other) => other !== feature),
    );
    for (const release of [poolPlaneFeatureFloor, below, exactly])
      assert.equal(
        await given({
          [workerContractHeader]: release,
          [workerContractFeaturesHeader]: workerContractFeaturesText([feature]),
        }),
        true,
        `${feature} listed at ${release}`,
      );
    for (const release of [exactly, workerContractRelease])
      assert.equal(
        await given({
          [workerContractHeader]: release,
          [workerContractFeaturesHeader]: others,
        }),
        false,
        `${feature} unlisted at ${release}`,
      );
  });
}
