import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type GitObjectId,
} from "../../interpreter/finalizer.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { asResultManifestId } from "../../interpreter/resultManifest.ts";
import type {
  ExecutionSourceHistoryPort,
  TicketSourceRow,
  WorkSourceHistory,
} from "../../interpreter/executionSourceObservation.ts";

export function postgresExecutionSourceHistory(
  pool: pg.Pool,
): ExecutionSourceHistoryPort {
  return {
    workSource: async (partition: Partition, ticket: number) => {
      const found = await pool.query<{
        manifests: (string | null)[];
      }>(
        sql`WITH work AS (
              SELECT request
                FROM execution_request
               WHERE tenant=${partition.tenant} AND project=${partition.project}
                 AND ticket=${ticket} AND kind='SpawnWork'
               ORDER BY authorizing_seq DESC
               LIMIT 1
            ), spawned AS (
              SELECT e.task,e.result_manifest
                FROM execution e, work
               WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
                 AND e.ticket=${ticket} AND e.source_request=work.request
            )
            SELECT COALESCE(array_agg(p.result_manifest ORDER BY p.task)
                     FILTER (WHERE p.result_manifest IS NOT NULL),
                     ARRAY[]::text[]) manifests
              FROM spawned p`,
      );
      const row = found.rows[0];
      return {
        manifests: (row?.manifests ?? [])
          .filter((manifest): manifest is string => manifest !== null)
          .map(asResultManifestId),
      } satisfies WorkSourceHistory;
    },
    ticketSource: async (
      partition: Partition,
      ticket: number,
      source: number,
    ) => {
      const found = await pool.query<{
        repository: string | null;
        commit: string | null;
        ref: string | null;
      }>(
        sql`SELECT repository,commit,ref FROM ticket_source
             WHERE tenant=${partition.tenant} AND project=${partition.project}
               AND ticket=${ticket} AND source=${source}`,
      );
      const row = found.rows[0];
      if (row === undefined) return undefined;
      return {
        ...(row.repository === null
          ? {}
          : { repository: asRepositoryId(row.repository) }),
        ...(row.commit === null ? {} : { commit: asGitObjectId(row.commit) }),
        ...(row.ref === null ? {} : { ref: asGitRefName(row.ref) }),
      } satisfies TicketSourceRow;
    },
    workResultBases: (partition, ticket, commit, limit) =>
      workResultBases(pool, partition, ticket, commit, limit),
  };
}

/** The distinct bases of the ticket's work results that produced `commit`, as the port names them. */
async function workResultBases(
  pool: pg.Pool,
  partition: Partition,
  ticket: number,
  commit: GitObjectId,
  limit: number,
): Promise<readonly GitObjectId[]> {
  const found = await pool.query<{ base: string }>(
    sql`SELECT DISTINCT s.base
          FROM execution_result_source s
          JOIN execution e
            ON e.tenant=s.tenant AND e.project=s.project
           AND e.result_manifest=s.manifest
         WHERE s.tenant=${partition.tenant} AND s.project=${partition.project}
           AND e.ticket=${ticket} AND s.commit=${commit} AND s.base<>s.commit
         ORDER BY s.base
         LIMIT ${limit}`,
  );
  return found.rows.map((row) => asGitObjectId(row.base));
}
