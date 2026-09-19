import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import { createHash } from "node:crypto";

import { decode, encode, canonical_json } from "../../interpreter/codec.ts";
import { asRepositoryId } from "../../interpreter/finalizer.ts";
import * as task from "../../domain/chuggernaut/task.js";
import {
  asRecoveryEpoch,
  type Partition,
  type RecoveryEpoch,
} from "../../interpreter/projectStore.ts";
import {
  ticketExecutionWorkerView,
  type TicketExecutionClaim,
  type TicketExecutionCredentialSubject,
  type TicketExecutionQueued,
  type TicketExecutionSettlement,
  type TicketExecutionStore,
  type TicketExecutionView,
} from "../../interpreter/ticketExecution.ts";
import type { TicketMachineInput } from "../../interpreter/ticketMachine.ts";
import { postgresTransaction } from "./pool.ts";

interface ExecutionRow {
  readonly tenant: string;
  readonly project: string;
  readonly delivery_identity: string;
  readonly task_key: string;
  readonly obligation: string;
  readonly attempt: string | null;
  readonly recovery_epoch: string | null;
}

function executionClaim(row: ExecutionRow): TicketExecutionClaim {
  if (row.attempt === null || row.recovery_epoch === null)
    throw new Error("ticket execution claim is incomplete");
  const attempt = Number(row.attempt);
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new Error("ticket execution attempt is invalid");
  return {
    partition: { tenant: row.tenant, project: row.project } as Partition,
    identity: row.delivery_identity,
    taskKey: row.task_key,
    obligation: decode(row.obligation, task.TaskObligation),
    attempt,
    recoveryEpoch: asRecoveryEpoch(row.recovery_epoch),
  };
}

async function executionPut(
  client: pg.PoolClient,
  partition: Partition,
  identity: string,
  taskKey: string,
  obligation: task.TaskObligation,
): Promise<boolean> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([partition.tenant, partition.project, taskKey])},0))::text AS locked`,
  );
  const serialized = encode(obligation);
  const cancelled = await client.query<{
    present: number;
  }>(sql`SELECT 1 AS present FROM ticket_execution_cancellation
    WHERE tenant=${partition.tenant} AND project=${partition.project} AND task_key=${taskKey}`);
  if (cancelled.rows[0] !== undefined) return true;
  const inserted = await client.query(sql`INSERT INTO ticket_execution
    (tenant,project,task_key,delivery_identity,obligation,required_capabilities)
    VALUES(${partition.tenant},${partition.project},${taskKey},${identity},${serialized},
      ${[...obligation.definition.execution_requirements.required_capabilities]}::text[])
    ON CONFLICT DO NOTHING`);
  if ((inserted.rowCount ?? 0) === 1) return true;
  const found = await client.query<{
    delivery_identity: string;
    obligation: string;
  }>(
    sql`SELECT delivery_identity,obligation FROM ticket_execution
        WHERE tenant=${partition.tenant} AND project=${partition.project} AND task_key=${taskKey}`,
  );
  const row = found.rows[0];
  if (row?.delivery_identity !== identity || row.obligation !== serialized)
    throw new Error(
      "ticket execution identity conflicts with its immutable obligation",
    );
  return true;
}

async function executionCancel(
  client: pg.PoolClient,
  partition: Partition,
  identity: string,
  taskKey: string,
): Promise<boolean> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([partition.tenant, partition.project, taskKey])},0))::text AS locked`,
  );
  const inserted =
    await client.query(sql`INSERT INTO ticket_execution_cancellation(tenant,project,identity,task_key)
    VALUES(${partition.tenant},${partition.project},${identity},${taskKey}) ON CONFLICT DO NOTHING`);
  if ((inserted.rowCount ?? 0) === 0) {
    const prior = await client.query<{
      identity: string;
    }>(sql`SELECT identity FROM ticket_execution_cancellation
      WHERE tenant=${partition.tenant} AND project=${partition.project} AND task_key=${taskKey}`);
    if (prior.rows[0]?.identity !== identity)
      throw new Error(
        "ticket execution cancellation identity conflicts with its task",
      );
  }
  const found = await client.query<{
    state: string;
  }>(sql`SELECT state FROM ticket_execution
    WHERE tenant=${partition.tenant} AND project=${partition.project} AND task_key=${taskKey} FOR UPDATE`);
  const state = found.rows[0]?.state;
  if (state === undefined || state === "Terminal" || state === "Cancelled")
    return true;
  await client.query(sql`UPDATE ticket_execution SET state='Cancelled',claim_owner=NULL,claim_expires_at=NULL,recovery_epoch=NULL
    WHERE tenant=${partition.tenant} AND project=${partition.project} AND task_key=${taskKey}`);
  return true;
}

async function executionClaimed(
  pool: pg.Pool,
  owner: string,
  recoveryEpoch: RecoveryEpoch,
  leaseSecs: number,
  limit: number,
  capabilities: readonly string[],
): Promise<readonly TicketExecutionClaim[]> {
  const found = await pool.query<ExecutionRow>(sql`UPDATE ticket_execution e SET
      state='Running',attempt=e.attempt+1,claim_owner=${owner},capability_digest=NULL,worker_outcome=NULL,
      pool=NULL,assignment=NULL,pool_refusal=NULL,
      claim_expires_at=now()+make_interval(secs=>${leaseSecs}::double precision),
      recovery_epoch=${recoveryEpoch}
    WHERE ${recoveryEpoch}=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
      AND (e.tenant,e.project,e.task_key) IN (
      SELECT q.tenant,q.project,q.task_key FROM ticket_execution q
      WHERE (q.state='Queued' OR (q.state='Running' AND q.claim_expires_at<=now()))
        AND q.available_at<=now() AND q.required_capabilities <@ ${[...capabilities]}::text[]
        AND EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=q.tenant AND p.project=q.project AND p.lifecycle='Active'
            AND p.ticket_model='Chuggernaut')
        ORDER BY q.available_at,q.task_key
      LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING e.tenant,e.project,e.delivery_identity,e.task_key,e.obligation,e.attempt::text,e.recovery_epoch`);
  return found.rows.map(executionClaim);
}

/**
 * The work that waited out its window without a claimant, taken by the
 * orchestrator so it can be reported. It is claimed rather than read, because
 * a terminal is written against a held claim, and the lease, the epoch fence
 * and SKIP LOCKED then keep two passes from reporting one task twice.
 * Capabilities are not matched, because work nobody can run is exactly what
 * this pass exists to settle.
 */
async function executionUnclaimable(
  pool: pg.Pool,
  owner: string,
  recoveryEpoch: RecoveryEpoch,
  leaseSecs: number,
  limit: number,
  windowSecs: number,
): Promise<readonly TicketExecutionClaim[]> {
  const found = await pool.query<ExecutionRow>(sql`UPDATE ticket_execution e SET
      state='Running',attempt=e.attempt+1,claim_owner=${owner},capability_digest=NULL,worker_outcome=NULL,
      pool=NULL,assignment=NULL,pool_refusal=NULL,
      claim_expires_at=now()+make_interval(secs=>${leaseSecs}::double precision),
      recovery_epoch=${recoveryEpoch}
    WHERE ${recoveryEpoch}=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
      AND (e.tenant,e.project,e.task_key) IN (
      SELECT q.tenant,q.project,q.task_key FROM ticket_execution q
      WHERE q.state='Queued' AND q.attempt=0
        AND q.queued_at+make_interval(secs=>${windowSecs}::double precision)<=now()
        AND EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=q.tenant AND p.project=q.project AND p.lifecycle='Active'
            AND p.ticket_model='Chuggernaut')
        ORDER BY q.queued_at,q.task_key
      LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING e.tenant,e.project,e.delivery_identity,e.task_key,e.obligation,e.attempt::text,e.recovery_epoch`);
  return found.rows.map(executionClaim);
}

async function executionTerminal(
  client: pg.PoolClient,
  claim: TicketExecutionClaim,
  input: TicketMachineInput,
): Promise<boolean> {
  if (
    input.origin !== "Execution" ||
    input.command.kind !== "ReportTaskTerminal"
  )
    throw new TypeError("execution terminal requires a task terminal report");
  const project = await client.query<{
    lifecycle: string;
    ticket_model: string;
  }>(sql`
    SELECT lifecycle,ticket_model FROM project
    WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project}`);
  if (
    project.rows[0]?.lifecycle !== "Active" ||
    project.rows[0].ticket_model !== "Chuggernaut"
  )
    return false;
  const held = await client.query<{
    task_key: string;
  }>(sql`SELECT task_key FROM ticket_execution
    WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project}
      AND task_key=${claim.taskKey} AND state='Running' AND attempt=${claim.attempt}
      AND claim_expires_at>now() AND recovery_epoch=${claim.recoveryEpoch}
      AND recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) FOR UPDATE`);
  if (held.rows.length === 0) return false;
  const accepted = await client.query<{ accepted: string | null }>(sql`
    SELECT accept_ticket_execution_input(${claim.partition.tenant},${claim.partition.project},${input.identity},${encode(input.command)},${canonical_json(input.authorization)},${null})::text AS accepted`);
  if (
    accepted.rows[0]?.accepted !== "Accepted" &&
    accepted.rows[0]?.accepted !== "AlreadyAccepted"
  )
    return false;
  await client.query(sql`UPDATE ticket_execution SET state='Terminal',
    terminal_input_identity=${input.identity},claim_owner=NULL,claim_expires_at=NULL,recovery_epoch=NULL
    WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project} AND task_key=${claim.taskKey}`);
  return true;
}

/** Queued work the orchestrator has not resolved a harness view for yet. */
async function executionUnprepared(
  pool: pg.Pool,
  limit: number,
): Promise<readonly TicketExecutionQueued[]> {
  const found = await pool.query<{
    tenant: string;
    project: string;
    task_key: string;
    obligation: string;
  }>(sql`SELECT q.tenant,q.project,q.task_key,q.obligation FROM ticket_execution q
    WHERE q.state='Queued' AND q.worker_view IS NULL
      AND EXISTS(SELECT 1 FROM project p
        WHERE p.tenant=q.tenant AND p.project=q.project AND p.lifecycle='Active'
          AND p.ticket_model='Chuggernaut')
    ORDER BY q.queued_at,q.task_key LIMIT ${limit}`);
  return found.rows.map((row) => ({
    partition: { tenant: row.tenant, project: row.project } as Partition,
    taskKey: row.task_key,
    obligation: decode(row.obligation, task.TaskObligation),
  }));
}

/** The pool-held attempts carrying something to settle, with the claim each was written under. */
async function executionSettlements(
  pool: pg.Pool,
  limit: number,
): Promise<readonly TicketExecutionSettlement[]> {
  const found = await pool.query<{
    tenant: string;
    project: string;
    delivery_identity: string;
    task_key: string;
    obligation: string;
    attempt: string;
    recovery_epoch: string;
    worker_outcome: unknown;
    pool_refusal: string | null;
  }>(sql`SELECT e.tenant,e.project,e.delivery_identity,e.task_key,e.obligation,
      e.attempt::text,e.recovery_epoch,e.worker_outcome,e.pool_refusal
    FROM ticket_execution e
    WHERE e.pool IS NOT NULL AND e.state='Running' AND e.claim_expires_at>now()
      AND (e.worker_outcome IS NOT NULL OR e.pool_refusal IS NOT NULL)
      AND e.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
      AND EXISTS(SELECT 1 FROM project p
        WHERE p.tenant=e.tenant AND p.project=e.project AND p.lifecycle='Active'
          AND p.ticket_model='Chuggernaut')
    ORDER BY e.claim_expires_at,e.task_key LIMIT ${limit}`);
  return found.rows.map((row) => ({
    claim: executionClaim(row),
    ...(row.pool_refusal === null
      ? { outcome: row.worker_outcome }
      : { refusal: row.pool_refusal }),
  }));
}

export function postgresTicketExecution(pool: pg.Pool): TicketExecutionStore {
  return {
    execute: (partition, identity, taskKey, obligation) =>
      postgresTransaction(pool, (client) =>
        executionPut(client, partition, identity, taskKey, obligation),
      ),
    cancel: (partition, identity, taskKey) =>
      postgresTransaction(pool, (client) =>
        executionCancel(client, partition, identity, taskKey),
      ),
    claim: (owner, recoveryEpoch, leaseSecs, limit, capabilities) =>
      executionClaimed(
        pool,
        owner,
        recoveryEpoch,
        leaseSecs,
        limit,
        capabilities,
      ),
    unclaimable: (owner, recoveryEpoch, leaseSecs, limit, windowSecs) =>
      executionUnclaimable(
        pool,
        owner,
        recoveryEpoch,
        leaseSecs,
        limit,
        windowSecs,
      ),
    unprepared: (limit) => executionUnprepared(pool, limit),
    prepare: async (partition, taskKey, view) => {
      const updated =
        await pool.query(sql`UPDATE ticket_execution SET worker_view=${JSON.stringify(ticketExecutionWorkerView(view))}::jsonb
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND task_key=${taskKey} AND state='Queued' AND worker_view IS NULL`);
      return (updated.rowCount ?? 0) === 1;
    },
    settlements: (limit) => executionSettlements(pool, limit),
    retry: async (claim, retryAfterSecs) => {
      await pool.query(sql`UPDATE ticket_execution SET state='Queued',claim_owner=NULL,claim_expires_at=NULL,recovery_epoch=NULL,
          available_at=now()+make_interval(secs=>${retryAfterSecs}::double precision)
        WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project}
          AND task_key=${claim.taskKey} AND state='Running' AND attempt=${claim.attempt}
          AND recovery_epoch=${claim.recoveryEpoch} AND recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
    },
    terminal: (claim, input) =>
      postgresTransaction(pool, (client) =>
        executionTerminal(client, claim, input),
      ),
    cancelled: async (claim) => {
      const found = await pool.query<{
        cancelled: boolean;
      }>(sql`SELECT NOT EXISTS(
        SELECT 1 FROM ticket_execution e JOIN project p ON p.tenant=e.tenant AND p.project=e.project
        WHERE e.tenant=${claim.partition.tenant} AND e.project=${claim.partition.project} AND e.task_key=${claim.taskKey}
          AND e.state='Running' AND e.attempt=${claim.attempt} AND e.claim_expires_at>now()
          AND e.recovery_epoch=${claim.recoveryEpoch} AND p.lifecycle='Active'
          AND e.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)) AS cancelled`);
      return found.rows[0]?.cancelled === true;
    },
  };
}

/**
 * The outcome a terminal offers, which is all of it. The attempt it belongs to
 * is the bearer's, so a body naming one would be a caller's word for something
 * the digest already decided.
 */
function ticketTerminalBody(
  value: unknown,
): { readonly outcome: unknown } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const body = value as Record<string, unknown>;
  return body["outcome"] === undefined
    ? undefined
    : { outcome: body["outcome"] };
}

/** Binds one attempt to the bearer its harness answers under, and to the view it is served. */
async function executionBind(
  pool: pg.Pool,
  claim: TicketExecutionClaim,
  capabilityDigest: string,
  view: TicketExecutionView,
): Promise<boolean> {
  const updated =
    await pool.query(sql`UPDATE ticket_execution SET capability_digest=${capabilityDigest},
      worker_view=${JSON.stringify(ticketExecutionWorkerView(view))}::jsonb
    WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project}
      AND task_key=${claim.taskKey} AND state='Running' AND attempt=${claim.attempt}
      AND recovery_epoch=${claim.recoveryEpoch} AND claim_expires_at>now()
      AND recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1) AND capability_digest IS NULL`);
  return (updated.rowCount ?? 0) === 1;
}

/** The view one live attempt is served, found by the digest of the bearer asking. */
async function executionWorkerView(
  pool: pg.Pool,
  capabilityDigest: string,
): Promise<unknown> {
  const found = await pool.query<{
    worker_view: unknown;
  }>(sql`SELECT worker_view FROM ticket_execution
    WHERE capability_digest=${capabilityDigest} AND state='Running'
      AND claim_expires_at>now()
      AND recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
  return found.rows[0]?.worker_view ?? undefined;
}

/**
 * Whom one live attempt's credential is minted for, taken off the same row and
 * under the same bearer its view is served from. The repository and the access
 * are read out of the view the scheduler materialised at bind time, so they
 * are the attempt's own and not the caller's.
 */
async function executionWorkerCredentialSubject(
  pool: pg.Pool,
  capabilityDigest: string,
): Promise<TicketExecutionCredentialSubject | undefined> {
  const found = await pool.query<{
    tenant: string;
    project: string;
    worker_view: unknown;
  }>(sql`SELECT tenant,project,worker_view FROM ticket_execution
    WHERE capability_digest=${capabilityDigest} AND state='Running'
      AND claim_expires_at>now()
      AND recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
  const row = found.rows[0];
  if (row === undefined || row.worker_view === null) return undefined;
  const view = row.worker_view as { repository?: unknown; access?: unknown };
  if (typeof view.repository !== "string" || view.repository.length === 0)
    return undefined;
  return {
    partition: { tenant: row.tenant, project: row.project } as Partition,
    repository: asRepositoryId(view.repository),
    access:
      view.access === "PublishRepositoryResult"
        ? "PublishRepositoryResult"
        : "ReadRepository",
  };
}

export function postgresTicketExecutionTerminals(pool: pg.Pool): {
  bind(
    claim: TicketExecutionClaim,
    secret: string,
    view: TicketExecutionView,
  ): Promise<boolean>;
  renew(claim: TicketExecutionClaim, leaseSecs: number): Promise<boolean>;
  outcome(claim: TicketExecutionClaim): Promise<unknown>;
  view(secret: string): Promise<unknown>;
  credential(
    secret: string,
  ): Promise<TicketExecutionCredentialSubject | undefined>;
  report(
    secret: string,
    body: unknown,
  ): Promise<"Recorded" | "Conflict" | "Fenced">;
} {
  const digest = (secret: string): string =>
    createHash("sha256").update(secret).digest("hex");
  return {
    renew: async (claim, leaseSecs) => {
      if (!Number.isSafeInteger(leaseSecs) || leaseSecs < 1)
        throw new RangeError("invalid execution lease");
      const updated =
        await pool.query(sql`UPDATE ticket_execution e SET claim_expires_at=now()+make_interval(secs=>${leaseSecs}::double precision)
        WHERE e.tenant=${claim.partition.tenant} AND e.project=${claim.partition.project} AND e.task_key=${claim.taskKey}
          AND e.state='Running' AND e.attempt=${claim.attempt} AND e.claim_expires_at>now()
          AND e.recovery_epoch=${claim.recoveryEpoch} AND e.recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)
          AND EXISTS(SELECT 1 FROM project p WHERE p.tenant=e.tenant AND p.project=e.project AND p.lifecycle='Active')`);
      return updated.rowCount === 1;
    },
    bind: (claim, secret, view) =>
      executionBind(pool, claim, digest(secret), view),
    outcome: async (claim) => {
      const found = await pool.query<{
        worker_outcome: unknown;
      }>(sql`SELECT worker_outcome FROM ticket_execution
        WHERE tenant=${claim.partition.tenant} AND project=${claim.partition.project}
          AND task_key=${claim.taskKey} AND state='Running' AND attempt=${claim.attempt}
          AND recovery_epoch=${claim.recoveryEpoch} AND claim_expires_at>now()
          AND recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
      return found.rows[0]?.worker_outcome ?? undefined;
    },
    view: (secret) => executionWorkerView(pool, digest(secret)),
    credential: (secret) =>
      executionWorkerCredentialSubject(pool, digest(secret)),
    report: async (secret, offered) => {
      const body = ticketTerminalBody(offered);
      if (body === undefined) return "Conflict";
      const updated =
        await pool.query(sql`UPDATE ticket_execution SET worker_outcome=${JSON.stringify(body.outcome)}::jsonb
        WHERE capability_digest=${digest(secret)}
          AND state='Running' AND claim_expires_at>now() AND worker_outcome IS NULL
          AND recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
      if ((updated.rowCount ?? 0) === 1) return "Recorded";
      const found = await pool.query<{
        worker_outcome: unknown;
      }>(sql`SELECT worker_outcome FROM ticket_execution
        WHERE capability_digest=${digest(secret)}
          AND state='Running' AND claim_expires_at>now() AND recovery_epoch=(SELECT epoch FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1)`);
      const prior = found.rows[0];
      if (prior === undefined) return "Fenced";
      return canonical_json(prior.worker_outcome) ===
        canonical_json(body.outcome)
        ? "Recorded"
        : "Conflict";
    },
  };
}
