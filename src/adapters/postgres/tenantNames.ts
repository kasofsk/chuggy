/**
 * Each tenant's display name, as the access plane reads and changes it on the
 * tenant's own row.
 *
 * A RENAME IS ONE UPSERT, so a tenant with no row yet is given one carrying the
 * name, and two renames racing are separated by the row: the later commit's
 * name is the one kept, and neither can move any other column.
 */
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { AccessTenantNameStore } from "../../interpreter/accessTenantNames.ts";
import { asTenantId, type TenantId } from "../../interpreter/projectStore.ts";

export function postgresTenantNames(pool: pg.Pool): AccessTenantNameStore {
  return {
    named: async (tenants) => {
      const found = await pool.query<{ tenant: string; display_name: string }>(
        sql`SELECT t.tenant,t.display_name FROM tenant t
        WHERE t.tenant=ANY(${[...tenants]}::text[])`,
      );
      return new Map<TenantId, string>(
        found.rows.map((row) => [asTenantId(row.tenant), row.display_name]),
      );
    },
    renamed: async (tenant, displayName) => {
      await pool.query(sql`INSERT INTO tenant AS t (tenant,display_name)
        VALUES (${tenant},${displayName})
        ON CONFLICT (tenant) DO UPDATE SET display_name=EXCLUDED.display_name`);
    },
  };
}
