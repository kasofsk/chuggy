/**
 * PostgreSQL reads of the brief a ticket carries.
 *
 * The brief lives beside the draft, and a released draft is retained, so the
 * ticket and the draft reach the same row by the same key and nothing is
 * copied forward at release. A ticket authored before a draft carried one has
 * no row, which is what an absent brief is.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asRepositoryId } from "../../interpreter/finalizer.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  asBriefBranch,
  asBriefCheckLine,
  asBriefFinalization,
  asBriefIntent,
  asBriefLinkUrl,
  asBriefTitle,
  type BriefFinalization,
  type DraftBrief,
  type ReleaseBrief,
  type TicketBriefPort,
} from "../../interpreter/ticketBrief.ts";

/** The pair of columns a brief's finalization is read from, wherever a query selected them. */
export interface DraftBriefFinalizationRow {
  readonly finalization_mode: string | null;
  readonly finalization_target: string | null;
}

/**
 * The columns any brief-bearing read selects, joined from the brief's own
 * relation and from the two ordinal ones beside it.
 */
export interface DraftBriefRow extends DraftBriefFinalizationRow {
  readonly title: string | null;
  readonly intent: string | null;
  readonly branch: string | null;
  readonly repository: string | null;
  readonly links: string[] | null;
  readonly checks: string[] | null;
}

/**
 * The finalization a row states, which is none exactly where the mode column is
 * null: the door resolves what a brief left unsaid and stores what it resolved,
 * so the column is empty only for a ticket that lands nothing.
 */
export function draftBriefFinalizationOf(
  row: DraftBriefFinalizationRow,
): BriefFinalization | undefined {
  if (row.finalization_mode === null) return undefined;
  return asBriefFinalization({
    mode: row.finalization_mode,
    ...(row.finalization_target === null
      ? {}
      : { target: row.finalization_target }),
  });
}

/**
 * What release reads of one row's brief, or none where the row joined no brief
 * at all. The miss is read off `intent`, which every brief row carries: a null
 * mode is a ticket that lands nothing and is a brief like any other.
 */
export function draftReleaseBriefOf(
  row: DraftBriefFinalizationRow & {
    readonly intent: string | null;
    readonly checks: string[] | null;
    readonly repository: string | null;
  },
): ReleaseBrief | undefined {
  if (row.intent === null) return undefined;
  const finalization = draftBriefFinalizationOf(row);
  return {
    checks: (row.checks ?? []).map(asBriefCheckLine),
    ...(row.repository === null
      ? {}
      : { repository: asRepositoryId(row.repository) }),
    ...(finalization === undefined ? {} : { finalization }),
  };
}

/** Rebuilds one brief from a row that may have joined nothing. */
export function draftBriefOf(row: DraftBriefRow): DraftBrief | undefined {
  if (row.intent === null) return undefined;
  const finalization = draftBriefFinalizationOf(row);
  return {
    ...(row.title === null ? {} : { title: asBriefTitle(row.title) }),
    intent: asBriefIntent(row.intent),
    links: (row.links ?? []).map(asBriefLinkUrl),
    checks: (row.checks ?? []).map(asBriefCheckLine),
    ...(row.branch === null ? {} : { branch: asBriefBranch(row.branch) }),
    ...(row.repository === null
      ? {}
      : { repository: asRepositoryId(row.repository) }),
    ...(finalization === undefined ? {} : { finalization }),
  };
}

/** Answers the brief port through the reader's own credential. */
export function postgresTicketBrief(pool: pg.Pool): TicketBriefPort {
  return {
    brief: async (partition: Partition, ticket: number) => {
      const found = await pool.query<{
        title: string | null;
        intent: string;
        branch: string | null;
        repository: string | null;
        finalization_mode: string | null;
        finalization_target: string | null;
        links: string[] | null;
        checks: string[] | null;
      }>(
        sql`SELECT b.title,b.intent,b.branch,b.repository,
                   b.finalization_mode,b.finalization_target,
                   (SELECT array_agg(k.url ORDER BY k.ordinal) FROM draft_brief_link k
                     WHERE k.tenant=b.tenant AND k.project=b.project AND k.ticket=b.ticket) AS links,
                   (SELECT array_agg(c.command ORDER BY c.ordinal) FROM draft_brief_check c
                     WHERE c.tenant=b.tenant AND c.project=b.project AND c.ticket=b.ticket) AS checks
              FROM draft_brief b
             WHERE b.tenant=${partition.tenant} AND b.project=${partition.project}
               AND b.ticket=${ticket}`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : draftBriefOf(row);
    },
  };
}
