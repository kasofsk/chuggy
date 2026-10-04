/**
 * PostgreSQL reads over the durable project change log, and the one connection
 * per process that listens for its doorbell.
 *
 * A LOST CONNECTION IS DEGRADED, NOT FATAL. The reads above it run on the pool
 * and keep working, so the doorbell going quiet costs the streams their latency
 * and nothing else; `listener.ts` brings it back.
 *
 * THE CHANNEL AND THE FUNCTIONS ARE NAMED IN FULL rather than interpolated,
 * because a name assembled at run time is a name `check-queries` cannot resolve
 * against the schema. That the channel is the one the append rings is proved
 * against a real server in `test/postgres/projectChangeLog.test.ts`, by ringing
 * it, which no name check could establish.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { allProjectChangeKinds } from "../../interpreter/projectChange.ts";
import type {
  ProjectChangeDoorbell,
  ProjectChangeLog,
  ProjectChangeRow,
} from "../../interpreter/projectStream.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import {
  postgresListener,
  postgresListenerLimitsDefault,
  type PostgresListenerLimits,
} from "./listener.ts";
import { projectRowCounter } from "./rows.ts";

interface ChangeRow {
  readonly seq: string;
  readonly tenant: string;
  readonly project: string;
  readonly kind: string;
  readonly resource: string;
}

function changeKind(value: string): ProjectChangeRow["kind"] {
  const found = allProjectChangeKinds.find((known) => known === value);
  if (found === undefined)
    throw new Error(`project change row: unknown kind ${value}`);
  return found;
}

function changeRow(row: ChangeRow): ProjectChangeRow {
  return {
    sequence: projectRowCounter(row.seq, "project change sequence"),
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    kind: changeKind(row.kind),
    resource: row.resource,
  };
}

export function postgresProjectChangeLog(pool: pg.Pool): ProjectChangeLog {
  return {
    latest: async () => {
      const found = await pool.query<{ latest: string | null }>(
        sql`SELECT max(sequence)::text AS latest FROM project_change`,
      );
      const latest = found.rows[0]?.latest ?? null;
      return latest === null
        ? 0
        : projectRowCounter(latest, "latest project change");
    },
    since: async (after, limit) => {
      const found = await pool.query<ChangeRow>(
        sql`SELECT sequence::text AS seq,tenant,project,kind,resource
             FROM project_change
            WHERE sequence>${after}
            ORDER BY sequence LIMIT ${limit}`,
      );
      return found.rows.map(changeRow);
    },
    retains: async (sequence) => {
      const found = await pool.query<{ retained: boolean | null }>(
        sql`SELECT project_change_retains(${sequence}::bigint)::boolean AS retained`,
      );
      return found.rows[0]?.retained === true;
    },
    after: async (partition, sequence, limit) => {
      const found = await pool.query<ChangeRow>(
        sql`SELECT sequence::text AS seq,tenant,project,kind,resource
             FROM project_change
            WHERE tenant=${partition.tenant} AND project=${partition.project}
              AND sequence>${sequence}
            ORDER BY sequence LIMIT ${limit}`,
      );
      return found.rows.map(changeRow);
    },
    sweep: async (rowsMax) => {
      const found = await pool.query<{ removed: string | null }>(
        sql`SELECT sweep_project_change(${rowsMax}::bigint)::text AS removed`,
      );
      const removed = found.rows[0]?.removed ?? null;
      return removed === null
        ? 0
        : projectRowCounter(removed, "swept project changes");
    },
  };
}

/** The doorbell rings once it is listening, because whatever was appended while it was not rang nothing. */
export function postgresProjectChangeDoorbell(
  url: string,
  limits: PostgresListenerLimits = postgresListenerLimitsDefault,
): ProjectChangeDoorbell {
  const listener = postgresListener(url, limits, (client) =>
    client.query(sql`LISTEN chuggy_project_change`),
  );
  return {
    open: (watcher) => {
      listener.open({
        connected: () => {
          watcher.sourced("live");
          watcher.rang();
        },
        lost: () => {
          watcher.sourced("degraded");
        },
        notified: () => {
          watcher.rang();
        },
      });
    },
    close: () => listener.close(),
  };
}
