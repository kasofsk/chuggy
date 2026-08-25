import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asInstallationId } from "../../domain/ids.ts";
import type { InstallationAuthorityRead } from "../../interpreter/installationAuthority.ts";

/** Reads the singleton authority generated when this journal was initialized. */
export function postgresInstallationAuthority(
  pool: pg.Pool,
): InstallationAuthorityRead {
  return {
    installationAuthority: async () => {
      const found = await pool.query<{ installation_id: string }>(
        sql`SELECT installation_id FROM installation_authority WHERE singleton = true`,
      );
      const identity = found.rows[0]?.installation_id;
      if (identity === undefined || found.rows.length !== 1)
        throw new Error("installation authority is absent");
      return asInstallationId(identity);
    },
  };
}
