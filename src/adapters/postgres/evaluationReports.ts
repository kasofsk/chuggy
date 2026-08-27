import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  priorWorkReportsMax,
  type PriorWorkReportsRead,
  type PriorWorkReportsPort,
} from "../../interpreter/taskBriefing.ts";

interface WorkReportRow {
  readonly report: string;
}

/**
 * Reads only the immutable work manifests pinned into this evaluation's input
 * bundle. A failed read is `Unavailable` rather than a throw, because the
 * scheduler holds an attempt it could not brief instead of losing its loop.
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
      if (found.rows.length > priorWorkReportsMax) {
        throw new Error(
          "postgres evaluation reports: work reports exceed their bound",
        );
      }
      return {
        read: "Reports",
        reports: { reports: found.rows.map((row) => row.report) },
      };
    },
  };
}
