/**
 * PostgreSQL side of provisioning a partition: the row every other door in
 * this adapter presupposes, and the privilege that writes it.
 *
 * IT IS A TABLE WRITE RATHER THAN A DOOR, which is the one place this adapter
 * departs from the shape around it. Every other administrative act goes
 * through a SECURITY DEFINER function so a runtime role can be granted EXECUTE
 * on the act without SELECT on the relation. Provisioning is granted to
 * nobody, so there is no role to hold such a grant and no door to declare — the
 * identity that owns the boundary writes the row directly, and `writer` below
 * reports the INSERT privilege rather than an EXECUTE one for that reason.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type {
  Partition,
  ProjectProvisioning,
} from "../../interpreter/projectStore.ts";

import {
  postgresOwnershipCreate,
  postgresOwnershipStanding,
} from "./ownership.ts";

export function postgresProjectProvisioning(
  pool: pg.Pool,
): ProjectProvisioning {
  return {
    writer: async () => {
      const found = await pool.query<{
        writer_role: string | null;
        can_insert: boolean | null;
      }>(
        sql`SELECT current_user::text AS writer_role,
          has_table_privilege(current_user,'project','INSERT')::boolean
            AS can_insert`,
      );
      const row = found.rows[0];
      if (row?.writer_role === undefined || row.writer_role === null)
        throw new Error(
          "project provisioning: the server named no current role",
        );
      return { role: row.writer_role, canInsert: row.can_insert === true };
    },
    standing: (partition: Partition) =>
      postgresOwnershipStanding(pool, partition),
    create: (partition: Partition) => postgresOwnershipCreate(pool, partition),
  };
}
