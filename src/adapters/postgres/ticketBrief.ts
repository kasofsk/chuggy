/**
 * PostgreSQL reads of the brief a draft carries, and of the one its ticket was
 * released with.
 *
 * THEY ARE TWO BRIEFS ONCE A DRAFT REOPENS. The draft's brief is one row its
 * author revises in place, and a Pending ticket's draft takes revisions nobody
 * has released; so what a ticket runs is the brief its last release or update
 * stored beside its definition, and the port every dispatch, briefing and
 * finalization reads through answers that one and never the draft's.
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
import { releasedTicketBrief } from "../../interpreter/ticketDefinition.ts";

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
 * The finalization a row states. The door resolves a landing for every draft
 * and stores what it resolved, and the landing that lands nothing is one of
 * them, so a null mode is a row no writer in this tree can produce — read as
 * no finalization rather than defended against, because the reads below are
 * total over what the column admits.
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
 * at all. The miss is read off `intent`, which every brief row carries, rather
 * than off the mode, which says how a brief lands and not whether there is one.
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

/**
 * Answers the brief port through the reader's own credential, from what the
 * ticket's last release or update stored. A ticket that was never released has
 * no brief to run with, which the port answers as none.
 */
export function postgresTicketBrief(pool: pg.Pool): TicketBriefPort {
  return {
    brief: async (partition: Partition, ticket: number) => {
      const found = await pool.query<{
        brief: string | null;
        content_digest: string | null;
      }>(
        sql`SELECT d.brief::text AS brief,
                   d.definition->'content'->>'digest' AS content_digest
              FROM ticket_definition d
             WHERE d.tenant=${partition.tenant} AND d.project=${partition.project}
               AND d.ticket=${ticket}`,
      );
      const row = found.rows[0];
      if (row === undefined) return undefined;
      if (row.content_digest === null)
        throw new Error(
          `ticket ${String(ticket)}: the released definition names no content digest`,
        );
      return releasedTicketBrief(
        row.brief === null ? undefined : (JSON.parse(row.brief) as unknown),
        row.content_digest,
      );
    },
  };
}
