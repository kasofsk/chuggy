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
    process.stdout.write(JSON.stringify([await matching.check(signal), await rival.check(signal)]));
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
    const runtimes = [
      roots.selectorProcess({}, requirements, config),
      roots.schedulerProcess({}, identity, requirements, config),
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
  assert.deepEqual(JSON.parse(result.stdout), [
    { started: "CouldNotRun", precondition: "schema-compatible" },
    { started: "CouldNotRun", precondition: "schema-compatible" },
    { started: "CouldNotRun", precondition: "schema-compatible" },
    { started: "CouldNotRun", precondition: "schema-compatible" },
  ]);
});

const successfulProcessProgram = `
    const roots = await import('./src/roots/controlPlane.ts');
    const schema = await import('./src/adapters/postgres/runtimeSchema.ts');
    const scheduler = await import('./src/interpreter/executionScheduler.ts');
    const finalizer = await import('./src/interpreter/finalizer.ts');
    const finalizerTelemetry = await import('./src/interpreter/finalizerTelemetry.ts');
    const tickets = await import('./src/interpreter/ticketService.ts');
    const rows = schema.currentRuntimeSchemaContract.required;
    const pool = { query: async () => ({ rows }) };
    const requirements = { pool };
    const config = { idleIntervalMilliseconds: 1000, shutdownDrainMilliseconds: 1000 };
    const identity = { owner: 'owner', recoveryEpoch: 'epoch', cluster: 'cluster' };
    let selectorPasses = 0;
    const selectorService = { runOnce: async () => { selectorPasses += 1; return {}; } };
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
      roots.selectorProcess(selectorService, requirements, config),
      roots.schedulerProcess(schedulerService, identity, requirements, config),
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
    process.stdout.write(JSON.stringify({ outcomes, health, selectorPasses }));
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
});
