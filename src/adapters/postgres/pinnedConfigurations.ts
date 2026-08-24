/**
 * Reads immutable authored task configurations with the scheduler's read-only
 * authority. Migrations 012 and 019 grant that role `SELECT` on
 * `configuration_revision` after revoking its broad table privileges because
 * registration already resolves execution requirements from the same
 * immutable document. This adapter uses that existing boundary and selects
 * only the canonical content and digest needed by `PinnedConfigurationPort`;
 * it does not grant access to drafts or any authoring write.
 *
 * ABSENCE, INCOMPATIBILITY AND OUTAGE ARE DIFFERENT RESULTS. No row is the
 * definitive `Missing`; a row whose canonical document cannot satisfy the
 * briefing contract is `Incompatible`; and only a failed database read is
 * `Unavailable`. The scheduler retires the first two and holds the last.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { PinnedConfigurationPort } from "../../interpreter/taskBriefing.ts";
import { pinnedTaskConfigurationReadiness } from "../../interpreter/taskBriefing.ts";

/** Answers the exact revision a scheduler pass pinned, without a mutable-current read. */
export function postgresPinnedConfigurations(
  pool: pg.Pool,
): PinnedConfigurationPort {
  return {
    configuration: async (partition, pin) => {
      let found: pg.QueryResult<{ canonical: string; digest: string }>;
      try {
        found = await pool.query<{ canonical: string; digest: string }>(
          sql`SELECT canonical,digest FROM configuration_revision
            WHERE tenant=${partition.tenant} AND project=${partition.project}
              AND revision=${pin.configurationRevision}`,
        );
      } catch {
        return { read: "Unavailable" };
      }
      const row = found.rows[0];
      if (row === undefined) return { read: "Missing" };
      let document: unknown;
      try {
        document = JSON.parse(row.canonical);
      } catch {
        return { read: "Incompatible", fault: "ConfigurationUnreadable" };
      }
      const parsed = pinnedTaskConfigurationReadiness(document, {
        configurationRevision: pin.configurationRevision,
        configurationDigest: row.digest,
      });
      return parsed.readiness === "Ready"
        ? { read: "Configuration", configuration: parsed.configuration }
        : { read: "Incompatible", fault: parsed.fault };
    },
  };
}
