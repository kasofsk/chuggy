import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asGitObjectId, asRepositoryId } from "../../interpreter/finalizer.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import { asResultManifestId } from "../../interpreter/resultManifest.ts";
import type { ExecutionSourceHistoryPort } from "../../interpreter/executionSourceObservation.ts";

export function postgresExecutionSourceHistory(
  pool: pg.Pool,
): ExecutionSourceHistoryPort {
  return {
    workSource: async (partition: Partition, ticket: number) => {
      const found = await pool.query<{
        repository: string | null;
        target_commit: string | null;
        manifests: string[];
      }>(
        sql`WITH work AS (
              SELECT input_bundle
                FROM execution_request
               WHERE tenant=${partition.tenant} AND project=${partition.project}
                 AND ticket=${ticket} AND kind='SpawnWork'
               ORDER BY authorizing_seq DESC
               LIMIT 1
            )
            SELECT
              (SELECT reference_id FROM input_bundle_reference r, work
                WHERE r.tenant=${partition.tenant} AND r.project=${partition.project}
                  AND r.bundle=work.input_bundle AND r.reference_kind='Repository') repository,
              (SELECT reference_id FROM input_bundle_reference r, work
                WHERE r.tenant=${partition.tenant} AND r.project=${partition.project}
                  AND r.bundle=work.input_bundle AND r.reference_kind='TargetCommit') target_commit,
              COALESCE(array_agg(e.result_manifest ORDER BY e.task)
                FILTER (WHERE e.result_manifest IS NOT NULL), ARRAY[]::text[]) manifests
              FROM execution e, work
             WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
               AND e.ticket=${ticket} AND e.source_request IN (
                 SELECT request FROM execution_request
                  WHERE tenant=${partition.tenant} AND project=${partition.project}
                    AND ticket=${ticket} AND kind='SpawnWork'
               )`,
      );
      const row = found.rows[0];
      if (
        row === undefined ||
        row.repository === null ||
        row.target_commit === null
      )
        return undefined;
      return {
        repository: asRepositoryId(row.repository),
        target: { commit: asGitObjectId(row.target_commit) },
        manifests: row.manifests.map(asResultManifestId),
      };
    },
  };
}
