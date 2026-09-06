import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  priorEvaluationReportsMax,
  priorWorkReportsMax,
  type PriorEvaluationReportsPort,
  type PriorEvaluationReportsRead,
  type PriorWorkReportsRead,
  type PriorWorkReportsPort,
} from "../../interpreter/taskBriefing.ts";

interface WorkReportRow {
  readonly report: string;
}

/**
 * Reads only the immutable work manifests pinned into this evaluation's input
 * bundle, one more than the briefing renders so a list past its bound is
 * answered and refused there. A failed read is `Unavailable` rather than a
 * throw, because the scheduler holds an attempt it could not brief instead of
 * losing its loop.
 */
export function postgresPriorWorkReports(pool: pg.Pool): PriorWorkReportsPort {
  return {
    reports: async (partition, execution): Promise<PriorWorkReportsRead> => {
      let found: pg.QueryResult<WorkReportRow>;
      try {
        found = await pool.query<WorkReportRow>(
          sql`SELECT r.report
                FROM execution e
                JOIN execution_request q
                  ON q.tenant=e.tenant AND q.project=e.project
                 AND q.request=e.source_request
                JOIN input_bundle_reference b
                  ON b.tenant=q.tenant AND b.project=q.project
                 AND b.bundle=q.input_bundle AND b.reference_kind='ResultManifest'
                JOIN execution_result_report r
                  ON r.tenant=b.tenant AND r.project=b.project
                 AND r.manifest=b.reference_id
               WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
                 AND e.execution=${execution}
               ORDER BY b.ordinal
               LIMIT ${priorWorkReportsMax + 1}`,
        );
      } catch {
        return { read: "Unavailable" };
      }
      return {
        read: "Reports",
        reports: { reports: found.rows.map((row) => row.report) },
      };
    },
  };
}

interface EvaluationReportRow {
  readonly report: string;
}

/**
 * Reads the reports of the failed executions of the evaluation spawned last
 * before this work task, and none for a first attempt, which follows no
 * evaluation. The rows are the same immutable report rows a review reads, read
 * one past the bound the same way, so a failed read is `Unavailable` for the
 * same reason.
 */
export function postgresPriorEvaluationReports(
  pool: pg.Pool,
): PriorEvaluationReportsPort {
  return {
    reports: async (
      partition,
      execution,
    ): Promise<PriorEvaluationReportsRead> => {
      let found: pg.QueryResult<EvaluationReportRow>;
      try {
        found = await pool.query<EvaluationReportRow>(
          sql`WITH latest AS (
                SELECT f.source_request AS request
                  FROM execution e
                  JOIN execution f
                    ON f.tenant=e.tenant AND f.project=e.project
                   AND f.ticket=e.ticket AND f.task<e.task
                  JOIN execution_request q
                    ON q.tenant=f.tenant AND q.project=f.project
                   AND q.request=f.source_request
                 WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
                   AND e.execution=${execution}
                   AND q.kind='SpawnEvaluation'
                 ORDER BY f.task DESC
                 LIMIT 1)
              SELECT r.report
                FROM execution f
                JOIN latest ON latest.request=f.source_request
                JOIN execution_result_report r
                  ON r.tenant=f.tenant AND r.project=f.project
                 AND r.manifest=f.result_manifest
               WHERE f.tenant=${partition.tenant} AND f.project=${partition.project}
                 AND f.outcome='Failed'
               ORDER BY f.task
               LIMIT ${priorEvaluationReportsMax + 1}`,
        );
      } catch {
        return { read: "Unavailable" };
      }
      return {
        read: "Reports",
        reports: { reports: found.rows.map((row) => row.report) },
      };
    },
  };
}
