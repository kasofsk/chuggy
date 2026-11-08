/**
 * The two reads a session's context page is drawn from, over the API's own
 * pool: its readings by turn, and what it was opened under.
 *
 * THEY ARE KEYED ON THE SESSION AND NOT ON A KIND, as its store rows are, so
 * the lead's route, a project thread's and a member chat's all pass the
 * session they resolved and this module is the only place either read is
 * written.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { sessionContextOfferedSchema } from "../../contract/responses.ts";
import {
  asSessionTurnId,
  type SessionId,
} from "../../interpreter/agentSession.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type {
  SessionContextOpening,
  SessionContextPage,
  SessionContextQuery,
  SessionContextReadStore,
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

/** The rows grouped by the turn they were taken in, which the read answers in turn order. */
function sessionContextTurns(
  rows: readonly SessionContextRow[],
): readonly SessionContextTurn[] {
  const turns: {
    turn: SessionContextTurn["turn"];
    ordinal: number;
    readings: SessionContextTurn["readings"][number][];
  }[] = [];
  for (const row of rows) {
    const ordinal = projectRowCounter(
      sessionRowText(row.turn_ordinal, "context turn ordinal"),
      "context turn ordinal",
    );
    let last = turns.at(-1);
    if (last?.ordinal !== ordinal) {
      last = {
        turn: asSessionTurnId(sessionRowText(row.turn, "context turn")),
        ordinal,
        readings: [],
      };
      turns.push(last);
    }
    last.readings.push(sessionContextReading(row));
  }
  return turns;
}

async function sessionContextTurnsPage(
  pool: pg.Pool,
  partition: Partition,
  session: SessionId,
  query: SessionContextQuery,
): Promise<Pick<SessionContextPage, "turns" | "nextAfter">> {
  const found = await pool.query<SessionContextRow>(
    sql`SELECT turn,turn_ordinal::text AS turn_ordinal,cause,
               compaction_trigger,
               compaction_tokens_before::text AS compaction_tokens_before,
               compaction_tokens_after::text AS compaction_tokens_after,
               context_window,
               to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS recorded_at
          FROM read_session_context(${partition.tenant},${partition.project},
            ${session},${query.after ?? null},${query.limit})`,
  );
  const turns = sessionContextTurns(found.rows);
  const page = turns.slice(0, query.limit);
  const next = turns.length > query.limit ? page.at(-1) : undefined;
  return {
    turns: page,
    ...(next === undefined ? {} : { nextAfter: next.ordinal }),
  };
}

async function sessionContextOpening(
  pool: pg.Pool,
  partition: Partition,
  session: SessionId,
): Promise<SessionContextOpening> {
  const found = await pool.query<{
    system_prompt: string | null;
    auto_compact_window: string | null;
  }>(
    sql`SELECT system_prompt,auto_compact_window::text AS auto_compact_window
          FROM read_session_opening(${partition.tenant},${partition.project},
            ${session})`,
  );
  const row = found.rows[0];
  if (row === undefined) return {};
  return {
    ...(row.system_prompt === null ? {} : { systemPrompt: row.system_prompt }),
    ...(row.auto_compact_window === null
      ? {}
      : {
          autoCompactWindow: projectRowCounter(
            row.auto_compact_window,
            "auto compact window",
          ),
        }),
  };
}

/** A session's context page as one port, which the lead's, a thread's and a member chat's routes all read through. */
export function postgresSessionContextReads(
  pool: pg.Pool,
): SessionContextReadStore {
  return {
    turns: ({ partition, session, query }) =>
      sessionContextTurnsPage(pool, partition, session, query),
    opening: (partition, session) =>
      sessionContextOpening(pool, partition, session),
  };
}
