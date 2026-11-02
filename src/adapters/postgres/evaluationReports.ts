import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { allFinalizationFailureKinds } from "../../interpreter/finalizer.ts";
import {
  type FailedLanding,
  type FailedLandingPort,
  type FailedLandingRead,
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

interface FailedLandingRow {
  readonly target_commit: string;
  readonly change_commit: string | null;
  readonly conflicted: boolean;
  readonly failure_kind: string | null;
  readonly proposal_base_ref: string | null;
  readonly proposal_base_commit: string | null;
  readonly queue_group_commit: string | null;
}

/**
 * Reads the failed landing this work task's own bundle pins: the target it was
 * prepared against, the commit of the one source a pinned result manifest
 * recorded, whether a conflict manifest was pinned beside them, and what the
 * pinned attempt recorded of why it failed. A bundle that pins no
 * `FinalizationAttempt` answers no row, a manifest with no source still answers
 * one, without the change's commit, and an attempt the row does not find
 * answers one with nothing of why.
 */
/** What a row says of why its attempt failed, and nothing where it names a kind this code does not know. */
function failedLandingWhyOf(
  row: FailedLandingRow,
): Pick<FailedLanding, "failure" | "proposalBase" | "groupCommit"> | undefined {
  const failure = allFinalizationFailureKinds.find(
    (kind) => kind === row.failure_kind,
  );
  if (row.failure_kind !== null && failure === undefined) return undefined;
  return {
    ...(failure === undefined ? {} : { failure }),
    ...(row.proposal_base_ref === null || row.proposal_base_commit === null
      ? {}
      : {
          proposalBase: {
            ref: row.proposal_base_ref,
            commit: row.proposal_base_commit,
          },
        }),
    ...(row.queue_group_commit === null
      ? {}
      : { groupCommit: row.queue_group_commit }),
  };
}

export function postgresFailedLanding(pool: pg.Pool): FailedLandingPort {
  return {
    landing: async (partition, execution): Promise<FailedLandingRead> => {
      let found: pg.QueryResult<FailedLandingRow>;
      try {
        found = await pool.query<FailedLandingRow>(
          sql`SELECT t.reference_id AS target_commit,
                     (SELECT s.commit
                        FROM input_bundle_reference m
                        JOIN execution_result_source s
                          ON s.tenant=m.tenant AND s.project=m.project
                         AND s.manifest=m.reference_id
                       WHERE m.tenant=q.tenant AND m.project=q.project
                         AND m.bundle=q.input_bundle
                         AND m.reference_kind='ResultManifest'
                       ORDER BY m.ordinal
                       LIMIT 1) AS change_commit,
                     EXISTS (SELECT 1
                               FROM input_bundle_reference c
                              WHERE c.tenant=q.tenant AND c.project=q.project
                                AND c.bundle=q.input_bundle
                                AND c.reference_kind='ConflictManifest') AS conflicted,
                     f.failure_kind, f.proposal_base_ref, f.proposal_base_commit,
                     f.queue_group_commit
                FROM execution e
                JOIN execution_request q
                  ON q.tenant=e.tenant AND q.project=e.project
                 AND q.request=e.source_request
                JOIN input_bundle_reference a
                  ON a.tenant=q.tenant AND a.project=q.project
                 AND a.bundle=q.input_bundle
                 AND a.reference_kind='FinalizationAttempt'
                JOIN input_bundle_reference t
                  ON t.tenant=q.tenant AND t.project=q.project
                 AND t.bundle=q.input_bundle AND t.reference_kind='TargetCommit'
                LEFT JOIN finalization_attempt f
                  ON f.tenant=a.tenant AND f.project=a.project
                 AND f.attempt=a.reference_id
               WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
                 AND e.execution=${execution}
               ORDER BY t.ordinal
               LIMIT 1`,
        );
      } catch {
        return { read: "Unavailable" };
      }
      const row = found.rows[0];
      if (row === undefined) return { read: "Landing" };
      const why = failedLandingWhyOf(row);
      return why === undefined
        ? { read: "Unavailable" }
        : {
            read: "Landing",
            landing: {
              targetCommit: row.target_commit,
              ...(row.change_commit === null
                ? {}
                : { changeCommit: row.change_commit }),
              conflicted: row.conflicted,
              ...why,
            },
          };
    },
  };
}
