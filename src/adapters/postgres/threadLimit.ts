/**
 * PostgreSQL side of how many threads one member may hold open in a project:
 * the read that answers the default where no row was written, and the door an
 * administrator writes one through, both granted to the API.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { ThreadLimitStore } from "../../interpreter/threadLimit.ts";
import { placementWriteOutcome } from "./executionPlacement.ts";
import { projectRowCounter } from "./rows.ts";
import { sessionRowText } from "./sessionRows.ts";

/** The API's read of one member's limit and the door it writes it through. */
export function postgresThreadLimits(pool: pg.Pool): ThreadLimitStore {
  return {
    limit: async (partition, member) => {
      const found = await pool.query<{ threads_max: string | null }>(
        sql`SELECT member_thread_limit(
              ${partition.tenant},${partition.project},${member})::text AS threads_max`,
      );
      return projectRowCounter(
        sessionRowText(found.rows[0]?.threads_max ?? null, "thread limit"),
        "thread limit",
      );
    },
    write: async (partition, member, threadsMax, authority) => {
      const found = await pool.query<{ outcome: string | null }>(
        sql`SELECT set_member_thread_limit(
              ${partition.tenant},${partition.project},${member},
              ${threadsMax},${authority.kind},${authority.subject})::text AS outcome`,
      );
      return placementWriteOutcome(found.rows[0]?.outcome);
    },
  };
}
