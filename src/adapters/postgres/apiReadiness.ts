import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { schemaCompatibilityPrecondition } from "../../interpreter/serviceRuntime.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "./runtimeSchema.ts";
import { apiRole, projectThreadsReadFunction } from "./schema.ts";

/** The routine whose grant stands for the API role's, in the form `to_regprocedure` resolves. */
const apiReadinessRoutine = `${projectThreadsReadFunction}(text,text,text,bigint)`;

/**
 * Whether the API pool connects as its role, may execute the thread read, and
 * carries a schema this image accepts. A database without that routine answers
 * no rather than raising, so a raise is a database this could not reach or query.
 */
export async function postgresApiReady(pool: pg.Pool): Promise<boolean> {
  const found = await pool.query<{
    current_role: string;
    authorized: boolean;
  }>(
    sql`SELECT COALESCE(current_user::text,'') AS current_role,
       COALESCE(has_function_privilege(
         current_user,to_regprocedure(${apiReadinessRoutine}),'EXECUTE'),false)
         AS authorized`,
  );
  const row = found.rows[0];
  if (row?.current_role !== apiRole || !row.authorized) return false;
  return (
    (
      await schemaCompatibilityPrecondition(
        postgresRuntimeSchema(pool),
        currentRuntimeSchemaContract,
      ).check(new AbortController().signal)
    ).met === "Met"
  );
}
