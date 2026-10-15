/**
 * The durable side of an execution a member's personal runner claims: the
 * claim, and every call that holds and settles what it claimed, over the pool
 * plane's pool.
 *
 * THE CLAIM IS `workerPoolCanAssign` FOR A PERSONAL RUNNER, DECIDED UNDER THE
 * ROW LOCK as a pool's is in `./workerPool.ts`. The execution is `Launching`
 * with an attempt no runner holds; its project allows a personal runner,
 * which is `owner_fallback` named; its owner is the runner's, which a NULL
 * owner never is; its project is on the runner's allowlist, which also holds
 * it to the runner's tenant; the runner's row names the poll's principal, so
 * it is enabled and current; its capabilities run the requirement; and its
 * held count, across every project it serves, is the slot. The owner's
 * fallback refuses a personal runner nothing. Its permit was asked when its
 * poll was admitted, and its owner's `Read` of each project before the claim,
 * which names only the projects that answered.
 *
 * WHAT IT HOLDS IS WHAT ITS REGISTRATION CLAIMED, IN A PROJECT IT STILL SERVES.
 * Every call after the claim requires the attempt's principal to be the
 * runner's current one and its project to be on the allowlist, so a project
 * taken off stops what the runner holds there, as its sessions do.
 */
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { asExecutionRequirement } from "../../interpreter/executionRequirement.ts";
import { asProjectId, type ProjectId } from "../../interpreter/projectStore.ts";
import type {
  PersonalRunnerIdentity,
  WorkerPoolClaimed,
  WorkerPoolClaimTerms,
  WorkerPoolExecutionHolds,
} from "../../interpreter/workerPool.ts";

/** What one claim binds beyond who claims: the assignment, its bearer's digest, and the projects its owner may still read. */
export interface PersonalExecutionClaim {
  readonly assignment: string;
  readonly digest: string;
  readonly projects: readonly ProjectId[];
}

/** One unplaced attempt of the owner's, taken for their runner where `workerPoolCanAssign` would take it, serialized with every other claim and fence of the runner. */
export async function personalExecutionClaimed(
  client: pg.PoolClient,
  identity: PersonalRunnerIdentity,
  terms: WorkerPoolClaimTerms,
  claim: PersonalExecutionClaim,
): Promise<WorkerPoolClaimed | undefined> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
          'personal-runner-claim:' || ${identity.tenant} || '/' || ${identity.owner}, 0))::text AS locked`,
  );
  const found = await client.query<{ requirement: unknown }>(
    sql`UPDATE execution_attempt a SET
        pool=${identity.owner},pool_principal=${identity.principal},
        personal=true,assignment=${claim.assignment},pool_refusal=NULL,
        capability_secret_digest=${claim.digest},
        lease_owner=${identity.owner},
        lease_expires_at=now()+make_interval(secs=>${terms.leaseSecs}::double precision)
      FROM execution e
      WHERE e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
        AND (a.tenant,a.project,a.execution,a.attempt) IN (
        SELECT q.tenant,q.project,q.execution,q.attempt
        FROM execution_attempt q
        JOIN execution x
          ON x.tenant=q.tenant AND x.project=q.project AND x.execution=q.execution
        JOIN personal_runner r ON r.tenant=q.tenant
        JOIN personal_runner_project l
          ON l.tenant=r.tenant AND l.owner=r.owner AND l.project=q.project
        WHERE q.tenant=${identity.tenant} AND r.owner=${identity.owner}
          AND r.principal=${identity.principal}
          AND q.project=ANY(${[...claim.projects] as string[]}::text[])
          AND q.state='Placing' AND q.pool IS NULL AND q.invoked
          AND x.placement='Pool' AND x.status='Launching'
          AND x.owner_fallback IS NOT NULL AND x.owner=r.owner
          AND q.recovery_epoch=(SELECT e.epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1)
          AND worker_pool_inventory_matches(x.requirement_value,r.capabilities)
          AND (SELECT count(*) FROM execution_attempt h
                WHERE h.tenant=q.tenant AND h.personal AND h.pool=r.owner
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

/** The projects the runner's current registration allowlists. */
export async function personalExecutionsAllowlisted(
  pool: pg.Pool,
  identity: PersonalRunnerIdentity,
): Promise<readonly ProjectId[]> {
  const found = await pool.query<{ project: string }>(
    sql`SELECT l.project FROM personal_runner r
      JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
      WHERE r.tenant=${identity.tenant} AND r.owner=${identity.owner}
        AND r.principal=${identity.principal}
      ORDER BY l.project`,
  );
  return found.rows.map((row) => asProjectId(row.project));
}

/** Stamps the runner's poll as one that could take an execution, where its row still names this registration. */
export async function personalExecutionsPolled(
  pool: pg.Pool,
  identity: PersonalRunnerIdentity,
): Promise<void> {
  await pool.query(
    sql`UPDATE personal_runner r SET executions_polled_at=now()
          WHERE r.tenant=${identity.tenant} AND r.owner=${identity.owner}
            AND r.principal=${identity.principal}`,
  );
}

/** The images pinned by every attempt a renewal would extend. */
async function personalExecutionImages(
  pool: pg.Pool,
  identity: PersonalRunnerIdentity,
  heldMax: number,
): Promise<string[]> {
  if (!Number.isSafeInteger(heldMax) || heldMax < 1)
    throw new RangeError("invalid personal runner held bound");
  const found = await pool.query<{ image: string | null }>(
    sql`SELECT DISTINCT e.requirement_value->>'image' AS image
      FROM execution_attempt a
      JOIN execution e
        ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
      WHERE a.tenant=${identity.tenant} AND a.personal AND a.pool=${identity.owner}
        AND a.pool_principal=${identity.principal}
        AND EXISTS(SELECT 1 FROM personal_runner r
          JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
          WHERE r.tenant=a.tenant AND r.owner=a.pool AND r.principal=${identity.principal}
            AND l.project=a.project)
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

/** What a personal runner holds, through the registration that claimed it. */
export function postgresPersonalExecutionHolds(
  pool: pg.Pool,
): WorkerPoolExecutionHolds<PersonalRunnerIdentity> {
  return {
    renew: async (identity, assignment, leaseSecs) => {
      if (!Number.isSafeInteger(leaseSecs) || leaseSecs < 1)
        throw new RangeError("invalid personal runner lease");
      const updated =
        await pool.query(sql`UPDATE execution_attempt a SET lease_expires_at=now()+make_interval(secs=>${leaseSecs}::double precision)
        WHERE a.tenant=${identity.tenant as string} AND a.assignment=${assignment}
          AND a.personal AND a.pool=${identity.owner as string}
          AND a.pool_principal=${identity.principal as string}
          AND EXISTS(SELECT 1 FROM personal_runner r
            JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
            WHERE r.tenant=a.tenant AND r.owner=a.pool AND r.principal=${identity.principal as string}
              AND l.project=a.project)
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now() AND a.pool_refusal IS NULL
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)
          AND EXISTS(SELECT 1 FROM project p
            WHERE p.tenant=a.tenant AND p.project=a.project AND p.lifecycle='Active')`);
      return (updated.rowCount ?? 0) === 1;
    },
    refuse: async (identity, assignment, evidence, fault) => {
      const updated =
        await pool.query(sql`UPDATE execution_attempt a SET pool_refusal=${evidence},pool_refusal_fault=${fault ?? null}
        WHERE a.tenant=${identity.tenant as string} AND a.assignment=${assignment}
          AND a.personal AND a.pool=${identity.owner as string}
          AND a.pool_principal=${identity.principal as string}
          AND EXISTS(SELECT 1 FROM personal_runner r
            JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
            WHERE r.tenant=a.tenant AND r.owner=a.pool AND r.principal=${identity.principal as string}
              AND l.project=a.project)
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now() AND a.pool_refusal IS NULL
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)`);
      return (updated.rowCount ?? 0) === 1;
    },
    release: async (identity, assignment) => {
      const released = await pool.query<{ released: boolean | null }>(
        sql`SELECT release_personal_execution_assignment(${identity.tenant},${identity.owner},
              ${identity.principal},${assignment})::boolean AS released`,
      );
      return released.rows[0]?.released === true;
    },
    held: async (identity, assignment) => {
      const found = await pool.query<{ held: number }>(sql`SELECT 1 AS held
        FROM execution_attempt a
        WHERE a.tenant=${identity.tenant} AND a.assignment=${assignment}
          AND a.personal AND a.pool=${identity.owner}
          AND a.pool_principal=${identity.principal}
          AND EXISTS(SELECT 1 FROM personal_runner r
            JOIN personal_runner_project l ON l.tenant=r.tenant AND l.owner=r.owner
            WHERE r.tenant=a.tenant AND r.owner=a.pool AND r.principal=${identity.principal}
              AND l.project=a.project)
          AND a.state IN ('Placing','Running')
          AND a.lease_expires_at>now()
          AND a.recovery_epoch=(SELECT r.epoch FROM recovery_epoch r ORDER BY r.ordinal DESC LIMIT 1)`);
      return found.rows.length === 1;
    },
    heldImages: (identity, heldMax) =>
      personalExecutionImages(pool, identity, heldMax),
  };
}
