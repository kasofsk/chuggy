/**
 * A session's context readings and what it was opened under, over the API's
 * own pool and through the two definers that are the API's only door onto
 * either: keyed on the session the route resolved, as the store reads are.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { sessionContextOfferedSchema } from "../../contract/responses.ts";
import {
  asSessionTurnId,
  type SessionTurnId,
} from "../../interpreter/agentSession.ts";
import type {
  SessionContextRead,
  SessionContextTurn,
} from "../../interpreter/sessionContext.ts";
import { projectRowCounter, projectRowInstant } from "./rows.ts";
import { sessionRowText } from "./sessionRows.ts";

interface SessionContextRow {
  readonly turn: string | null;
  readonly turn_ordinal: string | null;
  readonly cause: string | null;
  readonly compaction_trigger: string | null;
  readonly compaction_tokens_before: string | null;
  readonly compaction_tokens_after: string | null;
  readonly context_window: unknown;
  readonly recorded_at: string | null;
}

/** One stored reading as the wire carries it, refused whole where a row is not one a pod could have offered. */
function sessionContextReading(row: SessionContextRow) {
  const compacted =
    row.compaction_trigger === null || row.compaction_tokens_before === null
      ? {}
      : {
          compaction: {
            trigger: row.compaction_trigger,
            tokensBefore: projectRowCounter(
              row.compaction_tokens_before,
              "compaction tokens before",
            ),
            ...(row.compaction_tokens_after === null
              ? {}
              : {
                  tokensAfter: projectRowCounter(
                    row.compaction_tokens_after,
                    "compaction tokens after",
                  ),
                }),
          },
        };
  return {
    ...sessionContextOfferedSchema.parse({
      cause: row.cause,
      ...compacted,
      ...(row.context_window === null ? {} : { window: row.context_window }),
    }),
    recordedAt: projectRowInstant(row.recorded_at, "recording time"),
  };
}

/** The rows of a page folded into its turns, each row following the one before it in its turn or opening the next. */
function sessionContextTurns(
  rows: readonly SessionContextRow[],
): readonly SessionContextTurn[] {
  const turns: {
    turn: SessionTurnId;
    ordinal: number;
    readings: ReturnType<typeof sessionContextReading>[];
  }[] = [];
  for (const row of rows) {
    const ordinal = projectRowCounter(
      sessionRowText(row.turn_ordinal, "context turn ordinal"),
      "context turn ordinal",
    );
    const reading = sessionContextReading(row);
    const open = turns.at(-1);
    if (open?.ordinal === ordinal) open.readings.push(reading);
    else
      turns.push({
        turn: asSessionTurnId(sessionRowText(row.turn, "context turn")),
        ordinal,
        readings: [reading],
      });
  }
  return turns;
}

export function postgresSessionContext(pool: pg.Pool): SessionContextRead {
  return {
    turns: async (query) => {
      const found = await pool.query<SessionContextRow>(
        sql`SELECT turn,turn_ordinal::text AS turn_ordinal,cause,
                   compaction_trigger,
                   compaction_tokens_before::text AS compaction_tokens_before,
                   compaction_tokens_after::text AS compaction_tokens_after,
                   context_window,
                   to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS recorded_at
              FROM read_session_context(${query.partition.tenant},
                ${query.partition.project},${query.session},
                ${query.after},${query.limit})`,
      );
      return sessionContextTurns(found.rows);
    },
    opening: async (partition, session) => {
      const found = await pool.query<{
        system_prompt: string | null;
        auto_compact_window: string | null;
      }>(
        sql`SELECT system_prompt,
                   auto_compact_window::text AS auto_compact_window
              FROM read_session_opening(${partition.tenant},
                ${partition.project},${session})`,
      );
      const row = found.rows[0];
      if (row === undefined) return {};
      return {
        ...(row.system_prompt === null
          ? {}
          : { systemPrompt: row.system_prompt }),
        ...(row.auto_compact_window === null
          ? {}
          : {
              autoCompactWindow: projectRowCounter(
                row.auto_compact_window,
                "auto compact window",
              ),
            }),
      };
    },
  };
}
