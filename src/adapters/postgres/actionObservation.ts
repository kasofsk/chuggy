/**
 * PostgreSQL store of what each declared action was reported to have done.
 *
 * ONE STATEMENT IS THE RECORD. The door decides whether the action is declared
 * and whether the report repeats the newest, so nothing is read here first and
 * no answer is assembled from several calls.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { ActionObservationStore } from "../../interpreter/actionReport.ts";

export function postgresActionObservations(
  pool: pg.Pool,
): ActionObservationStore {
  return {
    record: async ({ partition, action, reporter, report }) => {
      const { tenant, project } = partition;
      const recorded = await pool.query<{ result: string | null }>(
        sql`SELECT record_action_observation(${tenant},${project},${action},${report.commit},${report.outcome},to_timestamp(${report.observedAtMs ?? null}::double precision/1000),${reporter},${report.detail ?? null},${report.link ?? null})::text AS result`,
      );
      const result = recorded.rows[0]?.result;
      if (
        result !== "Recorded" &&
        result !== "Repeated" &&
        result !== "Undeclared"
      )
        throw new Error(`action observation record returned ${String(result)}`);
      return result;
    },
  };
}
