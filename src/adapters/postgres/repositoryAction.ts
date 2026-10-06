/**
 * PostgreSQL store of what each bound repository's newest imported head
 * declares under its action directory.
 *
 * ONE STATEMENT IS THE IMPORT. The door replaces a repository's set and
 * decides its own refusals, so there is no transaction here to open and no
 * outcome to assemble from several calls.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { RepositoryActionStore } from "../../interpreter/repositoryAction.ts";

export function postgresRepositoryActions(
  pool: pg.Pool,
): RepositoryActionStore {
  return {
    importRepositoryActions: async ({ binding, commit, declarations }) => {
      const { tenant, project } = binding.partition;
      const actions = declarations.map((declaration) => declaration.action);
      const names = declarations.map((declaration) => declaration.name);
      const imported = await pool.query<{ result: string | null }>(
        sql`SELECT import_repository_actions(${tenant},${project},${binding.repository},${binding.recoveryEpoch},${commit},${actions}::text[],${names}::text[])::text AS result`,
      );
      const result = imported.rows[0]?.result;
      if (
        result !== "Imported" &&
        result !== "IdentityConflict" &&
        result !== "StaleBinding"
      )
        throw new Error(`repository action import returned ${String(result)}`);
      return { imported: result };
    },
  };
}
