/**
 * The job and session planes asked by feature. Each gate is driven by a
 * request whose features header lists its feature, lists every other, or is
 * not sent, and one sending none is answered by its release exactly as
 * `contractVersionAccepted` answers for that feature's range.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkerPlaneApp,
  workerPlaneHealthRoutes,
  type SessionPlaneService,
  type WorkerPlaneServerService,
} from "../../src/adapters/http/workerPlaneServer.ts";
import {
  workerContractFeatures,
  workerContractFeaturesHeader,
  workerContractFeaturesOf,
  workerContractFeaturesText,
  workerContractHeader,
  workerContractRelease,
  workerContractVersionText,
  type WorkerContractFeature,
} from "../../src/contract/workerContract.ts";
import { workerPlaneRoutes } from "../../src/contract/workerPlane.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  asSessionAttemptId,
  asSessionId,
  type SessionCapability,
} from "../../src/interpreter/agentSession.ts";
import {
  asAttemptId,
  asExecutionId,
  type WorkTaskInvocation,
} from "../../src/interpreter/executionScheduler.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
import type { SessionPlaneIdentity } from "../../src/interpreter/sessionPlane.ts";
import {
  contractVersionAccepted,
  workerContractCredentialBundlesServed,
  workerContractEvaluatedTrees,
  workerContractLiveStops,
  workerContractProjectReads,
  workerContractRunnerSessions,
  workerContractSystemPromptsOwn,
  workerContractTargetRefs,
  workerContractThreadOffer,
  workerContractTicketDispatch,
  workerContractUnscopedChat,
  type WorkerAttemptAuthority,
  type WorkerContractRange,
  type WorkerTaskRead,
} from "../../src/interpreter/workerPlane.ts";
import type {
  SessionTaskIdentity,
  SessionTaskLaunch,
} from "../../src/interpreter/workerTask.ts";
import {
  inertSessionPlane,
  inertTasks,
  inertWorkerPlane,
} from "./workerPlaneFixtures.ts";

/** The headers a probe sends beside its bearer, one of them sent more than once where its value is a list. */
type WorkerPlaneFeatureHeaders = Readonly<Record<string, string | string[]>>;

/** One gate: the feature it asks for, the range whose floor is that feature's version, and whether a request sending `headers` was given what the feature carries. */
interface WorkerPlaneFeatureGate {
  readonly feature: WorkerContractFeature;
  readonly range: WorkerContractRange;
  readonly given: (headers: WorkerPlaneFeatureHeaders) => Promise<boolean>;
}

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const attemptAuthority: WorkerAttemptAuthority = {
  live: true,
  partition,
  execution: asExecutionId("execution"),
  attempt: asAttemptId("attempt"),
  generation: 1,
  taskKind: "Work",
  manifest: asResultManifestId("manifest"),
  inputBundle: "bundle",
  inputBundleDigest: "digest",
  inputs: [{ ordinal: 1, kind: "Repository", reference: "source" }],
};

const workInvocation: WorkTaskInvocation = {
  profile: { profile: "standard", runtimeVersion: "1" },
  briefing: { templateVersion: 1, purpose: "Work", text: "Do the work." },
  authority: {
    tools: [],
    credentials: [],
    network: false,
    filesystem: "WriteWorkspace",
    mayCompleteTask: false,
  },
};

const workTaskFound: WorkerTaskRead = {
  live: true,
  identity: {
    partition,
    execution: attemptAuthority.execution,
    attempt: attemptAuthority.attempt,
    generation: attemptAuthority.generation,
    ticket: asTicketId(1),
    task: asTaskId(1),
    taskKind: "Work",
    sourceRequest: "1:0:ExecuteTask",
    inputBundle: attemptAuthority.inputBundle,
    inputBundleDigest: attemptAuthority.inputBundleDigest,
    configurationRevision: "revision",
    configurationDigest: "configuration-digest",
    requirementIdentity: "requirement",
    requirementDigest: "requirement-digest",
  },
  invocation: workInvocation,
};

const attemptHeld = { authorization: "Bearer held" };
const sessionHeld = { authorization: `Bearer chgs_${"a".repeat(32)}` };
const json = { "content-type": "application/json" };

const sessionIdentity: SessionPlaneIdentity = {
  live: true,
  partition,
  session: asSessionId("session"),
  attempt: asSessionAttemptId("session-attempt"),
  generation: 2,
  kind: "Thread",
  capabilities: ["RepositoryRead"],
  credentialSlot: "claude-code",
};

const sessionTaskIdentity: SessionTaskIdentity = {
  partition,
  session: sessionIdentity.session,
  attempt: sessionIdentity.attempt,
  generation: sessionIdentity.generation,
  kind: "Thread",
  credentialSlot: "claude-code",
};

const sessionLaunch: SessionTaskLaunch = {
  api: { url: "https://api.invalid" },
  bounds: {
    mailboxPollMs: 1,
    idleMs: 2,
    resultDrainMs: 3,
    loadTimeoutMs: 4,
    turnsMax: 5,
    budgetUsd: 6,
  },
  model: "model",
};

/** The plane over a live attempt, every port but those `over` names answering the least it can. */
function workerPlaneFeatureAttempt(over: Partial<WorkerPlaneServerService>) {
  return createWorkerPlaneApp({
    ...inertWorkerPlane(64),
    authority: { authenticate: () => Promise.resolve(attemptAuthority) },
    ...over,
  });
}

/** The plane over a live session `identity` names, every session port but those `over` names answering the least it can. */
function workerPlaneFeatureSession(
  over: Partial<SessionPlaneService> = {},
  identity: Partial<SessionPlaneIdentity> = {},
) {
  return createWorkerPlaneApp({
    ...inertWorkerPlane(64),
    sessions: {
      ...inertSessionPlane({
        authenticate: () =>
          Promise.resolve({ ...sessionIdentity, ...identity }),
      }),
      ...over,
    },
  });
}

/** The answer `app` gives one request, the app closed after it. */
async function workerPlaneFeatureAsked(
  app: ReturnType<typeof createWorkerPlaneApp>,
  request: {
    readonly method: "GET" | "POST";
    readonly url: string;
    readonly headers: WorkerPlaneFeatureHeaders;
    readonly payload?: string | object;
  },
) {
  const answered = await app.inject(request);
  await app.close();
  return answered;
}

/** Whether a session holding `capability` is told it in its facts. */
function workerPlaneFeatureCapabilityNamed(
  capability: SessionCapability,
): WorkerPlaneFeatureGate["given"] {
  return async (headers) => {
    const answered = await workerPlaneFeatureAsked(
      workerPlaneFeatureSession({}, { capabilities: [capability] }),
      {
        method: "GET",
        url: "/v1/session",
        headers: { ...sessionHeld, ...headers },
      },
    );
    return answered
      .json<{ capabilities: string[] }>()
      .capabilities.includes(capability);
  };
}

const workerPlaneFeatureGates: readonly WorkerPlaneFeatureGate[] = [
  {
    feature: "TargetRef",
    range: workerContractTargetRefs,
    given: async (headers) => {
      const named: WorkerTaskRead = {
        ...workTaskFound,
        invocation: { ...workInvocation, targetRef: "refs/heads/release" },
      };
      const answered = await workerPlaneFeatureAsked(
        workerPlaneFeatureAttempt({
          tasks: { ...inertTasks, work: () => Promise.resolve(named) },
        }),
        {
          method: "GET",
          url: "/v1/task",
          headers: { ...attemptHeld, ...headers },
        },
      );
      return Object.hasOwn(answered.json<object>(), "targetRef");
    },
  },
  {
    feature: "RunnerSessions",
    range: workerContractRunnerSessions,
    given: async (headers) => {
      const answered = await workerPlaneFeatureAsked(
        createWorkerPlaneApp({
          ...inertWorkerPlane(64),
          tasks: {
            ...inertTasks,
            session: () =>
              Promise.resolve({
                live: true,
                identity: sessionTaskIdentity,
                invocation: {
                  capabilities: ["RepositoryRead"],
                  agentReference: "runtime-session",
                  authority: { ...workInvocation.authority },
                  repository: { reference: "github.com/owner/name" },
                },
                launch: sessionLaunch,
              }),
          },
          sessions: inertSessionPlane({
            authenticate: () => Promise.resolve(sessionIdentity),
          }),
        }),
        {
          method: "GET",
          url: "/v1/task",
          headers: { ...sessionHeld, ...headers },
        },
      );
      assert.equal(answered.statusCode, 200);
      return Object.hasOwn(answered.json<object>(), "api");
    },
  },
  {
    feature: "EvaluatedTree",
    range: workerContractEvaluatedTrees,
    given: async (headers) => {
      const held: boolean[] = [];
      await workerPlaneFeatureAsked(
        workerPlaneFeatureAttempt({
          reports: {
            report: (_secret, submission) => {
              held.push(submission.treeHeld === true);
              return Promise.resolve({ ingested: "Fenced" });
            },
          },
        }),
        {
          method: "POST",
          url: "/v1/report",
          headers: {
            ...attemptHeld,
            "content-type": "text/plain",
            ...headers,
          },
          payload: "{}",
        },
      );
      const [treeHeld, ...more] = held;
      assert.ok(treeHeld !== undefined && more.length === 0);
      return treeHeld;
    },
  },
  {
    feature: "CredentialBundles",
    range: workerContractCredentialBundlesServed,
    given: async (headers) => {
      const answered = await workerPlaneFeatureAsked(
        workerPlaneFeatureAttempt({
          tasks: { ...inertTasks, work: () => Promise.resolve(workTaskFound) },
          heldCredentials: {
            resolve: () =>
              Promise.resolve({
                resolved: "Credentials",
                credentials: [],
                absent: [{ credential: "unheld", reason: "NotHeld" }],
              }),
          },
        }),
        {
          method: "POST",
          url: workerPlaneRoutes.heldCredentials.path,
          headers: { ...attemptHeld, ...json, ...headers },
          payload: { credentials: ["unheld"] },
        },
      );
      assert.equal(answered.statusCode, 200);
      return Object.hasOwn(answered.json<object>(), "absent");
    },
  },
  {
    feature: "TicketDispatch",
    range: workerContractTicketDispatch,
    given: workerPlaneFeatureCapabilityNamed("TicketDispatch"),
  },
  {
    feature: "UnscopedChat",
    range: workerContractUnscopedChat,
    given: workerPlaneFeatureCapabilityNamed("MemberRead"),
  },
  {
    feature: "ThreadOffer",
    range: workerContractThreadOffer,
    given: workerPlaneFeatureCapabilityNamed("ThreadOffer"),
  },
  {
    feature: "LiveStops",
    range: workerContractLiveStops,
    given: async (headers) => {
      const answered = await workerPlaneFeatureAsked(
        workerPlaneFeatureSession({
          live: { publish: () => Promise.resolve("Unheld") },
          watches: { watched: () => Promise.resolve("Stopped") },
        }),
        {
          method: "POST",
          url: "/v1/session/turn/live",
          headers: { ...sessionHeld, ...headers },
          payload: { turn: "turn-1", events: [{ live: "End" }] },
        },
      );
      assert.ok([200, 204].includes(answered.statusCode));
      return answered.statusCode === 200;
    },
  },
  {
    feature: "ProjectReads",
    range: workerContractProjectReads,
    given: async (headers) => {
      const asked: unknown[] = [];
      await workerPlaneFeatureAsked(
        workerPlaneFeatureAttempt({
          credentials: {
            attempt: (_authority, repository) => {
              asked.push(repository);
              return Promise.resolve({ minted: "NotFound" });
            },
            session: () => Promise.resolve({ minted: "NotFound" }),
          },
        }),
        {
          method: "POST",
          url: "/v1/credential",
          headers: { ...attemptHeld, ...json, ...headers },
          payload: {
            repository: "https://github.com/kasofsk/chuggy-common.git",
          },
        },
      );
      assert.equal(asked.length, 1);
      return asked[0] !== undefined;
    },
  },
  {
    feature: "SystemPromptOwn",
    range: workerContractSystemPromptsOwn,
    given: async (headers) => {
      const answered = await workerPlaneFeatureAsked(
        workerPlaneFeatureSession({}, { systemPromptOwn: true }),
        {
          method: "GET",
          url: "/v1/session",
          headers: { ...sessionHeld, ...headers },
        },
      );
      assert.ok([200, 409].includes(answered.statusCode));
      return answered.statusCode === 200;
    },
  },
];

const workerPlaneFeaturesAll = Object.keys(
  workerContractFeatures,
) as WorkerContractFeature[];

/** The release a version names, patch zero. */
function workerPlaneFeatureRelease(version: {
  readonly major: number;
  readonly minor: number;
}): string {
  return `${workerContractVersionText(version)}.0`;
}

for (const { feature, range, given } of workerPlaneFeatureGates) {
  const first = workerContractFeatures[feature];
  const below = workerPlaneFeatureRelease({
    major: first.major,
    minor: first.minor - 1,
  });
  const exactly = workerPlaneFeatureRelease(first);

  test(`a request listing no features is given ${feature} from the release its range admitted, and not one minor before`, async () => {
    for (const [release, expected] of [
      [undefined, false],
      [below, false],
      [exactly, true],
      [workerContractRelease, true],
    ] as const) {
      const headers =
        release === undefined ? {} : { [workerContractHeader]: release };
      assert.equal(
        await given(headers),
        expected,
        `${feature} at ${release ?? "no release"}`,
      );
      assert.equal(
        contractVersionAccepted(range, release),
        expected,
        `${feature}'s range at ${release ?? "no release"}`,
      );
    }
  });

  test(`a request listing ${feature} is given it whatever accepted release it names, and one listing every other feature is not`, async () => {
    const others = workerContractFeaturesText(
      workerPlaneFeaturesAll.filter((other) => other !== feature),
    );
    for (const release of [undefined, "1.0.0", below, exactly]) {
      const named =
        release === undefined ? {} : { [workerContractHeader]: release };
      assert.equal(
        await given({
          ...named,
          [workerContractFeaturesHeader]: workerContractFeaturesText([feature]),
        }),
        true,
        `${feature} listed at ${release ?? "no release"}`,
      );
    }
    for (const release of [undefined, exactly, workerContractRelease]) {
      const named =
        release === undefined ? {} : { [workerContractHeader]: release };
      assert.equal(
        await given({ ...named, [workerContractFeaturesHeader]: others }),
        false,
        `${feature} unlisted at ${release ?? "no release"}`,
      );
    }
  });
}

test("a features header sent more than once is read as one list", async () => {
  const [gate] = workerPlaneFeatureGates;
  assert.ok(gate !== undefined);
  assert.equal(
    await gate.given({
      [workerContractFeaturesHeader]: ["LiveStops", gate.feature],
    }),
    true,
  );
  assert.equal(
    await gate.given({
      [workerContractHeader]: workerContractRelease,
      [workerContractFeaturesHeader]: ["LiveStops", "ProjectReads"],
    }),
    false,
  );
});

test("every answer names every feature in the roster, the probes' and the framework's own among them", async () => {
  const app = createWorkerPlaneApp({
    ...inertWorkerPlane(64),
    ready: () => Promise.resolve(false),
  });
  for (const [url, status] of [
    [workerPlaneHealthRoutes.live.path, 200],
    [workerPlaneHealthRoutes.ready.path, 503],
    ["/v1/nothing", 404],
    ["/v1/task", 401],
  ] as const) {
    const answered = await app.inject({ method: "GET", url });
    assert.equal(answered.statusCode, status, url);
    const named = answered.headers[workerContractFeaturesHeader];
    assert.equal(typeof named, "string", url);
    assert.deepEqual(
      workerContractFeaturesOf(String(named)),
      workerPlaneFeaturesAll,
      url,
    );
  }
  await app.close();
});
