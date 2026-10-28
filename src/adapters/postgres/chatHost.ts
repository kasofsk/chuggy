/**
 * The registry a member's chat host is known by, over the API's pool, and the
 * lookup a poll resolves one by, over the pool plane's.
 *
 * A MEMBER'S CHAT HOST IS WRITTEN UNDER ONE LOCK. Registering one and removing
 * it each take an advisory lock per member and tenant, so a registration reads
 * the row it replaces with no other registration between its read and its
 * write.
 *
 * REPLACING OR REMOVING A HOST FENCES WHAT IT HELD. A session attempt a chat
 * host claimed records its owner and the principal that claimed, so the write
 * ends, in the same transaction, every live attempt of the owner's host whose
 * principal is not the host's now.
 */
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type {
  ChatHostKey,
  ChatHostRegistration,
  ChatHostRegistry,
  ChatHostView,
  ChatHostWritten,
} from "../../interpreter/chatHostRegistration.ts";
import { asPrincipal } from "../../interpreter/principal.ts";
import { asTenantId } from "../../interpreter/projectStore.ts";
import { sessionRunnerPolledSecsMax } from "../../interpreter/sessionPlacement.ts";
import type { ChatHostPlaneRegistry } from "../../interpreter/workerPool.ts";
import { postgresTransaction } from "./pool.ts";
import { workerPoolRunnerKept } from "./workerPool.ts";

const foreignKeyViolation = "23503";

/** Whether `failure` is the host's foreign key refusing a row whose tenant is not a row. */
function tenantAbsent(failure: unknown): boolean {
  return (
    typeof failure === "object" &&
    failure !== null &&
    "code" in failure &&
    failure.code === foreignKeyViolation &&
    "constraint" in failure &&
    failure.constraint === "chat_host_names_a_tenant"
  );
}

/** The lock every write to one member's chat host takes, held to the end of its transaction. */
async function chatHostLocked(
  client: pg.PoolClient,
  key: ChatHostKey,
): Promise<void> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
          'chat-host-registry:' || ${key.tenant} || '/' || ${key.owner}, 0))::text AS locked`,
  );
}

/** Every live attempt of the member's host whose principal is not its current one, ended. */
async function chatHostFenced(
  client: pg.PoolClient,
  key: ChatHostKey,
): Promise<void> {
  await client.query<{ fenced: string | null }>(
    sql`SELECT fence_chat_host_attempts(${key.tenant},${key.owner})::text AS fenced`,
  );
}

/** The member's host written in place of any other, what the replaced one held fenced. */
async function chatHostReplaced(
  client: pg.PoolClient,
  registration: ChatHostRegistration,
): Promise<ChatHostWritten> {
  await chatHostLocked(client, registration);
  const replaced = await client.query<{ client_id: string }>(
    sql`DELETE FROM chat_host h
        WHERE h.tenant=${registration.tenant}
          AND h.owner=${registration.owner}
        RETURNING h.client_id`,
  );
  await client.query(
    sql`INSERT INTO chat_host(tenant,owner,principal,client_id)
        VALUES(${registration.tenant as string},${registration.owner as string},${registration.principal as string},${registration.clientId})`,
  );
  await chatHostFenced(client, registration);
  const previous = replaced.rows[0]?.client_id;
  return previous === undefined
    ? { written: "Registered" }
    : { written: "Registered", replaced: previous };
}

/** The member's host naming `clientId` deleted, and what it held fenced. */
async function chatHostDeleted(
  client: pg.PoolClient,
  key: ChatHostKey,
  clientId: string,
): Promise<boolean> {
  await chatHostLocked(client, key);
  const deleted = await client.query(sql`DELETE FROM chat_host h
    WHERE h.tenant=${key.tenant as string} AND h.owner=${key.owner as string}
      AND h.client_id=${clientId}`);
  if ((deleted.rowCount ?? 0) !== 1) return false;
  await chatHostFenced(client, key);
  return true;
}

/** The member's host with its newest poll and the runner that poll named. */
async function chatHostRead(
  pool: pg.Pool,
  key: ChatHostKey,
): Promise<ChatHostView | undefined> {
  const found = await pool.query<{
    client_id: string;
    registered_at: Date;
    last_polled_at: Date | null;
    live: boolean | null;
    runner_package: string | null;
    runner_version: string | null;
  }>(sql`SELECT h.client_id,h.registered_at,h.last_polled_at,
      h.runner_package,h.runner_version,
      h.last_polled_at
        > now()-make_interval(secs=>${sessionRunnerPolledSecsMax}::double precision) AS live
    FROM chat_host h
    WHERE h.tenant=${key.tenant} AND h.owner=${key.owner}`);
  const row = found.rows[0];
  if (row === undefined) return undefined;
  return {
    id: row.client_id,
    registeredAt: row.registered_at.toISOString(),
    ...(row.last_polled_at === null
      ? {}
      : { polledAt: row.last_polled_at.toISOString() }),
    live: row.live === true,
    ...workerPoolRunnerKept(row),
  };
}

export function postgresChatHostRegistry(pool: pg.Pool): ChatHostRegistry {
  return {
    clientOf: async (key) => {
      const found = await pool.query<{ client_id: string }>(
        sql`SELECT h.client_id FROM chat_host h
          WHERE h.tenant=${key.tenant} AND h.owner=${key.owner}`,
      );
      return found.rows[0]?.client_id;
    },
    register: async (registration) => {
      try {
        return await postgresTransaction(pool, (client) =>
          chatHostReplaced(client, registration),
        );
      } catch (failure) {
        if (tenantAbsent(failure)) return { written: "NotFound" };
        throw failure;
      }
    },
    deregister: (key, clientId) =>
      postgresTransaction(pool, (client) =>
        chatHostDeleted(client, key, clientId),
      ),
    host: (key) => chatHostRead(pool, key),
  };
}

/** The chat host a poll's principal resolves to, read over the pool plane's pool. */
export function postgresChatHostPlaneRegistry(
  pool: pg.Pool,
): ChatHostPlaneRegistry {
  return {
    identify: async (principal) => {
      const found = await pool.query<{
        tenant: string;
        owner: string;
        principal: string;
      }>(sql`SELECT h.tenant,h.owner,h.principal FROM chat_host h
        WHERE h.principal=${principal}`);
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : {
            tenant: asTenantId(row.tenant),
            owner: asPrincipal(row.owner),
            principal: asPrincipal(row.principal),
          };
    },
  };
}
