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
import {
  kubernetesSessionBoundsDefaults,
  kubernetesSessionBudgetUsdMin,
  type KubernetesSessionBounds,
} from "../../src/adapters/kubernetes/sessionPod.ts";
import { executionSchedulerDefaults } from "../../src/interpreter/executionScheduler.ts";
import { sessionSchedulerDefaults } from "../../src/interpreter/sessionScheduler.ts";
import { finalizerDefaults } from "../../src/interpreter/finalizer.ts";
import { ticketServiceDefaults } from "../../src/interpreter/ticketService.ts";
import {
  admittedImagesMax,
  workerImageCharsMax,
  workerVersionCharsMax,
} from "../../src/interpreter/workerCatalog.ts";

const execute = promisify(execFile);

const root = mkdtempSync(join(tmpdir(), "chuggy-scheduler-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

const tokenFile = join(root, "token");
writeFileSync(tokenFile, "cluster-token-value\n");

const workerImage = "registry.invalid/worker:1";

const images = [workerImage];

const resources = {
  cpuRequest: "500m",
  cpuLimit: "1",
  memoryRequest: "1Gi",
  memoryLimit: "2Gi",
  ephemeralStorageLimit: "10Gi",
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

const sessionPolicy = {
  image: workerImage,
  profile: "session",
  runtimeVersion: "1",
  grant,
};

const configuration = {
  tenant: "tenant",
  project: "project",
  configurationRevision: "revision",
  configurationDigest: "digest",
  brief: {
    motivation: ["The importer drops rows."],
    acceptanceCriteria: ["A dropped row is reported."],
    constraints: [],
  },
  practices: ["AcceptanceCriteria"],
  work: { instructions: ["Change the importer."] },
  review: { instructions: ["Walk the call paths."] },
};

/** A complete environment, so a case can make one variable at a time the subject. */
const environment: Readonly<Record<string, string>> = {
  CHUG_SCHEDULER_DATABASE_URL: "postgres://chuggy_scheduler@127.0.0.1:1/chuggy",
  CHUG_SCHEDULER_OWNER: "scheduler-one",
  CHUG_SCHEDULER_RECOVERY_EPOCH: "epoch-one",
  CHUG_SCHEDULER_CLUSTER_API_URL: "https://cluster.invalid:6443",
  CHUG_SCHEDULER_CLUSTER_NAMESPACE: "chuggy-workers",
  CHUG_SCHEDULER_CLUSTER_TOKEN_FILE: tokenFile,
  CHUG_SCHEDULER_WORKER_PLANE_URL: "https://worker-plane.invalid",
  CHUG_SCHEDULER_WORKER_CAPABILITY_FILE: "/run/chuggy/capability",
  CHUG_SCHEDULER_WORKER_WORKSPACE_PATH: "/workspace",
  CHUG_SCHEDULER_WORKER_CREDENTIAL_MOUNTS: "{}",
  CHUG_SCHEDULER_WORKER_SERVICE_ACCOUNT: "chuggy-worker",
  CHUG_SCHEDULER_ADMITTED_IMAGES: JSON.stringify(images),
  CHUG_SCHEDULER_WORKER_RESOURCES: JSON.stringify(resources),
  CHUG_SCHEDULER_EXECUTION_POLICY: JSON.stringify(policy),
  CHUG_SCHEDULER_SESSION_RESOURCES: JSON.stringify(resources),
  CHUG_SCHEDULER_SESSION_POLICY: JSON.stringify(sessionPolicy),
  CHUG_SCHEDULER_SESSION_MODEL: "claude-opus-4-5",
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
        parsed: { ...parsed, policy: { ...parsed.policy, profiles: Object.fromEntries(parsed.policy.profiles) } },
      }));
    } catch (failure) {
      process.stdout.write(JSON.stringify({ refused: failure.message }));
    }
  `;
}

/** What the complete environment above parses into, whole, so the case is one assertion. */
const parsed = {
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
    workerPlaneUrl: "https://worker-plane.invalid",
    capabilityFile: "/run/chuggy/capability",
    workspacePath: "/workspace",
    credentialMounts: {},
    environment: {},
    serviceAccountName: "chuggy-worker",
    podNamePrefix: "chuggy-worker",
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
    imagesAdmitted: images,
  },
  workerCatalog: [],
  runtimeFacts: {},
  sessions: {
    apiBaseUrl: "https://cluster.invalid:6443",
    namespace: "chuggy-workers",
    tokenFile,
    serviceAccountName: "chuggy-worker",
    nodeSelector: {},
    podSecurityContext: {},
    containerSecurityContext: {},
    requestTimeoutSecsMax: 30,
    unavailableRetryAfterSecs: 15,
    workerPlaneUrl: "https://worker-plane.invalid",
    capabilityFile: "/run/chuggy/capability",
    workspacePath: "/workspace",
    credentialMounts: {},
    podNamePrefix: "chuggy-session",
    podLabels: {},
    podAnnotations: {},
    environment: {},
    resources,
    activeDeadlineSecs: 86_400,
    bounds: kubernetesSessionBoundsDefaults,
    model: "claude-opus-4-5",
  },
  sessionScheduler: sessionSchedulerDefaults,
  sessionPolicy: {
    image: workerImage,
    profile: { profile: "session", runtimeVersion: "1" },
    grant,
  },
};

test("a complete environment parses into the plain data the process root takes", async () => {
  const found: unknown = JSON.parse(
    await schedulerProgram(parseProgram(environment)),
  );
  assert.deepEqual(found, { parsed });
});

test("a session stands on the site the worker half of one deployment already names", async () => {
  const found = JSON.parse(
    await schedulerProgram(parseProgram(environment)),
  ) as {
    readonly parsed: {
      readonly workers: Readonly<Record<string, unknown>>;
      readonly sessions: Readonly<Record<string, unknown>>;
    };
  };
  for (const shared of [
    "apiBaseUrl",
    "namespace",
    "tokenFile",
    "serviceAccountName",
    "nodeSelector",
    "podSecurityContext",
    "containerSecurityContext",
    "requestTimeoutSecsMax",
    "unavailableRetryAfterSecs",
    "workerPlaneUrl",
    "capabilityFile",
    "workspacePath",
    "credentialMounts",
  ]) {
    assert.deepEqual(
      found.parsed.sessions[shared],
      found.parsed.workers[shared],
      shared,
    );
  }
});

test("a session pod wears the session's own labels and never the worker's", async () => {
  const found = JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_WORKER_LABELS: JSON.stringify({ pod: "worker" }),
        CHUG_SCHEDULER_SESSION_LABELS: JSON.stringify({ pod: "session" }),
      }),
    ),
  ) as {
    readonly parsed?: {
      readonly workers: { readonly podLabels: unknown };
      readonly sessions: { readonly podLabels: unknown };
    };
  };
  assert.deepEqual(found.parsed?.workers.podLabels, { pod: "worker" });
  assert.deepEqual(found.parsed?.sessions.podLabels, { pod: "session" });
});

test("a deployment naming only the worker's labels gives its sessions none", async () => {
  const found = JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_WORKER_LABELS: JSON.stringify({ pod: "worker" }),
      }),
    ),
  ) as {
    readonly parsed?: { readonly sessions: { readonly podLabels: unknown } };
  };
  assert.deepEqual(found.parsed?.sessions.podLabels, {});
});

test("a session bound a deployment states is taken and the rest stay the defaults", async () => {
  const found = JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_SESSION_BOUNDS: JSON.stringify({ idleMs: 60_000 }),
      }),
    ),
  ) as {
    readonly parsed?: { readonly sessions: { readonly bounds: unknown } };
  };
  assert.deepEqual(found.parsed?.sessions.bounds, {
    ...kubernetesSessionBoundsDefaults,
    idleMs: 60_000,
  });
});

/** One session bound as a deployment states it, through the whole real parse. */
async function parsedSessionBound(
  bound: string,
  value: number,
): Promise<{
  readonly parsed?: {
    readonly sessions: { readonly bounds: KubernetesSessionBounds };
  };
  readonly refused?: string;
}> {
  return JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_SESSION_BOUNDS: JSON.stringify({ [bound]: value }),
      }),
    ),
  ) as {
    readonly parsed?: {
      readonly sessions: { readonly bounds: KubernetesSessionBounds };
    };
    readonly refused?: string;
  };
}

test("a site may hold one session turn to a fraction of a dollar", async () => {
  const found = await parsedSessionBound("budgetUsd", 0.5);
  assert.equal(found.refused, undefined);
  assert.equal(found.parsed?.sessions.bounds.budgetUsd, 0.5);
});

test("a budget too small to buy a turn is refused, and a count is still whole", async () => {
  for (const [bound, value] of [
    ["budgetUsd", kubernetesSessionBudgetUsdMin / 10],
    ["budgetUsd", 0],
    ["budgetUsd", -1],
    ["turnsMax", 1.5],
    ["idleMs", 0],
  ] as const) {
    const found = await parsedSessionBound(bound, value);
    assert.equal(
      found.parsed,
      undefined,
      `${bound} ${String(value)} was accepted`,
    );
    assert.match(
      found.refused ?? "",
      new RegExp(`SESSION_BOUNDS: ${bound}`, "u"),
    );
  }
});

test("a session bound no configuration publishes is refused rather than ignored", async () => {
  const found = JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_SESSION_BOUNDS: JSON.stringify({ idelMs: 60_000 }),
      }),
    ),
  ) as { readonly refused?: string };
  assert.match(found.refused ?? "", /SESSION_BOUNDS names an unknown bound/u);
});

/** What one admitted-images list parses into: the images admitted and the catalog. */
interface AdmittedImagesParsed {
  readonly parsed?: {
    readonly policy: { readonly imagesAdmitted: readonly unknown[] };
    readonly workerCatalog: readonly unknown[];
  };
  readonly refused?: string;
}

async function parsedAdmittedImages(
  admitted: readonly unknown[],
): Promise<AdmittedImagesParsed> {
  return JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_ADMITTED_IMAGES: JSON.stringify(admitted),
      }),
    ),
  ) as AdmittedImagesParsed;
}

const namedWorker = {
  image: "registry.invalid/worker:2",
  name: "chuggy-worker",
  version: "3",
};

test("a bare admitted image is admitted and named in no catalog", async () => {
  const found = await parsedAdmittedImages([workerImage]);
  assert.deepEqual(found.parsed?.policy.imagesAdmitted, [workerImage]);
  assert.deepEqual(found.parsed?.workerCatalog, []);
});

test("a named admitted image is admitted and published to the catalog", async () => {
  const found = await parsedAdmittedImages([namedWorker]);
  assert.deepEqual(found.parsed?.policy.imagesAdmitted, [namedWorker.image]);
  assert.deepEqual(found.parsed?.workerCatalog, [namedWorker]);
});

test("both shapes mix, and admission never learns which entry was named", async () => {
  const found = await parsedAdmittedImages([workerImage, namedWorker]);
  assert.deepEqual(found.parsed?.policy.imagesAdmitted, [
    workerImage,
    namedWorker.image,
  ]);
  assert.deepEqual(found.parsed?.workerCatalog, [namedWorker]);
});

test("an admitted image publishes the execution capabilities it provides", async () => {
  const capable = {
    ...namedWorker,
    operatingSystem: "Linux",
    architecture: "Arm64",
    capabilities: ["Agent:Claude", "Agent:Codex"],
  };
  const found = await parsedAdmittedImages([capable]);
  assert.deepEqual(found.parsed?.policy.imagesAdmitted, [
    {
      image: capable.image,
      operatingSystem: capable.operatingSystem,
      architecture: capable.architecture,
      capabilities: capable.capabilities,
    },
  ]);
  assert.deepEqual(found.parsed?.workerCatalog, [namedWorker]);
});

test("an admitted-images list naming one image twice is refused", async () => {
  const found = await parsedAdmittedImages([
    workerImage,
    { ...namedWorker, image: workerImage },
  ]);
  assert.match(found.refused ?? "", /admits the image .* twice/u);
});

test("an admitted-images list spelling one worker label twice is refused", async () => {
  const found = await parsedAdmittedImages([
    { ...namedWorker, image: workerImage },
    namedWorker,
  ]);
  assert.match(
    found.refused ?? "",
    new RegExp(
      `names the worker ${namedWorker.name} version ${namedWorker.version} twice`,
      "u",
    ),
  );
});

test("a worker name outside the configuration name rule is refused", async () => {
  const found = await parsedAdmittedImages([
    { ...namedWorker, name: "-worker" },
  ]);
  assert.match(found.refused ?? "", /is not a worker name/u);
});

test("a worker version longer than its bound is refused", async () => {
  const found = await parsedAdmittedImages([
    { ...namedWorker, version: "v".repeat(workerVersionCharsMax + 1) },
  ]);
  assert.match(found.refused ?? "", /is not a worker version/u);
});

test("a named image longer than the column that holds it is refused", async () => {
  const found = await parsedAdmittedImages([
    { ...namedWorker, image: "i".repeat(workerImageCharsMax + 1) },
  ]);
  assert.match(found.refused ?? "", /ADMITTED_IMAGES/u);
  assert.equal(found.parsed, undefined);
});

test("an admitted-images list longer than its bound is refused", async () => {
  const found = await parsedAdmittedImages(
    Array.from(
      { length: admittedImagesMax + 1 },
      (_, at) => `registry.invalid/worker:${String(at)}`,
    ),
  );
  assert.match(found.refused ?? "", /ADMITTED_IMAGES/u);
  assert.equal(found.parsed, undefined);
});

test("a shared worker database is site data a placement carries, and is optional", async () => {
  const database = { secretName: "worker-database", key: "url" };
  const found = JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_WORKER_DATABASE: JSON.stringify(database),
      }),
    ),
  ) as { readonly parsed?: { readonly workers?: Record<string, unknown> } };
  assert.deepEqual(found.parsed?.workers?.["database"], database);

  const refused = JSON.parse(
    await schedulerProgram(
      parseProgram({
        ...environment,
        CHUG_SCHEDULER_WORKER_DATABASE: JSON.stringify({ secretName: "s" }),
      }),
    ),
  ) as { readonly refused?: string };
  assert.match(refused.refused ?? "", /CHUG_SCHEDULER_WORKER_DATABASE/u);
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

test("a bound named on the prototype of the defaults is refused too", async () => {
  for (const bound of ["toString", "valueOf", "constructor"]) {
    const found = JSON.parse(
      await schedulerProgram(
        parseProgram({
          ...environment,
          CHUG_SCHEDULER_PASS_BOUNDS: JSON.stringify({ [bound]: 4 }),
        }),
      ),
    ) as { readonly refused?: string };
    assert.match(found.refused ?? "", new RegExp(bound, "u"), bound);
  }
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
      workerPlaneUrl: 'https://worker-plane.invalid',
      capabilityFile: '/run/chuggy/capability',
      workspacePath: '/workspace',
      credentialMounts: {},
      environment: {},
      serviceAccountName: 'chuggy-worker',
      podNamePrefix: 'chuggy-worker',
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
      if (init && init.method === 'POST' && String(input).endsWith('/pods')) {
        const submitted = JSON.parse(init.body);
        return Promise.resolve(Response.json({
          metadata: { ...submitted.metadata, uid: 'pod-uid-one' },
        }, { status: 201 }));
      }
      return Promise.resolve(new Response(null, { status: init && init.method === 'POST' ? 201 : 200 }));
    };

    const partition = { tenant: 'tenant', project: 'project' };
    const execution = {
      partition, execution: 'execution-one', ticket: 1, task: 1, taskKind: 'Work',
      sourceRequest: '1:0:SpawnWork', sourceSeq: 1, sourceEffect: 0, ticketVersion: 1,
      account: 'project', cluster: 'cluster',
      configurationRevision: 'revision', configurationDigest: 'digest',
      requirementIdentity: 'requirement-one',
      requirement: { mode: 'Container', operatingSystem: 'Linux', architecture: 'Amd64', image: ${JSON.stringify(workerImage)} },
      requirementDigest: 'requirement-digest',
      requirementSource: 'PlatformDefault', platformDefaultVersion: 1,
      status: 'Admitted', attemptsOpened: 0, retriesSpent: 0,
    };
    const attempt = {
      partition, execution: 'execution-one', attempt: 'attempt-one', generation: 1,
      attemptNumber: 1, recoveryEpoch: 'epoch-one', state: 'Placing', authoritative: true,
      capability: { id: 'capability-one', secret: 'secret-one', manifest: 'manifest-one' },
    };
    const placed = [];
    const store = {
      fenceOldEpochAttempts: async () => 0,
      claimRequests: async () => [],
      admit: async () => ({ admitted: 'NoCandidate' }),
      reapLapsedAttempts: async () => 0,
      attemptsAwaitingCleanup: async () => [],
      attemptCleanupCompleted: async () => true,
      unlaunched: async () => [execution],
      openAttempt: async () => ({ opened: 'Opened', attempt }),
      attemptPlaced: async (_attempt, placement) => { placed.push(placement); return true; },
      attemptEnded: async () => true,
    };
    const configuration = ${JSON.stringify(configuration)};
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
      placement: launch.kubernetesWorkerLaunch(cluster, fetcher),
      policy: supplied.suppliedExecutionPolicy({
        profiles: new Map([['Work', {
          profile: { profile: 'standard', runtimeVersion: '1' },
          grant: ${JSON.stringify(grant)},
        }]]),
        imagesAdmitted: ${JSON.stringify(images)},
      }),
      configurations: {
        configuration: async () => ({ read: 'Configuration', configuration }),
      },
      runtimeFacts: supplied.suppliedRuntimeFacts({ workspace: '/workspace' }),
      priorWorkReports: { reports: async () => ({ read: 'Reports', reports: { reports: [] } }) },
      ticketBriefs: { brief: async () => undefined },
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
    "POST https://cluster.invalid:6443/api/v1/namespaces/chuggy-workers/secrets",
  ]);
});

test("a cluster that does not answer is a named could-not-run and never readiness", async () => {
  const found = JSON.parse(await schedulerProgram(processProgram(false))) as {
    readonly started: {
      readonly started: string;
      readonly precondition: string;
      readonly verdict: string;
    };
    readonly health: { readonly ready: boolean };
    readonly placed: readonly string[];
  };
  assert.equal(found.started.started, "CouldNotRun");
  assert.equal(found.started.precondition, "cluster-namespace-reachable");
  assert.equal(found.started.verdict, "Undecided");
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
  assert.match(
    ran.stderr,
    /^execution scheduler: could not run without schema-compatible undecided — .+\n$/u,
  );
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

/**
 * Runs one module program against the command's environment, signalling it the
 * moment it says it is ready, and reports how it left.
 */
async function schedulerProgramRan(source: string): Promise<CommandRan> {
  const child = execFile(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", source],
    { cwd: process.cwd(), env: { ...process.env, ...environment } },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("ready")) child.kill("SIGTERM");
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  return { code, stderr };
}

/** A dead loop, put to the command's own run against a runtime that reports one. */
const deadLoopProgram = `
  const { schedulerMain } = await import('./src/roots/scheduler.ts');
  const dead = { live: false, ready: false, failure: 'lost authority' };
  const runtime = {
    start: () => Promise.resolve({ started: 'Started' }),
    health: () => dead,
    settled: () => new Promise((resolve) => setTimeout(() => resolve(dead), 1)),
    stop: () => Promise.resolve({ stopped: 'Stopped' }),
  };
  await schedulerMain(process.env, () => runtime);
`;

/** A run a signal ends, which settles live and must read as no failure at all. */
const orderlyStopProgram = `
  const { schedulerMain } = await import('./src/roots/scheduler.ts');
  let end;
  const settled = new Promise((resolve) => { end = resolve; });
  const running = setInterval(() => {}, 1000);
  const runtime = {
    start: async () => {
      process.stdout.write('ready\\n');
      return { started: 'Started' };
    },
    health: () => ({ live: true, ready: true }),
    settled: () => settled,
    stop: async () => {
      clearInterval(running);
      end({ live: true, ready: false });
      return { stopped: 'Stopped' };
    },
  };
  await schedulerMain(process.env, () => runtime);
`;

/** A precondition this deployment does not meet, put to the command's own run. */
const refusedPreconditionProgram = `
  const { schedulerMain } = await import('./src/roots/scheduler.ts');
  const runtime = {
    start: () => Promise.resolve({
      started: 'CouldNotRun',
      precondition: 'journal-legal',
      verdict: 'Refused',
      why: 'stored histories this image could not have decided: acme/rig',
    }),
    health: () => ({ live: true, ready: false }),
    settled: () => Promise.resolve({ live: true, ready: false }),
    stop: () => Promise.resolve({ stopped: 'Stopped' }),
  };
  await schedulerMain(process.env, () => runtime);
`;

test("an unmet precondition leaves the verdict and what it found on stderr", async () => {
  const ran = await schedulerProgramRan(refusedPreconditionProgram);
  assert.equal(ran.code, 2);
  assert.equal(
    ran.stderr,
    "execution scheduler: could not run without journal-legal refused — " +
      "stored histories this image could not have decided: acme/rig\n",
  );
});

test("a loop that dies leaves the failure on stderr and a non-zero status", async () => {
  const ran = await schedulerProgramRan(deadLoopProgram);
  assert.equal(ran.code, 1);
  assert.equal(ran.stderr, "execution scheduler: lost authority\n");
});

test("a signalled run settles live and leaves nothing on stderr and a zero status", async () => {
  const ran = await schedulerProgramRan(orderlyStopProgram);
  assert.equal(ran.code, 0);
  assert.equal(ran.stderr, "");
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
