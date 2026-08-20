/**
 * What every case in this directory needs of a real PostgreSQL: a migrated
 * database, a store over it, and identities no other case is using.
 *
 * THERE IS NO MOCK HERE AND THAT IS THE POINT. 006 makes competing owners,
 * lease takeover, stale-writer commits, composite constraints and separate
 * database roles acceptance work for this boundary, and every one of them is a
 * claim about what the server does rather than about what an adapter intends.
 * A fake that answered these calls would be asserting this file's beliefs back
 * at it.
 *
 * IDENTITIES ARE UNIQUE PER CASE rather than the database being fresh per
 * case. Creating a database costs a connection and a template copy, and the
 * thing being tested is a partitioned store — so cases that share one database
 * and hold different partitions exercise the isolation the port claims instead
 * of hiding it behind a clean slate.
 */

import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type pg from "pg";

import {
  dispatchEvent,
  releaseTicketEvent,
} from "../../src/actor/decisionEvent.ts";
import type { Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";

import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
import {
  postgresMigrate,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import { postgresProjectStore } from "../../src/adapters/postgres/projectStore.ts";
import {
  asOwnerId,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Lease,
  type OwnerId,
  type Partition,
  type ProjectStore,
  type RecoveryEpoch,
} from "../../src/interpreter/projectStore.ts";

/** The environment variable `.chug/tasks/check-postgres.sh` sets, named once. */
export const postgresHarnessUrlVar = "CHUG_PG_URL";

/** The URL of the server to test against, or a failure saying which gate supplies it. */
export function postgresHarnessUrl(): string {
  const url = process.env[postgresHarnessUrlVar];
  if (url === undefined || url === "") {
    throw new Error(
      `${postgresHarnessUrlVar} is unset; this suite is run by .chug/tasks/check-postgres.sh, which starts a server and sets it`,
    );
  }
  return url;
}

/** One opened subject: the store, the pool beneath it, and the way to give both back. */
export interface PostgresHarness {
  readonly store: ProjectStore;
  readonly query: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<readonly Record<string, unknown>[]>;
  readonly attemptAs: (
    role: string,
    sql: string,
  ) => Promise<string | undefined>;
  readonly close: () => Promise<void>;
}

/** Opens a migrated store, establishing the first recovery epoch when this database has none. */
export async function postgresHarnessOpen(): Promise<PostgresHarness> {
  const pool = postgresPool(postgresHarnessUrl());
  await postgresMigrate(pool);
  const store = postgresProjectStore(pool);
  await postgresHarnessEpoch(store);
  return {
    store,
    query: async (sql, values) =>
      (await pool.query(sql, values === undefined ? undefined : [...values]))
        .rows as readonly Record<string, unknown>[],
    attemptAs: (role, sql) => postgresHarnessAttemptAs(pool, role, sql),
    close: () => pool.end(),
  };
}

/**
 * Runs one statement as `role` and rolls it back, answering with the refusal
 * the server gave or undefined when it allowed the statement. The transaction
 * is always rolled back, so a case proves a grant without leaving a row behind.
 */
async function postgresHarnessAttemptAs(
  pool: pg.Pool,
  role: string,
  sql: string,
): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(sql);
    return undefined;
  } catch (refusal) {
    return refusal instanceof Error ? refusal.message : String(refusal);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/** The current epoch, establishing one first when this database has never had any. */
export async function postgresHarnessEpoch(
  store: ProjectStore,
): Promise<RecoveryEpoch> {
  try {
    return await store.currentRecoveryEpoch();
  } catch {
    return store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  }
}

/** An epoch no database has issued authority under, which is what makes it a new one. */
export function postgresHarnessNewEpoch(): RecoveryEpoch {
  return asRecoveryEpoch(`epoch-${randomUUID()}`);
}

/** A partition no other case is holding, labelled so a failure names the case that made it. */
export function postgresHarnessPartition(label: string): Partition {
  return {
    tenant: asTenantId(`tenant-${label}-${randomUUID()}`),
    project: asProjectId(`project-${label}-${randomUUID()}`),
  };
}

/**
 * Puts the partition's lease expiry into the past, which is what a lapsed
 * tenure looks like to the server. A case that slept for a real expiry would be
 * slow and would still be racing the clock it slept against.
 */
export async function postgresHarnessExpire(
  harness: PostgresHarness,
  partition: Partition,
): Promise<void> {
  await harness.query(
    "UPDATE project SET lease_expires_at = now() - interval '1 second' WHERE tenant = $1 AND project = $2",
    [partition.tenant, partition.project],
  );
}

/** A dispatcher-instance identity no other case is using. */
export function postgresHarnessOwner(label: string): OwnerId {
  return asOwnerId(`owner-${label}-${randomUUID()}`);
}

/** A provisioned, active partition with an empty journal, which is what most cases start from. */
export async function postgresHarnessProject(
  store: ProjectStore,
  label: string,
): Promise<Partition> {
  const partition = postgresHarnessPartition(label);
  await store.createProject(partition);
  return partition;
}

/** How long a case's lease runs for: long enough that no case races its own expiry. */
const postgresHarnessLeaseSecs = 60;

/**
 * A lease on a provisioned partition, taken for an owner no other case is
 * using. Every read and every append needs one, so a case that is about
 * something else says it in one line.
 */
export async function postgresHarnessHeld(
  store: ProjectStore,
  partition: Partition,
  label: string,
): Promise<Lease> {
  const acquired = await store.acquire(
    partition,
    postgresHarnessOwner(label),
    postgresHarnessLeaseSecs,
  );
  if (acquired.acquired !== "Granted") {
    throw new Error(
      `postgres harness: the lease on ${partition.tenant}/${partition.project} for ${label} was ${acquired.acquired}`,
    );
  }
  return acquired.lease;
}

/** How long a case waits for calls it did not await to reach the lock that stalls them. */
const postgresHarnessStallWaitMsMax = 5_000;

/** How often that wait asks, which is what bounds the loop asking. */
const postgresHarnessStallAskMs = 25;

/** A project row held locked: what has stalled behind it, and the way to give it back. */
export interface PostgresRowLock {
  readonly stalled: (backends: number) => Promise<void>;
  readonly release: () => Promise<void>;
}

/**
 * Locks the partition's project row on a connection of its own, so a case can
 * stall a call that borrows from the harness pool without starving the pool
 * the rest of the case draws from.
 */
export async function postgresHarnessRowLock(
  partition: Partition,
): Promise<PostgresRowLock> {
  const blockade = postgresPool(postgresHarnessUrl());
  const blocker = await blockade.connect();
  const release = async (): Promise<void> => {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await blockade.end();
  };
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT tenant FROM project WHERE tenant = $1 AND project = $2 FOR UPDATE",
      [partition.tenant, partition.project],
    );
    return {
      stalled: (backends) => postgresHarnessStalled(blockade, backends),
      release,
    };
  } catch (failure) {
    await release();
    throw failure;
  }
}

/**
 * Resolves once that many backends are waiting on a lock, which is how a case
 * knows the calls it did not await have reached the row the blockade holds. It
 * asks on a connection of the blockade pool rather than on the locked one,
 * because a transaction caches its statistics snapshot and would answer with
 * whatever it saw the first time it asked.
 */
async function postgresHarnessStalled(
  blockade: pg.Pool,
  backends: number,
): Promise<void> {
  for (
    let waitedMs = 0;
    waitedMs < postgresHarnessStallWaitMsMax;
    waitedMs += postgresHarnessStallAskMs
  ) {
    const found = await blockade.query<{ stalled: number }>(
      `SELECT count(*)::int AS stalled FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((found.rows[0]?.stalled ?? 0) >= backends) return;
    await delay(postgresHarnessStallAskMs);
  }
  throw new Error(
    `postgres harness: fewer than ${String(backends)} backends stalled behind the row lock, so a case is asserting against a race it never set up`,
  );
}

/**
 * A history the machine would accept: one release, then its dispatch. Cases
 * share it so a change to what the actor journals moves one fixture rather
 * than four.
 */
export function postgresHarnessJournal(): readonly Entry[] {
  const released = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  return journalStep(refinementInstance, released, dispatchEvent(id(1)))
    .journal;
}

/** The first entry of that history, which is all a case appending exactly one entry needs. */
export function postgresHarnessFirstEntry(): Entry {
  const entry = postgresHarnessJournal()[0];
  if (entry === undefined) {
    throw new Error("postgres harness: the fixture journal has no first entry");
  }
  return entry;
}
