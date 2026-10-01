/** PostgreSQL side of creating a project: the doors the API role executes to make a tenant and a project, and to record that its grants were written. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asOperationId } from "../../interpreter/operationInbox.ts";
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
        operation: string | null;
      }>(
        sql`SELECT outcome, tenant_created, grants_written, operation FROM create_project(
          ${write.partition.tenant},${write.partition.project},${write.standing},
          ${write.reserved},${write.operation},${write.authority.kind},
          ${write.authority.subject})`,
      );
      const row = found.rows[0];
      const outcome = allProjectCreationOutcomes.find(
        (known) => known === row?.outcome,
      );
      if (
        outcome === undefined ||
        typeof row?.tenant_created !== "boolean" ||
        typeof row.grants_written !== "boolean" ||
        typeof row.operation !== "string"
      )
        throw new Error(
          `project creation: unknown outcome ${String(row?.outcome)}`,
        );
      return {
        outcome,
        tenantCreated: row.tenant_created,
        grantsWritten: row.grants_written,
        operation: asOperationId(row.operation),
      };
    },
    recordGrants: async (operation) => {
      await pool.query<{ recorded: string | null }>(
        sql`SELECT record_project_creation_grants(${operation})::text AS recorded`,
      );
    },
  };
}
