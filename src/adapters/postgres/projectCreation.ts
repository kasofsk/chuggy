/** PostgreSQL side of creating a project: the doors the API role executes to make a tenant and a project, to record that its grants were written, and to read and fill a name a deleted project vacated. */

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
    vacated: async (partition) => {
      const found = await pool.query<{ vacated: boolean | null }>(
        sql`SELECT project_vacated(${partition.tenant},${partition.project})::boolean AS vacated`,
      );
      return found.rows[0]?.vacated === true;
    },
    fillVacancy: async (partition) => {
      await pool.query<{ filled: string | null }>(
        sql`SELECT fill_project_vacancy(${partition.tenant},${partition.project})::text AS filled`,
      );
    },
  };
}
