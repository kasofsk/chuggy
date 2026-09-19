import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { ProjectChangeRetention } from "../../interpreter/projectChangeRetention.ts";
import { projectRowCounter } from "./rows.ts";

export function postgresProjectChangeRetention(
  pool: pg.Pool,
): ProjectChangeRetention {
  return {
    sweep: async (rowsMax) => {
      const found = await pool.query<{ removed: string | null }>(
        sql`SELECT sweep_project_change(${rowsMax}::bigint)::text AS removed`,
      );
      const removed = found.rows[0]?.removed ?? null;
      return removed === null
        ? 0
        : projectRowCounter(removed, "swept project changes");
    },
  };
}
