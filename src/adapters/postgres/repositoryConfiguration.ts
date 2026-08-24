/** PostgreSQL read side of a project's immutable repository binding. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asRepositoryId } from "../../interpreter/finalizer.ts";
import type { RepositoryBinding } from "../../interpreter/finalizer.ts";
import { asRecoveryEpoch } from "../../interpreter/projectStore.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { ProjectRepositoryBindingRead } from "../../interpreter/repositoryConfiguration.ts";

async function readProjectRepositoryBinding(
  pool: pg.Pool,
  partition: Partition,
): Promise<RepositoryBinding | undefined> {
  const found = await pool.query<{
    repository: string | null;
    recovery_epoch: string | null;
  }>(
    sql`SELECT repository,recovery_epoch
          FROM read_project_repository_binding(${partition.tenant},${partition.project})`,
  );
  const row = found.rows[0];
  if (row?.repository === null || row?.recovery_epoch === null)
    throw new Error("repository binding read returned a partial binding");
  return row === undefined
    ? undefined
    : {
        partition,
        repository: asRepositoryId(row.repository),
        recoveryEpoch: asRecoveryEpoch(row.recovery_epoch),
      };
}

export function postgresProjectRepositoryBinding(
  pool: pg.Pool,
): ProjectRepositoryBindingRead {
  return {
    binding: (partition) => readProjectRepositoryBinding(pool, partition),
  };
}
