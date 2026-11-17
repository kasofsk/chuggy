import type pg from "pg";
import { sql } from "@ts-safeql/sql-tag";

import type { MemberChatProjectStore } from "../../interpreter/memberChat.ts";
import type { ProjectInventoryStore } from "../../interpreter/projectInventory.ts";
import { asProjectArtifactId } from "../../interpreter/finalizerPreparation.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import { projectRowLifecycle } from "./rows.ts";

export function postgresProjectInventory(pool: pg.Pool): ProjectInventoryStore {
  return {
    projects: async (after, limit) => {
      const found = await pool.query<{
        tenant: string;
        project: string;
        name: string;
        icon: string | null;
      }>(
        sql`SELECT p.tenant,p.project,coalesce(p.name,p.project) AS name,
                   i.artifact AS icon
              FROM project p
              LEFT JOIN project_image i
                ON i.tenant=p.tenant AND i.project=p.project AND i.role='icon'
          WHERE p.lifecycle <> 'Retention'
            AND (p.tenant,p.project)>(${after?.tenant ?? ""},${after?.project ?? ""})
          ORDER BY p.tenant,p.project LIMIT ${limit}`,
      );
      return found.rows.map((row) => ({
        tenant: asTenantId(row.tenant),
        project: asProjectId(row.project),
        name: row.name,
        ...(row.icon === null ? {} : { icon: asProjectArtifactId(row.icon) }),
      }));
    },
  };
}

/** One tenant's projects for a member's own chat, in identity order and none in retention, as the inventory skips them. */
export function postgresMemberChatProjects(
  pool: pg.Pool,
): MemberChatProjectStore {
  return {
    projects: async (tenant, after, limit) => {
      const found = await pool.query<{ project: string; lifecycle: string }>(
        sql`SELECT project,lifecycle FROM project
          WHERE tenant=${tenant} AND lifecycle <> 'Retention'
            AND project>${after ?? ""}
          ORDER BY project LIMIT ${limit}`,
      );
      return found.rows.map((row) => ({
        project: asProjectId(row.project),
        lifecycle: projectRowLifecycle(row.lifecycle),
      }));
    },
  };
}
