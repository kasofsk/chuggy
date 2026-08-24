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
 * `Unavailable`. A legacy briefing-free revision has
 * `BriefingShapeMissing`; it also holds so an operator can replace it without
 * spending retry measure against immutable content. The scheduler retires
 * every other incompatibility and holds unavailable reads.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { PinnedConfigurationPort } from "../../interpreter/taskBriefing.ts";
import { pinnedTaskConfigurationReadiness } from "../../interpreter/taskBriefing.ts";
import { configurationRevisionDigest } from "./digest.ts";

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
      if (configurationRevisionDigest(row.canonical) !== row.digest)
        return { read: "Incompatible", fault: "DigestMismatch" };
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
      if (
        parsed.readiness === "Incomplete" &&
        parsed.fault === "BriefingShapeMissing"
      )
        return { read: "Unavailable" };
      return parsed.readiness === "Ready"
        ? { read: "Configuration", configuration: parsed.configuration }
        : { read: "Incompatible", fault: parsed.fault };
    },
  };
}
