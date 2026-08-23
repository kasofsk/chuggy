import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { schemaCompatibilityPrecondition } from "../../interpreter/serviceRuntime.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "./runtimeSchema.ts";
import { selectorReviewRole } from "./schema.ts";

/** Verifies the selector-context reader's role, grant, connection and schema. */
export async function postgresSelectorContextReady(
  pool: pg.Pool,
): Promise<boolean> {
  try {
    const found = await pool.query<{
      current_role: string;
      review_feedback_readable: boolean;
    }>(
      sql`SELECT COALESCE(current_user::text,'') AS current_role,
         COALESCE(has_table_privilege(current_user,'selector_proposal_review','SELECT'),false)
           AS review_feedback_readable`,
    );
    const row = found.rows[0];
    if (
      row?.current_role !== selectorReviewRole ||
      !row.review_feedback_readable
    )
      return false;
    return schemaCompatibilityPrecondition(
      postgresRuntimeSchema(pool),
      currentRuntimeSchemaContract,
    ).check(new AbortController().signal);
  } catch {
    return false;
  }
}
