/**
 * The task a session attempt's pod fetches, against a real PostgreSQL. Every
 * case reads the epoch that stands when it runs, because one case restores the
 * epoch away.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { sessionAttemptMint } from "../../src/adapters/crypto/sessionAttemptMint.ts";
import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import { kubernetesSessionPodRequest } from "../../src/adapters/kubernetes/sessionPod.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  apiRole,
  boundaryOwnerRole,
  poolPlaneRole,
  schedulerRole,
  sessionAttemptOpenFunction,
  sessionTaskReadFunction,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { sessionAttemptInvocationBytesMax } from "../../src/adapters/postgres/schema/migrations/019-session-invocation.ts";
import { postgresWorkerTasks } from "../../src/adapters/postgres/workerPlane.ts";
import { sessionTaskVariable } from "../../src/contract/workerEnvironment.ts";
import {
  asSessionAttemptId,
  asSessionBearerId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { asPlacementId } from "../../src/interpreter/schedulerIdentity.ts";
import {
  sessionSchedulerDefaults,
  type FencedSessionAttempt,
  type SessionAttemptOpened,
  type SessionPlacement,
  type SessionPolicy,
  type SessionTaskInvocation,
} from "../../src/interpreter/sessionScheduler.ts";
import {
  sessionSchedulerPlace,
  type SessionSchedulerService,
} from "../../src/interpreter/sessionSchedulerRun.ts";
import { taskEnvelopeBytesMax } from "../../src/interpreter/taskBriefing.ts";
import { sessionTaskInvocation } from "../../src/interpreter/workerTask.ts";
import { goldenConfig } from "../adapters/sessionPodDocumentFixture.ts";
import {
  inertSessionPlane,
  inertWorkerPlane,
  taskFetched,
} from "../adapters/workerPlaneFixtures.ts";
import { postgresHarnessNewEpoch, postgresHarnessRolePool } from "./harness.ts";
import { fixtureBoundRepository } from "./repositoryBindingFixture.ts";
import {
  sessionRigBearer,
  sessionRigBoundless,
  sessionRigInvocation,
  sessionRigLeaseSecs,
  sessionRigOpen,
  sessionRigProject,
  sessionRigSession,
  sessionRigTurn,
} from "./sessionHarness.ts";

const rig = await sessionRigOpen();
const planePool = postgresHarnessRolePool(workerPlaneRole);
const schedulerPool = postgresHarnessRolePool(schedulerRole);
const ownerPool = postgresHarnessRolePool(boundaryOwnerRole);

after(async () => {
  await Promise.all([planePool.end(), schedulerPool.end(), ownerPool.end()]);
  await rig.close();
});

const tasks = postgresWorkerTasks(planePool);

const plane = createWorkerPlaneApp({
  ...inertWorkerPlane(1),
  tasks,
  sessions: inertSessionPlane(rig.plane),
});

after(() => plane.close());

/** The runtime session a first attempt binds, which a resumed one carries. */
const reference = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";

const policy: SessionPolicy = {
  profile: { profile: "standard", runtimeVersion: "1" },
  image: "registry.invalid/worker:1",
  grant: {
    tools: ["editor"],
    credentials: ["claude-code"],
    network: true,
    filesystem: "WriteWorkspace",
    mayCompleteTask: false,
  },
  mirrors: {},
};

/** Ceilings no case reaches, and the shortest backoff a resumed case can wait out. */
const schedulerConfig = {
  ...sessionSchedulerDefaults,
  placementBackoffSecs: 1,
  attemptsPerAccountMax: sessionRigBoundless,
  clusterAttemptsMax: sessionRigBoundless,
};

/** How many passes a case runs for its own session before it gives up, and how far apart. */
const passesMax = 40;
const passIntervalMs = 100;

/** The session scheduler over the real store and binding read, placing through a fake that keeps what it was asked. */
function scheduling(captured: SessionPlacement[]): SessionSchedulerService {
  return {
    store: rig.scheduler,
    bindings: postgresProjectRepositoryBinding(schedulerPool),
    placement: {
      place: (placement) => {
        captured.push(placement);
        return Promise.resolve({
          placed: "Placed",
          placement: asPlacementId(`placement-${placement.attempt}`),
        });
      },
      cancel: () => Promise.resolve({ cancelled: "Accepted" }),
      observe: () => Promise.resolve({ observed: "Unended" }),
    },
    bearers: sessionAttemptMint(),
    policy,
    config: schedulerConfig,
  };
}

/** Runs placement passes under the epoch that stands until this session is placed, and hands back what it was placed with. */
async function placed(session: SessionId): Promise<SessionPlacement> {
  const epoch = await rig.harness.store.currentRecoveryEpoch();
  const captured: SessionPlacement[] = [];
  const service = scheduling(captured);
  for (let pass = 0; pass < passesMax; pass += 1) {
    await sessionSchedulerPlace(service, epoch);
    const [placement, ...more] = captured.filter(
      (asked) => asked.session === session,
    );
    if (placement !== undefined) {
      assert.deepEqual(more, []);
      return placement;
    }
    await delay(passIntervalMs);
  }
  throw new Error(`session task suite: ${session} was never placed`);
}

/** A session of a project of its own with one turn queued, the project bound to a repository or not. */
async function queuedSession(
  label: string,
  bound: boolean,
): Promise<{ partition: Partition; session: SessionId }> {
  const partition = await sessionRigProject(rig, label);
  if (bound)
    await fixtureBoundRepository(
      rig.harness,
      rig.harness.pool,
      partition,
      label,
    );
  const session = await sessionRigSession(rig, partition, label);
  await sessionRigTurn(rig, partition, session, label);
  return { partition, session };
}

/** What the opening recorded for one attempt, read as the owner. */
async function storedInvocation(
  attempt: FencedSessionAttempt,
): Promise<unknown> {
  const rows = (await rig.harness.query(
    "SELECT invocation FROM session_attempt WHERE attempt=$1",
    [attempt.attempt],
  )) as readonly { invocation: unknown }[];
  assert.equal(rows.length, 1);
  return rows[0]?.invocation;
}

/** The task a bearer is answered with, as the pod reads it. */
const fetchedTask = (bearer: string) => taskFetched(plane, bearer);

/** What the fetch leaves out of the pod's document, all of it the site's. */
const siteFields = ["workerPlane", "api", "bounds"];

/** The task a placement's pod is launched with, read back off the pod itself, less what its site adds. */
function pushedTask(
  placement: SessionPlacement,
): Readonly<Record<string, unknown>> {
  const requested = kubernetesSessionPodRequest(goldenConfig, placement);
  if (requested.requested !== "Pod")
    throw new Error(`session task suite: the pod was ${requested.requested}`);
  const carried = requested.pod.spec.containers
    .flatMap((container) => container.env)
    .find((variable) => variable.name === sessionTaskVariable);
  assert.ok(carried !== undefined && "value" in carried);
  return Object.fromEntries(
    Object.entries(JSON.parse(carried.value) as object).filter(
      ([key]) => !siteFields.includes(key),
    ),
  );
}

const stopped = { status: 401, body: { action: "stop" } };

test("a session fetches the task its pod is launched with, less what its site adds, whether its project binds a repository or not", async () => {
  for (const bound of [false, true]) {
    const { session } = await queuedSession(
      `task-fresh-${String(bound)}`,
      bound,
    );
    const placement = await placed(session);
    assert.equal(placement.repository !== undefined, bound);
    assert.equal(placement.agentReference, undefined);
    const pushed = pushedTask(placement);
    assert.equal("repository" in pushed, bound);
    assert.deepEqual(await fetchedTask(placement.bearer.secret), {
      status: 200,
      body: pushed,
    });
    assert.deepEqual(
      await storedInvocation(placement),
      sessionTaskInvocation(placement),
    );
  }
});

test("an attempt's own writes after opening leave its invocation as recorded, and the session they resume fetches the runtime session they bound", async () => {
  const { partition, session } = await queuedSession("task-resumed", true);
  const first = await placed(session);
  const recorded = await storedInvocation(first);
  const held = { secret: first.bearer.secret, generation: first.generation };
  assert.equal(
    await rig.plane.heartbeat(
      held.secret,
      held.generation,
      sessionRigLeaseSecs,
    ),
    true,
  );
  const claimed = await rig.plane.claim(held);
  assert.ok(claimed !== undefined);
  assert.equal(await rig.plane.bind({ ...held, reference }), "Bound");
  assert.equal(
    await rig.plane.answer({ ...held, turn: claimed.turn, result: "ok" }),
    "Answered",
  );
  assert.equal(await rig.scheduler.attemptEnded(first, "SessionIdle"), true);
  assert.equal(await rig.scheduler.attemptCleanupCompleted(first), true);
  assert.deepEqual(await storedInvocation(first), recorded);

  await sessionRigTurn(rig, partition, session, "task-resumed-again");
  const second = await placed(session);
  assert.notEqual(second.attempt, first.attempt);
  const pushed = pushedTask(second);
  assert.equal(pushed["agentReference"], reference);
  assert.deepEqual(await fetchedTask(second.bearer.secret), {
    status: 200,
    body: pushed,
  });
  assert.deepEqual(await fetchedTask(first.bearer.secret), stopped);
});

test("an ended attempt's bearer is answered as stopped, though the read still finds its task", async () => {
  const { session } = await queuedSession("task-ended", false);
  const placement = await placed(session);
  assert.equal((await tasks.session(placement.bearer.secret))?.live, true);
  assert.equal(
    await rig.scheduler.attemptEnded(placement, "SessionIdle"),
    true,
  );
  const read = await tasks.session(placement.bearer.secret);
  assert.equal(read?.live, false);
  assert.notEqual(read.invocation, undefined);
  assert.deepEqual(await fetchedTask(placement.bearer.secret), stopped);
});

test("a closed session's attempt is answered as stopped while the attempt itself still runs", async () => {
  const { partition, session } = await queuedSession("task-closed", false);
  const placement = await placed(session);
  assert.equal((await tasks.session(placement.bearer.secret))?.live, true);
  assert.equal(await rig.sessions.close(partition, session), true);
  assert.deepEqual(
    await rig.harness.query(
      "SELECT state FROM session_attempt WHERE attempt=$1",
      [placement.attempt],
    ),
    [{ state: "Running" }],
  );
  assert.equal((await tasks.session(placement.bearer.secret))?.live, false);
  assert.deepEqual(await fetchedTask(placement.bearer.secret), stopped);
});

test("an attempt issued under an epoch since restored away is answered as stopped", async () => {
  const { session } = await queuedSession("task-epoch", false);
  const placement = await placed(session);
  assert.equal((await fetchedTask(placement.bearer.secret)).status, 200);
  await rig.harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  assert.equal((await tasks.session(placement.bearer.secret))?.live, false);
  assert.deepEqual(await fetchedTask(placement.bearer.secret), stopped);
});

test("an attempt opened before invocations were recorded is answered as not recorded", async () => {
  const { session } = await queuedSession("task-unrecorded", false);
  const placement = await placed(session);
  await rig.harness.query(
    "UPDATE session_attempt SET invocation=NULL WHERE attempt=$1",
    [placement.attempt],
  );
  const read = await tasks.session(placement.bearer.secret);
  assert.equal(read?.live, true);
  assert.equal(read.invocation, undefined);
  assert.deepEqual(await fetchedTask(placement.bearer.secret), {
    status: 409,
    body: { action: "stop", reason: "TaskNotRecorded" },
  });
});

/** Opens a session's next attempt under the epoch that stands, carrying whatever the case offers as its invocation. */
async function openedWith(
  partition: Partition,
  session: SessionId,
  invocation: unknown,
): Promise<SessionAttemptOpened> {
  return rig.scheduler.openAttempt({
    partition,
    session,
    epoch: await rig.harness.store.currentRecoveryEpoch(),
    attempt: asSessionAttemptId(`attempt-offered-${randomUUID()}`),
    bearer: asSessionBearerId(`bearer-offered-${randomUUID()}`),
    bearerSecretDigest: sessionRigBearer().digest,
    leaseSecs: sessionRigLeaseSecs,
    placementBackoffSecs: 1,
    attemptsPerAccountMax: sessionRigBoundless,
    clusterAttemptsMax: sessionRigBoundless,
    invocation: invocation as SessionTaskInvocation,
  });
}

test("an attempt opens only with an invocation, and with none past the carrier a pod's task travels in", async () => {
  assert.equal(sessionAttemptInvocationBytesMax, taskEnvelopeBytesMax);
  const { partition, session } = await queuedSession("task-refused", false);
  for (const offered of [undefined, null, "invocation", []])
    await assert.rejects(
      openedWith(partition, session, offered),
      /opened without an invocation/u,
      JSON.stringify(offered),
    );
  await assert.rejects(
    openedWith(partition, session, {
      ...sessionRigInvocation,
      agentReference: "x".repeat(sessionAttemptInvocationBytesMax),
    }),
    /session_attempt_invocation_is_bounded/u,
  );
  const attempts = () =>
    rig.harness.query("SELECT attempt FROM session_attempt WHERE session=$1", [
      session,
    ]);
  assert.deepEqual(await attempts(), []);
  assert.equal(
    (await openedWith(partition, session, sessionRigInvocation)).opened,
    "Opened",
  );
  assert.equal((await attempts()).length, 1);
});

test("of every chuggy role and PUBLIC, only the opening's owner writes an invocation and only the worker plane's read reads one", async () => {
  const roles = [
    "public",
    ...(
      (await rig.harness.query(
        "SELECT rolname FROM pg_roles WHERE rolname LIKE 'chuggy\\_%' ORDER BY rolname",
      )) as readonly { rolname: string }[]
    ).map((row) => row.rolname),
  ];
  for (const named of [
    apiRole,
    boundaryOwnerRole,
    poolPlaneRole,
    schedulerRole,
    workerPlaneRole,
  ])
    assert.ok(roles.includes(named), named);
  const opening = `public.${sessionAttemptOpenFunction}(text,text,text,text,text,text,text,bigint,bigint,bigint,bigint,jsonb)`;
  const reading = `public.${sessionTaskReadFunction}(text)`;
  for (const role of roles)
    assert.deepEqual(
      await rig.harness.query(
        `SELECT has_column_privilege($1,'public.session_attempt','invocation','SELECT') AS selects,
                has_column_privilege($1,'public.session_attempt','invocation','INSERT') AS inserts,
                has_column_privilege($1,'public.session_attempt','invocation','UPDATE') AS updates,
                has_function_privilege($1,$2::regprocedure,'EXECUTE') AS opens,
                has_function_privilege($1,$3::regprocedure,'EXECUTE') AS reads`,
        [role, opening, reading],
      ),
      [
        {
          selects: role === boundaryOwnerRole,
          inserts: role === boundaryOwnerRole,
          updates: false,
          opens: role === boundaryOwnerRole || role === schedulerRole,
          reads: role === boundaryOwnerRole || role === workerPlaneRole,
        },
      ],
      role,
    );
  await assert.rejects(
    ownerPool.query("UPDATE session_attempt SET invocation=invocation"),
    /permission denied/u,
  );
  for (const pool of [planePool, schedulerPool]) {
    await assert.rejects(
      pool.query("SELECT invocation FROM session_attempt LIMIT 1"),
      /permission denied/u,
    );
    await assert.rejects(
      pool.query("UPDATE session_attempt SET invocation=NULL"),
      /permission denied/u,
    );
  }
  await planePool.query(`SELECT live FROM ${sessionTaskReadFunction}('')`);
  await assert.rejects(
    schedulerPool.query(`SELECT live FROM ${sessionTaskReadFunction}('')`),
    /permission denied/u,
  );
});
