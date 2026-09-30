/** PostgreSQL side of creating a project: the doors the API role executes to make a tenant and a project, and to record that its grants were written. */

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
        grants_written: boolean | null;
      }>(
        sql`SELECT outcome, tenant_created, grants_written FROM create_project(
          ${write.partition.tenant},${write.partition.project},${write.tenantNew},
          ${write.operation},${write.authority.kind},${write.authority.subject})`,
      );
      const row = found.rows[0];
      const outcome = allProjectCreationOutcomes.find(
        (known) => known === row?.outcome,
      );
      if (
        outcome === undefined ||
        typeof row?.tenant_created !== "boolean" ||
        typeof row.grants_written !== "boolean"
      )
        throw new Error(
          `project creation: unknown outcome ${String(row?.outcome)}`,
        );
      return {
        outcome,
        tenantCreated: row.tenant_created,
        grantsWritten: row.grants_written,
      };
    },
    recordGrants: async (operation) => {
      await pool.query<{ recorded: string | null }>(
        sql`SELECT record_project_creation_grants(${operation})::text AS recorded`,
      );
    },
  };
}
