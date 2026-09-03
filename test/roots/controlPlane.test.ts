import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);

test("a process database role must match its responsibility", async () => {
  const program = `
    const roots = await import('./src/roots/controlPlane.ts');
    const matching = roots.postgresRolePrecondition(
      { query: async () => ({ rows: [{ current_role: 'chuggy_selector_service' }] }) },
      'chuggy_selector_service',
    );
    const rival = roots.postgresRolePrecondition(
      { query: async () => ({ rows: [{ current_role: 'chuggy_api' }] }) },
      'chuggy_selector_service',
    );
    const signal = new AbortController().signal;
    process.stdout.write(
      JSON.stringify([
        (await matching.check(signal)).met === "Met",
        (await rival.check(signal)).met === "Met",
      ]),
    );
  `;
  const result = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    { cwd: process.cwd() },
  );
  assert.deepEqual(JSON.parse(result.stdout), [true, false]);
});

test("every control-plane root reports an absent schema as could-not-run", async () => {
  const program = `
    const roots = await import('./src/roots/controlPlane.ts');
    const schema = await import('./src/adapters/postgres/runtimeSchema.ts');
    const pool = { query: async () => ({ rows: [] }) };
    const requirements = {
      pool,
    };
    const config = { idleIntervalMilliseconds: 1000, shutdownDrainMilliseconds: 1000 };
    const identity = { owner: 'owner', recoveryEpoch: 'epoch', cluster: 'cluster' };
    const wakes = {
      store: {
        cursor: async () => { throw new Error('a process that could not run took a wake pass'); },
        candidates: async () => [],
        wake: async () => ({ woken: 'NoThread' }),
        advance: async (sequence) => sequence,
      },
      clock: { nowIso: () => '2026-09-02T00:00:00.000Z' },
      wakesPerPassMax: 1,
    };
    const runtimes = [
      roots.selectorProcess({}, wakes, requirements, config),
      roots.schedulerProcess({}, {}, identity, requirements, config),
      roots.ticketServiceProcess(
        {},
        { projectsPerPassMax: 1, projectLeaseSeconds: 1 },
        requirements,
        config,
      ),
      roots.finalizerProcess({}, identity, requirements, config),
    ];
    const outcomes = [];
    for (const runtime of runtimes) {
      outcomes.push(await runtime.start());
      await runtime.stop();
    }
    process.stdout.write(JSON.stringify(outcomes));
  `;
  const result = await execute(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", program],
    { cwd: process.cwd() },
  );
  assert.deepEqual(
    (
      JSON.parse(result.stdout) as readonly {
        started: string;
        precondition: string;
        verdict: string;
      }[]
    ).map((outcome) => [
      outcome.started,
      outcome.precondition,
      outcome.verdict,
    ]),
    Array.from({ length: 4 }, () => [
      "CouldNotRun",
      "schema-compatible",
      "Refused",
    ]),
  );
});

const successfulProcessProgram = `
    const roots = await import('./src/roots/controlPlane.ts');
    const schema = await import('./src/adapters/postgres/runtimeSchema.ts');
    const scheduler = await import('./src/interpreter/executionScheduler.ts');
    const finalizer = await import('./src/interpreter/finalizer.ts');
    const finalizerTelemetry = await import('./src/interpreter/finalizerTelemetry.ts');
    const tickets = await import('./src/interpreter/ticketService.ts');
    const sessions = await import('./src/interpreter/sessionScheduler.ts');
    const rows = schema.currentRuntimeSchemaContract.required;
    const pool = { query: async () => ({ rows }) };
    const requirements = { pool };
    const config = { idleIntervalMilliseconds: 1000, shutdownDrainMilliseconds: 1000 };
    const identity = { owner: 'owner', recoveryEpoch: 'epoch', cluster: 'cluster' };
    let selectorPasses = 0;
    let sessionPasses = 0;
    const ticks = [];
    const selectorService = {
      runOnce: async () => { selectorPasses += 1; ticks.push('selector'); return {}; },
    };
    let wakePasses = 0;
    const selectorWakes = {
      store: {
        cursor: async () => 0,
        candidates: async () => { wakePasses += 1; ticks.push('wake'); return []; },
        wake: async () => { throw new Error('an empty page offered a wake'); },
        advance: async () => { throw new Error('an empty page moved the cursor'); },
      },
      clock: { nowIso: () => '2026-09-02T00:00:00.000Z' },
      wakesPerPassMax: 1,
    };
    const schedulerService = {
      store: {
        fenceOldEpochAttempts: async () => 0,
        claimRequests: async () => [],
        admit: async () => ({ admitted: 'NoCandidate' }),
        reapLapsedAttempts: async () => 0,
        attemptsAwaitingCleanup: async () => [],
        attemptCleanupCompleted: async () => true,
        unlaunched: async () => [],
      },
      config: scheduler.executionSchedulerDefaults,
      ticketService: tickets.ticketServiceDefaults,
      finalizer: finalizer.finalizerDefaults,
      metrics: scheduler.silentSchedulerTelemetry,
    };
    const ticketService = {
      domain: {},
      discovery: { ready: async () => [] },
      decisions: {},
      projects: {},
      owner: 'owner',
      monotonicNow: () => 0,
    };
    const sessionService = {
      store: {
        fenceOldEpochAttempts: async () => 0,
        attemptsAwaitingCleanup: async () => [],
        attemptCleanupCompleted: async () => true,
        reapLapsedAttempts: async () => 0,
        reapIdleAttempts: async () => 0,
        awaitingPlacement: async () => { sessionPasses += 1; return []; },
      },
      placement: {},
      bearers: { mint: () => { throw new Error('no session waits for a pod'); } },
      policy: {},
      config: sessions.sessionSchedulerDefaults,
    };
    const finalizerService = {
      store: {
        reclaimStaleEpoch: async () => 0,
        reclaimLapsed: async () => 0,
        heldPermits: async () => [],
        claimRequests: async () => [],
      },
      config: finalizer.finalizerDefaults,
      metrics: finalizerTelemetry.silentFinalizerTelemetry,
    };
    const runtimes = [
      roots.selectorProcess(selectorService, selectorWakes, requirements, config),
      roots.schedulerProcess(schedulerService, sessionService, identity, requirements, config),
      roots.ticketServiceProcess(
        ticketService,
        { projectsPerPassMax: 1, projectLeaseSeconds: 1 },
        requirements,
        config,
      ),
      roots.finalizerProcess(finalizerService, identity, requirements, config),
    ];
    const outcomes = [];
    for (const runtime of runtimes) outcomes.push(await runtime.start());
    await new Promise((resolve) => setTimeout(resolve, 10));
    const health = runtimes.map((runtime) => runtime.health());
    for (const runtime of runtimes) await runtime.stop();
    process.stdout.write(JSON.stringify({
      outcomes, health, selectorPasses, sessionPasses, wakePasses,
      ticks: ticks.slice(0, 2),
    }));
  `;

test("every control-plane responsibility starts, passes and stops against its ports", async () => {
  const result = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      successfulProcessProgram,
    ],
    { cwd: process.cwd() },
  );
  const found = JSON.parse(result.stdout) as {
    readonly outcomes: readonly unknown[];
    readonly health: readonly unknown[];
    readonly selectorPasses: number;
    readonly sessionPasses: number;
    readonly wakePasses: number;
    readonly ticks: readonly string[];
  };
  assert.deepEqual(
    found.outcomes,
    Array.from({ length: 4 }, () => ({
      started: "Started",
    })),
  );
  assert.deepEqual(
    found.health,
    Array.from({ length: 4 }, () => ({
      live: true,
      ready: true,
    })),
  );
  assert.ok(found.selectorPasses > 0);
  assert.ok(
    found.sessionPasses > 0,
    "the scheduler process took a tick without a session pass in it",
  );
  assert.equal(
    found.wakePasses,
    found.selectorPasses,
    "one loop drives both passes, so a tick that ran one ran the other",
  );
  assert.deepEqual(
    found.ticks,
    ["selector", "wake"],
    "the wake pass runs after the runtime pass, in the same tick",
  );
});

const ticketServiceFleetPreamble = `
    const roots = await import('./src/roots/controlPlane.ts');
    const schema = await import('./src/adapters/postgres/runtimeSchema.ts');
    const requirements = {
      pool: { query: async () => ({ rows: schema.currentRuntimeSchemaContract.required }) },
    };
    const config = { idleIntervalMilliseconds: 1, shutdownDrainMilliseconds: 1000 };
    const idleWriter = {
      next: async () => undefined,
      clearReadiness: async () => ({ cleared: 'Cleared' }),
    };
  `;

const cursorSweepProgram = `
    ${ticketServiceFleetPreamble}
    const fleet = ['alpha', 'beta', 'gamma'].map(
      (project) => ({ tenant: 'tenant', project }),
    );
    const cursors = [];
    const service = {
      domain: {},
      discovery: {
        ...idleWriter,
        ready: async (partitionsMax, after) => {
          cursors.push(after === undefined ? null : after.project);
          return fleet
            .filter((one) => after === undefined || one.project > after.project)
            .slice(0, partitionsMax)
            .map((partition) => ({ partition, generation: 1 }));
        },
      },
      decisions: {},
      projects: {
        acquire: async (partition) => ({ acquired: 'Granted', lease: { partition } }),
        release: async () => undefined,
        load: async () => ({ parsed: 'Ok', value: [] }),
      },
      owner: 'owner',
      monotonicNow: () => 0,
    };
    const runtime = roots.ticketServiceProcess(
      service,
      { projectsPerPassMax: 1, projectLeaseSeconds: 1 },
      requirements,
      config,
    );
    await runtime.start();
    const deadline = Date.now() + 10000;
    while (cursors.length < 5 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await runtime.stop();
    process.stdout.write(JSON.stringify(cursors.slice(0, 5)));
  `;

test("the ticket-service loop sweeps the fleet by cursor and wraps at its end", async () => {
  const result = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      cursorSweepProgram,
    ],
    { cwd: process.cwd() },
  );
  assert.deepEqual(JSON.parse(result.stdout), [
    null,
    "alpha",
    "beta",
    "gamma",
    null,
  ]);
});

const containedFaultProgram = `
    ${ticketServiceFleetPreamble}
    const partition = { tenant: 'acme', project: 'web' };
    const service = {
      domain: {},
      discovery: { ...idleWriter, ready: async () => [{ partition, generation: 1 }] },
      decisions: {},
      projects: {
        acquire: async () => ({ acquired: 'Granted', lease: { partition } }),
        release: async () => undefined,
        load: async () => { throw new Error('journal is illegal to replay'); },
      },
      owner: 'owner',
      monotonicNow: () => 0,
    };
    const runtime = roots.ticketServiceProcess(
      service,
      { projectsPerPassMax: 1, projectLeaseSeconds: 1 },
      requirements,
      config,
    );
    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const health = runtime.health();
    await runtime.stop();
    process.stdout.write(JSON.stringify(health));
  `;

test("a contained fault reaches an operator on stderr and leaves the loop live", async () => {
  const result = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      containedFaultProgram,
    ],
    { cwd: process.cwd() },
  );
  assert.deepEqual(JSON.parse(result.stdout), { live: true, ready: true });
  assert.ok(
    result.stderr.includes(
      "ticket service: acme/web ActivationFailed: journal is illegal to replay",
    ),
  );
});
