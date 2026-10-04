/**
 * One connection that listens on a PostgreSQL channel for as long as its
 * process runs, and comes back when it is lost.
 *
 * The listener is a client of its own and never a pool checkout: `LISTEN`
 * binds to the session that issued it, so a pooled connection would stop
 * delivering once it was released to another caller.
 *
 * A close outranks a connect in flight. `close` waits for one, and the connect
 * re-reads the flag after every await, so the socket a shutdown raced is ended
 * rather than left listening.
 */

import pg from "pg";

/** How long a lost listener waits before trying again, and how long that wait may grow to. */
export interface PostgresListenerLimits {
  readonly reconnectBaseMs: number;
  readonly reconnectMaxMs: number;
}

export const postgresListenerLimitsDefault: PostgresListenerLimits = {
  reconnectBaseMs: 250,
  reconnectMaxMs: 30_000,
};

/** What a listener tells whoever opened it. */
export interface PostgresListenerWatcher {
  /** The connection is listening, and nothing notified before now was heard. */
  connected(): void;

  /** The connection is gone, and nothing is heard until it is connected again. */
  lost(): void;

  notified(payload: string): void;
}

export interface PostgresListener {
  open(watcher: PostgresListenerWatcher): void;
  close(): Promise<void>;
}

/** Issues the `LISTEN` on a connected client, written where its channel is named in full. */
export type PostgresListen = (client: pg.Client) => Promise<unknown>;

interface ListenerState {
  readonly url: string;
  readonly limits: PostgresListenerLimits;
  readonly listen: PostgresListen;
  watcher: PostgresListenerWatcher | undefined;
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
export function postgresListenerBackoffMs(
  attempt: number,
  limits: PostgresListenerLimits,
): number {
  const ceiling = Math.min(
    limits.reconnectMaxMs,
    limits.reconnectBaseMs * 2 ** attempt,
  );
  return Math.max(1, Math.round(ceiling / 2 + Math.random() * (ceiling / 2)));
}

function fellOver(state: ListenerState): void {
  if (state.closed) return;
  state.client = undefined;
  state.watcher?.lost();
  if (state.retry !== undefined) return;
  state.attempt += 1;
  state.retry = setTimeout(
    () => {
      state.retry = undefined;
      begin(state);
    },
    postgresListenerBackoffMs(state.attempt, state.limits),
  );
  state.retry.unref();
}

async function connect(state: ListenerState): Promise<void> {
  if (state.closed) return;
  const client = new pg.Client({ connectionString: state.url });
  client.on("error", () => {
    fellOver(state);
  });
  client.on("end", () => {
    fellOver(state);
  });
  client.on("notification", (message) => {
    state.watcher?.notified(message.payload ?? "");
  });
  try {
    await client.connect();
    await state.listen(client);
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
  state.watcher?.connected();
}

/**
 * Starts one connect and keeps hold of it, because a close that lands while a
 * connect is in flight has to wait for the client it is about to be handed
 * rather than find none and leave a listening backend behind.
 */
function begin(state: ListenerState): void {
  state.connecting = connect(state).finally(() => {
    state.connecting = undefined;
  });
}

export function postgresListener(
  url: string,
  limits: PostgresListenerLimits,
  listen: PostgresListen,
): PostgresListener {
  const state: ListenerState = {
    url,
    limits,
    listen,
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
