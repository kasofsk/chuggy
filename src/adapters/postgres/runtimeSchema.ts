import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { RuntimeSchemaVersionSource } from "../../interpreter/serviceRuntime.ts";
import type {
  RuntimeSchemaContract,
  RuntimeSchemaMigration,
} from "../../interpreter/serviceRuntime.ts";
import { migrations } from "./schema.ts";

const declaredMigrations: readonly RuntimeSchemaMigration[] = migrations.map(
  ({ version, name }) => ({ version, name }),
);

/** The schema this source revision requires and understands without migration. */
export const currentRuntimeSchemaContract: RuntimeSchemaContract = {
  required: declaredMigrations.slice(0, -1),
  compatible: declaredMigrations,
};

/** Declares the exact required prefix and any staged additions this image understands. */
export function runtimeSchemaContract(
  required: readonly RuntimeSchemaMigration[],
  compatible: readonly RuntimeSchemaMigration[] = required,
): RuntimeSchemaContract {
  return { required, compatible };
}

/** Reads the migration ledger without applying it; process readiness never migrates. */
export function postgresRuntimeSchema(
  pool: pg.Pool,
): RuntimeSchemaVersionSource {
  return {
    applied: async (signal) => {
      signal.throwIfAborted();
      const found = await pool.query<{ version: number; name: string }>(
        sql`SELECT version,name FROM schema_migration ORDER BY version`,
      );
      signal.throwIfAborted();
      return found.rows;
    },
  };
}
