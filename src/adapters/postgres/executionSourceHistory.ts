import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asGitObjectId, asRepositoryId } from "../../interpreter/finalizer.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { asResultManifestId } from "../../interpreter/resultManifest.ts";
import type {
  ExecutionSourceHistoryPort,
  WorkSourceHistory,
} from "../../interpreter/executionSourceObservation.ts";

export function postgresExecutionSourceHistory(
  pool: pg.Pool,
): ExecutionSourceHistoryPort {
  return {
    workSource: async (partition: Partition, ticket: number) => {
      const found = await pool.query<{
        repository: string | null;
        base: string | null;
        declared: string[] | null;
        manifests: (string | null)[];
      }>(
        sql`WITH work AS (
              SELECT request,input_bundle
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
            ), produced AS (
              SELECT s.commit
                FROM spawned p
                JOIN execution_result_source s
                  ON s.tenant=${partition.tenant} AND s.project=${partition.project}
                     AND s.manifest=p.result_manifest
               ORDER BY p.task
               LIMIT 2
            )
            SELECT
              (SELECT reference_id FROM input_bundle_reference r, work
                WHERE r.tenant=${partition.tenant} AND r.project=${partition.project}
                  AND r.bundle=work.input_bundle AND r.reference_kind='Repository') repository,
              (SELECT reference_id FROM input_bundle_reference r, work
                WHERE r.tenant=${partition.tenant} AND r.project=${partition.project}
                  AND r.bundle=work.input_bundle AND r.reference_kind='TargetCommit') base,
              (SELECT array_agg(commit) FROM produced) declared,
              COALESCE(array_agg(p.result_manifest ORDER BY p.task)
                FILTER (WHERE p.result_manifest IS NOT NULL), ARRAY[]::text[]) manifests
              FROM spawned p`,
      );
      const row = found.rows[0];
      if (row === undefined || row.repository === null || row.base === null)
        return undefined;
      return {
        repository: asRepositoryId(row.repository),
        base: asGitObjectId(row.base),
        declared: (row.declared ?? []).map(asGitObjectId),
        manifests: row.manifests
          .filter((manifest): manifest is string => manifest !== null)
          .map(asResultManifestId),
      } satisfies WorkSourceHistory;
    },
  };
}
