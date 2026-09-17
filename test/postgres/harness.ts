import { randomUUID } from "node:crypto";
import type pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
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
import {
  memoryProjectAccess,
  type MemoryProjectAccess,
} from "./projectAccessMemory.ts";

export const postgresHarnessUrlVar = "CHUG_PG_URL";

export function postgresHarnessUrl(): string {
  const url = process.env[postgresHarnessUrlVar];
  if (url === undefined || url === "")
    throw new Error(
      `${postgresHarnessUrlVar} is unset; run the PostgreSQL gate`,
    );
  return url;
}

export function postgresHarnessRolePool(role: string): pg.Pool {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${role}`);
  return postgresPool(url.toString());
}

export interface PostgresTransaction {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface PostgresHarness {
  readonly pool: pg.Pool;
  readonly store: ProjectStore;
  readonly access: MemoryProjectAccess;
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]>;
  attemptAs(role: string, sql: string): Promise<string | undefined>;
  begin(): Promise<PostgresTransaction>;
  close(): Promise<void>;
}

export async function postgresHarnessOpen(): Promise<PostgresHarness> {
  const pool = postgresPool(postgresHarnessUrl());
  const store = postgresProjectStore(pool);
  await postgresHarnessEpoch(store);
  return {
    pool,
    store,
    access: memoryProjectAccess(),
    query: async (sql, values) =>
      (await pool.query(sql, values === undefined ? undefined : [...values]))
        .rows as readonly Record<string, unknown>[],
    attemptAs: (role, sql) => postgresHarnessAttemptAs(pool, role, sql),
    begin: () => postgresHarnessBegin(pool),
    close: () => pool.end(),
  };
}

export function postgresHarnessDenial(object: string): RegExp {
  return new RegExp(`permission denied for \\w+ ${object}\\b`);
}

async function postgresHarnessAttemptAs(
  pool: pg.Pool,
  role: string,
  sql: string,
): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    try {
      await client.query(sql);
      return undefined;
    } catch (refusal) {
      return refusal instanceof Error ? refusal.message : String(refusal);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

export async function postgresHarnessEpoch(
  store: ProjectStore,
): Promise<RecoveryEpoch> {
  try {
    return await store.currentRecoveryEpoch();
  } catch {
    return store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  }
}

export function postgresHarnessNewEpoch(): RecoveryEpoch {
  return asRecoveryEpoch(`epoch-${randomUUID()}`);
}

export function postgresHarnessPartition(label: string): Partition {
  return {
    tenant: asTenantId(`tenant-${label}-${randomUUID()}`),
    project: asProjectId(`project-${label}-${randomUUID()}`),
  };
}

export function postgresHarnessOwner(label: string): OwnerId {
  return asOwnerId(`owner-${label}-${randomUUID()}`);
}

export async function postgresHarnessProject(
  store: ProjectStore,
  label: string,
): Promise<Partition> {
  const partition = postgresHarnessPartition(label);
  await store.createProject(partition);
  return partition;
}

export async function postgresHarnessHeld(
  store: ProjectStore,
  partition: Partition,
  label: string,
): Promise<Lease> {
  const acquired = await store.acquire(
    partition,
    postgresHarnessOwner(label),
    60,
  );
  if (acquired.acquired !== "Granted")
    throw new Error(`postgres harness: lease was ${acquired.acquired}`);
  return acquired.lease;
}

export async function postgresHarnessExpire(
  harness: PostgresHarness,
  partition: Partition,
): Promise<void> {
  await harness.query(
    "UPDATE project SET lease_expires_at=now()-interval '1 second' WHERE tenant=$1 AND project=$2",
    [partition.tenant, partition.project],
  );
}

export interface PostgresRowLock {
  readonly stalled: (backends: number) => Promise<void>;
  readonly release: () => Promise<void>;
}

async function postgresHarnessStalled(
  pool: pg.Pool,
  backends: number,
): Promise<void> {
  for (let waited = 0; waited < 5_000; waited += 25) {
    const found = await pool.query<{ stalled: number }>(
      `SELECT count(*)::int AS stalled FROM pg_stat_activity
         WHERE datname=current_database() AND wait_event_type='Lock'`,
    );
    if ((found.rows[0]?.stalled ?? 0) >= backends) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("postgres harness: calls did not reach their row lock");
}

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
      "SELECT tenant FROM project WHERE tenant=$1 AND project=$2 FOR UPDATE",
      [partition.tenant, partition.project],
    );
    return {
      stalled: (backends) => postgresHarnessStalled(blockade, backends),
      release,
    };
  } catch (error: unknown) {
    await release();
    throw error;
  }
}

async function postgresHarnessBegin(
  pool: pg.Pool,
): Promise<PostgresTransaction> {
  const client = await pool.connect();
  await client.query("BEGIN");
  const finish = async (command: string): Promise<void> => {
    try {
      await client.query(command);
    } finally {
      client.release();
    }
  };
  return {
    query: async (sql, values) =>
      (await client.query(sql, values === undefined ? undefined : [...values]))
        .rows as readonly Record<string, unknown>[],
    commit: () => finish("COMMIT"),
    rollback: () => finish("ROLLBACK"),
  };
}
