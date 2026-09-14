/**
 * One repository bound into a project, made through the door the suites that
 * read a binding also read. It is shared because a suite that inserted the row
 * itself would be asserting against a binding no bind ever made.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import { postgresRepositoryBinding } from "../../src/adapters/postgres/repositoryBinding.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { checkedRepositoryBindingCommand } from "../../src/interpreter/repositoryBinding.ts";
import { postgresHarnessEpoch, type PostgresHarness } from "./harness.ts";

/** Binds one repository named for the case, under the epoch that stands, and answers its identity. */
export async function fixtureBoundRepository(
  harness: PostgresHarness,
  pool: pg.Pool,
  partition: Partition,
  label: string,
): Promise<string> {
  const recoveryEpoch = await postgresHarnessEpoch(harness.store);
  const repository = `repository-${label}-${randomUUID()}`;
  assert.equal(
    await postgresRepositoryBinding(pool).bind(
      checkedRepositoryBindingCommand({
        tenant: partition.tenant,
        project: partition.project,
        repository,
        recoveryEpoch,
        operation: `operation-${randomUUID()}`,
        authorityKind: "Administrator",
        authoritySubject: "test-operator",
      }),
    ),
    "Bound",
  );
  return repository;
}
