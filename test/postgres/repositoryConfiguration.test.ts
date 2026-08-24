import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

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
     VALUES ($1,$2,$3,$5),($1,$4,$6,$5)`,
    [
      first.tenant,
      first.project,
      "repository-first",
      second.project,
      epoch,
      "repository-second",
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
