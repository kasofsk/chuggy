import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";
import "./repositoryBinding.cases.ts";

let harness: PostgresHarness;
let pool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  pool = postgresPool(postgresHarnessUrl());
});
after(async () => {
  await pool.end();
  await harness.close();
});

test("repository binding reads are project-local and preserve their epoch", async () => {
  const first = await postgresHarnessProject(
    harness.store,
    "binding-read-first",
  );
  const second = await postgresHarnessProject(
    harness.store,
    "binding-read-second",
  );
  const row = (await harness.query(
    "SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1",
  )) as readonly { epoch: string }[];
  const epoch = row[0]?.epoch;
  if (epoch === undefined) throw new Error("recovery epoch fixture is absent");
  await harness.query(
    `INSERT INTO project_repository (tenant,project,repository,recovery_epoch)
     VALUES ($1,$2,$3,$7),($4,$5,$6,$7)`,
    [
      first.tenant,
      first.project,
      "repository-first",
      second.tenant,
      second.project,
      "repository-second",
      epoch,
    ],
  );
  const bindings = postgresProjectRepositoryBinding(pool);
  assert.deepEqual(await bindings.binding(first), {
    partition: first,
    repository: "repository-first",
    recoveryEpoch: epoch,
  });
  assert.deepEqual(await bindings.binding(second), {
    partition: second,
    repository: "repository-second",
    recoveryEpoch: epoch,
  });
});

test("repository binding reads hold a shared project name and a shared tenant apart", async () => {
  const row = (await harness.query(
    "SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1",
  )) as readonly { epoch: string }[];
  const epoch = row[0]?.epoch;
  if (epoch === undefined) throw new Error("recovery epoch fixture is absent");

  const sharedProject = asProjectId(
    `project-binding-read-shared-${randomUUID()}`,
  );
  const sharedTenant = asTenantId(`tenant-binding-read-shared-${randomUUID()}`);
  const fixtures: readonly { partition: Partition; repository: string }[] = [
    {
      partition: {
        tenant: asTenantId(`tenant-binding-read-shared-a-${randomUUID()}`),
        project: sharedProject,
      },
      repository: `repository-binding-read-shared-project-a-${randomUUID()}`,
    },
    {
      partition: {
        tenant: asTenantId(`tenant-binding-read-shared-b-${randomUUID()}`),
        project: sharedProject,
      },
      repository: `repository-binding-read-shared-project-b-${randomUUID()}`,
    },
    {
      partition: {
        tenant: sharedTenant,
        project: asProjectId(`project-binding-read-shared-a-${randomUUID()}`),
      },
      repository: `repository-binding-read-shared-tenant-a-${randomUUID()}`,
    },
    {
      partition: {
        tenant: sharedTenant,
        project: asProjectId(`project-binding-read-shared-b-${randomUUID()}`),
      },
      repository: `repository-binding-read-shared-tenant-b-${randomUUID()}`,
    },
  ];
  for (const { partition, repository } of fixtures) {
    await harness.store.createProject(partition);
    await harness.query(
      `INSERT INTO project_repository (tenant,project,repository,recovery_epoch)
       VALUES ($1,$2,$3,$4)`,
      [partition.tenant, partition.project, repository, epoch],
    );
  }

  const bindings = postgresProjectRepositoryBinding(pool);
  for (const { partition, repository } of fixtures) {
    assert.deepEqual(await bindings.binding(partition), {
      partition,
      repository,
      recoveryEpoch: epoch,
    });
  }
});

test("a binding read answers the repository named, and the project's oldest where none is", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "binding-named",
  );
  const row = (await harness.query(
    "SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1",
  )) as readonly { epoch: string }[];
  const epoch = row[0]?.epoch;
  if (epoch === undefined) throw new Error("recovery epoch fixture is absent");
  const older = `repository-binding-named-older-${randomUUID()}`;
  const newer = `repository-binding-named-newer-${randomUUID()}`;
  await harness.query(
    `INSERT INTO project_repository (tenant,project,repository,recovery_epoch,bound_at)
     VALUES ($1,$2,$3,$5,'2026-01-01'),($1,$2,$4,$5,'2026-01-02')`,
    [partition.tenant, partition.project, older, newer, epoch],
  );
  const bindings = postgresProjectRepositoryBinding(pool);
  assert.deepEqual(await bindings.binding(partition, asRepositoryId(newer)), {
    partition,
    repository: newer,
    recoveryEpoch: epoch,
  });
  assert.deepEqual(await bindings.binding(partition, asRepositoryId(older)), {
    partition,
    repository: older,
    recoveryEpoch: epoch,
  });
  assert.deepEqual(await bindings.binding(partition), {
    partition,
    repository: older,
    recoveryEpoch: epoch,
  });
  assert.equal(
    await bindings.binding(
      partition,
      asRepositoryId(`repository-binding-named-unbound-${randomUUID()}`),
    ),
    undefined,
  );
});
