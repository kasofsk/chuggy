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

import type pg from "pg";

import {
  dispatchEvent,
  releaseTicketEvent,
} from "../../src/actor/decisionEvent.ts";
import type { Entry } from "../../src/actor/journal.ts";
import { actorInit, journalStep } from "../../src/actor/state.ts";

import { plainAuthoring, refinementInstance } from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
import type { IdempotencyKeying } from "../../src/adapters/postgres/keying.ts";
import { postgresOperationInbox } from "../../src/adapters/postgres/operationInbox.ts";
import {
  postgresMigrate,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import { postgresProjectDiscovery } from "../../src/adapters/postgres/projectDiscovery.ts";
import { postgresProjectStore } from "../../src/adapters/postgres/projectStore.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asIdempotencyKey,
  asOperationCommand,
  asOperationId,
  type OperationInbox,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import type { ProjectDiscovery } from "../../src/interpreter/projectDiscovery.ts";
import {
  asOwnerId,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
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

/** One transaction a case drives itself, for the interleavings a port cannot be asked to produce. */
export interface PostgresTransaction {
  readonly query: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<readonly Record<string, unknown>[]>;
  readonly commit: () => Promise<void>;
  readonly rollback: () => Promise<void>;
}

/** One opened subject: the store, the two inbox ports, the pool beneath them, and the way to give it back. */
export interface PostgresHarness {
  readonly store: ProjectStore;
  readonly inbox: OperationInbox;
  readonly discovery: ProjectDiscovery;
  readonly query: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<readonly Record<string, unknown>[]>;
  readonly attemptAs: (
    role: string,
    sql: string,
  ) => Promise<string | undefined>;
  readonly begin: () => Promise<PostgresTransaction>;
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
    inbox: postgresOperationInbox(pool, postgresHarnessKeying()),
    discovery: postgresProjectDiscovery(pool),
    query: async (sql, values) =>
      (await pool.query(sql, values === undefined ? undefined : [...values]))
        .rows as readonly Record<string, unknown>[],
    attemptAs: (role, sql) => postgresHarnessAttemptAs(pool, role, sql),
    begin: () => postgresHarnessBegin(pool),
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

/**
 * An open transaction a case drives statement by statement. It is how a case
 * produces an interleaving the port has no seam for — a row lock held across
 * another call, or the terminalization the decision transaction will make.
 */
async function postgresHarnessBegin(
  pool: pg.Pool,
): Promise<PostgresTransaction> {
  const client = await pool.connect();
  await client.query("BEGIN");
  const finish = async (how: string): Promise<void> => {
    try {
      await client.query(how);
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

/** The key version every case digests under unless it is rotating away from it. */
export const postgresHarnessKeyVersionFirst = "keying-one";

/** The version a rotating case makes current, while the first stays retained and looked up. */
export const postgresHarnessKeyVersionLater = "keying-two";

/**
 * A keying set whose current version is the one named. Cases rotate by opening
 * a second inbox on the later version, which is what proves a key accepted
 * under the earlier one is still found.
 */
export function postgresHarnessKeying(
  current = postgresHarnessKeyVersionFirst,
): IdempotencyKeying {
  return {
    current,
    versions: [
      postgresHarnessKeyVersionFirst,
      postgresHarnessKeyVersionLater,
    ].map((version) => ({ version, secret: `secret-for-${version}` })),
  };
}

/**
 * A submission no other case is making, labelled so a failure names the case
 * that made it. The uniqueness may be supplied rather than drawn, which is how
 * the crash rig's parent and child name the same submission without a channel
 * between them.
 */
export function postgresHarnessSubmission(
  partition: Partition,
  label: string,
  unique: string = randomUUID(),
): Submission {
  return {
    partition,
    operation: asOperationId(`operation-${label}-${unique}`),
    authority: {
      kind: asAuthorityKind("UserMutation"),
      subject: asAuthoritySubject(`subject-${label}`),
    },
    admission: "Ordinary",
    key: asIdempotencyKey(`key-${label}-${unique}`),
    command: asOperationCommand(`{"label":"${label}"}`),
  };
}

/**
 * The submission the crash rig accepts, derived from the partition so the
 * parent names the operation its killed child wrote without a channel to it.
 */
export function postgresHarnessCrashSubmission(
  partition: Partition,
): Submission {
  return postgresHarnessSubmission(partition, "crash", partition.project);
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
