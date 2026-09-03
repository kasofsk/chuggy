/**
 * The session pass at the lowest tier that can express it: which durable move
 * each placement answer produces, and that every step of one pass is asked for
 * at most the bound this deployment named.
 *
 * THE BOUNDS ARE ASSERTED AS THE ARGUMENTS THE STORE WAS GIVEN, not as a count
 * of what came back. A store that was asked for everything and happened to
 * answer with two rows is a pass with no bound at all on the day the table
 * fills up, and counting the answers cannot tell the two apart.
 *
 * WHAT THIS TIER CAN DECIDE is the branch. Whether ending an attempt returns
 * its turns to the mailbox atomically is a claim about PostgreSQL and belongs
 * against a real server.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  asSessionId,
  type AgentSession,
} from "../../src/interpreter/agentSession.ts";
import {
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import type { ProjectRepositoryBindingRead } from "../../src/interpreter/repositoryConfiguration.ts";
import {
  asCapacityAccountId,
  asClusterId,
  asPlacementId,
} from "../../src/interpreter/schedulerIdentity.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  sessionSchedulerDefaults,
  type FencedSessionAttempt,
  type SessionAttemptEvidence,
  type SessionAttemptOpened,
  type SessionAttemptOpening,
  type SessionPlacement,
  type SessionPlacementOutcome,
  type SessionPolicy,
  type SessionSchedulerStore,
} from "../../src/interpreter/sessionScheduler.ts";
import {
  sessionSchedulerPass,
  type SessionAttemptMint,
  type SessionSchedulerService,
} from "../../src/interpreter/sessionSchedulerRun.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const epoch = asRecoveryEpoch("epoch-one");

const session: AgentSession = {
  partition,
  session: asSessionId("session-one"),
  kind: "Lead",
  principal: asPrincipal("21:https://auth.invalidlead"),
  agentReference: "1a2b3c",
  capabilities: ["RepositoryRead"],
  credentialSlot: "claude-code",
  account: asCapacityAccountId("project"),
  cluster: asClusterId("cluster"),
  state: "Open",
};

const attempt: FencedSessionAttempt = {
  partition,
  session: session.session,
  attempt: asSessionAttemptId("session-attempt-one"),
  generation: 1,
};

const policy: SessionPolicy = {
  profile: { profile: "standard", runtimeVersion: "1" },
  image: "registry.invalid/worker:1",
  grant: {
    tools: [],
    credentials: ["claude-code"],
    network: true,
    filesystem: "WriteWorkspace",
    mayCompleteTask: false,
  },
};

/** The mint a case is driven with, which draws the same values every time. */
const bearers: SessionAttemptMint = {
  mint: () => ({
    attempt: attempt.attempt,
    bearer: {
      id: asSessionBearerId("bearer-one"),
      secret: asSessionBearerSecret(`chgs_${"a".repeat(64)}`),
    },
    bearerSecretDigest: "d".repeat(64),
  }),
};

/** One durable move asked of the store, kept as text so a whole pass is one array. */
type StoreCall = string;

/** What a case wants the store to answer, everything else being the empty answer. */
interface StoreAnswers {
  readonly awaiting?: readonly AgentSession[];
  readonly opened?: SessionAttemptOpened;
  readonly placed?: boolean;
  readonly cleanup?: readonly FencedSessionAttempt[];
  readonly cancelled?: "Accepted" | "Unavailable";
  readonly binding?: RepositoryBinding | Error | "PerProject";
}

/** A store that records the bound of every move asked of it and takes none. */
function recordingStore(
  calls: StoreCall[],
  answers: StoreAnswers,
): SessionSchedulerStore {
  return {
    awaitingPlacement: (_epoch, sessionsMax) => {
      calls.push(`awaitingPlacement ${String(sessionsMax)}`);
      return Promise.resolve(answers.awaiting ?? []);
    },
    openAttempt: (opening: SessionAttemptOpening) => {
      calls.push(
        `openAttempt ${opening.attempt} lease=${String(opening.leaseSecs)} backoff=${String(opening.placementBackoffSecs)} account=${String(opening.attemptsPerAccountMax)} cluster=${String(opening.clusterAttemptsMax)}`,
      );
      return Promise.resolve(answers.opened ?? { opened: "Opened", attempt });
    },
    attemptPlaced: (_attempt, placement) => {
      calls.push(`attemptPlaced ${placement}`);
      return Promise.resolve(answers.placed ?? true);
    },
    attemptEnded: (_attempt, evidence: SessionAttemptEvidence) => {
      calls.push(`attemptEnded ${evidence}`);
      return Promise.resolve(true);
    },
    reapLapsedAttempts: (_epoch, attemptsMax) => {
      calls.push(`reapLapsedAttempts ${String(attemptsMax)}`);
      return Promise.resolve(0);
    },
    reapIdleAttempts: (_epoch, idleSecsMax, attemptsMax) => {
      calls.push(
        `reapIdleAttempts ${String(idleSecsMax)} ${String(attemptsMax)}`,
      );
      return Promise.resolve(0);
    },
    fenceOldEpochAttempts: (_epoch, attemptsMax) => {
      calls.push(`fenceOldEpochAttempts ${String(attemptsMax)}`);
      return Promise.resolve(0);
    },
    attemptsAwaitingCleanup: (attemptsMax) => {
      calls.push(`attemptsAwaitingCleanup ${String(attemptsMax)}`);
      return Promise.resolve(answers.cleanup ?? []);
    },
    attemptCleanupCompleted: () => {
      calls.push("attemptCleanupCompleted");
      return Promise.resolve(true);
    },
  };
}

/**
 * The binding a case's project has, which is none unless the case gave it one.
 * `"PerProject"` answers from the partition it was handed, because against a
 * fixed answer a per-tenant read and a per-project one are the same test.
 */
function bindingsOf(
  calls: StoreCall[],
  binding?: RepositoryBinding | Error | "PerProject",
): ProjectRepositoryBindingRead {
  return {
    binding: (asked) => {
      calls.push(`binding ${asked.tenant}/${asked.project}`);
      if (binding instanceof Error) return Promise.reject(binding);
      return Promise.resolve(
        binding === "PerProject"
          ? {
              partition: asked,
              repository: asRepositoryId(asked.project),
              recoveryEpoch: epoch,
            }
          : binding,
      );
    },
  };
}

/** The service one case drives, with the placement answer that case is about. */
function service(
  calls: StoreCall[],
  answers: StoreAnswers,
  placement: SessionPlacementOutcome,
  placed?: (asked: SessionPlacement) => void,
): SessionSchedulerService {
  return {
    store: recordingStore(calls, answers),
    bindings: bindingsOf(calls, answers.binding),
    placement: {
      place: (asked) => {
        calls.push(`place ${asked.attempt}`);
        placed?.(asked);
        return Promise.resolve(placement);
      },
      cancel: () => {
        calls.push("cancel");
        return Promise.resolve({
          cancelled: answers.cancelled ?? "Accepted",
        });
      },
    },
    bearers,
    policy,
    config: sessionSchedulerDefaults,
  };
}

test("every step of one pass is asked for at most the bound this deployment named", async () => {
  const calls: StoreCall[] = [];
  const report = await sessionSchedulerPass(
    service(calls, {}, { placed: "Unavailable", retryAfterSeconds: 1 }),
    epoch,
  );
  assert.deepEqual(calls, [
    `fenceOldEpochAttempts ${String(sessionSchedulerDefaults.attemptsPerPassMax)}`,
    `attemptsAwaitingCleanup ${String(sessionSchedulerDefaults.attemptsPerPassMax)}`,
    `reapLapsedAttempts ${String(sessionSchedulerDefaults.attemptsPerPassMax)}`,
    `reapIdleAttempts ${String(sessionSchedulerDefaults.idleSecsMax)} ${String(sessionSchedulerDefaults.attemptsPerPassMax)}`,
    `awaitingPlacement ${String(sessionSchedulerDefaults.placementsPerPassMax)}`,
  ]);
  assert.deepEqual(report, {
    fenced: 0,
    cleaned: 0,
    reaped: 0,
    idled: 0,
    placed: 0,
  });
});

test("a session with a turn waiting is opened under this deployment's ceilings and placed", async () => {
  const calls: StoreCall[] = [];
  let asked: SessionPlacement | undefined = undefined;
  const report = await sessionSchedulerPass(
    service(
      calls,
      { awaiting: [session] },
      { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      (placement) => {
        asked = placement;
      },
    ),
    epoch,
  );
  assert.equal(report.placed, 1);
  assert.deepEqual(calls.slice(-4), [
    "binding tenant/project",
    `openAttempt session-attempt-one lease=${String(sessionSchedulerDefaults.attemptLeaseSecs)} backoff=${String(sessionSchedulerDefaults.placementBackoffSecs)} account=${String(sessionSchedulerDefaults.attemptsPerAccountMax)} cluster=${String(sessionSchedulerDefaults.clusterAttemptsMax)}`,
    "place session-attempt-one",
    "attemptPlaced chuggy-session-one",
  ]);
  assert.deepEqual(asked, {
    ...attempt,
    kind: "Lead",
    capabilities: ["RepositoryRead"],
    credentialSlot: "claude-code",
    agentReference: "1a2b3c",
    profile: policy.profile,
    image: policy.image,
    authority: policy.grant,
    bearer: bearers.mint().bearer,
  });
});

test("a session that has never run is placed with no reference to resume", async () => {
  let asked: SessionPlacement | undefined = undefined;
  const unrun: AgentSession = {
    partition,
    session: session.session,
    kind: session.kind,
    principal: session.principal,
    capabilities: session.capabilities,
    credentialSlot: session.credentialSlot,
    account: session.account,
    cluster: session.cluster,
    state: session.state,
  };
  await sessionSchedulerPass(
    service(
      [],
      { awaiting: [unrun] },
      { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      (placement) => {
        asked = placement;
      },
    ),
    epoch,
  );
  assert.ok(asked !== undefined);
  assert.ok(!Object.hasOwn(asked, "agentReference"));
});

test("an unavailable placement withdraws the attempt and a denied one records the denial", async () => {
  for (const [outcome, evidence] of [
    [{ placed: "Unavailable", retryAfterSeconds: 15 }, "PlacementUnavailable"],
    [
      { placed: "Denied", reason: "RequiredCapabilityUnavailable" },
      "PlacementDenied",
    ],
  ] as const) {
    const calls: StoreCall[] = [];
    const report = await sessionSchedulerPass(
      service(calls, { awaiting: [session] }, outcome),
      epoch,
    );
    assert.equal(report.placed, 0);
    assert.equal(calls.at(-1), `attemptEnded ${evidence}`);
    assert.ok(!calls.includes("attemptPlaced chuggy-session-one"));
  }
});

test("a session the durable side will not open an attempt for is not placed", async () => {
  for (const opened of [
    { opened: "NotLaunchable" },
    { opened: "BackingOff" },
    { opened: "AccountAtMaximum" },
    { opened: "ClusterFull" },
  ] as const) {
    const calls: StoreCall[] = [];
    const report = await sessionSchedulerPass(
      service(
        calls,
        { awaiting: [session], opened },
        { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      ),
      epoch,
    );
    assert.equal(report.placed, 0);
    assert.ok(
      !calls.includes("place session-attempt-one"),
      `a ${opened.opened} session reached the cluster`,
    );
  }
});

test("a pod the durable row would not take is cancelled where it was placed", async () => {
  const calls: StoreCall[] = [];
  const report = await sessionSchedulerPass(
    service(
      calls,
      { awaiting: [session], placed: false },
      { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
    ),
    epoch,
  );
  assert.equal(report.placed, 0);
  assert.equal(calls.at(-1), "cancel");
});

test("cleanup deletes each ended pod before it acknowledges the row", async () => {
  const calls: StoreCall[] = [];
  const report = await sessionSchedulerPass(
    service(
      calls,
      { cleanup: [attempt] },
      { placed: "Unavailable", retryAfterSeconds: 1 },
    ),
    epoch,
  );
  assert.equal(report.cleaned, 1);
  assert.deepEqual(calls.slice(1, 4), [
    `attemptsAwaitingCleanup ${String(sessionSchedulerDefaults.attemptsPerPassMax)}`,
    "cancel",
    "attemptCleanupCompleted",
  ]);
});

test("a cleanup the cluster cannot accept stops the pass rather than acknowledging it", async () => {
  await assert.rejects(
    sessionSchedulerPass(
      service(
        [],
        { cleanup: [attempt], cancelled: "Unavailable" },
        { placed: "Unavailable", retryAfterSeconds: 1 },
      ),
      epoch,
    ),
    /attempt cleanup is unavailable/u,
  );
});

test("a session is placed with the repository its project binds", async () => {
  const calls: StoreCall[] = [];
  const asked: SessionPlacement[] = [];
  await sessionSchedulerPass(
    service(
      calls,
      {
        awaiting: [session],
        binding: {
          partition,
          repository: asRepositoryId("chuggy"),
          recoveryEpoch: epoch,
        },
      },
      { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      (placement) => asked.push(placement),
    ),
    epoch,
  );
  assert.equal(asked[0]?.repository, asRepositoryId("chuggy"));
  assert.deepEqual(
    calls.filter((call) => call.startsWith("binding ")),
    ["binding tenant/project"],
    "the session's own partition is not what the binding was read for",
  );
});

test("a project that binds no repository places a session with no checkout", async () => {
  const asked: SessionPlacement[] = [];
  await sessionSchedulerPass(
    service(
      [],
      { awaiting: [session] },
      { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      (placement) => asked.push(placement),
    ),
    epoch,
  );
  assert.equal(asked.length, 1);
  assert.ok(
    !Object.hasOwn(asked[0] ?? {}, "repository"),
    "a project with no binding was given a repository",
  );
});

/**
 * A read that raised and a project that binds nothing are indistinguishable
 * once both place a session with no tree, and the read raises exactly where a
 * grant is missing. So the pass stops and the deployment says so.
 */
test("a binding the scheduler cannot read stops the pass rather than placing without one", async () => {
  const calls: StoreCall[] = [];
  await assert.rejects(
    sessionSchedulerPass(
      service(
        calls,
        {
          awaiting: [session],
          binding: new Error("permission denied for function"),
        },
        { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      ),
      epoch,
    ),
    /permission denied for function/u,
  );
  assert.ok(
    !calls.includes("place session-attempt-one"),
    "a session was placed after its binding read failed",
  );
});

/**
 * A binding is a PROJECT fact and one page carries several projects of one
 * tenant. A pass that resolved it per tenant would clone another project's tree
 * and `cwd` the model into it.
 */
test("two projects of one tenant in one page are each placed with their own repository", async () => {
  const calls: StoreCall[] = [];
  const asked: SessionPlacement[] = [];
  const inProject = (project: string): AgentSession => ({
    ...session,
    partition: { tenant: partition.tenant, project: asProjectId(project) },
  });
  await sessionSchedulerPass(
    service(
      calls,
      {
        awaiting: [inProject("chuggy"), inProject("payroll")],
        binding: "PerProject",
      },
      { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      (placement) => asked.push(placement),
    ),
    epoch,
  );
  assert.deepEqual(
    asked.map(({ repository }) => repository),
    [asRepositoryId("chuggy"), asRepositoryId("payroll")],
  );
  assert.deepEqual(
    calls.filter((call) => call.startsWith("binding ")),
    ["binding tenant/chuggy", "binding tenant/payroll"],
  );
});

/**
 * A binding the scheduler may not read raises once per pass. Read after
 * `openAttempt` it would strand an opened, unplaced attempt for a whole lease
 * window; read before, the pass costs nothing to fail.
 */
test("a binding that cannot be read is asked for before an attempt is opened", async () => {
  const calls: StoreCall[] = [];
  await assert.rejects(
    sessionSchedulerPass(
      service(
        calls,
        { awaiting: [session], binding: new Error("permission denied") },
        { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      ),
      epoch,
    ),
  );
  assert.ok(
    !calls.some((call) => call.startsWith("openAttempt ")),
    "a binding the pass could not read still cost an attempt",
  );
});

/**
 * An inquiry holds reads of the project alone, so a checkout it may not open is
 * a clone per question and a cost with no consequence. The project still binds
 * a repository in this case — that is what makes it the case that fails when
 * the placement carries the binding unconditionally.
 */
test("a session whose roster reads no tree is placed with no checkout, bound or not", async () => {
  const asked: SessionPlacement[] = [];
  await sessionSchedulerPass(
    service(
      [],
      {
        awaiting: [
          { ...session, kind: "Inquiry", capabilities: ["ProjectRead"] },
        ],
        binding: {
          partition,
          repository: asRepositoryId("chuggy"),
          recoveryEpoch: epoch,
        },
      },
      { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      (placement) => asked.push(placement),
    ),
    epoch,
  );
  assert.equal(asked.length, 1);
  assert.ok(
    !Object.hasOwn(asked[0] ?? {}, "repository"),
    "a roster that reads no tree was given one to clone",
  );
});

test("a session whose roster reads the tree is still placed with the binding", async () => {
  const asked: SessionPlacement[] = [];
  await sessionSchedulerPass(
    service(
      [],
      {
        awaiting: [
          { ...session, capabilities: ["RepositoryRead", "ProjectRead"] },
        ],
        binding: {
          partition,
          repository: asRepositoryId("chuggy"),
          recoveryEpoch: epoch,
        },
      },
      { placed: "Placed", placement: asPlacementId("chuggy-session-one") },
      (placement) => asked.push(placement),
    ),
    epoch,
  );
  assert.equal(asked[0]?.repository, asRepositoryId("chuggy"));
});
