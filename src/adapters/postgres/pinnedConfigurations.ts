/**
 * Reads immutable authored task configurations with the scheduler's read-only
 * authority. Migrations 012 and 019 grant that role `SELECT` on
 * `configuration_revision` after revoking its broad table privileges because
 * registration already resolves execution requirements from the same
 * immutable document. This adapter uses that existing boundary and selects
 * only the canonical content and digest needed by `PinnedConfigurationPort`,
 * and the overrides the ticket holds beside its definition — the ones its
 * last release or update stored, or ones an escalation took since — which the
 * same role reads; it does not grant access to drafts or
 * any authoring write. What it answers is the revision with those applied,
 * or, for a catalog, the one workload the task runs under the selection the
 * ticket's release stored beside them.
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
import { declaredConfigurationVersion } from "../../interpreter/authoring.ts";
import type {
  ConfigurationRead,
  PinnedConfigurationPort,
  PinnedConfigurationTask,
} from "../../interpreter/taskBriefing.ts";
import { pinnedTaskConfigurationReadiness } from "../../interpreter/taskBriefing.ts";
import {
  pinnedWorkloadTask,
  workloadTaskPositionOf,
} from "../../interpreter/workloadTask.ts";
import { configurationRevisionDigest } from "../../interpreter/configurationDigest.ts";
import { storedOverridesOf, storedSelectionOf } from "./ticketBrief.ts";

/** One pinned revision, with the overrides and the selection its ticket holds. */
interface PinnedConfigurationRow {
  readonly canonical: string;
  readonly digest: string;
  readonly overrides: string | null;
  readonly selection: string | null;
}

/** The one workload a catalog's task runs, or the fault of a catalog that names none for it. */
function postgresPinnedWorkloadTask(
  document: unknown,
  row: PinnedConfigurationRow,
  task: PinnedConfigurationTask,
): ConfigurationRead {
  const pin = {
    configurationRevision: task.configurationRevision,
    configurationDigest: row.digest,
  };
  const position = workloadTaskPositionOf(
    task.taskKind,
    task.stage,
    task.evaluator,
  );
  const pinned =
    position === undefined
      ? undefined
      : pinnedWorkloadTask(
          document,
          pin,
          storedOverridesOf(row.overrides),
          storedSelectionOf(row.selection),
          position,
        );
  return pinned === undefined
    ? { read: "Incompatible", fault: "WorkloadUnselected" }
    : { read: "Configuration", configuration: pinned };
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
          sql`SELECT c.canonical,c.digest,d.overrides::text AS overrides,
                 d.selection::text AS selection
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
        if (declaredConfigurationVersion(JSON.parse(row.canonical)) === 2)
          return postgresPinnedWorkloadTask(
            JSON.parse(row.canonical),
            row,
            pin,
          );
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
