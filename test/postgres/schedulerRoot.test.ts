/**
 * The scheduler process root against a real PostgreSQL: whether a precondition
 * its deployment supplies is reached at all, and whether it can refuse.
 *
 * THIS TIER IS THE LOWEST ONE THAT CAN ASK. The root owns its own pool, so
 * there is no seam a unit case could hand a fake through, and the database
 * preconditions run first — a case without a server stops at
 * `schema-compatible` and never reaches what it came to check. Only a pool
 * that answers the schema, the role and the epoch gets that far, and this
 * suite's server is the one that supplies it.
 *
 * IT IS DRIVEN AS A PROCESS BECAUSE NOTHING MAY IMPORT ONE.
 * `.dependency-cruiser.cjs` forbids an import of `src/roots/` from anywhere, so
 * the case runs the module in a child process of its own, under the scheduler's
 * own role exactly as its deployment would.
 *
 * THE LOOP IS NEVER ENTERED. The last supplied precondition refuses, so the
 * runtime answers before a pass could write anything, and the database this
 * suite shares with its worker's other suites is left as it was found.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { schedulerRole } from "../../src/adapters/postgres/schema.ts";
import type { RecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

const execute = promisify(execFile);

let harness: PostgresHarness;
let epoch: RecoveryEpoch;
before(async () => {
  harness = await postgresHarnessOpen();
  epoch = await harness.store.currentRecoveryEpoch();
});
after(async () => {
  await harness.close();
});

/** The URL of this suite's database with every session running as the scheduler's role. */
function schedulerRootUrl(): string {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${schedulerRole}`);
  return url.toString();
}

/** One start of the root, with two supplied preconditions counting their own calls. */
function schedulerRootProgram(): string {
  return `
    const roots = await import('./src/roots/controlPlane.ts');
    const scheduler = await import('./src/interpreter/executionScheduler.ts');
    const tickets = await import('./src/interpreter/ticketService.ts');
    const finalizer = await import('./src/interpreter/finalizer.ts');
    const briefing = await import('./src/interpreter/taskBriefing.ts');
    const called = { met: 0, unmet: 0 };
    const supplied = [
      { name: 'cluster-namespace-reachable', check: async () => { called.met += 1; return true; } },
      { name: 'cluster-quota-available', check: async () => { called.unmet += 1; return false; } },
    ];
    const service = {
      workers: {
        place: async () => ({ placed: 'Unavailable', retryAfterSeconds: 1 }),
        delete: async () => undefined,
      },
      policy: {
        profileFor: async () => ({ resolved: 'Denied', reason: 'ExecutionProfileUnavailable' }),
      },
      configurations: { configuration: async () => ({ read: 'Unavailable' }) },
      runtimeFacts: { facts: async () => ({ read: 'Unavailable' }) },
      practices: briefing.blessedPracticeCatalog,
      config: scheduler.executionSchedulerDefaults,
      ticketService: tickets.ticketServiceDefaults,
      finalizer: finalizer.finalizerDefaults,
      metrics: scheduler.silentSchedulerTelemetry,
    };
    const runtime = roots.schedulerProcessRoot({
      database: { url: ${JSON.stringify(schedulerRootUrl())} },
      runtime: { idleIntervalMilliseconds: 1000, shutdownDrainMilliseconds: 1000 },
      identity: {
        owner: 'scheduler-root',
        recoveryEpoch: ${JSON.stringify(epoch)},
        cluster: 'cluster',
      },
      service,
      additional: supplied,
    });
    const started = await runtime.start();
    await runtime.stop();
    process.stdout.write(JSON.stringify({ started, called }));
  `;
}

test("a precondition the deployment supplies is reached past the database ones and refuses", async () => {
  const result = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      schedulerRootProgram(),
    ],
    { cwd: process.cwd() },
  );
  assert.deepEqual(JSON.parse(result.stdout), {
    started: {
      started: "CouldNotRun",
      precondition: "cluster-quota-available",
    },
    called: { met: 1, unmet: 1 },
  });
});
