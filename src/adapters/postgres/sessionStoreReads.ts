/**
 * The two reads a session's transcript is drawn from, over the API's own pool.
 *
 * THEY ARE KEYED ON THE SESSION AND NOT ON A KIND. Migration 062 retired 059's
 * lead-only pair for these, because a thread's transcript is the same walk over
 * a different session: two definers differing in one predicate is where a fix
 * lands in only one of them, and two adapters over them would be the same
 * mistake one layer up. So the lead's route and a thread's both pass the
 * session they resolved, and this module is the only place either read is
 * written.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { SessionId } from "../../interpreter/agentSession.ts";
import type { SessionStoreRowsRead } from "../../interpreter/leadRead.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type {
  SessionStoreBatchRow,
  SessionStoreStreamRow,
} from "../../interpreter/sessionPlane.ts";
import { projectRowCounter } from "./rows.ts";
import { sessionRowText, sessionStoreStreamRowsOf } from "./sessionRows.ts";

/** One page of one stream's batch rows, without the bytes they point at. */
export async function sessionStoreBatchRows(
  pool: pg.Pool,
  query: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly stream: string;
    readonly after: number;
    readonly limit: number;
  },
): Promise<readonly SessionStoreBatchRow[]> {
  const found = await pool.query<{
    batch: string | null;
    digest: string | null;
    bytes: string | null;
  }>(
    sql`SELECT batch::text AS batch,digest,bytes::text AS bytes
          FROM read_session_store_batches(${query.partition.tenant},
            ${query.partition.project},${query.session},
            ${query.stream},${query.after},${query.limit})`,
  );
  return found.rows.map((row) => ({
    batch: projectRowCounter(sessionRowText(row.batch, "batch"), "store batch"),
    digest: sessionRowText(row.digest, "batch digest"),
    bytes: projectRowCounter(
      sessionRowText(row.bytes, "batch bytes"),
      "store batch bytes",
    ),
  }));
}

/** Every stream one session's store holds, with the batches standing under each. */
export async function sessionStoreStreamRows(
  pool: pg.Pool,
  partition: Partition,
  session: SessionId,
  max: number,
): Promise<readonly SessionStoreStreamRow[]> {
  const found = await pool.query<{
    stream: string | null;
    batches: string | null;
  }>(
    sql`SELECT stream,batches::text AS batches
          FROM list_session_store_streams(
                 ${partition.tenant},${partition.project},${session},${max})`,
  );
  return sessionStoreStreamRowsOf(found.rows);
}

/**
 * The row half of a session's transcript as one port, which is what a thread's
 * bundle and the lead's both read through. It is the same function either way:
 * the read takes the session it reads, so there is nothing per-kind to compose.
 */
export function postgresSessionStoreRows(pool: pg.Pool): SessionStoreRowsRead {
  return { batches: (query) => sessionStoreBatchRows(pool, query) };
}
