import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { Config } from "../../domain/config.ts";
import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";

/** Installs the deployment policy once and refuses a writer configured differently. */
export function postgresDomainConfigurationPrecondition(
  pool: pg.Pool,
  domain: Config,
): RuntimePrecondition {
  const encoded = JSON.stringify(domain);
  return {
    name: "authoritative domain configuration",
    check: async () => {
      const found = await pool.query<{ matches: boolean }>(
        sql`WITH installed AS (
          INSERT INTO deployment_authoring_policy (singleton,domain_configuration)
          VALUES (true,${encoded}) ON CONFLICT (singleton) DO NOTHING
          RETURNING domain_configuration
        )
        SELECT domain_configuration=${encoded} AS matches FROM installed
        UNION ALL
        SELECT domain_configuration=${encoded} AS matches FROM deployment_authoring_policy
         WHERE singleton=true AND NOT EXISTS (SELECT 1 FROM installed)`,
      );
      return found.rows[0]?.matches === true;
    },
  };
}
