import type pg from "pg";
import { sql } from "@ts-safeql/sql-tag";

import type { ProjectInventoryStore } from "../../interpreter/projectInventory.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";

export function postgresProjectInventory(pool: pg.Pool): ProjectInventoryStore {
  return {
    projects: async (after, limit) => {
      const found = await pool.query<{ tenant: string; project: string }>(
        sql`SELECT tenant,project FROM project
          WHERE lifecycle <> 'Retention'
            AND (tenant,project)>(${after?.tenant ?? ""},${after?.project ?? ""})
          ORDER BY tenant,project LIMIT ${limit}`,
      );
      return found.rows.map((row) => ({
        tenant: asTenantId(row.tenant),
        project: asProjectId(row.project),
      }));
    },
  };
}
