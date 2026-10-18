/** PostgreSQL read side of a project's immutable repository binding, and the last import attempted of each. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asGitObjectId, asRepositoryId } from "../../interpreter/finalizer.ts";
import type {
  RepositoryBinding,
  RepositoryId,
} from "../../interpreter/finalizer.ts";
import { asRecoveryEpoch } from "../../interpreter/projectStore.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  allRepositoryConfigurationImportAbsences,
  allRepositoryConfigurationImportAttemptResults,
  type ProjectRepositoryBindingRead,
  type RepositoryConfigurationImportAttempt,
  type RepositoryConfigurationImportAttemptOutcome,
  type RepositoryConfigurationImportAttempts,
} from "../../interpreter/repositoryConfiguration.ts";
import type { RepositoryConfigurationImportAttemptsRead } from "../../interpreter/repositoryOnboarding.ts";

async function readProjectRepositoryBinding(
  pool: pg.Pool,
  partition: Partition,
  repository: RepositoryId | undefined,
): Promise<RepositoryBinding | undefined> {
  const found = await pool.query<{
    repository: string | null;
    recovery_epoch: string | null;
  }>(
    sql`SELECT repository,recovery_epoch
          FROM read_project_repository_binding(${partition.tenant},${partition.project},${repository ?? null})`,
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
    binding: (partition, repository) =>
      readProjectRepositoryBinding(pool, partition, repository),
  };
}

/** Keeps one attempt through the door once it has come out, which replaces the binding's row unless the one kept was recorded later. */
export function postgresRepositoryConfigurationImportAttempts(
  pool: pg.Pool,
): RepositoryConfigurationImportAttempts {
  return {
    record: async (attempt) => {
      await pool.query<{ recorded: string | null }>(
        sql`SELECT record_repository_configuration_import(
              ${attempt.partition.tenant},${attempt.partition.project},
              ${attempt.repository},${attempt.commit ?? null},
              ${attempt.outcome.result},
              ${attempt.outcome.result === "SnapshotAbsent" ? attempt.outcome.absent : null})::text AS recorded`,
      );
    },
  };
}

/** One stored attempt's words as the outcome they name, refusing a word no roster here holds. */
function repositoryConfigurationImportAttemptRowOutcome(
  result: string,
  absent: string | null,
): RepositoryConfigurationImportAttemptOutcome {
  const word = allRepositoryConfigurationImportAttemptResults.find(
    (known) => known === result,
  );
  if (word === undefined)
    throw new Error("a kept import attempt names an unknown result");
  if (word !== "SnapshotAbsent") {
    if (absent !== null)
      throw new Error(
        "a kept import attempt names an absence beside no snapshot",
      );
    return { result: word };
  }
  const lacked = allRepositoryConfigurationImportAbsences.find(
    (known) => known === absent,
  );
  if (lacked === undefined)
    throw new Error("a kept absent snapshot names no known absence");
  return { result: word, absent: lacked };
}

async function readRepositoryConfigurationImportAttempts(
  pool: pg.Pool,
  partition: Partition,
  repositories: readonly RepositoryId[],
): Promise<ReadonlyMap<RepositoryId, RepositoryConfigurationImportAttempt>> {
  const found = await pool.query<{
    repository: string;
    attempted_at: string | null;
    repository_commit: string | null;
    result: string;
    absent: string | null;
  }>(
    sql`SELECT repository,
               to_char(attempted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS attempted_at,
               repository_commit,result,absent
          FROM repository_configuration_import
         WHERE tenant=${partition.tenant} AND project=${partition.project}
           AND repository=ANY(${[...repositories]}::text[])`,
  );
  return new Map(
    found.rows.map((row) => {
      if (row.attempted_at === null)
        throw new Error("a kept import attempt has no instant");
      return [
        asRepositoryId(row.repository),
        {
          attemptedAt: row.attempted_at,
          ...(row.repository_commit === null
            ? {}
            : { commit: asGitObjectId(row.repository_commit) }),
          outcome: repositoryConfigurationImportAttemptRowOutcome(
            row.result,
            row.absent,
          ),
        },
      ];
    }),
  );
}

/** Reads the last import attempted of each repository a project binds, through the API's own grant. */
export function postgresRepositoryConfigurationImportAttemptsRead(
  pool: pg.Pool,
): RepositoryConfigurationImportAttemptsRead {
  return {
    attempted: (query) =>
      readRepositoryConfigurationImportAttempts(
        pool,
        query.partition,
        query.repositories,
      ),
  };
}
