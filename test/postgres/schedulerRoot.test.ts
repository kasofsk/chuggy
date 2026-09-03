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
 * suite shares with its worker's other suites is left as it was found. That is
 * why the ports it hands the root are declared in `./schedulerRootPorts.ts`
 * rather than inside the program text: nothing here dereferences them, so the
 * compiler is what has to.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { schedulerRole } from "../../src/adapters/postgres/schema.ts";
import { asConfigurationRevisionId } from "../../src/interpreter/authoring.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import type {
  Partition,
  RecoveryEpoch,
} from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

const execute = promisify(execFile);

let harness: PostgresHarness;
let epoch: RecoveryEpoch;
let configurationPartition: Partition;
let configurationRevision: string;
let configurationDigest: string;
before(async () => {
  harness = await postgresHarnessOpen();
  epoch = await harness.store.currentRecoveryEpoch();
  configurationPartition = await postgresHarnessProject(
    harness.store,
    "scheduler-root-configuration",
  );
  configurationRevision = asConfigurationRevisionId("scheduler-root-config");
  const created = await harness.authoring.createConfiguration({
    partition: configurationPartition,
    authority: {
      kind: asAuthorityKind("User"),
      subject: asAuthoritySubject("author"),
    },
    revision: asConfigurationRevisionId(configurationRevision),
    canonical: postgresHarnessConfiguration,
  });
  if (created.created !== "Created")
    throw new Error("scheduler root configuration was not created");
  configurationDigest = created.revision.digest;
});

/** The session half's binding read, made by the composition root itself. */
function schedulerRootBindingProgram(partition: Partition): string {
  return `
    const roots = await import('./src/roots/controlPlane.ts');
    const pools = await import('./src/adapters/postgres/pool.ts');
    const ports = await import('./test/postgres/schedulerRootPorts.ts');
    const pool = pools.postgresPool(${JSON.stringify(schedulerRootUrl())});
    const sessions = roots.schedulerProcessRootSessions(pool, ports.schedulerRootSessions);
    let read;
    try {
      read = { binding: await sessions.bindings.binding(${JSON.stringify(partition)}) };
    } catch (failure) {
      read = { refused: failure.message };
    }
    await pool.end();
    process.stdout.write(JSON.stringify(read));
  `;
}

function schedulerRootConfigurationProgram(): string {
  return `
    const roots = await import('./src/roots/controlPlane.ts');
    const pools = await import('./src/adapters/postgres/pool.ts');
    const ports = await import('./test/postgres/schedulerRootPorts.ts');
    const pool = pools.postgresPool(${JSON.stringify(schedulerRootUrl())});
    const service = roots.schedulerProcessRootService(pool, ports.schedulerRootService);
    const read = await service.configurations.configuration(
      ${JSON.stringify(configurationPartition)},
      {
        configurationRevision: ${JSON.stringify(configurationRevision)},
        configurationDigest: ${JSON.stringify(configurationDigest)},
      },
    );
    await pool.end();
    process.stdout.write(JSON.stringify(read));
  `;
}
after(async () => {
  await harness.close();
});

/** The URL of this suite's database with every session running as the scheduler's role. */
function schedulerRootUrl(): string {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${schedulerRole}`);
  return url.toString();
}

/** The one named image this suite's root publishes, so a start can be read off the table. */
const schedulerRootWorker = {
  image: "registry.invalid/scheduler-root-worker:1",
  name: "scheduler-root-worker",
  version: "1",
};

/** One start of the root, with two supplied preconditions counting their own calls. */
function schedulerRootProgram(): string {
  return `
    const roots = await import('./src/roots/controlPlane.ts');
    const ports = await import('./test/postgres/schedulerRootPorts.ts');
    const called = { met: 0, unmet: 0 };
    const supplied = [
      { name: 'cluster-namespace-reachable', check: async () => { called.met += 1; return { met: 'Met' }; } },
      { name: 'cluster-quota-available', check: async () => { called.unmet += 1; return { met: 'Refused', why: 'the cluster quota is spent' }; } },
    ];
    const runtime = roots.schedulerProcessRoot({
      database: { url: ${JSON.stringify(schedulerRootUrl())} },
      runtime: { idleIntervalMilliseconds: 1000, shutdownDrainMilliseconds: 1000 },
      identity: {
        owner: 'scheduler-root',
        recoveryEpoch: ${JSON.stringify(epoch)},
        cluster: 'cluster',
      },
      service: ports.schedulerRootService,
      workerCatalog: ${JSON.stringify([schedulerRootWorker])},
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
      verdict: "Refused",
      why: "the cluster quota is spent",
    },
    called: { met: 1, unmet: 1 },
  });
  assert.deepEqual(
    await harness.query(
      "SELECT image,name,version FROM admitted_worker WHERE image=$1",
      [schedulerRootWorker.image],
    ),
    [schedulerRootWorker],
  );
});

test("the production scheduler root reads configurations through PostgreSQL", async () => {
  const result = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      schedulerRootConfigurationProgram(),
    ],
    { cwd: process.cwd() },
  );
  const read = JSON.parse(result.stdout) as { readonly read: string };
  assert.equal(read.read, "Configuration");
});

/**
 * Which adapter the root reaches for, asked as the scheduler's own role: a stub
 * would satisfy the type and answer nothing, and that is every session placed
 * with no tree.
 */
test("the scheduler root reads the binding its session pass places on", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "scheduler-root-binding",
  );
  const repository = asRepositoryId(
    `scheduler-root-repository-${randomUUID()}`,
  );
  await harness.query(
    `INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
     VALUES($1,$2,$3,$4)`,
    [partition.tenant, partition.project, repository, epoch],
  );

  const result = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      schedulerRootBindingProgram(partition),
    ],
    { cwd: process.cwd() },
  );
  const read = JSON.parse(result.stdout) as {
    readonly binding?: { readonly repository: string };
    readonly refused?: string;
  };

  assert.equal(
    read.refused,
    undefined,
    "slice 3's migration 061 has not granted the scheduler this read",
  );
  assert.equal(read.binding?.repository, repository);
});
