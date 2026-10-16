/**
 * PostgreSQL side of what a ticket's dependencies delivered: the accepted
 * result a dispatch pins for each, read by the ticket service, and the pins
 * read back by the scheduler for every briefing of the ticket.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asTicketId, type TicketId } from "../../domain/ids.ts";
import type {
  DependencyPinned,
  DependencyPinnedPort,
  DependencyPinnedRead,
  DependencyPinnedResult,
  DependencyResult,
  DependencyResultPort,
} from "../../interpreter/dependencyDelivery.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../interpreter/finalizer.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  asResultManifestId,
  digestFoldHexChars,
  digestFoldPrefix,
} from "../../interpreter/resultManifest.ts";

interface DependencyResultRow {
  readonly manifest: string;
  readonly repository: string | null;
  readonly commit: string | null;
  readonly ref: string | null;
}

/** One row's source, which is whole or absent: a result that changed nothing names none of it. */
function dependencyResultOf(row: DependencyResultRow): DependencyResult {
  const manifest = asResultManifestId(row.manifest);
  if (row.repository === null && row.commit === null && row.ref === null)
    return { manifest };
  if (row.repository === null || row.commit === null || row.ref === null)
    throw new Error("dependency delivery: a result's source is half read");
  return {
    manifest,
    repository: asRepositoryId(row.repository),
    commit: asGitObjectId(row.commit),
    ref: asGitRefName(row.ref),
  };
}

/**
 * Finds a dependency's passing work result by the prefix every digest folding
 * to the journal's reference begins with, and reads one past it, so two rows
 * the one reference could name are refused rather than one of them chosen.
 */
export function postgresDependencyResults(pool: pg.Pool): DependencyResultPort {
  return {
    accepted: async (
      partition: Partition,
      dependency: TicketId,
      result: number,
    ): Promise<DependencyResult | undefined> => {
      const prefix = digestFoldPrefix(result);
      const found = await pool.query<DependencyResultRow>(
        sql`SELECT w.manifest, s.repository, s.commit, s.ref
              FROM execution e
              JOIN execution_request_task t
                ON t.tenant=e.tenant AND t.project=e.project
               AND t.request=e.source_request AND t.task=e.task
              JOIN execution_result w
                ON w.tenant=e.tenant AND w.project=e.project
               AND w.manifest=e.result_manifest
              LEFT JOIN execution_result_source s
                ON s.tenant=w.tenant AND s.project=w.project
               AND s.manifest=w.manifest
             WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
               AND e.ticket=${dependency} AND t.kind='Work' AND w.verdict='Pass'
               AND substr(w.digest,1,${digestFoldHexChars})=${prefix}
             ORDER BY w.manifest
             LIMIT 2`,
      );
      if (found.rows.length > 1)
        throw new Error(
          "dependency delivery: one accepted reference names two results",
        );
      const row = found.rows[0];
      return row === undefined ? undefined : dependencyResultOf(row);
    },
  };
}

interface DependencyPinnedRow {
  readonly reference_kind: string;
  readonly reference_id: string;
  readonly dependency: string | null;
  readonly repository: string | null;
  readonly commit: string | null;
  readonly ref: string | null;
  readonly report: string | null;
  readonly own_target: boolean;
}

/** The one reference of `kind` a dispatch bundle pins, or nothing where it pins none. */
function dependencyPinnedSingle(
  rows: readonly DependencyPinnedRow[],
  kind: string,
): DependencyPinnedRow | undefined {
  const named = rows.filter((row) => row.reference_kind === kind);
  if (named.length > 1)
    throw new Error(`dependency delivery: a dispatch pins two of ${kind}`);
  return named[0];
}

function dependencyPinnedResultOf(
  row: DependencyPinnedRow,
): DependencyPinnedResult {
  if (row.dependency === null)
    throw new Error(
      "dependency delivery: a pinned result is no execution's own",
    );
  return {
    dependency: asTicketId(Number(row.dependency)),
    ...dependencyResultOf({
      manifest: row.reference_id,
      repository: row.repository,
      commit: row.commit,
      ref: row.ref,
    }),
    ...(row.report === null ? {} : { report: row.report }),
  };
}

function dependencyPinnedOf(
  rows: readonly DependencyPinnedRow[],
): DependencyPinned {
  const repository = dependencyPinnedSingle(rows, "Repository");
  const began = dependencyPinnedSingle(rows, "TargetCommit");
  const commits = (kind: string) =>
    rows
      .filter((row) => row.reference_kind === kind)
      .map((row) => asGitObjectId(row.reference_id));
  return {
    ...(repository === undefined
      ? {}
      : { repository: asRepositoryId(repository.reference_id) }),
    ...(began === undefined
      ? {}
      : { began: asGitObjectId(began.reference_id) }),
    startsAtBegan: began?.own_target === true,
    results: rows
      .filter((row) => row.reference_kind === "DependencyResult")
      .map(dependencyPinnedResultOf),
    ancestors: commits("DependencyAncestor"),
    nonAncestors: commits("DependencyNotAncestor"),
  };
}

/**
 * Reads what the dispatch of an execution's ticket pinned in the bundle of the
 * ticket's first work request, the only one that pins dependencies, with each
 * pinned result's ticket, source and report and whether this execution's own
 * bundle starts at the dispatched commit. A failed read is `Unavailable`
 * rather than a throw, so the scheduler holds an attempt it could not brief
 * instead of losing its loop.
 */
export function postgresDependencyPins(pool: pg.Pool): DependencyPinnedPort {
  return {
    pinned: async (partition, execution): Promise<DependencyPinnedRead> => {
      let found: pg.QueryResult<DependencyPinnedRow>;
      try {
        found = await pool.query<DependencyPinnedRow>(
          sql`WITH own AS (
                SELECT e.ticket, q.input_bundle
                  FROM execution e
                  JOIN execution_request q
                    ON q.tenant=e.tenant AND q.project=e.project
                   AND q.request=e.source_request
                 WHERE e.tenant=${partition.tenant} AND e.project=${partition.project}
                   AND e.execution=${execution}
              ), dispatch AS (
                SELECT q.input_bundle
                  FROM own
                  JOIN execution_request q
                    ON q.tenant=${partition.tenant} AND q.project=${partition.project}
                   AND q.ticket=own.ticket AND q.kind='SpawnWork'
                 ORDER BY q.authorizing_seq, q.effect_position
                 LIMIT 1
              )
              SELECT b.reference_kind, b.reference_id,
                     d.ticket::text AS dependency, s.repository, s.commit,
                     s.ref, r.report,
                     EXISTS (SELECT 1
                               FROM own
                               JOIN input_bundle_reference o
                                 ON o.tenant=${partition.tenant}
                                AND o.project=${partition.project}
                                AND o.bundle=own.input_bundle
                              WHERE o.reference_kind='TargetCommit'
                                AND o.reference_id=b.reference_id) AS own_target
                FROM dispatch
                JOIN input_bundle_reference b
                  ON b.tenant=${partition.tenant} AND b.project=${partition.project}
                 AND b.bundle=dispatch.input_bundle
                LEFT JOIN execution d
                  ON b.reference_kind='DependencyResult'
                 AND d.tenant=b.tenant AND d.project=b.project
                 AND d.result_manifest=b.reference_id
                LEFT JOIN execution_result_source s
                  ON b.reference_kind='DependencyResult'
                 AND s.tenant=b.tenant AND s.project=b.project
                 AND s.manifest=b.reference_id
                LEFT JOIN execution_result_report r
                  ON b.reference_kind='DependencyResult'
                 AND r.tenant=b.tenant AND r.project=b.project
                 AND r.manifest=b.reference_id
               WHERE b.reference_kind IN ('Repository', 'TargetCommit',
                       'DependencyResult', 'DependencyAncestor',
                       'DependencyNotAncestor')
               ORDER BY b.ordinal`,
        );
      } catch {
        return { read: "Unavailable" };
      }
      return { read: "Pinned", pinned: dependencyPinnedOf(found.rows) };
    },
  };
}
