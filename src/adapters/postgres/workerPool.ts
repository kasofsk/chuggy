/**
 * The registry a pool is known by and the durable side of every assignment it
 * holds, both of them reachable without one line of the ticket machine.
 *
 * NO POOL SECRET IS STORED HERE AT ALL. A row keeps the principal the issuer's
 * subject resolves to, which is a public name rather than a credential, and it
 * is looked up in `worker_pool` alone — a relation the plane that serves
 * harnesses holds no privilege on. The digest that remains is one attempt
 * bearer's, written by a claim, and the separation is the grant rather than a
 * check any caller could forget.
 *
 * EVERY STATEMENT IS SCOPED TO THE POOL THAT ASKED. An assignment is the only
 * handle a pool has, and each one is resolved together with the pool holding it
 * and its project, so nothing a pool can say reaches another pool's work.
 */
import { sql } from "@ts-safeql/sql-tag";
import { createHash } from "node:crypto";
import type pg from "pg";

import type { Partition } from "../../interpreter/projectStore.ts";
import type {
  WorkerPoolAssignments,
  WorkerPoolIdentity,
  WorkerPoolRegistration,
  WorkerPoolRegistry,
} from "../../interpreter/workerPool.ts";
import type {
  WorkerPoolRegistrationTokens,
  WorkerPoolRegistrationTokenTerms,
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
 * The tokens an owner mints and a machine spends. `consume` is a conditional
 * update rather than a read and a write, so two machines redeeming one token
 * are separated by the statement and not by this process.
 */
export function postgresWorkerPoolRegistrationTokens(
  pool: pg.Pool,
): WorkerPoolRegistrationTokens {
  return {
    mint: async (partition, digest, capabilities, expiresAtMs) => {
      const inserted =
        await pool.query(sql`INSERT INTO worker_pool_registration_token(token_digest,tenant,project,capabilities,expires_at)
        SELECT ${digest},${partition.tenant},${partition.project},${[...capabilities]}::text[],to_timestamp(${expiresAtMs}::double precision/1000)
        WHERE EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=${partition.tenant} AND p.project=${partition.project}
            AND p.lifecycle='Active' AND p.ticket_model='Chuggernaut')`);
      return (inserted.rowCount ?? 0) === 1;
    },
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
  };
}

/** The digest one attempt bearer is stored as, which is the only secret this module handles. */
function workerPoolDigest(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
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
    deregister: async (partition, named) => {
      const deleted = await pool.query<{ client_id: string }>(
        sql`DELETE FROM worker_pool
        WHERE tenant=${partition.tenant} AND project=${partition.project} AND pool=${named}
        RETURNING client_id`,
      );
      return deleted.rows[0]?.client_id;
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
            WHERE p.tenant=w.tenant AND p.project=w.project
              AND p.lifecycle='Active' AND p.ticket_model='Chuggernaut')`);
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
 * One queued row taken for this pool, bound to the assignment it will be
 * cancelled by and to the bearer its harness answers under. The epoch is read
 * in the statement rather than carried by the caller: this process fences
 * nothing, and a claim written under an epoch that has since moved is a claim
 * the orchestrator would refuse the terminal of.
 */
async function workerPoolClaimed(
  pool: pg.Pool,
  identity: WorkerPoolIdentity,
  leaseSecs: number,
  assignment: string,
  bearer: string,
  attemptsUnreportedMax: number,
): Promise<{ view: unknown; capabilities: string[] } | undefined> {
  const found = await pool.query<{
    worker_view: unknown;
    required_capabilities: string[];
  }>(sql`UPDATE ticket_execution e SET
      state='Running',attempt=e.attempt+1,claim_owner=${identity.pool},pool=${identity.pool},
      assignment=${assignment},capability_digest=${workerPoolDigest(bearer)},pool_refusal=NULL,last_reported_at=NULL,
      attempts_unreported=e.attempts_unreported+(CASE WHEN e.state='Running' AND e.claim_expires_at<=now()
        AND e.worker_outcome IS NULL AND e.pool_refusal IS NULL THEN 1 ELSE 0 END),
      claim_expires_at=now()+make_interval(secs=>${leaseSecs}::double precision),
      recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
    WHERE (e.tenant,e.project,e.task_key) IN (
      SELECT q.tenant,q.project,q.task_key FROM ticket_execution q
      WHERE q.tenant=${identity.partition.tenant} AND q.project=${identity.partition.project}
        AND (q.state='Queued' OR (q.state='Running' AND q.claim_expires_at<=now()))
        AND q.available_at<=now() AND q.worker_view IS NOT NULL
        AND q.required_capabilities <@ ${[...identity.capabilities]}::text[]
        AND q.attempts_unreported<${attemptsUnreportedMax}
        AND EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=q.tenant AND p.project=q.project AND p.lifecycle='Active'
            AND p.ticket_model='Chuggernaut')
        ORDER BY q.available_at,q.task_key
      LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING e.worker_view,e.required_capabilities`);
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : { view: row.worker_view, capabilities: row.required_capabilities };
}

export function postgresWorkerPoolAssignments(
  pool: pg.Pool,
): WorkerPoolAssignments {
  return {
    claim: async (
      identity,
      leaseSecs,
      assignment,
      bearer,
      attemptsUnreportedMax,
    ) => {
      if (!Number.isSafeInteger(leaseSecs) || leaseSecs < 1)
        throw new RangeError("invalid worker pool lease");
      return workerPoolClaimed(
        pool,
        identity,
        leaseSecs,
        assignment,
        bearer,
        attemptsUnreportedMax,
      );
    },
    renew: async (identity, assignment, leaseSecs) => {
      if (!Number.isSafeInteger(leaseSecs) || leaseSecs < 1)
        throw new RangeError("invalid worker pool lease");
      const updated =
        await pool.query(sql`UPDATE ticket_execution e SET claim_expires_at=now()+make_interval(secs=>${leaseSecs}::double precision)
        WHERE e.tenant=${identity.partition.tenant} AND e.project=${identity.partition.project}
          AND e.assignment=${assignment} AND e.pool=${identity.pool} AND e.state='Running'
          AND e.claim_expires_at>now() AND e.pool_refusal IS NULL
          AND e.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
          AND EXISTS(SELECT 1 FROM project p
            WHERE p.tenant=e.tenant AND p.project=e.project AND p.lifecycle='Active')`);
      return (updated.rowCount ?? 0) === 1;
    },
    refuse: async (identity, assignment, evidence) => {
      const updated =
        await pool.query(sql`UPDATE ticket_execution e SET pool_refusal=${evidence}
        WHERE e.tenant=${identity.partition.tenant} AND e.project=${identity.partition.project}
          AND e.assignment=${assignment} AND e.pool=${identity.pool} AND e.state='Running'
          AND e.claim_expires_at>now() AND e.pool_refusal IS NULL
          AND e.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
      return (updated.rowCount ?? 0) === 1;
    },
    release: async (identity, assignment, retryAfterSecs) => {
      if (!Number.isSafeInteger(retryAfterSecs) || retryAfterSecs < 1)
        throw new RangeError("invalid worker pool retry interval");
      const updated =
        await pool.query(sql`UPDATE ticket_execution e SET state='Queued',
          claim_owner=NULL,claim_expires_at=NULL,recovery_epoch=NULL,pool=NULL,assignment=NULL,
          capability_digest=NULL,
          available_at=now()+make_interval(secs=>${retryAfterSecs}::double precision)
        WHERE e.tenant=${identity.partition.tenant} AND e.project=${identity.partition.project}
          AND e.assignment=${assignment} AND e.pool=${identity.pool} AND e.state='Running'
          AND e.claim_expires_at>now() AND e.pool_refusal IS NULL
          AND e.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
      return (updated.rowCount ?? 0) === 1;
    },
    held: async (identity, assignment) => {
      const found = await pool.query<{ held: number }>(sql`SELECT 1 AS held
        FROM ticket_execution e
        WHERE e.tenant=${identity.partition.tenant} AND e.project=${identity.partition.project}
          AND e.assignment=${assignment} AND e.pool=${identity.pool} AND e.state='Running'
          AND e.claim_expires_at>now()
          AND e.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
      return found.rows.length === 1;
    },
  };
}
