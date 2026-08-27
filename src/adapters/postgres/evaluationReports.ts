import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  priorWorkReportsMax,
  type PriorWorkReports,
  type PriorWorkReportsPort,
} from "../../interpreter/taskBriefing.ts";

interface WorkReportRow {
  readonly report: string | null;
}

/** Reads only the immutable work manifests pinned into this evaluation's input bundle. */
export function postgresPriorWorkReports(pool: pg.Pool): PriorWorkReportsPort {
  return {
    reports: async (partition, execution): Promise<PriorWorkReports> => {
      const found = await pool.query<WorkReportRow>(
        sql`SELECT report FROM read_scheduler_work_reports(
              ${partition.tenant},${partition.project},${execution})`,
      );
      if (found.rows.length > priorWorkReportsMax) {
        throw new Error(
          "postgres evaluation reports: work reports exceed their bound",
        );
      }
      return {
        reports: found.rows.map((row) => {
          if (row.report === null)
            throw new Error("postgres evaluation reports: report is null");
          return row.report;
        }),
      };
    },
  };
}
