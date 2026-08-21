/**
 * What every scheduler case in this directory needs of a real PostgreSQL: a
 * store connected as the role that will actually run it, a project whose
 * dispatch left a spawn request to register, and the capacity it draws on.
 *
 * THE STORE RUNS AS `chuggy_scheduler` AND NOT AS THE MIGRATION OWNER. Every
 * grant migration nine writes is a claim about what that role may do, and a
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
 */

import { createHash, randomUUID } from "node:crypto";

import type pg from "pg";

import { revokeEvent } from "../../src/actor/decisionEvent.ts";
import { postgresExecutionScheduler } from "../../src/adapters/postgres/scheduler.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { schedulerRole } from "../../src/adapters/postgres/schema.ts";
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
    `UPDATE capacity_account SET cluster=$2, reserved=$3, maximum=$4
      WHERE account=$1 RETURNING account`,
    [
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
 * The claim a scheduler would be holding for one named request. Cases build it
 * rather than draw it, because `claimRequests` is installation-wide by design
 * and the suites share one database — a case drawing work would lease whatever
 * its neighbours had left open. The cases that are about the lease itself draw
 * for real.
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
