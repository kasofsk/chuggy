import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { schemaCompatibilityPrecondition } from "../../interpreter/serviceRuntime.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "./runtimeSchema.ts";
import { selectorReviewRole } from "./schema.ts";

/**
 * Whether the selector-context reader connects as its role, may read review
 * feedback, and carries a schema this image accepts. A database without that
 * table answers no rather than raising, so a raise is a database this could
 * not reach or query.
 */
export async function postgresSelectorContextReady(
  pool: pg.Pool,
): Promise<boolean> {
  const found = await pool.query<{
    current_role: string;
    review_feedback_readable: boolean;
  }>(
    sql`SELECT COALESCE(current_user::text,'') AS current_role,
       COALESCE(has_table_privilege(
         current_user,to_regclass('selector_proposal_review'),'SELECT'),false)
         AS review_feedback_readable`,
  );
  const row = found.rows[0];
  if (row?.current_role !== selectorReviewRole || !row.review_feedback_readable)
    return false;
  return (
    (
      await schemaCompatibilityPrecondition(
        postgresRuntimeSchema(pool),
        currentRuntimeSchemaContract,
      ).check(new AbortController().signal)
    ).met === "Met"
  );
}
