/** PostgreSQL side of deleting a project that never ran work and a tenant that holds no project: the doors the API role executes, and what each says holds its subject. */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  projectDeletionHoldings,
  tenantDeletionHoldings,
} from "../../contract/responses.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  unrunDeletionHoldings,
  type ProjectDeletionStore,
  type TenantDeletionStore,
  type UnrunDeletionStored,
} from "../../interpreter/unrunDeletion.ts";

/** A door's row, narrowed to the outcomes `absent` admits beside a deletion and a holding. */
function unrunDeletionStored<Holding extends string, Absent extends string>(
  known: readonly Holding[],
  absent: readonly Absent[],
  row: { outcome: string | null; held: string[] | null } | undefined,
): UnrunDeletionStored<Holding, Absent> {
  const outcome = row?.outcome;
  if (outcome === "Deleted") return { outcome };
  if (outcome === "Held")
    return { outcome, held: unrunDeletionHoldings(known, row?.held ?? []) };
  const named = absent.find((candidate) => candidate === outcome);
  if (named !== undefined) return { outcome: named };
  throw new Error(`deletion: unknown outcome ${String(outcome)}`);
}

export function postgresProjectDeletion(pool: pg.Pool): ProjectDeletionStore {
  return {
    holds: async (partition: Partition) => {
      const found = await pool.query<{ held: string[] | null }>(
        sql`SELECT project_deletion_holds(${partition.tenant},${partition.project})::text[] AS held`,
      );
      const held = found.rows[0]?.held ?? null;
      return held === null
        ? undefined
        : unrunDeletionHoldings(projectDeletionHoldings, held);
    },
    delete: async (partition: Partition) => {
      const found = await pool.query<{
        outcome: string | null;
        held: string[] | null;
      }>(
        sql`SELECT outcome, held FROM delete_unrun_project(${partition.tenant},${partition.project})`,
      );
      return unrunDeletionStored(
        projectDeletionHoldings,
        ["NotFound"],
        found.rows[0],
      );
    },
  };
}

export function postgresTenantDeletion(pool: pg.Pool): TenantDeletionStore {
  return {
    holds: async (tenant) => {
      const found = await pool.query<{ held: string[] | null }>(
        sql`SELECT tenant_deletion_holds(${tenant})::text[] AS held`,
      );
      return unrunDeletionHoldings(
        tenantDeletionHoldings,
        found.rows[0]?.held ?? [],
      );
    },
    delete: async (tenant) => {
      const found = await pool.query<{
        outcome: string | null;
        held: string[] | null;
      }>(sql`SELECT outcome, held FROM delete_unrun_tenant(${tenant})`);
      return unrunDeletionStored(tenantDeletionHoldings, [], found.rows[0]);
    },
  };
}
