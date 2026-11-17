/**
 * A project's thread settings as PostgreSQL holds them: the four thread
 * columns of `selector_project_settings`, their history, and the one door
 * that writes both.
 */

import type pg from "pg";
import { sql } from "@ts-safeql/sql-tag";

import { sessionEfforts } from "../../contract/http.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  type Authority,
} from "../../interpreter/operationInbox.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  selectorEffectiveSettings,
  type SelectorProjectOverrides,
  type SelectorProjectSettingsRecord,
  type SelectorProjectSettingsRevision,
  type SelectorProjectSettingsStanding,
  type SelectorProjectSettingsStore,
  type SelectorProjectSettingsWriteOutcome,
} from "../../interpreter/selectorProjectSettings.ts";
import { projectRowCounter } from "./rows.ts";
import { sessionRowMember } from "./sessionRows.ts";

/** The thread columns, each NULL being a field the project leaves at its default. */
interface SelectorProjectSettingsOverrideRow {
  readonly north_star: string | null;
  readonly thread_standing_rules: string | null;
  readonly thread_model: string | null;
  readonly thread_effort: string | null;
}

/**
 * The row the write door answers. Every column a set-returning function
 * declares is nullable to the server, whatever the table beneath it requires,
 * so the revision is narrowed rather than assumed.
 */
interface SelectorProjectSettingsWriteRow extends SelectorProjectSettingsOverrideRow {
  readonly revision: string | null;
}

/** Reads the thread columns into the overrides they stand for. */
function selectorProjectSettingsOverridesOf(
  row: SelectorProjectSettingsOverrideRow,
): SelectorProjectOverrides {
  return {
    ...(row.north_star === null ? {} : { northStar: row.north_star }),
    ...(row.thread_standing_rules === null
      ? {}
      : { threadStandingRules: row.thread_standing_rules }),
    ...(row.thread_model === null ? {} : { threadModel: row.thread_model }),
    ...(row.thread_effort === null
      ? {}
      : {
          threadEffort: sessionRowMember(
            sessionEfforts,
            row.thread_effort,
            "selector threadEffort",
          ),
        }),
  };
}

/** The record one revision and its thread columns stand for. */
function selectorProjectSettingsRecordOf(
  partition: Partition,
  revision: number,
  overrides: SelectorProjectOverrides,
): SelectorProjectSettingsRecord {
  return {
    partition,
    revision,
    overrides,
    effective: selectorEffectiveSettings(overrides),
  };
}

/**
 * One project's thread columns with the history row of the revision standing
 * joined to it, so a caller that lost the fence is told whose write it lost to
 * without a second round trip. A project with no row has overridden nothing
 * and is revision zero, which is the revision its first write expects.
 */
async function selectorProjectSettingsRead(
  pool: pg.Pool,
  partition: Partition,
): Promise<SelectorProjectSettingsStanding> {
  const found = await pool.query<
    SelectorProjectSettingsOverrideRow & {
      readonly revision: string;
      readonly administrator_kind: string | null;
      readonly administrator_subject: string | null;
      readonly recorded_at: Date | null;
    }
  >(
    sql`SELECT settings.revision::text,settings.north_star,
         settings.thread_standing_rules,settings.thread_model,
         settings.thread_effort,
         moved.administrator_kind,moved.administrator_subject,moved.recorded_at
       FROM selector_project_settings settings
       LEFT JOIN selector_project_settings_history moved
         ON moved.tenant=settings.tenant
        AND moved.project=settings.project
        AND moved.revision=settings.revision
      WHERE settings.tenant=${partition.tenant}
        AND settings.project=${partition.project}`,
  );
  const row = found.rows[0];
  if (row === undefined)
    return { settings: selectorProjectSettingsRecordOf(partition, 0, {}) };
  return {
    settings: selectorProjectSettingsRecordOf(
      partition,
      projectRowCounter(row.revision, "selector project settings revision"),
      selectorProjectSettingsOverridesOf(row),
    ),
    ...(row.administrator_kind === null ||
    row.administrator_subject === null ||
    row.recorded_at === null
      ? {}
      : {
          movedBy: {
            administrator: {
              kind: asAuthorityKind(row.administrator_kind),
              subject: asAuthoritySubject(row.administrator_subject),
            },
            recordedAt: row.recorded_at.toISOString(),
          },
        }),
  };
}

/** The SQLSTATE a server refused under, for the refusals that are conditions. */
function selectorProjectSettingsFailureCode(
  failure: unknown,
): string | undefined {
  if (typeof failure !== "object" || failure === null) return undefined;
  const code = (failure as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The SQLSTATEs a write did not complete under. `query_canceled` is every
 * cancellation a statement can meet, its deadline included, and
 * `deadlock_detected` is the cycle a server broke to let one of its writes
 * through; neither says whose lock was in the way, and both leave a write that
 * can be made again.
 */
const selectorProjectSettingsIncompleteCodes: readonly string[] = [
  "57014",
  "40P01",
];

/**
 * Writes one project's whole override set and answers with the row that write
 * produced, in a single statement so the answer is that write's own and not a
 * later state of the table.
 */
async function selectorProjectSettingsWrite(
  pool: pg.Pool,
  partition: Partition,
  expectedRevision: number,
  overrides: SelectorProjectOverrides,
  administrator: Authority,
): Promise<SelectorProjectSettingsWriteOutcome> {
  let found;
  try {
    found = await pool.query<SelectorProjectSettingsWriteRow>(
      sql`SELECT revision::text,north_star,thread_standing_rules,
           thread_model,thread_effort
         FROM update_selector_project_thread_settings(
           ${partition.tenant},${partition.project},${expectedRevision},
           ${overrides.northStar ?? null},
           ${overrides.threadStandingRules ?? null},
           ${overrides.threadModel ?? null},${overrides.threadEffort ?? null},
           ${administrator.kind},${administrator.subject})`,
    );
  } catch (failure) {
    const code = selectorProjectSettingsFailureCode(failure);
    if (
      code !== undefined &&
      selectorProjectSettingsIncompleteCodes.includes(code)
    )
      return { written: "Refused", refusal: "SettingsWriteContended" };
    throw failure;
  }
  const row = found.rows[0];
  if (row === undefined) return { written: "FenceMoved" };
  if (row.revision === null)
    throw new Error("selector settings write answered no revision");
  return {
    written: "Settings",
    settings: selectorProjectSettingsRecordOf(
      partition,
      projectRowCounter(row.revision, "selector project settings revision"),
      selectorProjectSettingsOverridesOf(row),
    ),
  };
}

async function selectorProjectSettingsHistory(
  pool: pg.Pool,
  partition: Partition,
  beforeRevision: number | undefined,
  limit: number,
): Promise<readonly SelectorProjectSettingsRevision[]> {
  const found = await pool.query<
    SelectorProjectSettingsOverrideRow & {
      readonly revision: string;
      readonly administrator_kind: string;
      readonly administrator_subject: string;
      readonly recorded_at: Date;
    }
  >(
    sql`SELECT history.revision::text,history.north_star,
         history.thread_standing_rules,
         history.thread_model,history.thread_effort,
         history.administrator_kind,history.administrator_subject,
         history.recorded_at
       FROM selector_project_settings_history history
      WHERE history.tenant=${partition.tenant}
        AND history.project=${partition.project}
        AND (${beforeRevision ?? null}::bigint IS NULL
             OR history.revision<${beforeRevision ?? null})
      ORDER BY history.revision DESC LIMIT ${limit}`,
  );
  return found.rows.map((row) => ({
    revision: projectRowCounter(
      row.revision,
      "selector project settings revision",
    ),
    overrides: selectorProjectSettingsOverridesOf(row),
    administrator: {
      kind: asAuthorityKind(row.administrator_kind),
      subject: asAuthoritySubject(row.administrator_subject),
    },
    recordedAt: row.recorded_at.toISOString(),
  }));
}

/** The per-project settings the API administers under a project's own membership. */
export function postgresSelectorProjectSettings(
  pool: pg.Pool,
): SelectorProjectSettingsStore {
  return {
    read: (partition) => selectorProjectSettingsRead(pool, partition),
    write: (partition, expectedRevision, overrides, administrator) =>
      selectorProjectSettingsWrite(
        pool,
        partition,
        expectedRevision,
        overrides,
        administrator,
      ),
    history: (partition, beforeRevision, limit) =>
      selectorProjectSettingsHistory(pool, partition, beforeRevision, limit),
  };
}
