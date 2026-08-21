/**
 * What every scheduler case in this directory needs of a real PostgreSQL: a
 * store connected as the role that will actually run it, a project whose
 * dispatch left a spawn request to register, and the capacity it draws on.
 *
 * THE STORE RUNS AS `chuggy_scheduler` AND NOT AS THE MIGRATION OWNER. Every
 * grant migration ten writes is a claim about what that role may do, and a
 * suite driving the adapter as the owner would prove the SQL parses rather than
 * that the deployment can run it — a column grant that covers a write and not
 * the read beside it is invisible to any other kind of test. The role is
 * `NOLOGIN`, so the pool asks for it as a startup option on a session the owner
 * opened, which is the same authority a `SET ROLE` gives and survives being
 * pooled.
 *
 * THE FIXTURES ARE WRITTEN BY THE PARTS THAT OWN THEM. The project, its
 * journal and its spawn request come from the real writer through the real
 * decision transaction, so a registration is registering work a decision
 * actually authorized. Only capacity is written by hand, because capacity policy
 * has no adapter in this slice and belongs to nobody the suite can drive.
 *
 * EACH CASE GETS ITS OWN CLUSTER unless it asks to share one. What a cluster and
 * an account report is a fact about every project drawing on them, so cases
 * sharing one by accident would be counting each other's registrations — and the
 * cases that are about borrowing across accounts need to share one on purpose.
 *
 * A BLOCKADE CAN KILL WHAT IT STALLED, which is how a crash reaches these cases
 * without a second process. `pg_terminate_backend` ends a real backend in the
 * middle of a real transaction and the server rolls it back exactly as it rolls
 * back a client that died, so what a case reads afterwards is what survives a
 * crash rather than what an adapter believes it would have written.
 *
 * THE BLOCKADE READS A CLUSTER-WIDE VIEW THROUGH A DATABASE-SCOPED FILTER.
 * `pg_stat_activity` sees every backend in the server, so both the wait and the
 * kill are narrowed to this run's own database. Two runs of the gate against one
 * reused container would still observe each other, which is why the gate runs
 * its cases one at a time and says so.
 */

import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type pg from "pg";

import { revokeEvent } from "../../src/actor/decisionEvent.ts";
import { postgresExecutionScheduler } from "../../src/adapters/postgres/scheduler.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  accountIdentityFunction,
  apiRole,
  schedulerRole,
} from "../../src/adapters/postgres/schema.ts";
import { id } from "../domain/fixtures.ts";
import {
  asClusterId,
  asSchedulerOwnerId,
  type ClusterId,
  type AttemptReport,
  type ExecutionSchedulerStore,
  type FencedAttempt,
  type RequestClaim,
  type SchedulerOwnerId,
} from "../../src/interpreter/executionScheduler.ts";
import {
  acceptResultManifest,
  asResultManifestId,
  type CanonicalManifest,
} from "../../src/interpreter/resultManifest.ts";
import { asOperationDecisionEvent } from "../../src/interpreter/operationInbox.ts";
import type {
  Partition,
  RecoveryEpoch,
} from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessSubmission,
  postgresHarnessUrl,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

/** A pool whose every session runs as the execution scheduler's own role. */
export function schedulerRolePool(): pg.Pool {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${schedulerRole}`);
  return postgresPool(url.toString());
}

/** One opened subject: the owner's harness, the scheduler's pool, and the store over it. */
export interface SchedulerRig {
  readonly harness: PostgresHarness;
  readonly pool: pg.Pool;
  readonly store: ExecutionSchedulerStore;
  readonly close: () => Promise<void>;
}

/** Opens a migrated database, a scheduler-role pool over it and the store it answers. */
export async function schedulerRigOpen(): Promise<SchedulerRig> {
  const harness = await postgresHarnessOpen();
  const pool = schedulerRolePool();
  return {
    harness,
    pool,
    store: postgresExecutionScheduler(pool),
    close: async () => {
      await pool.end();
      await harness.close();
    },
  };
}

/** A scheduler process identity no other case is using. */
export function schedulerOwner(label: string): SchedulerOwnerId {
  return asSchedulerOwnerId(`scheduler-${label}-${randomUUID()}`);
}

/** How wide a case's own cluster is, and what its account may reserve and borrow up to. */
export interface SchedulerCapacity {
  readonly cluster?: ClusterId;
  readonly slotsMax?: number;
  readonly reserved?: number;
  readonly maximum?: number;
  readonly tasks?: number;
}

/** One case's registered project: the request it draws work from and the capacity behind it. */
export interface SchedulerProject {
  readonly partition: Partition;
  readonly cluster: ClusterId;
  readonly request: string;
  readonly ticket: number;
  readonly tasks: number;
  readonly epoch: RecoveryEpoch;
  readonly memory: ProjectMemory;
}

/** The spawn request a released and dispatched ticket leaves behind. */
async function schedulerSpawnRequest(
  rig: SchedulerRig,
  partition: Partition,
): Promise<{ request: string; ticket: string }> {
  const found = (await rig.harness.query(
    `SELECT request, ticket::text AS ticket FROM execution_request
      WHERE tenant=$1 AND project=$2 AND kind='SpawnWork'`,
    [partition.tenant, partition.project],
  )) as readonly { request: string; ticket: string }[];
  const row = found[0];
  if (row === undefined) {
    throw new Error("scheduler harness: the dispatch left no spawn request");
  }
  return row;
}

/** Widens the request's declared work to the number of logical tasks a case needs. */
async function schedulerWidenTasks(
  rig: SchedulerRig,
  partition: Partition,
  request: string,
  tasks: number,
): Promise<number> {
  const declared = (await rig.harness.query(
    `SELECT count(*)::text AS declared FROM execution_request_task
      WHERE tenant=$1 AND project=$2 AND request=$3`,
    [partition.tenant, partition.project, request],
  )) as readonly { declared: string }[];
  const already = Number(declared[0]?.declared ?? "0");
  for (let more = already; more < tasks; more++) {
    await rig.harness.query(
      `INSERT INTO execution_request_task (tenant,project,request,task,kind)
       VALUES ($1,$2,$3,$4,'Work')`,
      [partition.tenant, partition.project, request, more + 1],
    );
  }
  return Math.max(already, tasks);
}

/** Points the project's provisioned account at this case's cluster, with this case's entitlement. */
async function schedulerCapacityFor(
  rig: SchedulerRig,
  partition: Partition,
  capacity: SchedulerCapacity,
  label: string,
): Promise<ClusterId> {
  const cluster =
    capacity.cluster ?? asClusterId(`cluster-${label}-${randomUUID()}`);
  if (capacity.cluster === undefined) {
    await rig.harness.query(
      "INSERT INTO execution_cluster (cluster, slots_max, policy_revision) VALUES ($1,$2,1)",
      [cluster, capacity.slotsMax ?? 32],
    );
  }
  const repointed = await rig.harness.query(
    `UPDATE capacity_account SET cluster=$3, reserved=$4, maximum=$5
      WHERE account=${accountIdentityFunction}($1,$2) RETURNING account`,
    [
      partition.tenant,
      partition.project,
      cluster,
      capacity.reserved ?? 0,
      capacity.maximum ?? 16,
    ],
  );
  if (repointed.length !== 1) {
    throw new Error(
      `scheduler harness: provisioning ${partition.project} left it no capacity account to draw on`,
    );
  }
  return cluster;
}

/** A project with one dispatched ticket, a spawn request to register, and capacity behind it. */
export async function schedulerProject(
  rig: SchedulerRig,
  label: string,
  capacity: SchedulerCapacity = {},
): Promise<SchedulerProject> {
  const partition = await postgresHarnessProject(rig.harness.store, label);
  const memory = await postgresHarnessHistory(
    rig.harness,
    partition,
    label,
    postgresHarnessJournal().length,
  );
  const spawn = await schedulerSpawnRequest(rig, partition);
  return {
    partition,
    cluster: await schedulerCapacityFor(rig, partition, capacity, label),
    request: spawn.request,
    ticket: Number(spawn.ticket),
    tasks: await schedulerWidenTasks(
      rig,
      partition,
      spawn.request,
      capacity.tasks ?? 4,
    ),
    epoch: await rig.harness.store.currentRecoveryEpoch(),
    memory,
  };
}

/**
 * Decides a revocation for the project's ticket through the real writer, which
 * is what leaves a cancellation request authorized by a later sequence than the
 * spawn it retires.
 */
export async function schedulerRevoke(
  rig: SchedulerRig,
  project: SchedulerProject,
  label: string,
): Promise<string> {
  const base = postgresHarnessSubmission(project.partition, label);
  const accepted = await rig.harness.inbox.accept({
    ...base,
    command: {
      version: 1,
      command: "Decide",
      event: asOperationDecisionEvent(revokeEvent(id(project.ticket))),
    },
  });
  if (accepted.accepted !== "Accepted") {
    throw new Error(
      `scheduler harness: the revocation was ${accepted.accepted}`,
    );
  }
  const input = await rig.harness.discovery.next(project.partition, 300);
  if (input === undefined) {
    throw new Error("scheduler harness: the revocation was not discoverable");
  }
  const decided = await projectWriterDecide(
    postgresHarnessWriter(rig.harness),
    project.memory,
    input,
  );
  if (decided.decided.decided !== "Committed") {
    throw new Error(
      `scheduler harness: the revocation was ${decided.decided.decided}`,
    );
  }
  const found = (await rig.harness.query(
    `SELECT request FROM execution_request
      WHERE tenant=$1 AND project=$2 AND kind='CancelTicketWork'`,
    [project.partition.tenant, project.partition.project],
  )) as readonly { request: string }[];
  const row = found[0];
  if (row === undefined) {
    throw new Error(
      "scheduler harness: the revocation left no cancellation request",
    );
  }
  return row.request;
}

/** Every registration this project holds, in the order they were registered. */
export async function schedulerExecutions(
  rig: SchedulerRig,
  partition: Partition,
): Promise<readonly { execution: string; task: string; status: string }[]> {
  return (await rig.harness.query(
    `SELECT execution, task::text AS task, status FROM execution
      WHERE tenant=$1 AND project=$2 ORDER BY task`,
    [partition.tenant, partition.project],
  )) as readonly { execution: string; task: string; status: string }[];
}

/** What one project's delivery states currently are, which is what a race case reads. */
export async function schedulerRequestStates(
  rig: SchedulerRig,
  partition: Partition,
): Promise<Record<string, string>> {
  const rows = (await rig.harness.query(
    `SELECT request, state FROM execution_request WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  )) as readonly { request: string; state: string }[];
  return Object.fromEntries(rows.map((row) => [row.request, row.state]));
}

/** The digest a manifest is sealed under, which is the control plane's and never a worker's. */
export function schedulerDigest(canonical: CanonicalManifest): string {
  return createHash("sha256").update(canonical).digest("hex");
}

/** One reported artifact, whose digest is a real hash of the text a case names it by. */
export function schedulerArtifact(
  path: string,
  bytes = 1,
): {
  path: string;
  digest: string;
  bytes: number;
} {
  return {
    path,
    digest: createHash("sha256").update(path).digest("hex"),
    bytes,
  };
}

/**
 * The report one worker sends: the fenced identity its credential was issued
 * under and a manifest sealed by the same acceptance a real ingress applies, so
 * a case cannot offer the store a result that skipped validation.
 */
export function schedulerReport(
  attempt: FencedAttempt,
  verdict: "Pass" | "Fail",
  handoffs: readonly { path: string; digest: string; bytes: number }[] = [],
): AttemptReport {
  const accepted = acceptResultManifest(
    {
      partition: attempt.partition,
      execution: attempt.execution,
      attempt: attempt.attempt,
    },
    asResultManifestId(`manifest-${randomUUID()}`),
    JSON.stringify({ version: 1, verdict, handoffs, diagnostics: [] }),
    schedulerDigest,
  );
  if (accepted.accepted === "Rejected") {
    throw new Error(
      `scheduler harness: the fixture manifest was ${accepted.code}`,
    );
  }
  return { ...attempt, manifest: accepted.manifest };
}

/**
 * The claim a scheduler would be holding for one named request, built rather
 * than drawn because `claimRequests` is installation-wide and the suites share
 * one database. The cases that are about the lease itself draw for real.
 */
export async function schedulerClaimFor(
  rig: SchedulerRig,
  partition: Partition,
  request: string,
  owner: SchedulerOwnerId,
): Promise<RequestClaim> {
  const found = (await rig.harness.query(
    `SELECT kind, ticket::text AS ticket, authorizing_seq::text AS seq,
            claim_generation::text AS generation
       FROM execution_request WHERE tenant=$1 AND project=$2 AND request=$3`,
    [partition.tenant, partition.project, request],
  )) as readonly {
    kind: string;
    ticket: string;
    seq: string;
    generation: string;
  }[];
  const row = found[0];
  if (row === undefined) {
    throw new Error(`scheduler harness: no request ${request} to claim`);
  }
  return {
    partition,
    request,
    kind: row.kind as RequestClaim["kind"],
    ticket: id(Number(row.ticket)),
    authorizingSeq: Number(row.seq),
    generation: Number(row.generation),
    owner,
  };
}

/** How long a case waits for calls it did not await to reach the lock that stalls them. */
const schedulerStallWaitMsMax = 5_000;

/** How often that wait asks, which is what bounds the loop asking. */
const schedulerStallAskMs = 25;

/** A lock held on a connection of its own: what has stalled behind it, and how it ends. */
export interface SchedulerBlockade {
  readonly stalled: (backends: number) => Promise<void>;
  readonly stalledHolds: (relation: string, mode: string) => Promise<boolean>;
  readonly killStalled: () => Promise<number>;
  readonly commit: (sql: string, values: readonly unknown[]) => Promise<void>;
  readonly release: () => Promise<void>;
}

/**
 * Holds one lock on a connection of its own, so a case can stall a store call
 * that borrows from the store's pool without starving the pool the rest of the
 * case draws from. It can also kill what it stalled, or change the row under it
 * and commit — which is the only way to give a stalled caller a different answer
 * than the one it read before it queued.
 */
export async function schedulerBlockade(
  sql: string,
  values: readonly unknown[],
): Promise<SchedulerBlockade> {
  const blockade = postgresPool(postgresHarnessUrl());
  const blocker = await blockade.connect();
  let held = true;
  const release = async (): Promise<void> => {
    if (!held) return;
    held = false;
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await blockade.end();
  };
  try {
    await blocker.query("BEGIN");
    await blocker.query(sql, [...values]);
    return {
      stalled: (backends) => schedulerStalled(blockade, backends),
      stalledHolds: (relation, mode) =>
        schedulerStalledHolds(blockade, relation, mode),
      killStalled: async () =>
        (
          await blockade.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND pid <> pg_backend_pid()`,
          )
        ).rowCount ?? 0,
      commit: async (sql, values) => {
        await blocker.query(sql, [...values]);
        await blocker.query("COMMIT");
        held = false;
        blocker.release();
        await blockade.end();
      },
      release,
    };
  } catch (failure) {
    await release();
    throw failure;
  }
}

/**
 * Whether the backend stalled behind this blockade already holds `relation` in
 * `mode`. It is how a case says where in its transaction the stalled call had
 * got to, which is the difference between a claim about an interleaving and a
 * claim about a transaction that had done nothing yet: what a case reads after
 * killing a backend at its first statement is equally true of a transaction
 * that was never entered, and what it reads about lock order is equally true of
 * a caller that takes no lock at all.
 */
async function schedulerStalledHolds(
  blockade: pg.Pool,
  relation: string,
  mode: string,
): Promise<boolean> {
  const held = await blockade.query<{ held: number }>(
    `SELECT count(*)::int AS held FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE a.datname = current_database() AND a.wait_event_type = 'Lock'
        AND l.relation = $1::regclass AND l.mode = $2 AND l.granted`,
    [relation, mode],
  );
  return (held.rows[0]?.held ?? 0) > 0;
}

/** Resolves once that many backends are waiting on a lock in this database. */
async function schedulerStalled(
  blockade: pg.Pool,
  backends: number,
): Promise<void> {
  for (
    let waitedMs = 0;
    waitedMs < schedulerStallWaitMsMax;
    waitedMs += schedulerStallAskMs
  ) {
    const found = await blockade.query<{ stalled: number }>(
      `SELECT count(*)::int AS stalled FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((found.rows[0]?.stalled ?? 0) >= backends) return;
    await delay(schedulerStallAskMs);
  }
  throw new Error(
    `scheduler harness: fewer than ${String(backends)} backends stalled, so a case is asserting against a race it never set up`,
  );
}

/** A store call's outcome as a value, so a case can hold a doomed one without its rejection escaping. */
export function schedulerOutcome<Result>(
  running: Promise<Result>,
): Promise<Result | string> {
  return running.then(
    (result) => result,
    (failure: unknown) =>
      failure instanceof Error ? failure.message : String(failure),
  );
}

/**
 * A second spawn request for the same ticket, declaring the same first logical
 * task. It is what makes a contradictory registration reachable: two requests
 * cannot both own one logical task, and no legitimate path produces that, so a
 * case writes the row a writer would have to have written wrongly.
 */
export async function schedulerRivalRequest(
  rig: SchedulerRig,
  project: SchedulerProject,
  label: string,
): Promise<string> {
  const request = `request-rival-${label}-${randomUUID()}`;
  await rig.harness.query(
    `INSERT INTO execution_request
       (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
        kind,capacity_account,configuration_revision,configuration_digest,
        input_bundle,input_bundle_digest)
     SELECT q.tenant,q.project,$4,q.authorizing_seq,q.effect_position+1,q.ticket,
            q.ticket_version,'SpawnEvaluation',q.capacity_account,
            q.configuration_revision,q.configuration_digest,
            q.input_bundle,q.input_bundle_digest
       FROM execution_request q
      WHERE q.tenant=$1 AND q.project=$2 AND q.request=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      project.request,
      request,
    ],
  );
  await rig.harness.query(
    `INSERT INTO execution_request_task (tenant,project,request,task,kind,stage)
     VALUES ($1,$2,$3,1,'Evaluation',0)`,
    [project.partition.tenant, project.partition.project, request],
  );
  return request;
}

/** A pool whose every session runs as the authenticated web application's role. */
export function schedulerIngressPool(): pg.Pool {
  const url = new URL(postgresHarnessUrl());
  url.searchParams.set("options", `-c role=${apiRole}`);
  return postgresPool(url.toString());
}
