/**
 * The scheduler command: what its environment parses into, what one bounded
 * pass does against its declared ports, and what a prerequisite it has not got
 * makes it say.
 *
 * IT IS DRIVEN AS A PROCESS BECAUSE NOTHING MAY IMPORT ONE. `src/roots/` is
 * the graph's executable roots and `.dependency-cruiser.cjs` forbids an import
 * of them from anywhere, so each case here runs the modules in a child process
 * of its own — the parsing against a record it is handed, and the command
 * itself against an environment and a signal.
 *
 * A COULD-NOT-RUN IS NOT A FAILURE AND MUST NOT READ AS ONE. A database that
 * is not there and a cluster namespace that does not answer each name the
 * precondition they did not meet, and the command exits saying which.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { postgresLimitsDefault } from "../../src/adapters/postgres/pool.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import { finalizerDefaults } from "../../src/interpreter/finalizer.ts";
import { ticketServiceDefaults } from "../../src/interpreter/ticketService.ts";

const execute = promisify(execFile);

const root = mkdtempSync(join(tmpdir(), "chuggy-scheduler-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

const tokenFile = join(root, "token");
writeFileSync(tokenFile, "cluster-token-value\n");

const images = [
  {
    profile: "standard",
    runtimeVersion: "1",
    image: "registry.invalid/worker:1",
  },
];

const resources = {
  cpuRequest: "500m",
  cpuLimit: "1",
  memoryRequest: "1Gi",
  memoryLimit: "2Gi",
};

const grant = {
  tools: ["editor"],
  credentials: [],
  network: false,
  filesystem: "WriteWorkspace",
  mayCompleteTask: false,
};

const policy = {
  Work: { profile: "standard", runtimeVersion: "1", grant },
};

/** A complete environment, so a case can make one variable at a time the subject. */
const environment: Readonly<Record<string, string>> = {
  CHUG_SCHEDULER_DATABASE_URL: "postgres://chuggy_scheduler@127.0.0.1:1/chuggy",
  CHUG_SCHEDULER_OWNER: "scheduler-one",
  CHUG_SCHEDULER_RECOVERY_EPOCH: "epoch-one",
  CHUG_SCHEDULER_CLUSTER_API_URL: "https://cluster.invalid:6443",
  CHUG_SCHEDULER_CLUSTER_NAMESPACE: "chuggy-workers",
  CHUG_SCHEDULER_CLUSTER_TOKEN_FILE: tokenFile,
  CHUG_SCHEDULER_WORKER_SERVICE_ACCOUNT: "chuggy-worker",
  CHUG_SCHEDULER_WORKER_IMAGES: JSON.stringify(images),
  CHUG_SCHEDULER_WORKER_RESOURCES: JSON.stringify(resources),
  CHUG_SCHEDULER_EXECUTION_POLICY: JSON.stringify(policy),
};

/** Every variable the command refuses to start without. */
const required: readonly string[] = Object.keys(environment);

/** Runs one module program in a child process, which is how a root is reached at all. */
async function schedulerProgram(source: string): Promise<string> {
  const result = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", source],
    { cwd: process.cwd() },
  );
  return result.stdout;
}

/** The parsed configuration, with the policy map written as the record JSON can carry. */
function parseProgram(named: Readonly<Record<string, string>>): string {
  return `
    const config = await import('./src/roots/schedulerConfig.ts');
    const environment = ${JSON.stringify(named)};
    try {
      const parsed = config.schedulerCommandConfig(environment);
      process.stdout.write(JSON.stringify({
        parsed: { ...parsed, policy: { profiles: Object.fromEntries(parsed.policy.profiles) } },
      }));
    } catch (failure) {
      process.stdout.write(JSON.stringify({ refused: failure.message }));
    }
  `;
}

test("a complete environment parses into the plain data the process root takes", async () => {
  const found: unknown = JSON.parse(
    await schedulerProgram(parseProgram(environment)),
  );
  assert.deepEqual(found, {
    parsed: {
      database: {
        url: environment["CHUG_SCHEDULER_DATABASE_URL"],
        limits: postgresLimitsDefault,
      },
      runtime: {
        idleIntervalMilliseconds: 1_000,
        shutdownDrainMilliseconds: 15_000,
      },
      identity: {
        owner: "scheduler-one",
        recoveryEpoch: "epoch-one",
        cluster: "default",
      },
      scheduler: executionSchedulerDefaults,
      ticketService: ticketServiceDefaults,
      finalizer: finalizerDefaults,
      workers: {
        podLabels: {},
        podAnnotations: {},
        nodeSelector: {},
        podSecurityContext: {},
        containerSecurityContext: {},
        apiBaseUrl: "https://cluster.invalid:6443",
        namespace: "chuggy-workers",
        tokenFile,
        serviceAccountName: "chuggy-worker",
        podNamePrefix: "chuggy-worker",
        imagesAdmitted: images,
        resources,
        activeDeadlineSecs: 3_600,
        requestTimeoutSecsMax: 30,
        unavailableRetryAfterSecs: 15,
      },
      policy: {
        profiles: {
          Work: {
            profile: { profile: "standard", runtimeVersion: "1" },
            grant,
          },
        },
      },
      configurations: [],
      runtimeFacts: {},
    },
  });
});

test("every prerequisite variable is refused by its own name", async () => {
  for (const name of required) {
    const named = Object.fromEntries(
      Object.entries(environment).filter(([each]) => each !== name),
    );
    const found = JSON.parse(await schedulerProgram(parseProgram(named))) as {
      readonly refused?: string;
    };
    assert.match(found.refused ?? "", new RegExp(name, "u"), name);
  }
});

test("a bound no configuration publishes is refused rather than ignored", async () => {
  const found = JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_PASS_BOUNDS: JSON.stringify({ admissionsPerPass: 4 }),
      }),
    ),
  ) as { readonly refused?: string };
  assert.match(found.refused ?? "", /admissionsPerPass/u);
});

test("a stated bound is taken and the rest stay the published defaults", async () => {
  const found = JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_PASS_BOUNDS: JSON.stringify({ admissionsPerPassMax: 4 }),
        CHUG_SCHEDULER_IDLE_INTERVAL_MS: "50",
      }),
    ),
  ) as { readonly parsed: { readonly scheduler: Record<string, number> } };
  assert.deepEqual(found.parsed.scheduler, {
    ...executionSchedulerDefaults,
    admissionsPerPassMax: 4,
  });
});

/** The cluster a case answers for, and the durable rows one pass is given to move. */
function processFakes(reachable: boolean): string {
  return `
    const cluster = {
      apiBaseUrl: 'https://cluster.invalid:6443',
      namespace: 'chuggy-workers',
      tokenFile: ${JSON.stringify(tokenFile)},
      serviceAccountName: 'chuggy-worker',
      podNamePrefix: 'chuggy-worker',
      imagesAdmitted: ${JSON.stringify(images)},
      resources: ${JSON.stringify(resources)},
      podLabels: {}, podAnnotations: {}, nodeSelector: {},
      podSecurityContext: {}, containerSecurityContext: {},
      activeDeadlineSecs: 3600,
      requestTimeoutSecsMax: 5,
      unavailableRetryAfterSecs: 15,
    };
    const asked = [];
    const fetcher = (input, init) => {
      asked.push(((init && init.method) || 'GET') + ' ' + String(input));
      if (!${String(reachable)}) return Promise.reject(new Error('connection refused'));
      return Promise.resolve(new Response(null, { status: init && init.method === 'POST' ? 201 : 200 }));
    };

    const partition = { tenant: 'tenant', project: 'project' };
    const execution = {
      partition, execution: 'execution-one', ticket: 1, task: 1, taskKind: 'Work',
      sourceRequest: '1:0:SpawnWork', sourceSeq: 1, sourceEffect: 0, ticketVersion: 1,
      account: 'project', cluster: 'cluster',
      configurationRevision: 'revision', configurationDigest: 'digest',
      status: 'Admitted', attemptsOpened: 0, retriesSpent: 0,
    };
    const attempt = {
      partition, execution: 'execution-one', attempt: 'attempt-one', generation: 1,
      attemptNumber: 1, recoveryEpoch: 'epoch-one', state: 'Placing', authoritative: true,
    };
    const placed = [];
    const store = {
      fenceOldEpochAttempts: async () => 0,
      claimRequests: async () => [],
      admit: async () => ({ admitted: 'NoCandidate' }),
      reapLapsedAttempts: async () => 0,
      unlaunched: async () => [execution],
      openAttempt: async () => ({ opened: 'Opened', attempt }),
      attemptPlaced: async (_attempt, workload) => { placed.push(workload); return true; },
    };
    const configuration = {
      tenant: 'tenant', project: 'project',
      configurationRevision: 'revision', configurationDigest: 'digest',
      brief: {
        motivation: ['The importer drops rows.'],
        acceptanceCriteria: ['A dropped row is reported.'],
        constraints: [],
      },
      practices: ['AcceptanceCriteria'],
      work: { instructions: ['Change the importer.'] },
      review: { instructions: ['Walk the call paths.'] },
    };
  `;
}

/**
 * One scheduler process against fakes for the two authorities it does not own:
 * a pool that answers the schema query, and a cluster that answers the probe
 * and the create.
 */
function processProgram(reachable: boolean): string {
  return `
    const roots = await import('./src/roots/controlPlane.ts');
    const schema = await import('./src/adapters/postgres/runtimeSchema.ts');
    const launch = await import('./src/adapters/kubernetes/workerLaunch.ts');
    const supplied = await import('./src/adapters/supplied/schedulerPorts.ts');
    const scheduler = await import('./src/interpreter/executionScheduler.ts');
    const briefing = await import('./src/interpreter/taskBriefing.ts');
    const tickets = await import('./src/interpreter/ticketService.ts');
    const finalizer = await import('./src/interpreter/finalizer.ts');
    ${processFakes(reachable)}
    const service = {
      store,
      workers: launch.kubernetesWorkerLaunch(cluster, fetcher),
      policy: supplied.suppliedExecutionPolicy({
        profiles: new Map([['Work', {
          profile: { profile: 'standard', runtimeVersion: '1' },
          grant: ${JSON.stringify(grant)},
        }]]),
      }),
      configurations: supplied.suppliedTaskConfigurations([configuration]),
      runtimeFacts: supplied.suppliedRuntimeFacts({ workspace: '/workspace' }),
      practices: briefing.blessedPracticeCatalog,
      config: scheduler.executionSchedulerDefaults,
      ticketService: tickets.ticketServiceDefaults,
      finalizer: finalizer.finalizerDefaults,
      metrics: scheduler.silentSchedulerTelemetry,
    };
    const pool = { query: async () => ({ rows: schema.currentRuntimeSchemaContract.required }) };
    const runtime = roots.schedulerProcess(
      service,
      { owner: 'scheduler-one', recoveryEpoch: 'epoch-one', cluster: 'cluster' },
      { pool, additional: [launch.kubernetesNamespacePrecondition(cluster, fetcher)] },
      { idleIntervalMilliseconds: 1000, shutdownDrainMilliseconds: 1000 },
    );
    const started = await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const health = runtime.health();
    const stopped = await runtime.stop();
    process.stdout.write(JSON.stringify({ started, health, stopped, placed, asked }));
  `;
}

test("the scheduler process starts, places one worker, reports health and stops", async () => {
  const found = JSON.parse(await schedulerProgram(processProgram(true))) as {
    readonly started: unknown;
    readonly health: unknown;
    readonly stopped: unknown;
    readonly placed: readonly string[];
    readonly asked: readonly string[];
  };
  assert.deepEqual(found.started, { started: "Started" });
  assert.deepEqual(found.health, { live: true, ready: true });
  assert.deepEqual(found.stopped, { stopped: "Stopped" });
  assert.equal(found.placed.length, 1);
  assert.deepEqual(found.asked, [
    "GET https://cluster.invalid:6443/api/v1/namespaces/chuggy-workers",
    "POST https://cluster.invalid:6443/api/v1/namespaces/chuggy-workers/pods",
  ]);
});

test("a cluster that does not answer is a named could-not-run and never readiness", async () => {
  const found = JSON.parse(await schedulerProgram(processProgram(false))) as {
    readonly started: unknown;
    readonly health: { readonly ready: boolean };
    readonly placed: readonly string[];
  };
  assert.deepEqual(found.started, {
    started: "CouldNotRun",
    precondition: "cluster-namespace-reachable",
  });
  assert.equal(found.health.ready, false);
  assert.deepEqual(found.placed, []);
});

/** What running the command itself produced, a refusal being an exit code and a line. */
interface CommandRan {
  readonly code: number | null;
  readonly stderr: string;
}

async function schedulerCommand(
  named: Readonly<Record<string, string>>,
  signalAfterMilliseconds?: number,
): Promise<CommandRan> {
  const child = execFile(
    process.execPath,
    ["--experimental-strip-types", "src/roots/scheduler.ts"],
    { cwd: process.cwd(), env: { ...process.env, ...named } },
  );
  if (signalAfterMilliseconds !== undefined) {
    setTimeout(() => child.kill("SIGTERM"), signalAfterMilliseconds).unref();
  }
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  return { code, stderr };
}

test("a database that is not there is a named could-not-run and exit two", async () => {
  const ran = await schedulerCommand(environment);
  assert.equal(ran.code, 2);
  assert.match(ran.stderr, /could not run without schema-compatible/u);
});

test("a signalled command stops within the drain it was given", async () => {
  const sockets: Socket[] = [];
  const hanging = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => {
    hanging.listen(0, "127.0.0.1", resolve);
  });
  const listening = hanging.address();
  const port =
    typeof listening === "object" && listening !== null ? listening.port : 0;
  try {
    const ran = await schedulerCommand(
      {
        ...environment,
        CHUG_SCHEDULER_DATABASE_URL: `postgres://chuggy_scheduler@127.0.0.1:${String(port)}/chuggy`,
        CHUG_SCHEDULER_DATABASE_LIMITS: JSON.stringify({
          connectionWaitMs: 600_000,
        }),
        CHUG_SCHEDULER_SHUTDOWN_DRAIN_MS: "200",
      },
      1_500,
    );
    assert.equal(ran.code, 1);
    assert.match(ran.stderr, /shutdown drain expired/u);
  } finally {
    for (const socket of sockets) socket.destroy();
    hanging.close();
  }
});

test("an incomplete environment stops the command before it reaches anything", async () => {
  const named = Object.fromEntries(
    Object.entries(environment).filter(
      ([each]) => each !== "CHUG_SCHEDULER_OWNER",
    ),
  );
  const ran = await schedulerCommand({
    ...named,
    CHUG_SCHEDULER_OWNER: "",
  });
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /CHUG_SCHEDULER_OWNER is required/u);
});
