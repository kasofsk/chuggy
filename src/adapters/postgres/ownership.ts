/**
 * Ownership: the recovery epoch, the project row, and the time-bounded lease
 * that is the only thing authorizing a writer.
 *
 * EVERY DECISION HERE HAPPENS UNDER THE PARTITION ROW LOCK. Acquisition,
 * renewal, release and fencing all lock `project` for the partition and then
 * read what they are about to change, so two replicas racing for the same
 * project serialize rather than interleave. The alternative — a conditional
 * `UPDATE` with the whole test in its `WHERE` — is atomic too, but it reports
 * only how many rows it changed, and a caller cannot tell a lost race from a
 * suspended project by counting to zero.
 *
 * ACQUISITION ADVANCES THE FENCING EPOCH AND RENEWAL DOES NOT. That asymmetry
 * is the whole fence: a former owner that resumes after a pause finds its
 * epoch superseded and can commit nothing, while an unbroken tenure keeps one
 * identity across as many renewals as it likes.
 *
 * THE EPOCH IS READ INSIDE THE TRANSACTION THAT USES IT, never before. A
 * restore establishes a new global epoch and then permits mutation, so a lease
 * stamped from a value read a moment earlier would carry authority the restore
 * had already withdrawn.
 *
 * A DURATION IS CHECKED BEFORE A TRANSACTION IS OPENED. Zero, a negative and a
 * non-finite second all reach `make_interval` and come back as a row that
 * granted a lease and reports none, which arrives at the caller as a server
 * anomaly rather than as the argument it was; the check names the argument
 * instead, at the entry, before anything is written.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  asRecoveryEpoch,
  type Acquired,
  type Lease,
  type Lifecycle,
  type OwnerId,
  type Partition,
  type ProjectStanding,
  type RecoveryEpoch,
  type Renewed,
} from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";
import { notificationPublishFunction } from "./schema.ts";
import {
  projectRowHonours,
  projectRowLease,
  projectRowStanding,
  type ProjectRow,
} from "./rows.ts";

/** The latest epoch, or a start-up failure when the database has never had one. */
export async function postgresOwnershipEpoch(
  client: pg.PoolClient,
): Promise<RecoveryEpoch> {
  const found = await client.query<{ epoch: string }>(
    sql`SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1`,
  );
  const latest = found.rows[0];
  if (latest === undefined) {
    throw new Error(
      "postgres ownership: this database has no recovery epoch, so no lease can be issued under one",
    );
  }
  return asRecoveryEpoch(latest.epoch);
}

/** Appends a new global epoch, refusing one this database has already issued authority under. */
export async function postgresOwnershipEstablishEpoch(
  client: pg.PoolClient,
  epoch: RecoveryEpoch,
): Promise<RecoveryEpoch> {
  const written = await client.query<{ epoch: string }>(
    sql`INSERT INTO recovery_epoch (epoch) VALUES (${epoch}) ON CONFLICT (epoch) DO NOTHING RETURNING epoch`,
  );
  const row = written.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres ownership: recovery epoch ${epoch} was already established, and an epoch is never reused`,
    );
  }
  return asRecoveryEpoch(row.epoch);
}

/**
 * Whether the row still grants this lease under the epoch authority is
 * currently issued in. The row check alone is not enough: a restore leaves
 * every project-local counter exactly as the lost interval wrote it, so a
 * pre-restore owner finds its own owner, fencing epoch and expiry intact and
 * would otherwise still be honoured.
 */
export async function postgresOwnershipHonours(
  client: pg.PoolClient,
  row: ProjectRow,
  lease: Lease,
): Promise<boolean> {
  if (!projectRowHonours(row, lease)) return false;
  return (await postgresOwnershipEpoch(client)) === lease.recoveryEpoch;
}

/** Locks the partition row and returns it, or undefined when no such project was provisioned. */
export async function postgresOwnershipLock(
  client: pg.PoolClient,
  partition: Partition,
): Promise<ProjectRow | undefined> {
  const found = await client.query<ProjectRow>(
    sql`SELECT p.tenant, p.project, p.lifecycle, p.lifecycle_generation,
           p.fencing_epoch, p.head, p.owner, p.recovery_epoch,
           (p.owner IS NOT NULL AND p.lease_expires_at > now()) IS TRUE AS lease_live
      FROM project p
     WHERE p.tenant = ${partition.tenant} AND p.project = ${partition.project}
       FOR UPDATE`,
  );
  return found.rows[0];
}

/** Locks the partition row, refusing a partition nothing provisioned. */
export async function postgresOwnershipLockKnown(
  client: pg.PoolClient,
  partition: Partition,
): Promise<ProjectRow> {
  const row = await postgresOwnershipLock(client, partition);
  if (row === undefined) {
    throw new Error(
      `postgres ownership: ${partition.tenant}/${partition.project} was never provisioned`,
    );
  }
  return row;
}

/** Provisions an `Active` project with an empty journal, absorbing a repeat on the composite key. */
export async function postgresOwnershipCreate(
  pool: pg.Pool,
  partition: Partition,
): Promise<ProjectStanding> {
  return postgresTransaction(pool, async (client) => {
    await client.query(
      sql`INSERT INTO project (tenant, project, lifecycle) VALUES (${partition.tenant}, ${partition.project}, 'Active') ON CONFLICT (tenant, project) DO NOTHING`,
    );
    return projectRowStanding(
      await postgresOwnershipLockKnown(client, partition),
    );
  });
}

/** What the partition row says, without taking or proving any ownership of it. */
export async function postgresOwnershipStanding(
  pool: pg.Pool,
  partition: Partition,
): Promise<ProjectStanding | undefined> {
  const found = await pool.query<ProjectRow>(
    sql`SELECT p.tenant, p.project, p.lifecycle, p.lifecycle_generation,
           p.fencing_epoch, p.head, p.owner, p.recovery_epoch,
           (p.owner IS NOT NULL AND p.lease_expires_at > now()) IS TRUE AS lease_live
      FROM project p
     WHERE p.tenant = ${partition.tenant} AND p.project = ${partition.project}`,
  );
  const row = found.rows[0];
  return row === undefined ? undefined : projectRowStanding(row);
}

/** Refuses a duration no lease can be granted for, naming the argument rather than the row it would spoil. */
function postgresOwnershipRequireLeaseSecs(leaseSecs: number): void {
  if (!Number.isFinite(leaseSecs) || leaseSecs <= 0) {
    throw new RangeError(
      `postgres ownership: leaseSecs is ${String(leaseSecs)}, and a lease is granted for a positive finite number of seconds`,
    );
  }
}

/** Writes the granted lease onto the locked row and returns what it now grants. */
async function postgresOwnershipGrant(
  client: pg.PoolClient,
  partition: Partition,
  owner: OwnerId,
  leaseSecs: number,
): Promise<Lease> {
  const epoch = await postgresOwnershipEpoch(client);
  const granted = await client.query<ProjectRow>(
    sql`UPDATE project
        SET owner = ${owner},
            lease_expires_at = now() + make_interval(secs => ${leaseSecs}::double precision),
            fencing_epoch = fencing_epoch + 1,
            recovery_epoch = ${epoch}
      WHERE tenant = ${partition.tenant} AND project = ${partition.project}
      RETURNING tenant, project, lifecycle, lifecycle_generation,
                fencing_epoch, head, owner, recovery_epoch,
                (owner IS NOT NULL AND lease_expires_at > now()) IS TRUE AS lease_live`,
  );
  const lease = projectRowLease(postgresOwnershipRow(granted));
  if (lease === undefined) {
    throw new Error(
      `postgres ownership: ${partition.tenant}/${partition.project} accepted a lease and then reported none`,
    );
  }
  return lease;
}

/** The single row a statement that changes exactly one partition must have returned. */
function postgresOwnershipRow(result: pg.QueryResult<ProjectRow>): ProjectRow {
  const row = result.rows[0];
  if (row === undefined || result.rows.length !== 1) {
    throw new Error(
      `postgres ownership: a partition statement touched ${String(result.rows.length)} rows`,
    );
  }
  return row;
}

/** Takes ownership for `leaseSecs` of database time, advancing the fencing epoch as it does. */
export async function postgresOwnershipAcquire(
  pool: pg.Pool,
  partition: Partition,
  owner: OwnerId,
  leaseSecs: number,
): Promise<Acquired> {
  postgresOwnershipRequireLeaseSecs(leaseSecs);
  return postgresTransaction(pool, async (client) => {
    const row = await postgresOwnershipLockKnown(client, partition);
    const standing = projectRowStanding(row);
    if (standing.lifecycle !== "Active") {
      return { acquired: "NotActive", lifecycle: standing.lifecycle };
    }
    const held = projectRowLease(row);
    if (held !== undefined && held.owner !== owner) {
      return { acquired: "HeldByAnother", owner: held.owner };
    }
    return {
      acquired: "Granted",
      lease: await postgresOwnershipGrant(client, partition, owner, leaseSecs),
    };
  });
}

/** Extends a held lease without advancing its fencing epoch, so one tenure keeps one identity. */
export async function postgresOwnershipRenew(
  pool: pg.Pool,
  lease: Lease,
  leaseSecs: number,
): Promise<Renewed> {
  postgresOwnershipRequireLeaseSecs(leaseSecs);
  return postgresTransaction(pool, async (client) => {
    const row = await postgresOwnershipLockKnown(client, lease.partition);
    const standing = projectRowStanding(row);
    const honoured = await postgresOwnershipHonours(client, row, lease);
    if (standing.lifecycle !== "Active" || !honoured) {
      return { renewed: "Fenced", fencingEpoch: standing.fencingEpoch };
    }
    const extended = await client.query<ProjectRow>(
      sql`UPDATE project
          SET lease_expires_at = now() + make_interval(secs => ${leaseSecs}::double precision)
        WHERE tenant = ${lease.partition.tenant} AND project = ${lease.partition.project}
        RETURNING tenant, project, lifecycle, lifecycle_generation,
                  fencing_epoch, head, owner, recovery_epoch,
                  (owner IS NOT NULL AND lease_expires_at > now()) IS TRUE AS lease_live`,
    );
    const current = projectRowLease(postgresOwnershipRow(extended));
    if (current === undefined) {
      throw new Error(
        `postgres ownership: an extended lease on ${lease.partition.tenant}/${lease.partition.project} reported itself expired`,
      );
    }
    return { renewed: "Extended", lease: current };
  });
}

/** Gives up a held lease early, leaving a lease that was already fenced exactly as it is. */
export async function postgresOwnershipRelease(
  pool: pg.Pool,
  lease: Lease,
): Promise<void> {
  await postgresTransaction(pool, async (client) => {
    const row = await postgresOwnershipLockKnown(client, lease.partition);
    if (!(await postgresOwnershipHonours(client, row, lease))) return;
    await client.query(
      sql`UPDATE project
          SET owner = NULL, lease_expires_at = NULL, recovery_epoch = NULL
        WHERE tenant = ${lease.partition.tenant} AND project = ${lease.partition.project}`,
    );
  });
}

/** Advances the lifecycle generation and the fencing epoch and clears ownership, in one transaction. */
export async function postgresOwnershipFence(
  pool: pg.Pool,
  partition: Partition,
  lifecycle: Lifecycle,
): Promise<ProjectStanding> {
  return postgresTransaction(pool, async (client) => {
    await postgresOwnershipLockKnown(client, partition);
    const fenced = await client.query<ProjectRow>(
      sql`UPDATE project
          SET lifecycle = ${lifecycle},
              lifecycle_generation = lifecycle_generation + 1,
              fencing_epoch = fencing_epoch + 1,
              owner = NULL, lease_expires_at = NULL, recovery_epoch = NULL
        WHERE tenant = ${partition.tenant} AND project = ${partition.project}
        RETURNING tenant, project, lifecycle, lifecycle_generation,
                  fencing_epoch, head, owner, recovery_epoch,
                  (owner IS NOT NULL AND lease_expires_at > now()) IS TRUE AS lease_live`,
    );
    await client.query<{ published: string | null }>(
      sql`SELECT publish_project_notification(${partition.tenant},${partition.project},'Project',${partition.project},NULL,NULL)::text AS published`,
    );
    await client.query(
      `SELECT ${notificationPublishFunction}($1,$2,'Project',$2,NULL,NULL)`,
      [partition.tenant, partition.project],
    );
    return projectRowStanding(postgresOwnershipRow(fenced));
  });
}
