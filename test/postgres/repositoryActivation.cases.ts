import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresRepositoryActivation } from "../../src/adapters/postgres/repositoryActivation.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import { checkedRepositoryActivation } from "../../src/interpreter/repositoryActivation.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessEpoch,
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

async function fixture(label: string) {
  const partition = await postgresHarnessProject(harness.store, label);
  const recoveryEpoch = await postgresHarnessEpoch(harness.store);
  const repository = `repository-${label}-${randomUUID()}`;
  await harness.query(
    `INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
     VALUES($1,$2,$3,$4)`,
    [partition.tenant, partition.project, repository, recoveryEpoch],
  );
  return { partition, recoveryEpoch, repository };
}

function request(
  standing: Awaited<ReturnType<typeof fixture>>,
  repository: string,
  operation = `operation-${randomUUID()}`,
) {
  return checkedRepositoryActivation({
    tenant: standing.partition.tenant,
    project: standing.partition.project,
    expectedRepository: standing.repository,
    repository,
    recoveryEpoch: standing.recoveryEpoch,
    operation,
    authorityKind: "Administrator",
    authoritySubject: "test-operator",
  });
}

test("activation appends a binding and preserves the former binding", async () => {
  const standing = await fixture("activation-history");
  const next = `repository-next-${randomUUID()}`;
  const activation = request(standing, next);
  assert.equal(
    await postgresRepositoryActivation(pool).activate(activation),
    "Activated",
  );
  assert.deepEqual(
    await postgresProjectRepositoryBinding(pool).binding(standing.partition),
    {
      partition: standing.partition,
      repository: next,
      recoveryEpoch: standing.recoveryEpoch,
    },
  );
  const history = await harness.query(
    `SELECT repository FROM project_repository
      WHERE tenant=$1 AND project=$2 ORDER BY bound_at,repository`,
    [standing.partition.tenant, standing.partition.project],
  );
  assert.deepEqual(
    new Set(history.map((row) => String(row["repository"]))),
    new Set([standing.repository, next]),
  );
  const rollback = request(
    { ...standing, repository: next },
    standing.repository,
  );
  assert.equal(
    await postgresRepositoryActivation(pool).activate(rollback),
    "Activated",
  );
  assert.equal(
    (await postgresProjectRepositoryBinding(pool).binding(standing.partition))
      ?.repository,
    standing.repository,
  );
  assert.deepEqual(
    await harness.query(
      `SELECT authority_kind,authority_subject FROM project_repository_activation
        WHERE operation=$1`,
      [rollback.operation],
    ),
    [{ authority_kind: "Administrator", authority_subject: "test-operator" }],
  );
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE project_repository SET repository=repository
          WHERE tenant=$1 AND project=$2 AND repository=$3`,
        [
          standing.partition.tenant,
          standing.partition.project,
          standing.repository,
        ],
      ),
    /repository bindings are immutable/u,
  );
});

test("activation audit is immutable even to the migration owner", async () => {
  const standing = await fixture("activation-immutable");
  const activation = request(standing, `repository-next-${randomUUID()}`);
  assert.equal(
    await postgresRepositoryActivation(pool).activate(activation),
    "Activated",
  );
  for (const statement of [
    `UPDATE project_repository_activation SET authority_subject=authority_subject
      WHERE operation=$1`,
    `DELETE FROM project_repository_activation WHERE operation=$1`,
  ]) {
    await assert.rejects(
      () => harness.query(statement, [activation.operation]),
      /repository activations are immutable/u,
    );
  }
});

test("an operation retries exactly and refuses changed inputs", async () => {
  const standing = await fixture("activation-idempotency");
  const operation = `operation-${randomUUID()}`;
  const activation = request(
    standing,
    `repository-next-${randomUUID()}`,
    operation,
  );
  const administration = postgresRepositoryActivation(pool);
  assert.equal(await administration.activate(activation), "Activated");
  assert.equal(await administration.activate(activation), "AlreadyActivated");
  assert.equal(
    await administration.activate({
      ...activation,
      repository: request(standing, `different-${randomUUID()}`).repository,
    }),
    "OperationConflict",
  );
});

test("expected repository and recovery epoch fence an activation", async () => {
  const standing = await fixture("activation-fences");
  const administration = postgresRepositoryActivation(pool);
  assert.equal(
    await administration.activate({
      ...request(standing, `repository-next-${randomUUID()}`),
      expectedRepository: request(standing, `unexpected-${randomUUID()}`)
        .repository,
    }),
    "ExpectedRepositoryMismatch",
  );
  const foreign = await fixture("activation-foreign-repository");
  assert.equal(
    await administration.activate(request(standing, foreign.repository)),
    "RepositoryBoundElsewhere",
  );
  const laterEpoch = await harness.store.establishRecoveryEpoch(
    asRecoveryEpoch(`later-${randomUUID()}`),
  );
  assert.notEqual(laterEpoch, standing.recoveryEpoch);
  assert.equal(
    await administration.activate(
      request(standing, `repository-next-${randomUUID()}`),
    ),
    "RecoveryEpochMismatch",
  );
});

test("concurrent activations serialize and only one expected transition wins", async () => {
  const standing = await fixture("activation-concurrency");
  const administration = postgresRepositoryActivation(pool);
  const outcomes = await Promise.all([
    administration.activate(
      request(standing, `repository-left-${randomUUID()}`),
    ),
    administration.activate(
      request(standing, `repository-right-${randomUUID()}`),
    ),
  ]);
  assert.deepEqual(
    [...outcomes].sort(),
    ["Activated", "ExpectedRepositoryMismatch"].sort(),
  );
});
