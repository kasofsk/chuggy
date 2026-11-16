/**
 * PostgreSQL reads for a project's landing queues, through the API's one door
 * onto that project's queue candidates. A candidate holding no rank is in no
 * queue, so only ranked ones are read, earliest first, one past the bound so
 * a cut is told from a project that has exactly as many. Each carries the
 * door's `holder_since`, which the read answers for a queue's holder alone.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { LandingQueuesStore } from "../../interpreter/landingQueues.ts";
import { finalizerBounded } from "./finalizerRows.ts";
import { serializedCandidateOfRow } from "./serializedCandidates.ts";

interface LandingQueueRow {
  readonly ticket: string | null;
  readonly phase: string | null;
  readonly brief: string | null;
  readonly rank: string | null;
  readonly holder_since: string | null;
}

export function postgresLandingQueues(pool: pg.Pool): LandingQueuesStore {
  return {
    rankedCandidates: async (partition, ticketsMax) => {
      finalizerBounded(ticketsMax, "ticketsMax");
      const found = await pool.query<LandingQueueRow>(
        sql`SELECT c.ticket::text AS ticket, c.phase, c.brief,
                   c.rank::text AS rank,
                   to_char(c.holder_since AT TIME ZONE 'UTC',
                           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS holder_since
              FROM project_landing_queue_candidates(${partition.tenant}, ${partition.project}) c
             WHERE c.rank IS NOT NULL
             ORDER BY c.rank, c.ticket
             LIMIT ${ticketsMax + 1}`,
      );
      return {
        candidates: found.rows.slice(0, ticketsMax).map((row) => ({
          ...serializedCandidateOfRow(partition, row),
          holderSince: row.holder_since ?? undefined,
        })),
        truncated: found.rows.length > ticketsMax,
      };
    },
  };
}
