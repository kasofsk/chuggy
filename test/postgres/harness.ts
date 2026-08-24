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
import { postgresAuthoring } from "../../src/adapters/postgres/authoring.ts";

import {
  asCanonicalConfiguration,
  asConfigurationRevisionId,
  type AuthoringStore,
} from "../../src/interpreter/authoring.ts";
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
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresProjectDecision } from "../../src/adapters/postgres/projectDecision.ts";
import { postgresProjectDiscovery } from "../../src/adapters/postgres/projectDiscovery.ts";
import { postgresProjectStore } from "../../src/adapters/postgres/projectStore.ts";
import { postgresProjectAccess } from "../../src/adapters/postgres/projectAccess.ts";
import { postgresProjectMembership } from "../../src/adapters/postgres/projectMembership.ts";
import type { ProjectAccess } from "../../src/interpreter/nativeWeb.ts";
import type { ProjectMembershipAdministration } from "../../src/interpreter/projectMembership.ts";
import type { RepositoryConfigurationStore } from "../../src/interpreter/repositoryConfiguration.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asIdempotencyKey,
  asOperationId,
  asOperationDecisionEvent,
  type OperationInbox,
  type OperationId,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import type {
  DecisionInput,
  ProjectDiscovery,
} from "../../src/interpreter/projectDiscovery.ts";
import type { ProjectDecision } from "../../src/interpreter/projectDecision.ts";
import {
  projectWriterDecide,
  projectWriterLoad,
  type ProjectMemory,
  type ProjectTicketWriter,
} from "../../src/interpreter/projectWriter.ts";
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

/** The smallest authored configuration a release may pin. */
export const postgresHarnessConfiguration = asCanonicalConfiguration(
  '{"brief":{"acceptanceCriteria":["The ticket is complete."],"constraints":[],"motivation":["The ticket should be completed."]},"image":"worker:v1","practices":[],"review":{"instructions":[]},"version":1,"work":{"instructions":[]}}',
);

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
  readonly decisions: ProjectDecision;
  readonly authoring: AuthoringStore & RepositoryConfigurationStore;
  readonly access: ProjectAccess;
  readonly membership: ProjectMembershipAdministration;
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

/** Opens a store over the schema prepared by the PostgreSQL gate, establishing its first recovery epoch. */
export async function postgresHarnessOpen(): Promise<PostgresHarness> {
  const pool = postgresPool(postgresHarnessUrl());
  const store = postgresProjectStore(pool);
  await postgresHarnessEpoch(store);
  return {
    store,
    inbox: postgresOperationInbox(pool, postgresHarnessKeying()),
    discovery: postgresProjectDiscovery(pool),
    decisions: postgresProjectDecision(pool),
    authoring: postgresAuthoring(pool),
    access: postgresProjectAccess(pool),
    membership: postgresProjectMembership(pool),
    query: async (sql, values) =>
      (await pool.query(sql, values === undefined ? undefined : [...values]))
        .rows as readonly Record<string, unknown>[],
    attemptAs: (role, sql) => postgresHarnessAttemptAs(pool, role, sql),
    begin: () => postgresHarnessBegin(pool),
    close: () => pool.end(),
  };
}

/**
 * The refusal a server gives when `object` is the thing the role may not reach.
 * A case matching the bare phrase would also accept a refusal about something
 * else the statement touched on the way — a function body reading a table the
 * caller cannot read is refused in exactly those words, and the grant the case
 * is about has already regressed by then.
 */
export function postgresHarnessDenial(object: string): RegExp {
  return new RegExp(`permission denied for \\w+ ${object}\\b`);
}

/**
 * Runs one statement as `role` inside a transaction it always rolls back,
 * answering with the refusal the server gave or undefined when it allowed the
 * statement. Becoming the role is not part of that attempt — `SET LOCAL ROLE`
 * is refused in the same words a statement is, so a helper catching both would
 * answer `permission denied to set role` to every case asserting that a role
 * may not write, and each would report green with nothing attempted at all.
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
    const became = await client.query<{ whoami: string }>(
      "SELECT current_user AS whoami",
    );
    if (became.rows[0]?.whoami !== role) {
      throw new Error(
        `postgres harness: asking to be ${role} left the session as ${String(became.rows[0]?.whoami)}`,
      );
    }
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
 * tenure looks like to the server and is how every case here reaches one. A
 * case that slept for a real expiry would be slow and would still be racing the
 * clock it slept against, where this is the same fact decided by the database.
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

/** A ticket-service instance identity no other case is using. */
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
 * using. Replaying a journal and deciding against one each need a lease, so a
 * case
 * that is about something else says it in one line; the submission and
 * discovery sides need none and take none.
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
    key: asIdempotencyKey(`key-${label}-${unique}`),
    command: {
      version: 1,
      command: "Decide",
      event: asOperationDecisionEvent({ type: "ResumeTicket", value: id(1) }),
    },
  };
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

/** The fixture history's entry at `index`, refusing an index the fixture is shorter than. */
export function postgresHarnessEntry(index: number): Entry {
  const entry = postgresHarnessJournal()[index];
  if (entry === undefined) {
    throw new Error(
      `postgres harness: the fixture journal has no entry ${String(index)}`,
    );
  }
  return entry;
}

/**
 * A submission whose command is the fixture history's decision at `index`, so
 * the accepted operation is one a writer can decide rather than refuse.
 */
export function postgresHarnessDecisionSubmission(
  partition: Partition,
  label: string,
  index: number,
  unique?: string,
): Submission {
  if (index === 0)
    throw new Error(
      "postgres harness: releases use postgresHarnessReleaseSubmission",
    );
  return {
    ...postgresHarnessSubmission(partition, label, unique),
    command:
      postgresHarnessEntry(index).event.type === "Dispatch"
        ? {
            version: 1,
            command: "ManualDispatch",
            ticket: id(1),
            expectedTicketVersion: index,
          }
        : {
            version: 1,
            command: "Decide",
            event: asOperationDecisionEvent(postgresHarnessEntry(index).event),
          },
  };
}

/** Creates native authoring state and returns its only valid public release command. */
export async function postgresHarnessReleaseSubmission(
  harness: PostgresHarness,
  partition: Partition,
  label: string,
): Promise<Submission> {
  const revision = asConfigurationRevisionId(`config-${label}-${randomUUID()}`);
  const base = postgresHarnessSubmission(partition, label);
  const authority = base.authority;
  await harness.authoring.createConfiguration({
    partition,
    authority,
    revision,
    canonical: postgresHarnessConfiguration,
  });
  const initialized = await harness.authoring.initializeDraft(
    partition,
    revision,
    100,
  );
  if (initialized === undefined)
    throw new Error("postgres harness: release draft was not initialized");
  const created = await harness.authoring.createDraft({
    partition,
    authority,
    configurationRevision: revision,
    configurationDigest: initialized.configuration.digest,
    expectedProjectSequence: initialized.projectSequence,
    authoring: plainAuthoring,
  });
  if (created.created !== "Created")
    throw new Error("postgres harness: release draft was not created");
  return {
    ...base,
    command: {
      version: 1,
      command: "ReleaseDraft",
      ticket: created.draft.ticket,
      authoringVersion: created.draft.authoringVersion,
      configurationRevision: revision,
    },
  };
}

/** Accepts one submission and hands back the inbox item it created, which is what a writer decides. */
export async function postgresHarnessAccept(
  inbox: OperationInbox,
  submission: Submission,
): Promise<DecisionInput> {
  const accepted = await inbox.accept(submission);
  if (accepted.accepted !== "Accepted") {
    throw new Error(
      `postgres harness: the acceptance was ${accepted.accepted}`,
    );
  }
  return {
    partition: submission.partition,
    ordinal: accepted.operation.ordinal,
    priority: "Ordinary",
    source: {
      kind: "Operation",
      operation: submission.operation,
      command: submission.command,
      resolvedEvent:
        submission.command.command === "Decide"
          ? submission.command.event
          : releaseTicketEvent(id(1), plainAuthoring),
    },
  };
}

export function postgresHarnessInputOperation(
  input: DecisionInput,
): OperationId {
  if (input.source.kind !== "Operation") {
    throw new Error("postgres harness: expected an operation decision input");
  }
  return input.source.operation;
}

/** An accepted item carrying the fixture history's decision at `index`, which most cases start from. */
export function postgresHarnessAccepted(
  harness: PostgresHarness,
  partition: Partition,
  label: string,
  index: number,
): Promise<DecisionInput> {
  return (async () => {
    const submission =
      index === 0
        ? await postgresHarnessReleaseSubmission(harness, partition, label)
        : postgresHarnessDecisionSubmission(partition, label, index);
    const accepted = await harness.inbox.accept(submission);
    if (accepted.accepted !== "Accepted")
      throw new Error(
        `postgres harness: the acceptance was ${accepted.accepted}`,
      );
    const input = await harness.discovery.next(partition, 300);
    if (input === undefined)
      throw new Error("postgres harness: accepted input was not discoverable");
    return input;
  })();
}

/** The writer over a harness's ports, which is what turns a loaded state and an item into a commit. */
export function postgresHarnessWriter(
  harness: PostgresHarness,
): ProjectTicketWriter {
  return {
    config: refinementInstance,
    store: harness.store,
    decisions: harness.decisions,
  };
}

/**
 * Accepts and decides the fixture history's first `count` decisions, and hands
 * back the state the last commit left. Cases that need a project with a
 * history start here rather than assembling one.
 */
export async function postgresHarnessHistory(
  harness: PostgresHarness,
  partition: Partition,
  label: string,
  count: number,
): Promise<ProjectMemory> {
  const writer = postgresHarnessWriter(harness);
  let memory = await projectWriterLoad(
    writer,
    await postgresHarnessHeld(harness.store, partition, label),
  );
  for (let index = 0; index < count; index++) {
    const item = await postgresHarnessAccepted(
      harness,
      partition,
      `${label}-${String(index)}`,
      index,
    );
    const step = await projectWriterDecide(writer, memory, item);
    if (step.decided.decided !== "Committed") {
      throw new Error(
        `postgres harness: decision ${String(index)} was ${step.decided.decided}`,
      );
    }
    memory = step.memory;
  }
  return memory;
}
