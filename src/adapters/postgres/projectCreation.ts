/** PostgreSQL side of creating a project: the one door the API role executes to make a tenant and a project. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allProjectCreationOutcomes,
  type ProjectCreationStore,
} from "../../interpreter/projectCreation.ts";

export function postgresProjectCreation(pool: pg.Pool): ProjectCreationStore {
  return {
    create: async (write) => {
      const found = await pool.query<{
        outcome: string | null;
        tenant_created: boolean | null;
      }>(
        sql`SELECT outcome, tenant_created FROM create_project(
          ${write.partition.tenant},${write.partition.project},${write.tenantNew},
          ${write.operation},${write.authority.kind},${write.authority.subject})`,
      );
      const row = found.rows[0];
      const outcome = allProjectCreationOutcomes.find(
        (known) => known === row?.outcome,
      );
      if (
        outcome === undefined ||
        row?.tenant_created === null ||
        row?.tenant_created === undefined
      )
        throw new Error(
          `project creation: unknown outcome ${String(row?.outcome)}`,
        );
      return { outcome, tenantCreated: row.tenant_created };
    },
  };
}
