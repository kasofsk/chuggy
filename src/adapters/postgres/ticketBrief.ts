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

import type { Partition } from "../../interpreter/projectStore.ts";
import {
  asBriefBranch,
  asBriefCheckLine,
  asBriefFinalization,
  asBriefIntent,
  asBriefLinkUrl,
  briefFinalizationDefault,
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
  readonly intent: string | null;
  readonly branch: string | null;
  readonly links: string[] | null;
  readonly checks: string[] | null;
}

/**
 * The finalization a row states, or none where it states what a brief naming
 * none means — which is what leaves a draft written before the columns existed
 * reading back as it always did.
 */
export function draftBriefFinalizationOf(
  row: DraftBriefFinalizationRow,
): BriefFinalization | undefined {
  if (row.finalization_mode === null) return undefined;
  if (
    row.finalization_target === null &&
    row.finalization_mode === briefFinalizationDefault.mode
  )
    return undefined;
  return asBriefFinalization({
    mode: row.finalization_mode,
    ...(row.finalization_target === null
      ? {}
      : { target: row.finalization_target }),
  });
}

/**
 * What release reads of one row's brief, or none where the row joined no brief
 * at all. The mode column is `NOT NULL`, so a null one is the miss and not a
 * brief that named no finalization.
 */
export function draftReleaseBriefOf(
  row: DraftBriefFinalizationRow & { readonly checks: string[] | null },
): ReleaseBrief | undefined {
  if (row.finalization_mode === null) return undefined;
  const finalization = draftBriefFinalizationOf(row);
  return {
    checks: (row.checks ?? []).map(asBriefCheckLine),
    ...(finalization === undefined ? {} : { finalization }),
  };
}

/** Rebuilds one brief from a row that may have joined nothing. */
export function draftBriefOf(row: DraftBriefRow): DraftBrief | undefined {
  if (row.intent === null) return undefined;
  const finalization = draftBriefFinalizationOf(row);
  return {
    intent: asBriefIntent(row.intent),
    links: (row.links ?? []).map(asBriefLinkUrl),
    checks: (row.checks ?? []).map(asBriefCheckLine),
    ...(row.branch === null ? {} : { branch: asBriefBranch(row.branch) }),
    ...(finalization === undefined ? {} : { finalization }),
  };
}

/** Answers the brief port through the reader's own credential. */
export function postgresTicketBrief(pool: pg.Pool): TicketBriefPort {
  return {
    brief: async (partition: Partition, ticket: number) => {
      const found = await pool.query<{
        intent: string;
        branch: string | null;
        finalization_mode: string;
        finalization_target: string | null;
        links: string[] | null;
        checks: string[] | null;
      }>(
        sql`SELECT b.intent,b.branch,b.finalization_mode,b.finalization_target,
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
