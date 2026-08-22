/**
 * The durable execution authority against PostgreSQL: claiming the work a
 * decision authorized, registering it, admitting it against capacity, and
 * opening and accounting for the attempts that run it.
 *
 * THE REQUEST ROW LOCK IS THE AUTHORITY AND THE CLAIM IS ONLY A LEASE.
 * `claimRequests` hands work out with `FOR UPDATE SKIP LOCKED` and a bounded
 * lease, so two scheduler processes never draw the same request and a lapsed
 * one is redrawn — that is what the lease is for. It is not what makes
 * registration safe: registration locks the request row and reads its state, so
 * a process whose lease lapsed mid-flight finds the work already registered
 * rather than doing it twice. Fencing registration on the lease as well would
 * add a second answer to a question the durable state already settles.
 *
 * REGISTRATION IS IDEMPOTENT AT THE LOGICAL TASK AND NOWHERE ELSE.
 * `execution_names_one_logical_task` is the idempotency key, so a retry creates
 * exactly the rows it is missing and collides on the ones it made, and the
 * immutable payload of a row it made earlier is never rewritten. A logical task
 * already registered under a different spawn request is not a retry at all: it
 * is a contradiction, and it raises an incident instead of quietly winning.
 *
 * A DELAYED REGISTRATION CANNOT RESURRECT REVOKED WORK. Cancellation invalidates
 * every still-open spawn request for its ticket that an earlier sequence
 * authorized, and registration refuses a request whose ticket a later
 * cancellation has already retired. Both halves are needed: the first closes the
 * window where the spawn has not been claimed yet, the second the window where
 * it was claimed before the cancellation and reached its transaction after.
 *
 * ADMISSION SERIALIZES ON THE CLUSTER AND DECIDES FROM DURABLE ROWS.
 * `model/capacity.qnt`'s `mayAdmit` reads a count over the whole ledger, so two
 * admissions reading it concurrently would both see room that only one of them
 * can have. The scheduler role may not lock `execution_cluster` — locking a row
 * needs write privilege on it and capacity policy is not the scheduler's to
 * write — so the serialization is a transaction-scoped advisory lock keyed by
 * the cluster. It guards an arithmetic rather than an authority; the authority
 * stays the durable allocations, which is why no count is cached anywhere.
 *
 * A LAPSED ATTEMPT LEASE IS ENDED BEFORE ANY LAUNCH IS OFFERED, AND ENDING IT IS
 * ITS OWN CALL. An attempt whose lease has run out is no longer live, but its
 * row still says it is, and the partial unique index that makes one unfenced
 * reporter would refuse the replacement. So reaping is a durable move the pass
 * asks for by name, spending the safe retry budget the way any attempt that ran
 * and vanished does, and the launch read that follows it writes nothing. Both
 * refuse to do anything at all under a superseded recovery epoch, because a
 * restore withdraws the authority a scheduler was holding before it.
 *
 * ROWS ARE TAKEN IN ONE ORDER: REQUEST, THEN EXECUTION, THEN PROJECT, THEN
 * ATTEMPT — AND WITHIN EACH OF THOSE, IN KEY ORDER. A worker reporting on a
 * task while the same pass cancels its ticket is two transactions over the same
 * rows, and two orders between them is a deadlock the server resolves by
 * aborting one — which discards the rest of a pass that has no retry. An order
 * over classes alone is not enough for that: a transaction taking several rows
 * of one class takes them in whatever order its plan produces, so two sweeps
 * over one pair of attempts can still hold each other's next row. So every
 * statement here that can touch more than one row of a class takes those rows
 * first, in an `ORDER BY` over their key, under `FOR UPDATE` — registrations by
 * `(tenant, project, execution)` and attempts by that and their own identity —
 * and only then writes them. The order is what makes the deadlock unreachable
 * rather than merely rare, which no retry can do.
 *
 * EVERY SWEEP IS BOUNDED PER PASS AND RESUMES WHERE IT STOPPED. Fencing an old
 * epoch's attempts and reaping lapsed leases are both over the whole
 * installation, so a restore of a large one would otherwise be a single
 * statement rewriting every live attempt, exceeding the statement timeout,
 * aborting, and being retried identically by every later pass — an installation
 * where nothing is ever fenced at all. Both take the bound the caller declares,
 * apply it to the ordered lock that leads them, and leave the rest to the next
 * pass.
 *
 * NOTHING HERE READS A CLOCK. Every lease, expiry and backoff is a duration
 * handed to the server, which is the only party whose clock the durable state
 * is allowed to depend on.
 */

import { sql } from "@ts-safeql/sql-tag";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import {
  asAttemptId,
  asExecutionId,
  executionOwnsSlot,
  type Admitted,
  type AttemptEvidence,
  type AttemptLoss,
  type AttemptOpened,
  type AttemptOpening,
  type CancellationRegistered,
  type ClusterId,
  type ExecutionId,
  type ExecutionSchedulerStore,
  type FencedAttempt,
  type LogicalExecution,
  type RequestClaim,
  type SchedulerIncidentKind,
  type SchedulerOwnerId,
  type SpawnRegistered,
  type WorkloadId,
} from "../../interpreter/executionScheduler.ts";
import type {
  Partition,
  RecoveryEpoch,
} from "../../interpreter/projectStore.ts";
import { asTicketId } from "../../domain/ids.ts";
import { postgresOwnershipEpoch } from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";
import {
  schedulerBlockExecution,
  schedulerEvidence,
  schedulerFulfilRequest,
  schedulerRecordIncident,
  schedulerRetriesExhausted,
  schedulerTerminalize,
} from "./schedulerCompletion.ts";
import {
  attemptRowPhysical,
  executionRowLogical,
  schedulerRowPartition,
  type AttemptRow,
  type ExecutionRow,
} from "./schedulerRows.ts";

/**
 * The namespace the admission lock is taken in. It is an arbitrary constant
 * whose only requirement is that nothing else in this database uses it.
 */
const admissionLockNamespace = 0x63687536;

/** One registration named the way an installation-wide sweep has to name it. */
interface SchedulerRowKey {
  readonly tenant: string;
  readonly project: string;
  readonly execution: string;
}

/**
 * The same keys as three parallel arrays, which is how a statement carries a set
 * of composite keys the server can join against.
 */
function schedulerRowKeys(
  rows: readonly SchedulerRowKey[],
): [readonly string[], readonly string[], readonly string[]] {
  return [
    rows.map((row) => row.tenant),
    rows.map((row) => row.project),
    rows.map((row) => row.execution),
  ];
}

/** One claimed request row. */
interface ClaimRow {
  readonly tenant: string;
  readonly project: string;
  readonly request: string;
  readonly kind: string;
  readonly ticket: string | null;
  readonly authorizing_seq: string | null;
  readonly claim_generation: string | null;
}

/** Refuses a missing value in a request kind whose schema permits other kinds to omit it. */
function claimRowRequired(value: string | null, what: string): string {
  if (value === null) {
    throw new Error(`execution request row: claimed ${what} is null`);
  }
  return value;
}

/** One request row as registration and cancellation read it under their lock. */
interface RequestRow {
  readonly state: string;
  readonly authorizing_seq: string;
}

/** Refuses a bound no work can be handed out under, naming the argument rather than the row. */
function schedulerRequirePositive(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `postgres scheduler: ${what} is ${String(value)}, and a bound is a positive safe integer`,
    );
  }
}

/** Narrows the request kind column to the closed set the port declares. */
function claimRowKind(value: string): RequestClaim["kind"] {
  if (
    value !== "SpawnWork" &&
    value !== "SpawnEvaluation" &&
    value !== "CancelTicketWork"
  ) {
    throw new Error(
      `execution request row: ${value} is not a focused request kind this code knows`,
    );
  }
  return value;
}

/** What one claimed row grants its holder. */
function claimRowClaim(row: ClaimRow, owner: SchedulerOwnerId): RequestClaim {
  return {
    partition: schedulerRowPartition(row),
    request: row.request,
    kind: claimRowKind(row.kind),
    ticket: asTicketId(
      projectRowCounter(
        claimRowRequired(row.ticket, "ticket"),
        "request ticket",
      ),
    ),
    authorizingSeq: projectRowCounter(
      claimRowRequired(row.authorizing_seq, "authorizing sequence"),
      "authorizing sequence",
    ),
    generation: projectRowCounter(
      claimRowRequired(row.claim_generation, "claim generation"),
      "claim generation",
    ),
    owner,
  };
}

/** Takes a bounded lease on the unclaimed or lapsed requests of the kinds named. */
async function schedulerClaimRequests(
  pool: pg.Pool,
  owner: SchedulerOwnerId,
  kinds: readonly RequestClaim["kind"][],
  requestsMax: number,
  leaseSecs: number,
): Promise<readonly RequestClaim[]> {
  schedulerRequirePositive(requestsMax, "requestsMax");
  schedulerRequirePositive(leaseSecs, "leaseSecs");
  const claimed = await pool.query<ClaimRow>(
    sql`UPDATE execution_request r
        SET claim_owner = ${owner},
            claim_generation = r.claim_generation + 1,
            claim_expires_at = now() + make_interval(secs => ${leaseSecs}::double precision)
      WHERE (r.tenant, r.project, r.request) IN (
              SELECT q.tenant, q.project, q.request FROM execution_request q
               WHERE q.kind = ANY(${[...kinds]}::text[]) AND q.state = 'Open'
                 AND (q.claim_owner IS NULL OR q.claim_expires_at <= now())
               ORDER BY q.authorizing_seq, q.request
               LIMIT ${requestsMax} FOR UPDATE SKIP LOCKED)
      RETURNING r.tenant, r.project, r.request, r.kind, r.ticket::text AS ticket,
                r.authorizing_seq::text AS authorizing_seq,
                r.claim_generation::text AS claim_generation`,
  );
  return claimed.rows.map((row) => claimRowClaim(row, owner));
}

/** Locks the request this claim names and reads the delivery state it is in. */
async function schedulerLockRequest(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<RequestRow> {
  const found = await client.query<RequestRow>(
    sql`SELECT state, authorizing_seq::text AS authorizing_seq FROM execution_request
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request} FOR UPDATE`,
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: ${claim.partition.tenant}/${claim.partition.project} has no request ${claim.request}`,
    );
  }
  return row;
}

/**
 * Locks every request authorizing work under this claim's ticket, in request
 * order, and answers the state of the claim's own. Taking all of them before any
 * registration is read is what makes a registration committing alongside a
 * cancellation visible to it rather than missed: a registration holds its own
 * request row for the whole of its transaction, so a cancellation that is past
 * this call is a cancellation no registration for the ticket is still inside.
 */
async function schedulerLockTicketRequests(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<RequestRow> {
  const found = await client.query<RequestRow & { request: string }>(
    sql`SELECT request, state, authorizing_seq::text AS authorizing_seq
       FROM execution_request
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND ticket = ${claim.ticket}
      ORDER BY request FOR UPDATE`,
  );
  const row = found.rows.find((each) => each.request === claim.request);
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: ${claim.partition.tenant}/${claim.partition.project} has no request ${claim.request}`,
    );
  }
  return row;
}

/** Moves the request to the delivery state named and gives its claim back. */
async function schedulerRequestState(
  client: pg.PoolClient,
  claim: RequestClaim,
  state: "Registered" | "Fulfilled" | "Invalidated",
): Promise<void> {
  await client.query(
    sql`UPDATE execution_request
        SET state = ${state}, claim_owner = NULL, claim_expires_at = NULL
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}`,
  );
}

/**
 * Whether a cancellation authorized after this spawn has retired the work it
 * would create. The cancellation request's own delivery state is deliberately
 * not read: the revocation is durable as soon as the writer journaled it, and a
 * registration that waited for the scheduler to process it would create work
 * the cancellation had not reached yet and would then have to retire.
 */
async function schedulerTicketRetired(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<boolean> {
  const found = await client.query<{ one: number }>(
    sql`SELECT 1 AS one FROM execution_request
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND ticket = ${claim.ticket}
        AND kind = 'CancelTicketWork' AND authorizing_seq > ${claim.authorizingSeq}`,
  );
  return found.rows.length > 0;
}

/** A logical task this request declares that another request has already registered. */
async function schedulerRegistrationConflict(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<string | undefined> {
  const found = await client.query<{ execution: string }>(
    sql`SELECT e.execution FROM execution e
       JOIN execution_request_task t
         ON t.tenant = e.tenant AND t.project = e.project AND t.task = e.task
      WHERE e.tenant = ${claim.partition.tenant} AND e.project = ${claim.partition.project}
        AND e.ticket = ${claim.ticket}
        AND t.request = ${claim.request} AND e.source_request <> ${claim.request} LIMIT 1`,
  );
  return found.rows[0]?.execution;
}

/** Creates the executions this request authorizes that do not exist yet, and only those. */
async function schedulerCreateExecutions(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<number> {
  const stem = `execution-${randomUUID()}`;
  const created = await client.query(
    sql`INSERT INTO execution
       (tenant, project, execution, ticket, task, source_request, account, cluster,
        configuration_revision, configuration_digest)
     SELECT q.tenant, q.project, ${stem}::text || '-' || t.task::text, q.ticket, t.task, q.request,
            q.capacity_account, a.cluster, q.configuration_revision, q.configuration_digest
       FROM execution_request q
       JOIN execution_request_task t
         ON t.tenant = q.tenant AND t.project = q.project AND t.request = q.request
       JOIN capacity_account a ON a.account = q.capacity_account
      WHERE q.tenant = ${claim.partition.tenant} AND q.project = ${claim.partition.project}
        AND q.request = ${claim.request}
     ON CONFLICT (tenant, project, ticket, task) DO NOTHING`,
  );
  return created.rowCount ?? 0;
}

/** How many of the request's declared tasks are still missing a registration. */
async function schedulerUnregisteredTasks(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<number> {
  const found = await client.query<{ owed: string }>(
    sql`SELECT count(*)::text AS owed FROM execution_request_task t
      WHERE t.tenant = ${claim.partition.tenant} AND t.project = ${claim.partition.project}
        AND t.request = ${claim.request}
        AND NOT EXISTS (SELECT 1 FROM execution e
                         WHERE e.tenant = t.tenant AND e.project = t.project
                           AND e.source_request = t.request AND e.task = t.task)`,
  );
  return projectRowCounter(found.rows[0]?.owed ?? "0", "unregistered tasks");
}

/**
 * Records the contradiction a registration reached and takes the request out of
 * the open set, because a request whose logical task another one owns cannot be
 * delivered by any later attempt at it, and leaving it `Open` would only hand it
 * to the next claim after this one's lease lapsed, to reach the same
 * contradiction and write the same incident again. `Invalidated` is the delivery
 * state for a request that will not be registered, and the incident beside it is
 * the record of why.
 */
async function schedulerContradicted(
  client: pg.PoolClient,
  claim: RequestClaim,
  kind: SchedulerIncidentKind,
  evidence: string,
  subject: { readonly execution?: string } = {},
): Promise<SpawnRegistered> {
  const incident = await schedulerRecordIncident(
    client,
    claim.partition,
    kind,
    evidence,
    subject,
  );
  await schedulerRequestState(client, claim, "Invalidated");
  return { registered: "Conflicting", incident };
}

/** Creates or finds the exact logical executions one spawn request authorized. */
async function schedulerRegisterSpawn(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<SpawnRegistered> {
  const request = await schedulerLockRequest(client, claim);
  if (request.state === "Invalidated") return { registered: "Superseded" };
  if (request.state !== "Open") {
    return { registered: "AlreadyRegistered", created: 0 };
  }
  if (await schedulerTicketRetired(client, claim)) {
    await schedulerRequestState(client, claim, "Invalidated");
    return { registered: "Superseded" };
  }
  const conflict = await schedulerRegistrationConflict(client, claim);
  if (conflict !== undefined) {
    return schedulerContradicted(
      client,
      claim,
      "ConflictingRegistration",
      schedulerEvidence.ConflictingRegistration,
      { execution: conflict },
    );
  }
  const created = await schedulerCreateExecutions(client, claim);
  if ((await schedulerUnregisteredTasks(client, claim)) > 0) {
    return schedulerContradicted(
      client,
      claim,
      "ImpossibleState",
      schedulerEvidence.PartialRegistration,
    );
  }
  await schedulerRequestState(client, claim, "Registered");
  await schedulerFulfilRequest(client, claim.partition, claim.request);
  return created > 0
    ? { registered: "Registered", created }
    : { registered: "AlreadyRegistered", created: 0 };
}

/** One retired registration: the row whose slot was released, and what authorized it. */
interface RetiredRow {
  readonly execution: string;
  readonly source_request: string;
}

/**
 * Retires every logical task under the ticket, releasing one slot for each. The
 * registrations are taken in key order before anything is written, because a
 * bare `UPDATE` takes them in its plan's order — which for a ticket whose tasks
 * came from two spawn requests is not the order the reaping sweep reaches the
 * same rows in.
 */
async function schedulerRetireTicket(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<readonly RetiredRow[]> {
  await client.query<{ execution: string }>(
    sql`SELECT e.execution FROM execution e
      WHERE e.tenant = ${claim.partition.tenant} AND e.project = ${claim.partition.project}
        AND e.ticket = ${claim.ticket}
        AND e.status NOT IN ('Terminal', 'Cancelled')
      ORDER BY e.tenant, e.project, e.execution FOR UPDATE`,
  );
  const retired = await client.query<RetiredRow>(
    sql`UPDATE execution SET status = 'Cancelled', terminal_at = now()
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND ticket = ${claim.ticket}
        AND status NOT IN ('Terminal', 'Cancelled')
      RETURNING execution, source_request`,
  );
  return retired.rows;
}

/**
 * Fences every attempt still able to report under the registrations just
 * retired, taking them in key order first so this sweep and the two
 * installation-wide ones reach a shared pair of attempts the same way round.
 */
async function schedulerFenceRetired(
  client: pg.PoolClient,
  claim: RequestClaim,
  retired: readonly RetiredRow[],
): Promise<readonly string[]> {
  const executions = retired.map((row) => row.execution);
  await client.query<{ attempt: string }>(
    sql`SELECT a.attempt FROM execution_attempt a
      WHERE a.tenant = ${claim.partition.tenant} AND a.project = ${claim.partition.project}
        AND a.execution = ANY(${executions}::text[])
        AND a.state IN ('Placing', 'Running')
      ORDER BY a.tenant, a.project, a.execution, a.attempt FOR UPDATE`,
  );
  const fenced = await client.query<{ attempt: string }>(
    sql`UPDATE execution_attempt a
        SET state = 'Superseded', generation = a.generation + 1,
            evidence = 'Fenced', ended_at = now(),
            lease_owner = NULL, lease_expires_at = NULL
      WHERE a.tenant = ${claim.partition.tenant} AND a.project = ${claim.partition.project}
        AND a.execution = ANY(${executions}::text[])
        AND a.state IN ('Placing', 'Running')
      RETURNING a.attempt`,
  );
  return fenced.rows.map((row) => row.attempt);
}

/** Invalidates the spawn requests an earlier sequence authorized for this retired ticket. */
async function schedulerInvalidateSpawns(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<void> {
  await client.query(
    sql`UPDATE execution_request
        SET state = 'Invalidated', claim_owner = NULL, claim_expires_at = NULL
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND ticket = ${claim.ticket}
        AND kind IN ('SpawnWork', 'SpawnEvaluation') AND state = 'Open'
        AND authorizing_seq < ${claim.authorizingSeq}`,
  );
}

/** Fences every task a cancellation request names, then fulfills the request. */
async function schedulerRegisterCancellation(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<CancellationRegistered> {
  const request = await schedulerLockTicketRequests(client, claim);
  if (request.state !== "Open") return { cancelled: "AlreadyFulfilled" };
  const retired = await schedulerRetireTicket(client, claim);
  const workloads = await schedulerFenceRetired(client, claim, retired);
  await schedulerInvalidateSpawns(client, claim);
  for (const source of new Set(retired.map((row) => row.source_request))) {
    await schedulerFulfilRequest(client, claim.partition, source);
  }
  await schedulerRequestState(client, claim, "Fulfilled");
  return {
    cancelled: "Registered",
    fenced: retired.length,
    workloads: workloads.map(asAttemptId),
  };
}

/** The cluster ledger as admission reads it, under the lock that serializes admissions. */
async function schedulerClusterLedger(
  client: pg.PoolClient,
  cluster: ClusterId,
): Promise<{ readonly slotsMax: number; readonly active: number }> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(${admissionLockNamespace},
          ('x' || substr(md5(${cluster}), 1, 8))::bit(32)::integer)::text AS locked`,
  );
  const found = await client.query<{ slots_max: string; active: string }>(
    sql`SELECT c.slots_max::text AS slots_max,
            (SELECT count(*)::text FROM execution e
              WHERE e.cluster = c.cluster
                AND e.status IN ('Admitted', 'Launching', 'Running')) AS active
       FROM execution_cluster c WHERE c.cluster = ${cluster}`,
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: cluster ${cluster} has no ledger to admit against`,
    );
  }
  return {
    slotsMax: projectRowCounter(row.slots_max, "cluster slots"),
    active: projectRowCounter(row.active, "cluster active count"),
  };
}

/** Takes one slot for the preferred queued execution under the locked cluster ledger. */
async function schedulerAdmit(
  client: pg.PoolClient,
  cluster: ClusterId,
): Promise<Admitted> {
  const ledger = await schedulerClusterLedger(client, cluster);
  if (ledger.active >= ledger.slotsMax) return { admitted: "ClusterFull" };
  const candidate = await client.query<{
    tenant: string;
    project: string;
    execution: string;
  }>(
    sql`SELECT e.tenant, e.project, e.execution
       FROM execution e
       JOIN capacity_account a ON a.account = e.account
       LEFT JOIN LATERAL (SELECT count(*) AS held FROM execution x
                           WHERE x.account = e.account
                             AND x.status IN ('Admitted', 'Launching', 'Running')) h ON true
      WHERE e.cluster = ${cluster} AND e.status = 'Queued' AND h.held < a.maximum
      ORDER BY (greatest(a.reserved - h.held, 0) > 0) DESC,
               e.registered_at, e.execution LIMIT 1
      FOR UPDATE OF e`,
  );
  const row = candidate.rows[0];
  if (row === undefined) return schedulerNoCandidate(client, cluster);
  const taken = await client.query(
    sql`UPDATE execution SET status = 'Admitted'
      WHERE tenant = ${row.tenant} AND project = ${row.project}
        AND execution = ${row.execution} AND status = 'Queued'`,
  );
  if (taken.rowCount !== 1) {
    throw new Error(
      `postgres scheduler: execution ${row.execution} was locked queued and then took no slot`,
    );
  }
  return { admitted: "Admitted", execution: asExecutionId(row.execution) };
}

/** Which bound stopped an admission that found nothing to admit. */
async function schedulerNoCandidate(
  client: pg.PoolClient,
  cluster: ClusterId,
): Promise<Admitted> {
  const queued = await client.query<{ one: number }>(
    sql`SELECT 1 AS one FROM execution WHERE cluster = ${cluster} AND status = 'Queued' LIMIT 1`,
  );
  return queued.rows.length > 0
    ? { admitted: "AccountAtMaximum" }
    : { admitted: "NoCandidate" };
}

/** One execution row read with the launch conditions the server decided about it. */
interface LaunchRow extends ExecutionRow {
  readonly backing_off: boolean | null;
  readonly attempt_live: boolean;
}

/** The insert-returning shape PostgreSQL reports before table constraints are applied. */
interface OpenedAttemptRow extends Omit<
  AttemptRow,
  "attempt_number" | "generation" | "authoritative"
> {
  readonly attempt_number: string | null;
  readonly generation: string | null;
  readonly authoritative: boolean | null;
}

/** Restores the non-null attempt contract enforced by the execution_attempt table. */
function schedulerOpenedAttempt(row: OpenedAttemptRow): AttemptRow {
  if (row.authoritative === null) {
    throw new Error("postgres scheduler: opened attempt authority is null");
  }
  return {
    ...row,
    attempt_number: claimRowRequired(row.attempt_number, "attempt number"),
    generation: claimRowRequired(row.generation, "attempt generation"),
    authoritative: row.authoritative,
  };
}

/** Locks the registration a launch is about, with the backoff and liveness it is subject to. */
async function schedulerLockForLaunch(
  client: pg.PoolClient,
  opening: AttemptOpening,
): Promise<LaunchRow> {
  const found = await client.query<LaunchRow>(
    sql`SELECT e.tenant, e.project, e.execution, e.ticket::text AS ticket, e.task::text AS task,
            t.kind AS task_kind, t.stage::text AS stage, e.source_request,
            q.authorizing_seq::text AS source_seq, q.effect_position::text AS source_effect,
            q.ticket_version::text AS ticket_version, e.account, e.cluster,
            e.configuration_revision, e.configuration_digest, e.status, e.outcome,
            e.result_manifest, e.completion_operation,
            (e.attempt_next - 1)::text AS attempts_opened,
            e.retries_spent::text AS retries_spent,
            (e.placement_backoff_from IS NOT NULL
             AND e.placement_backoff_from
                 + make_interval(secs => ${opening.placementBackoffSecs}::double precision)
                 > now()) IS TRUE AS backing_off,
            EXISTS (SELECT 1 FROM execution_attempt a
                     WHERE a.tenant = e.tenant AND a.project = e.project
                       AND a.execution = e.execution
                       AND a.state IN ('Placing', 'Running')) AS attempt_live
       FROM execution e
       JOIN execution_request q
         ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
       JOIN execution_request_task t
         ON t.tenant = e.tenant AND t.project = e.project
        AND t.request = e.source_request AND t.task = e.task
      WHERE e.tenant = ${opening.partition.tenant} AND e.project = ${opening.partition.project}
        AND e.execution = ${opening.execution}
      FOR UPDATE OF e`,
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: ${opening.partition.tenant}/${opening.partition.project} has no execution ${opening.execution} to launch`,
    );
  }
  return row;
}

/** Takes the next attempt number and moves an admitted registration into placement. */
async function schedulerTakeAttemptNumber(
  client: pg.PoolClient,
  opening: AttemptOpening,
): Promise<string> {
  const taken = await client.query<{ attempt_number: string | null }>(
    sql`UPDATE execution
        SET attempt_next = attempt_next + 1,
            status = CASE WHEN status = 'Admitted' THEN 'Launching' ELSE status END
      WHERE tenant = ${opening.partition.tenant} AND project = ${opening.partition.project}
        AND execution = ${opening.execution}
      RETURNING (attempt_next - 1)::text AS attempt_number`,
  );
  const row = taken.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: execution ${opening.execution} handed out no attempt number`,
    );
  }
  if (row.attempt_number === null) {
    throw new Error(
      `postgres scheduler: execution ${opening.execution} handed out a null attempt number`,
    );
  }
  return row.attempt_number;
}

/** Opens the next sequential attempt, or names the condition that stopped it. */
async function schedulerOpenAttempt(
  client: pg.PoolClient,
  opening: AttemptOpening,
): Promise<AttemptOpened> {
  schedulerRequirePositive(opening.leaseSecs, "leaseSecs");
  schedulerRequirePositive(opening.retriesMax, "retriesMax");
  schedulerRequirePositive(
    opening.placementBackoffSecs,
    "placementBackoffSecs",
  );
  const row = await schedulerLockForLaunch(client, opening);
  const execution = executionRowLogical(row);
  if (!executionOwnsSlot(execution.status) || row.attempt_live) {
    return { opened: "NotLaunchable", status: execution.status };
  }
  if (execution.retriesSpent >= opening.retriesMax) {
    return { opened: "RetriesExhausted" };
  }
  if (row.backing_off === true) return { opened: "BackingOff" };
  const attempt = `attempt-${randomUUID()}`;
  const attemptNumber = await schedulerTakeAttemptNumber(client, opening);
  const opened = await client.query<OpenedAttemptRow>(
    sql`INSERT INTO execution_attempt
       (tenant, project, execution, attempt, attempt_number, generation,
        recovery_epoch, state, lease_owner, lease_expires_at)
     VALUES (${opening.partition.tenant},${opening.partition.project},${opening.execution},
             ${attempt},${attemptNumber}::bigint,1,${opening.epoch},'Placing',${attempt},
             now() + make_interval(secs => ${opening.leaseSecs}::double precision))
     RETURNING tenant, project, execution, attempt,
               attempt_number::text AS attempt_number,
               generation::text AS generation, recovery_epoch, state, workload,
               (state IN ('Placing', 'Running')) AS authoritative`,
  );
  const written = opened.rows[0];
  if (written === undefined) {
    throw new Error(
      `postgres scheduler: opening an attempt on ${opening.execution} wrote no row`,
    );
  }
  return {
    opened: "Opened",
    attempt: attemptRowPhysical(schedulerOpenedAttempt(written)),
  };
}

/** Takes the registration's own row lock, which every attempt move is made under. */
async function schedulerLockAttemptExecution(
  client: pg.PoolClient,
  attempt: FencedAttempt,
): Promise<void> {
  await client.query<{ one: number }>(
    sql`SELECT 1 AS one FROM execution
      WHERE tenant = ${attempt.partition.tenant} AND project = ${attempt.partition.project}
        AND execution = ${attempt.execution} FOR UPDATE`,
  );
}

/** Records that the worker port placed the attempt, moving the execution to `Running`. */
async function schedulerAttemptPlaced(
  client: pg.PoolClient,
  attempt: FencedAttempt,
  workload: WorkloadId,
): Promise<boolean> {
  await schedulerLockAttemptExecution(client, attempt);
  const placed = await client.query(
    sql`UPDATE execution_attempt SET state = 'Running', workload = ${workload}
      WHERE tenant = ${attempt.partition.tenant} AND project = ${attempt.partition.project}
        AND execution = ${attempt.execution} AND attempt = ${attempt.attempt}
        AND generation = ${attempt.generation} AND state = 'Placing'`,
  );
  if (placed.rowCount !== 1) return false;
  await client.query(
    sql`UPDATE execution SET status = 'Running'
      WHERE tenant = ${attempt.partition.tenant} AND project = ${attempt.partition.project}
        AND execution = ${attempt.execution} AND status = 'Launching'`,
  );
  return true;
}

/** Records that an attempt ended without a result, leaving the slot with its execution. */
async function schedulerAttemptEnded(
  client: pg.PoolClient,
  attempt: FencedAttempt,
  loss: AttemptLoss,
  evidence: AttemptEvidence,
): Promise<boolean> {
  await schedulerLockAttemptExecution(client, attempt);
  const ended = await client.query(
    sql`UPDATE execution_attempt
        SET state = ${loss}, evidence = ${evidence}, ended_at = now(),
            lease_owner = NULL, lease_expires_at = NULL
      WHERE tenant = ${attempt.partition.tenant} AND project = ${attempt.partition.project}
        AND execution = ${attempt.execution} AND attempt = ${attempt.attempt}
        AND generation = ${attempt.generation} AND state IN ('Placing', 'Running')`,
  );
  if (ended.rowCount !== 1) return false;
  await client.query(
    sql`UPDATE execution
        SET retries_spent = retries_spent + ${loss === "Lost" ? 1 : 0},
            placement_backoff_from = now()
      WHERE tenant = ${attempt.partition.tenant} AND project = ${attempt.partition.project}
        AND execution = ${attempt.execution}
        AND status NOT IN ('Terminal', 'Cancelled')`,
  );
  return true;
}

/**
 * Ends at most `attemptsMax` live attempts whose lease has run out, charging the
 * budget an attempt that ran spends to exactly the registrations whose attempt
 * this pass ends. The registrations are locked before their attempts and both in
 * key order, and the bound is applied to the registrations — one of which can
 * hold only one live attempt, so it bounds the attempts too.
 */
async function schedulerReapLapsedAttempts(
  client: pg.PoolClient,
  epoch: RecoveryEpoch,
  attemptsMax: number,
): Promise<number> {
  schedulerRequirePositive(attemptsMax, "attemptsMax");
  if ((await postgresOwnershipEpoch(client)) !== epoch) return 0;
  const held = await client.query<SchedulerRowKey>(
    sql`SELECT e.tenant, e.project, e.execution FROM execution e
      WHERE EXISTS (SELECT 1 FROM execution_attempt a
                     WHERE a.tenant = e.tenant AND a.project = e.project
                       AND a.execution = e.execution
                       AND a.state IN ('Placing', 'Running')
                       AND a.lease_expires_at <= now())
      ORDER BY e.tenant, e.project, e.execution
      LIMIT ${attemptsMax} FOR UPDATE`,
  );
  if (held.rows.length === 0) return 0;
  const [heldTenants, heldProjects, heldExecutions] = schedulerRowKeys(
    held.rows,
  );
  const lapsed = await client.query<SchedulerRowKey & { attempt: string }>(
    sql`SELECT a.tenant, a.project, a.execution, a.attempt FROM execution_attempt a
       JOIN unnest(${heldTenants}::text[], ${heldProjects}::text[], ${heldExecutions}::text[])
         AS h(tenant, project, execution)
         ON a.tenant = h.tenant AND a.project = h.project AND a.execution = h.execution
      WHERE a.state IN ('Placing', 'Running') AND a.lease_expires_at <= now()
      ORDER BY a.tenant, a.project, a.execution, a.attempt FOR UPDATE OF a`,
  );
  if (lapsed.rows.length === 0) return 0;
  const [tenants, projects, executions] = schedulerRowKeys(lapsed.rows);
  await client.query(
    sql`UPDATE execution e
        SET retries_spent = e.retries_spent + 1, placement_backoff_from = now()
       FROM unnest(${tenants}::text[], ${projects}::text[], ${executions}::text[])
         AS h(tenant, project, execution)
      WHERE e.tenant = h.tenant AND e.project = h.project AND e.execution = h.execution
        AND e.status NOT IN ('Terminal', 'Cancelled')`,
  );
  return schedulerEndLapsed(
    client,
    lapsed.rows.map((row) => row.attempt),
  );
}

/** Ends the attempts named, which the caller has already locked in key order. */
async function schedulerEndLapsed(
  client: pg.PoolClient,
  attempts: readonly string[],
): Promise<number> {
  if (attempts.length === 0) return 0;
  const ended = await client.query(
    sql`UPDATE execution_attempt
        SET state = 'Lost', evidence = 'LeaseExpired', ended_at = now(),
            lease_owner = NULL, lease_expires_at = NULL
      WHERE attempt = ANY(${[...attempts]}::text[])`,
  );
  return ended.rowCount ?? 0;
}

/** At most `executionsMax` executions that own a slot and have no live attempt. */
async function schedulerUnlaunched(
  client: pg.PoolClient,
  epoch: RecoveryEpoch,
  executionsMax: number,
): Promise<readonly LogicalExecution[]> {
  schedulerRequirePositive(executionsMax, "executionsMax");
  if ((await postgresOwnershipEpoch(client)) !== epoch) return [];
  const waiting = await client.query<ExecutionRow>(
    sql`SELECT e.tenant, e.project, e.execution, e.ticket::text AS ticket, e.task::text AS task,
            t.kind AS task_kind, t.stage::text AS stage, e.source_request,
            q.authorizing_seq::text AS source_seq, q.effect_position::text AS source_effect,
            q.ticket_version::text AS ticket_version, e.account, e.cluster,
            e.configuration_revision, e.configuration_digest, e.status, e.outcome,
            e.result_manifest, e.completion_operation,
            (e.attempt_next - 1)::text AS attempts_opened,
            e.retries_spent::text AS retries_spent
       FROM execution e
       JOIN execution_request q
         ON q.tenant = e.tenant AND q.project = e.project AND q.request = e.source_request
       JOIN execution_request_task t
         ON t.tenant = e.tenant AND t.project = e.project
        AND t.request = e.source_request AND t.task = e.task
      WHERE e.status IN ('Admitted', 'Launching', 'Running')
        AND NOT EXISTS (SELECT 1 FROM execution_attempt a
                         WHERE a.tenant = e.tenant AND a.project = e.project
                           AND a.execution = e.execution
                           AND a.state IN ('Placing', 'Running'))
      ORDER BY e.registered_at, e.execution LIMIT ${executionsMax}`,
  );
  return waiting.rows.map(executionRowLogical);
}

/**
 * Marks at most `attemptsMax` attempts issued under an older recovery epoch
 * unable to report, taking them in key order so a concurrent sweep over the same
 * pair reaches them the same way round, and leaving the rest to a later pass.
 */
async function schedulerFenceOldEpochs(
  client: pg.PoolClient,
  epoch: RecoveryEpoch,
  attemptsMax: number,
): Promise<number> {
  schedulerRequirePositive(attemptsMax, "attemptsMax");
  const superseded = await client.query<{ attempt: string }>(
    sql`SELECT a.attempt FROM execution_attempt a
      WHERE a.state IN ('Placing', 'Running') AND a.recovery_epoch <> ${epoch}
      ORDER BY a.tenant, a.project, a.execution, a.attempt
      LIMIT ${attemptsMax} FOR UPDATE`,
  );
  if (superseded.rows.length === 0) return 0;
  const attempts = superseded.rows.map((row) => row.attempt);
  const fenced = await client.query(
    sql`UPDATE execution_attempt
        SET state = 'Superseded', generation = generation + 1,
            evidence = 'Fenced', ended_at = now(),
            lease_owner = NULL, lease_expires_at = NULL
      WHERE attempt = ANY(${attempts}::text[])`,
  );
  return fenced.rowCount ?? 0;
}

/** What one execution durably says about itself, which resolves an ambiguous commit. */
async function schedulerExecution(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
): Promise<LogicalExecution | undefined> {
  const found = await pool.query<ExecutionRow>(
    sql`SELECT e.tenant, e.project, e.execution, e.ticket::text AS ticket,
               e.task::text AS task, t.kind AS task_kind, t.stage::text AS stage,
               e.source_request, q.authorizing_seq::text AS source_seq,
               q.effect_position::text AS source_effect,
               q.ticket_version::text AS ticket_version, e.account, e.cluster,
               e.configuration_revision, e.configuration_digest, e.status,
               e.outcome, e.result_manifest, e.completion_operation,
               (e.attempt_next - 1)::text AS attempts_opened,
               e.retries_spent::text AS retries_spent
          FROM execution e
          JOIN execution_request q
            ON q.tenant = e.tenant AND q.project = e.project
           AND q.request = e.source_request
          JOIN execution_request_task t
            ON t.tenant = e.tenant AND t.project = e.project
           AND t.request = e.source_request AND t.task = e.task
         WHERE e.tenant = ${partition.tenant} AND e.project = ${partition.project}
           AND e.execution = ${execution}`,
  );
  const row = found.rows[0];
  return row === undefined ? undefined : executionRowLogical(row);
}

/** The durable execution authority for one installation, over a scheduler-role pool. */
export function postgresExecutionScheduler(
  pool: pg.Pool,
): ExecutionSchedulerStore {
  return {
    claimRequests: (owner, kinds, requestsMax, leaseSecs) =>
      schedulerClaimRequests(pool, owner, kinds, requestsMax, leaseSecs),
    registerSpawn: (claim) =>
      postgresTransaction(pool, (client) =>
        schedulerRegisterSpawn(client, claim),
      ),
    registerCancellation: (claim) =>
      postgresTransaction(pool, (client) =>
        schedulerRegisterCancellation(client, claim),
      ),
    admit: (cluster) =>
      postgresTransaction(pool, (client) => schedulerAdmit(client, cluster)),
    openAttempt: (opening) =>
      postgresTransaction(pool, (client) =>
        schedulerOpenAttempt(client, opening),
      ),
    attemptPlaced: (attempt, workload) =>
      postgresTransaction(pool, (client) =>
        schedulerAttemptPlaced(client, attempt, workload),
      ),
    attemptEnded: (attempt, loss, evidence) =>
      postgresTransaction(pool, (client) =>
        schedulerAttemptEnded(client, attempt, loss, evidence),
      ),
    retriesExhausted: (partition, execution) =>
      postgresTransaction(pool, (client) =>
        schedulerRetriesExhausted(client, partition, execution),
      ),
    terminalize: (report) =>
      postgresTransaction(pool, (client) =>
        schedulerTerminalize(client, report),
      ),
    blockExecution: (partition, execution, reason) =>
      postgresTransaction(pool, (client) =>
        schedulerBlockExecution(client, partition, execution, reason),
      ),
    execution: (partition, execution) =>
      schedulerExecution(pool, partition, execution),
    reapLapsedAttempts: (epoch, attemptsMax) =>
      postgresTransaction(pool, (client) =>
        schedulerReapLapsedAttempts(client, epoch, attemptsMax),
      ),
    unlaunched: (epoch, executionsMax) =>
      postgresTransaction(pool, (client) =>
        schedulerUnlaunched(client, epoch, executionsMax),
      ),
    fenceOldEpochAttempts: (epoch, attemptsMax) =>
      postgresTransaction(pool, (client) =>
        schedulerFenceOldEpochs(client, epoch, attemptsMax),
      ),
  };
}
