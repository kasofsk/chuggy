/**
 * The registry a pool is known by and the durable side of every assignment it
 * holds, both of them reachable without one line of the ticket machine.
 *
 * NO POOL SECRET IS STORED HERE AT ALL. A row keeps the principal the issuer's
 * subject resolves to, which is a public name rather than a credential. The
 * digest that remains is one attempt bearer's, written by a claim, and the
 * separation is the grant rather than a check any caller could forget: the
 * plane a harness reaches holds no privilege on `worker_pool`, and this one
 * holds none on an outcome.
 *
 * A CLAIM TAKES AN ATTEMPT THE SCHEDULER OPENED AND DID NOT PLACE. Opening one
 * needs the pinned revision, the briefing and the retry budget, all of which
 * are the scheduler's; what a pool adds is the placement. So the predicate
 * reads `placement = 'Pool'` and an attempt no pool holds yet, and it rebinds
 * `capability_secret_digest` to the bearer the assignment carries — the secret
 * the scheduler minted went to an in-cluster pod that was never launched, and
 * an attempt whose bearer nobody holds is an attempt nothing can report.
 *
 * A RELEASE IS A BACKOFF THE NEXT CLAIM READS. On the pool path
 * `placement_backoff_from` holds the instant a claim may next take the
 * execution — the pool's own `retryAfterSecs` from now — and the claim
 * predicate offers nothing before it. The scheduler writes the same column as
 * the instant its own interval counts from and reads it on the path that
 * places work itself, which is the other value of `placement`. A released row
 * is put back as the scheduler opened it: the lease is the attempt's own
 * again, and it ends past the backoff by what remained of the pool's lease at
 * the release — a pool that took most of its lease to answer has the rest to
 * claim again, and nothing here extends a lease a pool did not renew — so the
 * reaper, which ends any placing attempt whose lease has lapsed, cannot reach
 * the row before a pool may claim it and still bounds a row no pool comes back
 * for.
 *
 * THE CAPABILITIES COME BACK NULLABLE BECAUSE THE CHECKER CANNOT SEE OTHERWISE.
 * A correlated subquery over a joined row is a value `check-queries` proves
 * nothing about, so the row type says what the checker can see and the absence
 * is read as the empty list it is — a requirement naming no capability.
 *
 * EVERY STATEMENT IS SCOPED TO THE POOL THAT ASKED. An assignment is the only
 * handle a pool has, and each one is resolved together with the pool holding it
 * and its project, so nothing a pool can say reaches another pool's work.
 */
import { sql } from "@ts-safeql/sql-tag";
import { createHash } from "node:crypto";
import type pg from "pg";

import { workerPoolRetryAfterSecsMax } from "../../contract/workerPool.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type {
  WorkerPoolAssignments,
  WorkerPoolIdentity,
  WorkerPoolRegistration,
  WorkerPoolRegistry,
} from "../../interpreter/workerPool.ts";
import {
  workerPoolTokensLiveMax,
  type WorkerPoolRegistrationTokens,
  type WorkerPoolRegistrationTokenTerms,
  type WorkerPoolTokenWritten,
} from "../../interpreter/workerPoolRegistrationToken.ts";
import { postgresTransaction } from "./pool.ts";

/** One token's terms as either statement returns them, read the same way by both. */
function workerPoolTokenTerms(row: {
  tenant: string;
  project: string;
  capabilities: string[];
}): WorkerPoolRegistrationTokenTerms {
  return {
    partition: { tenant: row.tenant, project: row.project } as Partition,
    capabilities: row.capabilities,
  };
}

/**
 * One mint under the project's bound: the project's mints are serialized on an
 * advisory lock, its expired tokens are swept, and the row is written only
 * where an active project is named and fewer than `workerPoolTokensLiveMax`
 * unspent, unexpired tokens remain. A spent token is left until it expires,
 * because its redemption may still be under way and a fault there gives the
 * token back; the lifetime bound is what bounds how long a spent row stays.
 */
async function workerPoolTokenMinted(
  client: pg.PoolClient,
  partition: Partition,
  digest: string,
  capabilities: readonly string[],
  expiresAtMs: number,
): Promise<WorkerPoolTokenWritten> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
          'worker-pool-token:' || ${partition.tenant} || '/' || ${partition.project}, 0))::text AS locked`,
  );
  await client.query(sql`DELETE FROM worker_pool_registration_token t
    WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
      AND t.expires_at<=now()`);
  const counted = await client.query<{ active: boolean; live: number }>(
    sql`SELECT EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=${partition.tenant} AND p.project=${partition.project}
            AND p.lifecycle='Active') AS active,
        (SELECT count(*)::int FROM worker_pool_registration_token t
          WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
            AND t.redeemed_at IS NULL AND t.expires_at>now()) AS live`,
  );
  const row = counted.rows[0];
  if (row === undefined || !row.active) return "NotFound";
  if (row.live >= workerPoolTokensLiveMax) return "LimitReached";
  await client.query(sql`INSERT INTO worker_pool_registration_token(token_digest,tenant,project,capabilities,expires_at)
    VALUES(${digest},${partition.tenant},${partition.project},${[...capabilities]}::text[],to_timestamp(${expiresAtMs}::double precision/1000))`);
  return "Minted";
}

/**
 * The tokens an owner mints and a machine spends. `consume` is a conditional
 * update rather than a read and a write, so two machines redeeming one token
 * are separated by the statement and not by this process.
 */
export function postgresWorkerPoolRegistrationTokens(
  pool: pg.Pool,
): WorkerPoolRegistrationTokens {
  return {
    mint: (partition, digest, capabilities, expiresAtMs) =>
      postgresTransaction(pool, (client) =>
        workerPoolTokenMinted(
          client,
          partition,
          digest,
          capabilities,
          expiresAtMs,
        ),
      ),
    permitted: async (digest) => {
      const found = await pool.query<{
        tenant: string;
        project: string;
        capabilities: string[];
      }>(sql`SELECT t.tenant,t.project,t.capabilities
        FROM worker_pool_registration_token t
        WHERE t.token_digest=${digest} AND t.redeemed_at IS NULL AND t.expires_at>now()`);
      const row = found.rows[0];
      return row === undefined ? undefined : workerPoolTokenTerms(row);
    },
    consume: async (digest) => {
      const spent = await pool.query<{
        tenant: string;
        project: string;
        capabilities: string[];
      }>(sql`UPDATE worker_pool_registration_token t SET redeemed_at=now()
        WHERE t.token_digest=${digest} AND t.redeemed_at IS NULL AND t.expires_at>now()
        RETURNING t.tenant,t.project,t.capabilities`);
      const row = spent.rows[0];
      return row === undefined ? undefined : workerPoolTokenTerms(row);
    },
    restore: async (digest) => {
      const restored =
        await pool.query(sql`UPDATE worker_pool_registration_token t SET redeemed_at=NULL
        WHERE t.token_digest=${digest} AND t.expires_at>now()`);
      return (restored.rowCount ?? 0) === 1;
    },
  };
}

/** The digest one attempt bearer is stored as, which is the only secret this module handles. */
function workerPoolDigest(bearer: string): string {
  return createHash("sha256").update(bearer, "utf8").digest("hex");
}

/** Registration is a fresh registration every time, so a re-register re-declares the pool. */
async function workerPoolRegistered(
  client: pg.PoolClient,
  registration: WorkerPoolRegistration,
): Promise<boolean> {
  const { partition } = registration;
  await client.query(sql`DELETE FROM worker_pool
    WHERE tenant=${partition.tenant} AND project=${partition.project} AND pool=${registration.pool}`);
  const inserted =
    await client.query(sql`INSERT INTO worker_pool(tenant,project,pool,capabilities,principal,client_id)
    SELECT ${partition.tenant},${partition.project},${registration.pool},${[...registration.capabilities]}::text[],${registration.principal as string},${registration.clientId}
    WHERE EXISTS(SELECT 1 FROM project p
      WHERE p.tenant=${partition.tenant} AND p.project=${partition.project} AND p.lifecycle='Active')`);
  return (inserted.rowCount ?? 0) === 1;
}

export function postgresWorkerPoolRegistry(pool: pg.Pool): WorkerPoolRegistry {
  return {
    register: (registration) =>
      postgresTransaction(pool, (client) =>
        workerPoolRegistered(client, registration),
      ),
    clientOf: async (partition, named) => {
      const found = await pool.query<{ client_id: string }>(
        sql`SELECT w.client_id FROM worker_pool w
        WHERE w.tenant=${partition.tenant} AND w.project=${partition.project} AND w.pool=${named}`,
      );
      return found.rows[0]?.client_id;
    },
    deregister: async (partition, named, clientId) => {
      const deleted = await pool.query(sql`DELETE FROM worker_pool
        WHERE tenant=${partition.tenant} AND project=${partition.project} AND pool=${named}
          AND client_id=${clientId}`);
      return (deleted.rowCount ?? 0) === 1;
    },
    identify: async (principal) => {
      const found = await pool.query<{
        tenant: string;
        project: string;
        pool: string;
        capabilities: string[];
      }>(sql`SELECT w.tenant,w.project,w.pool,w.capabilities FROM worker_pool w
        WHERE w.principal=${principal}
          AND EXISTS(SELECT 1 FROM project p
            WHERE p.tenant=w.tenant AND p.project=w.project AND p.lifecycle='Active')`);
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : {
            partition: {
              tenant: row.tenant,
              project: row.project,
            } as Partition,
            pool: row.pool,
            capabilities: row.capabilities,
          };
    },
  };
}

/**
 * One opened-but-unplaced attempt taken for this pool, bound to the assignment
 * it will be cancelled by and to the bearer its harness answers under. The
 * epoch is not moved: this process fences nothing, and an attempt whose epoch
 * has since moved is one the scheduler's own fence will end under this pool's
 * feet, which the renewal answers as a stop.
 */
async function workerPoolClaimed(
  pool: pg.Pool,
  identity: WorkerPoolIdentity,
  leaseSecs: number,
  assignment: string,
  bearer: string,
): Promise<{ capabilities: string[] } | undefined> {
  const found = await pool.query<{ capabilities: string[] | null }>(
    sql`UPDATE execution_attempt a SET
        pool=${identity.pool},assignment=${assignment},pool_refusal=NULL,
        capability_secret_digest=${workerPoolDigest(bearer)},
        lease_owner=${identity.pool},
        lease_expires_at=now()+make_interval(secs=>${leaseSecs}::double precision)
      WHERE (a.tenant,a.project,a.execution,a.attempt) IN (
        SELECT q.tenant,q.project,q.execution,q.attempt
        FROM execution_attempt q
        JOIN execution e
          ON e.tenant=q.tenant AND e.project=q.project AND e.execution=q.execution
        WHERE q.tenant=${identity.partition.tenant} AND q.project=${identity.partition.project}
          AND q.state='Placing' AND q.pool IS NULL
          AND e.placement='Pool' AND e.status IN ('Admitted','Launching')
          AND (e.placement_backoff_from IS NULL OR e.placement_backoff_from<=now())
          AND q.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)
          AND COALESCE(ARRAY(SELECT jsonb_array_elements_text(e.requirement_value->'capabilities')),'{}'::text[])
              <@ ${[...identity.capabilities]}::text[]
          AND EXISTS(SELECT 1 FROM project p
            WHERE p.tenant=q.tenant AND p.project=q.project AND p.lifecycle='Active')
        ORDER BY q.opened_at,q.attempt
        LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING COALESCE(ARRAY(SELECT jsonb_array_elements_text(
        (SELECT e.requirement_value->'capabilities' FROM execution e
          WHERE e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution))),'{}'::text[]) AS capabilities`,
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : { capabilities: row.capabilities ?? [] };
}

/** One assignment given back: the row parked under the attempt's own lease, and the backoff written beside it. */
function workerPoolReleased(
  pool: pg.Pool,
  identity: WorkerPoolIdentity,
  assignment: string,
  retryAfterSecs: number,
): Promise<boolean> {
  return postgresTransaction(pool, async (client) => {
    const released = await client.query<{
      tenant: string;
      project: string;
      execution: string;
    }>(sql`UPDATE execution_attempt a SET pool=NULL,assignment=NULL,pool_refusal=NULL,
            lease_owner=a.attempt,
            lease_expires_at=a.lease_expires_at+make_interval(secs=>${retryAfterSecs}::double precision)
          WHERE a.tenant=${identity.partition.tenant} AND a.project=${identity.partition.project}
            AND a.assignment=${assignment} AND a.pool=${identity.pool} AND a.state='Placing'
            AND a.lease_expires_at>now() AND a.pool_refusal IS NULL
            AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)
          RETURNING a.tenant,a.project,a.execution`);
    const row = released.rows[0];
    if (row === undefined) return false;
    await client.query(sql`UPDATE execution e
          SET placement_backoff_from=now()+make_interval(secs=>${retryAfterSecs}::double precision)
          WHERE e.tenant=${row.tenant} AND e.project=${row.project} AND e.execution=${row.execution}`);
    return true;
  });
}

export function postgresWorkerPoolAssignments(
  pool: pg.Pool,
): WorkerPoolAssignments {
  return {
    claim: async (identity, leaseSecs, assignment, bearer) => {
      if (!Number.isSafeInteger(leaseSecs) || leaseSecs < 1)
        throw new RangeError("invalid worker pool lease");
      return workerPoolClaimed(pool, identity, leaseSecs, assignment, bearer);
    },
    renew: async (identity, assignment, leaseSecs) => {
      if (!Number.isSafeInteger(leaseSecs) || leaseSecs < 1)
        throw new RangeError("invalid worker pool lease");
      const updated =
        await pool.query(sql`UPDATE execution_attempt a SET lease_expires_at=now()+make_interval(secs=>${leaseSecs}::double precision)
        WHERE a.tenant=${identity.partition.tenant} AND a.project=${identity.partition.project}
          AND a.assignment=${assignment} AND a.pool=${identity.pool}
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now() AND a.pool_refusal IS NULL
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)
          AND EXISTS(SELECT 1 FROM project p
            WHERE p.tenant=a.tenant AND p.project=a.project AND p.lifecycle='Active')`);
      return (updated.rowCount ?? 0) === 1;
    },
    refuse: async (identity, assignment, evidence) => {
      const updated =
        await pool.query(sql`UPDATE execution_attempt a SET pool_refusal=${evidence}
        WHERE a.tenant=${identity.partition.tenant} AND a.project=${identity.partition.project}
          AND a.assignment=${assignment} AND a.pool=${identity.pool}
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now() AND a.pool_refusal IS NULL
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)`);
      return (updated.rowCount ?? 0) === 1;
    },
    release: async (identity, assignment, retryAfterSecs) => {
      if (
        !Number.isSafeInteger(retryAfterSecs) ||
        retryAfterSecs < 1 ||
        retryAfterSecs > workerPoolRetryAfterSecsMax
      )
        throw new RangeError("invalid worker pool retry interval");
      return workerPoolReleased(pool, identity, assignment, retryAfterSecs);
    },
    held: async (identity, assignment) => {
      const found = await pool.query<{ held: number }>(sql`SELECT 1 AS held
        FROM execution_attempt a
        WHERE a.tenant=${identity.partition.tenant} AND a.project=${identity.partition.project}
          AND a.assignment=${assignment} AND a.pool=${identity.pool}
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now()
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)`);
      return found.rows.length === 1;
    },
  };
}
