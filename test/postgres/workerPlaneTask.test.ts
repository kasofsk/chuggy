/**
 * The task a job attempt's worker fetches, driven against a real PostgreSQL:
 * the scheduler records what it places, the plane answers with it under the
 * worker plane's own role, and no other role reads it.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { reportTaskTerminalCommand } from "../../src/actor/command.ts";
import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import { kubernetesWorkerTask } from "../../src/adapters/kubernetes/workerPod.ts";
import {
  postgresPriorEvaluationReports,
  postgresPriorWorkReports,
} from "../../src/adapters/postgres/evaluationReports.ts";
import { postgresPinnedConfigurations } from "../../src/adapters/postgres/pinnedConfigurations.ts";
import {
  apiRole,
  poolPlaneRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import { attemptInvocationBytesMax } from "../../src/adapters/postgres/schema/migrations/018-attempt-invocation.ts";
import { postgresTicketBrief } from "../../src/adapters/postgres/ticketBrief.ts";
import {
  postgresWorkerPlaneAuthority,
  postgresWorkerReportStore,
  postgresWorkerTasks,
} from "../../src/adapters/postgres/workerPlane.ts";
import {
  postgresWorkerPoolAssignments,
  postgresWorkerPoolRegistry,
  postgresWorkerPoolRoster,
} from "../../src/adapters/postgres/workerPool.ts";
import type { ConfigurationOverrides } from "../../src/contract/configurationOverrides.ts";
import type { WorkTaskDocument } from "../../src/contract/workerTask.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import {
  asCanonicalConfiguration,
  type CanonicalConfiguration,
} from "../../src/interpreter/authoring.ts";
import {
  asPlacementId,
  executionSchedulerDefaults,
  silentSchedulerTelemetry,
  type AttemptPlacement,
  type AttemptPlacementOutcome,
  type ExecutionId,
  type FencedAttempt,
  type PhysicalAttempt,
  type WorkTaskInvocation,
} from "../../src/interpreter/executionScheduler.ts";
import {
  executionSchedulerLaunch,
  type ExecutionSchedulerService,
} from "../../src/interpreter/executionSchedulerRun.ts";
import { finalizerDefaults } from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  blessedPracticeCatalog,
  taskEnvelopeBytesMax,
  taskInvocationBytesMax,
} from "../../src/interpreter/taskBriefing.ts";
import { ticketServiceDefaults } from "../../src/interpreter/ticketService.ts";
import type { WorkerPoolIdentity } from "../../src/interpreter/workerPool.ts";
import {
  inertWorkerPlane,
  taskFetched,
} from "../adapters/workerPlaneFixtures.ts";
import { goldenConfig } from "../adapters/workerPodDocumentFixture.ts";
import type { ProjectCommand } from "../../src/interpreter/projectCommand.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessCompletion,
  postgresHarnessConfiguration,
  postgresHarnessDrain,
  postgresHarnessNewEpoch,
  postgresHarnessReport,
  postgresHarnessRolePool,
  postgresHarnessSubmission,
  type PostgresHarnessDrained,
} from "./harness.ts";
import { memoryProjectAccess } from "./projectAccessMemory.ts";
import {
  schedulerClaimFor,
  schedulerEvaluationRequest,
  schedulerInvocation,
  schedulerOwner,
  schedulerProject,
  schedulerReport,
  schedulerRigOpen,
  schedulerInCluster,
  schedulerRouting,
  type SchedulerProject,
} from "./schedulerHarness.ts";

const rig = await schedulerRigOpen();
const planePool = postgresHarnessRolePool(workerPlaneRole);
const poolPlanePool = postgresHarnessRolePool(poolPlaneRole);
const apiPool = postgresHarnessRolePool(apiRole);

after(async () => {
  await Promise.all([planePool.end(), poolPlanePool.end(), apiPool.end()]);
  await rig.close();
});

/** How long an attempt's lease runs for, past the duration of any case here. */
const leaseSecs = 300;

const plane = createWorkerPlaneApp({
  ...inertWorkerPlane(1),
  authority: postgresWorkerPlaneAuthority(planePool),
  tasks: postgresWorkerTasks(planePool),
});

after(() => plane.close());

/** The same document with its keys ascending at every depth, which is the form a release pins. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** The harness configuration with a worker configured, so a task carries every field one can. */
function workerConfiguration(
  further: Readonly<Record<string, unknown>> = {},
): CanonicalConfiguration {
  return asCanonicalConfiguration(
    canonical({
      ...(JSON.parse(String(postgresHarnessConfiguration)) as object),
      ...further,
      worker: {
        setup: ["npm ci"],
        files: [{ path: "notes.md", content: "Read the notes." }],
        mode: { type: "SingleAgent", agent: "Claude", arguments: ["--quiet"] },
      },
      executionRequirements: {
        platformDefault: {
          mode: "ContainerCapability",
          operatingSystem: "Linux",
          architecture: "Amd64",
          capabilities: ["Agent:Claude"],
        },
        platformDefaultVersion: 1,
      },
    }),
  );
}

/** A project whose one spawned task is admitted, which leaves one execution to launch. */
async function admittedProject(
  label: string,
  configuration: CanonicalConfiguration = workerConfiguration(),
  spawned: (project: SchedulerProject) => Promise<string> = (project) =>
    Promise.resolve(project.request),
  overrides?: ConfigurationOverrides,
): Promise<{ project: SchedulerProject; execution: ExecutionId }> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks: 1 },
    configuration,
    undefined,
    overrides,
  );
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      await spawned(project),
      schedulerOwner(label),
    ),
    200,
    schedulerInCluster,
  );
  const admitted = await rig.store.admit(project.cluster);
  if (admitted.admitted !== "Admitted")
    throw new Error(`worker task suite: ${label} admitted no execution`);
  return { project, execution: admitted.execution };
}

/** One opened attempt of a fresh project, placed nowhere and invoked with nothing. */
async function openedAttempt(label: string): Promise<PhysicalAttempt> {
  const { project, execution } = await admittedProject(label);
  const opened = await rig.store.openAttempt({
    partition: project.partition,
    execution,
    epoch: project.epoch,
    leaseSecs,
    retriesMax: 3,
    placementBackoffSecs: 1,
  });
  if (opened.opened !== "Opened")
    throw new Error(`worker task suite: ${label} opened no attempt`);
  return opened.attempt;
}

/** What the scheduler recorded for one attempt, read as the owner. */
async function storedInvocation(attempt: FencedAttempt): Promise<unknown> {
  const rows = (await rig.harness.query(
    `SELECT invocation FROM execution_attempt
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [attempt.partition.tenant, attempt.partition.project, attempt.attempt],
  )) as readonly { invocation: unknown }[];
  assert.equal(rows.length, 1);
  return rows[0]?.invocation;
}

/** The task a bearer is answered with, as the pod reads it. */
const fetchedTask = (bearer: string) => taskFetched(plane, bearer);

/** The pod document a placement is launched with, less the plane, as the fetch answers it. */
function pushedTask(placement: AttemptPlacement): unknown {
  const document: WorkTaskDocument = kubernetesWorkerTask(
    goldenConfig,
    placement,
  );
  return {
    kind: "Work",
    ...Object.fromEntries(
      Object.entries(document).filter(([key]) => key !== "workerPlane"),
    ),
  };
}

const placedOk: AttemptPlacementOutcome = {
  placed: "Placed",
  placement: asPlacementId("placement-task"),
};

/** A scheduler over the real store and read ports, placing through `place`. */
function launching(
  place: (placement: AttemptPlacement) => Promise<AttemptPlacementOutcome>,
): ExecutionSchedulerService {
  return {
    store: rig.store,
    placement: {
      place,
      cancel: () => Promise.resolve({ cancelled: "Accepted" }),
    },
    workerPools: postgresWorkerPoolRoster(rig.pool),
    access: memoryProjectAccess(),
    policy: {
      routing: schedulerRouting(),
      profileFor: () =>
        Promise.resolve({
          resolved: "Profile",
          profile: { profile: "standard", runtimeVersion: "1" },
          grant: {
            tools: ["editor"],
            credentials: ["forge"],
            network: true,
            filesystem: "WriteWorkspace",
            mayCompleteTask: true,
          },
        }),
    },
    configurations: postgresPinnedConfigurations(rig.pool),
    runtimeFacts: {
      facts: () =>
        Promise.resolve({
          read: "Facts",
          facts: { changedFiles: [], handoff: [] },
        }),
    },
    priorWorkReports: postgresPriorWorkReports(rig.pool),
    priorEvaluationReports: postgresPriorEvaluationReports(rig.pool),
    ticketBriefs: postgresTicketBrief(rig.pool),
    practices: blessedPracticeCatalog,
    config: executionSchedulerDefaults,
    ticketService: ticketServiceDefaults,
    finalizer: finalizerDefaults,
    metrics: silentSchedulerTelemetry,
  };
}

/** Launches whatever is waiting and hands back the placement this project's attempt was given. */
async function launched(
  project: SchedulerProject,
  during: (placement: AttemptPlacement) => Promise<void> = () =>
    Promise.resolve(),
): Promise<AttemptPlacement> {
  const placements: AttemptPlacement[] = [];
  await executionSchedulerLaunch(
    launching(async (placement) => {
      if (placement.partition.project === project.partition.project) {
        placements.push(placement);
        await during(placement);
      }
      return placedOk;
    }),
    project.epoch,
  );
  const [placement] = placements;
  assert.ok(placement !== undefined);
  assert.equal(placements.length, 1);
  return placement;
}

test("a worker fetches the task its pod is launched with, less the plane", async () => {
  const { project } = await admittedProject("task-fetched");
  const placement = await launched(project);
  const pushed = pushedTask(placement);
  const fetched = await fetchedTask(placement.capability.secret);
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.body, pushed);
  const document = kubernetesWorkerTask(goldenConfig, placement);
  assert.ok(document.worker !== undefined);
  assert.deepEqual(await storedInvocation(placement), {
    profile: document.profile,
    briefing: document.briefing,
    authority: document.authority,
    worker: document.worker,
  });
});

test("an attempt of a ticket overriding the worker's mode records that mode and the configuration's everything else", async () => {
  const mode = {
    type: "SingleAgent" as const,
    agent: "Claude" as const,
    arguments: ["--verbose"],
  };
  const { project } = await admittedProject(
    "task-overridden",
    workerConfiguration(),
    undefined,
    { worker: { mode } },
  );
  const placement = await launched(project);
  const plain = await admittedProject("task-not-overridden");
  const unchanged = await launched(plain.project);
  const recorded = (await storedInvocation(placement)) as {
    readonly worker: unknown;
    readonly briefing: unknown;
  };
  const configured = (await storedInvocation(unchanged)) as {
    readonly worker: Readonly<Record<string, unknown>>;
    readonly briefing: unknown;
  };
  assert.deepEqual(recorded.worker, { ...configured.worker, mode });
  assert.notDeepEqual(recorded.worker, configured.worker);
  assert.deepEqual(recorded.briefing, configured.briefing);
});

/** Accepts one command into a project and drains what its queue then holds. */
async function decidedIn(
  project: SchedulerProject,
  memory: ProjectMemory,
  command: ProjectCommand,
): Promise<PostgresHarnessDrained> {
  const accepted = await rig.harness.inbox.accept({
    ...postgresHarnessSubmission(project.partition, "parked"),
    command,
  });
  assert.equal(accepted.accepted, "Accepted");
  return postgresHarnessDrain(rig.harness, project.partition, memory);
}

/** One column of a project's rows, as the owner reads them. */
async function ownerRead(
  query: string,
  project: SchedulerProject,
): Promise<readonly Record<string, unknown>[]> {
  return rig.harness.query(query, [
    project.partition.tenant,
    project.partition.project,
  ]);
}

/** The project's one ticket parked at its first work's failure, and the escalation an answer names. */
async function parkedAtWorkFailure(project: SchedulerProject): Promise<{
  readonly drained: PostgresHarnessDrained;
  readonly action: string;
  readonly authorizingSeq: number;
}> {
  await postgresHarnessCompletion(
    rig.harness,
    project.partition,
    `operation-parked-${randomUUID()}`,
    reportTaskTerminalCommand(
      postgresHarnessReport(
        project.memory.graph,
        workTaskIdentity(1, 1),
        "Fail",
      ),
    ),
  );
  const drained = await postgresHarnessDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  const [open] = await ownerRead(
    `SELECT action,authorizing_seq::text AS seq FROM native_action
      WHERE tenant=$1 AND project=$2 AND state='Open' AND escalation='WorkFailureEscalated'`,
    project,
  );
  assert.ok(open !== undefined);
  return {
    drained,
    action: String(open["action"]),
    authorizingSeq: Number(open["seq"]),
  };
}

/** Registers, admits and launches the newest work a resume asked for, and answers its recorded invocation. */
async function resumedInvocation(
  project: SchedulerProject,
  label: string,
): Promise<{ readonly worker: Readonly<Record<string, unknown>> }> {
  const [newest] = await ownerRead(
    `SELECT request FROM execution_request
      WHERE tenant=$1 AND project=$2 AND kind='SpawnWork'
      ORDER BY authorizing_seq DESC LIMIT 1`,
    project,
  );
  assert.ok(newest !== undefined);
  await rig.store.registerSpawn(
    await schedulerClaimFor(
      rig,
      project.partition,
      String(newest["request"]),
      schedulerOwner(label),
    ),
    200,
    schedulerInCluster,
  );
  const admitted = await rig.store.admit(project.cluster);
  assert.equal(admitted.admitted, "Admitted");
  return (await storedInvocation(await launched(project))) as {
    readonly worker: Readonly<Record<string, unknown>>;
  };
}

/** What a step of a parked ticket's life left of its definition and journal. */
async function ticketRecord(project: SchedulerProject): Promise<{
  readonly definition: unknown;
  readonly journal: readonly string[];
}> {
  return {
    definition: await ownerRead(
      "SELECT definition,digest FROM ticket_definition WHERE tenant=$1 AND project=$2",
      project,
    ),
    journal: (
      await ownerRead(
        "SELECT entry FROM journal_entry WHERE tenant=$1 AND project=$2 ORDER BY seq",
        project,
      )
    ).map((row) => String(row["entry"])),
  };
}

/**
 * A ticket whose first work failed, parked at the work wall, and resumed —
 * after `changed` replaced its overrides, where a case asks for that — with
 * the attempt the resume asked for launched. Answers that attempt's recorded
 * invocation, the definition and journal each step left, and the overrides
 * the ticket then holds.
 */
async function resumedAfter(
  label: string,
  changed:
    ((action: string, authorizingSeq: number) => ProjectCommand) | undefined,
): Promise<{
  readonly invocation: { readonly worker: Readonly<Record<string, unknown>> };
  readonly records: readonly Awaited<ReturnType<typeof ticketRecord>>[];
  readonly overrides: unknown;
}> {
  const project = await schedulerProject(
    rig,
    label,
    { tasks: 1 },
    workerConfiguration(),
  );
  const parked = await parkedAtWorkFailure(project);
  let drained = parked.drained;
  const records = [await ticketRecord(project)];
  if (changed !== undefined) {
    drained = await decidedIn(
      project,
      drained.memory,
      changed(parked.action, parked.authorizingSeq),
    );
    assert.deepEqual(drained.decided, ["Answered"]);
    records.push(await ticketRecord(project));
  }
  drained = await decidedIn(project, drained.memory, {
    version: 1,
    command: "ResolveNativeAction",
    action: parked.action,
    authorizingSeq: parked.authorizingSeq,
    resolution: "Resume",
  });
  assert.deepEqual(drained.decided, ["Committed"]);
  records.push(await ticketRecord(project));
  const [held] = await ownerRead(
    "SELECT overrides FROM ticket_definition WHERE tenant=$1 AND project=$2",
    project,
  );
  return {
    invocation: await resumedInvocation(project, label),
    records,
    overrides: held?.["overrides"],
  };
}

test("a ticket parked at a work failure resumes under the model its overrides were changed to, and its definition and journal are as a resume leaves them", async () => {
  const mode = {
    type: "SingleAgent" as const,
    agent: "Claude" as const,
    arguments: ["--quiet", "--model=another-model"],
  };
  const changed = await resumedAfter("parked-changed", (action, seq) => ({
    version: 1,
    command: "ChangeTicketOverrides",
    ticket: asTicketId(1),
    action,
    authorizingSeq: seq,
    overrides: { worker: { mode } },
  }));
  assert.deepEqual(changed.invocation.worker["mode"], mode);
  assert.deepEqual(changed.overrides, { worker: { mode } });
  const [parked, overridden, resumed] = changed.records;
  assert.deepEqual(overridden?.definition, parked?.definition);
  assert.deepEqual(resumed?.definition, parked?.definition);
  const [before, after, last] = changed.records.map((record) => record.journal);
  assert.deepEqual(after, before);
  assert.deepEqual(last?.slice(0, -1), before);
  assert.equal(last?.length, (before?.length ?? 0) + 1);
  assert.match(last?.at(-1) ?? "", /"TicketWorkResumed"/);
});

test("a ticket resumed with no change of its overrides resumes under its configuration's mode", async () => {
  const plain = await resumedAfter("parked-unchanged", undefined);
  assert.deepEqual(plain.invocation.worker["mode"], {
    type: "SingleAgent",
    agent: "Claude",
    arguments: ["--quiet"],
  });
  assert.equal(plain.overrides, null);
  const [parked, resumed] = plain.records.map((record) => record.journal);
  assert.equal(resumed?.length, (parked?.length ?? 0) + 1);
});

test("an evaluator fetches the task its pod is launched with, its kind and stage included", async () => {
  const { project } = await admittedProject(
    "task-evaluation",
    workerConfiguration({
      evaluations: [{ instructions: ["Review it."], practices: [] }],
    }),
    (spawning) =>
      schedulerEvaluationRequest(rig, spawning, "task-evaluation", {
        cycle: 1,
        stage: 1,
        generation: 1,
        evaluator: 1,
      }),
  );
  const placement = await launched(project);
  assert.equal(placement.taskKind, "Evaluation");
  assert.equal(placement.stage, 0);
  assert.deepEqual(await fetchedTask(placement.capability.secret), {
    status: 200,
    body: pushedTask(placement),
  });
});

test("a reported attempt's bearer is answered as stopped, though the read still finds its task", async () => {
  const { project } = await admittedProject("task-reported");
  const placement = await launched(project);
  const secret = placement.capability.secret;
  assert.equal(
    (
      await postgresWorkerReportStore(planePool, secret).terminalize(
        schedulerReport(placement, "Pass"),
      )
    ).terminalized,
    "Terminalized",
  );
  const read = await postgresWorkerTasks(planePool).work(secret);
  assert.ok(read !== undefined);
  assert.equal(read.live, false);
  assert.notEqual(read.invocation, undefined);
  assert.deepEqual(await fetchedTask(secret), {
    status: 401,
    body: { action: "stop" },
  });
});

test("a pool's bearer fetches the task the scheduler recorded, and the bearer it replaced fetches nothing", async () => {
  const { project } = await admittedProject("task-pool");
  const principal = asPrincipal(`https://issuer.invalid#pool-${randomUUID()}`);
  assert.equal(
    await postgresWorkerPoolRegistry(apiPool).register({
      partition: project.partition,
      pool: "task-pool",
      capabilities: ["Platform:Linux:Amd64", "Agent:Claude"],
      class: "Dedicated",
      clientId: `chuggy-pool-${randomUUID()}`,
      principal,
    }),
    true,
  );
  const identity = (await postgresWorkerPoolRegistry(apiPool).identify(
    principal,
  )) as WorkerPoolIdentity;
  const bearer = `bearer-${randomUUID()}`;
  const answers: { status: number; body: unknown }[] = [];
  const placement = await launched(project, async (placing) => {
    await rig.harness.query(
      `UPDATE execution SET placement='Pool'
        WHERE tenant=$1 AND project=$2 AND execution=$3`,
      [placing.partition.tenant, placing.partition.project, placing.execution],
    );
    assert.notEqual(
      await postgresWorkerPoolAssignments(poolPlanePool).claim(
        identity,
        { leaseSecs, heldMax: 1 },
        `assignment-${randomUUID()}`,
        bearer,
      ),
      undefined,
    );
    answers.push(await fetchedTask(bearer));
    answers.push(await fetchedTask(placing.capability.secret));
  });
  assert.deepEqual(answers, [
    { status: 200, body: pushedTask(placement) },
    { status: 401, body: { action: "stop" } },
  ]);
});

test("an attempt with no invocation recorded is answered as not recorded", async () => {
  const attempt = await openedAttempt("task-unrecorded");
  assert.deepEqual(await fetchedTask(attempt.capability.secret), {
    status: 409,
    body: { action: "stop", reason: "TaskNotRecorded" },
  });
});

test("an invocation is written once", async () => {
  const attempt = await openedAttempt("task-once");
  assert.equal(
    await rig.store.attemptInvoked(attempt, schedulerInvocation),
    true,
  );
  const second: WorkTaskInvocation = {
    ...schedulerInvocation,
    briefing: { ...schedulerInvocation.briefing, text: "Do other work." },
  };
  assert.equal(await rig.store.attemptInvoked(attempt, second), false);
  assert.deepEqual(await storedInvocation(attempt), schedulerInvocation);
});

test("an invocation offered under a stale generation writes nothing", async () => {
  const attempt = await openedAttempt("task-stale");
  await rig.harness.query(
    `UPDATE execution_attempt SET generation=generation+1
      WHERE tenant=$1 AND project=$2 AND attempt=$3`,
    [attempt.partition.tenant, attempt.partition.project, attempt.attempt],
  );
  assert.equal(
    await rig.store.attemptInvoked(attempt, schedulerInvocation),
    false,
  );
  assert.equal(await storedInvocation(attempt), null);
  assert.equal(
    await rig.store.attemptInvoked(
      { ...attempt, generation: attempt.generation + 1 },
      schedulerInvocation,
    ),
    true,
  );
});

test("an attempt already placed takes no invocation", async () => {
  const attempt = await openedAttempt("task-placed");
  assert.equal(
    await rig.store.attemptPlaced(attempt, asPlacementId("placement-placed")),
    true,
  );
  assert.equal(
    await rig.store.attemptInvoked(attempt, schedulerInvocation),
    false,
  );
  assert.equal(await storedInvocation(attempt), null);
});

/** An invocation whose briefing text brings its measured bytes to `bytes`. */
function invocationOf(bytes: number): WorkTaskInvocation {
  const { profile, ...measured } = {
    ...schedulerInvocation,
    briefing: { ...schedulerInvocation.briefing, text: "" },
  };
  const text = "x".repeat(bytes - JSON.stringify(measured).length);
  return {
    profile,
    ...measured,
    briefing: { ...measured.briefing, text },
  };
}

test("the column takes the longest invocation a briefing composes to, and refuses one past the carrier", async () => {
  assert.equal(attemptInvocationBytesMax, taskEnvelopeBytesMax);
  const longest = await openedAttempt("task-longest");
  assert.equal(
    await rig.store.attemptInvoked(
      longest,
      invocationOf(taskInvocationBytesMax),
    ),
    true,
  );
  const past = await openedAttempt("task-past");
  await assert.rejects(
    rig.store.attemptInvoked(past, invocationOf(attemptInvocationBytesMax)),
    /execution_attempt_invocation_is_bounded/u,
  );
  assert.equal(await storedInvocation(past), null);
});

test("the worker plane reads an invocation only through its function, and the pool plane only whether there is one", async () => {
  for (const [pool, column] of [
    [planePool, "invocation"],
    [planePool, "invoked"],
    [poolPlanePool, "invocation"],
    [apiPool, "invocation"],
    [apiPool, "invoked"],
  ] as const)
    await assert.rejects(
      pool.query(`SELECT ${column} FROM execution_attempt LIMIT 1`),
      /permission denied/u,
      column,
    );
  await poolPlanePool.query("SELECT invoked FROM execution_attempt LIMIT 1");
  await planePool.query("SELECT live FROM read_worker_task('')");
  for (const pool of [poolPlanePool, apiPool])
    await assert.rejects(
      pool.query("SELECT live FROM read_worker_task('')"),
      /permission denied/u,
    );
  for (const pool of [planePool, poolPlanePool, apiPool])
    await assert.rejects(
      pool.query("UPDATE execution_attempt SET invocation=NULL"),
      /permission denied/u,
    );
});

test("an attempt issued under an epoch since restored away is answered as stopped", async () => {
  const { project } = await admittedProject("task-epoch");
  const placement = await launched(project);
  const secret = placement.capability.secret;
  assert.equal((await fetchedTask(secret)).status, 200);
  await rig.harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  assert.deepEqual(await fetchedTask(secret), {
    status: 401,
    body: { action: "stop" },
  });
});
