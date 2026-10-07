/**
 * Reads immutable authored task configurations with the scheduler's read-only
 * authority. Migrations 012 and 019 grant that role `SELECT` on
 * `configuration_revision` after revoking its broad table privileges because
 * registration already resolves execution requirements from the same
 * immutable document. This adapter uses that existing boundary and selects
 * only the canonical content and digest needed by `PinnedConfigurationPort`,
 * and the overrides the ticket's last release or update stored beside its
 * definition, which the same role reads; it does not grant access to drafts or
 * any authoring write. What it answers is the revision with those applied.
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

import { configurationWithOverrides } from "../../contract/configurationOverrides.ts";
import type { PinnedConfigurationPort } from "../../interpreter/taskBriefing.ts";
import { pinnedTaskConfigurationReadiness } from "../../interpreter/taskBriefing.ts";
import { configurationRevisionDigest } from "./digest.ts";
import { storedOverridesOf } from "./ticketBrief.ts";

/** One pinned revision, with the overrides its ticket was last released under. */
interface PinnedConfigurationRow {
  readonly canonical: string;
  readonly digest: string;
  readonly overrides: string | null;
}

/** Answers the exact revision a scheduler pass pinned, without a mutable-current read. */
export function postgresPinnedConfigurations(
  pool: pg.Pool,
): PinnedConfigurationPort {
  return {
    configuration: async (partition, pin) => {
      let found: pg.QueryResult<PinnedConfigurationRow>;
      try {
        found = await pool.query<PinnedConfigurationRow>(
          sql`SELECT c.canonical,c.digest,d.overrides::text AS overrides
            FROM configuration_revision c
            LEFT JOIN ticket_definition d
              ON d.tenant=c.tenant AND d.project=c.project AND d.ticket=${pin.ticket}
            WHERE c.tenant=${partition.tenant} AND c.project=${partition.project}
              AND c.revision=${pin.configurationRevision}`,
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
        document = configurationWithOverrides(
          JSON.parse(row.canonical),
          storedOverridesOf(row.overrides),
        );
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
