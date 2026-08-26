/**
 * PostgreSQL reads over the durable project change log, and the one connection
 * per process that listens for its doorbell.
 *
 * THE LISTENER IS A CLIENT OF ITS OWN, never a pool checkout. `LISTEN` binds to
 * the session that issued it, so a pooled connection would stop delivering the
 * moment it was released to another caller — and holding one for the process's
 * lifetime would take a slot the pool sizes for short reads.
 *
 * A CLOSE OUTRANKS A CONNECT IN FLIGHT. `close` waits for one and the connect
 * re-reads the flag after every await, so the socket a shutdown raced is ended
 * rather than left listening — which is the socket that would keep the process
 * alive past the drain the API answers a signal with.
 *
 * A LOST CONNECTION IS DEGRADED, NOT FATAL. The reads above it run on the pool
 * and keep working, so the doorbell going quiet costs the streams their latency
 * and nothing else; it reconnects with a bounded, jittered backoff so a server
 * that just came back is not met by every replica at once.
 *
 * THE CHANNEL AND THE FUNCTIONS ARE NAMED IN FULL rather than interpolated,
 * because a name assembled at run time is a name `check-queries` cannot resolve
 * against the schema. That the channel is the one the append rings is proved
 * against a real server in `test/postgres/projectChangeLog.test.ts`, by ringing
 * it, which no name check could establish.
 */

import { sql } from "@ts-safeql/sql-tag";
import pg from "pg";

import { allProjectChangeKinds } from "../../interpreter/projectChange.ts";
import type {
  ProjectChangeDoorbell,
  ProjectChangeLog,
  ProjectChangeRow,
  ProjectChangeWatcher,
} from "../../interpreter/projectStream.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
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

/** How long a lost doorbell waits before trying again, and how long that wait may grow to. */
export interface ProjectChangeDoorbellLimits {
  readonly reconnectBaseMs: number;
  readonly reconnectMaxMs: number;
}

export const projectChangeDoorbellLimitsDefault: ProjectChangeDoorbellLimits = {
  reconnectBaseMs: 250,
  reconnectMaxMs: 30_000,
};

interface DoorbellState {
  readonly url: string;
  readonly limits: ProjectChangeDoorbellLimits;
  watcher: ProjectChangeWatcher | undefined;
  client: pg.Client | undefined;
  connecting: Promise<void> | undefined;
  retry: ReturnType<typeof setTimeout> | undefined;
  attempt: number;
  closed: boolean;
}

/**
 * Doubling, capped, and then drawn from the upper half of what the cap allows —
 * so a server that has just come back is not met by every replica at once. The
 * exponent needs no cap of its own: an attempt count large enough to overflow it
 * gives an infinite ceiling, which is the one the cap was going to choose.
 */
export function projectChangeBackoffMs(
  attempt: number,
  limits: ProjectChangeDoorbellLimits,
): number {
  const ceiling = Math.min(
    limits.reconnectMaxMs,
    limits.reconnectBaseMs * 2 ** attempt,
  );
  return Math.max(1, Math.round(ceiling / 2 + Math.random() * (ceiling / 2)));
}

function fellOver(state: DoorbellState): void {
  if (state.closed) return;
  state.client = undefined;
  state.watcher?.sourced("degraded");
  if (state.retry !== undefined) return;
  state.attempt += 1;
  state.retry = setTimeout(
    () => {
      state.retry = undefined;
      begin(state);
    },
    projectChangeBackoffMs(state.attempt, state.limits),
  );
  state.retry.unref();
}

async function connect(state: DoorbellState): Promise<void> {
  if (state.closed) return;
  const client = new pg.Client({ connectionString: state.url });
  client.on("error", () => {
    fellOver(state);
  });
  client.on("end", () => {
    fellOver(state);
  });
  client.on("notification", () => {
    state.watcher?.rang();
  });
  try {
    await client.connect();
    await client.query(sql`LISTEN chuggy_project_change`);
  } catch {
    await client.end().catch(() => undefined);
    fellOver(state);
    return;
  }
  if (state.closed) {
    await client.end().catch(() => undefined);
    return;
  }
  state.client = client;
  state.attempt = 0;
  state.watcher?.sourced("live");
  state.watcher?.rang();
}

/**
 * Starts one connect and keeps hold of it, because a close that lands while a
 * connect is in flight has to wait for the client it is about to be handed
 * rather than find none and leave a listening backend behind.
 */
function begin(state: DoorbellState): void {
  state.connecting = connect(state).finally(() => {
    state.connecting = undefined;
  });
}

export function postgresProjectChangeDoorbell(
  url: string,
  limits: ProjectChangeDoorbellLimits = projectChangeDoorbellLimitsDefault,
): ProjectChangeDoorbell {
  const state: DoorbellState = {
    url,
    limits,
    watcher: undefined,
    client: undefined,
    connecting: undefined,
    retry: undefined,
    attempt: 0,
    closed: false,
  };
  return {
    open: (watcher) => {
      state.watcher = watcher;
      begin(state);
    },
    close: async () => {
      state.closed = true;
      if (state.retry !== undefined) clearTimeout(state.retry);
      state.retry = undefined;
      await state.connecting?.catch(() => undefined);
      const client = state.client;
      state.client = undefined;
      if (client !== undefined) await client.end().catch(() => undefined);
    },
  };
}
