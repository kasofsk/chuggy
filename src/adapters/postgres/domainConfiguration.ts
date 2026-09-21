import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { Config } from "../../domain/config.ts";
import {
  runtimePreconditionAnswer,
  type RuntimePrecondition,
} from "../../interpreter/serviceRuntime.ts";

/**
 * Installs the deployment policy once and refuses a writer configured
 * differently. The conflicting update writes the row's own value back, so a
 * writer that lost the install waits for the one that won it and reads what it
 * wrote.
 *
 * THE COMPARISON IS SEMANTIC, NOT TEXTUAL. What two images have to agree on is
 * the configuration, not `JSON.stringify`'s key order and spacing, so the
 * stored row is compared as `jsonb`. A migration that rewrites the row and a
 * field reordered in `Config` both leave a matching deployment matching,
 * instead of refusing to start over a rendering difference.
 */
export function postgresDomainConfigurationPrecondition(
  pool: pg.Pool,
  domain: Config,
): RuntimePrecondition {
  const encoded = JSON.stringify(domain);
  return {
    name: "authoritative domain configuration",
    check: async () => {
      const found = await pool.query<{ matches: boolean | null }>(
        sql`INSERT INTO deployment_authoring_policy (singleton,domain_configuration)
          VALUES (true,${encoded})
          ON CONFLICT (singleton) DO UPDATE
            SET domain_configuration=deployment_authoring_policy.domain_configuration
          RETURNING domain_configuration::jsonb IS NOT DISTINCT FROM ${encoded}::jsonb AS matches`,
      );
      return runtimePreconditionAnswer(
        found.rows[0]?.matches === true,
        "the installed deployment authoring policy is not the one this image carries",
      );
    },
  };
}
