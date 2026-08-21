import type pg from "pg";

import type { ProjectInventoryStore } from "../../interpreter/projectInventory.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";

export function postgresProjectInventory(pool: pg.Pool): ProjectInventoryStore {
  return {
    projects: async (after, limit) => {
      const found = await pool.query<{ tenant: string; project: string }>(
        `SELECT tenant,project FROM project
          WHERE lifecycle <> 'Retention' AND (tenant,project)>($1,$2)
          ORDER BY tenant,project LIMIT $3`,
        [after?.tenant ?? "", after?.project ?? "", limit],
      );
      return found.rows.map((row) => ({
        tenant: asTenantId(row.tenant),
        project: asProjectId(row.project),
      }));
    },
  };
}
