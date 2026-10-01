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
 * THE CLAIM IS `workerPoolCanAssign`, DECIDED UNDER THE ROW LOCK. The execution
 * is `Launching`; an attempt no pool holds is a placement still waiting; the
 * unique `assignment` column refuses an identity already bound, by failing the
 * statement; `placement` is the route and the partition the account. The
 * registry row joined on the poll's own principal is a pool that is enabled,
 * polling under its current registration, and of a class the routed demand
 * allows. Its capabilities are the inventory, matched as
 * `workerPoolInventoryMatches` does and with a platform spelled as
 * `workerPoolPlatformToken` spells it, and the held count is the slot. The rest
 * hold before a claim is made: the bearer's authentication refuses a token that
 * lapsed and `workerPoolAdmitted` a principal that lost `Execute`, a claim is
 * made only by a poll, and
 * drain, trust, secrets, source and owner are constants every registered pool
 * and every routed execution holds.
 *
 * THE HELD COUNT IS THE DATABASE'S AND NOT THE POOL'S. It counts every attempt
 * under the pool's name that is still placing or running, so a pool that leaves
 * work out of its report claims no more for it. Claims by one pool are
 * serialized on an advisory lock taken in a statement of its own, because a
 * statement's snapshot is taken when it starts and a count taken in the claim's
 * own statement would miss a claim committed while it waited. The count is by
 * name rather than by registration, which is never less than the model's count
 * for the current one.
 *
 * AN IMAGE A CLAIM HANDS OUT IS ONE THE SITE ADMITTED. A claim sees an attempt
 * only once its invocation is recorded, and the scheduler records one only
 * after `schedulerPrepare` resolved the execution's profile, which refuses a
 * pinned image the site does not admit as `ExecutionPolicyDenied`.
 *
 * A RELEASE ENDS THE ATTEMPT, AND NO CLAIM IS MADE OF IT AGAIN. A pool that
 * answers that it cannot run what it claimed withdraws the attempt through
 * `release_worker_pool_assignment`, which keeps the pool's name on the row and
 * takes its bearer, so a harness the pool launched before answering is refused
 * on every route. The scheduler opens no attempt for an execution a pool has
 * claimed one of, and so concludes it. Nothing here clears `pool` once a claim
 * has set it.
 *
 * A REGISTRATION IS THE GENERATION AN ASSIGNMENT IS CURRENT UNDER. Each one
 * mints a new principal and a claim records it beside the pool's name.
 * Renewing, holding, refusing and releasing each require the caller to be
 * both the registration the claim recorded and the one the name is registered
 * under now, so a newer registration touches nothing an older one claimed, and
 * an older one touches nothing at all, however late its request arrives.
 * Registering also fences what the older one claimed: the attempt keeps its
 * lease and loses its bearer, so its harness is refused at once and the lapse
 * ends it `Lost`.
 *
 * EVERY STATEMENT IS SCOPED TO THE POOL THAT ASKED. An assignment is the only
 * handle a pool has, and each one is resolved together with the pool and the
 * registration holding it and its project, so nothing a pool can say reaches
 * another pool's work.
 */
import { sql } from "@ts-safeql/sql-tag";
import { createHash } from "node:crypto";
import type pg from "pg";

import { asExecutionRequirement } from "../../interpreter/executionRequirement.ts";
import { asPrincipal, type Principal } from "../../interpreter/principal.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  workerPoolsAnsweredMax,
  type WorkerPoolAssignments,
  type WorkerPoolClaimed,
  type WorkerPoolClaimTerms,
  type WorkerPoolDirectory,
  type WorkerPoolIdentity,
  type WorkerPoolRegistration,
  type WorkerPoolRegistry,
  type WorkerPoolRoster,
} from "../../interpreter/workerPool.ts";
import { asWorkerPoolClass } from "../../interpreter/workerPoolAssignment.ts";
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
  minted_by: string | null;
}): WorkerPoolRegistrationTokenTerms {
  return {
    partition: { tenant: row.tenant, project: row.project } as Partition,
    capabilities: row.capabilities,
    ...(row.minted_by === null ? {} : { mintedBy: asPrincipal(row.minted_by) }),
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
  mintedBy: Principal,
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
  await client.query(sql`INSERT INTO worker_pool_registration_token(token_digest,tenant,project,capabilities,expires_at,minted_by)
    VALUES(${digest},${partition.tenant},${partition.project},${[...capabilities]}::text[],to_timestamp(${expiresAtMs}::double precision/1000),${mintedBy as string})`);
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
    mint: (partition, digest, capabilities, expiresAtMs, mintedBy) =>
      postgresTransaction(pool, (client) =>
        workerPoolTokenMinted(
          client,
          partition,
          digest,
          capabilities,
          expiresAtMs,
          mintedBy,
        ),
      ),
    permitted: async (digest) => {
      const found = await pool.query<{
        tenant: string;
        project: string;
        capabilities: string[];
        minted_by: string | null;
      }>(sql`SELECT t.tenant,t.project,t.capabilities,t.minted_by
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
        minted_by: string | null;
      }>(sql`UPDATE worker_pool_registration_token t SET redeemed_at=now()
        WHERE t.token_digest=${digest} AND t.redeemed_at IS NULL AND t.expires_at>now()
        RETURNING t.tenant,t.project,t.capabilities,t.minted_by`);
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

/**
 * Registration is a fresh registration every time, so a re-register re-declares
 * the pool and fences every live attempt an older registration of the name
 * claimed.
 */
async function workerPoolRegistered(
  client: pg.PoolClient,
  registration: WorkerPoolRegistration,
): Promise<boolean> {
  const { partition } = registration;
  await client.query(sql`DELETE FROM worker_pool
    WHERE tenant=${partition.tenant} AND project=${partition.project} AND pool=${registration.pool}`);
  const inserted =
    await client.query(sql`INSERT INTO worker_pool(tenant,project,pool,capabilities,class,principal,client_id,registered_by)
    SELECT ${partition.tenant},${partition.project},${registration.pool},${[...registration.capabilities]}::text[],${registration.class},${registration.principal as string},${registration.clientId},${(registration.registeredBy ?? null) as string | null}
    WHERE EXISTS(SELECT 1 FROM project p
      WHERE p.tenant=${partition.tenant} AND p.project=${partition.project} AND p.lifecycle='Active')`);
  if ((inserted.rowCount ?? 0) !== 1) return false;
  await client.query<{ fenced: string | null }>(
    sql`SELECT fence_worker_pool_attempts(${partition.tenant},${partition.project},${registration.pool})::text AS fenced`,
  );
  return true;
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
        principal: string;
      }>(sql`SELECT w.tenant,w.project,w.pool,w.principal FROM worker_pool w
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
            principal: asPrincipal(row.principal),
          };
    },
  };
}

/** A project's registered pools over the API's pool, in name order and read one past the page as the roster's. */
export function postgresWorkerPoolDirectory(
  pool: pg.Pool,
): WorkerPoolDirectory {
  return {
    listed: async (partition) => {
      const found = await pool.query<{
        pool: string;
        capabilities: string[];
        registered_at: Date;
      }>(sql`SELECT w.pool,w.capabilities,w.registered_at FROM worker_pool w
        WHERE w.tenant=${partition.tenant} AND w.project=${partition.project}
        ORDER BY w.pool LIMIT ${workerPoolsAnsweredMax + 1}`);
      return {
        pools: found.rows.slice(0, workerPoolsAnsweredMax).map((row) => ({
          pool: row.pool,
          capabilities: row.capabilities,
          registeredAt: row.registered_at.toISOString(),
        })),
        truncated: found.rows.length > workerPoolsAnsweredMax,
      };
    },
  };
}

/**
 * A project's registered pools over a scheduler-role pool, in name order and
 * read one past the page, so a project registering more than one read answers
 * is told the page is partial rather than handed a short one.
 */
export function postgresWorkerPoolRoster(pool: pg.Pool): WorkerPoolRoster {
  return {
    registered: async (partition) => {
      const found = await pool.query<{
        pool: string;
        capabilities: string[];
        class: string;
        principal: string;
      }>(sql`SELECT w.pool,w.capabilities,w.class,w.principal FROM worker_pool w
        WHERE w.tenant=${partition.tenant} AND w.project=${partition.project}
        ORDER BY w.pool LIMIT ${workerPoolsAnsweredMax + 1}`);
      return {
        pools: found.rows.slice(0, workerPoolsAnsweredMax).map((row) => ({
          partition,
          pool: row.pool,
          capabilities: row.capabilities,
          class: asWorkerPoolClass(row.class),
          principal: asPrincipal(row.principal),
        })),
        truncated: found.rows.length > workerPoolsAnsweredMax,
      };
    },
  };
}

/**
 * One opened-but-unplaced attempt whose invocation is recorded, taken for this
 * pool where `workerPoolCanAssign` would take it, bound to the assignment it
 * will be cancelled by and to the bearer its harness answers under. The epoch
 * is not moved: this process fences nothing, and an attempt whose epoch has
 * since moved is one the scheduler's own fence will end under this pool's
 * feet, which the renewal answers as a stop.
 */
async function workerPoolClaimed(
  client: pg.PoolClient,
  identity: WorkerPoolIdentity,
  terms: WorkerPoolClaimTerms,
  assignment: string,
  bearer: string,
): Promise<WorkerPoolClaimed | undefined> {
  const { partition } = identity;
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
          'worker-pool-claim:' || ${partition.tenant} || '/' || ${partition.project} || '/' || ${identity.pool}, 0))::text AS locked`,
  );
  const found = await client.query<{ requirement: unknown }>(
    sql`UPDATE execution_attempt a SET
        pool=${identity.pool},pool_principal=${identity.principal},
        assignment=${assignment},pool_refusal=NULL,
        capability_secret_digest=${workerPoolDigest(bearer)},
        lease_owner=${identity.pool},
        lease_expires_at=now()+make_interval(secs=>${terms.leaseSecs}::double precision)
      FROM execution e
      WHERE e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
        AND (a.tenant,a.project,a.execution,a.attempt) IN (
        SELECT q.tenant,q.project,q.execution,q.attempt
        FROM execution_attempt q
        JOIN execution x
          ON x.tenant=q.tenant AND x.project=q.project AND x.execution=q.execution
        JOIN worker_pool w
          ON w.tenant=q.tenant AND w.project=q.project
        WHERE q.tenant=${partition.tenant} AND q.project=${partition.project}
          AND w.pool=${identity.pool} AND w.principal=${identity.principal}
          AND q.state='Placing' AND q.pool IS NULL AND q.invoked
          AND x.placement='Pool' AND x.status='Launching'
          AND q.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)
          AND w.class<>'Personal'
          AND CASE x.requirement_value->>'mode'
            WHEN 'Container' THEN
              'Platform:' || (x.requirement_value->>'operatingSystem') || ':' || (x.requirement_value->>'architecture')
                = ANY(w.capabilities)
            WHEN 'ContainerCapability' THEN
              'Platform:' || (x.requirement_value->>'operatingSystem') || ':' || (x.requirement_value->>'architecture')
                = ANY(w.capabilities)
              AND ARRAY(SELECT jsonb_array_elements_text(x.requirement_value->'capabilities')) <@ w.capabilities
            ELSE false END
          AND (SELECT count(*) FROM execution_attempt h
                WHERE h.tenant=q.tenant AND h.project=q.project AND h.pool=w.pool
                  AND h.state IN ('Placing','Running')) < ${terms.heldMax}::bigint
          AND EXISTS(SELECT 1 FROM project p
            WHERE p.tenant=q.tenant AND p.project=q.project AND p.lifecycle='Active')
        ORDER BY q.opened_at,q.attempt
        LIMIT 1 FOR UPDATE OF q, x SKIP LOCKED)
      RETURNING e.requirement_value AS requirement`,
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : { requirement: asExecutionRequirement(row.requirement) };
}

/** A claim's terms, each a positive whole number, checked before anything is locked. */
function workerPoolClaimTermsChecked(terms: WorkerPoolClaimTerms): void {
  if (!Number.isSafeInteger(terms.leaseSecs) || terms.leaseSecs < 1)
    throw new RangeError("invalid worker pool lease");
  if (!Number.isSafeInteger(terms.heldMax) || terms.heldMax < 1)
    throw new RangeError("invalid worker pool held bound");
}

/** One assignment given back, ended through the function that keeps the pool's name on it. */
async function workerPoolReleased(
  pool: pg.Pool,
  identity: WorkerPoolIdentity,
  assignment: string,
): Promise<boolean> {
  const released = await pool.query<{ released: boolean | null }>(
    sql`SELECT release_worker_pool_assignment(${identity.partition.tenant},${identity.partition.project},
          ${identity.pool},${identity.principal},${assignment})::boolean AS released`,
  );
  return released.rows[0]?.released === true;
}

/**
 * The images pinned by every attempt a renewal would extend, which is what a
 * pool holds: its registration's, live, leased, unrefused, current and in an
 * active project.
 */
async function workerPoolHeldImages(
  pool: pg.Pool,
  identity: WorkerPoolIdentity,
  heldMax: number,
): Promise<string[]> {
  if (!Number.isSafeInteger(heldMax) || heldMax < 1)
    throw new RangeError("invalid worker pool held bound");
  const found = await pool.query<{ image: string | null }>(
    sql`SELECT DISTINCT e.requirement_value->>'image' AS image
      FROM execution_attempt a
      JOIN execution e
        ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
      WHERE a.tenant=${identity.partition.tenant} AND a.project=${identity.partition.project}
        AND a.pool=${identity.pool} AND a.pool_principal=${identity.principal}
        AND EXISTS(SELECT 1 FROM worker_pool w
          WHERE w.tenant=a.tenant AND w.project=a.project AND w.pool=a.pool AND w.principal=${identity.principal})
        AND a.state IN ('Placing','Running')
        AND a.lease_expires_at>now() AND a.pool_refusal IS NULL
        AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)
        AND EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=a.tenant AND p.project=a.project AND p.lifecycle='Active')
        AND e.requirement_value->>'image' IS NOT NULL
      ORDER BY image LIMIT ${heldMax}`,
  );
  return found.rows.flatMap((row) => (row.image === null ? [] : [row.image]));
}

export function postgresWorkerPoolAssignments(
  pool: pg.Pool,
): WorkerPoolAssignments {
  return {
    claim: async (identity, terms, assignment, bearer) => {
      workerPoolClaimTermsChecked(terms);
      return postgresTransaction(pool, (client) =>
        workerPoolClaimed(client, identity, terms, assignment, bearer),
      );
    },
    renew: async (identity, assignment, leaseSecs) => {
      if (!Number.isSafeInteger(leaseSecs) || leaseSecs < 1)
        throw new RangeError("invalid worker pool lease");
      const updated =
        await pool.query(sql`UPDATE execution_attempt a SET lease_expires_at=now()+make_interval(secs=>${leaseSecs}::double precision)
        WHERE a.tenant=${identity.partition.tenant} AND a.project=${identity.partition.project}
          AND a.assignment=${assignment} AND a.pool=${identity.pool}
          AND a.pool_principal=${identity.principal}
          AND EXISTS(SELECT 1 FROM worker_pool w
            WHERE w.tenant=a.tenant AND w.project=a.project AND w.pool=a.pool AND w.principal=${identity.principal})
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
          AND a.pool_principal=${identity.principal}
          AND EXISTS(SELECT 1 FROM worker_pool w
            WHERE w.tenant=a.tenant AND w.project=a.project AND w.pool=a.pool AND w.principal=${identity.principal})
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now() AND a.pool_refusal IS NULL
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)`);
      return (updated.rowCount ?? 0) === 1;
    },
    release: (identity, assignment) =>
      workerPoolReleased(pool, identity, assignment),
    held: async (identity, assignment) => {
      const found = await pool.query<{ held: number }>(sql`SELECT 1 AS held
        FROM execution_attempt a
        WHERE a.tenant=${identity.partition.tenant} AND a.project=${identity.partition.project}
          AND a.assignment=${assignment} AND a.pool=${identity.pool}
          AND a.pool_principal=${identity.principal}
          AND EXISTS(SELECT 1 FROM worker_pool w
            WHERE w.tenant=a.tenant AND w.project=a.project AND w.pool=a.pool AND w.principal=${identity.principal})
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now()
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)`);
      return found.rows.length === 1;
    },
    heldImages: (identity, heldMax) =>
      workerPoolHeldImages(pool, identity, heldMax),
  };
}
