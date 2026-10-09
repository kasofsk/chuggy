/**
 * PostgreSQL side of whether a project's executions may run on their owner's
 * personal runner: the project's own row, read by the API and written through
 * the door it is granted.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  asWorkerPoolOwnerFallback,
  type ProjectOwnerFallbackStore,
} from "../../interpreter/projectOwnerFallback.ts";
import { placementWriteOutcome } from "./executionPlacement.ts";

/** The API's read of one project's fallback and the door it writes it through. */
export function postgresProjectOwnerFallback(
  pool: pg.Pool,
): ProjectOwnerFallbackStore {
  return {
    fallback: async (partition) => {
      const found = await pool.query<{ fallback: string | null }>(
        sql`SELECT fallback FROM project_owner_fallback
             WHERE tenant=${partition.tenant} AND project=${partition.project}`,
      );
      const fallback = found.rows[0]?.fallback ?? null;
      return fallback === null
        ? undefined
        : asWorkerPoolOwnerFallback(fallback);
    },
    write: async (partition, fallback, authority) => {
      const found = await pool.query<{ outcome: string | null }>(
        sql`SELECT set_project_owner_fallback(
              ${partition.tenant},${partition.project},${fallback ?? null},
              ${authority.kind},${authority.subject})::text AS outcome`,
      );
      return placementWriteOutcome(found.rows[0]?.outcome);
    },
  };
}
